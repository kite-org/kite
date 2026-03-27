import { expect, test } from '@playwright/test'

test('admin can create a password user from settings', async ({ page }) => {
  const username = `e2e-user-${Date.now()}`
  const displayName = 'E2E User'
  const password = 'E2Epass!2345'

  await page.goto('/settings?tab=users')

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Add Password User' })
  ).toBeVisible()

  await page.getByRole('button', { name: 'Add Password User' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add Password User' })
  await expect(dialog).toBeVisible()

  await dialog.locator('input').nth(0).fill(username)
  await dialog.locator('input').nth(1).fill(displayName)
  await dialog.locator('input').nth(2).fill(password)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: username })).toBeVisible()
})
