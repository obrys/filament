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

const ev = (kind: SeedEvent['kind'], daysAgo: number, deltaGrams = 0): SeedEvent => ({
  kind, deltaGrams, occurredAt: ago(daysAgo),
})

const PROJECT = 'PPI'

// Types TA/TB, open spools SA (TA) and SD (TB), project PPI with TA 100 g + TB 50 g.
async function seedFixture() {
  await seedType({ id: 'TA', brand: 'AlphaBrand', material: 'PLA', type: 'Smooth', color: 'Red' })
  await seedType({ id: 'TB', brand: 'BetaBrand', material: 'PETG', type: 'Basic', color: 'Blue' })
  await seedSpool({
    id: 'SA', typeId: 'TA', initialNetGrams: 1000, createdAt: ago(6),
    events: [ev('Created', 6), ev('Opened', 6)],
  })
  await seedSpool({
    id: 'SD', typeId: 'TB', initialNetGrams: 1000, createdAt: ago(6),
    events: [ev('Created', 6), ev('Opened', 6)],
  })
  await seedPrintProject({
    id: PROJECT, title: 'Benchy', createdAt: ago(2),
    types: [{ typeId: 'TA', grams: 100 }, { typeId: 'TB', grams: 50 }],
  })
}

type SpoolEventJson = { id: number; kind: string; isDisabled: boolean; projectPrintId: string | null }

async function eventsOf(page: Page, spoolId: string): Promise<SpoolEventJson[]> {
  const res = await page.request.get(`/api/spools/${spoolId}/events`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as SpoolEventJson[]
}

async function remaining(page: Page, spoolId: string): Promise<number> {
  const res = await page.request.get(`/api/spools/${spoolId}`)
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { remainingGrams: number }).remainingGrams
}

async function printViaApi(page: Page, spools: { spoolId: string; grams: number }[]): Promise<string> {
  const res = await page.request.post(`/api/print-projects/${PROJECT}/prints`, { data: { spools } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}

// A project-linked spool event cannot be undone/redone on its own through the spool API: it
// would desynchronise the project print from its events.
test('project-linked spool events cannot be disabled or enabled through the spool API', async ({ page }) => {
  await seedFixture()
  const printId = await printViaApi(page, [{ spoolId: 'SA', grams: 100 }, { spoolId: 'SD', grams: 50 }])
  const linked = (await eventsOf(page, 'SA')).find(e => e.projectPrintId === printId)!

  const disable = await page.request.post(`/api/spools/SA/events/${linked.id}/disable`)
  expect(disable.status()).toBe(400)
  expect(((await disable.json()) as { error: string }).error).toContain('print project page')
  expect(await remaining(page, 'SA')).toBe(900)

  // Undo the print the proper way, then try to enable the event directly.
  const undo = await page.request.post(`/api/print-projects/${PROJECT}/prints/${printId}/undo`)
  expect(undo.ok()).toBeTruthy()
  const enable = await page.request.post(`/api/spools/SA/events/${linked.id}/enable`)
  expect(enable.status()).toBe(400)
  expect(await remaining(page, 'SA')).toBe(1000)
})

// A spool with any active event (other than Created) cannot be deleted through the API either —
// the same rule the UI applies — and becomes deletable once those events are undone.
test('a spool with active events cannot be deleted; undoing them makes it deletable', async ({ page }) => {
  await seedFixture()

  const blocked = await page.request.delete('/api/spools/SA')
  expect(blocked.status()).toBe(409)
  expect(((await blocked.json()) as { error: string }).error).toContain('active events')
  expect((await page.request.get('/api/spools/SA')).ok()).toBeTruthy()

  const opened = (await eventsOf(page, 'SA')).find(e => e.kind === 'Opened')!
  expect((await page.request.post(`/api/spools/SA/events/${opened.id}/disable`)).ok()).toBeTruthy()
  expect((await page.request.delete('/api/spools/SA')).status()).toBe(204)
  expect((await page.request.get('/api/spools/SA')).status()).toBe(404)
})

// A spool with an enabled project print cannot be deleted.
test('a spool with an enabled project print cannot be deleted', async ({ page }) => {
  await seedFixture()
  await seedProjectPrint({ projectId: PROJECT, printId: 'PRI1', spoolId: 'SA', grams: 100, occurredAt: ago(1) })

  const res = await page.request.delete('/api/spools/SA')
  expect(res.status()).toBe(409)
  expect(((await res.json()) as { error: string }).error).toContain('active events')
  expect((await page.request.get('/api/spools/SA')).ok()).toBeTruthy()
  expect(await remaining(page, 'SA')).toBe(900)
})

// Deleting a spool whose project prints are all undone removes those prints as a whole,
// including their (undone) events on the other spools.
test('deleting a spool removes its undone project prints and their events on other spools', async ({ page }) => {
  await seedFixture()
  const printId = await printViaApi(page, [{ spoolId: 'SA', grams: 100 }, { spoolId: 'SD', grams: 50 }])
  const undo = await page.request.post(`/api/print-projects/${PROJECT}/prints/${printId}/undo`)
  expect(undo.ok()).toBeTruthy()
  // The print's own opening is none of the print's business: undo it before deleting the spool.
  const opened = (await eventsOf(page, 'SA')).find(e => e.kind === 'Opened')!
  expect((await page.request.post(`/api/spools/SA/events/${opened.id}/disable`)).ok()).toBeTruthy()

  const res = await page.request.delete('/api/spools/SA')
  expect(res.status()).toBe(204)
  expect((await page.request.get('/api/spools/SA')).status()).toBe(404)

  const project = (await (await page.request.get(`/api/print-projects/${PROJECT}`)).json()) as { prints: unknown[] }
  expect(project.prints).toHaveLength(0)
  expect((await eventsOf(page, 'SD')).filter(e => e.projectPrintId !== null)).toHaveLength(0)
  expect(await remaining(page, 'SD')).toBe(1000)
})

// A filament type used by a project definition cannot be deleted until the project is gone.
test('a filament type used by a print project cannot be deleted; archive and delete the project first', async ({ page }) => {
  await seedType({ id: 'TZ', brand: 'ZetaBrand', material: 'PLA', type: 'Basic', color: 'Green' })
  await seedPrintProject({ id: 'PPZ', title: 'Zed', createdAt: ago(1), types: [{ typeId: 'TZ', grams: 10 }] })

  const blocked = await page.request.delete('/api/filament-types/TZ')
  expect(blocked.status()).toBe(409)
  expect(((await blocked.json()) as { error: string }).error).toContain('print project')

  expect((await page.request.post('/api/print-projects/PPZ/archive')).ok()).toBeTruthy()
  expect((await page.request.delete('/api/print-projects/PPZ')).status()).toBe(204)
  expect((await page.request.delete('/api/filament-types/TZ')).status()).toBe(204)
})

// Malformed bodies are rejected with 400 instead of failing with a server error.
test('malformed print and project bodies are rejected with 400', async ({ page }) => {
  await seedFixture()

  const nullSlot = await page.request.post(`/api/print-projects/${PROJECT}/prints`, {
    data: { spools: [{ spoolId: 'SA', grams: 100 }, null] },
  })
  expect(nullSlot.status()).toBe(400)

  const nullSpool = await page.request.post(`/api/print-projects/${PROJECT}/prints`, {
    data: { spools: [{ spoolId: null, grams: 100 }, { spoolId: 'SD', grams: 50 }] },
  })
  expect(nullSpool.status()).toBe(400)

  const noSpools = await page.request.post(`/api/print-projects/${PROJECT}/prints`, { data: {} })
  expect(noSpools.status()).toBe(400)

  const nullLine = await page.request.post('/api/print-projects', {
    data: { title: 'X', description: null, url: null, types: [null] },
  })
  expect(nullLine.status()).toBe(400)

  const noTypes = await page.request.post('/api/print-projects', { data: { title: 'X' } })
  expect(noTypes.status()).toBe(400)

  expect(await remaining(page, 'SA')).toBe(1000)
  const project = (await (await page.request.get(`/api/print-projects/${PROJECT}`)).json()) as { prints: unknown[] }
  expect(project.prints).toHaveLength(0)
})
