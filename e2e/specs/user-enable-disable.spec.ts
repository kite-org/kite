import { type Browser, type Page, expect, test } from '@playwright/test'

async function openUsersPage(page: Page) {
  await page.goto('/settings?tab=users')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Password User' })).toBeVisible()
}

async function createPasswordUser(
  page: Page,
  username: string,
  name: string,
  password: string
) {
  await page.getByRole('button', { name: 'Add Password User' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add Password User' })
  await expect(dialog).toBeVisible()

  await dialog.locator('input').nth(0).fill(username)
  await dialog.locator('input').nth(1).fill(name)
  await dialog.locator('input').nth(2).fill(password)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: username })).toBeVisible()
}

async function assignViewerRole(page: Page, username: string) {
  const row = page.getByRole('row').filter({ hasText: username }).first()
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: '•••' }).click()
  await page.getByRole('menuitem', { name: 'Assign' }).click()

  const dialog = page.getByRole('dialog', { name: 'Assign Roles' })
  await expect(dialog).toBeVisible()

  const checkbox = dialog.getByRole('checkbox').nth(1)
  await expect(checkbox).toBeVisible()
  await checkbox.click()
  await expect(checkbox).toBeChecked()

  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: username })).toContainText(
    'viewer'
  )
}

async function toggleUserEnabled(
  page: Page,
  username: string,
  actionName: 'Disable' | 'Enable'
) {
  const row = page.getByRole('row').filter({ hasText: username }).first()
  await expect(row).toBeVisible()

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/admin/users/') &&
      response.request().method() === 'POST' &&
      response.url().endsWith('/enable') &&
      response.status() === 200
  )

  await row.getByRole('button', { name: '•••' }).click()
  await page.getByRole('menuitem', { name: actionName }).click()

  await responsePromise

  await expect(row).toContainText(actionName === 'Disable' ? 'Disabled' : 'Enabled')
}

async function deleteUser(page: Page, username: string) {
  const row = page.getByRole('row').filter({ hasText: username }).first()
  await expect(row).toBeVisible()

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/admin/users/') &&
      response.request().method() === 'DELETE' &&
      response.status() === 200
  )

  await row.getByRole('button', { name: '•••' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()

  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder(username).fill(username)
  await dialog.getByRole('button', { name: 'Delete' }).click()

  await responsePromise
  await expect(page.getByRole('row').filter({ hasText: username })).toHaveCount(
    0
  )
}

async function loginWithPasswordUi(
  page: Page,
  username: string,
  password: string
) {
  await expect(
    page.getByRole('button', { name: 'Sign In with Password' })
  ).toBeVisible()

  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In with Password' }).click()
}

async function loginFreshContext(
  browser: Browser,
  origin: string,
  username: string,
  password: string
) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()

  await page.goto(`${origin}/login`)
  await loginWithPasswordUi(page, username, password)
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  return { context, page }
}

async function loginFreshContextExpectFailure(
  browser: Browser,
  origin: string,
  username: string,
  password: string
) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()

  await page.goto(`${origin}/login`)
  await loginWithPasswordUi(page, username, password)
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('alert')).toContainText('insufficient permissions')

  return { context, page }
}

test('password user can be disabled, re-enabled, and deleted', async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36)
  const user = {
    username: `e2e-disabled-${suffix}`,
    name: 'E2E Disabled',
    password: 'E2Epass!2345',
  }

  await openUsersPage(page)
  const origin = new URL(page.url()).origin

  await createPasswordUser(page, user.username, user.name, user.password)
  await assignViewerRole(page, user.username)

  const firstSession = await loginFreshContext(
    browser,
    origin,
    user.username,
    user.password
  )
  await firstSession.context.close()

  await openUsersPage(page)
  await toggleUserEnabled(page, user.username, 'Disable')

  const disabledSession = await loginFreshContextExpectFailure(
    browser,
    origin,
    user.username,
    user.password
  )
  await disabledSession.context.close()

  await openUsersPage(page)
  await toggleUserEnabled(page, user.username, 'Enable')

  const secondSession = await loginFreshContext(
    browser,
    origin,
    user.username,
    user.password
  )
  await secondSession.context.close()

  await openUsersPage(page)
  await deleteUser(page, user.username)
})
