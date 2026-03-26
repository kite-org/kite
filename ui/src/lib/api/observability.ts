import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { OverviewData, PodMetrics, ResourceUsageHistory } from '@/types/api'

import { API_BASE_URL } from '../api-client'
import { getWebSocketUrl } from '../subpath'
import useWebSocket, { WebSocketMessage } from '../useWebSocket'
import { fetchAPI } from './shared'

// Overview API
const fetchOverview = (): Promise<OverviewData> => {
  return fetchAPI<OverviewData>('/overview')
}

export const useOverview = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
    staleTime: options?.staleTime || 30000, // 30 seconds cache
    refetchInterval: 30000, // Auto refresh every 30 seconds
  })
}

// Resource Usage History API
export const fetchResourceUsageHistory = (
  duration: string,
  instance?: string
): Promise<ResourceUsageHistory> => {
  const endpoint = `/prometheus/resource-usage-history?duration=${duration}`
  if (instance) {
    return fetchAPI<ResourceUsageHistory>(
      `${endpoint}&instance=${encodeURIComponent(instance)}`
    )
  }
  return fetchAPI<ResourceUsageHistory>(endpoint)
}

export const useResourceUsageHistory = (
  duration: string,
  options?: { staleTime?: number; instance?: string; enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['resource-usage-history', duration, options?.instance],
    queryFn: () => fetchResourceUsageHistory(duration, options?.instance),
    enabled: options?.enabled,
    staleTime: options?.staleTime || 10000, // 10 seconds cache
    refetchInterval: 30000, // Auto refresh every 30 seconds for historical data
    retry: 0,
    placeholderData: (prevData) => prevData, // Keep previous data while loading new data
  })
}

// Pod monitoring API functions
export const fetchPodMetrics = (
  namespace: string,
  podName: string,
  duration: string,
  container?: string,
  labelSelector?: string
): Promise<PodMetrics> => {
  let endpoint = `/prometheus/pods/${namespace}/${podName}/metrics?duration=${duration}`
  if (container) {
    endpoint += `&container=${encodeURIComponent(container)}`
  }
  if (labelSelector) {
    endpoint += `&labelSelector=${encodeURIComponent(labelSelector)}`
  }
  return fetchAPI<PodMetrics>(endpoint)
}

export const usePodMetrics = (
  namespace: string,
  podName: string,
  duration: string,
  options?: {
    staleTime?: number
    container?: string
    refreshInterval?: number
    labelSelector?: string
  }
) => {
  return useQuery({
    queryKey: [
      'pod-metrics',
      namespace,
      podName,
      duration,
      options?.container,
      options?.labelSelector,
    ],
    queryFn: () =>
      fetchPodMetrics(
        namespace,
        podName,
        duration,
        options?.container,
        options?.labelSelector
      ),
    enabled: !!namespace && !!podName,
    staleTime: options?.staleTime || 10000, // 10 seconds cache
    refetchInterval: options?.refreshInterval || 30 * 1000, // 1 second
    retry: 0,
    placeholderData: (prevData) => prevData,
  })
}
// Logs API functions
export interface LogsResponse {
  logs: string[]
  container?: string
  pod: string
  namespace: string
}

// Function to fetch static logs (follow=false)
export const fetchPodLogs = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
  }
): Promise<LogsResponse> => {
  const params = new URLSearchParams()
  params.append('follow', 'false') // Explicitly set follow=false for static logs

  if (options?.container) {
    params.append('container', options.container)
  }
  if (options?.tailLines !== undefined) {
    params.append('tailLines', options.tailLines.toString())
  }
  if (options?.timestamps !== undefined) {
    params.append('timestamps', options.timestamps.toString())
  }
  if (options?.previous !== undefined) {
    params.append('previous', options.previous.toString())
  }
  if (options?.sinceSeconds !== undefined) {
    params.append('sinceSeconds', options.sinceSeconds.toString())
  }

  const endpoint = `/logs/${namespace}/${podName}${params.toString() ? `?${params.toString()}` : ''}`
  return fetchAPI<LogsResponse>(endpoint)
}

// Function to create SSE-based logs connection (follow=true)
export const createLogsSSEStream = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
  },
  onMessage?: (data: string) => void,
  onError?: (error: Error) => void,
  onClose?: () => void,
  onOpen?: () => void
): EventSource => {
  const params = new URLSearchParams()
  params.append('follow', 'true') // Enable streaming

  if (options?.container) {
    params.append('container', options.container)
  }
  if (options?.tailLines !== undefined) {
    params.append('tailLines', options.tailLines.toString())
  }
  if (options?.timestamps !== undefined) {
    params.append('timestamps', options.timestamps.toString())
  }
  if (options?.previous !== undefined) {
    params.append('previous', options.previous.toString())
  }
  if (options?.sinceSeconds !== undefined) {
    params.append('sinceSeconds', options.sinceSeconds.toString())
  }

  const currentCluster = localStorage.getItem('current-cluster')
  if (currentCluster) {
    params.append('x-cluster-name', currentCluster)
  }

  const endpoint = `${API_BASE_URL}/logs/${namespace}/${podName}?${params.toString()}`
  const eventSource = new EventSource(endpoint, {
    withCredentials: true,
  })

  // Handle SSE open event
  eventSource.onopen = () => {
    console.log('SSE connection opened')
    if (onOpen) {
      onOpen()
    }
  }

  // Handle connection established
  eventSource.addEventListener('connected', (event: MessageEvent) => {
    console.log('SSE connection established:', event.data)
  })

  // Handle log messages
  eventSource.addEventListener('log', (event: MessageEvent) => {
    if (onMessage) {
      onMessage(event.data)
    }
  })

  // Handle errors from server
  eventSource.addEventListener('error', (event: MessageEvent) => {
    try {
      const errorData = JSON.parse(event.data)
      if (onError) {
        onError(new Error(errorData.error))
      }
    } catch {
      // This is not a server error event, likely a connection error
      console.warn('SSE error event without valid JSON data')
    }
  })

  // Handle connection close
  eventSource.addEventListener('close', () => {
    eventSource.close()
    if (onClose) {
      onClose()
    }
  })

  // Handle generic SSE errors (connection issues)
  eventSource.onerror = (event) => {
    console.error('SSE connection error:', event)
    if (eventSource.readyState === EventSource.CLOSED) {
      console.log('SSE connection closed')
      if (onClose) {
        onClose()
      }
    } else if (eventSource.readyState === EventSource.CONNECTING) {
      console.log('SSE reconnecting...')
    } else {
      if (onError) {
        onError(new Error('SSE connection error'))
      }
    }
  }

  return eventSource
}

// Pod File Browser API

export const useLogsStream = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
    enabled?: boolean
    follow?: boolean
  }
) => {
  const [logs, setLogs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [downloadSpeed, setDownloadSpeed] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const networkStatsRef = useRef({
    lastReset: Date.now(),
    bytesReceived: 0,
  })
  const speedUpdateTimerRef = useRef<NodeJS.Timeout | null>(null)

  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    // Clear speed update timer
    if (speedUpdateTimerRef.current) {
      clearInterval(speedUpdateTimerRef.current)
      speedUpdateTimerRef.current = null
    }

    setIsConnected(false)
    setIsLoading(false)
    setDownloadSpeed(0)
  }, [])

  const startStreaming = useCallback(async () => {
    if (!namespace || !podName || options?.enabled === false) return

    // Close any existing connection first to prevent race conditions
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    try {
      setIsLoading(true)
      setError(null)
      setLogs([]) // Clear previous logs when starting new stream

      if (options?.follow) {
        // Use SSE for follow mode
        const eventSource = createLogsSSEStream(
          namespace,
          podName,
          {
            container: options?.container,
            tailLines: options?.tailLines,
            timestamps: options?.timestamps,
            previous: options?.previous,
            sinceSeconds: options?.sinceSeconds,
          },
          // onMessage callback
          (logLine: string) => {
            // Calculate data size for network speed tracking
            const dataSize = new Blob([logLine]).size
            networkStatsRef.current.bytesReceived += dataSize

            setLogs((prev) => [...prev, logLine])
          },
          // onError callback
          (err: Error) => {
            console.error('SSE error:', err)
            setError(err)
            setIsLoading(false)
            setIsConnected(false)
          },
          // onClose callback
          () => {
            setIsLoading(false)
            setIsConnected(false)
          },
          // onOpen callback
          () => {
            setIsLoading(false)
            setIsConnected(true)
            setError(null)

            // Reset network stats and start speed tracking
            networkStatsRef.current = {
              lastReset: Date.now(),
              bytesReceived: 0,
            }
            setDownloadSpeed(0)

            // Start periodic speed update timer
            if (speedUpdateTimerRef.current) {
              clearInterval(speedUpdateTimerRef.current)
            }
            speedUpdateTimerRef.current = setInterval(() => {
              const now = Date.now()
              const stats = networkStatsRef.current
              const timeDiff = (now - stats.lastReset) / 1000

              if (timeDiff > 0) {
                const downloadSpeedValue = stats.bytesReceived / timeDiff
                setDownloadSpeed(downloadSpeedValue)

                // Reset counters every 3 seconds
                if (timeDiff >= 3) {
                  stats.lastReset = now
                  stats.bytesReceived = 0
                }
              }
            }, 500)
          }
        )

        eventSourceRef.current = eventSource
      } else {
        // Use static fetch for non-follow mode
        const response = await fetchPodLogs(namespace, podName, {
          container: options?.container,
          tailLines: options?.tailLines,
          timestamps: options?.timestamps,
          previous: options?.previous,
          sinceSeconds: options?.sinceSeconds,
        })

        setLogs(response.logs || [])
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err)
      }
    } finally {
      if (!options?.follow) {
        setIsLoading(false)
        setIsConnected(false)
      }
    }
  }, [
    namespace,
    podName,
    options?.container,
    options?.tailLines,
    options?.timestamps,
    options?.previous,
    options?.sinceSeconds,
    options?.enabled,
    options?.follow,
  ])

  const refetch = useCallback(() => {
    stopStreaming()
    setTimeout(startStreaming, 100) // Small delay to ensure cleanup
  }, [stopStreaming, startStreaming])

  useEffect(() => {
    if (options?.enabled !== false) {
      startStreaming()
    }

    return () => {
      stopStreaming()
    }
  }, [startStreaming, stopStreaming, options?.enabled])

  // Cleanup on unmount
  useEffect(() => {
    return stopStreaming
  }, [stopStreaming])

  return {
    logs,
    isLoading,
    error,
    isConnected,
    downloadSpeed,
    refetch,
    stopStreaming,
  }
}
export const useLogsWebSocket = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
    enabled?: boolean
    labelSelector?: string
    onNewLog?: (log: string) => void
    onClear?: () => void
  }
) => {
  // Build WebSocket URL
  const buildWebSocketUrl = useCallback(() => {
    if (!options?.enabled || !namespace || !podName) return ''

    const params = new URLSearchParams()

    if (options.container) {
      params.append('container', options.container)
    }
    if (options.tailLines !== undefined) {
      params.append('tailLines', options.tailLines.toString())
    }
    if (options.timestamps !== undefined) {
      params.append('timestamps', options.timestamps.toString())
    }
    if (options.previous !== undefined) {
      params.append('previous', options.previous.toString())
    }
    if (options.sinceSeconds !== undefined) {
      params.append('sinceSeconds', options.sinceSeconds.toString())
    }
    if (options.labelSelector) {
      params.append('labelSelector', options.labelSelector)
    }

    const currentCluster = localStorage.getItem('current-cluster')
    if (currentCluster) {
      params.append('x-cluster-name', currentCluster)
    }

    const wsPath = `/api/v1/logs/${namespace}/${podName}/ws?${params.toString()}`
    return getWebSocketUrl(wsPath)
  }, [
    namespace,
    podName,
    options?.container,
    options?.tailLines,
    options?.timestamps,
    options?.previous,
    options?.sinceSeconds,
    options?.enabled,
    options?.labelSelector,
  ])

  // WebSocket event handlers
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case 'log':
          if (message.data && options?.onNewLog) {
            options.onNewLog(message.data)
          }
          break
        case 'error':
          console.error('Log streaming error:', message.data)
          break
        case 'close':
          console.log('Log stream closed:', message.data)
          break
      }
    },
    [options]
  )

  const handleOpen = useCallback(() => {
    console.debug('WebSocket connection opened')
    if (options?.onClear) {
      options.onClear()
    }
  }, [options])

  const handleClose = useCallback(() => {
    console.debug('WebSocket connection closed')
  }, [])

  const handleError = useCallback((event: Event) => {
    console.debug('WebSocket error:', event)
  }, [])

  // Use the generic WebSocket hook
  const [wsState, wsActions] = useWebSocket(
    buildWebSocketUrl,
    {
      onMessage: handleMessage,
      onOpen: handleOpen,
      onClose: handleClose,
      onError: handleError,
    },
    {
      enabled: options?.enabled !== false,
      pingInterval: 20000, // 20 seconds for logs
      reconnectOnClose: true,
      maxReconnectAttempts: 3,
      reconnectInterval: 5000,
    }
  )

  const refetch = useCallback(() => {
    wsActions.reconnect()
    if (options?.onClear) {
      options.onClear()
    }
  }, [wsActions, options])

  const stopStreaming = useCallback(() => {
    wsActions.disconnect()
  }, [wsActions])

  const clearLogs = useCallback(() => {
    if (options?.onClear) {
      options.onClear()
    }
  }, [options])

  return useMemo(
    () => ({
      isLoading: wsState.isConnecting,
      error: wsState.error,
      isConnected: wsState.isConnected,
      downloadSpeed: wsState.networkStats.downloadSpeed,
      refetch,
      stopStreaming,
      clearLogs,
    }),
    [
      wsState.isConnecting,
      wsState.error,
      wsState.isConnected,
      wsState.networkStats.downloadSpeed,
      refetch,
      stopStreaming,
      clearLogs,
    ]
  )
}
