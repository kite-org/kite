import { expect, test } from '@playwright/test'

import { kindClusterName } from '../env'

test.describe('cluster management', () => {
  test('shows the imported kind cluster on the clusters tab', async ({
    page,
  }) => {
    await page.goto('/settings?tab=clusters')

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Add Cluster' })
    ).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: kindClusterName })).toBeVisible()
  })

  test('can update the cluster description', async ({ page }) => {
    const description = `E2E cluster description ${Date.now()}`
    const row = page.getByRole('row').filter({ hasText: kindClusterName })

    await page.goto('/settings?tab=clusters')
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: '•••' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit Cluster' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Description').fill(description)
    await dialog.getByRole('button', { name: 'Save Changes' }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole('row').filter({ hasText: description })).toBeVisible()
  })
})
