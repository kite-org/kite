import { expect, test } from '@playwright/test'

import { kindClusterName } from '../env'

const controlPlaneNodeName = `${kindClusterName}-control-plane`

test.describe('cluster resources', () => {
  test('shows the kind control-plane node on the nodes page', async ({
    page,
  }) => {
    await page.goto('/nodes')

    await expect(
      page.getByRole('link', { name: controlPlaneNodeName })
    ).toBeVisible()
  })

  test('shows stable namespaces on the namespaces page', async ({ page }) => {
    await page.goto('/namespaces')

    await expect(page.getByRole('link', { name: 'kube-system' })).toBeVisible()
  })
})
