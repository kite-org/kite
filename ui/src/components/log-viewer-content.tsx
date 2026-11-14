import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { OnMount } from '@monaco-editor/react'
import {
  IconClearAll,
  IconDownload,
  IconMaximize,
  IconMinimize,
  IconPalette,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import { Container, EphemeralContainer, Pod } from 'kubernetes-types/core/v1'
import type { editor } from 'monaco-editor'
import { useTranslation } from 'react-i18next'

import { TERMINAL_THEMES, TerminalTheme } from '@/types/themes'
import {
  AnsiState,
  generateAnsiCss,
  getAnsiClassNames,
  parseAnsi,
  stripAnsi,
} from '@/lib/ansi-parser'
import { useLogsWebSocket } from '@/lib/api'
import { toSimpleContainer } from '@/lib/k8s'
import { MonacoEditor } from '@/lib/monaco-loader'
import { defineMonacoLogThemes } from '@/lib/monaco-theme'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { ConnectionIndicator } from './connection-indicator'
import { NetworkSpeedIndicator } from './network-speed-indicator'
import { ContainerSelector } from './selector/container-selector'
import { PodSelector } from './selector/pod-selector'

export interface LogViewerEntry {
  id: string | number
  text: string
  timestamp?: string
}

export interface LogViewerProps {
  namespace?: string
  podName?: string
  pods?: Pod[]
  labelSelector?: string
  containers?: Container[]
  initContainers?: Container[]
  ephemeralContainers?: EphemeralContainer[]
  selectedContainerName?: string
  onClose?: () => void
  entries?: readonly LogViewerEntry[]
  toolbar?: ReactNode
  status?: ReactNode
  onClear?: () => void
}

const ANSI_CSS = generateAnsiCss()
// Monaco's NeverGrowsWhenTypingAtEdges value, kept numeric to avoid importing Monaco at runtime.
const NEVER_GROWS_WHEN_TYPING_AT_EDGES: editor.TrackedRangeStickiness = 1
const TERMINAL_THEME_KEYS = Object.keys(TERMINAL_THEMES) as TerminalTheme[]
const TERMINAL_THEME_ENTRIES = Object.entries(TERMINAL_THEMES) as Array<
  [TerminalTheme, (typeof TERMINAL_THEMES)[TerminalTheme]]
>

export function LogViewer({
  namespace = '',
  podName,
  pods,
  containers: _containers,
  initContainers,
  ephemeralContainers,
  selectedContainerName,
  onClose,
  labelSelector,
  entries,
  toolbar,
  status,
  onClear,
}: LogViewerProps) {
  const external = entries !== undefined
  const [logTheme, setLogTheme] = useState<TerminalTheme>(() => {
    const saved = localStorage.getItem('log-viewer-theme')
    return (saved as TerminalTheme) || (external ? 'monokai' : 'classic')
  })
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers, ephemeralContainers)
  }, [_containers, initContainers, ephemeralContainers])
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
  const { t } = useTranslation()
  const [timestamps, setTimestamps] = useState(false)
  const [previous, setPrevious] = useState(false)
  const [filterTerm, setFilterTerm] = useState('')
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [wordWrap, setWordWrap] = useState<boolean>(() => {
    const saved = localStorage.getItem('log-viewer-word-wrap')
    if (saved === null) {
      localStorage.setItem('log-viewer-word-wrap', 'true')
      return true
    }
    return saved === 'true'
  })

  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(() => {
    const saved = localStorage.getItem('log-viewer-show-line-numbers')
    if (saved === null) {
      return false
    }
    return saved === 'true'
  })

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('log-viewer-font-size')
    return saved ? parseInt(saved, 10) : 14
  })
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [logCount, setLogCount] = useState(0) // Track log count for re-rendering
  const ansiStateRef = useRef<AnsiState>({})
  const decorationIdsRef = useRef<string[]>([])
  const normalizedFilterTermRef = useRef('')
  const pendingLogsRef = useRef<string[]>([])
  const [editorReady, setEditorReady] = useState(false)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const updatingEditor = useRef(false)
  const [newLines, setNewLines] = useState(0)
  const previousInputEntries = useRef<readonly LogViewerEntry[]>([])
  const renderedEntries = useRef<{
    entries: readonly LogViewerEntry[]
    lineStarts: number[]
    decorations: string[][]
  }>({ entries: [], lineStarts: [], decorations: [] })
  const visibleEntries = useMemo(() => {
    if (!entries) return []
    const displayEntries = timestamps
      ? entries.map((entry) =>
          entry.timestamp
            ? { ...entry, text: `${entry.timestamp} ${entry.text}` }
            : entry
        )
      : entries
    const query = filterTerm.toLocaleLowerCase()
    return query
      ? displayEntries.filter((entry) =>
          stripAnsi(entry.text).toLocaleLowerCase().includes(query)
        )
      : displayEntries
  }, [entries, filterTerm, timestamps])
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
  const currentTheme = TERMINAL_THEMES[logTheme]

  const [selectPodName, setSelectPodName] = useState<string | undefined>(
    podName || pods?.[0]?.metadata?.name || undefined
  )

  useEffect(() => {
    normalizedFilterTermRef.current = filterTerm.toLocaleLowerCase()
  }, [filterTerm])

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

  // Handle theme change and persist to localStorage
  const handleThemeChange = useCallback((theme: TerminalTheme) => {
    setLogTheme(theme)
    localStorage.setItem('log-viewer-theme', theme)
  }, [])

  // Handle font size change and persist to localStorage
  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size)
    localStorage.setItem('log-viewer-font-size', size.toString())
  }, [])

  // Handle tail lines change and persist to localStorage
  const handleTailLinesChange = useCallback((lines: number) => {
    setTailLines(lines)
    if (lines !== -1) {
      localStorage.setItem('log-viewer-tail-lines', lines.toString())
    }
  }, [])

  // Quick theme cycling function
  const cycleTheme = useCallback(() => {
    const currentIndex = TERMINAL_THEME_KEYS.indexOf(logTheme)
    const nextIndex = (currentIndex + 1) % TERMINAL_THEME_KEYS.length
    handleThemeChange(TERMINAL_THEME_KEYS[nextIndex])
  }, [logTheme, handleThemeChange])

  const writeLogToEditor = useCallback((log: string) => {
    if (!editorRef.current) {
      pendingLogsRef.current.push(log)
      return
    }

    const model = editorRef.current.getModel()
    if (!model) {
      pendingLogsRef.current.push(log)
      return
    }

    const { segments, finalState } = parseAnsi(log, ansiStateRef.current)
    ansiStateRef.current = finalState

    const plainText = segments.map((s) => s.text).join('')

    if (normalizedFilterTermRef.current) {
      if (
        !plainText.toLocaleLowerCase().includes(normalizedFilterTermRef.current)
      ) {
        return
      }
    }

    const lineCount = model.getLineCount()
    const lineMaxColumn = model.getLineMaxColumn(lineCount)
    const prefix = model.getValueLength() === 0 ? '' : '\n'

    const textToInsert = `${prefix}${plainText}`
    model.applyEdits([
      {
        range: {
          startColumn: lineMaxColumn,
          endColumn: lineMaxColumn,
          startLineNumber: lineCount,
          endLineNumber: lineCount,
        },
        text: textToInsert,
        forceMoveMarkers: false,
      },
    ])

    const newDecorations: editor.IModelDeltaDecoration[] = []

    // Starting position for decorations
    let currentLine = lineCount
    let currentColumn = lineMaxColumn

    if (prefix === '\n') {
      currentLine++
      currentColumn = 1
    }

    segments.forEach((segment) => {
      const lines = segment.text.split('\n')
      const endLine = currentLine + lines.length - 1
      const endColumn =
        lines.length === 1
          ? currentColumn + lines[0].length
          : lines[lines.length - 1].length + 1

      const className = getAnsiClassNames(segment.styles)
      if (className) {
        newDecorations.push({
          range: {
            startLineNumber: currentLine,
            startColumn: currentColumn,
            endLineNumber: endLine,
            endColumn: endColumn,
          },
          options: {
            inlineClassName: className,
            stickiness: NEVER_GROWS_WHEN_TYPING_AT_EDGES,
          },
        })
      }

      currentLine = endLine
      currentColumn = endColumn
    })

    if (newDecorations.length > 0) {
      const newIds = model.deltaDecorations([], newDecorations)
      decorationIdsRef.current.push(...newIds)
    }

    const visibleRange = editorRef.current.getVisibleRanges()[0]
    if (visibleRange?.endLineNumber + 2 >= lineCount) {
      editorRef.current.revealLine(model.getLineCount())
      setShowScrollToBottom(false)
    } else {
      setShowScrollToBottom(true)
    }

    setLogCount((count) => count + 1)
  }, [])

  // Handle editor mount
  const handleEditorMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor
      setEditorReady(true)
      if (external) {
        const listener = editor.onDidScrollChange(() => {
          if (updatingEditor.current) return
          const atBottom =
            editor.getScrollHeight() -
              editor.getScrollTop() -
              editor.getLayoutInfo().height <=
            8
          followingRef.current = atBottom
          setFollowing(atBottom)
          setShowScrollToBottom(!atBottom)
          if (atBottom) setNewLines(0)
        })
        editor.onDidDispose(() => listener.dispose())
      }

      // Configure search widget
      editor.updateOptions({
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: 'never',
          seedSearchStringFromSelection: 'never',
        },
      })

      const pendingLogs = pendingLogsRef.current
      pendingLogsRef.current = []
      pendingLogs.forEach((log) => writeLogToEditor(log))
    },
    [writeLogToEditor, external]
  )

  useEffect(() => {
    const instance = editorRef.current
    const model = instance?.getModel()
    if (!external || !editorReady || !instance || !model) return
    const previous = renderedEntries.current
    const previousInput = previousInputEntries.current
    previousInputEntries.current = entries ?? []
    let unchanged = 0
    while (
      unchanged < previous.entries.length &&
      unchanged < visibleEntries.length &&
      previous.entries[unchanged].id === visibleEntries[unchanged].id &&
      previous.entries[unchanged].text === visibleEntries[unchanged].text
    )
      unchanged++
    if (
      unchanged === previous.entries.length &&
      unchanged === visibleEntries.length
    )
      return

    const viewState = instance.saveViewState()
    const lineStarts = previous.lineStarts.slice(0, unchanged)
    const decorationIds = previous.decorations.slice(0, unchanged)
    const oldEnd = model.getLineCount()
    const appending = unchanged === previous.entries.length && unchanged > 0
    const trimming = unchanged === visibleEntries.length && unchanged > 0
    const startLine = appending
      ? oldEnd
      : trimming
        ? previous.lineStarts[unchanged] - 1
        : (previous.lineStarts[unchanged] ?? 1)
    const startColumn =
      appending || trimming ? model.getLineMaxColumn(startLine) : 1
    let line = appending ? oldEnd + 1 : startLine
    const texts: string[] = []
    const decorations: editor.IModelDeltaDecoration[][] = []
    for (const entry of visibleEntries.slice(unchanged)) {
      lineStarts.push(line)
      const { segments } = parseAnsi(entry.text)
      texts.push(segments.map((segment) => segment.text).join(''))
      let column = 1
      const entryDecorations: editor.IModelDeltaDecoration[] = []
      for (const segment of segments) {
        const lines = segment.text.split('\n')
        const endLine = line + lines.length - 1
        const endColumn =
          lines.length === 1
            ? column + segment.text.length
            : lines[lines.length - 1].length + 1
        const className = getAnsiClassNames(segment.styles)
        if (className)
          entryDecorations.push({
            range: {
              startLineNumber: line,
              startColumn: column,
              endLineNumber: endLine,
              endColumn,
            },
            options: {
              inlineClassName: className,
              stickiness: NEVER_GROWS_WHEN_TYPING_AT_EDGES,
            },
          })
        line = endLine
        column = endColumn
      }
      decorations.push(entryDecorations)
      line++
    }
    updatingEditor.current = true
    model.deltaDecorations(previous.decorations.slice(unchanged).flat(), [])
    // Edit only the changed suffix so streaming preserves selections and scroll position.
    model.applyEdits([
      {
        range: {
          startLineNumber: startLine,
          startColumn,
          endLineNumber: oldEnd,
          endColumn: model.getLineMaxColumn(oldEnd),
        },
        text: (appending ? '\n' : '') + texts.join('\n'),
        forceMoveMarkers: false,
      },
    ])
    const ids = model.deltaDecorations([], decorations.flat())
    let offset = 0
    for (const entryDecorations of decorations) {
      decorationIds.push(ids.slice(offset, offset + entryDecorations.length))
      offset += entryDecorations.length
    }
    renderedEntries.current = {
      entries: visibleEntries,
      lineStarts,
      decorations: decorationIds,
    }
    setLogCount(visibleEntries.length)
    if (followingRef.current) {
      instance.revealLine(model.getLineCount())
    } else {
      if (viewState) instance.restoreViewState(viewState)
      const oldIds = new Set(previousInput.map((entry) => entry.id))
      setNewLines(
        (count) =>
          count + visibleEntries.filter((entry) => !oldIds.has(entry.id)).length
      )
    }
    updatingEditor.current = false
  }, [external, editorReady, entries, visibleEntries])

  const appendLog = useCallback(
    (log: string) => {
      writeLogToEditor(log)
    },
    [writeLogToEditor]
  )

  const cleanLog = useCallback(() => {
    setLogCount(0)
    ansiStateRef.current = {}
    decorationIdsRef.current = []
    pendingLogsRef.current = []
    if (editorRef.current) {
      const model = editorRef.current.getModel()
      if (model) {
        model.setValue('')
      }
    }
  }, [])

  const logsOptions = useMemo(
    () => ({
      container: selectedContainer,
      tailLines,
      timestamps,
      previous: previous && !selectedContainerIsEphemeral,
      enabled: !external && !!selectPodName,
      labelSelector,
      onNewLog: appendLog,
      onClear: external ? undefined : cleanLog,
    }),
    [
      selectedContainer,
      tailLines,
      timestamps,
      previous,
      selectedContainerIsEphemeral,
      selectPodName,
      labelSelector,
      appendLog,
      cleanLog,
      external,
    ]
  )

  // Use the new WebSocket logs hook
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
    // Clear the editor BEFORE the new stream starts. We deliberately
    // clear here (in response to a real parameter change) instead of on
    // every WebSocket onopen, so that the historical tail buffer delivered
    // by the server immediately after connect is preserved.
    if (external) return
    cleanLog()

    // Show reconnecting state when parameters change
    setIsReconnecting(true)
  }, [
    selectedContainer,
    selectPodName,
    tailLines,
    timestamps,
    previous,
    cleanLog,
    external,
  ])

  // Hide reconnecting state when loading completes
  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => setIsReconnecting(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isLoading])

  const downloadLogs = () => {
    const model = editorRef?.current?.getModel()
    if (model) {
      const content = model.getValue()
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const podFileName = selectPodName || 'all-pods'
      a.download = external
        ? 'aggregated-logs.txt'
        : `${podFileName}-${selectedContainer || 'pod'}-logs.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const scrollToBottom = useCallback(() => {
    followingRef.current = true
    setFollowing(true)
    setNewLines(0)
    if (editorRef.current) {
      const model = editorRef.current.getModel()
      if (model) {
        editorRef.current.revealLine(model.getLineCount())
        setShowScrollToBottom(false)
      }
    }
  }, [])

  // Handle fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev)
  }, [])

  const toggleWordWrap = useCallback(() => {
    setWordWrap((prev) => {
      localStorage.setItem('log-viewer-word-wrap', `${!prev}`)
      return !prev
    })
  }, [])

  const toggleShowLineNumbers = useCallback(() => {
    setShowLineNumbers((prev) => {
      localStorage.setItem('log-viewer-show-line-numbers', `${!prev}`)
      return !prev
    })
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F to open Monaco search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        editorRef.current?.getAction('actions.find')?.run()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        toggleFullscreen()
      }
      // Alt/Option + Z to toggle word wrap
      if (e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'Ω')) {
        e.preventDefault()
        toggleWordWrap()
      }
      // Font size shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        handleFontSizeChange(Math.min(24, fontSize + 1))
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        handleFontSizeChange(Math.max(10, fontSize - 1))
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        handleFontSizeChange(14) // Reset to default font size
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleFullscreen, fontSize, handleFontSizeChange, toggleWordWrap])

  return (
    <Card
      className={cn(
        'h-full min-h-0 flex flex-col gap-0',
        external ? 'py-0 overflow-hidden' : 'py-4',
        isFullscreen && 'fixed inset-0 z-50 m-0 rounded-none',
        wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'
      )}
    >
      <style>{ANSI_CSS}</style>
      <CardHeader className={external ? 'px-3 py-2' : undefined}>
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {!external && (
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">Logs</CardTitle>
              <CardDescription>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    {logCount} lines {filterTerm.length > 0 && `(filtered)`}
                  </span>
                  <ConnectionIndicator
                    isConnected={isConnected}
                    onReconnect={refetch}
                  />
                  <NetworkSpeedIndicator
                    downloadSpeed={downloadSpeed}
                    uploadSpeed={0}
                  />
                  {isLoading && <span>Loading...</span>}
                  {isReconnecting && (
                    <span className="text-blue-600">Reconnecting...</span>
                  )}
                </div>
              </CardDescription>
            </div>
          )}
          <div
            className={cn(
              'flex w-full min-w-0 flex-wrap items-center gap-2',
              !external && 'md:w-auto md:justify-end'
            )}
          >
            {toolbar}
            <div
              className={cn(
                'relative min-w-0 flex-1 basis-40',
                !external && 'md:w-48 md:flex-none md:basis-auto'
              )}
            >
              <IconSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label={t('logViewer.filter')}
                placeholder={t('logViewer.filter')}
                value={filterTerm}
                onChange={(e) => setFilterTerm(e.target.value)}
                className="pl-8 w-full pr-8"
              />
            </div>

            {external && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (following) {
                    followingRef.current = false
                    setFollowing(false)
                    setShowScrollToBottom(true)
                  } else scrollToBottom()
                }}
              >
                {following ? (
                  <IconPlayerPause className="size-4" />
                ) : (
                  <IconPlayerPlay className="size-4" />
                )}
                {t(following ? 'logViewer.following' : 'logViewer.follow')}
              </Button>
            )}

            {/* Container Selector */}
            {!external && containers.length > 1 && (
              <ContainerSelector
                containers={containers}
                showAllOption={false}
                selectedContainer={selectedContainer}
                onContainerChange={setSelectedContainer}
              />
            )}

            {/* Pod Selector */}
            {!external && sortedPods && (
              <PodSelector
                pods={sortedPods}
                showAllOption={true}
                selectedPod={selectPodName}
                onPodChange={(v) => setSelectPodName(v || '_all')}
              />
            )}

            {/* Quick Theme Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={cycleTheme}
              title={`Current theme: ${currentTheme.name}`}
              aria-label={t('logViewer.theme')}
              className="relative"
            >
              <IconPalette className="h-4 w-4" />
              <div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-gray-400"
                style={{
                  backgroundColor: currentTheme.background,
                }}
              ></div>
            </Button>

            {/* Settings */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('logViewer.settings')}
                >
                  <IconSettings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  {!external && (
                    <>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="tail-lines">Tail Lines</Label>
                        <Select
                          value={tailLines.toString()}
                          onValueChange={(value) =>
                            handleTailLinesChange(Number(value))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="50">50</SelectItem>
                            <SelectItem value="100">100</SelectItem>
                            <SelectItem value="200">200</SelectItem>
                            <SelectItem value="500">500</SelectItem>
                            <SelectItem value="1000">1000</SelectItem>
                            <SelectItem value="-1">All</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="previous">Previous Container</Label>
                        <Switch
                          id="previous"
                          checked={previous && !selectedContainerIsEphemeral}
                          disabled={selectedContainerIsEphemeral}
                          onCheckedChange={setPrevious}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between">
                    <Label htmlFor="timestamps">
                      {t('logViewer.timestamps')}
                    </Label>
                    <Switch
                      id="timestamps"
                      checked={timestamps}
                      onCheckedChange={setTimestamps}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="word-wrap">{t('logViewer.wordWrap')}</Label>
                    <Switch
                      id="word-wrap"
                      checked={wordWrap}
                      onCheckedChange={toggleWordWrap}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="show-line-numbers">
                      {t('logViewer.lineNumbers')}
                    </Label>
                    <Switch
                      id="show-line-numbers"
                      checked={showLineNumbers}
                      onCheckedChange={toggleShowLineNumbers}
                    />
                  </div>

                  {/* Log Theme Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="log-theme">{t('logViewer.theme')}</Label>
                      <Select
                        value={logTheme}
                        onValueChange={handleThemeChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TERMINAL_THEME_ENTRIES.map(([key, theme]) => (
                            <SelectItem key={key} value={key}>
                              <div className="flex items-center gap-2">
                                {theme.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Font Size Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="font-size">
                        {t('logViewer.fontSize')}
                      </Label>
                      <Select
                        value={fontSize.toString()}
                        onValueChange={(value) =>
                          handleFontSizeChange(Number(value))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10px</SelectItem>
                          <SelectItem value="11">11px</SelectItem>
                          <SelectItem value="12">12px</SelectItem>
                          <SelectItem value="13">13px</SelectItem>
                          <SelectItem value="14">14px</SelectItem>
                          <SelectItem value="15">15px</SelectItem>
                          <SelectItem value="16">16px</SelectItem>
                          <SelectItem value="18">18px</SelectItem>
                          <SelectItem value="20">20px</SelectItem>
                          <SelectItem value="22">22px</SelectItem>
                          <SelectItem value="24">24px</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Keyboard Shortcuts */}
                  <div className="space-y-2 pt-2 border-t">
                    <Label className="text-xs font-medium text-muted-foreground">
                      {t('logViewer.shortcuts')}
                    </Label>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <span>{t('logViewer.search')}</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+F
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('logViewer.fullscreen')}</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+Enter
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('logViewer.wordWrap')}</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Alt+Z
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('logViewer.increaseFont')}</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl++
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('logViewer.decreaseFont')}</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+-
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('logViewer.resetFont')}</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+0
                        </kbd>
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Clear Logs */}
            <Button
              variant="outline"
              size="sm"
              onClick={
                external
                  ? () => {
                      onClear?.()
                      setNewLines(0)
                    }
                  : clearLogs
              }
              disabled={external && !onClear}
              title={t('logViewer.clear')}
              aria-label={t('logViewer.clear')}
            >
              <IconClearAll className="h-4 w-4" />
            </Button>

            {/* Download */}
            <Button
              variant="outline"
              size="sm"
              onClick={downloadLogs}
              disabled={logCount === 0}
              aria-label={t('logViewer.download')}
            >
              <IconDownload className="h-4 w-4" />
            </Button>

            {/* Fullscreen Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFullscreen}
              aria-label={t(
                isFullscreen
                  ? 'logViewer.exitFullscreen'
                  : 'logViewer.fullscreen'
              )}
              title={t(
                isFullscreen
                  ? 'logViewer.exitFullscreen'
                  : 'logViewer.fullscreen'
              )}
            >
              {isFullscreen ? (
                <IconMinimize className="h-4 w-4" />
              ) : (
                <IconMaximize className="h-4 w-4" />
              )}
            </Button>

            {/* Close */}
            {onClose && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                aria-label={t('logViewer.close')}
              >
                <IconX className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0 relative">
        <MonacoEditor
          height="100%"
          theme={`log-theme-${logTheme}`}
          loading={
            <div className="flex h-full items-center justify-center">
              <div className="text-center opacity-60">
                {t('logViewer.loading')}
              </div>
            </div>
          }
          beforeMount={(monaco) => {
            defineMonacoLogThemes(monaco)
          }}
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize,
            wordWrap: wordWrap ? 'on' : 'off',
            lineHeight: 1.7,
            insertSpaces: true,
            fontFamily:
              "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
            lineNumbers: showLineNumbers ? 'on' : 'off',
            glyphMargin: false,
            folding: false,
            renderLineHighlight: 'gutter',
            scrollbar: {
              vertical: 'visible',
              horizontal: 'visible',
              useShadows: false,
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            automaticLayout: true,
            colorDecorators: false,
            padding: external ? { top: 8, bottom: 8 } : undefined,
          }}
        />
        {showScrollToBottom && (
          <div
            className={`absolute bottom-4 right-4 z-10 ml-auto w-fit ${
              logTheme === 'github'
                ? 'bg-white/90 text-gray-600 border border-gray-200 shadow-sm'
                : 'bg-gray-800/90 text-gray-300 border border-gray-600 shadow-sm'
            } px-3 py-1.5 text-xs rounded-full`}
          >
            <Button
              size="sm"
              variant="ghost"
              className={`h-auto p-0 text-xs font-normal ${
                logTheme === 'github'
                  ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100/70'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700/70'
              }`}
              onClick={scrollToBottom}
            >
              ↓ {t('common.actions.jumpToBottom', 'Jump to bottom')}
              {external &&
                newLines > 0 &&
                ` · ${t('logViewer.newLines', { count: newLines })}`}
            </Button>
          </div>
        )}
      </CardContent>
      {external && (
        <div className="flex items-center justify-between gap-3 border-t px-3 py-1 text-xs text-muted-foreground tabular-nums">
          <span className="flex items-center gap-2">
            {status}
            <span>{t('logViewer.lines', { count: logCount })}</span>
          </span>
          <span>{t('logViewer.searchHint')}</span>
        </div>
      )}
    </Card>
  )
}
