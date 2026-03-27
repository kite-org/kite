import { useCallback, useEffect, useState } from 'react'

import { SearchResult } from '@/lib/api'
import {
  addToFavorites as addToFavoritesStorage,
  getFavorites as getFavoritesFromStorage,
  isFavorite as isFavoriteStorage,
  removeFromFavorites as removeFromFavoritesStorage,
  toggleFavorite as toggleFavoriteStorage,
} from '@/lib/favorites'

export function useFavorites() {
  const [favorites, setFavorites] = useState<SearchResult[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  // Load favorites on mount
  useEffect(() => {
    setFavorites(getFavoritesFromStorage())
  }, [refreshKey])

  // Refresh favorites list
  const refreshFavorites = useCallback(() => {
    setRefreshKey((prev) => prev + 1)
  }, [])

  // Add to favorites
  const addToFavorites = useCallback(
    (resource: SearchResult) => {
      addToFavoritesStorage(resource)
      refreshFavorites()
    },
    [refreshFavorites]
  )

  // Remove from favorites
  const removeFromFavorites = useCallback(
    (resourceId: string) => {
      removeFromFavoritesStorage(resourceId)
      refreshFavorites()
    },
    [refreshFavorites]
  )

  // Check if resource is favorite
  const isFavorite = useCallback((resourceId: string) => {
    return isFavoriteStorage(resourceId)
  }, []) // No dependencies needed as we always check current storage state

  // Toggle favorite status
  const toggleFavorite = useCallback(
    (resource: SearchResult) => {
      const isFavorite = toggleFavoriteStorage(resource)
      refreshFavorites()
      return isFavorite
    },
    [refreshFavorites]
  )

  return {
    favorites,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    toggleFavorite,
    refreshFavorites,
  }
}
