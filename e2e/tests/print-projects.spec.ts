import { test, expect, type Page } from '@playwright/test'
import {
  resetInventory, seedSpool, seedType, seedPrintProject, seedProjectPrint,
  type SeedEvent,
} from './fixtures/db'

// Every test starts from — and leaves — a clean database so the spec is self-isolating.
test.beforeEach(async () => {
  await resetInventory()
})
test.afterEach(async () => {
  await resetInventory()
})

// UTC noon `n` days before today — safely mid-day, no UTC-day boundary ambiguity.
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

// Auto-accept native confirm() dialogues (archive/unarchive/delete). Idempotent: a second
// handler on the same page would throw "dialog already handled" when a confirm appears.
const dialogAccepting = new WeakSet<Page>()
function acceptDialogs(page: Page) {
  if (dialogAccepting.has(page)) return
  dialogAccepting.add(page)
  page.on('dialog', d => d.accept())
}

// The list page, gated on the table (or the empty state) being rendered.
async function openList(page: Page) {
  await page.goto('/print-projects')
  await expect(page.getByRole('heading', { name: 'Print projects' })).toBeVisible()
  await expect(page.locator('.card--flush, .empty-state').first()).toBeVisible()
}

// The project-title cells in list order.
const titles = (page: Page) => page.locator('tbody tr .project-title').allInnerTexts()

// Polling list-order assertion: `resolves` on a locator promise is only awaited once, so wrap
// the query in toPass() to re-run it on every retry.
const expectTitles = (page: Page, want: string[]) =>
  expect(async () => { expect(await titles(page)).toEqual(want) }).toPass()

// Project title cells in the list (for per-row actions).
function row(page: Page, title: string) {
  return page.locator('tbody tr', { hasText: title })
}

// The project's prints table on the detail page.
function printRow(page: Page, spoolId: string) {
  return page.locator('.card--flush tbody tr', { has: page.locator(`.id-pill:has-text("${spoolId}")`) })
}

// The project form on the list or detail page.
function form(page: Page) {
  return page.getByTestId('project-form')
}

// Fill the form's first (default) type line and submit; returns nothing — callers assert.
async function createViaForm(page: Page, opts: {
  title: string
  description?: string
  url?: string
  types: string[] // type ids, in line order (first line prefilled, rest added)
  grams?: number[]
}) {
  await page.getByRole('button', { name: 'New project' }).click()
  const f = form(page)
  await f.getByLabel('Title', { exact: true }).fill(opts.title)
  if (opts.description) await f.getByLabel('Description', { exact: true }).fill(opts.description)
  if (opts.url) await f.getByLabel('URL', { exact: true }).fill(opts.url)
  for (let i = 0; i < opts.types.length; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Add type' }).click()
    const line = f.locator('[data-testid="project-type-line"]').nth(i)
    await line.getByLabel('Filament type').selectOption(opts.types[i])
    const grams = opts.grams?.[i] ?? 100
    await line.locator('input[type="number"]').fill(String(grams))
  }
  await f.getByRole('button', { name: 'Create' }).click()
}

// AC-1 — the "Print projects" nav item sits after "Spools"; the list opens to its empty state.
test('AC-1: Print projects nav item after Spools, empty list state', async ({ page }) => {
  await page.goto('/print-projects')
  const names = await page.locator('nav a').allInnerTexts()
  expect(names).toContain('Print projects')
  expect(names.indexOf('Print projects')).toBe(names.indexOf('Spools') + 1)

  await openList(page)
  await expect(page.locator('.empty-state strong')).toHaveText('No print projects here')
  await expect(page.locator('tbody tr')).toHaveCount(0)
})

// AC-2 — create through the list form; empty title and a missing type line are rejected visibly
// without a request being accepted.
test('AC-2: create via the form; empty title and no type line are rejected visibly', async ({ page }) => {
  await seedType({ id: 'TA2', brand: 'BrandA', material: 'PLA', type: 'Basic', color: 'Red' })
  await seedType({ id: 'TB2', brand: 'BrandB', material: 'PETG', type: 'Basic', color: 'Blue' })

  // Empty title: the error is visible and the submit is blocked.
  await page.goto('/print-projects')
  await page.getByRole('button', { name: 'New project' }).click()
  const f = form(page)
  await f.getByLabel('Filament type').selectOption('TA2')
  await f.locator('input[type="number"]').fill('100')
  await expect(f.locator('.form-error')).toHaveText('Title is required.')
  await expect(f.getByRole('button', { name: 'Create' })).toBeDisabled()

  // A form with no type line: remove the single line, the error appears, submit blocked.
  await f.getByLabel('Title', { exact: true }).fill('Temp')
  await f.locator('[data-testid="project-type-line"]').getByRole('button', { name: 'Remove line' }).click()
  await expect(f.locator('.form-error')).toHaveText('Add at least one filament type.')
  await expect(f.getByRole('button', { name: 'Create' })).toBeDisabled()
  await expect(page.locator('tbody tr')).toHaveCount(0)

  // Close the (toggling) form, then do a valid create: it lands the row with the title.
  await page.getByRole('button', { name: 'Close' }).click()
  await createViaForm(page, {
    title: 'Benchy v3',
    description: 'The classic test model',
    url: 'https://example.com/benchy',
    types: ['TA2', 'TB2'],
    grams: [100, 50],
  })
  const r = row(page, 'Benchy v3')
  await expect(r).toBeVisible()
  await expect(r.locator('.project-title')).toHaveText('Benchy v3')
})

// AC-3 — archiving via its confirmation dialogue removes the project from the default list; the
// "Show archived" toggle brings it back with an archived marker.
test('AC-3: archive hides the project by default, shows it archived via the toggle', async ({ page }) => {
  await seedType({ id: 'TA3' })
  await seedPrintProject({ id: 'PP3', title: 'Archive me', createdAt: ago(1), types: [{ typeId: 'TA3', grams: 100 }] })

  await openList(page)
  await expect(row(page, 'Archive me')).toBeVisible()

  acceptDialogs(page)
  await row(page, 'Archive me').getByRole('button', { name: 'Archive' }).click()
  await expect(row(page, 'Archive me')).not.toBeVisible()

  await page.getByLabel('Show archived').check()
  const archivedRow = row(page, 'Archive me')
  await expect(archivedRow).toBeVisible()
  await expect(archivedRow).toContainText('Archived')
})

// AC-4 — newest effective date first; ties by title A–Z; undoing a project's newest print moves it
// back to its creation-date position.
test('AC-4: effective-date order with title tie-break; undo falls back to creation date', async ({ page }) => {
  await seedType({ id: 'TA4' })
  await seedSpool({
    id: 'SB4', typeId: 'TA4', initialNetGrams: 1000, createdAt: ago(20),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 20 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 20 })],
  })
  await seedSpool({
    id: 'SA4', typeId: 'TA4', initialNetGrams: 1000, createdAt: ago(14),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 14 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 14 })],
  })

  // Effective dates: PC 1d (created), PB 2d (print), Alpha/Beta 5d (created, tied), PA 12d (print).
  await seedPrintProject({ id: 'PC', title: 'PC', createdAt: ago(1), types: [{ typeId: 'TA4', grams: 100 }] })
  await seedPrintProject({ id: 'PB', title: 'PB', createdAt: ago(20), types: [{ typeId: 'TA4', grams: 100 }] })
  await seedProjectPrint({ projectId: 'PB', printId: 'PRB1', spoolId: 'SB4', grams: 100, occurredAt: ago(2) })
  await seedPrintProject({ id: 'PA', title: 'PA', createdAt: ago(10), types: [{ typeId: 'TA4', grams: 100 }] })
  await seedProjectPrint({ projectId: 'PA', printId: 'PRA1', spoolId: 'SA4', grams: 50, occurredAt: ago(12) })
  await seedPrintProject({ id: 'PAlpha', title: 'Alpha', createdAt: ago(5), types: [{ typeId: 'TA4', grams: 100 }] })
  await seedPrintProject({ id: 'PBeta', title: 'Beta', createdAt: ago(5), types: [{ typeId: 'TA4', grams: 100 }] })

  await openList(page)
  await expectTitles(page, ['PC', 'PB', 'Alpha', 'Beta', 'PA'])

  // Undo PB's only print: its effective date falls back to its creation (20 days ago) -> last.
  await page.goto('/print-projects/PB')
  await printRow(page, 'SB4').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(printRow(page, 'SB4').getByRole('button', { name: 'Redo', exact: true })).toBeVisible()

  await openList(page)
  await expectTitles(page, ['PC', 'Alpha', 'Beta', 'PA', 'PB'])
})

// AC-5 — the detail page shows the title, description, URL as a clickable external link, the
// defined types with grams, and the project prints section.
test('AC-5: detail shows title, description, external URL link, types with grams, prints section', async ({ page }) => {
  await seedType({ id: 'TA5', brand: 'BrandA', material: 'PLA', type: 'Basic', color: 'Red' })
  await seedType({ id: 'TB5', brand: 'BrandB', material: 'PETG', type: 'Basic', color: 'Blue' })
  await seedSpool({
    id: 'S5', typeId: 'TA5', initialNetGrams: 1000, createdAt: ago(10),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 10 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 10 })],
  })
  await seedPrintProject({
    id: 'PP5', title: 'Benchy v3', description: 'A description line', url: 'https://example.com/benchy',
    createdAt: ago(3), types: [{ typeId: 'TA5', grams: 120 }, { typeId: 'TB5', grams: 80 }],
  })
  await seedProjectPrint({ projectId: 'PP5', printId: 'PR5', spoolId: 'S5', grams: 120, occurredAt: ago(1) })

  await page.goto('/print-projects/PP5')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Benchy v3')
  await expect(page.locator('.project-description')).toHaveText('A description line')

  const url = page.getByRole('link', { name: 'https://example.com/benchy' })
  await expect(url).toHaveAttribute('href', 'https://example.com/benchy')
  await expect(url).toHaveAttribute('target', '_blank')

  await expect(page.locator('.specs')).toContainText('120 g')
  await expect(page.locator('.specs')).toContainText('80 g')
  await expect(page.locator('.specs')).toContainText('BrandA')
  await expect(page.getByRole('heading', { name: 'Project prints' })).toBeVisible()
  await expect(printRow(page, 'S5')).toContainText('120')
})

// AC-6 — edits persist and reflect in the detail and the list row; an existing project print keeps
// its recorded spools and grams.
test('AC-6: edit persists, reflects in list and detail, existing prints unchanged', async ({ page }) => {
  await seedType({ id: 'TA6', brand: 'BrandA', material: 'PLA', type: 'Basic', color: 'Red' })
  await seedType({ id: 'TB6', brand: 'BrandB', material: 'PETG', type: 'Basic', color: 'Blue' })
  await seedSpool({
    id: 'S6', typeId: 'TA6', initialNetGrams: 1000, createdAt: ago(10),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 10 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 10 })],
  })
  await seedPrintProject({
    id: 'PP6', title: 'Before edit', url: 'https://example.com/old',
    createdAt: ago(5), types: [{ typeId: 'TA6', grams: 100 }],
  })
  await seedProjectPrint({ projectId: 'PP6', printId: 'PR6', spoolId: 'S6', grams: 100, occurredAt: ago(1) })

  await page.goto('/print-projects/PP6')
  await page.getByRole('button', { name: 'Edit' }).click()
  const f = form(page)
  await f.getByLabel('Title', { exact: true }).fill('After edit')
  await f.getByLabel('Description', { exact: true }).fill('New description')
  await f.getByLabel('URL', { exact: true }).fill('https://example.com/new')
  await f.locator('[data-testid="project-type-line"]').locator('input[type="number"]').fill('60')
  await page.getByRole('button', { name: 'Add type' }).click()
  const second = f.locator('[data-testid="project-type-line"]').nth(1)
  await second.getByLabel('Filament type').selectOption('TB6')
  await second.locator('input[type="number"]').fill('25')
  await f.getByRole('button', { name: 'Save changes' }).click()

  // The detail page only reloads once the save has committed — gate on it before reading the API.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('After edit')

  // The API is the source of truth for what was persisted.
  const res = await page.request.get('/api/print-projects/PP6')
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { title: string; description: string | null; url: string | null; types: { filamentTypeId: string; grams: number }[] }
  expect(body.title).toBe('After edit')
  expect(body.description).toBe('New description')
  expect(body.url).toBe('https://example.com/new')
  const typeLines = body.types
    .map(t => ({ filamentTypeId: t.filamentTypeId, grams: t.grams }))
    .sort((a, b) => a.filamentTypeId.localeCompare(b.filamentTypeId))
  expect(typeLines).toEqual([
    { filamentTypeId: 'TA6', grams: 60 },
    { filamentTypeId: 'TB6', grams: 25 },
  ])

  // The pre-existing print kept its recorded spool and grams.
  await expect(printRow(page, 'S6')).toContainText('100')

  // The list row reflects the new title.
  await openList(page)
  await expect(row(page, 'After edit')).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: 'Before edit' })).toHaveCount(0)
})

// AC-14 — archiving hides Print/Edit/undo actions and drops the project from the default list
// (it appears via the toggle, sorted by its archived date); unarchiving restores the actions.
test('AC-14: archive hides actions and re-sorts by archived date; unarchive restores', async ({ page }) => {
  await seedType({ id: 'TA14' })
  await seedSpool({
    id: 'S14', typeId: 'TA14', initialNetGrams: 1000, createdAt: ago(30),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 30 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 30 })],
  })
  // Two projects: PP14 was created long ago but archived most recently; PP14B is recent.
  await seedPrintProject({
    id: 'PP14', title: 'Older', createdAt: ago(30), types: [{ typeId: 'TA14', grams: 100 }],
  })
  await seedProjectPrint({ projectId: 'PP14', printId: 'PR14', spoolId: 'S14', grams: 100, occurredAt: ago(10) })
  await seedPrintProject({ id: 'PP14B', title: 'Recent', createdAt: ago(1), types: [{ typeId: 'TA14', grams: 100 }] })

  await page.goto('/print-projects/PP14')
  await expect(page.getByRole('link', { name: 'Print', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(printRow(page, 'S14').getByRole('button', { name: 'Undo', exact: true })).toBeVisible()

  acceptDialogs(page)
  await page.getByRole('button', { name: 'Archive' }).click()

  // Actions are gone on the detail page; only unarchive (and delete) remain.
  await expect(page.getByRole('link', { name: 'Print', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible()

  // Default list: gone; with the toggle: present, and — sorted by archived date — before "Recent".
  await openList(page)
  await expect(page.locator('tbody tr', { hasText: 'Older' })).toHaveCount(0)
  await expect(page.locator('tbody tr', { hasText: 'Recent' })).toBeVisible()
  await page.getByLabel('Show archived').check()
  await expectTitles(page, ['Older', 'Recent'])

  // Unarchive restores the actions. (The dialog handler registered above persists across the
  // navigation — registering a second one would throw "already handled" on the confirm.)
  await page.goto('/print-projects/PP14')
  await page.getByRole('button', { name: 'Unarchive' }).click()
  await expect(page.getByRole('link', { name: 'Print', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(printRow(page, 'S14').getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
})

// AC-15 — delete is available only for archived projects with no enabled prints; after the
// confirmation the project, all its prints and the linked spool rows are gone, balances restored.
test('AC-15: delete only for archived without enabled prints; cascade keeps balances consistent', async ({ page }) => {
  await seedType({ id: 'TA15' })
  await seedSpool({
    id: 'S15', typeId: 'TA15', initialNetGrams: 1000, createdAt: ago(10),
    events: [ev({ kind: 'Created', deltaGrams: 0, ago: 10 }), ev({ kind: 'Opened', deltaGrams: 0, ago: 10 })],
  })
  await seedPrintProject({ id: 'PP15', title: 'Doomed', createdAt: ago(5), types: [{ typeId: 'TA15', grams: 100 }] })
  await seedProjectPrint({ projectId: 'PP15', printId: 'PR15', spoolId: 'S15', grams: 100, occurredAt: ago(1) })

  // Not archived: the delete control is locked with an explanation.
  await page.goto('/print-projects/PP15')
  const del = page.getByTestId('delete-project')
  await expect(del).toBeDisabled()
  await expect(del).toHaveAttribute('title', 'A project can be deleted only when it is archived and has no active prints.')

  // Undo the print first (undo is hidden on archived projects); not archived, so still locked.
  await printRow(page, 'S15').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(del).toBeDisabled()

  // Archived with no enabled prints: delete unlocks.
  acceptDialogs(page)
  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(del).toBeEnabled()

  await del.click()
  await expect(page).toHaveURL(/\/print-projects(\?.*)?$/)

  // The project is gone, the spool's linked history row with it, and the balance is back to 1000 g.
  const res = await page.request.get('/api/print-projects/PP15')
  expect(res.status()).toBe(404)
  const spool = (await (await page.request.get('/api/spools/S15')).json()) as { remainingGrams: number }
  expect(spool.remainingGrams).toBe(1000)
  const events = (await (await page.request.get('/api/spools/S15/events')).json()) as { kind: string; projectPrintId: string | null }[]
  expect(events.map(e => e.kind).sort()).toEqual(['Created', 'Opened'])
  expect(events.every(e => e.projectPrintId === null)).toBeTruthy()
})

// AC-17 — a project created in one browser context appears in a second context's list without a
// manual reload (change stream).
test('AC-17: a create in one context appears in another without reload', async ({ browser }) => {
  await seedType({ id: 'TA17', brand: 'BrandA', material: 'PLA', type: 'Basic', color: 'Red' })
  const a = await browser.newContext()
  const b = await browser.newContext()
  const pa = await a.newPage()
  const pb = await b.newPage()
  try {
    await openList(pb)
    await expect(pb.locator('tbody tr')).toHaveCount(0)

    await pa.goto('/print-projects')
    await createViaForm(pa, { title: 'From context A', types: ['TA17'], grams: [100] })
    await expect(pa.locator('tbody tr', { hasText: 'From context A' })).toBeVisible()

    // Context B picks it up via the change stream — no reload.
    await expect(pb.locator('tbody tr', { hasText: 'From context A' })).toBeVisible({ timeout: 15000 })
  } finally {
    await a.close()
    await b.close()
  }
})
