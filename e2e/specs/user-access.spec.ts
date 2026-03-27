import { type Browser, type Page, expect, test } from '@playwright/test'

import { adminUser as seededAdminUser } from '../env'

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

async function assignBuiltInRole(
  page: Page,
  username: string,
  roleName: 'viewer' | 'admin'
) {
  const row = page.getByRole('row').filter({ hasText: username }).first()
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: '•••' }).click()
  await page.getByRole('menuitem', { name: 'Assign' }).click()

  const dialog = page.getByRole('dialog', { name: 'Assign Roles' })
  await expect(dialog).toBeVisible()
  const checkbox = dialog.getByRole('checkbox').nth(roleName === 'admin' ? 0 : 1)
  await expect(checkbox).toBeVisible()
  await checkbox.click()
  await expect(checkbox).toBeChecked()

  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: username })).toContainText(
    roleName
  )
}

async function deleteUser(
  page: Page,
  username: string
) {
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

async function loginCurrentContext(
  page: Page,
  origin: string,
  username: string,
  password: string
) {
  await page.goto(`${origin}/login`)
  await loginWithPasswordUi(page, username, password)
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

test('password user lifecycle and built-in roles', async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36)
  const noRoleUser = {
    username: `e2e-norole-${suffix}`,
    name: 'E2E No Role',
    password: 'E2Epass!2345',
  }
  const viewerUser = {
    username: `e2e-viewer-${suffix}`,
    name: 'E2E Viewer',
    password: 'E2Epass!2345',
  }
  const managedAdminUser = {
    username: `e2e-admin-${suffix}`,
    name: 'E2E Admin',
    password: 'E2Epass!2345',
  }

  await openUsersPage(page)
  const origin = new URL(page.url()).origin
  await createPasswordUser(
    page,
    noRoleUser.username,
    noRoleUser.name,
    noRoleUser.password
  )

  await page.evaluate(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  })
  await page.goto(`${origin}/login`)
  await loginWithPasswordUi(page, noRoleUser.username, noRoleUser.password)
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('alert')).toContainText(
    'insufficient permissions'
  )
  await loginCurrentContext(
    page,
    origin,
    seededAdminUser.username,
    seededAdminUser.password
  )

  await openUsersPage(page)
  await createPasswordUser(
    page,
    viewerUser.username,
    viewerUser.name,
    viewerUser.password
  )
  await createPasswordUser(
    page,
    managedAdminUser.username,
    managedAdminUser.name,
    managedAdminUser.password
  )

  await assignBuiltInRole(page, viewerUser.username, 'viewer')
  await assignBuiltInRole(page, managedAdminUser.username, 'admin')

  const viewerSession = await loginFreshContext(
    browser,
    origin,
    viewerUser.username,
    viewerUser.password
  )
  await viewerSession.page.goto(`${origin}/namespaces`)
  await expect(
    viewerSession.page.getByRole('link', { name: 'kube-system' })
  ).toBeVisible()
  await expect(
    viewerSession.page.getByRole('button', { name: 'Settings', exact: true })
  ).toHaveCount(0)
  await expect(
    viewerSession.page.getByRole('button', { name: 'Toggle Kubectl Terminal' })
  ).toHaveCount(0)
  await viewerSession.context.close()

  const adminSession = await loginFreshContext(
    browser,
    origin,
    managedAdminUser.username,
    managedAdminUser.password
  )
  await expect(
    adminSession.page.getByRole('button', { name: 'Settings', exact: true })
  ).toBeVisible()
  await expect(
    adminSession.page.getByRole('button', { name: 'Toggle Kubectl Terminal' })
  ).toBeVisible()
  await adminSession.context.close()

  await openUsersPage(page)
  await deleteUser(page, noRoleUser.username)
  await deleteUser(page, viewerUser.username)
  await deleteUser(page, managedAdminUser.username)
})
