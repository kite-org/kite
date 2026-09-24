import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api-client'
import {
  getCurrentCluster,
  withCurrentClusterPath,
} from '@/lib/current-cluster'
import { useCluster } from '@/hooks/use-cluster'

export type PrometheusSample = [timestamp: number, value: string]

export type PrometheusHistogram = [
  timestamp: number,
  histogram: {
    count: string
    sum: string
    buckets:
      [boundaries: number, lower: string, upper: string, count: string][] | null
  },
]

export type PrometheusResult = (
  | { resultType: 'scalar' | 'string'; result: PrometheusSample }
  | {
      resultType: 'vector'
      result: {
        metric: Record<string, string>
        value?: PrometheusSample
        histogram?: PrometheusHistogram
      }[]
    }
  | {
      resultType: 'matrix'
      result: {
        metric: Record<string, string>
        values?: PrometheusSample[]
        histograms?: PrometheusHistogram[]
      }[]
    }
) & { warnings?: string[] | null }

export interface PrometheusQueryOptions {
  cluster?: string
  time?: number
  signal?: AbortSignal
}

export interface PrometheusRangeOptions extends Omit<
  PrometheusQueryOptions,
  'time'
> {
  start: number
  end: number
  step: number
}

export interface PrometheusQueryControls {
  enabled?: boolean
  staleTime?: number
  refreshInterval?: number
}

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
