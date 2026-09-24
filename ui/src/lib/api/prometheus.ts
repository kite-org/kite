import type {
  PrometheusQueryControls,
  PrometheusQueryOptions,
  PrometheusRangeOptions,
  PrometheusResult,
} from '@kite-dev/plugin-sdk/observability'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api-client'
import {
  getCurrentCluster,
  withCurrentClusterPath,
} from '@/lib/current-cluster'
import { useCluster } from '@/hooks/use-cluster'

export function queryPrometheus(
  query: string,
  options: PrometheusQueryOptions = {}
): Promise<PrometheusResult> {
  const params = new URLSearchParams({ query })
  if (options.time !== undefined) params.set('time', String(options.time))
  return apiClient.get(
    withCurrentClusterPath(
      `/prometheus/query?${params}`,
      options.cluster ?? getCurrentCluster()
    ),
    { signal: options.signal }
  )
}

export function queryPrometheusRange(
  query: string,
  options: PrometheusRangeOptions
): Promise<PrometheusResult> {
  const params = new URLSearchParams({
    query,
    start: String(options.start),
    end: String(options.end),
    step: String(options.step),
  })
  return apiClient.get(
    withCurrentClusterPath(
      `/prometheus/query_range?${params}`,
      options.cluster ?? getCurrentCluster()
    ),
    { signal: options.signal }
  )
}

export function usePrometheusQuery(
  query: string,
  options: Omit<PrometheusQueryOptions, 'signal'> & PrometheusQueryControls = {}
) {
  const { currentCluster } = useCluster()
  const cluster = options.cluster ?? currentCluster
  return useQuery({
    queryKey: ['prometheus-query', cluster, query, options.time],
    queryFn: ({ signal }) =>
      queryPrometheus(query, { cluster: cluster!, time: options.time, signal }),
    enabled: options.enabled !== false && !!cluster && !!query,
    staleTime: options.staleTime ?? 30000,
    refetchInterval: options.refreshInterval ?? false,
  })
}

export function usePrometheusRangeQuery(
  query: string,
  options: Omit<PrometheusRangeOptions, 'signal'> & PrometheusQueryControls
) {
  const { currentCluster } = useCluster()
  const cluster = options.cluster ?? currentCluster
  return useQuery({
    queryKey: [
      'prometheus-range-query',
      cluster,
      query,
      options.start,
      options.end,
      options.step,
    ],
    queryFn: ({ signal }) =>
      queryPrometheusRange(query, {
        cluster: cluster!,
        start: options.start,
        end: options.end,
        step: options.step,
        signal,
      }),
    enabled: options.enabled !== false && !!cluster && !!query,
    staleTime: options.staleTime ?? 30000,
    refetchInterval: options.refreshInterval ?? false,
  })
}
