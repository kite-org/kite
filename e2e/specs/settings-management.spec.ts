import { expect, test } from '@playwright/test'

test.describe('settings management', () => {
  test('creates an API key and shows it in the table', async ({ page }) => {
    const apiKeyName = `e2e-api-key-${Date.now()}`

    await page.goto('/settings?tab=apikeys')

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add API Key' })).toBeVisible()

    await page.getByRole('button', { name: 'Add API Key' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Create API Key' })
    ).toBeVisible()

    await page.getByLabel('Name').fill(apiKeyName)
    await page.getByRole('button', { name: 'Create' }).click()

    const row = page.getByRole('row').filter({ hasText: apiKeyName })
    await expect(row).toBeVisible()
    await expect(row.locator('code')).not.toHaveText(/^•+$/)
  })
})
