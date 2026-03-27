import { expect, test } from '@playwright/test'

const baseURL =
  process.env.KITE_E2E_BASE_URL ||
  `http://127.0.0.1:${process.env.KITE_E2E_PORT || '38080'}`

test('custom role grants namespaces and denies nodes', async ({
  browser,
  page,
}) => {
  const roleName = `e2e-rbac-${Date.now()}`
  const username = `e2e-rbac-user-${Date.now()}`
  const displayName = 'E2E RBAC User'
  const password = 'E2Epass!2345'

  await page.goto('/settings?tab=users')

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await page.getByRole('button', { name: 'Add Password User' }).click()

  const userDialog = page.getByRole('dialog', { name: 'Add Password User' })
  await expect(userDialog).toBeVisible()

  await userDialog.locator('input').nth(0).fill(username)
  await userDialog.locator('input').nth(1).fill(displayName)
  await userDialog.locator('input').nth(2).fill(password)
  await userDialog.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByRole('row').filter({ hasText: username })).toBeVisible()

  await page.goto('/settings?tab=rbac')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await page.getByRole('button', { name: 'Add Role' }).click()

  const roleDialog = page.getByRole('dialog', { name: 'Add Role' })
  await expect(roleDialog).toBeVisible()

  await roleDialog.getByLabel('Role Name').fill(roleName)
  await roleDialog.getByLabel('Description').fill('Namespaces read only')

  await roleDialog
    .getByPlaceholder('* or cluster-name')
    .fill('*')
  await roleDialog
    .getByPlaceholder('* or cluster-name')
    .press('Enter')

  await roleDialog.getByPlaceholder('* or namespace').fill('*')
  await roleDialog.getByPlaceholder('* or namespace').press('Enter')

  await roleDialog
    .getByPlaceholder('* or pods,deployments')
    .fill('namespaces')
  await roleDialog
    .getByPlaceholder('* or pods,deployments')
    .press('Enter')

  const verbsInput = roleDialog.getByPlaceholder('* or get,list,create')
  await verbsInput.fill('get')
  await verbsInput.press('Enter')
  await verbsInput.fill('list')
  await verbsInput.press('Enter')

  await roleDialog.getByRole('button', { name: 'Create' }).click()

  const roleRow = page.getByRole('row').filter({ hasText: roleName })
  await expect(roleRow).toBeVisible()

  await roleRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Assign' }).click()

  const assignDialog = page.getByRole('dialog', { name: `Assign Role - ${roleName}` })
  await expect(assignDialog).toBeVisible()

  await assignDialog.getByPlaceholder('username or group name').fill(username)
  await assignDialog.getByRole('button', { name: 'Assign' }).click()
  await assignDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(assignDialog).toBeHidden()

  const userContext = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  const userPage = await userContext.newPage()

  await userPage.goto('/login')
  await userPage.getByLabel('Username').fill(username)
  await userPage.getByLabel('Password').fill(password)
  await userPage.getByRole('button', { name: 'Sign In with Password' }).click()
  await userPage.waitForURL((url) => url.pathname === '/')

  await userPage.goto('/namespaces')
  await expect(
    userPage.getByRole('link', { name: 'kube-system' })
  ).toBeVisible()

  await userPage.goto('/nodes')
  await expect(
    userPage.getByRole('heading', { name: 'Error loading nodes' })
  ).toBeVisible()
  await expect(userPage.getByText(new RegExp(`User ${username}`))).toBeVisible()
  await expect(
    userPage.getByText(/does not have permission/i)
  ).toBeVisible()

  await userContext.close()
})
