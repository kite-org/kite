/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Cluster } from '@/types/api'
import { useCurrentClusterList } from '@/lib/api'
import {
  clearCurrentCluster,
  getCurrentCluster,
  setCurrentCluster as persistCurrentCluster,
} from '@/lib/current-cluster'

interface ClusterContextType {
  clusters: Cluster[]
  currentCluster: string | null
  setCurrentCluster: (clusterName: string) => void
  isLoading: boolean
  isSwitching?: boolean
  error: Error | null
}

export const ClusterContext = createContext<ClusterContextType | undefined>(
  undefined
)

export const ClusterProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [currentCluster, setCurrentClusterState] = useState<string | null>(
    getCurrentCluster()
  )
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)
  const queryClient = useQueryClient()
  const { refetch: refetchClusters } = useCurrentClusterList({
    enabled: false,
  })

  useEffect(() => {
    if (currentCluster) {
      persistCurrentCluster(currentCluster)
      return
    }
    clearCurrentCluster()
  }, [currentCluster])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setIsLoading(true)
      const result = await refetchClusters()
      if (cancelled) {
        return
      }

      if (result.data) {
        setClusters(result.data)
        setError(null)
      } else {
        setClusters([])
        setError(result.error instanceof Error ? result.error : null)
      }
      setIsLoading(false)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [refetchClusters])

  useEffect(() => {
    if (clusters.length > 0 && !currentCluster) {
      const defaultCluster = clusters.find((cluster) => cluster.isDefault)
      const nextCluster = defaultCluster
        ? defaultCluster.name
        : clusters[0].name
      setCurrentClusterState(nextCluster)
      persistCurrentCluster(nextCluster)
    }

    if (
      currentCluster &&
      clusters.length > 0 &&
      !clusters.some((cluster) => cluster.name === currentCluster)
    ) {
      setCurrentClusterState(null)
      clearCurrentCluster()
    }
  }, [clusters, currentCluster])

  const setCurrentCluster = async (clusterName: string) => {
    if (clusterName === currentCluster || isSwitching) {
      return
    }

    setIsSwitching(true)
    setCurrentClusterState(clusterName)
    persistCurrentCluster(clusterName)

    try {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0] as string
          return !['user', 'auth', 'clusters'].includes(key)
        },
      })
      toast.success(`Switched to cluster: ${clusterName}`, {
        id: 'cluster-switch',
      })
    } catch (switchError) {
      console.error('Failed to switch cluster:', switchError)
      toast.error('Failed to switch cluster', {
        id: 'cluster-switch',
      })
    } finally {
      setIsSwitching(false)
    }
  }

  const value: ClusterContextType = {
    clusters,
    currentCluster,
    setCurrentCluster,
    isLoading,
    isSwitching,
    error,
  }

  return (
    <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>
  )
}
