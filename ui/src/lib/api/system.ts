import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../api-client'
import { fetchAPI } from './shared'

// Initialize API types
export interface InitCheckResponse {
  initialized: boolean
  step: number
}

// Initialize API function
export const fetchInitCheck = (): Promise<InitCheckResponse> => {
  return fetchAPI<InitCheckResponse>('/init_check')
}

export const useInitCheck = () => {
  return useQuery({
    queryKey: ['init-check'],
    queryFn: fetchInitCheck,
    staleTime: 0, // Always fresh
    refetchInterval: 0, // No auto-refresh
  })
}

// Version information
export interface VersionInfo {
  version: string
  buildDate: string
  commitId: string
  hasNewVersion: boolean
  releaseUrl: string
}

export const fetchVersionInfo = (): Promise<VersionInfo> => {
  return fetchAPI<VersionInfo>('/version')
}

export const useVersionInfo = () => {
  return useQuery({
    queryKey: ['version-info'],
    queryFn: fetchVersionInfo,
    staleTime: 1000 * 60 * 60, // 1 hour
    refetchInterval: 0, // No auto-refresh
  })
}

// User registration for initial setup
export interface CreateUserRequest {
  username: string
  password: string
  name?: string
}

export const createSuperUser = async (
  userData: CreateUserRequest
): Promise<void> => {
  await apiClient.post('/admin/users/create_super_user', userData)
}

// Cluster import for initial setup
export interface ImportClustersRequest {
  config: string
  inCluster?: boolean
}

export const importClusters = async (
  request: ImportClustersRequest
): Promise<void> => {
  await apiClient.post('/admin/clusters/import', request)
}
