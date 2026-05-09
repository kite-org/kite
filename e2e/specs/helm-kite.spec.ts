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

async function fillMonacoEditor(
  page: Page,
  root: Locator,
  editorIndex: number,
  value: string
) {
  const editor = root.locator('.monaco-editor').nth(editorIndex)
  const editorText = editor.locator('.view-lines')

  await expect(editor).toBeVisible({ timeout: 60_000 })
  const firstLine = value.trim().split('\n')[0]
  const shortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const pasteShortcut = `${shortcutModifier}+V`

  await editorText.click({ position: { x: 10, y: 10 } })
  await page.keyboard.press(`${shortcutModifier}+A`)
  await page.keyboard.press('Backspace')
  await page.evaluate(
    async (text) => navigator.clipboard.writeText(text),
    value
  )
  await page.keyboard.press(pasteShortcut)
  const pastedText = ((await editorText.textContent()) || '').replace(
    /\u00a0/g,
    ' '
  )
  if (!pastedText.includes(firstLine)) {
    await page.keyboard.press(pasteShortcut)
  }
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
  await expect(editorText).toContainText('replicaCount:', { timeout: 60_000 })
  await expect(editorText).toContainText(expectedText)
  if (absentText) {
    await expect(editorText).not.toContainText(absentText)
  }
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
      await fillMonacoEditor(page, installDialog, 1, baseValues)
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

      await page.getByRole('button', { name: 'Upgrade' }).click()
      const customValuesUpgradeDialog = page.getByRole('dialog', {
        name: 'Upgrade',
      })
      await expect(customValuesUpgradeDialog).toBeVisible()
      await fillMonacoEditor(page, customValuesUpgradeDialog, 1, upgradedValues)
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

      await page.getByRole('button', { name: 'Upgrade' }).click()
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
      await fillMonacoEditor(page, versionUpgradeDialog, 1, upgradedValues)
      await expect(
        versionUpgradeDialog.getByRole('button', { name: 'Upgrade' })
      ).toBeEnabled({ timeout: 60_000 })
      await versionUpgradeDialog
        .getByRole('button', { name: 'Upgrade' })
        .click()
      await expect(versionUpgradeDialog).toBeHidden({ timeout: 180_000 })

      await page.reload()
      await expectReleaseSummary(page, releaseName, specifiedUpgradeVersion, 4)
      await expectReleaseValues(page, 'e2e-mode: upgraded')

      await deleteReleaseFromCurrentPage(page, releaseName)
      await page.getByPlaceholder('Search Helm Release...').fill(releaseName)
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
