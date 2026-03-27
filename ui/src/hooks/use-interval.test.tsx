import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInterval } from './use-interval'

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

describe('useInterval', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invokes the callback on the configured interval and stops after unmount', () => {
    vi.useFakeTimers()
    const callback = vi.fn()

    const { unmount } = renderHook(() => useInterval(callback, 1000))

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(callback).toHaveBeenCalledTimes(3)

    unmount()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(callback).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })
})
