import { type Browser, type Page, expect, test } from '@playwright/test'

import { authFile } from '../env'

const baseURL =
  process.env.KITE_E2E_BASE_URL ||
  `http://127.0.0.1:${process.env.KITE_E2E_PORT || '38080'}`
const ldapURL = process.env.KITE_E2E_LDAP_URL
const oauthIssuer = process.env.KITE_E2E_OAUTH_ISSUER

const ldapUser = {
  username: 'ldap-e2e',
  password: 'KiteLDAP!2345',
  provider: 'ldap',
}

const oauthUser = {
  username: 'oauth-e2e',
  password: 'KiteOAuth!2345',
  provider: 'dex',
}

const oauthUserWithoutGroup = {
  username: 'oauth-no-group',
  password: 'KiteOAuthNoGroup!2345',
}

const restrictedOAuthProvider = {
  name: 'dex-allowed',
  allowedGroups: 'e2e-viewers',
}

const usernameClaimOAuthProvider = {
  name: 'dex-name-username',
  usernameClaim: 'name',
}

const customGroupClaimOAuthProvider = {
  name: 'dex-name-group',
  groupsClaim: 'name',
  allowedGroups: 'OAuth E2E',
}

async function openAnonymousPage(browser: Browser) {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()
  return { context, page }
}

async function openUserMenu(page: Page) {
  await page.locator('header').getByRole('button').last().click()
}

async function fetchCurrentUser(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/user', {
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch current user: ${response.status}`)
    }
    const data = await response.json()
    return data.user as {
      username: string
      provider: string
      oidc_groups?: string[]
    }
  })
}

async function expectSignedInUser(
  page: Page,
  username: string,
  provider: string
) {
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  await openUserMenu(page)
  await expect(
    page
      .locator('p.text-xs.text-muted-foreground')
      .filter({ hasText: username })
      .first()
  ).toBeVisible()
  await expect(
    page
      .locator('p.text-xs.text-muted-foreground')
      .filter({ hasText: `via ${provider}` })
      .first()
  ).toBeVisible()
  await expect(
    page
      .locator('p.text-xs.text-muted-foreground')
      .filter({ hasText: 'Role: viewer' })
      .first()
  ).toBeVisible()
}

async function configureLDAPViaUI(page: Page) {
  await page.goto('/settings?tab=oauth')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const ldapSwitch = page.getByRole('switch').first()
  if ((await ldapSwitch.getAttribute('data-state')) !== 'checked') {
    await ldapSwitch.click()
  }

  await page.getByLabel('Server URL').fill(ldapURL!)
  await page.getByLabel('Bind DN').fill('cn=admin,dc=kite,dc=test')
  await page.getByLabel('Bind Password').fill('admin')
  await page.getByLabel('User Base DN').fill('ou=users,dc=kite,dc=test')
  await page.getByLabel('User Filter').fill('(uid=%s)')
  await page.getByLabel('Username Attribute').fill('uid')
  await page.getByLabel('Display Name Attribute').fill('cn')
  await page.getByLabel('Group Base DN').fill('ou=groups,dc=kite,dc=test')
  await page.getByLabel('Group Filter').fill('(member=%s)')
  await page.getByLabel('Group Name Attribute').fill('cn')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('Authentication settings updated')).toBeVisible()
}

async function configureOAuthViaUI(page: Page) {
  const providerRow = page.getByRole('row').filter({ hasText: 'dex' })
  if (await providerRow.count()) {
    return
  }

  await page.getByRole('button', { name: 'Add Provider' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add OAuth Provider' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Name *').fill('dex')
  await dialog.getByLabel('Client ID *').fill('kite-e2e')
  await dialog.getByLabel('Client Secret *').fill('kite-e2e-secret')
  await dialog.getByLabel('Issuer').fill(oauthIssuer!)
  await dialog
    .getByLabel('Scopes')
    .fill('openid,profile,email,groups')
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(providerRow).toBeVisible()
}

async function configureUsernameClaimOAuthViaUI(page: Page) {
  await page.goto('/settings?tab=oauth')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const providerRow = page
    .getByRole('row')
    .filter({ hasText: usernameClaimOAuthProvider.name })

  if (await providerRow.count()) {
    await providerRow.getByRole('button', { name: '•••' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit OAuth Provider' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Issuer').fill(oauthIssuer!)
    await dialog.getByLabel('Scopes').fill('openid,profile,email,groups')
    await dialog
      .getByLabel('Username Claim')
      .fill(usernameClaimOAuthProvider.usernameClaim)
    await dialog.getByLabel('Groups Claim').fill('')
    await dialog.getByLabel('Allowed Groups').fill('')
    await dialog.getByRole('button', { name: 'Update' }).click()

    await expect(
      page.getByText('OAuth provider updated successfully')
    ).toBeVisible()
    return
  }

  await page.getByRole('button', { name: 'Add Provider' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add OAuth Provider' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Name *').fill(usernameClaimOAuthProvider.name)
  await dialog.getByLabel('Client ID *').fill('kite-e2e')
  await dialog.getByLabel('Client Secret *').fill('kite-e2e-secret')
  await dialog.getByLabel('Issuer').fill(oauthIssuer!)
  await dialog.getByLabel('Scopes').fill('openid,profile,email,groups')
  await dialog
    .getByLabel('Username Claim')
    .fill(usernameClaimOAuthProvider.usernameClaim)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(
    page.getByText('OAuth provider created successfully')
  ).toBeVisible()
  await expect(providerRow).toBeVisible()
}

async function configureRestrictedOAuthViaUI(page: Page) {
  await page.goto('/settings?tab=oauth')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const providerRow = page
    .getByRole('row')
    .filter({ hasText: restrictedOAuthProvider.name })

  if (await providerRow.count()) {
    await providerRow.getByRole('button', { name: '•••' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit OAuth Provider' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Issuer').fill(oauthIssuer!)
    await dialog.getByLabel('Scopes').fill('openid,profile,email,groups')
    await dialog
      .getByLabel('Allowed Groups')
      .fill(restrictedOAuthProvider.allowedGroups)
    await dialog.getByRole('button', { name: 'Update' }).click()

    await expect(
      page.getByText('OAuth provider updated successfully')
    ).toBeVisible()
    return
  }

  await page.getByRole('button', { name: 'Add Provider' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add OAuth Provider' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Name *').fill(restrictedOAuthProvider.name)
  await dialog.getByLabel('Client ID *').fill('kite-e2e')
  await dialog.getByLabel('Client Secret *').fill('kite-e2e-secret')
  await dialog.getByLabel('Issuer').fill(oauthIssuer!)
  await dialog.getByLabel('Scopes').fill('openid,profile,email,groups')
  await dialog
    .getByLabel('Allowed Groups')
    .fill(restrictedOAuthProvider.allowedGroups)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(providerRow).toBeVisible()
}

async function configureCustomGroupClaimOAuthViaUI(page: Page) {
  await page.goto('/settings?tab=oauth')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const providerRow = page
    .getByRole('row')
    .filter({ hasText: customGroupClaimOAuthProvider.name })

  if (await providerRow.count()) {
    await providerRow.getByRole('button', { name: '•••' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit OAuth Provider' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Issuer').fill(oauthIssuer!)
    await dialog.getByLabel('Scopes').fill('openid,profile,email,groups')
    await dialog.getByLabel('Username Claim').fill('')
    await dialog
      .getByLabel('Groups Claim')
      .fill(customGroupClaimOAuthProvider.groupsClaim)
    await dialog
      .getByLabel('Allowed Groups')
      .fill(customGroupClaimOAuthProvider.allowedGroups)
    await dialog.getByRole('button', { name: 'Update' }).click()

    await expect(
      page.getByText('OAuth provider updated successfully')
    ).toBeVisible()
    return
  }

  await page.getByRole('button', { name: 'Add Provider' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add OAuth Provider' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Name *').fill(customGroupClaimOAuthProvider.name)
  await dialog.getByLabel('Client ID *').fill('kite-e2e')
  await dialog.getByLabel('Client Secret *').fill('kite-e2e-secret')
  await dialog.getByLabel('Issuer').fill(oauthIssuer!)
  await dialog.getByLabel('Scopes').fill('openid,profile,email,groups')
  await dialog
    .getByLabel('Groups Claim')
    .fill(customGroupClaimOAuthProvider.groupsClaim)
  await dialog
    .getByLabel('Allowed Groups')
    .fill(customGroupClaimOAuthProvider.allowedGroups)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(
    page.getByText('OAuth provider created successfully')
  ).toBeVisible()
  await expect(providerRow).toBeVisible()
}

async function assignViewerRoleViaUI(page: Page, groupName: string) {
  await page.goto('/settings?tab=rbac')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const viewerRow = page.getByRole('row').filter({ hasText: 'viewer' })
  await expect(viewerRow).toBeVisible()

  await viewerRow.getByRole('button', { name: '•••' }).click()
  await page.getByRole('menuitem', { name: 'Assign' }).click()

  const dialog = page.getByRole('dialog', { name: 'Assign Role - viewer' })
  await expect(dialog).toBeVisible()

  if (!(await dialog.getByText(groupName).count())) {
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: 'OIDC Group' }).click()
    await dialog.getByPlaceholder('username or group name').fill(groupName)
    await dialog.getByRole('button', { name: 'Assign' }).click()
    await expect(dialog.getByText(groupName)).toBeVisible()
  }

  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('external auth', () => {
  test.skip(
    !ldapURL || !oauthIssuer,
    'External auth services are not configured'
  )

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({
      baseURL,
      storageState: authFile,
    })
    const adminPage = await adminContext.newPage()

    try {
      await configureLDAPViaUI(adminPage)
      await configureOAuthViaUI(adminPage)
      await configureUsernameClaimOAuthViaUI(adminPage)
      await configureRestrictedOAuthViaUI(adminPage)
      await configureCustomGroupClaimOAuthViaUI(adminPage)
      await assignViewerRoleViaUI(adminPage, 'e2e-viewers')
      await assignViewerRoleViaUI(adminPage, 'OAuth E2E')
    } finally {
      await adminContext.close()
    }
  })

  test('signs in with LDAP credentials', async ({ browser }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(page.getByRole('tab', { name: 'LDAP' })).toBeVisible()
      await page.getByRole('tab', { name: 'LDAP' }).click()
      await page.getByLabel('Username').fill(ldapUser.username)
      await page.getByLabel('Password').fill(ldapUser.password)
      await page.getByRole('button', { name: 'Sign In with LDAP' }).click()

      await expectSignedInUser(page, ldapUser.username, ldapUser.provider)
    } finally {
      await context.close()
    }
  })

  test('signs in through Dex OAuth', async ({ browser }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(
        page.getByRole('button', { name: /^Sign In with Dex$/i })
      ).toBeVisible()
      await page.getByRole('button', { name: /^Sign In with Dex$/i }).click()

      await expect(
        page.getByRole('heading', { name: 'Log in to Your Account' })
      ).toBeVisible()
      await page.getByLabel('Username').fill(oauthUser.username)
      await page.getByLabel('Password').fill(oauthUser.password)
      await page.getByRole('button', { name: 'Login' }).click()

      await expectSignedInUser(page, oauthUser.username, oauthUser.provider)
    } finally {
      await context.close()
    }
  })

  test('signs in through Dex OAuth with usernameClaim override', async ({
    browser,
  }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(
        page.getByRole('button', {
          name: /^Sign In with Dex-name-username$/i,
        })
      ).toBeVisible()
      await page
        .getByRole('button', {
          name: /^Sign In with Dex-name-username$/i,
        })
        .click()

      await expect(
        page.getByRole('heading', { name: 'Log in to Your Account' })
      ).toBeVisible()
      await page.getByLabel('Username').fill(oauthUser.username)
      await page.getByLabel('Password').fill(oauthUser.password)
      await page.getByRole('button', { name: 'Login' }).click()

      await expectSignedInUser(
        page,
        'OAuth E2E',
        usernameClaimOAuthProvider.name
      )

      const currentUser = await fetchCurrentUser(page)
      expect(currentUser.username).toBe('OAuth E2E')
      expect(currentUser.provider).toBe(usernameClaimOAuthProvider.name)
    } finally {
      await context.close()
    }
  })

  test('rejects LDAP credentials with the wrong password', async ({
    browser,
  }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(page.getByRole('tab', { name: 'LDAP' })).toBeVisible()
      await page.getByRole('tab', { name: 'LDAP' }).click()
      await page.getByLabel('Username').fill(ldapUser.username)
      await page.getByLabel('Password').fill('wrong-password')
      await page.getByRole('button', { name: 'Sign In with LDAP' }).click()

      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('alert')).toContainText(
        'invalid ldap credentials'
      )
    } finally {
      await context.close()
    }
  })

  test('rejects Dex OAuth users without a mapped group', async ({ browser }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(
        page.getByRole('button', { name: /^Sign In with Dex$/i })
      ).toBeVisible()
      await page.getByRole('button', { name: /^Sign In with Dex$/i }).click()

      await expect(
        page.getByRole('heading', { name: 'Log in to Your Account' })
      ).toBeVisible()
      await page.getByLabel('Username').fill(oauthUserWithoutGroup.username)
      await page.getByLabel('Password').fill(oauthUserWithoutGroup.password)
      await page.getByRole('button', { name: 'Login' }).click()

      await expect(page).toHaveURL(/\/login\?/)
      await expect(page.getByRole('alert')).toContainText(
        `Access denied for user "${oauthUserWithoutGroup.username}"`
      )
      await expect(
        page.getByRole('button', { name: 'Try Again with Different Account' })
      ).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('signs in through Dex OAuth when the user is in an allowed group', async ({
    browser,
  }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(
        page.getByRole('button', { name: /^Sign In with Dex-allowed$/i })
      ).toBeVisible()
      await page
        .getByRole('button', { name: /^Sign In with Dex-allowed$/i })
        .click()

      await expect(
        page.getByRole('heading', { name: 'Log in to Your Account' })
      ).toBeVisible()
      await page.getByLabel('Username').fill(oauthUser.username)
      await page.getByLabel('Password').fill(oauthUser.password)
      await page.getByRole('button', { name: 'Login' }).click()

      await expectSignedInUser(
        page,
        oauthUser.username,
        restrictedOAuthProvider.name
      )
    } finally {
      await context.close()
    }
  })

  test('signs in through Dex OAuth with groupsClaim override', async ({
    browser,
  }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(
        page.getByRole('button', {
          name: /^Sign In with Dex-name-group$/i,
        })
      ).toBeVisible()
      await page
        .getByRole('button', {
          name: /^Sign In with Dex-name-group$/i,
        })
        .click()

      await expect(
        page.getByRole('heading', { name: 'Log in to Your Account' })
      ).toBeVisible()
      await page.getByLabel('Username').fill(oauthUser.username)
      await page.getByLabel('Password').fill(oauthUser.password)
      await page.getByRole('button', { name: 'Login' }).click()

      await expectSignedInUser(
        page,
        oauthUser.username,
        customGroupClaimOAuthProvider.name
      )

      const currentUser = await fetchCurrentUser(page)
      expect(currentUser.provider).toBe(customGroupClaimOAuthProvider.name)
      expect(currentUser.oidc_groups).toEqual(['OAuth E2E'])
    } finally {
      await context.close()
    }
  })

  test('rejects Dex OAuth users outside the allowed groups before RBAC', async ({
    browser,
  }) => {
    const { context, page } = await openAnonymousPage(browser)

    try {
      await page.goto('/login')

      await expect(
        page.getByRole('button', { name: /^Sign In with Dex-allowed$/i })
      ).toBeVisible()
      await page
        .getByRole('button', { name: /^Sign In with Dex-allowed$/i })
        .click()

      await expect(
        page.getByRole('heading', { name: 'Log in to Your Account' })
      ).toBeVisible()
      await page.getByLabel('Username').fill(oauthUserWithoutGroup.username)
      await page.getByLabel('Password').fill(oauthUserWithoutGroup.password)
      await page.getByRole('button', { name: 'Login' }).click()

      await expect(page).toHaveURL(/\/login\?/)
      await expect(page.getByRole('alert')).toContainText(
        'Authentication succeeded, but your account is not a member of the allowed groups in dex-allowed.'
      )
      await expect(page.getByRole('alert')).toContainText(
        'Please contact your administrator to be added to an allowed group.'
      )
      await expect(
        page.getByRole('button', { name: 'Try Again with Different Account' })
      ).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
