import { test, expect, type Page } from '@playwright/test'
import { resetInventory, seedSpool, seedType, type SeedEvent } from './fixtures/db'

// Every test starts from — and leaves — a clean database so the spec is self-isolating and does not
// poison the "fresh database" smoke assertion or any later spec within the same run.
test.beforeEach(async () => {
  await resetInventory()
})
test.afterEach(async () => {
  await resetInventory()
})

const WINDOW = 30
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMD(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return iso
  return `${MONTHS[m - 1]} ${d}`
}

// A date at UTC noon `n` days before today — safely mid-day so there is no UTC-day boundary ambiguity.
function noonDaysAgo(n: number): Date {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

// Window index (0..29) of the day that is `n` days before today. index 29 == today.
function idx(daysAgo: number): number {
  return (WINDOW - 1) - daysAgo
}

const ev = (part: { kind: SeedEvent['kind']; deltaGrams: number; ago: number }): SeedEvent => ({
  kind: part.kind,
  deltaGrams: part.deltaGrams,
  occurredAt: noonDaysAgo(part.ago),
})

// Gate on the wrapper div (always a visible HTML box) rather than a polyline: a flat/zero-height
// line is reported "hidden" by Playwright, which is the expected state for an empty window.
async function openDashboard(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('consumption-chart')).toBeVisible()
  // The 30-day series loads asynchronously; the x-axis date labels only render once it has, so this
  // is a reliable "data is in" gate. Without it, hovering an empty chart races the fetch and the
  // (empty -> loaded) re-render drops the hover, leaving the tooltip unattached (AC-2/AC-11 dodged
  // it because they were fast; the longer tests did not).
  await expect(page.getByTestId('x-axis').locator('text').first()).toBeVisible()
}

async function plotXY(page: Page, i: number) {
  const box = await page.getByTestId('plot-hit').boundingBox()
  if (!box) throw new Error('plot-hit has no bounding box')
  // Inset a few px off the edges so the point never sits on the plot boundary (where a decorative
  // stroke can win the hit-test).
  const inset = 5
  return { x: box.x + inset + (box.width - 2 * inset) * (i / (WINDOW - 1)), y: box.y + box.height / 2 }
}

interface Tip { date: string; total: number; consumed: number }

async function readTooltip(page: Page): Promise<Tip> {
  const tip = page.getByTestId('tooltip').locator('text')
  const totalLine = ((await tip.nth(1).textContent()) ?? '').trim()
  const consumedLine = ((await tip.nth(2).textContent()) ?? '').trim()
  return {
    date: ((await tip.nth(0).textContent()) ?? '').trim(),
    total: Number(totalLine.match(/(\d+)\s*g$/)?.[1]),
    consumed: Number(consumedLine.match(/(\d+)\s*g$/)?.[1]),
  }
}

// Hover the day whose window index is `i` and read its tooltip. An element-relative hover reliably
// drives the SVG hit-rect's onPointerMove (a raw mouse.jump can land before the pointer is tracked).
async function hoverAt(page: Page, i: number): Promise<Tip> {
  const hit = page.getByTestId('plot-hit')
  const box = await hit.boundingBox()
  if (!box) throw new Error('plot-hit has no bounding box')
  // Inset a few px off the edges (see plotXY) so we never hover on the plot boundary.
  const inset = 5
  await hit.hover({ position: { x: inset + (box.width - 2 * inset) * (i / (WINDOW - 1)), y: box.height / 2 } })
  await expect(page.getByTestId('tooltip')).toBeVisible()
  return readTooltip(page)
}

async function axisValue(page: Page, testid: string): Promise<number> {
  const raw = ((await page.getByTestId(testid).textContent()) ?? '').trim()
  return Number.parseFloat(raw.replace(' kg', ''))
}

// Number of ruler ticks rendered on an axis (the "axis-left" / "axis-right" groups hold all tick
// labels). Both axes must render 3–6 ticks and the two counts must differ so the dotted grids never
// alias on the same rows (amendment: dotted kg rulers).
async function tickCount(page: Page, side: 'left' | 'right'): Promise<number> {
  return Number(await page.getByTestId(`axis-${side}`).locator('text').count())
}

// Perceived luminance (0..1) of a CSS color — proves the legend ink is light (var(--fg)) on the dark
// theme rather than the invisible SVG default black.
function luminance(cssColor: string): number {
  const m = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return 0
  const [, r, g, b] = m
  return (0.2126 * Number(r) + 0.7152 * Number(g) + 0.0722 * Number(b)) / 255
}

// First and last day of the API's own 30-day window — the single source of truth for the x labels,
// so the assertion does not re-derive the UTC date in JS (which would race at UTC midnight).
async function windowDays(page: Page): Promise<{ first: string; last: string }> {
  const res = await page.request.get('/api/dashboard/usage?days=30')
  expect(res.ok()).toBeTruthy()
  const arr = (await res.json()) as { day: string }[]
  return { first: arr[0].day, last: arr[WINDOW - 1].day }
}

// The (print) history row in SpoolDetail, identified by its kind badge.
function printRow(page: Page) {
  return page.locator('tbody tr').filter({ has: page.locator('.ev--print') })
}

// AC-1 — legend: exactly two entries, each swatch the same color as its line, the two lines differ.
test('legend lists both lines with matching, different colors', async ({ page }) => {
  await openDashboard(page)
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock')
  await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed')

  const swTotal = await page.getByTestId('legend-total').locator('rect').getAttribute('fill')
  const swConsumed = await page.getByTestId('legend-consumed').locator('rect').getAttribute('fill')
  const lineTotal = await page.getByTestId('line-total').getAttribute('stroke')
  const lineConsumed = await page.getByTestId('line-consumed').getAttribute('stroke')
  expect(swTotal).toBe(lineTotal)
  expect(swConsumed).toBe(lineConsumed)
  expect(lineTotal).not.toBe(lineConsumed)
})

// AC-1 (theme) — the chart follows the page theme: the legend ink is light (var(--fg)) on the dark
// background instead of the invisible SVG default black, and each y-axis kg label is painted in its
// line's own color (amendment: dotted kg rulers in each axis' line color).
test('legend ink is legible in dark mode and kg labels match their line color', async ({ browser }, testInfo) => {
  await seedSpool({
    id: 'DARK1',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(5),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 5 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 5 }),
    ],
  })
  const dark = await browser.newContext({ colorScheme: 'dark' })
  const dp = await dark.newPage()
  await dp.goto('/')

  // The legend text uses the theme ink, so on the dark theme it renders light, not black.
  const legendText = dp.getByTestId('legend-total').locator('text')
  await expect(legendText).toBeAttached()
  const legendFill = await legendText.evaluate(el => getComputedStyle(el).fill)
  expect(luminance(legendFill), `legend ink ${legendFill} must be light on the dark theme`).toBeGreaterThan(0.5)

  // Computed (rendered) colors, not attribute strings: each kg label equals its data line's color,
  // and the legend swatch equals its line.
  const totalStroke = await dp.getByTestId('line-total').evaluate(el => getComputedStyle(el).stroke)
  expect(await dp.getByTestId('legend-total').locator('rect').evaluate(el => getComputedStyle(el).fill),
    'legend swatch must equal the total-stock line color').toBe(totalStroke)
  expect(await dp.getByTestId('axis-left-top').evaluate(el => getComputedStyle(el).fill),
    'left kg label must equal the total-stock line color').toBe(totalStroke)
  const consumedStroke = await dp.getByTestId('line-consumed').evaluate(el => getComputedStyle(el).stroke)
  expect(await dp.getByTestId('axis-right-top').evaluate(el => getComputedStyle(el).fill),
    'right kg label must equal the consumed line color').toBe(consumedStroke)

  // Evidence: a dark-theme screenshot (the global harness captures the default/light page only).
  if (process.env.PLAYWRIGHT_CAPTURE_EVIDENCE !== '0' && testInfo.status !== 'skipped') {
    await dp.screenshot({ path: testInfo.outputPath('dark-mode.png') })
  }

  await dark.close()
})

// AC-2 — zero spools: 30 zero days, window-labeled x axis, both axes 0..1000.
test('with no spools the window is 30 zero days and both axes read 0 and 1000', async ({ page }) => {
  await openDashboard(page)
  const { first, last } = await windowDays(page)

  const labels = page.getByTestId('x-axis').locator('text')
  const count = await labels.count()
  expect(count).toBeGreaterThanOrEqual(6)
  expect(count).toBeLessThanOrEqual(8)
  await expect(labels.nth(0)).toHaveText(fmtMD(first))
  await expect(labels.nth(count - 1)).toHaveText(fmtMD(last))

  // Empty window: each axis floors at 1 kg, so both read 0 at the bottom and 1 kg at the top.
  expect(await axisValue(page, 'axis-left-top')).toBe(1)
  expect(await axisValue(page, 'axis-right-top')).toBe(1)
  expect(await axisValue(page, 'axis-left-zero')).toBe(0)
  expect(await axisValue(page, 'axis-right-zero')).toBe(0)

  // Dotted kg rulers: 3–6 ticks per axis, and the two counts differ so the grids don't alias.
  const lc = await tickCount(page, 'left')
  const rc = await tickCount(page, 'right')
  expect(lc).toBeGreaterThanOrEqual(3)
  expect(lc).toBeLessThanOrEqual(6)
  expect(rc).toBeGreaterThanOrEqual(3)
  expect(rc).toBeLessThanOrEqual(6)
  expect(lc).not.toBe(rc)

  const mid = await hoverAt(page, Math.floor((WINDOW - 1) / 2))
  expect(mid.total).toBe(0)
  expect(mid.consumed).toBe(0)
})

// AC-3 — each axis tops out at a *nice* kilogram value (a meaningful multiple >= the window max,
// floored at 1 kg) rather than the old max*1.05; the two axes use different tick counts.
test('axis top values snap to meaningful kilogram rulers', async ({ page }) => {
  // Window max: total stock M = 3800 g (3.8 kg, before the print), consumed N = 1500 g (1.5 kg).
  await seedSpool({
    id: 'AX1',
    initialNetGrams: 3800,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Print', deltaGrams: -1500, ago: 10 }),
    ],
  })
  await openDashboard(page)
  expect(await axisValue(page, 'axis-left-top')).toBe(4) // 3.8 kg -> next nice multiple 4 kg
  expect(await axisValue(page, 'axis-right-top')).toBe(1.5) // 1.5 kg -> 1.5 kg (already a nice step)

  const lc = await tickCount(page, 'left')
  const rc = await tickCount(page, 'right')
  expect(lc).toBe(5) // 0,1,2,3,4 kg
  expect(rc).toBe(4) // 0,0.5,1,1.5 kg (avoids the left axis' count)
  expect(lc).not.toBe(rc)
})

// AC-4 — creating a 1000 g spool through the normal UI flow lifts only today; consumed is untouched.
test('creating a 1000 g spool in the UI raises only today and leaves consumed unchanged', async ({ page }) => {
  await seedType({ id: 'T4A', defaultNetWeightGrams: 1000 })

  await openDashboard(page)
  const before = await hoverAt(page, WINDOW - 1)
  expect(before.total).toBe(0)

  await page.goto('/spools')
  await page.getByRole('button', { name: 'New spool' }).click()
  const form = page.locator('form.card')
  await form.getByLabel('Filament type').selectOption('T4A')
  await form.getByLabel(/Initial net/).fill('1000')
  await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/spools') && r.request().method() === 'POST'),
    form.getByRole('button', { name: 'Create', exact: true }).click(),
  ])

  await openDashboard(page)
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.total).toBe(before.total + 1000)
  expect(today.consumed).toBe(0)
  const earlier = await hoverAt(page, idx(5))
  expect(earlier.total).toBe(0)
  expect(earlier.consumed).toBe(0)
})

// AC-5 — a 300 g print on a past day D sets consumed there and lowers stock from D onward.
test('a 300 g print recorded on a past day D sets consumed there and lowers stock from D on', async ({ page }) => {
  const D = 10
  await seedSpool({
    id: 'PR5',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Print', deltaGrams: -300, ago: D }),
    ],
  })
  await openDashboard(page)

  const before = await hoverAt(page, idx(D + 1))
  expect(before.total).toBe(1000)
  expect(before.consumed).toBe(0)
  const onD = await hoverAt(page, idx(D))
  expect(onD.consumed).toBe(300)
  expect(onD.total).toBe(700)
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.total).toBe(700)
  expect(today.consumed).toBe(0)
})

// AC-6 — a +250 g adjustment on a past day D raises stock from D on, consumed unchanged.
test('a +250 g adjustment on a past day D raises stock from D on and leaves consumed unchanged', async ({ page }) => {
  const D = 10
  await seedSpool({
    id: 'AJ6',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Adjustment', deltaGrams: 250, ago: D }),
    ],
  })
  await openDashboard(page)

  const before = await hoverAt(page, idx(D + 1))
  expect(before.total).toBe(1000)
  expect(before.consumed).toBe(0)
  const onD = await hoverAt(page, idx(D))
  expect(onD.total).toBe(1250)
  expect(onD.consumed).toBe(0)
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.total).toBe(1250)
  expect(today.consumed).toBe(0)
})

// AC-7 — a -200 g adjustment on a past day D lowers stock from D on, consumed unchanged.
test('a -200 g adjustment on a past day D lowers stock from D on and leaves consumed unchanged', async ({ page }) => {
  const D = 10
  await seedSpool({
    id: 'DJ7',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Adjustment', deltaGrams: -200, ago: D }),
    ],
  })
  await openDashboard(page)

  const before = await hoverAt(page, idx(D + 1))
  expect(before.total).toBe(1000)
  expect(before.consumed).toBe(0)
  const onD = await hoverAt(page, idx(D))
  expect(onD.total).toBe(800)
  expect(onD.consumed).toBe(0)
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.total).toBe(800)
  expect(today.consumed).toBe(0)
})

// AC-8 — finishing a spool on day D (with 400 g remaining) zeroes stock from D on; consumed on D stays.
test('finishing a spool on day D zeroes stock from D on while consumed on D is unchanged', async ({ page }) => {
  const D = 10
  await seedSpool({
    id: 'FN8',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Print', deltaGrams: -600, ago: 14 }),
      ev({ kind: 'Finished', deltaGrams: 0, ago: D }),
    ],
  })
  await openDashboard(page)

  const before = await hoverAt(page, idx(D + 1))
  expect(before.total).toBe(400) // 1000 - 600, before the finish
  const onD = await hoverAt(page, idx(D))
  expect(onD.total).toBe(0) // finished: drops out of the stock line
  expect(onD.consumed).toBe(0) // no print on the finish day
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.total).toBe(0)
})

// AC-9 — undoing then redoing a 300 g print on day X via the UI moves consumed and stock together.
test('undoing then redoing a 300 g print on day X via the UI moves the graph accordingly', async ({ page }) => {
  const X = 10
  await seedSpool({
    id: 'UD9',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Print', deltaGrams: -300, ago: X }),
    ],
  })
  await openDashboard(page)
  expect((await hoverAt(page, idx(X))).total).toBe(700)
  expect((await hoverAt(page, WINDOW - 1)).total).toBe(700)

  // Undo the print.
  await page.goto(`/spools/UD9`)
  await printRow(page).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(printRow(page).getByRole('button', { name: 'Redo', exact: true })).toBeVisible()
  await openDashboard(page)
  const undone = await hoverAt(page, idx(X))
  expect(undone.total).toBe(1000)
  expect(undone.consumed).toBe(0)
  expect((await hoverAt(page, WINDOW - 1)).total).toBe(1000)

  // Redo the print.
  await page.goto(`/spools/UD9`)
  await printRow(page).getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(printRow(page).getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  await openDashboard(page)
  const redone = await hoverAt(page, idx(X))
  expect(redone.total).toBe(700)
  expect(redone.consumed).toBe(300)
  expect((await hoverAt(page, WINDOW - 1)).total).toBe(700)
})

// AC-10 — deleting a spool through the UI removes all of its contribution from the graph.
test('deleting a spool via the UI removes all of its contribution from the graph', async ({ page }) => {
  const D = 6
  await seedSpool({
    id: 'DL10',
    initialNetGrams: 2000,
    createdAt: noonDaysAgo(12),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 12 }),
      ev({ kind: 'Print', deltaGrams: -300, ago: D }),
    ],
  })
  await openDashboard(page)
  expect((await hoverAt(page, idx(D))).consumed).toBe(300)
  expect((await hoverAt(page, WINDOW - 1)).total).toBe(1700)

  await page.goto(`/spools/DL10`)
  const del = page.getByTestId('delete-spool')
  // Locked while the (non-creation) print is still active.
  await expect(del).toBeDisabled()
  await expect(del).toHaveAttribute('title', 'A spool can be deleted only when all of its events have been disabled.')

  // Undo the print so only the Created event remains active -> delete unlocks.
  await printRow(page).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(printRow(page).getByRole('button', { name: 'Redo', exact: true })).toBeVisible()
  await expect(del).toBeEnabled()

  // Confirm the native dialog, then verify the graph no longer shows the spool.
  page.on('dialog', d => d.accept())
  await del.click()
  // The Spools list normalizes its URL to append a `?sort=` query, so match the path (not just the
  // bare word at the very end).
  await expect(page).toHaveURL(/\/spools(\?.*)?$/)

  await openDashboard(page)
  const dayD = await hoverAt(page, idx(D))
  expect(dayD.consumed).toBe(0)
  expect(dayD.total).toBe(0)
  expect((await hoverAt(page, WINDOW - 1)).total).toBe(0)
})

// AC-11 — hover shows a highlight + tooltip, updates as the pointer moves, and hides when it leaves.
test('hover highlights the day, updates as the pointer moves, and hides when the pointer leaves', async ({ page }) => {
  await seedSpool({
    id: 'HV11',
    initialNetGrams: 500,
    createdAt: noonDaysAgo(10),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 10 })],
  })
  await openDashboard(page)

  const before = await hoverAt(page, idx(15)) // before creation
  expect(before.total).toBe(0)
  await expect(page.getByTestId('hover-highlight')).toBeAttached()
  await expect(page.getByTestId('tooltip')).toBeVisible()

  const after = await hoverAt(page, idx(9)) // after creation
  expect(after.total).toBe(500)
  await expect(page.getByTestId('hover-highlight')).toBeAttached()

  // Move the pointer to the wrapper's top-left corner (outside the plot) to fire pointer-leave.
  await page.getByTestId('consumption-chart').hover({ position: { x: 2, y: 2 } })
  // The highlight/tooltip are conditionally rendered: gone from the DOM once the pointer leaves.
  await expect(page.getByTestId('hover-highlight')).not.toBeAttached()
  await expect(page.getByTestId('tooltip')).not.toBeAttached()
})

// AC-12 — touch: tapping a day shows its values; tapping elsewhere hides them.
test('on touch, tapping a day shows its values and tapping elsewhere hides them', async ({ browser }) => {
  await seedSpool({
    id: 'TC12',
    initialNetGrams: 500,
    createdAt: noonDaysAgo(10),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 10 })],
  })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    await openDashboard(page)
    const { x, y } = await plotXY(page, idx(8)) // 8 days ago, after creation
    await page.touchscreen.tap(x, y)
    await expect(page.getByTestId('tooltip')).toBeVisible()
    const t = await readTooltip(page)
    expect(t.total).toBe(500)
    expect(t.consumed).toBe(0)

    await page.touchscreen.tap(20, 20)
    await expect(page.getByTestId('tooltip')).toBeHidden()
  } finally {
    await context.close()
  }
})

// AC-13 — a consume in one context updates the graph in a second context live, without a reload.
test('a consume in one context updates the graph live in a second context (no reload)', async ({ browser }) => {
  await seedSpool({
    id: 'LV13',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(5),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 5 })],
  })
  const a = await browser.newContext(); const pa = await a.newPage()
  const b = await browser.newContext(); const pb = await b.newPage()
  try {
    await openDashboard(pa)
    await openDashboard(pb)

    const base = await hoverAt(pb, WINDOW - 1)
    expect(base.total).toBe(1000)
    expect(base.consumed).toBe(0)

    // Open the sealed spool and record a 200 g print today, in context A.
    await pa.goto('/spools/LV13')
    await pa.getByRole('button', { name: 'Open spool' }).click()
    await expect(pa.getByLabel(/Grams used/)).toBeVisible()
    await pa.getByLabel(/Grams used/).fill('200')
    await pa.getByRole('button', { name: 'Consume', exact: true }).click()
    await expect(pa.locator('.spec:has-text("Remaining:")')).toContainText('800')

    // Context B must pick it up via the change stream, with no reload.
    await expect
      .poll(async () => {
        const t = await hoverAt(pb, WINDOW - 1)
        return t.total === 800 && t.consumed === 200 ? 'ready' : 'pending'
      }, { timeout: 15000 })
      .toBe('ready')
  } finally {
    await a.close()
    await b.close()
  }
})

// AC-14 — no leftover "... g total" summary text remains anywhere on the dashboard.
test('no leftover "… g total" summary text remains on the dashboard', async ({ page }) => {
  await seedSpool({
    id: 'GT14',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(15),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 15 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 15 }),
      ev({ kind: 'Print', deltaGrams: -400, ago: 3 }),
    ],
  })
  await openDashboard(page)
  await expect(page.locator('body')).not.toContainText(/\d+\s*g total/)
})

// AC-15 — at 375px the chart renders without horizontal overflow; the legend is visible and the
// x axis keeps 6-8 labels.
test('at 375px the chart renders without horizontal overflow, legend visible, 6-8 labels', async ({ page }) => {
  await seedSpool({
    id: 'NB15',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Print', deltaGrams: -250, ago: 4 }),
    ],
  })
  await page.setViewportSize({ width: 375, height: 800 })
  await openDashboard(page)

  const box = await page.getByTestId('consumption-chart').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(scrollable).toBe(false)

  await expect(page.getByTestId('legend-total')).toBeVisible()
  await expect(page.getByTestId('legend-consumed')).toBeVisible()

  const labelCount = await page.getByTestId('x-axis').locator('text').count()
  expect(labelCount).toBeGreaterThanOrEqual(6)
  expect(labelCount).toBeLessThanOrEqual(8)
})
