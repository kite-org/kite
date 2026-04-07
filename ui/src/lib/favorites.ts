import { SearchResult } from '@/lib/api'
import { getClusterScopedStorageKey } from '@/lib/current-cluster'

const FAVORITES_STORAGE_KEY = 'kite-favorites'

/**
 * Get favorites from localStorage
 */
export const getFavorites = (): SearchResult[] => {
  try {
    const favorites = localStorage.getItem(
      getClusterScopedStorageKey(FAVORITES_STORAGE_KEY)
    )
    return favorites ? JSON.parse(favorites) : []
  } catch {
    return []
  }
}

/**
 * Save favorites to localStorage
 */
export const saveFavorites = (favorites: SearchResult[]) => {
  try {
    localStorage.setItem(
      getClusterScopedStorageKey(FAVORITES_STORAGE_KEY),
      JSON.stringify(favorites)
    )
  } catch (error) {
    console.error('Failed to save favorites:', error)
  }
}

/**
 * Add a resource to favorites
 */
export const addToFavorites = (resource: SearchResult) => {
  const favorites = getFavorites()
  const favorite: SearchResult = {
    id: resource.id,
    name: resource.name,
    resourceType: resource.resourceType,
    namespace: resource.namespace,
    createdAt: resource.createdAt,
  }

  // Check if already exists
  if (!favorites.some((fav) => fav.id === favorite.id)) {
    favorites.push(favorite)
    saveFavorites(favorites)
  }
}

/**
 * Remove a resource from favorites
 */
export const removeFromFavorites = (resourceId: string) => {
  const favorites = getFavorites()
  const filtered = favorites.filter((fav) => fav.id !== resourceId)
  saveFavorites(filtered)
}

/**
 * Check if a resource is in favorites
 */
export const isFavorite = (resourceId: string): boolean => {
  const favorites = getFavorites()
  return favorites.some((fav) => fav.id === resourceId)
}

/**
 * Toggle favorite status of a resource
 */
export const toggleFavorite = (resource: SearchResult): boolean => {
  if (isFavorite(resource.id)) {
    removeFromFavorites(resource.id)
    return false
  } else {
    addToFavorites(resource)
    return true
  }
}
