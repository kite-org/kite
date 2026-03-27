import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchResult } from '@/lib/api'

import {
  addToFavorites,
  getFavorites,
  isFavorite,
  removeFromFavorites,
  saveFavorites,
  toggleFavorite,
} from './favorites'

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

const resource: SearchResult = {
  id: 'pod-1',
  name: 'api',
  resourceType: 'pods',
  namespace: 'default',
  createdAt: '2024-01-01T00:00:00Z',
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('current-cluster', 'cluster-a-')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getFavorites', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(getFavorites()).toEqual([])
  })

  it('returns an empty list for invalid JSON', () => {
    localStorage.setItem('cluster-a-kite-favorites', '{')

    expect(getFavorites()).toEqual([])
  })
})

describe('favorites storage helpers', () => {
  it('saves and reads favorites for the current cluster', () => {
    saveFavorites([resource])

    expect(localStorage.getItem('cluster-a-kite-favorites')).toBe(
      JSON.stringify([resource])
    )
    expect(getFavorites()).toEqual([resource])
  })

  it('adds resources once and removes them by id', () => {
    addToFavorites(resource)
    addToFavorites(resource)

    expect(getFavorites()).toEqual([resource])
    expect(isFavorite(resource.id)).toBe(true)

    removeFromFavorites(resource.id)

    expect(getFavorites()).toEqual([])
    expect(isFavorite(resource.id)).toBe(false)
  })

  it('toggles a resource in and out of favorites', () => {
    expect(toggleFavorite(resource)).toBe(true)
    expect(getFavorites()).toEqual([resource])

    expect(toggleFavorite(resource)).toBe(false)
    expect(getFavorites()).toEqual([])
  })
})
