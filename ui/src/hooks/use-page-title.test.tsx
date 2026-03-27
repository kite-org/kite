import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePageTitle } from './use-page-title'

const createStorage = () => {
  const store = new Map<string, string>()

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

vi.stubGlobal('localStorage', createStorage())
vi.stubGlobal('sessionStorage', createStorage())

describe('usePageTitle', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('sets the page title and restores the previous title on cleanup', () => {
    document.title = 'Original'

    const { unmount } = renderHook(() => usePageTitle('Dashboard'))

    expect(document.title).toBe('Dashboard - Kite')

    unmount()

    expect(document.title).toBe('Original')
  })
})
