import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pod } from 'kubernetes-types/core/v1'

import {
  ImageTagInfo,
  RelatedResources,
  ResourceHistoryResponse,
  ResourcesTypeMap,
  ResourceTemplate,
  ResourceType,
  ResourceTypeMap,
} from '@/types/api'

import { API_BASE_URL, apiClient } from '../api-client'
import { withSubPath } from '../subpath'
import { fetchAPI } from './shared'

type ResourcesItems<T extends ResourceType> = ResourcesTypeMap[T]['items']

export const fetchResources = <T>(
  resource: string,
  namespace?: string,
  opts?: {
    limit?: number
    continueToken?: string
    labelSelector?: string
    fieldSelector?: string
    reduce?: boolean
  }
): Promise<T> => {
  let endpoint = namespace ? `/${resource}/${namespace}` : `/${resource}`
  const params = new URLSearchParams()

  if (opts?.limit) {
    params.append('limit', opts.limit.toString())
  }
  if (opts?.continueToken) {
    params.append('continue', opts.continueToken)
  }
  if (opts?.labelSelector) {
    params.append('labelSelector', opts.labelSelector)
  }
  if (opts?.fieldSelector) {
    params.append('fieldSelector', opts.fieldSelector)
  }
  if (opts?.reduce) {
    params.append('reduce', 'true')
  }

  if (params.toString()) {
    endpoint += `?${params.toString()}`
  }

  return fetchAPI<T>(endpoint)
}

// Search API types
export interface SearchResult {
  id: string
  name: string
  namespace?: string
  resourceType: string
  createdAt: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
}

// Global search API
export const globalSearch = async (
  query: string,
  options?: {
    limit?: number
    namespace?: string
  }
): Promise<SearchResponse> => {
  if (query.length < 2) {
    return { results: [], total: 0 }
  }

  const params = new URLSearchParams({
    q: query,
    limit: String(options?.limit || 50),
  })

  if (options?.namespace) {
    params.append('namespace', options.namespace)
  }

  const endpoint = `/search?${params.toString()}`
  return fetchAPI<SearchResponse>(endpoint)
}
// Scale deployment API
export const scaleDeployment = async (
  namespace: string,
  name: string,
  replicas: number
): Promise<{ message: string; deployment: unknown; replicas: number }> => {
  const endpoint = `/deployments/${namespace}/${name}/scale`
  const response = await apiClient.put<{
    message: string
    deployment: unknown
    replicas: number
  }>(endpoint, {
    replicas,
  })

  return response
}

// Node operation APIs
export const drainNode = async (
  nodeName: string,
  options: {
    force: boolean
    gracePeriod: number
    deleteLocalData: boolean
    ignoreDaemonsets: boolean
  }
): Promise<{ message: string; node: string; options: unknown }> => {
  const endpoint = `/nodes/_all/${nodeName}/drain`
  const response = await apiClient.post<{
    message: string
    node: string
    options: unknown
  }>(endpoint, options)

  return response
}

export const cordonNode = async (
  nodeName: string
): Promise<{ message: string; node: string; unschedulable: boolean }> => {
  const endpoint = `/nodes/_all/${nodeName}/cordon`
  const response = await apiClient.post<{
    message: string
    node: string
    unschedulable: boolean
  }>(endpoint)

  return response
}

export const uncordonNode = async (
  nodeName: string
): Promise<{ message: string; node: string; unschedulable: boolean }> => {
  const endpoint = `/nodes/_all/${nodeName}/uncordon`
  const response = await apiClient.post<{
    message: string
    node: string
    unschedulable: boolean
  }>(endpoint)

  return response
}

export const taintNode = async (
  nodeName: string,
  taint: {
    key: string
    value: string
    effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute'
  }
): Promise<{ message: string; node: string; taint: unknown }> => {
  const endpoint = `/nodes/_all/${nodeName}/taint`
  const response = await apiClient.post<{
    message: string
    node: string
    taint: unknown
  }>(endpoint, taint)

  return response
}

export const untaintNode = async (
  nodeName: string,
  key: string
): Promise<{ message: string; node: string; removedTaintKey: string }> => {
  const endpoint = `/nodes/_all/${nodeName}/untaint`
  const response = await apiClient.post<{
    message: string
    node: string
    removedTaintKey: string
  }>(endpoint, { key })

  return response
}

export const updateResource = async <T extends ResourceType>(
  resource: T,
  name: string,
  namespace: string | undefined,
  body: ResourceTypeMap[T]
): Promise<void> => {
  const endpoint = `/${resource}/${namespace || '_all'}/${name}`
  await apiClient.put(`${endpoint}`, body)
}

export const resizePod = async (
  namespace: string,
  name: string,
  body: Partial<Pod>
): Promise<void> => {
  const endpoint = `/pods/${namespace || '_all'}/${name}/resize`
  await apiClient.patch(`${endpoint}`, body)
}

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>
    }
  : T
export const patchResource = async <T extends ResourceType>(
  resource: T,
  name: string,
  namespace: string | undefined,
  body: DeepPartial<ResourceTypeMap[T]>
): Promise<void> => {
  const endpoint = `/${resource}/${namespace || '_all'}/${name}`
  await apiClient.patch(`${endpoint}`, body)
}

export const createResource = async <T extends ResourceType>(
  resource: T,
  namespace: string | undefined,
  body: ResourceTypeMap[T]
): Promise<ResourceTypeMap[T]> => {
  const endpoint = `/${resource}/${namespace || '_all'}`
  return await apiClient.post<ResourceTypeMap[T]>(`${endpoint}`, body)
}

export const deleteResource = async <T extends ResourceType>(
  resource: T,
  name: string,
  namespace: string | undefined,
  opts?: {
    force?: boolean
    wait?: boolean
  }
): Promise<void> => {
  const params = new URLSearchParams()
  if (opts?.force) {
    params.append('force', 'true')
  }
  if (opts?.wait === false) {
    params.append('wait', 'false')
  }
  const endpoint = `/${resource}/${namespace || '_all'}/${name}?${params.toString()}`
  await apiClient.delete(endpoint)
}

// Apply resource from YAML
export interface ApplyResourceRequest {
  yaml: string
}

export interface ApplyResourceResponse {
  message: string
  kind: string
  name: string
  namespace?: string
}

export const applyResource = async (
  yaml: string
): Promise<ApplyResourceResponse> => {
  return await apiClient.post<ApplyResourceResponse>('/resources/apply', {
    yaml,
  })
}

export const useResourcesEvents = <T extends ResourceType>(
  resource: T,
  name: string,
  namespace?: string
) => {
  return useQuery({
    queryKey: ['resource-events', resource, namespace, name],
    queryFn: () => {
      const endpoint =
        '/events/resources?' +
        new URLSearchParams({
          resource: resource,
          name: name,
          namespace: namespace || '',
        }).toString()
      return fetchAPI<ResourcesTypeMap['events']>(endpoint)
    },
    select: (data: ResourcesTypeMap['events']): ResourcesItems<'events'> =>
      data.items,
    placeholderData: (prevData) => prevData,
  })
}

export const useResources = <T extends ResourceType>(
  resource: T,
  namespace?: string,
  options?: {
    staleTime?: number
    limit?: number
    labelSelector?: string
    fieldSelector?: string
    refreshInterval?: number
    disable?: boolean
    reduce?: boolean
  }
) => {
  return useQuery({
    queryKey: [
      resource,
      namespace,
      options?.limit,
      options?.labelSelector,
      options?.fieldSelector,
    ],
    queryFn: () => {
      return fetchResources<ResourcesTypeMap[T]>(resource, namespace, {
        limit: options?.limit,
        continueToken: undefined,
        labelSelector: options?.labelSelector,
        fieldSelector: options?.fieldSelector,
        reduce: options?.reduce,
      })
    },
    enabled: !options?.disable,
    select: (data: ResourcesTypeMap[T]): ResourcesItems<T> => data.items,
    placeholderData: (prevData) => prevData,
    refetchInterval: options?.refreshInterval || 0,
    staleTime: options?.staleTime || (resource === 'crds' ? 5000 : 1000),
  })
}

// Hook: SSE watch for resource lists (initial snapshot + ADDED/MODIFIED/DELETED)
export function useResourcesWatch<T extends ResourceType>(
  resource: T,
  namespace?: string,
  options?: {
    labelSelector?: string
    fieldSelector?: string
    reduce?: boolean
    enabled?: boolean
  }
) {
  const [data, setData] = useState<ResourcesItems<T> | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  const buildUrl = useCallback(() => {
    const ns = namespace || '_all'
    const params = new URLSearchParams()
    if (options?.reduce !== false) params.append('reduce', 'true')
    if (options?.labelSelector)
      params.append('labelSelector', options.labelSelector)
    if (options?.fieldSelector)
      params.append('fieldSelector', options.fieldSelector)
    const cluster = localStorage.getItem('current-cluster')
    if (cluster) params.append('x-cluster-name', cluster)
    return withSubPath(
      `${API_BASE_URL}/${resource}/${ns}/watch?${params.toString()}`
    )
  }, [
    resource,
    namespace,
    options?.reduce,
    options?.labelSelector,
    options?.fieldSelector,
  ])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    disconnect()
    setData(undefined)
    if (options?.enabled === false) return
    const url = buildUrl()
    setError(null)
    setIsConnected(false)

    try {
      const es = new EventSource(url, { withCredentials: true })
      eventSourceRef.current = es

      es.onopen = () => {
        setIsConnected(true)
      }

      const getKey = (obj: ResourceTypeMap[T]) => {
        return (
          (obj.metadata?.namespace || '') + '/' + (obj.metadata?.name || '')
        )
      }

      const upsert = (obj: string) => {
        const object = JSON.parse(obj) as ResourceTypeMap[T]
        setData((prev) => {
          const arr = prev ? [...prev] : []
          const key = getKey(object)
          const idx = arr.findIndex(
            (it) => getKey(it as ResourceTypeMap[T]) === key
          )
          if (idx >= 0) arr[idx] = object
          else arr.unshift(object)
          return arr as ResourcesItems<T>
        })
      }

      const remove = (obj: string) => {
        const object = JSON.parse(obj) as ResourceTypeMap[T]
        setData((prev) => {
          const arr = prev ? [...prev] : []
          const key = getKey(object)
          const filtered = arr.filter(
            (it) => getKey(it as ResourceTypeMap[T]) !== key
          )
          return filtered as ResourcesItems<T>
        })
      }

      es.addEventListener('added', (e: MessageEvent<string>) => {
        upsert(e.data)
      })
      es.addEventListener('modified', (e: MessageEvent<string>) => {
        upsert(e.data)
      })
      es.addEventListener('deleted', (e: MessageEvent<string>) => {
        remove(e.data)
      })

      es.addEventListener('error', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data)
          setError(new Error(payload?.error || 'SSE error'))
        } catch {
          setError(new Error('SSE error'))
        }
        setIsLoading(false)
        setIsConnected(false)
      })
      es.addEventListener('close', () => {
        setIsConnected(false)
      })

      es.onerror = () => {
        setIsConnected(false)
      }
    } catch (err) {
      if (err instanceof Error) setError(err)
      setIsLoading(false)
      setIsConnected(false)
    }
  }, [buildUrl, disconnect, options?.enabled])

  const refetch = useCallback(() => {
    disconnect()
    setTimeout(connect, 100)
  }, [disconnect, connect])

  useEffect(() => {
    if (options?.enabled === false) return
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect, options?.enabled])

  return { data, isLoading, error, isConnected, refetch, stop: disconnect }
}

export const fetchResource = <T>(
  resource: string,
  name: string,
  namespace?: string
): Promise<T> => {
  const endpoint = namespace
    ? `/${resource}/${namespace}/${name}`
    : `/${resource}/${name}`
  return fetchAPI<T>(endpoint)
}
export const useResource = <T extends keyof ResourceTypeMap>(
  resource: T,
  name: string,
  namespace?: string,
  options?: { staleTime?: number; refreshInterval?: number }
) => {
  const ns = namespace || '_all'
  return useQuery({
    queryKey: [resource.slice(0, -1), ns, name], // Remove 's' from resource name for singular
    queryFn: () => {
      return fetchResource<ResourceTypeMap[T]>(resource, name, ns)
    },
    refetchOnWindowFocus: 'always',
    refetchInterval: options?.refreshInterval || 0, // Default to no auto-refresh
    placeholderData: (prevData) => prevData,
    staleTime: options?.staleTime || 1000,
  })
}
// Pod describe API
export const fetchDescribe = async (
  resourceType: ResourceType,
  name: string,
  namespace?: string
): Promise<{ result: string }> => {
  const endpoint = `/${resourceType}/${namespace ?? '_all'}/${name}/describe`
  return fetchAPI<{ result: string }>(endpoint)
}

export const useDescribe = (
  resourceType: ResourceType,
  name: string,
  namespace?: string,
  options?: { staleTime?: number; enabled?: boolean }
) => {
  return useQuery({
    queryKey: [resourceType, name, namespace, 'describe'],
    queryFn: () => fetchDescribe(resourceType, name, namespace),
    enabled: (options?.enabled ?? true) && !!name,
    staleTime: options?.staleTime || 0,
    retry: 0,
  })
}
export interface FileInfo {
  name: string
  isDir: boolean
  size: string
  modTime: string
  mode: string
  uid: string
  gid: string
}

export const podListFiles = async (
  namespace: string,
  podName: string,
  container: string,
  path: string,
  options?: RequestInit
): Promise<FileInfo[]> => {
  const params = new URLSearchParams({
    container,
    path,
  })
  return apiClient.get<FileInfo[]>(
    `/pods/${namespace}/${podName}/files?${params.toString()}`,
    options
  )
}

export const podDownloadFile = (
  namespace: string,
  podName: string,
  container: string,
  path: string
) => {
  const params = new URLSearchParams({
    container,
    path,
  })
  const url = withSubPath(
    `${API_BASE_URL}/pods/${namespace}/${podName}/files/download?${params.toString()}`
  )
  window.open(url, '_blank')
}

export const podPreviewFile = (
  namespace: string,
  podName: string,
  container: string,
  path: string
) => {
  const params = new URLSearchParams({
    container,
    path,
  })
  const url = withSubPath(
    `${API_BASE_URL}/pods/${namespace}/${podName}/files/preview?${params.toString()}`
  )
  window.open(url, '_blank')
}

export const podUploadFile = async (
  namespace: string,
  podName: string,
  container: string,
  path: string,
  file: File
): Promise<void> => {
  const formData = new FormData()
  formData.append('file', file)
  const params = new URLSearchParams({
    container,
    path,
  })

  await apiClient.put(
    `/pods/${namespace}/${podName}/files/upload?${params.toString()}`,
    formData
  )
}

export const fetchTemplates = async (): Promise<ResourceTemplate[]> => {
  return fetchAPI<ResourceTemplate[]>('/templates/')
}

export const createTemplate = async (
  data: Omit<ResourceTemplate, 'ID'>
): Promise<ResourceTemplate> => {
  return apiClient.post<ResourceTemplate>('/admin/templates/', data)
}

export const updateTemplate = async (
  id: number,
  data: Partial<ResourceTemplate>
): Promise<ResourceTemplate> => {
  return apiClient.put<ResourceTemplate>(`/admin/templates/${id}`, data)
}

export const deleteTemplate = async (id: number): Promise<void> => {
  await apiClient.delete(`/admin/templates/${id}`)
}

export const useTemplates = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
    staleTime: options?.staleTime || 30000,
  })
}
export async function getImageTags(image: string): Promise<ImageTagInfo[]> {
  if (!image) return []
  const resp = await apiClient.get<ImageTagInfo[]>(
    `/image/tags?image=${encodeURIComponent(image)}`
  )
  return resp
}

export function useImageTags(image: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['image-tags', image],
    queryFn: () => getImageTags(image),
    enabled: !!image && (options?.enabled ?? true),
    staleTime: 60 * 1000, // 1 min
    placeholderData: (prev) => prev,
  })
}

export async function getRelatedResources(
  resource: ResourceType,
  name: string,
  namespace?: string
) {
  const resp = await apiClient.get<RelatedResources[]>(
    `/${resource}/${namespace ? namespace : '_all'}/${name}/related`
  )
  return resp
}

export function useRelatedResources(
  resource: ResourceType,
  name: string,
  namespace?: string
) {
  return useQuery({
    queryKey: ['related-resources', resource, name, namespace],
    queryFn: () => getRelatedResources(resource, name, namespace),
    staleTime: 60 * 1000, // 1 min
    placeholderData: (prev) => prev,
  })
}
// Resource History API
export const fetchResourceHistory = (
  resourceType: string,
  namespace: string,
  name: string,
  page: number = 1,
  pageSize: number = 10
): Promise<ResourceHistoryResponse> => {
  const endpoint = `/${resourceType}/${namespace}/${name}/history?page=${page}&pageSize=${pageSize}`
  return fetchAPI<ResourceHistoryResponse>(endpoint)
}

export const useResourceHistory = (
  resourceType: string,
  namespace: string,
  name: string,
  page: number = 1,
  pageSize: number = 10,
  options?: { enabled?: boolean; staleTime?: number }
) => {
  return useQuery({
    queryKey: [
      'resource-history',
      resourceType,
      namespace,
      name,
      page,
      pageSize,
    ],
    queryFn: () =>
      fetchResourceHistory(resourceType, namespace, name, page, pageSize),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime || 30000, // 30 seconds cache
  })
}
export const usePodFiles = (
  namespace: string,
  podName: string,
  container: string,
  path: string,
  options?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['pod-files', namespace, podName, container, path],
    queryFn: () => podListFiles(namespace, podName, container, path),
    enabled: options?.enabled !== false,
    staleTime: 10000, // 10 seconds cache
  })
}
