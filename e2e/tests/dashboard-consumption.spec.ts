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
  // (empty -> loaded) re-render drops the hover, leaving the enhanced legend line unattached
  // (the short tests dodged it because they were fast; the longer tests did not).
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

// Parses a rendered legend value ("1.5 kg" -> 1500, "789 g" -> 789). Every value seeded in this
// file is display-lossless at two decimals, so the round-trip back to grams is exact.
function toGrams(value: string): number {
  const m = value.match(/^([\d.]+)\s*(kg|g)$/)
  expect(m, `unparseable legend value: ${value}`).not.toBeNull()
  const n = Number(m![1])
  return m![2] === 'kg' ? Math.round(n * 1000) : n
}

// The enhanced legend line (006): both entries carry their value and the date text — attached only
// while a day is highlighted — ends the line. The old 3-row readout box is gone from the markup.
interface LegendReadout {
  date: string
  totalGrams: number
  consumedGrams: number
}

async function readLegend(page: Page): Promise<LegendReadout> {
  const totalText = ((await page.getByTestId('legend-total').locator('text').textContent()) ?? '').trim()
  const consumedText = ((await page.getByTestId('legend-consumed').locator('text').textContent()) ?? '').trim()
  const dateText = ((await page.getByTestId('legend-date').textContent()) ?? '').trim()
  return {
    totalGrams: toGrams(totalText.replace(/^Total stock: /, '')),
    consumedGrams: toGrams(consumedText.replace(/^Consumed: /, '')),
    date: dateText.replace(/^—\s*/, ''),
  }
}

// Hover the day whose window index is `i` and read the enhanced legend line. An element-relative
// hover reliably drives the SVG hit-rect's onPointerMove (a raw mouse.jump can land before the
// pointer is tracked).
async function hoverAt(page: Page, i: number): Promise<LegendReadout> {
  const hit = page.getByTestId('plot-hit')
  const box = await hit.boundingBox()
  if (!box) throw new Error('plot-hit has no bounding box')
  // Inset a few px off the edges (see plotXY) so we never hover on the plot boundary.
  const inset = 5
  await hit.hover({ position: { x: inset + (box.width - 2 * inset) * (i / (WINDOW - 1)), y: box.height / 2 } })
  await expect(page.getByTestId('legend-date')).toBeVisible()
  return readLegend(page)
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

// Perceived luminance (0..1) of a CSS color — proves the legend ink follows var(--fg) (light on the
// dark theme, dark on the light one) rather than the SVG default black or a hardcoded white.
function luminance(cssColor: string): number {
  const m = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return 0
  const [, r, g, b] = m
  return (0.2126 * Number(r) + 0.7152 * Number(g) + 0.0722 * Number(b)) / 255
}

// The API's own 30-day window as ISO day strings — the single source of truth for the expected
// date labels, so the assertion does not re-derive the UTC date in JS (which would race at
// UTC midnight).
async function usageDays(page: Page): Promise<string[]> {
  const res = await page.request.get(`/api/dashboard/usage?days=${WINDOW}`)
  expect(res.ok()).toBeTruthy()
  const arr = (await res.json()) as { day: string }[]
  return arr.map(d => d.day)
}

// First and last day of the API's own 30-day window.
async function windowDays(page: Page): Promise<{ first: string; last: string }> {
  const days = await usageDays(page)
  return { first: days[0], last: days[WINDOW - 1] }
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
  expect(mid.totalGrams).toBe(0)
  expect(mid.consumedGrams).toBe(0)
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
  expect(before.totalGrams).toBe(0)

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
  expect(today.totalGrams).toBe(before.totalGrams + 1000)
  expect(today.consumedGrams).toBe(0)
  const earlier = await hoverAt(page, idx(5))
  expect(earlier.totalGrams).toBe(0)
  expect(earlier.consumedGrams).toBe(0)
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
  expect(before.totalGrams).toBe(1000)
  expect(before.consumedGrams).toBe(0)
  const onD = await hoverAt(page, idx(D))
  expect(onD.consumedGrams).toBe(300)
  expect(onD.totalGrams).toBe(700)
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.totalGrams).toBe(700)
  expect(today.consumedGrams).toBe(0)
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
  expect(before.totalGrams).toBe(1000)
  expect(before.consumedGrams).toBe(0)
  const onD = await hoverAt(page, idx(D))
  expect(onD.totalGrams).toBe(1250)
  expect(onD.consumedGrams).toBe(0)
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.totalGrams).toBe(1250)
  expect(today.consumedGrams).toBe(0)
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
  expect(before.totalGrams).toBe(1000)
  expect(before.consumedGrams).toBe(0)
  const onD = await hoverAt(page, idx(D))
  expect(onD.totalGrams).toBe(800)
  expect(onD.consumedGrams).toBe(0)
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.totalGrams).toBe(800)
  expect(today.consumedGrams).toBe(0)
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
  expect(before.totalGrams).toBe(400) // 1000 - 600, before the finish
  const onD = await hoverAt(page, idx(D))
  expect(onD.totalGrams).toBe(0) // finished: drops out of the stock line
  expect(onD.consumedGrams).toBe(0) // no print on the finish day
  const today = await hoverAt(page, WINDOW - 1)
  expect(today.totalGrams).toBe(0)
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
  expect((await hoverAt(page, idx(X))).totalGrams).toBe(700)
  expect((await hoverAt(page, WINDOW - 1)).totalGrams).toBe(700)

  // Undo the print.
  await page.goto(`/spools/UD9`)
  await printRow(page).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(printRow(page).getByRole('button', { name: 'Redo', exact: true })).toBeVisible()
  await openDashboard(page)
  const undone = await hoverAt(page, idx(X))
  expect(undone.totalGrams).toBe(1000)
  expect(undone.consumedGrams).toBe(0)
  expect((await hoverAt(page, WINDOW - 1)).totalGrams).toBe(1000)

  // Redo the print.
  await page.goto(`/spools/UD9`)
  await printRow(page).getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(printRow(page).getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  await openDashboard(page)
  const redone = await hoverAt(page, idx(X))
  expect(redone.totalGrams).toBe(700)
  expect(redone.consumedGrams).toBe(300)
  expect((await hoverAt(page, WINDOW - 1)).totalGrams).toBe(700)
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
  expect((await hoverAt(page, idx(D))).consumedGrams).toBe(300)
  expect((await hoverAt(page, WINDOW - 1)).totalGrams).toBe(1700)

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
  expect(dayD.consumedGrams).toBe(0)
  expect(dayD.totalGrams).toBe(0)
  expect((await hoverAt(page, WINDOW - 1)).totalGrams).toBe(0)
})

// (005 regression) — hover shows the dashed highlight and the enhanced legend line, updates day by
// day as the pointer moves, and reverts to the plain legend when the pointer leaves the plot.
test('hover highlights the day, updates as the pointer moves, and reverts the legend when it leaves', async ({ page }) => {
  await seedSpool({
    id: 'HV11',
    initialNetGrams: 500,
    createdAt: noonDaysAgo(10),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 10 })],
  })
  await openDashboard(page)

  const before = await hoverAt(page, idx(15)) // before creation
  expect(before.totalGrams).toBe(0)
  await expect(page.getByTestId('hover-highlight')).toBeAttached()
  await expect(page.getByTestId('legend-date')).toBeVisible()

  const after = await hoverAt(page, idx(9)) // after creation
  expect(after.totalGrams).toBe(500)
  await expect(page.getByTestId('hover-highlight')).toBeAttached()

  // Move the pointer to the wrapper's top-left corner (outside the plot) to fire pointer-leave.
  await page.getByTestId('consumption-chart').hover({ position: { x: 2, y: 2 } })
  // The highlight and the enhanced date are conditionally rendered: gone from the DOM once the
  // pointer leaves, and the legend is back to the plain two entries.
  await expect(page.getByTestId('hover-highlight')).not.toBeAttached()
  await expect(page.getByTestId('legend-date')).not.toBeAttached()
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock')
  await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed')
})

// (005 regression) — touch: tapping a day shows the enhanced legend line and the dashed highlight;
// tapping outside the plot reverts the legend to the plain two entries and hides the highlight.
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
    await expect(page.getByTestId('legend-date')).toBeVisible()
    await expect(page.getByTestId('hover-highlight')).toBeAttached()
    const t = await readLegend(page)
    expect(t.totalGrams).toBe(500)
    expect(t.consumedGrams).toBe(0)

    await page.touchscreen.tap(20, 20)
    await expect(page.getByTestId('legend-date')).not.toBeAttached()
    await expect(page.getByTestId('hover-highlight')).not.toBeAttached()
    await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock')
    await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed')
  } finally {
    await context.close()
  }
})

// AC-8 / T7 — live update: a consume in one context updates the enhanced legend line in a second
// context via the change stream, without a reload.
test('live update: the enhanced legend reflects a remote consume without reload', async ({ browser }) => {
  await seedSpool({
    id: 'LV7',
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
    expect(base.totalGrams).toBe(1000)
    expect(base.consumedGrams).toBe(0)

    // Open the sealed spool and record a 200 g print today, in context A.
    await pa.goto('/spools/LV7')
    await pa.getByRole('button', { name: 'Open spool' }).click()
    await expect(pa.getByLabel(/Grams used/)).toBeVisible()
    await pa.getByLabel(/Grams used/).fill('200')
    await pa.getByRole('button', { name: 'Consume', exact: true }).click()
    await expect(pa.locator('.spec:has-text("Remaining:")')).toContainText('800')

    // Context B must pick it up via the change stream, with no reload.
    await expect
      .poll(async () => {
        const l = await hoverAt(pb, WINDOW - 1)
        return l.totalGrams === 800 && l.consumedGrams === 200 ? 'ready' : 'pending'
      }, { timeout: 15000 })
      .toBe('ready')

    // Final state: the exact displayed strings for today in context B.
    const today = (await usageDays(pb))[WINDOW - 1]
    await expect(pb.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 800 g')
    await expect(pb.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed: 200 g')
    await expect(pb.getByTestId('legend-date')).toHaveText(`— ${fmtMD(today)}`)
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

// AC-1 / T1 — no day highlighted: exactly the two plain legend entries (no values, no date), and
// the removed 3-row readout box is not in the page markup at all.
test('no day highlighted: plain two-entry legend and no readout box in markup', async ({ page }) => {
  await openDashboard(page)

  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock')
  await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed')
  await expect(page.getByTestId('legend-date')).not.toBeAttached()
  expect(await page.locator('[data-testid="tooltip"]').count()).toBe(0)
})

// AC-2 / T2 — hovering merges both values and the day's date into one single legend line, in the
// order total/consumed/date, with both swatches still present, all on the same line, no box in markup.
test('hovering merges both values and the date into one single legend line', async ({ page }) => {
  // 1500 g spool, 150 g printed on its creation day D: D reads total 1350 g, consumed 150 g.
  await seedSpool({
    id: 'ON2',
    initialNetGrams: 1500,
    createdAt: noonDaysAgo(10),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Print', deltaGrams: -150, ago: 10 }),
    ],
  })
  await openDashboard(page)
  const i = idx(10)
  const day = (await usageDays(page))[i]

  const totalText = page.getByTestId('legend-total').locator('text')
  const consumedText = page.getByTestId('legend-consumed').locator('text')
  const dateText = page.getByTestId('legend-date')
  const r = await hoverAt(page, i)

  await expect(totalText).toHaveText('Total stock: 1.35 kg')
  await expect(consumedText).toHaveText('Consumed: 150 g')
  await expect(dateText).toHaveText(`— ${fmtMD(day)}`)
  expect(r.date).toBe(fmtMD(day))

  // Both swatches are still present…
  await expect(page.getByTestId('legend-total').locator('rect')).toBeAttached()
  await expect(page.getByTestId('legend-consumed').locator('rect')).toBeAttached()
  // …and all three texts sit on the same visual line (same top, within 1 px).
  const totalBox = await totalText.boundingBox()
  const consumedBox = await consumedText.boundingBox()
  const dateBox = await dateText.boundingBox()
  expect(totalBox).not.toBeNull()
  expect(consumedBox).not.toBeNull()
  expect(dateBox).not.toBeNull()
  expect(Math.abs(totalBox!.y - consumedBox!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(totalBox!.y - dateBox!.y)).toBeLessThanOrEqual(1)

  expect(await page.locator('[data-testid="tooltip"]').count()).toBe(0)
})

// AC-3 / T3 — unit thresholds on three isolated days (a create/finish ladder): whole grams below
// 1 kg; kilograms at 1 kg and above with trailing zeros dropped.
test('unit thresholds: whole grams below 1 kg, kilograms with dropped trailing zeros at 1 kg and above', async ({ page }) => {
  await seedSpool({
    id: 'UT1',
    initialNetGrams: 789,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Finished', deltaGrams: 0, ago: 15 }),
    ],
  })
  await seedSpool({
    id: 'UT2',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(15),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 15 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 15 }),
      ev({ kind: 'Finished', deltaGrams: 0, ago: 10 }),
    ],
  })
  await seedSpool({
    id: 'UT3',
    initialNetGrams: 1500,
    createdAt: noonDaysAgo(10),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 10 }),
    ],
  })
  await openDashboard(page)

  await hoverAt(page, idx(20))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 789 g')
  await hoverAt(page, idx(15))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 1 kg')
  await hoverAt(page, idx(10))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 1.5 kg')
})

// AC-4 / T4 — consumed shows whole grams; a print-free day reads "0 g".
test('consumed shows whole grams and a print-free day reads 0 g', async ({ page }) => {
  const D = 10
  await seedSpool({
    id: 'CG4',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Print', deltaGrams: -150, ago: D }),
    ],
  })
  await openDashboard(page)

  await hoverAt(page, idx(D))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 850 g')
  await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed: 150 g')

  await hoverAt(page, idx(D + 1))
  await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed: 0 g')
})

// AC-5 + AC-7 / T5 — the enhanced legend (and the dashed highlight) follow the pointer day by day,
// and the legend reverts to the plain two entries when the pointer leaves the plot. The entries
// themselves sit in fixed slots: highlighting a day must never move them (006 user request).
test('the enhanced legend follows the pointer day by day and reverts to plain on leave', async ({ page }) => {
  await seedSpool({
    id: 'MW5',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(15),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 15 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 15 }),
    ],
  })
  await openDashboard(page)
  const days = await usageDays(page)

  // Plain state: record where the two legend entries sit before anything is highlighted.
  const plainTotalSwatch = await page.getByTestId('legend-total').locator('rect').boundingBox()
  const plainConsumedSwatch = await page.getByTestId('legend-consumed').locator('rect').boundingBox()
  expect(plainTotalSwatch).not.toBeNull()
  expect(plainConsumedSwatch).not.toBeNull()

  const before = await hoverAt(page, idx(20)) // before creation
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 0 g')
  expect(before.date).toBe(fmtMD(days[idx(20)]))
  await expect(page.getByTestId('hover-highlight')).toBeAttached()

  // Enhanced state: only the values and the date appeared — the entries stayed put.
  expect(Math.abs((await page.getByTestId('legend-total').locator('rect').boundingBox())!.x - plainTotalSwatch!.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs((await page.getByTestId('legend-consumed').locator('rect').boundingBox())!.x - plainConsumedSwatch!.x)).toBeLessThanOrEqual(0.5)

  const after = await hoverAt(page, idx(10)) // after creation
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 1 kg')
  expect(after.date).toBe(fmtMD(days[idx(10)]))
  await expect(page.getByTestId('hover-highlight')).toBeAttached()

  // Move the pointer to the wrapper's top-left corner (outside the plot) to fire pointer-leave:
  // the legend reverts to the plain two entries and the highlight detaches.
  await page.getByTestId('consumption-chart').hover({ position: { x: 2, y: 2 } })
  await expect(page.getByTestId('legend-date')).not.toBeAttached()
  await expect(page.getByTestId('hover-highlight')).not.toBeAttached()
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock')
  await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed')
})

// AC-6 + AC-7 / T6 — on touch: tapping a day shows the enhanced single-line legend (values, date,
// dashed highlight); tapping outside the plot reverts to the plain legend and hides the highlight.
test('on touch: tapping a day shows the enhanced legend line; tapping outside reverts', async ({ browser }) => {
  await seedSpool({
    id: 'TC6',
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
    await expect(page.getByTestId('legend-date')).toBeVisible()
    await expect(page.getByTestId('hover-highlight')).toBeAttached()
    await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 500 g')
    await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed: 0 g')
    const t = await readLegend(page)
    expect(t.totalGrams).toBe(500)
    expect(t.consumedGrams).toBe(0)

    await page.touchscreen.tap(20, 20)
    await expect(page.getByTestId('legend-date')).not.toBeAttached()
    await expect(page.getByTestId('hover-highlight')).not.toBeAttached()
    await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock')
    await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed')
  } finally {
    await context.close()
  }
})

// Computed (rendered) colors of the enhanced legend line, plus the resolved theme tokens --fg and
// --muted (resolved through a detached probe so both sides are in the same rgb() format).
function enhancedLegendColors(page: Page) {
  return page.evaluate(() => {
    const resolved = (name: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      document.body.appendChild(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    }
    const fill = (selector: string) => getComputedStyle(document.querySelector(selector)!).fill
    return {
      total: fill('[data-testid="legend-total"] text'),
      consumed: fill('[data-testid="legend-consumed"] text'),
      date: fill('[data-testid="legend-date"]'),
      swatchTotal: fill('[data-testid="legend-total"] rect'),
      swatchConsumed: fill('[data-testid="legend-consumed"] rect'),
      lineTotal: getComputedStyle(document.querySelector('[data-testid="line-total"]')!).stroke,
      lineConsumed: getComputedStyle(document.querySelector('[data-testid="line-consumed"]')!).stroke,
      fg: resolved('--fg'),
      muted: resolved('--muted'),
    }
  })
}

// AC-9 / T8 — the enhanced legend line is legible in both themes: its labels follow var(--fg), the
// date follows var(--muted), and the swatches keep their line colors (no hardcoded black/white).
test('the enhanced legend line is legible in light and dark theme', async ({ browser, page }, testInfo) => {
  // 1 000 g spool with a 150 g print on its creation day, so the enhanced line carries both values.
  await seedSpool({
    id: 'TH8',
    initialNetGrams: 1000,
    createdAt: noonDaysAgo(10),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Print', deltaGrams: -150, ago: 10 }),
    ],
  })

  // Dark theme.
  const dark = await browser.newContext({ colorScheme: 'dark' })
  const dp = await dark.newPage()
  try {
    await openDashboard(dp)
    await hoverAt(dp, idx(10))
    const d = await enhancedLegendColors(dp)
    expect(d.total, 'legend ink must equal the resolved dark-theme --fg').toBe(d.fg)
    expect(d.consumed).toBe(d.fg)
    expect(luminance(d.total), 'legend ink must be light on the dark theme').toBeGreaterThan(0.5)
    expect(d.date, 'legend date must equal the resolved dark-theme --muted').toBe(d.muted)
    expect(d.swatchTotal).toBe(d.lineTotal)
    expect(d.swatchConsumed).toBe(d.lineConsumed)
    // Evidence: a dark-theme screenshot (the global harness captures the default/light page only).
    if (process.env.PLAYWRIGHT_CAPTURE_EVIDENCE !== '0' && testInfo.status !== 'skipped') {
      await dp.screenshot({ path: testInfo.outputPath('dark-mode-enhanced-legend.png') })
    }
  } finally {
    await dark.close()
  }

  // Light theme (the default page context).
  await openDashboard(page)
  await hoverAt(page, idx(10))
  const l = await enhancedLegendColors(page)
  expect(l.total, 'legend ink must equal the resolved light-theme --fg').toBe(l.fg)
  expect(l.consumed).toBe(l.fg)
  expect(luminance(l.total), 'legend ink must be dark on the light theme').toBeLessThan(0.5)
  expect(l.date, 'legend date must equal the resolved light-theme --muted').toBe(l.muted)
  expect(l.swatchTotal).toBe(l.lineTotal)
  expect(l.swatchConsumed).toBe(l.lineConsumed)
})

// AC-10 / T9 — at a 375 px wide viewport the enhanced legend stays on one line, fully inside the
// chart, without scrolling the page.
test('at 375 px the enhanced legend stays on one line without page overflow', async ({ page }) => {
  // 1 500 g spool, 150 g printed on its creation day — the same values as T2 for direct comparison.
  await seedSpool({
    id: 'NW9',
    initialNetGrams: 1500,
    createdAt: noonDaysAgo(10),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Print', deltaGrams: -150, ago: 10 }),
    ],
  })
  await page.setViewportSize({ width: 375, height: 800 })
  await openDashboard(page)

  await hoverAt(page, idx(10))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 1.35 kg')
  await expect(page.getByTestId('legend-consumed').locator('text')).toHaveText('Consumed: 150 g')

  // No horizontal overflow of the page.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)

  // The three texts share one line, and the date stays inside the chart.
  const chartBox = await page.getByTestId('consumption-chart').boundingBox()
  const totalBox = await page.getByTestId('legend-total').locator('text').boundingBox()
  const consumedBox = await page.getByTestId('legend-consumed').locator('text').boundingBox()
  const dateBox = await page.getByTestId('legend-date').boundingBox()
  expect(chartBox).not.toBeNull()
  expect(totalBox).not.toBeNull()
  expect(consumedBox).not.toBeNull()
  expect(dateBox).not.toBeNull()
  expect(Math.abs(totalBox!.y - consumedBox!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(totalBox!.y - dateBox!.y)).toBeLessThanOrEqual(1)
  expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(chartBox!.x + chartBox!.width)
})

// AC-11 / T10 — kilogram rounding is half up, including the exact tie: 1 015 g must read "1.02 kg"
// (never "1.01 kg"). Four isolated days via a create/finish ladder: 2 345 / 1 015 / 1 014 / 1 010 g.
test('kilogram rounding is half up (1015 g becomes 1.02 kg, 2345 g becomes 2.35 kg)', async ({ page }) => {
  await seedSpool({
    id: 'RH1',
    initialNetGrams: 2345,
    createdAt: noonDaysAgo(20),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 20 }),
      ev({ kind: 'Finished', deltaGrams: 0, ago: 15 }),
    ],
  })
  await seedSpool({
    id: 'RH2',
    initialNetGrams: 1015,
    createdAt: noonDaysAgo(15),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 15 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 15 }),
      ev({ kind: 'Finished', deltaGrams: 0, ago: 10 }),
    ],
  })
  await seedSpool({
    id: 'RH3',
    initialNetGrams: 1014,
    createdAt: noonDaysAgo(10),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Finished', deltaGrams: 0, ago: 5 }),
    ],
  })
  await seedSpool({
    id: 'RH4',
    initialNetGrams: 1010,
    createdAt: noonDaysAgo(5),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 5 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 5 }),
    ],
  })
  await openDashboard(page)

  await hoverAt(page, idx(20))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 2.35 kg')
  await hoverAt(page, idx(15))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 1.02 kg')
  await hoverAt(page, idx(10))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 1.01 kg')
  await hoverAt(page, idx(5))
  await expect(page.getByTestId('legend-total').locator('text')).toHaveText('Total stock: 1.01 kg')
})
