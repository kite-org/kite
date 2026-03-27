import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type SearchResult } from '@/lib/api'

import { useFavorites } from './use-favorites'

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

const favorite: SearchResult = {
  id: 'resource-1',
  name: 'my-pod',
  resourceType: 'pods',
  namespace: 'default',
  createdAt: '2026-03-27T00:00:00.000Z',
}

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('adds and removes favorites while keeping state in sync with storage', async () => {
    const { result } = renderHook(() => useFavorites())

    await waitFor(() => expect(result.current.favorites).toEqual([]))

    act(() => {
      result.current.addToFavorites(favorite)
    })

    await waitFor(() => expect(result.current.favorites).toHaveLength(1))
    expect(result.current.favorites[0]).toEqual(favorite)
    expect(result.current.isFavorite(favorite.id)).toBe(true)

    act(() => {
      result.current.removeFromFavorites(favorite.id)
    })

    await waitFor(() => expect(result.current.favorites).toEqual([]))
    expect(result.current.isFavorite(favorite.id)).toBe(false)
  })

  it('returns the new favorite state when toggling a resource', async () => {
    const { result } = renderHook(() => useFavorites())

    await waitFor(() => expect(result.current.favorites).toEqual([]))

    let nextState = false
    act(() => {
      nextState = result.current.toggleFavorite(favorite)
    })

    expect(nextState).toBe(true)
    await waitFor(() => expect(result.current.favorites).toEqual([favorite]))

    act(() => {
      nextState = result.current.toggleFavorite(favorite)
    })

    expect(nextState).toBe(false)
    await waitFor(() => expect(result.current.favorites).toEqual([]))
  })
})
