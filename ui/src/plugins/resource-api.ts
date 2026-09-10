import type {
  DeepPartial,
  RelatedResource,
  ResourceDeleteOptions,
  ResourceHistoryQueryOptions,
  ResourceHistoryResponse,
  ResourceQueryOptions,
  ResourceReference,
  ResourceScopeOptions,
} from '@kite-dev/plugin-sdk/resources'
import { useQuery } from '@tanstack/react-query'
import type { Event } from 'kubernetes-types/core/v1'

import { apiClient } from '@/lib/api-client'
import {
  getCurrentCluster,
  withCurrentClusterPath,
} from '@/lib/current-cluster'
import { getResourceCatalogEntry } from '@/lib/resource-catalog'
import { useCluster } from '@/hooks/use-cluster'

import { usePluginNamespace } from './namespace-context'

type ResourceFetchOptions = ResourceQueryOptions & { signal?: AbortSignal }
type ResourceList<T> = { items: T[] }

export function resourcePath(resource: ResourceReference) {
  if (
    resource.group === 'apiextensions.k8s.io' &&
    resource.resource === 'customresourcedefinitions'
  )
    return 'crds'
  if (resource.group === 'metrics.k8s.io' && resource.resource === 'pods')
    return 'podmetrics'
  if (resource.group === 'metrics.k8s.io' && resource.resource === 'nodes')
    return 'nodemetrics'
  const entry = getResourceCatalogEntry(resource.resource)
  if (entry && ('apiGroup' in entry ? entry.apiGroup : '') === resource.group)
    return entry.type
  return encodeURIComponent(`${resource.resource}.${resource.group}`)
}

function resourceScope(
  resource: ResourceReference,
  options: ResourceScopeOptions = {}
) {
  const path = resourcePath(resource)
  const clusterScope =
    resource.scope === 'Cluster' || getResourceCatalogEntry(path)?.clusterScope
  return {
    path,
    cluster: options.cluster ?? getCurrentCluster(),
    namespace: clusterScope ? '_all' : options.namespace || '_all',
  }
}

function useResourceScope(
  resource: ResourceReference,
  options: ResourceQueryOptions
) {
  const { currentCluster } = useCluster()
  const { namespace } = usePluginNamespace()
  return {
    ...resourceScope(resource, { namespace: options.namespace ?? namespace }),
    cluster: options.cluster ?? currentCluster,
  }
}

function resourceEndpoint(
  scope: ReturnType<typeof resourceScope>,
  name?: string
) {
  return withCurrentClusterPath(
    `/${scope.path}/${encodeURIComponent(scope.namespace)}${name === undefined ? '' : `/${encodeURIComponent(name)}`}`,
    scope.cluster
  )
}

function listParameters(options: ResourceFetchOptions) {
  const params = new URLSearchParams()
  if (options.labelSelector) params.set('labelSelector', options.labelSelector)
  if (options.fieldSelector) params.set('fieldSelector', options.fieldSelector)
  params.set('reduce', String(options.reduce ?? false))
  return params
}

async function fetchResources<T>(
  resource: ResourceReference,
  options: ResourceFetchOptions = {}
): Promise<ResourceList<T>> {
  const scope = resourceScope(resource, options)
  if (scope.path.includes('.') && options.fieldSelector)
    throw new Error(
      'Custom resources support labelSelector; fieldSelector is not supported by this API'
    )
  const namespaces = scope.namespace.split(',').filter(Boolean)
  const params = listParameters(options)
  const results = await Promise.all(
    namespaces.map((namespace) =>
      apiClient.get<ResourceList<T>>(
        `${resourceEndpoint({ ...scope, namespace })}?${params}`,
        { signal: options.signal }
      )
    )
  )
  return results.length === 1
    ? results[0]
    : { items: results.flatMap((result) => result.items) }
}

function fetchResource<T>(
  resource: ResourceReference,
  name: string,
  options: ResourceScopeOptions = {}
): Promise<T> {
  return apiClient.get<T>(
    resourceEndpoint(resourceScope(resource, options), name),
    {
      signal: options.signal,
    }
  )
}

export async function updateResource<T>(
  resource: ResourceReference,
  name: string,
  body: T,
  options: ResourceScopeOptions = {}
): Promise<void> {
  await apiClient.put(
    resourceEndpoint(resourceScope(resource, options), name),
    body,
    {
      signal: options.signal,
    }
  )
}

export async function patchResource<T>(
  resource: ResourceReference,
  name: string,
  body: DeepPartial<T>,
  options: ResourceScopeOptions = {}
): Promise<void> {
  const scope = resourceScope(resource, options)
  if (scope.path.includes('.'))
    throw new Error(
      'Patching custom resources through this endpoint is not supported; use applyResource instead'
    )
  await apiClient.patch(resourceEndpoint(scope, name), body, {
    signal: options.signal,
  })
}

export async function deleteResource(
  resource: ResourceReference,
  name: string,
  options: ResourceDeleteOptions = {}
): Promise<void> {
  const params = new URLSearchParams()
  if (options.force) params.set('force', 'true')
  if (options.wait === false) params.set('wait', 'false')
  await apiClient.delete(
    `${resourceEndpoint(resourceScope(resource, options), name)}?${params}`,
    { signal: options.signal }
  )
}

export function usePluginResources<T>(
  resource: ResourceReference,
  options: ResourceQueryOptions = {}
) {
  const scope = useResourceScope(resource, options)
  return useQuery({
    queryKey: [
      'plugin-resources',
      scope.cluster,
      resource.group,
      resource.resource,
      scope.namespace,
      listParameters(options).toString(),
    ],
    queryFn: async ({ signal }) => {
      const result = await fetchResources<T>(resource, {
        ...options,
        namespace: scope.namespace,
        cluster: scope.cluster ?? undefined,
        signal,
      })
      return result.items
    },
    enabled: options.enabled !== false && !!scope.cluster,
    staleTime: options.staleTime ?? 1000,
    refetchInterval: options.refreshInterval ?? false,
  })
}

export function usePluginResource<T>(
  resource: ResourceReference,
  name: string,
  options: ResourceQueryOptions = {}
) {
  const scope = useResourceScope(resource, options)
  return useQuery({
    queryKey: [
      'plugin-resource',
      scope.cluster,
      resource.group,
      resource.resource,
      scope.namespace,
      name,
    ],
    queryFn: ({ signal }) =>
      fetchResource<T>(resource, name, {
        namespace: scope.namespace,
        cluster: scope.cluster ?? undefined,
        signal,
      }),
    enabled: options.enabled !== false && !!scope.cluster && !!name,
    staleTime: options.staleTime ?? 1000,
    refetchInterval: options.refreshInterval ?? false,
  })
}

export function useResourceEvents(
  resource: ResourceReference,
  name: string,
  options: ResourceQueryOptions = {}
) {
  const scope = useResourceScope(resource, options)
  return useQuery({
    queryKey: [
      'plugin-resource-events',
      scope.cluster,
      scope.path,
      scope.namespace,
      name,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        resource: scope.path,
        namespace: scope.namespace,
        name,
      })
      const result = await apiClient.get<ResourceList<Event>>(
        `${withCurrentClusterPath('/events/resources', scope.cluster)}?${params}`,
        { signal }
      )
      return result.items
    },
    enabled: options.enabled !== false && !!scope.cluster && !!name,
    staleTime: options.staleTime ?? 1000,
    refetchInterval: options.refreshInterval ?? false,
  })
}

function fetchDescribe(
  resource: ResourceReference,
  name: string,
  options: ResourceScopeOptions = {}
) {
  return apiClient.get<{ result: string }>(
    `${resourceEndpoint(resourceScope(resource, options), name)}/describe`,
    { signal: options.signal }
  )
}

export function useDescribe(
  resource: ResourceReference,
  name: string,
  options: ResourceQueryOptions = {}
) {
  const scope = useResourceScope(resource, options)
  return useQuery({
    queryKey: [
      'plugin-resource-describe',
      scope.cluster,
      scope.path,
      scope.namespace,
      name,
    ],
    queryFn: ({ signal }) =>
      fetchDescribe(resource, name, {
        namespace: scope.namespace,
        cluster: scope.cluster ?? undefined,
        signal,
      }),
    enabled: options.enabled !== false && !!scope.cluster && !!name,
    staleTime: options.staleTime ?? 0,
    refetchInterval: options.refreshInterval ?? false,
    retry: false,
  })
}

function fetchResourceHistory(
  resource: ResourceReference,
  name: string,
  options: ResourceScopeOptions & { page?: number; pageSize?: number } = {}
) {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 10),
  })
  return apiClient.get<ResourceHistoryResponse>(
    `${resourceEndpoint(resourceScope(resource, options), name)}/history?${params}`,
    { signal: options.signal }
  )
}

export function useResourceHistory(
  resource: ResourceReference,
  name: string,
  options: ResourceHistoryQueryOptions = {}
) {
  const scope = useResourceScope(resource, options)
  return useQuery({
    queryKey: [
      'plugin-resource-history',
      scope.cluster,
      scope.path,
      scope.namespace,
      name,
      options.page ?? 1,
      options.pageSize ?? 10,
    ],
    queryFn: ({ signal }) =>
      fetchResourceHistory(resource, name, {
        ...options,
        namespace: scope.namespace,
        cluster: scope.cluster ?? undefined,
        signal,
      }),
    enabled: options.enabled !== false && !!scope.cluster && !!name,
    staleTime: options.staleTime ?? 30000,
    refetchInterval: options.refreshInterval ?? false,
  })
}

async function getRelatedResources(
  resource: ResourceReference,
  name: string,
  options: ResourceScopeOptions = {}
): Promise<RelatedResource[]> {
  const scope = resourceScope(resource, options)
  if (scope.path.includes('.'))
    throw new Error(
      'Related resource discovery is only available for supported built-in resources; query custom resource relationships with useResources'
    )
  return apiClient.get<RelatedResource[]>(
    `${resourceEndpoint(scope, name)}/related`,
    {
      signal: options.signal,
    }
  )
}

export function useRelatedResources(
  resource: ResourceReference,
  name: string,
  options: ResourceQueryOptions = {}
) {
  const scope = useResourceScope(resource, options)
  return useQuery({
    queryKey: [
      'plugin-related-resources',
      scope.cluster,
      scope.path,
      scope.namespace,
      name,
    ],
    queryFn: ({ signal }) =>
      getRelatedResources(resource, name, {
        namespace: scope.namespace,
        cluster: scope.cluster ?? undefined,
        signal,
      }),
    enabled: options.enabled !== false && !!scope.cluster && !!name,
    staleTime: options.staleTime ?? 60000,
    refetchInterval: options.refreshInterval ?? false,
  })
}
