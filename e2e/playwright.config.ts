import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

import { authFile } from './env'

const e2eDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(e2eDir, '..')
const port = process.env.KITE_E2E_PORT || '38080'
const baseURL = process.env.KITE_E2E_BASE_URL || `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 3 * 60 * 1000,
  expect: {
    timeout: 15 * 1000,
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.KITE_E2E_BASE_URL
    ? undefined
    : {
        command: './scripts/e2e-start-app.sh',
        cwd: repoRoot,
        url: `${baseURL}/healthz`,
        timeout: 5 * 60 * 1000,
        reuseExistingServer: false,
        gracefulShutdown: {
          signal: 'SIGTERM',
          timeout: 5 * 1000,
        },
      },
  projects: [
    {
      name: 'setup',
      testMatch: /setup\/.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      testIgnore: ['setup/**'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
    },
  ],
})
