import { test, expect } from './fixtures/seed'
import type { Page } from '@playwright/test'

// ---- Helpers ----

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

/**
 * Reads the spool ids in displayed (top-to-bottom) order from the current /spools page, waiting for
 * the list to have rendered at least one row. Does NOT navigate — the caller controls the URL (and
 * thus the active sort) via page.goto, so the order reflects the active sort.
 */
async function getSpoolIdsInOrder(page: Page): Promise<string[]> {
  await expect(page.locator('tbody tr td a.id-pill').first()).toBeVisible({ timeout: 15000 })
  return await page.locator('tbody tr td a.id-pill').allInnerTexts()
}

/** Asserts `a` comes before `b` in `order`, retrying until the rendered order settles (post-sort race). */
async function expectBefore(page: Page, a: string, b: string): Promise<void> {
  await expect(async () => {
    const order = await page.locator('tbody tr td a.id-pill').allInnerTexts()
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    expect(ia, `${a} should be present`).toBeGreaterThanOrEqual(0)
    expect(ib, `${b} should be present`).toBeGreaterThanOrEqual(0)
    expect(ia, `${a} should come before ${b} in ${JSON.stringify(order)}`).toBeLessThan(ib)
  }).toPass({ timeout: 10000 })
}

// ---- Tests ----

// AC-12, AC-13, AC-15
test('sort selector reflects URL and reorders spools', async ({ page, seed }) => {
  const typeId = seed.type.id
  // Two spools with extreme, unambiguous remaining weights so their relative order is deterministic
  // regardless of spools left in the shared e2e DB by other tests.
  const low = await createSpoolViaUi(page, typeId, 2)
  const high = await createSpoolViaUi(page, typeId, 99998)

  // AC-12: /spools?sort=leastRemaining loads least-first; URL + selector reflect it.
  await page.goto('/spools?sort=leastRemaining')
  await expect(page).toHaveURL(/\/spools\?sort=leastRemaining$/)
  await expect(page.getByLabel('Sort')).toHaveValue('leastRemaining')
  await expectBefore(page, low, high)

  // AC-15: changing the selector updates the URL before re-querying and reverses the order.
  const mostResp = page.waitForResponse(
    r => r.url().includes('/api/spools') && r.url().includes('sort=mostRemaining') && r.request().method() === 'GET')
  await page.getByLabel('Sort').selectOption('mostRemaining')
  await mostResp
  await expect(page).toHaveURL(/\/spools\?sort=mostRemaining$/)
  await expect(page.getByLabel('Sort')).toHaveValue('mostRemaining')
  await expectBefore(page, high, low)

  // AC-13: /spools (no sort) loads the default; the selector shows "Last used" and the URL is
  // normalized to the resolved default.
  await page.goto('/spools')
  await expect(page.getByLabel('Sort')).toHaveValue('lastUsed')
  await expect(page).toHaveURL(/\/spools(\?sort=lastUsed)?$/)
})

// AC-14
test('unknown sort value falls back to lastUsed without error', async ({ page, seed }) => {
  await createSpoolViaUi(page, seed.type.id, 50)

  // Record (and dismiss) any alert() dialog the app might show on an error; assert none appears.
  const dialogs: string[] = []
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => { /* */ }) })

  await page.goto('/spools?sort=garbage')
  // The selector resolves to the default; the URL is normalized to the resolved default.
  await expect(page.getByLabel('Sort')).toHaveValue('lastUsed')
  await expect(page).toHaveURL(/\/spools\?sort=lastUsed$/)
  // The list renders (no error path).
  await expect(page.locator('tbody tr td a.id-pill').first()).toBeVisible()
  expect(dialogs, 'no error dialog should be shown for an unknown sort value').toEqual([])
})

// AC-16
test('sort is preserved after a data reload', async ({ page, seed }) => {
  const low = await createSpoolViaUi(page, seed.type.id, 3)
  const high = await createSpoolViaUi(page, seed.type.id, 99997)

  await page.goto('/spools?sort=leastRemaining')
  await expect(page.getByLabel('Sort')).toHaveValue('leastRemaining')
  await expectBefore(page, low, high)
  const before = await getSpoolIdsInOrder(page)

  // A WebSocket `change` notification triggers a data reload (load()). A full page reload is a
  // superset of that: the component re-reads the active sort from the URL and re-queries. The sort
  // itself is not changed by a reload (per spec).
  await page.reload()
  await expect(page.getByLabel('Sort')).toHaveValue('leastRemaining')
  await expect(page).toHaveURL(/\/spools\?sort=leastRemaining$/)
  await expect(async () => {
    const after = await page.locator('tbody tr td a.id-pill').allInnerTexts()
    expect(after).toEqual(before)
  }).toPass({ timeout: 10000 })
})

// AC-17
test('frontend does not reorder client-side', async ({ page, seed }) => {
  await createSpoolViaUi(page, seed.type.id, 4)
  await createSpoolViaUi(page, seed.type.id, 99996)

  await page.goto('/spools?sort=mostRemaining')
  await expect(page.getByLabel('Sort')).toHaveValue('mostRemaining')

  // The UI row order, captured from the rendered DOM...
  const uiOrder = await page.locator('tbody tr td a.id-pill').allInnerTexts()
  expect(uiOrder.length).toBeGreaterThan(0)

  // ...must equal the order returned by the API for the same sort (no client-side reordering).
  const apiOrder = (await (await page.request.get('/api/spools?sort=mostRemaining')).json())
    .items.map((s: { id: string }) => s.id)

  expect(uiOrder).toEqual(apiOrder)
})
