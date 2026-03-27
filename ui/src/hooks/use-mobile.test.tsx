import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useIsMobile } from './use-mobile'

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

describe('useIsMobile', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('tracks the current viewport width and responds to media query changes', async () => {
    let changeListener: ((event: MediaQueryListEvent) => void) | null = null

    vi.stubGlobal('innerWidth', 500)
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn((event, listener) => {
          if (event === 'change') {
            changeListener = listener as (event: MediaQueryListEvent) => void
          }
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    )

    const { result, unmount } = renderHook(() => useIsMobile())

    await waitFor(() => expect(result.current).toBe(true))

    vi.stubGlobal('innerWidth', 1024)

    act(() => {
      changeListener?.({} as MediaQueryListEvent)
    })

    expect(result.current).toBe(false)

    unmount()
  })
})
