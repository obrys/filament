import { test as base, expect } from '@playwright/test'
import { unique } from './ids'

export type Seed = {
  type: { id: string; brand: string; material: string; type: string; color: string }
  spool: { id: string }
}

export const test = base.extend<{ seed: Seed }>({
  seed: async ({ page }, use) => {
    const brand = unique('e2e-brand')
    const material = unique('e2e-mat')
    const productType = unique('e2e-type')
    const color = unique('e2e-color')

    await page.goto('/types')
    await page.getByRole('button', { name: 'New type' }).click()
    const typeForm = page.locator('form.card')
    await typeForm.getByLabel('Brand').fill(brand)
    await typeForm.getByLabel('Material').fill(material)
    await typeForm.getByLabel('Type').fill(productType)
    await typeForm.getByLabel('Color').fill(color)
    await typeForm.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.locator('tbody')).toContainText(brand)

    const typeId = await page.locator('tbody tr', { hasText: brand }).locator('span.id-pill').innerText()

    await page.goto('/spools')
    await page.getByRole('button', { name: 'New spool' }).click()
    const spoolForm = page.locator('form.card')
    await spoolForm.getByLabel('Filament type').selectOption(typeId)
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/spools') && r.request().method() === 'POST'),
      spoolForm.getByRole('button', { name: 'Create', exact: true }).click(),
    ])
    // The spool list is sorted by last-used desc / id asc, so the created spool is not
    // guaranteed to be the first row — the id comes from the POST response.
    const spoolId = (await resp.json()).id as string
    expect(spoolId).toMatch(/^[0-9A-HJ-NP-TV-Z]{4}$/)

    await use({ type: { id: typeId, brand, material, type: productType, color }, spool: { id: spoolId } })
  },
})

export { expect }
