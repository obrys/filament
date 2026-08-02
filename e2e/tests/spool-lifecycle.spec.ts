import { test, expect } from './fixtures/seed'
import type { Page } from '@playwright/test'

async function getRemaining(page: Page): Promise<number> {
  const text = await page.getByText('Remaining:').locator('..').innerText()
  const match = text.match(/Remaining:\s*(\d+)\s*g/)
  if (!match) throw new Error(`Could not parse remaining from: ${text}`)
  return parseInt(match[1], 10)
}

async function expectStatus(page: Page, status: string): Promise<void> {
  await expect(page.getByText('Status:').locator('..')).toContainText(status)
}

async function getStat(page: Page, label: string): Promise<number> {
  const text = await page.locator(`.muted:has-text("${label}") + div`).innerText()
  return parseInt(text.trim(), 10)
}

test('spool open → consume → adjust → finish → reopen', async ({ page, seed }) => {
  await page.goto(`/spools/${seed.spool.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(seed.spool.id)

  await expectStatus(page, 'Sealed')
  const initial = await getRemaining(page)

  await page.getByRole('button', { name: 'Open spool' }).click()
  await expectStatus(page, 'Open')
  await expect(page.locator('.muted:has-text("Opened")')).toBeVisible()

  await page.getByLabel(/Grams used/).fill('100')
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  await expect(async () => {
    expect(await getRemaining(page)).toBe(initial - 100)
  }).toPass()

  await page.getByLabel('New remaining (g)').fill('500')
  await page.getByRole('button', { name: 'Adjust', exact: true }).click()
  await expect(async () => {
    expect(await getRemaining(page)).toBe(500)
  }).toPass()

  await page.goto('/')
  const activeBefore = await getStat(page, 'Active spools')
  const finishedBefore = await getStat(page, 'Finished spools')

  await page.goto(`/spools/${seed.spool.id}`)
  await expectStatus(page, 'Open')
  await page.getByRole('button', { name: 'Finish spool' }).click()
  await expectStatus(page, 'Finished')
  await expect(page.locator('.muted:has-text("Finished")')).toBeVisible()

  await page.goto('/')
  await expect(async () => {
    expect(await getStat(page, 'Active spools')).toBe(activeBefore - 1)
  }).toPass()
  await expect(async () => {
    expect(await getStat(page, 'Finished spools')).toBe(finishedBefore + 1)
  }).toPass()

  await page.goto(`/spools/${seed.spool.id}`)
  await expectStatus(page, 'Finished')
  await page.getByRole('button', { name: 'Reopen spool' }).click()
  await expectStatus(page, 'Open')
})
