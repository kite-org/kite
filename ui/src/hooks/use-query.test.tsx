import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useQuery } from './use-query'

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

describe('useQuery', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('parses the current location search params', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter
        initialEntries={['/resources?name=pod-1&namespace=default']}
      >
        {children}
      </MemoryRouter>
    )

    const { result } = renderHook(() => useQuery(), { wrapper })

    expect(result.current.get('name')).toBe('pod-1')
    expect(result.current.get('namespace')).toBe('default')
  })
})
