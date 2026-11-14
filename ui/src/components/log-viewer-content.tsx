import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Container, EphemeralContainer, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'

import { useLogsWebSocket } from '@/lib/api'
import { toSimpleContainer } from '@/lib/k8s'
import { CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { ConnectionIndicator } from './connection-indicator'
import { LogViewerPanel, type LogViewerEntry } from './log-viewer-panel'
import { NetworkSpeedIndicator } from './network-speed-indicator'
import { ContainerSelector } from './selector/container-selector'
import { PodSelector } from './selector/pod-selector'

export interface LogViewerProps {
  namespace: string
  podName?: string
  pods?: Pod[]
  labelSelector?: string
  containers?: Container[]
  initContainers?: Container[]
  ephemeralContainers?: EphemeralContainer[]
  selectedContainerName?: string
  onClose?: () => void
}

export function LogViewer({
  namespace,
  podName,
  pods,
  labelSelector,
  containers: podContainers,
  initContainers,
  ephemeralContainers,
  selectedContainerName,
  onClose,
}: LogViewerProps) {
  const { t } = useTranslation()
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, podContainers, ephemeralContainers)
  }, [podContainers, initContainers, ephemeralContainers])
  const [selectedContainer, setSelectedContainer] = useState<
    string | undefined
  >(containers.length > 0 ? containers[0].name : '')
  const selectedContainerIsEphemeral = containers.some(
    (container) => container.name === selectedContainer && container.ephemeral
  )
  const [tailLines, setTailLines] = useState(() => {
    const saved = localStorage.getItem('log-viewer-tail-lines')
    return saved ? parseInt(saved, 10) : 100
  })
  const [previous, setPrevious] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [entries, setEntries] = useState<LogViewerEntry[]>([])
  const pending = useRef<LogViewerEntry[]>([])
  const sequence = useRef(0)
  const sortedPods = useMemo(() => {
    if (!pods) {
      return undefined
    }

    return [...pods].sort((a, b) =>
      (a.metadata?.creationTimestamp || 0) >
      (b.metadata?.creationTimestamp || 0)
        ? -1
        : 1
    )
  }, [pods])
  const [selectPodName, setSelectPodName] = useState<string | undefined>(
    podName || pods?.[0]?.metadata?.name || undefined
  )

  useEffect(() => {
    if (podName) {
      if (selectPodName !== podName) {
        setSelectPodName(podName)
      }
      return
    }
    if (pods && pods.length > 0) {
      if (
        selectPodName !== '_all' &&
        (!selectPodName ||
          !pods.find((p) => p.metadata?.name === selectPodName))
      ) {
        setSelectPodName(pods[0].metadata?.name)
      }
    }
  }, [podName, pods, selectPodName])

  useEffect(() => {
    if (containers.length === 0) {
      setSelectedContainer('')
      return
    }

    setSelectedContainer((current) => {
      if (
        selectedContainerName &&
        containers.some((container) => container.name === selectedContainerName)
      ) {
        return selectedContainerName
      }
      if (
        !current ||
        !containers.some((container) => container.name === current)
      ) {
        return containers[0].name
      }
      return current
    })
  }, [containers, selectedContainerName])

  // Handle tail lines change and persist to localStorage
  const handleTailLinesChange = useCallback((lines: number) => {
    setTailLines(lines)
    if (lines !== -1) {
      localStorage.setItem('log-viewer-tail-lines', lines.toString())
    }
  }, [])

  const appendLog = useCallback((log: string) => {
    // Workload streams may prepend the Pod name before the Kubernetes timestamp.
    const match = /^(\[[^\]]+\]: )?(\d{4}-\d{2}-\d{2}T\S+) /.exec(log)
    const timestamp = match ? Date.parse(match[2]) : NaN
    const hasTimestamp = Number.isFinite(timestamp)
    pending.current.push({
      id: sequence.current++,
      text:
        hasTimestamp && match
          ? (match[1] ?? '') + log.slice(match[0].length)
          : log,
      timestamp: hasTimestamp ? timestamp : undefined,
    })
  }, [])
  useEffect(() => {
    const timer = setInterval(() => {
      if (!pending.current.length) return
      const batch = pending.current
      pending.current = []
      setEntries((current) => [...current, ...batch])
    }, 100)
    return () => clearInterval(timer)
  }, [])
  const cleanLog = useCallback(() => {
    pending.current = []
    setEntries([])
  }, [])
  const logsOptions = useMemo(
    () => ({
      container: selectedContainer,
      tailLines,
      timestamps: true,
      previous: previous && !selectedContainerIsEphemeral,
      enabled: !!selectPodName,
      labelSelector,
      onNewLog: appendLog,
      onClear: cleanLog,
    }),
    [
      selectedContainer,
      tailLines,
      previous,
      selectedContainerIsEphemeral,
      selectPodName,
      labelSelector,
      appendLog,
      cleanLog,
    ]
  )

  const {
    isLoading,
    isConnected,
    downloadSpeed,
    refetch,
    stopStreaming,
    clearLogs,
  } = useLogsWebSocket(namespace, selectPodName || '', logsOptions)

  const stopStreamingRef = useRef<() => void>(stopStreaming)
  stopStreamingRef.current = stopStreaming

  // Clean up WebSocket connection when component unmounts
  useEffect(() => {
    return () => {
      if (stopStreamingRef.current) {
        stopStreamingRef.current()
      }
    }
  }, [])

  // Stop previous stream when critical parameters change
  useEffect(() => {
    // Clear on parameter changes, not on open, to preserve the incoming historical tail.
    cleanLog()

    // Show reconnecting state when parameters change
    setIsReconnecting(true)
  }, [
    namespace,
    labelSelector,
    selectedContainer,
    selectPodName,
    tailLines,
    previous,
    cleanLog,
  ])

  // Hide reconnecting state when loading completes
  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => setIsReconnecting(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isLoading])

  return (
    <LogViewerPanel
      entries={entries}
      onClear={clearLogs}
      onClose={onClose}
      downloadFilename={`${selectPodName || 'all-pods'}-${selectedContainer || 'pod'}-logs.txt`}
      header={<CardTitle className="text-lg">{t('logViewer.title')}</CardTitle>}
      status={
        <>
          <ConnectionIndicator
            isConnected={isConnected}
            onReconnect={refetch}
          />
          <NetworkSpeedIndicator
            downloadSpeed={downloadSpeed}
            uploadSpeed={0}
          />
          {isLoading && <span>{t('common.messages.loading')}</span>}
          {isReconnecting && <span>{t('logViewer.reconnecting')}</span>}
        </>
      }
      toolbar={
        <>
          {containers.length > 1 && (
            <ContainerSelector
              containers={containers}
              showAllOption={false}
              selectedContainer={selectedContainer}
              onContainerChange={setSelectedContainer}
            />
          )}
          {sortedPods && (
            <PodSelector
              pods={sortedPods}
              showAllOption={true}
              selectedPod={selectPodName}
              onPodChange={(value) => setSelectPodName(value || '_all')}
            />
          )}
        </>
      }
      settings={
        <>
          <div className="flex items-center justify-between">
            <Label htmlFor="tail-lines">{t('logViewer.tailLines')}</Label>
            <Select
              value={tailLines.toString()}
              onValueChange={(value) => handleTailLinesChange(Number(value))}
            >
              <SelectTrigger id="tail-lines">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[50, 100, 200, 500, 1000].map((lines) => (
                  <SelectItem key={lines} value={String(lines)}>
                    {lines}
                  </SelectItem>
                ))}
                <SelectItem value="-1">{t('logViewer.allLines')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="previous">{t('logViewer.previousContainer')}</Label>
            <Switch
              id="previous"
              checked={previous && !selectedContainerIsEphemeral}
              disabled={selectedContainerIsEphemeral}
              onCheckedChange={setPrevious}
            />
          </div>
        </>
      }
    />
  )
}
