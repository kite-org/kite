import { expect, test } from '@playwright/test'

test('sidebar customization persists after refresh', async ({ page }) => {
  const customizeDialog = page.getByRole('dialog', {
    name: 'Customize Sidebar',
  })

  await page.goto('/')

  await page.locator('header').getByRole('button').last().click()
  await page.getByRole('menuitem', { name: 'Customize Sidebar' }).click()

  await expect(customizeDialog).toBeVisible()
  await expect(customizeDialog.getByText('Pods', { exact: true })).toBeVisible()
  await customizeDialog.getByRole('button', { name: 'Pin to top' }).first().click()

  await expect(customizeDialog.getByText('Pinned Items')).toBeVisible()
  await customizeDialog.getByRole('button', { name: 'Done' }).click()
  await expect(customizeDialog).toBeHidden()

  await page.reload()

  await expect(page.locator('body')).toContainText('Pinned')
})
