import { expect, test } from '@playwright/test'

import { kindClusterName } from '../env'

const controlPlaneNodeName = `${kindClusterName}-control-plane`

test.describe('resource detail navigation', () => {
  test('navigates from the services list to service detail', async ({
    page,
  }) => {
    await page.goto('/services')

    await page.getByPlaceholder('Search services...').fill('kubernetes')
    const serviceLink = page.getByRole('link', { name: 'kubernetes' })
    await expect(serviceLink).toBeVisible()
    await serviceLink.click()

    await page.waitForURL('**/services/default/kubernetes')
    await expect(page.getByText('Namespace: default')).toBeVisible()
    await expect(
      page
        .getByRole('navigation', { name: 'breadcrumb' })
        .getByRole('link', { name: 'kubernetes' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  })

  test('navigates from the nodes list to node detail', async ({ page }) => {
    await page.goto('/nodes')

    await page
      .getByPlaceholder('Search nodes...')
      .fill(controlPlaneNodeName)
    const nodeLink = page.getByRole('link', { name: controlPlaneNodeName })
    await expect(nodeLink).toBeVisible()
    await nodeLink.click()

    await page.waitForURL(`**/nodes/${controlPlaneNodeName}`)
    await expect(
      page
        .getByRole('navigation', { name: 'breadcrumb' })
        .getByRole('link', { name: controlPlaneNodeName })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  })

  test('navigates from the pods list to pod detail and loads logs, yaml, and terminal tabs', async ({
    page,
  }) => {
    const podName = `e2e-nginx-${Date.now()}`
    const podYaml = `apiVersion: v1
kind: Pod
metadata:
  name: ${podName}
  namespace: default
spec:
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      ports:
        - containerPort: 80
`
    const pasteShortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+V'

    await page.goto('/')
    const origin = new URL(page.url()).origin
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    await page.getByLabel('Create new resource').click()

    const createDialog = page.getByRole('dialog', { name: 'Create Resource' })
    await expect(createDialog).toBeVisible()

    await page.evaluate(
      async (value) => await navigator.clipboard.writeText(value),
      podYaml
    )
    await createDialog
      .locator('.monaco-editor .view-lines')
      .click({ position: { x: 10, y: 10 } })
    await page.keyboard.press(pasteShortcut)
    await expect(
      createDialog.getByRole('button', { name: 'Apply' })
    ).toBeEnabled()

    await createDialog.getByRole('button', { name: 'Apply' }).click()
    await expect(createDialog).toBeHidden()

    await page.goto('/pods')
    await page.getByPlaceholder('Search pods...').fill(podName)

    const row = page.getByRole('row').filter({ hasText: podName })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Running', { timeout: 30_000 })

    await row.getByRole('link', { name: podName }).click()

    await page.waitForURL(`**/pods/default/${podName}`)
    await expect(
      page
        .getByRole('navigation', { name: 'breadcrumb' })
        .getByRole('link', { name: podName })
    ).toBeVisible()

    await page.getByRole('tab', { name: 'Logs' }).click()
    await page.waitForURL(
      (url) =>
        url.pathname === `/pods/default/${podName}` &&
        url.searchParams.get('tab') === 'logs'
    )
    await expect(page.getByPlaceholder('Filter logs...')).toBeVisible()

    await page.getByRole('tab', { name: 'YAML' }).click()
    await page.waitForURL(
      (url) =>
        url.pathname === `/pods/default/${podName}` &&
        url.searchParams.get('tab') === 'yaml'
    )
    await expect(page.getByText('YAML Configuration')).toBeVisible()

    await page.getByRole('tab', { name: 'Terminal' }).click()
    await page.waitForURL(
      (url) =>
        url.pathname === `/pods/default/${podName}` &&
        url.searchParams.get('tab') === 'terminal'
    )
    await expect(page.locator('.xterm').first()).toBeVisible()

    await page.getByRole('button', { name: 'Delete' }).click()

    const deleteDialog = page.getByRole('dialog').filter({ hasText: podName })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByPlaceholder(podName).fill(podName)
    await expect(
      deleteDialog.getByRole('button', { name: 'Delete' })
    ).toBeEnabled()
    await deleteDialog.getByRole('button', { name: 'Delete' }).click()

    await page.waitForURL('**/pods')
  })
})
