import { useQuery } from '@tanstack/react-query'

import { apiClient, authApiClient } from '../api-client'

export interface KubeconfigDownloadRequest {
  clusterUUIDs: string[]
  ttlSeconds: number
}

export interface KubeconfigToken {
  id: number
  name: string
  ownerId?: number
  owner?: string
  createdAt: string
  expiresAt: string
  lastUsedAt?: string
  signingKeyId: string
}

const readError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}))
  return payload.error || `HTTP error! status: ${response.status}`
}

export const downloadKubeconfig = async (
  data: KubeconfigDownloadRequest
): Promise<Blob> => {
  const response = await apiClient.request('/kubeconfig', {
    method: 'POST',
    body: JSON.stringify(data),
    retryOnUnauthorized: false,
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.blob()
}

export const fetchCurrentUserKubeconfigTokens = async (): Promise<
  KubeconfigToken[]
> => {
  const response = await authApiClient.get<{ tokens: KubeconfigToken[] }>(
    '/users/me/kubeconfig-tokens'
  )
  return response.tokens
}

export const deleteCurrentUserKubeconfigToken = (id: number) =>
  authApiClient.delete<{ message: string }>(`/users/me/kubeconfig-tokens/${id}`)

export type KubeconfigTokenStatus = 'active' | 'expired'

export interface AdminKubeconfigTokenQuery {
  page?: number
  size?: number
  owner?: string
  status?: KubeconfigTokenStatus
}

export interface AdminKubeconfigTokenList {
  tokens: KubeconfigToken[]
  total: number
  page: number
  size: number
}

export const fetchAdminKubeconfigTokens = async ({
  page = 1,
  size = 20,
  owner,
  status,
}: AdminKubeconfigTokenQuery = {}): Promise<AdminKubeconfigTokenList> => {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (owner) params.set('owner', owner)
  if (status) params.set('status', status)
  return apiClient.get<AdminKubeconfigTokenList>(
    `/admin/kubeconfig-tokens?${params}`
  )
}

export const deleteAdminKubeconfigToken = (id: number) =>
  apiClient.delete<{ message: string }>(`/admin/kubeconfig-tokens/${id}`)

export const useCurrentUserKubeconfigTokens = (enabled = true) =>
  useQuery({
    queryKey: ['current-user-kubeconfig-tokens'],
    queryFn: fetchCurrentUserKubeconfigTokens,
    enabled,
  })

export const useAdminKubeconfigTokens = (query: AdminKubeconfigTokenQuery) =>
  useQuery({
    queryKey: [
      'admin-kubeconfig-tokens',
      query.page,
      query.size,
      query.owner,
      query.status,
    ],
    queryFn: () => fetchAdminKubeconfigTokens(query),
  })
