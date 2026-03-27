import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

import { adminUser, authFile, ensureAuthDir } from '../env'

test('bootstrap a reusable admin session', async ({ page }) => {
  if (!process.env.KUBECONFIG) {
    throw new Error('KUBECONFIG is required for e2e tests')
  }

  const kubeconfig = readFileSync(process.env.KUBECONFIG, 'utf8')

  await page.goto('/setup')

  await expect(
    page.getByRole('heading', { name: 'Create Super Admin User' })
  ).toBeVisible()

  await page.getByLabel(/^Username \*$/).fill(adminUser.username)
  await page.getByLabel('Display Name').fill(adminUser.name)
  await page.getByLabel(/^Password \*$/).fill(adminUser.password)
  await page.getByLabel(/^Confirm Password \*$/).fill(adminUser.password)
  await page.getByRole('button', { name: 'Create Super Admin User' }).click()

  await expect(page.getByLabel(/^Kubeconfig File \*$/)).toBeVisible()
  await page.getByLabel(/^Kubeconfig File \*$/).fill(kubeconfig)
  await page.getByRole('button', { name: 'Import Clusters' }).click()

  await page.waitForURL('**/login')
  await expect(
    page.getByRole('button', { name: 'Sign In with Password' })
  ).toBeVisible()
  await page.getByLabel('Username').fill(adminUser.username)
  await page.getByLabel('Password').fill(adminUser.password)
  await page.getByRole('button', { name: 'Sign In with Password' }).click()

  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  ensureAuthDir()
  await page.context().storageState({ path: authFile })
})
