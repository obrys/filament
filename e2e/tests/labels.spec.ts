import { test, expect } from './fixtures/seed'
import { pdfPages, pdfPageCount, countOccurrences, idOrderInText } from './fixtures/pdf'
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

// AC-12: 16 labels produce exactly two A4 pages (14 + 2), spools never split across pages.
test('16 labels produce a 2-page PDF (14 + 2) with per-spool pairs', async ({ page, seed }) => {
  const ids: string[] = [seed.spool.id]
  for (let i = 0; i < 7; i++) ids.push(await createSpoolViaUi(page, seed.type.id))
  const color = seed.type.color

  const resp = await page.request.get(`/api/labels?${ids.map(id => `id=${id}`).join('&')}&copies=2`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  const pages = pdfPages(body)
  expect(pages.length).toBe(2)
  expect(pages.map(p => p.labelCount)).toEqual([14, 2])

  const firstSeven = ids.slice(0, 7)
  const pageOne = pages[0].text
  const expectedFirst = firstSeven.flatMap(id => [id, id])
  expect(idOrderInText(pageOne, firstSeven.map(id => labelNeedle(color, id))).map(n => n.slice(color.length))).toEqual(expectedFirst)
  for (const id of firstSeven) expect(countOccurrences(pageOne, labelNeedle(color, id))).toBe(2)

  const pageTwo = pages[1].text
  const last = ids[7]
  expect(countOccurrences(pageTwo, labelNeedle(color, last))).toBe(2)
  for (const id of firstSeven) expect(countOccurrences(pageTwo, labelNeedle(color, id)), 'page 2 holds only the 8th spool').toBe(0)
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

// AC-14: 20 labels (2 spools x 10) produce 2 pages (14 + 6) with unchanged label content.
test('copies=10 returns 2 pages (14 + 6) with unchanged label content', async ({ page, seed }) => {
  const b = await createSpoolViaUi(page, seed.type.id)
  const a = seed.spool.id
  const color = seed.type.color
  const t = seed.type

  const resp = await page.request.get(`/api/labels?id=${a}&id=${b}&copies=10`)
  expect(resp.status()).toBe(200)
  const body = await resp.body()

  const pages = pdfPages(body)
  expect(pages.length).toBe(2)
  expect(pages.map(p => p.labelCount)).toEqual([14, 6])

  const expected = [
    { page: pages[0], a: 10, b: 4 },
    { page: pages[1], a: 0, b: 6 },
  ]
  for (const { page, a: ea, b: eb } of expected) {
    expect(countOccurrences(page.text, t.brand)).toBe(page.labelCount)
    expect(countOccurrences(page.text, t.material)).toBe(page.labelCount)
    expect(countOccurrences(page.text, t.type)).toBe(page.labelCount)
    expect(countOccurrences(page.text, t.color)).toBe(page.labelCount)
    expect(countOccurrences(page.text, labelNeedle(color, a))).toBe(ea)
    expect(countOccurrences(page.text, labelNeedle(color, b))).toBe(eb)
  }
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
