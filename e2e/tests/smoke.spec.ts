import { test, expect } from './fixtures/seed'

test('dashboard starts empty on a fresh database', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.muted:has-text("Filament types") + div')).toHaveText('0')
  await expect(page.locator('.muted:has-text("Active spools") + div')).toHaveText('0')
  await expect(page.locator('.muted:has-text("Finished spools") + div')).toHaveText('0')
})

test('seeded type and spool appear in lists and dashboard', async ({ page, seed }) => {
  await page.goto('/types')
  await expect(page.locator('tbody')).toContainText(seed.type.brand)

  await page.goto('/spools')
  await expect(page.locator('tbody')).toContainText(seed.spool.id)
  await expect(page.locator('tbody')).toContainText(seed.type.brand)

  await page.goto('/')
  await expect(page.locator('.muted:has-text("Filament types") + div')).toHaveText('1')
  await expect(page.locator('.muted:has-text("Active spools") + div')).toHaveText('1')
})
