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

async function resetPassword(
  page: Page,
  username: string,
  password: string
) {
  const row = page.getByRole('row').filter({ hasText: username }).first()
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: '•••' }).click()
  await page.getByRole('menuitem', { name: 'Reset Password' }).click()

  const dialog = page.getByRole('dialog', { name: 'Reset Password' })
  await expect(dialog).toBeVisible()

  await dialog.locator('input').fill(password)
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(dialog).toBeHidden()
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

async function deleteUser(page: Page, username: string) {
  const row = page.getByRole('row').filter({ hasText: username }).first()
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: '•••' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()

  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder(username).fill(username)
  await dialog.getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByRole('row').filter({ hasText: username })).toHaveCount(0)
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

test('password reset updates login credentials', async ({ page, browser }) => {
  const suffix = Date.now().toString(36)
  const user = {
    username: `e2e-reset-${suffix}`,
    name: 'E2E Reset User',
    originalPassword: 'E2Epass!2345',
    newPassword: 'E2Epass!6789',
  }

  await openUsersPage(page)
  const origin = new URL(page.url()).origin

  await createPasswordUser(
    page,
    user.username,
    user.name,
    user.originalPassword
  )
  await assignViewerRole(page, user.username)

  const originalSession = await loginFreshContext(
    browser,
    origin,
    user.username,
    user.originalPassword
  )
  await originalSession.context.close()

  await openUsersPage(page)
  await resetPassword(page, user.username, user.newPassword)

  const oldPasswordSession = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  const oldPasswordPage = await oldPasswordSession.newPage()
  await oldPasswordPage.goto(`${origin}/login`)
  await loginWithPasswordUi(
    oldPasswordPage,
    user.username,
    user.originalPassword
  )
  await expect(oldPasswordPage).toHaveURL(/\/login/)
  await expect(oldPasswordPage.getByRole('alert')).toContainText(
    'invalid credentials'
  )
  await oldPasswordSession.close()

  const newPasswordSession = await loginFreshContext(
    browser,
    origin,
    user.username,
    user.newPassword
  )
  await newPasswordSession.context.close()

  await openUsersPage(page)
  await deleteUser(page, user.username)
})
