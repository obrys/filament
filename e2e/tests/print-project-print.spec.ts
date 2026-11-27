import { test, expect, type Page } from '@playwright/test'
import {
  resetInventory, seedSpool, seedType, seedPrintProject, seedProjectPrint,
  type SeedEvent,
} from './fixtures/db'

test.beforeEach(async () => {
  await resetInventory()
})
test.afterEach(async () => {
  await resetInventory()
})

function ago(n: number): Date {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

const ev = (part: { kind: SeedEvent['kind']; deltaGrams: number; ago: number }): SeedEvent => ({
  kind: part.kind,
  deltaGrams: part.deltaGrams,
  occurredAt: ago(part.ago),
})

// The fixture: type TA (red PLA) and TB (blue PETG);
// SA open 1000 g (TA), SB sealed 1000 g (TA), SC finished 500 g left (TA), SD open 1000 g (TB);
// project PP with TA 100 g + TB 50 g.
const PROJECT = 'PPR'
async function seedFixture() {
  await seedType({ id: 'TA', brand: 'AlphaBrand', material: 'PLA', type: 'Smooth', color: 'Red' })
  await seedType({ id: 'TB', brand: 'BetaBrand', material: 'PETG', type: 'Basic', color: 'Blue' })
  await seedSpool({
    id: 'SA', typeId: 'TA', initialNetGrams: 1000, createdAt: ago(6),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 6 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 6 })],
  })
  await seedSpool({
    id: 'SB', typeId: 'TA', initialNetGrams: 1000, createdAt: ago(6),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 6 })],
  })
  await seedSpool({
    id: 'SC', typeId: 'TA', initialNetGrams: 1000, createdAt: ago(10),
    events: [
      ev({ kind: 'Created', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Opened', deltaGrams: 0, ago: 10 }),
      ev({ kind: 'Print', deltaGrams: -500, ago: 8 }),
      ev({ kind: 'Finished', deltaGrams: 0, ago: 4 }),
    ],
  })
  await seedSpool({
    id: 'SD', typeId: 'TB', initialNetGrams: 1000, createdAt: ago(6),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 6 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 6 })],
  })
  await seedPrintProject({
    id: PROJECT, title: 'Benchy', url: 'https://example.com/benchy', createdAt: ago(2),
    types: [{ typeId: 'TA', grams: 100 }, { typeId: 'TB', grams: 50 }],
  })
}

async function spoolById(page: Page, id: string): Promise<{ remainingGrams: number; status: string }> {
  const res = await page.request.get(`/api/spools/${id}`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as { remainingGrams: number; status: string }
}

// Polls the spool until a predicate holds — a mutation issued from a click may still be in
// flight when the click resolves, so raw reads must not run on a single shot.
async function spoolWhen(page: Page, id: string, pred: (s: { remainingGrams: number; status: string }) => boolean) {
  for (let i = 0; i < 40; i++) {
    const s = await spoolById(page, id)
    if (pred(s)) return s
    await page.waitForTimeout(250)
  }
  throw new Error(`spool ${id} never reached the expected state`)
}

async function printCount(page: Page): Promise<number> {
  const res = await page.request.get(`/api/print-projects/${PROJECT}`)
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { prints: unknown[] | null }
  return body.prints?.length ?? 0
}

// The slot for the i-th defined type (0-based).
function slot(page: Page, i: number) {
  return page.getByTestId('project-slot').nth(i)
}

// The grams input of a slot, labelled by its filament type id.
function slotGrams(page: Page, i: number, typeId: string) {
  return slot(page, i).getByLabel(`Grams for ${typeId}`)
}

// Choose a spool in the slot's own list by its id pill.
async function pickFromSlot(page: Page, i: number, spoolId: string) {
  await slot(page, i).getByRole('button', { name: `Select spool ${spoolId}` }).click()
}

// The "Other spools" dialogue for a slot; returns the dialogue and closes it on scope end.
async function otherSpools(page: Page, i: number) {
  await slot(page, i).getByRole('button', { name: 'Other spools' }).click()
  return page.getByRole('dialog', { name: 'Other spools' })
}

// AC-7 — Print from the detail page and from a list row opens the print page: one slot per
// defined type, listing that type's open and sealed non-finished spools, grams pre-filled.
test('AC-7: print page has one slot per type with that type open+sealed spools and pre-filled grams', async ({ page }) => {
  await seedFixture()

  // From the detail page.
  await page.goto(`/print-projects/${PROJECT}`)
  await page.getByRole('link', { name: 'Print', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/print-projects/${PROJECT}/print`))

  const slots = page.getByTestId('project-slot')
  await expect(slots).toHaveCount(2)
  await expect(slot(page, 0)).toContainText('AlphaBrand')
  await expect(slot(page, 1)).toContainText('BetaBrand')

  // Slot 0 (TA): the open SA and the sealed SB; the finished SC is absent.
  const picks = slot(page, 0).locator('.spool-pick .id-pill')
  await expect(picks).toHaveCount(2)
  const pickIds = (await picks.allInnerTexts()).sort()
  expect(pickIds).toEqual(['SA', 'SB'])

  // Slot 1 (TB): only SD.
  await expect(slot(page, 1).locator('.spool-pick .id-pill')).toHaveText('SD')

  // Grams are pre-filled from the definition.
  await expect(slotGrams(page, 0, 'TA')).toHaveValue('100')
  await expect(slotGrams(page, 1, 'TB')).toHaveValue('50')

  // From a list row: the same print page.
  await page.goto('/print-projects')
  await page.locator('tbody tr', { hasText: 'Benchy' }).getByRole('link', { name: 'Print', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/print-projects/${PROJECT}/print`))
  await expect(page.getByTestId('project-slot')).toHaveCount(2)
})

// AC-8 — "Other spools" lists every non-finished spool of any type; facet filters narrow it;
// choosing a different type's spool fills the slot with grams still pre-filled and editable.
test('AC-8: other-spools dialogue lists all non-finished spools, facet-filters, fills a different-type slot', async ({ page }) => {
  await seedFixture()
  await page.goto(`/print-projects/${PROJECT}/print`)

  const dialog = await otherSpools(page, 0)
  // SA, SB, SD — the finished SC is absent.
  const rows = dialog.locator('tbody tr')
  await expect(rows).toHaveCount(3)
  expect(((await rows.locator('.id-pill').allInnerTexts()).sort())).toEqual(['SA', 'SB', 'SD'])

  // Narrow by brand: only BetaBrand's spool remains. (<summary> exposes as generic, not button.)
  await dialog.locator('summary', { hasText: 'Brand' }).click()
  await dialog.locator('.facet__option', { hasText: 'BetaBrand' }).getByRole('checkbox').check()
  await expect(rows).toHaveCount(1)
  await expect(rows.locator('.id-pill')).toHaveText('SD')

  // Pick it: the slot shows the out-of-list selection and the grams are still pre-filled.
  await rows.first().click()
  await expect(dialog).not.toBeVisible()
  const custom = slot(page, 0).locator('.spool-pick--selected')
  await expect(custom).toContainText('SD')
  await expect(slotGrams(page, 0, 'TA')).toHaveValue('100')

  // …and editable.
  await slotGrams(page, 0, 'TA').fill('80')
  await expect(slotGrams(page, 0, 'TA')).toHaveValue('80')
})

// AC-9 — the same spool backing two slots: the balance drops by the sum of both slots' grams.
test('AC-9: same spool in two slots consumes the sum of both slots', async ({ page }) => {
  await seedFixture()
  await page.goto(`/print-projects/${PROJECT}/print`)

  await pickFromSlot(page, 0, 'SA') // 100 g
  const dialog = await otherSpools(page, 1)
  await dialog.locator('tbody tr', { has: page.locator('.id-pill:has-text("SA")') }).click()
  // Slot 1 keeps its pre-filled 50 g -> 150 g total from SA.
  await page.getByTestId('confirm-print').click()

  await expect(page).toHaveURL(new RegExp(`/print-projects/${PROJECT}\\?highlight=`))
  expect(await spoolById(page, 'SA').then(s => s.remainingGrams)).toBe(850)
  expect(await spoolById(page, 'SD').then(s => s.remainingGrams)).toBe(1000)
  expect(await printCount(page)).toBe(1)
})

// AC-10a — an unfilled slot or a 0 g slot blocks confirmation with a visible error; nothing is
// consumed.
test('AC-10a: unfilled slot and 0 g slot block confirmation visibly, nothing consumed', async ({ page }) => {
  await seedFixture()
  await page.goto(`/print-projects/${PROJECT}/print`)

  // Unfilled slot.
  await expect(page.getByTestId('confirm-print')).toBeDisabled()
  await expect(page.locator('.form-error')).toHaveText('Give a spool to every filament type before printing.')

  // Both filled, but one slot at 0 g.
  await pickFromSlot(page, 0, 'SA')
  await pickFromSlot(page, 1, 'SD')
  await slotGrams(page, 0, 'TA').fill('0')
  await expect(page.getByTestId('confirm-print')).toBeDisabled()
  await expect(page.locator('.form-error')).toHaveText('Every spool must get at least 1 g.')

  const sa = await spoolById(page, 'SA')
  const sd = await spoolById(page, 'SD')
  expect(sa.remainingGrams).toBe(1000)
  expect(sd.remainingGrams).toBe(1000)
  expect(await printCount(page)).toBe(0)
})

// AC-10b — two slots on one spool whose summed grams exceed its balance block confirmation
// visibly; nothing is consumed.
test('AC-10b: summed over-balance across a spool slots blocks confirmation, nothing consumed', async ({ page }) => {
  await seedFixture()
  await page.goto(`/print-projects/${PROJECT}/print`)

  await pickFromSlot(page, 0, 'SA')
  const dialog = await otherSpools(page, 1)
  await dialog.locator('tbody tr', { has: page.locator('.id-pill:has-text("SA")') }).click()
  await slotGrams(page, 0, 'TA').fill('600')
  await slotGrams(page, 1, 'TB').fill('500') // 1100 g > 1000 g remaining

  await expect(page.getByTestId('confirm-print')).toBeDisabled()
  await expect(page.locator('.form-error')).toContainText('only 1000 g remaining')

  expect((await spoolById(page, 'SA')).remainingGrams).toBe(1000)
  expect(await printCount(page)).toBe(0)
})

// AC-11 — a valid print with one open and one sealed spool: balances drop, both spool histories
// gain project-linked rows without undo controls, the detail gains the print row on top, and the
// sealed spool becomes open.
test('AC-11: valid print consumes both spools, links history rows, sealed spool opens', async ({ page }) => {
  await seedFixture()
  await page.goto(`/print-projects/${PROJECT}/print`)

  // One open spool (SD) and one sealed spool (SB) — the print must auto-open the sealed one.
  await pickFromSlot(page, 0, 'SB')
  await pickFromSlot(page, 1, 'SD')

  await page.getByTestId('confirm-print').click()

  await expect(page).toHaveURL(new RegExp(`/print-projects/${PROJECT}\\?highlight=`))

  expect((await spoolById(page, 'SB')).remainingGrams).toBe(900)
  expect((await spoolById(page, 'SD')).remainingGrams).toBe(950)
  expect((await spoolById(page, 'SA')).remainingGrams).toBe(1000)

  // The sealed spool is now open (opened by the print).
  expect((await spoolById(page, 'SB')).status).toBe('Open')

  // The project detail gained the print row on top, with both spools and their grams.
  const row = page.locator('.card--flush tbody tr').first()
  await expect(row).toContainText('SB')
  await expect(row).toContainText('SD')
  await expect(row).toContainText('100')
  await expect(row).toContainText('50')

  // Each spool's history gained a project-linked row with the title as a link and no undo control.
  await page.goto('/spools/SB')
  const linked = page.locator('tr.event--project')
  await expect(linked).toHaveCount(1)
  await expect(linked.getByRole('link', { name: 'Benchy' })).toBeVisible()
  await expect(linked.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  await expect(linked.getByRole('button', { name: 'Redo', exact: true })).toHaveCount(0)

  await page.goto('/spools/SD')
  await expect(page.locator('tr.event--project')).toHaveCount(1)
})

// AC-12 — undo displays the print and the spool rows as undone and restores balances; redo
// reverses; a redo rejected by a lifecycle guard keeps the print undone and balances unchanged.
test('AC-12: undo/redo of a project print; a rejected redo keeps the print undone', async ({ page }) => {
  await seedFixture()
  await page.goto(`/print-projects/${PROJECT}/print`)

  await pickFromSlot(page, 0, 'SA')
  await pickFromSlot(page, 1, 'SD')
  await page.getByTestId('confirm-print').click()
  await expect(page).toHaveURL(new RegExp(`/print-projects/${PROJECT}\\?highlight=`))
  expect((await spoolById(page, 'SA')).remainingGrams).toBe(900)
  expect((await spoolById(page, 'SD')).remainingGrams).toBe(950)

  // Undo from the project prints section.
  const printRowEl = page.locator('.card--flush tbody tr').first()
  await printRowEl.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(printRowEl).toHaveClass(/event-disabled/)
  await expect(printRowEl.getByRole('button', { name: 'Redo', exact: true })).toBeVisible()

  // Spool histories display the rows as undone (no undo control on project rows).
  await page.goto('/spools/SA')
  const undoneRow = page.locator('tr.event--project')
  await expect(undoneRow).toHaveClass(/event-disabled/)
  await expect(undoneRow.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  expect((await spoolById(page, 'SA')).remainingGrams).toBe(1000)
  expect((await spoolById(page, 'SD')).remainingGrams).toBe(1000)

  // Redo reverses everything.
  await page.goto(`/print-projects/${PROJECT}`)
  await page.locator('.card--flush tbody tr').first().getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('.card--flush tbody tr').first()).not.toHaveClass(/event-disabled/)
  expect((await spoolById(page, 'SA')).remainingGrams).toBe(900)
  expect((await spoolById(page, 'SD')).remainingGrams).toBe(950)

  // Now make the redo impossible: undo the print again, then undo SA's Opened event from the
  // spool page (SA has no other active work), returning SA to sealed. Gate each undo on the page
  // reload (which only happens once the API has committed) before navigating or reading.
  await page.locator('.card--flush tbody tr').first().getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.card--flush tbody tr').first()).toHaveClass(/event-disabled/)
  await page.goto('/spools/SA')
  const openRow = page.locator('tbody tr').filter({ has: page.locator('.ev--opened') })
  await openRow.getByRole('button', { name: 'Undo', exact: true }).click()
  await spoolWhen(page, 'SA', s => s.status === 'Sealed')

  // The redo is rejected by the lifecycle guard: an error surfaces and the print stays undone.
  await page.goto(`/print-projects/${PROJECT}`)
  const dialogPromise = page.waitForEvent('dialog')
  await page.locator('.card--flush tbody tr').first().getByRole('button', { name: 'Redo', exact: true }).click()
  const dialog = await dialogPromise
  dialog.accept()
  expect(dialog.message()).toContain('Open the spool')

  const rowAfter = page.locator('.card--flush tbody tr').first()
  await expect(rowAfter).toHaveClass(/event-disabled/)
  expect((await spoolById(page, 'SA')).remainingGrams).toBe(1000)
  expect((await spoolById(page, 'SD')).remainingGrams).toBe(1000)
})

// AC-13 — click-through both ways with row highlighting: spool history -> project detail
// (print highlighted); project print -> spool detail (event highlighted).
test('AC-13: two-way click-through with row highlighting', async ({ page }) => {
  await seedFixture()
  await seedProjectPrint({
    projectId: PROJECT, printId: 'PR13', spoolId: 'SA', grams: 100, occurredAt: ago(1),
  })
  await seedProjectPrint({
    projectId: PROJECT, printId: 'PR13B', spoolId: 'SD', grams: 50, occurredAt: ago(1),
  })

  // Spool history -> project detail, print row highlighted.
  await page.goto('/spools/SA')
  const link = page.locator('tr.event--project').getByRole('link', { name: 'Benchy' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', `/print-projects/${PROJECT}?highlight=PR13`)
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/print-projects/${PROJECT}\\?highlight=PR13`))
  await expect(page.getByTestId('highlighted-print')).toHaveCount(1)

  // Project print -> spool detail, event row highlighted.
  await page.goto(`/print-projects/${PROJECT}`)
  const spoolLink = page.locator('.card--flush tbody tr').filter({ hasText: 'SD' }).getByRole('link', { name: 'SD' })
  await spoolLink.click()
  await expect(page).toHaveURL(/\/spools\/SD\?highlight=\d+/)
  await expect(page.getByTestId('highlighted-event')).toHaveCount(1)
})

// AC-16 — a print's consumption is in the dashboard's 30-day consumed figure for today; undoing
// it removes it again.
test('AC-16: a print is in the current-day dashboard consumption; undo removes it', async ({ page }) => {
  await seedFixture()
  await page.goto(`/print-projects/${PROJECT}/print`)
  await pickFromSlot(page, 0, 'SA') // 100 g
  await pickFromSlot(page, 1, 'SD') // 50 g
  await page.getByTestId('confirm-print').click()
  // The navigation only happens once the print has committed — gate on it before reading.
  await expect(page).toHaveURL(new RegExp(`/print-projects/${PROJECT}\\?highlight=`))

  const usage = async () => {
    const res = await page.request.get('/api/dashboard/usage?days=30')
    expect(res.ok()).toBeTruthy()
    const arr = (await res.json()) as { day: string; consumedGrams: number }[]
    return arr[arr.length - 1].consumedGrams // today
  }
  expect(await usage()).toBe(150)

  const row = page.locator('.card--flush tbody tr').first()
  await row.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(row).toHaveClass(/event-disabled/)
  expect(await usage()).toBe(0)
})
