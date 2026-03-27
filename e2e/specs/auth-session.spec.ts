import { expect, test } from '@playwright/test'

import { adminUser } from '../env'

test.describe('auth session', () => {
  test('logout returns to login', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

    await page.locator('header').getByRole('button').last().click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()

    await page.waitForURL('**/login')
    await expect(
      page.getByRole('button', { name: 'Sign In with Password' })
    ).toBeVisible()
  })
})

test.describe('password login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('returns to the app', async ({ page }) => {
    await page.goto('/login')

    await expect(
      page.getByRole('button', { name: 'Sign In with Password' })
    ).toBeVisible()

    await page.getByLabel('Username').fill(adminUser.username)
    await page.getByLabel('Password').fill(adminUser.password)
    await page.getByRole('button', { name: 'Sign In with Password' }).click()

    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  })
})
