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
    page.getByRole('heading', { name: 'Create your admin account' })
  ).toBeVisible()

  await page.getByLabel(/^Username \*$/).fill(adminUser.username)
  await page.getByLabel('Display name').fill(adminUser.name)
  await page.getByLabel(/^Password \*$/).fill(adminUser.password)
  await page.getByLabel(/^Confirm password \*$/).fill(adminUser.password)
  await page.getByRole('button', { name: 'Create admin account' }).click()

  await expect(page.getByLabel(/^Kubeconfig File \*$/)).toBeVisible()
  await page.getByLabel(/^Kubeconfig File \*$/).fill(kubeconfig)
  await page.getByRole('button', { name: 'Connect cluster' }).click()

  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  ensureAuthDir()
  await page.context().storageState({ path: authFile })
})
