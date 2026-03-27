import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const e2eDir = dirname(fileURLToPath(import.meta.url))

export const authFile = resolve(e2eDir, '.auth', 'admin.json')

export const adminUser = {
  username: process.env.KITE_E2E_ADMIN_USERNAME || 'admin',
  name: process.env.KITE_E2E_ADMIN_NAME || 'Kite Admin',
  password: process.env.KITE_E2E_ADMIN_PASSWORD || 'KiteE2E!2345',
}

export const kindClusterName =
  process.env.KITE_E2E_CLUSTER_NAME || 'kite-e2e'

export function ensureAuthDir() {
  mkdirSync(dirname(authFile), { recursive: true })
}
