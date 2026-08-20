import { test, expect } from './fixtures/seed'
import { unique } from './fixtures/ids'
import { pdfPages, pdfPageCount, countOccurrences, idOrderInText, pdfGeoPages } from './fixtures/pdf'
import type { PdfGeoPage } from './fixtures/pdf'
import type { Page, Response } from '@playwright/test'

const BASE = 'http://localhost:15173'

// ---- Helpers (same conventions as sorting.spec.ts) ----

/** Creates a spool via the SPA "New spool" form and returns the new spool's id (from the POST response). */
async function createSpoolViaUi(page: Page, typeId: string, initialNetGrams?: number): Promise<string> {
  await page.goto('/spools')
  await page.getByRole('button', { name: 'New spool' }).click()
  const form = page.locator('form.card')
  await form.getByLabel('Filament type').selectOption(typeId)
  if (initialNetGrams !== undefined) {
    await form.getByLabel('Initial net (g, optional)').fill(String(initialNetGrams))
  }
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/spools') && r.request().method() === 'POST'),
    form.getByRole('button', { name: 'Create', exact: true }).click(),
  ])
  const json = await resp.json()
  return json.id as string
}

/** Checks the selection checkbox of the row whose id-pill is exactly `spoolId`. */
async function checkSpool(page: Page, spoolId: string): Promise<void> {
  const row = page.locator('tbody tr', { has: page.locator('a.id-pill', { hasText: new RegExp(`^${spoolId}$`) }) })
  await row.locator('input[type="checkbox"]').first().check()
}

/** Waits until both spools are present as rows, then opens the print dialog. */
async function openPrintDialog(page: Page, spoolIds: string[]): Promise<void> {
  for (const id of spoolIds) {
    await expect(page.locator('a.id-pill', { hasText: new RegExp(`^${id}$`) }).first()).toBeVisible()
  }
  await checkSpool(page, spoolIds[0])
  if (spoolIds.length > 1) await checkSpool(page, spoolIds[1])
  await page.getByRole('button', { name: /Print labels \(\d+\)/ }).click()
  await expect(page.getByRole('dialog', { name: 'Print labels' })).toBeVisible()
}

/** Returns the spool's label-text needle (color immediately precedes the id in the label text). */
const labelNeedle = (color: string, spoolId: string) => color + spoolId

/** Decodes a label PDF body and returns the ids (by needle) in drawing order across all pages. */
function labelOrder(body: Buffer, color: string, spoolIds: string[]): string[] {
  const text = pdfPages(body).map(p => p.text).join('')
  return idOrderInText(text, spoolIds.map(id => labelNeedle(color, id))).map(n => n.slice(color.length))
}

type PrintResult = { popup: Page; response: Response; body: Buffer }

/** Clicks the dialog's Print button and captures the new tab's /api/labels response. */
async function printViaDialog(page: Page, copies: string | null): Promise<PrintResult> {
  const dialog = page.getByRole('dialog', { name: 'Print labels' })
  if (copies !== null) await dialog.getByLabel('Copies').fill(copies)
  const [popup, response] = await Promise.all([
    page.waitForEvent('popup'),
    page.context().waitForEvent('response', r => r.url().includes('/api/labels')),
    dialog.getByRole('button', { name: 'Print', exact: true }).click(),
  ])
  // In headless Chromium the PDF is a download rather than an inline page, so the
  // popup never settles on a document URL. The captured response IS the load of the
  // label PDF; its body is not kept once the navigation is consumed, so re-fetch it.
  const refetched = await page.context().request.get(response.url())
  const body = Buffer.from(await refetched.body())
  return { popup, response, body }
}

// ---- Tests ----

// specs run in alphabetical order against one shared database: this spec must leave the
// database empty so that smoke.spec.ts can still observe a fresh one.
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE })
  try {
    const spools = (await (await ctx.request.get('/api/spools')).json()) as { items: Array<{ id: string }> }
    for (const s of spools.items) await ctx.request.delete(`/api/spools/${s.id}`)
    const types = (await (await ctx.request.get('/api/filament-types')).json()) as { items: Array<{ id: string }> }
    for (const t of types.items) await ctx.request.delete(`/api/filament-types/${t.id}`)
  }
  finally {
    await ctx.close()
  }
})

// AC-1: Print button opens the in-page copies dialog; nothing opens until Print is confirmed.
test('print button opens the copies dialog without opening a tab', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  let popups = 0
  let labelsRequests = 0
  page.on('popup', p => { popups++; p.close().catch(() => { /* already closed */ }) })
  page.on('request', r => { if (r.url().includes('/api/labels')) labelsRequests++ })

  await page.goto('/spools')
  await openPrintDialog(page, [a, b])

  const dialog = page.getByRole('dialog', { name: 'Print labels' })
  await expect(dialog.getByText('2 spools selected', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Copies')).toHaveValue('1')
  await expect(dialog.getByText('2 labels', { exact: true })).toBeVisible()

  expect(popups, 'no tab may open when the dialog is shown').toBe(0)
  await expect(dialog).toBeVisible()
  expect(labelsRequests, 'no label request may be made before Print is confirmed').toBe(0)
})

// AC-2: copies field has bounds, defaults to 1, and the live label count reacts to it.
test('copies field has min/max, defaults to 1, and label count updates', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  await page.goto('/spools')
  await openPrintDialog(page, [a, b])

  const dialog = page.getByRole('dialog', { name: 'Print labels' })
  const copies = dialog.getByLabel('Copies')
  await expect(copies).toHaveAttribute('min', '1')
  await expect(copies).toHaveAttribute('max', '10')
  await expect(copies).toHaveValue('1')
  await expect(dialog.getByText('2 labels', { exact: true })).toBeVisible()

  await copies.fill('4')
  await expect(dialog.getByText('8 labels', { exact: true })).toBeVisible()
})

// AC-3: Print opens one new tab with copies=K whose PDF carries K labels per selected spool.
test('print opens a new tab with copies=K and loads the label PDF', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id
  const color = seed.type.color

  await page.goto('/spools')
  await openPrintDialog(page, [a, b])

  const { popup, response, body } = await printViaDialog(page, '3')

  expect(response.url()).toBe(`${BASE}/api/labels?id=${a}&id=${b}&copies=3`)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('application/pdf')
  expect(response.headers()['content-disposition']).toContain('spool-labels.pdf')

  const pages = pdfPages(body)
  expect(pages.length).toBe(1)
  expect(pages[0].labelCount).toBe(6)
  expect(countOccurrences(pages[0].text, labelNeedle(color, a))).toBe(3)
  expect(countOccurrences(pages[0].text, labelNeedle(color, b))).toBe(3)
  expect(labelOrder(body, color, [a, b])).toEqual([a, a, a, b, b, b])
  await expect(page.getByRole('dialog', { name: 'Print labels' })).toBeHidden()

  await popup.close()
})

// AC-4: the last used copies count is remembered for the next dialog session.
test('last used copy count survives a page reload', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  await page.goto('/spools')
  await openPrintDialog(page, [a, b])
  const { popup } = await printViaDialog(page, '4')
  await popup.close()

  await page.goto('/spools')
  await openPrintDialog(page, [a, b])
  await expect(page.getByRole('dialog', { name: 'Print labels' }).getByLabel('Copies')).toHaveValue('4')
})

// AC-5: Cancel closes the dialog without printing anything.
test('cancel closes the dialog without a request', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  let popups = 0
  let labelsRequests = 0
  page.on('popup', p => { popups++; p.close().catch(() => { /* already closed */ }) })
  page.on('request', r => { if (r.url().includes('/api/labels')) labelsRequests++ })

  await page.goto('/spools')
  await openPrintDialog(page, [a, b])

  await page.getByRole('dialog', { name: 'Print labels' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog', { name: 'Print labels' })).toBeHidden()

  expect(popups).toBe(0)
  expect(labelsRequests).toBe(0)

  const row = page.locator('tbody tr', { has: page.locator('a.id-pill', { hasText: new RegExp(`^${a}$`) }) })
  await expect(row.locator('input[type="checkbox"]').first()).toBeChecked()
})

// AC-6: an emptied copies field means a single copy is requested.
test('print with an empty copies field sends copies=1', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  await page.goto('/spools')
  await openPrintDialog(page, [a, b])

  const { popup, response, body } = await printViaDialog(page, '')
  expect(response.url()).toContain(`id=${a}`)
  expect(response.url()).toContain(`id=${b}`)
  expect(response.url()).toContain('copies=1')

  const pages = pdfPages(body)
  expect(pages.length).toBe(1)
  expect(pages[0].labelCount).toBe(2)
  await popup.close()
})

// AC-7: copies=K with one spool returns K identical labels.
test('copies=3 returns three identical labels for one spool', async ({ page, seed }) => {
  const resp = await page.request.get(`/api/labels?id=${seed.spool.id}&copies=3`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  const pages = pdfPages(body)
  expect(pages.length).toBe(1)
  expect(pages[0].labelCount).toBe(3)
  expect(countOccurrences(pages[0].text, labelNeedle(seed.type.color, seed.spool.id))).toBe(3)
  expect(countOccurrences(pages[0].text, seed.type.brand)).toBe(3)
})

// AC-8: copies interleave per spool in request order (A,A,B,B).
test('copies=2 returns labels in A,A,B,B order', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  const resp = await page.request.get(`/api/labels?id=${a}&id=${b}&copies=2`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  expect(pdfPageCount(body)).toBe(1)
  expect(labelOrder(body, seed.type.color, [a, b])).toEqual([a, a, b, b])
})

// AC-9: without the parameter a single copy per spool is generated, in request order.
test('no copies parameter returns one label per spool in request order', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  const resp = await page.request.get(`/api/labels?id=${a}&id=${b}`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  expect(pdfPageCount(body)).toBe(1)
  expect(labelOrder(body, seed.type.color, [a, b])).toEqual([a, b])
})

// AC-10: invalid copies values are rejected with 400 and no PDF.
test('invalid copies values return 400 with no pdf', async ({ page, seed }) => {
  for (const copies of ['0', '-2', '1.5', 'abc', '11']) {
    const resp = await page.request.get(`/api/labels?id=${seed.spool.id}&copies=${encodeURIComponent(copies)}`)
    expect(resp.status(), `copies=${copies} must be rejected`).toBe(400)
    expect(resp.headers()['content-type'], `copies=${copies} must not produce a PDF`).toContain('application/json')
  }
})

// AC-11: no ids at all is a 400; a request with no resolvable spool is a 404.
test('no ids return 400 and all-unknown ids return 404', async ({ page }) => {
  const none = await page.request.get('/api/labels')
  expect(none.status()).toBe(400)

  const unknown = await page.request.get('/api/labels?id=NOPE&copies=2')
  expect(unknown.status()).toBe(404)
})

// AC-12: 16 labels (8 spools x 2) fit on the single 21-slot page with per-spool pairs.
test('16 labels fit on one page with per-spool pairs', async ({ page, seed }) => {
  const ids: string[] = [seed.spool.id]
  for (let i = 0; i < 7; i++) ids.push(await createSpoolViaUi(page, seed.type.id))
  const color = seed.type.color

  const resp = await page.request.get(`/api/labels?${ids.map(id => `id=${id}`).join('&')}&copies=2`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  const pages = pdfPages(body)
  expect(pages.length).toBe(1)
  expect(pages[0].labelCount).toBe(16)

  const expected = ids.flatMap(id => [id, id])
  expect(idOrderInText(pages[0].text, ids.map(id => labelNeedle(color, id))).map(n => n.slice(color.length))).toEqual(expected)
  for (const id of ids) expect(countOccurrences(pages[0].text, labelNeedle(color, id))).toBe(2)
})

// AC-13: repeated ids in the request are not de-duplicated.
test('duplicate ids are not de-duplicated', async ({ page, seed }) => {
  const a = seed.spool.id
  const resp = await page.request.get(`/api/labels?id=${a}&id=${a}&copies=2`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  const pages = pdfPages(body)
  expect(pages.length).toBe(1)
  expect(pages[0].labelCount).toBe(4)
  expect(countOccurrences(pages[0].text, labelNeedle(seed.type.color, a))).toBe(4)
})

// AC-14: 20 labels (2 spools x 10) fit on the single page with unchanged label content.
test('copies=10 returns 1 page of 20 labels with unchanged label content', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id
  const color = seed.type.color
  const t = seed.type

  const resp = await page.request.get(`/api/labels?id=${a}&id=${b}&copies=10`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  const pages = pdfPages(body)
  expect(pages.length).toBe(1)
  expect(pages[0].labelCount).toBe(20)

  expect(countOccurrences(pages[0].text, t.brand)).toBe(20)
  expect(countOccurrences(pages[0].text, t.material)).toBe(20)
  expect(countOccurrences(pages[0].text, t.type)).toBe(20)
  expect(countOccurrences(pages[0].text, t.color)).toBe(20)
  expect(countOccurrences(pages[0].text, labelNeedle(color, a))).toBe(10)
  expect(countOccurrences(pages[0].text, labelNeedle(color, b))).toBe(10)
})

// ---- New tiling: geometry assertions for the 21-per-page layout ----

/** Groups sorted-ish values into clusters of values within `tol` of each other. */
function cluster(values: number[], tol = 0.3): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > tol) out.push(v)
  }
  return out
}

/** The 66x35 label panel frame of a single-label page, recovered from its border edges. */
function singlePanel(page: PdfGeoPage): { left: number; top: number; right: number; bottom: number } {
  const edgeH = page.rects.filter(r => r.wMm >= 65.5 && r.hMm <= 0.5)
  const edgeV = page.rects.filter(r => r.wMm <= 0.5 && r.hMm >= 34.5)
  expect(edgeH, 'two horizontal panel border edges').toHaveLength(2)
  expect(edgeV, 'two vertical panel border edges').toHaveLength(2)
  return {
    left: Math.min(...edgeV.map(r => r.xMm)),
    top: Math.min(...edgeH.map(r => r.yTopMm)),
    right: Math.max(...edgeH.map(r => r.xMm + r.wMm)),
    bottom: Math.max(...edgeV.map(r => r.yTopMm + r.hMm)),
  }
}

/** Runs in `runs` that are the (only) runs carrying `text` exactly. */
function runsWithText(page: PdfGeoPage, text: string) {
  return page.textRuns.filter(r => r.text === text)
}

/** Asserts no text run is smaller than the 8 pt floor. */
function assertFloor(page: PdfGeoPage) {
  expect(page.textRuns.length).toBeGreaterThan(0)
  for (const r of page.textRuns) expect(r.sizePt, `run "${r.text}" below the 8 pt floor`).toBeGreaterThanOrEqual(8 - 0.05)
}

/** Asserts every text run stays inside the panel rectangle (±0.5 mm, Td-sum underestimates the last glyph). */
function assertRunsInsidePanel(page: PdfGeoPage, panel: { left: number; top: number; right: number; bottom: number }) {
  for (const r of page.textRuns) {
    expect(r.xMm, `run "${r.text}" left of panel`).toBeGreaterThanOrEqual(panel.left - 0.5)
    expect(r.xMm + r.wMm + 1, `run "${r.text}" past panel right`).toBeLessThanOrEqual(panel.right + 0.5)
    expect(r.yTopMm, `run "${r.text}" above panel`).toBeGreaterThanOrEqual(panel.top - 0.5)
    expect(r.yTopMm, `run "${r.text}" below panel`).toBeLessThanOrEqual(panel.bottom + 0.5)
  }
}

/** Asserts the (single) QR image: 30x30 mm, opaque, painted after the last text run. */
function assertQr(page: PdfGeoPage, panel: { left: number; top: number }, expectedOffset?: { x: number; y: number }) {
  expect(page.images).toHaveLength(1)
  const qr = page.images[0]
  expect(qr.wMm).toBeGreaterThanOrEqual(29.5)
  expect(qr.wMm).toBeLessThanOrEqual(30.5)
  expect(qr.hMm).toBeGreaterThanOrEqual(29.5)
  expect(qr.hMm).toBeLessThanOrEqual(30.5)
  expect(qr.opaque, 'QR image must have no /SMask (opaque white)').toBe(true)
  const lastText = Math.max(...page.textRuns.map(r => r.order))
  expect(qr.order, 'QR painted after the label text').toBeGreaterThan(lastText)
  if (expectedOffset) {
    expect(qr.xMm - panel.left).toBeGreaterThanOrEqual(expectedOffset.x - 0.5)
    expect(qr.xMm - panel.left).toBeLessThanOrEqual(expectedOffset.x + 0.5)
    expect(qr.yTopMm - panel.top).toBeGreaterThanOrEqual(expectedOffset.y - 0.5)
    expect(qr.yTopMm - panel.top).toBeLessThanOrEqual(expectedOffset.y + 0.5)
  }
}

/** Selects any number of spools in the print dialog (openPrintDialog handles at most two). */
async function openPrintDialogFor(page: Page, spoolIds: string[]): Promise<void> {
  for (const id of spoolIds) {
    await expect(page.locator('a.id-pill', { hasText: new RegExp(`^${id}$`) }).first()).toBeVisible()
  }
  for (const id of spoolIds) await checkSpool(page, id)
  await page.getByRole('button', { name: /Print labels \(\d+\)/ }).click()
  await expect(page.getByRole('dialog', { name: 'Print labels' })).toBeVisible()
}

// AC-1/2/3: 21 labels (3 spools x 7) fill exactly one A4 page in 7 rows of 3.
test('21 labels fit one A4 page in 7 rows of 3', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const c = await createSpoolViaUi(page, seed.type.id)
  const ids = [seed.spool.id, b, c]

  await page.goto('/spools')
  await openPrintDialogFor(page, ids)

  const { popup, response, body } = await printViaDialog(page, '7')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('application/pdf')
  expect(response.headers()['content-disposition']).toContain('spool-labels.pdf')
  expect(response.url()).toBe(`${BASE}/api/labels?id=${ids[0]}&id=${b}&id=${c}&copies=7`)

  const pages = pdfGeoPages(body)
  expect(pages).toHaveLength(1)
  const p = pages[0]
  expect(p.mediaBox[0]).toBeGreaterThanOrEqual(593)
  expect(p.mediaBox[0]).toBeLessThanOrEqual(597)
  expect(p.mediaBox[1]).toBeGreaterThanOrEqual(840)
  expect(p.mediaBox[1]).toBeLessThanOrEqual(844)
  expect(p.images).toHaveLength(21)
  expect(p.textRuns.filter(r => r.sizePt >= 13.95).length, 'one spool-id run per label').toBe(21)

  // Panel frames from the border edges: 3 columns x 7 rows of 66x35 mm panels.
  const edgeH = p.rects.filter(r => r.wMm >= 65.5 && r.hMm <= 0.5)
  const edgeV = p.rects.filter(r => r.wMm <= 0.5 && r.hMm >= 34.5)
  expect(edgeH).toHaveLength(42)
  expect(edgeV).toHaveLength(42)

  const expectedLeft = [5, 72, 139]
  const expectedTop = [10, 46, 82, 118, 154, 190, 226]
  // Columns from the horizontal edges (their x is the panel's left) and rows from the
  // vertical edges (their y is the panel's top): each rectangle set includes both sides of
  // every panel.
  const lefts = cluster(edgeH.map(r => r.xMm))
  const tops = cluster(edgeV.map(r => r.yTopMm))
  expect(lefts).toHaveLength(3)
  expect(tops).toHaveLength(7)
  lefts.forEach((x, i) => expect(Math.abs(x - expectedLeft[i]), `panel column ${i} at ${x}`).toBeLessThanOrEqual(0.5))
  tops.forEach((y, i) => expect(Math.abs(y - expectedTop[i]), `panel row ${i} at ${y}`).toBeLessThanOrEqual(0.5))

  // Panel size, side margins, top margin and gaps.
  for (const r of edgeH) {
    expect(r.wMm).toBeGreaterThanOrEqual(65.5)
    expect(r.wMm).toBeLessThanOrEqual(66.5)
  }
  for (const r of edgeV) {
    expect(r.hMm).toBeGreaterThanOrEqual(34.5)
    expect(r.hMm).toBeLessThanOrEqual(35.5)
  }
  expect(lefts[0]).toBeGreaterThanOrEqual(4.5)
  expect(lefts[0]).toBeLessThanOrEqual(5.5)
  expect(Math.max(...edgeH.map(r => r.xMm + r.wMm))).toBeGreaterThanOrEqual(204.5)
  expect(Math.max(...edgeH.map(r => r.xMm + r.wMm))).toBeLessThanOrEqual(205.5)
  for (let i = 1; i < lefts.length; i++) {
    const gap = lefts[i] - lefts[i - 1] - 66
    expect(gap, 'horizontal gap between adjacent panels').toBeGreaterThanOrEqual(0.5)
    expect(gap).toBeLessThanOrEqual(1.5)
  }
  for (let i = 1; i < tops.length; i++) {
    const gap = tops[i] - tops[i - 1] - 35
    expect(gap, 'vertical gap between adjacent panels').toBeGreaterThanOrEqual(0.5)
    expect(gap).toBeLessThanOrEqual(1.5)
  }

  // QR codes: one per label, 30x30 mm, at the panel offset (34, 2.5), 3 per row.
  for (const img of p.images) {
    expect(img.wMm).toBeGreaterThanOrEqual(29.5)
    expect(img.wMm).toBeLessThanOrEqual(30.5)
    expect(img.hMm).toBeGreaterThanOrEqual(29.5)
    expect(img.hMm).toBeLessThanOrEqual(30.5)
    const left = lefts.filter(x => img.xMm >= x - 1).pop()
    const top = tops.filter(y => img.yTopMm >= y - 1).pop()
    expect(left, `QR at x ${img.xMm} has a panel column`).toBeDefined()
    expect(top, `QR at y ${img.yTopMm} has a panel row`).toBeDefined()
    expect(img.xMm - left!).toBeGreaterThanOrEqual(33.5)
    expect(img.xMm - left!).toBeLessThanOrEqual(34.5)
    expect(img.yTopMm - top!).toBeGreaterThanOrEqual(2.0)
    expect(img.yTopMm - top!).toBeLessThanOrEqual(3.0)
  }
  const rows = cluster(p.images.map(i => i.yTopMm), 0.5)
  expect(rows).toHaveLength(7)
  for (const y of rows) expect(p.images.filter(i => Math.abs(i.yTopMm - y) <= 0.5), 'three QRs per row').toHaveLength(3)

  await expect(page.getByRole('dialog', { name: 'Print labels' })).toBeHidden()
  await popup.close()
})

// AC-2/4/5/7/8: the single-label panel distributes its text over the 35 mm height, carries a
// 30 mm opaque QR painted last, shows the colour swatch, and respects the 8 pt floor.
test('single label panel: distributed text, 30 mm QR, 8 pt floor, opaque QR painted last', async ({ page, seed }) => {
  const resp = await page.request.get(`/api/labels?id=${seed.spool.id}`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  const pages = pdfGeoPages(body)
  expect(pages).toHaveLength(1)
  const p = pages[0]
  const panel = singlePanel(p)
  expect(panel.left).toBeGreaterThanOrEqual(4.5)
  expect(panel.left).toBeLessThanOrEqual(5.5)
  expect(panel.top).toBeGreaterThanOrEqual(9.5)
  expect(panel.top).toBeLessThanOrEqual(10.5)
  expect(panel.right - panel.left).toBeGreaterThanOrEqual(65.5)
  expect(panel.right - panel.left).toBeLessThanOrEqual(66.5)
  expect(panel.bottom - panel.top).toBeGreaterThanOrEqual(34.5)
  expect(panel.bottom - panel.top).toBeLessThanOrEqual(35.5)

  assertQr(p, panel, { x: 34, y: 2.5 })
  assertFloor(p)
  assertRunsInsidePanel(p, panel)

  const qr = p.images[0]
  // The brand starts within the top 8 mm of the panel.
  const brand = runsWithText(p, seed.type.brand)
  expect(brand).toHaveLength(1)
  expect(brand[0].yTopMm - panel.top, 'brand baseline within top 8 mm').toBeLessThanOrEqual(8)
  // The text is not confined to the top half: the spool-ID row sits below the mid-line and
  // ends within the bottom 10 mm.
  const idRun = runsWithText(p, seed.spool.id)
  expect(idRun).toHaveLength(1)
  const mid = panel.top + (panel.bottom - panel.top) / 2
  expect(idRun[0].yTopMm, 'ID row below the panel mid-line').toBeGreaterThan(mid)
  expect(panel.bottom - idRun[0].yTopMm, 'ID row within bottom 10 mm').toBeLessThanOrEqual(10)
  // The ID stays inside the panel and entirely left of the QR.
  expect(idRun[0].xMm + idRun[0].wMm, 'ID run left of the QR').toBeLessThanOrEqual(qr.xMm)
  expect(idRun[0].sizePt, 'ID run at its 14 pt size').toBeGreaterThanOrEqual(13.95)

  // The seed type keeps the form's default hex (#888888): the swatch square is present.
  const swatch = p.rects.filter(r =>
    r.xMm >= panel.left - 0.5 && r.xMm <= panel.right && r.yTopMm >= panel.top - 0.5 && r.yTopMm <= panel.bottom,
  ).filter(r => r.wMm > 2.4 && r.wMm < 3.1 && r.hMm > 2.4 && r.hMm < 3.1)
  expect(swatch, 'colour swatch next to the colour row').toHaveLength(1)
  for (const c of swatch[0].rgb) {
    expect(c).toBeGreaterThanOrEqual(0.533 - 0.02)
    expect(c).toBeLessThanOrEqual(0.533 + 0.02)
  }

  // All four fields are present in the decoded label text (the material · type band may
  // wrap onto its two lines, so the parts are checked separately).
  const text = pdfPages(body)[0].text
  expect(text).toContain(seed.type.brand)
  expect(text).toContain(seed.type.material)
  expect(text).toContain('·')
  expect(text).toContain(seed.type.type)
  expect(text).toContain(seed.type.color)
  expect(text).toContain(seed.spool.id)
})

// AC-6/7/8: with 128+ char fields the spool ID stays fully visible, everything holds the
// 8 pt floor, and the spill runs hide under the opaque QR.
test('long field values: spool ID fully visible, 8 pt floor, spill hidden under the QR', async ({ page }) => {
  // The database caps brand/color at 64 and material/type at 32 characters, so the
  // full-stack scenario uses the longest storable single-word values (the unit layer
  // pins the 200-char case of the same acceptance criterion).
  const long = (prefix: string, max: number) => {
    const base = unique(prefix)
    return base + 'q'.repeat(Math.max(0, max - base.length))
  }
  const t = await page.request.post('/api/filament-types', {
    data: {
      brand: long('brand', 64),
      material: long('mat', 32),
      type: long('type', 32),
      color: long('color', 64),
      colorHex: null,
      defaultNetWeightGrams: 1000,
      emptySpoolWeightGrams: 120,
    },
  })
  expect(t.status()).toBe(201)
  const typeId = (await t.json()).id as string
  const s = await page.request.post(`/api/spools`, {
    data: { filamentTypeId: typeId, initialNetGrams: 500 },
  })
  expect(s.status()).toBe(201)
  const spoolId = (await s.json()).id as string

  const resp = await page.request.get(`/api/labels?id=${spoolId}`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()
  const p = pdfGeoPages(body)[0]
  const panel = singlePanel(p)
  const qr = p.images[0]

  assertFloor(p)
  assertRunsInsidePanel(p, panel)
  assertQr(p, panel)

  const idRun = runsWithText(p, spoolId)
  expect(idRun).toHaveLength(1)
  expect(idRun[0].xMm, 'ID inside panel').toBeGreaterThanOrEqual(panel.left)
  expect(idRun[0].xMm + idRun[0].wMm + 1, 'ID inside panel (right)').toBeLessThanOrEqual(panel.right)
  expect(idRun[0].xMm + idRun[0].wMm + 1, 'ID entirely left of the QR').toBeLessThanOrEqual(qr.xMm)
  expect(idRun[0].sizePt).toBeGreaterThanOrEqual(8 - 0.05)

  // The brand at the 8 pt floor spills from the 32 mm column under the QR: at least one
  // text run starts left of the QR and extends into its x-range.
  const intoQr = p.textRuns.filter(r => r.xMm < qr.xMm && r.xMm + r.wMm > qr.xMm)
  expect(intoQr.length, 'a run spills under the QR').toBeGreaterThanOrEqual(1)
  for (const r of intoQr) expect(r.sizePt, 'spilled run at the floor').toBeGreaterThanOrEqual(8 - 0.05)
  for (const r of intoQr) expect(r.sizePt).toBeLessThanOrEqual(8.05)
})

// AC-3: the page count is ceil(N / 21).
test('page count is ceil(N/21)', async ({ page, seed }) => {
  const id = seed.spool.id
  for (const [n, pages] of [
    [20, [20]],
    [21, [21]],
    [22, [21, 1]],
    [43, [21, 21, 1]],
  ] as const) {
    const resp = await page.request.get(`/api/labels?${Array.from({ length: n }, () => `id=${id}`).join('&')}`)
    expect(resp.status()).toBe(200)
    const body = await resp.body()
    const geo = pdfGeoPages(body)
    expect(geo.length, `N=${n}: page count`).toBe(pages.length)
    expect(geo.map(g => g.images.length), `N=${n}: labels per page`).toEqual([...pages])
  }
})

// AC-4: a type without a valid hex colour renders no swatch; everything else is unchanged.
test('label without a valid hex colour has no swatch', async ({ page }) => {
  const t = await page.request.post('/api/filament-types', {
    data: {
      brand: unique('brand'),
      material: unique('mat'),
      type: unique('type'),
      color: unique('color'),
      colorHex: 'xyz',
      defaultNetWeightGrams: 1000,
      emptySpoolWeightGrams: 120,
    },
  })
  expect(t.status()).toBe(201)
  const json = await t.json() as { id: string; color: string }
  const s = await page.request.post('/api/spools', { data: { filamentTypeId: json.id, initialNetGrams: 500 } })
  expect(s.status()).toBe(201)
  const spoolId = (await s.json()).id as string

  const resp = await page.request.get(`/api/labels?id=${spoolId}`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()
  const p = pdfGeoPages(body)[0]
  const panel = singlePanel(p)

  // Panel and QR geometry match the swatch case.
  expect(panel.right - panel.left).toBeGreaterThanOrEqual(65.5)
  expect(panel.right - panel.left).toBeLessThanOrEqual(66.5)
  assertQr(p, panel, { x: 34, y: 2.5 })
  assertFloor(p)

  const swatch = p.rects.filter(r =>
    r.xMm >= panel.left - 0.5 && r.xMm <= panel.right && r.yTopMm >= panel.top - 0.5 && r.yTopMm <= panel.bottom,
  ).filter(r => r.wMm > 2.4 && r.wMm < 3.1 && r.hMm > 2.4 && r.hMm < 3.1)
  expect(swatch, 'no swatch without a valid hex colour').toHaveLength(0)

  expect(pdfPages(body)[0].text).toContain(json.color)
})

// AC-15: downloading labels records no spool event and changes no spool or dashboard state.
test('downloading labels records no spool events and leaves counts unchanged', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id

  const summaryBefore = await (await page.request.get('/api/dashboard/summary')).json()
  const spoolsBefore = await (await page.request.get('/api/spools')).json()
  const eventsBefore: Record<string, unknown[]> = {}
  for (const id of [a, b]) {
    eventsBefore[id] = await (await page.request.get(`/api/spools/${id}/events`)).json()
  }

  const resp = await page.request.get(`/api/labels?id=${a}&id=${b}&copies=2`)
  expect(resp.status()).toBe(200)
  expect(pdfPageCount(await resp.body())).toBe(1)

  const summaryAfter = await (await page.request.get('/api/dashboard/summary')).json()
  const spoolsAfter = await (await page.request.get('/api/spools')).json()
  expect(summaryAfter, 'dashboard summary unchanged by a label download').toEqual(summaryBefore)
  expect(spoolsAfter, 'spool list unchanged by a label download').toEqual(spoolsBefore)
  for (const id of [a, b]) {
    const eventsAfter = await (await page.request.get(`/api/spools/${id}/events`)).json()
    expect(eventsAfter, `events for ${id} unchanged by a label download`).toEqual(eventsBefore[id])
    for (const e of eventsAfter) expect(e.kind, `no event other than Created for ${id}`).toBe('Created')
  }
})
