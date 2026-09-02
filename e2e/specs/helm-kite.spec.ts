import { expect, test, type Locator, type Page } from '@playwright/test'

const chartName = 'kite'
const repositoryURL = 'https://kite-org.github.io/kite/'
const installVersion = '0.10.0'
const specifiedUpgradeVersion = '0.11.0'
const namespace = 'default'
const baseValues = `replicaCount: 1
anonymousUserEnabled: true
podLabels:
  e2e-mode: base
`
const upgradedValues = `replicaCount: 1
anonymousUserEnabled: true
podLabels:
  e2e-mode: upgraded
`

// Both the install and upgrade dialogs render a single kubeapps-style inline
// diff editor; the editable pane is the diff editor's "modified" editor.
function valuesEditorText(root: Locator) {
  return root.locator(
    '.monaco-diff-editor .editor.modified .monaco-editor .view-lines'
  )
}

// Synthetic clicks/keyboard are unreliable against monaco (virtualized
// scrolling + EditContext input), so set the value through the monaco API
// exposed on window by ui/src/lib/monaco-runtime.ts.
async function fillValuesEditor(
  page: Page,
  root: Locator,
  value: string,
  waitForText?: string
) {
  const editorText = valuesEditorText(root)

  await expect(editorText).toBeVisible({ timeout: 60_000 })
  if (waitForText) {
    // Wait for async prefill (chart default values) so it cannot race the fill.
    await expect(editorText).toContainText(waitForText, { timeout: 60_000 })
  }
  const firstLine = value.trim().split('\n')[0]

  await page.evaluate((newValue) => {
    type DiffEditorLike = {
      getContainerDomNode: () => HTMLElement
      getModifiedEditor: () => { setValue: (value: string) => void }
    }
    const monaco = (
      window as unknown as {
        monaco?: { editor: { getDiffEditors: () => DiffEditorLike[] } }
      }
    ).monaco
    const dialog = document.querySelector('[role="dialog"]')
    const diffEditor = monaco?.editor
      .getDiffEditors()
      .find((editor) => dialog?.contains(editor.getContainerDomNode()))
    if (!diffEditor) {
      throw new Error('No monaco diff editor found in the open dialog')
    }
    diffEditor.getModifiedEditor().setValue(newValue)
  }, value)
  await expect(editorText).toContainText(firstLine)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function selectRepositoryFilter(page: Page, repositoryName: string) {
  await page.locator('[data-slot="select-trigger"]').first().click()
  await page.getByRole('option', { name: repositoryName }).click()
}

async function switchToRepositories(page: Page) {
  await page.getByText('Repositories', { exact: true }).click()
}

async function selectUpgradeChart(
  page: Page,
  dialog: Locator,
  repositoryName: string
) {
  const selectTriggers = dialog.locator('[data-slot="select-trigger"]')
  if ((await selectTriggers.count()) < 2) {
    return
  }

  await selectTriggers.first().click()
  await page
    .getByRole('option', {
      name: new RegExp(`${escapeRegExp(repositoryName)}/${chartName}`),
    })
    .click()
}

async function selectUpgradeVersion(
  page: Page,
  dialog: Locator,
  version: string
) {
  const versionSelect = dialog.locator('[data-slot="select-trigger"]').last()
  await expect(versionSelect).toBeVisible({ timeout: 60_000 })
  await versionSelect.click()
  await page
    .getByRole('option', {
      name: new RegExp(`^${escapeRegExp(version)}(?:\\s|$)`),
    })
    .click()
}

async function expectReleaseSummary(
  page: Page,
  releaseName: string,
  version: string,
  revision: number
) {
  await expect(page.getByRole('heading', { name: releaseName })).toBeVisible({
    timeout: 120_000,
  })
  await page.getByRole('tab', { name: 'Overview' }).click()

  const chartSummary = page
    .locator(`[title="${chartName}"]`)
    .locator('xpath=..')
  await expect(chartSummary).toContainText(version, { timeout: 120_000 })

  const revisionSummary = page
    .getByText('Revision', { exact: true })
    .locator('xpath=..')
  await expect(revisionSummary).toContainText(String(revision), {
    timeout: 120_000,
  })
}

async function expectReleaseValues(
  page: Page,
  expectedText: string,
  absentText?: string
) {
  await page.getByRole('tab', { name: 'Values' }).click()
  const editorText = page.locator('.monaco-editor .view-lines').first()
  // Stored values are pruned to the minimal override set, so keys equal to the
  // chart defaults (like replicaCount: 1) are absent — anchor on a real override.
  await expect(editorText).toContainText('anonymousUserEnabled:', {
    timeout: 60_000,
  })
  await expect(editorText).toContainText(expectedText)
  if (absentText) {
    await expect(editorText).not.toContainText(absentText)
  }
}

async function expectAppliedPodLabel(
  page: Page,
  releaseName: string,
  expectedMode: string
) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/v1/deployments/${namespace}?labelSelector=${encodeURIComponent(
            `app.kubernetes.io/instance=${releaseName}`
          )}`
        )
        if (!response.ok()) {
          return ''
        }
        const body = (await response.json()) as {
          items?: Array<{
            spec?: {
              template?: {
                metadata?: {
                  labels?: Record<string, string>
                }
              }
            }
          }>
        }
        const labels = (body.items || []).map(
          (item) => item.spec?.template?.metadata?.labels?.['e2e-mode'] || ''
        )
        if (!labels.length || labels.some((label) => !label)) {
          return ''
        }
        return labels.every((label) => label === expectedMode)
          ? expectedMode
          : labels.join(',')
      },
      { timeout: 60_000 }
    )
    .toBe(expectedMode)
}

async function expectDryRunPreview(dialog: Locator) {
  await expect(dialog.getByText('Dry run preview')).toBeVisible({
    timeout: 120_000,
  })
  await expect(
    dialog.getByText('No resources rendered by dry run.')
  ).toBeHidden()
}

async function deleteReleaseFromCurrentPage(page: Page, releaseName: string) {
  await page.getByRole('button', { name: 'Delete' }).click()
  const deleteDialog = page.getByRole('dialog').filter({ hasText: releaseName })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByPlaceholder(releaseName).fill(releaseName)
  await expect(
    deleteDialog.getByRole('button', { name: 'Delete' })
  ).toBeEnabled()
  await deleteDialog.getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL('**/helmrelease', { timeout: 120_000 })
}

async function deleteRepositoryFromChartsPage(
  page: Page,
  repositoryName: string
) {
  await page.goto('/charts')
  await switchToRepositories(page)
  await selectRepositoryFilter(page, repositoryName)
  await page.getByRole('button', { name: 'Delete Repository' }).click()

  const deleteDialog = page
    .getByRole('dialog')
    .filter({ hasText: repositoryName })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByPlaceholder(repositoryName).fill(repositoryName)
  await expect(
    deleteDialog.getByRole('button', { name: 'Delete' })
  ).toBeEnabled()
  await deleteDialog.getByRole('button', { name: 'Delete' }).click()
  await expect(deleteDialog).toBeHidden({ timeout: 60_000 })
  await expect(
    page.getByRole('button', { name: 'Delete Repository' })
  ).toBeHidden()
}

async function cleanupReleaseFromUI(page: Page, releaseName: string) {
  try {
    await page.goto(`/helmrelease/${namespace}/${releaseName}`)
    const deleteButton = page.getByRole('button', { name: 'Delete' })
    if (await deleteButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteReleaseFromCurrentPage(page, releaseName)
    }
  } catch {
    // Best-effort UI cleanup only.
  }
}

async function cleanupRepositoryFromUI(page: Page, repositoryName: string) {
  try {
    await page.goto('/charts')
    await switchToRepositories(page)
    await page.locator('[data-slot="select-trigger"]').first().click()
    const option = page.getByRole('option', { name: repositoryName })
    if (!(await option.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.keyboard.press('Escape')
      return
    }
    await option.click()
    await page.getByRole('button', { name: 'Delete Repository' }).click()

    const deleteDialog = page
      .getByRole('dialog')
      .filter({ hasText: repositoryName })
    await deleteDialog.getByPlaceholder(repositoryName).fill(repositoryName)
    await deleteDialog.getByRole('button', { name: 'Delete' }).click()
    await expect(deleteDialog).toBeHidden({ timeout: 60_000 })
  } catch {
    // Best-effort UI cleanup only.
  }
}

test.describe('helm kite lifecycle', () => {
  test.setTimeout(8 * 60 * 1000)

  test('manages the kite repository and release lifecycle through the UI', async ({
    page,
  }) => {
    const suffix = Date.now().toString(36)
    const repositoryName = `e2e-kite-${suffix}`
    const releaseName = `e2e-kite-${suffix}`
    let repositoryDeleted = false
    let releaseDeleted = false

    try {
      await page.goto('/charts')
      const origin = new URL(page.url()).origin
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'], { origin })

      await switchToRepositories(page)
      await page.getByRole('button', { name: 'Add Repository' }).first().click()

      const addRepositoryDialog = page.getByRole('dialog', {
        name: 'Add Repository',
      })
      await expect(addRepositoryDialog).toBeVisible()
      await addRepositoryDialog
        .locator('#helm-repository-name')
        .fill(repositoryName)
      await addRepositoryDialog
        .locator('#helm-repository-url')
        .fill(repositoryURL)
      await addRepositoryDialog.getByRole('button', { name: 'Add' }).click()
      await expect(addRepositoryDialog).toBeHidden({ timeout: 60_000 })

      await selectRepositoryFilter(page, repositoryName)
      await page.getByPlaceholder('Search charts...').fill(chartName)
      const chartLink = page.getByRole('link', {
        name: chartName,
        exact: true,
      })
      await expect(chartLink).toBeVisible({ timeout: 60_000 })

      await chartLink.click()
      await page.waitForURL(
        `**/charts/${encodeURIComponent(repositoryName)}/${chartName}`
      )
      await page.goto(
        `/charts/${encodeURIComponent(repositoryName)}/${encodeURIComponent(chartName)}?version=${encodeURIComponent(installVersion)}`
      )

      await expect(
        page.getByRole('heading', { name: chartName }).first()
      ).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText(installVersion).first()).toBeVisible()
      await page.getByRole('tab', { name: 'Values' }).click()
      await expect(page.locator('.monaco-editor').first()).toBeVisible({
        timeout: 60_000,
      })
      await page.getByRole('tab', { name: 'Versions' }).click()
      await expect(
        page.getByRole('link', { name: specifiedUpgradeVersion })
      ).toBeVisible()

      await page.getByRole('button', { name: 'Install' }).click()
      const installDialog = page.getByRole('dialog', { name: 'Install' })
      await expect(installDialog).toBeVisible()
      await installDialog.getByLabel('Release Name').fill(releaseName)
      await fillValuesEditor(page, installDialog, baseValues, 'replicaCount:')
      await expect(
        installDialog.getByRole('button', { name: 'Dry Run' })
      ).toBeEnabled({ timeout: 60_000 })
      await installDialog.getByRole('button', { name: 'Dry Run' }).click()
      await expectDryRunPreview(installDialog)
      await expect(
        installDialog.getByRole('button', { name: 'Install' })
      ).toBeEnabled({ timeout: 60_000 })
      await installDialog.getByRole('button', { name: 'Install' }).click()

      await page.waitForURL(
        `**/helmrelease/${namespace}/${encodeURIComponent(releaseName)}`,
        { timeout: 120_000 }
      )
      await expectReleaseSummary(page, releaseName, installVersion, 1)
      await expectReleaseValues(page, 'e2e-mode: base', 'e2e-mode: upgraded')
      await expectAppliedPodLabel(page, releaseName, 'base')

      await page.getByRole('button', { name: 'Upgrade', exact: true }).click()
      const customValuesUpgradeDialog = page.getByRole('dialog', {
        name: 'Upgrade',
      })
      await expect(customValuesUpgradeDialog).toBeVisible()
      await fillValuesEditor(page, customValuesUpgradeDialog, upgradedValues)
      await expect(
        customValuesUpgradeDialog.getByRole('button', { name: 'Dry Run' })
      ).toBeEnabled({ timeout: 60_000 })
      await customValuesUpgradeDialog
        .getByRole('button', { name: 'Dry Run' })
        .click()
      await expectDryRunPreview(customValuesUpgradeDialog)
      await expect(
        customValuesUpgradeDialog.getByText('Changed').first()
      ).toBeVisible()
      await expect(
        customValuesUpgradeDialog.getByRole('button', { name: 'Upgrade' })
      ).toBeEnabled({ timeout: 60_000 })
      await customValuesUpgradeDialog
        .getByRole('button', { name: 'Upgrade' })
        .click()
      await expect(customValuesUpgradeDialog).toBeHidden({ timeout: 120_000 })

      await page.reload()
      await expectReleaseSummary(page, releaseName, installVersion, 2)
      await expectReleaseValues(page, 'e2e-mode: upgraded')
      await expectAppliedPodLabel(page, releaseName, 'upgraded')

      await page.getByRole('tab', { name: 'History' }).click()
      await expect(
        page.getByRole('button', { name: 'Rollback' }).first()
      ).toBeEnabled({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Rollback' }).first().click()

      const rollbackDialog = page.getByRole('dialog', {
        name: 'Rollback release?',
      })
      await expect(rollbackDialog).toBeVisible()
      await rollbackDialog.getByRole('button', { name: 'Rollback' }).click()
      await expect(rollbackDialog).toBeHidden({ timeout: 120_000 })

      await page.reload()
      await expectReleaseSummary(page, releaseName, installVersion, 3)
      await expectReleaseValues(page, 'e2e-mode: base', 'e2e-mode: upgraded')
      await expectAppliedPodLabel(page, releaseName, 'base')

      await page.getByRole('button', { name: 'Upgrade', exact: true }).click()
      const versionUpgradeDialog = page.getByRole('dialog', {
        name: 'Upgrade',
      })
      await expect(versionUpgradeDialog).toBeVisible()
      await selectUpgradeChart(page, versionUpgradeDialog, repositoryName)
      await selectUpgradeVersion(
        page,
        versionUpgradeDialog,
        specifiedUpgradeVersion
      )
      await fillValuesEditor(page, versionUpgradeDialog, upgradedValues)
      // Resolving the chart package URL for a specific version can exceed 60s
      // on slow networks; keep in line with the 120s/180s waits around it.
      await expect(
        versionUpgradeDialog.getByRole('button', { name: 'Upgrade' })
      ).toBeEnabled({ timeout: 120_000 })
      await versionUpgradeDialog
        .getByRole('button', { name: 'Upgrade' })
        .click()
      await expect(versionUpgradeDialog).toBeHidden({ timeout: 180_000 })

      await page.reload()
      await expectReleaseSummary(page, releaseName, specifiedUpgradeVersion, 4)
      await expectReleaseValues(page, 'e2e-mode: upgraded')
      await expectAppliedPodLabel(page, releaseName, 'upgraded')

      await deleteReleaseFromCurrentPage(page, releaseName)
      await page.getByPlaceholder(/^Search Helm Release/).fill(releaseName)
      await expect(page.getByRole('link', { name: releaseName })).toHaveCount(0)
      releaseDeleted = true

      await deleteRepositoryFromChartsPage(page, repositoryName)
      repositoryDeleted = true
    } finally {
      if (!releaseDeleted) {
        await cleanupReleaseFromUI(page, releaseName)
      }
      if (!repositoryDeleted) {
        await cleanupRepositoryFromUI(page, repositoryName)
      }
    }
  })
})
