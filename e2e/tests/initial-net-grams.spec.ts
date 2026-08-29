import { test, expect } from './fixtures/seed'
import type { Page } from '@playwright/test'

// Regression coverage for doc/done/007-fix-initial-get-grams: a spool created with an initial
// net weight different from its filament type's default (1000 g in the seeded type) must store
// and display the requested value (250 g in the report), not the type default.

type CreatedSpool = {
  id: string
  initialNetGrams: number
  remainingGrams: number
}

/** Creates a spool via the SPA "New spool" form and returns the created spool from the POST response. */
async function createSpoolViaUi(
  page: Page,
  typeId: string,
  initialNetGrams?: number,
): Promise<CreatedSpool> {
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
  return (await resp.json()) as CreatedSpool
}

// The seeded type uses the form defaults: 1000 g net, 200 g empty spool.
test('a spool created with a custom initial net weight stores and displays that value', async ({ page, seed }) => {
  // The report's exact scenario: the type says 1000 g, the spool actually holds 250 g.
  const created = await createSpoolViaUi(page, seed.type.id, 250)

  // The API (reading back the persisted row) reports the requested initial net weight, not the
  // type default — and a fresh spool's remaining balance equals it.
  expect(created.initialNetGrams).toBe(250)
  expect(created.remainingGrams).toBe(250)
  const fetched = (await page.request.get(`/api/spools/${created.id}`)).json() as Promise<CreatedSpool>
  expect((await fetched).initialNetGrams).toBe(250)
  expect((await fetched).remainingGrams).toBe(250)

  // The spool list shows 250 g remaining out of a 250 g initial weight.
  await page.goto('/spools')
  const row = page.locator('tbody tr', { has: page.locator('a.id-pill', { hasText: created.id }) })
  await expect(row).toBeVisible()
  await expect(row.locator('.gauge__value')).toHaveText('250 g / 250')

  // The spool detail reports the remaining value against the custom initial net weight.
  await page.goto(`/spools/${created.id}`)
  await expect(page.getByText('Remaining: 250 g (initial 250 g)')).toBeVisible()

  // After consumption, the remaining balance is the custom initial weight minus the print — the
  // balance, the gauge and the detail keep using 250 g as the initial weight, never the 1000 g
  // type default.
  await page.getByRole('button', { name: 'Open spool' }).click()
  await page.getByLabel(/Grams used/).fill('100')
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  await expect(page.getByText('Remaining: 150 g (initial 250 g)')).toBeVisible()

  await page.goto('/spools')
  const usedRow = page.locator('tbody tr', { has: page.locator('a.id-pill', { hasText: created.id }) })
  await expect(usedRow).toBeVisible()
  await expect(usedRow.locator('.gauge__value')).toHaveText('150 g / 250')
})

test('a spool created without an initial net weight uses the type default', async ({ page, seed }) => {
  // The seeded spool was created through the UI without filling "Initial net".
  const fetched = (await page.request.get(`/api/spools/${seed.spool.id}`)).json() as Promise<CreatedSpool>
  const spool = await fetched

  expect(spool.initialNetGrams).toBe(1000)
  expect(spool.remainingGrams).toBe(1000)

  await page.goto('/spools')
  const row = page.locator('tbody tr', { has: page.locator('a.id-pill', { hasText: seed.spool.id }) })
  await expect(row).toBeVisible()
  await expect(row.locator('.gauge__value')).toHaveText('1000 g / 1000')
})
