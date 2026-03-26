import { apiClient } from '../api-client'

export interface PaginatedResult<T> {
  items: T
  pagination: {
    hasNextPage: boolean
    nextContinueToken?: string
    remainingItems?: number
  }
}

// Generic fetch function with error handling
export async function fetchAPI<T>(endpoint: string): Promise<T> {
  try {
    return await apiClient.get<T>(`${endpoint}`)
  } catch (error: unknown) {
    console.error('API request failed:', error)
    throw error
  }
}
