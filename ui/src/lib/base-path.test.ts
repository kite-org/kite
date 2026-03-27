import { describe, expect, it, vi } from 'vitest'

import { normalizeBasePath } from './base-path'

function createStorage() {
  let store: Record<string, string> = {}

  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

vi.stubGlobal('localStorage', createStorage())
vi.stubGlobal('sessionStorage', createStorage())

describe('normalizeBasePath', () => {
  it('returns an empty string for missing input', () => {
    expect(normalizeBasePath()).toBe('')
  })

  it('normalizes a path with and without a leading slash', () => {
    expect(normalizeBasePath('kite/')).toBe('/kite')
    expect(normalizeBasePath('/kite/app/')).toBe('/kite/app')
  })

  it('rejects invalid path segments', () => {
    expect(() => normalizeBasePath('/kite app')).toThrow(
      'Invalid KITE_BASE "/kite app"'
    )
  })
})
