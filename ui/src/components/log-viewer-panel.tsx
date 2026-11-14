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
import { format } from 'date-fns'
import type { editor } from 'monaco-editor'
import { useTranslation } from 'react-i18next'

import { TERMINAL_THEMES, TerminalTheme } from '@/types/themes'
import {
  AnsiState,
  generateAnsiCss,
  getAnsiClassNames,
  parseAnsi,
} from '@/lib/ansi-parser'
import { MonacoEditor } from '@/lib/monaco-loader'
import { defineMonacoLogThemes } from '@/lib/monaco-theme'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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

export interface LogViewerEntry {
  id: string | number
  text: string
  timestamp?: number
}

export interface LogViewerPanelProps {
  entries: readonly LogViewerEntry[]
  header?: ReactNode
  toolbar?: ReactNode
  settings?: ReactNode
  status?: ReactNode
  defaultTheme?: TerminalTheme
  downloadFilename?: string
  onClear?: () => void
  onClose?: () => void
}

type ParsedEntry = LogViewerEntry & {
  initialState: AnsiState
  finalState: AnsiState
  segments: ReturnType<typeof parseAnsi>['segments']
  plainText: string
  displayTime: string
}

const ANSI_CSS = generateAnsiCss()
// Monaco's NeverGrowsWhenTypingAtEdges value, kept numeric to avoid importing Monaco at runtime.
const NEVER_GROWS_WHEN_TYPING_AT_EDGES: editor.TrackedRangeStickiness = 1
const TERMINAL_THEME_KEYS = Object.keys(TERMINAL_THEMES) as TerminalTheme[]
const TERMINAL_THEME_ENTRIES = Object.entries(TERMINAL_THEMES) as Array<
  [TerminalTheme, (typeof TERMINAL_THEMES)[TerminalTheme]]
>

export function LogViewerPanel({
  entries,
  header,
  toolbar,
  settings,
  status,
  defaultTheme = 'classic',
  downloadFilename = 'logs.txt',
  onClear,
  onClose,
}: LogViewerPanelProps) {
  const [logTheme, setLogTheme] = useState<TerminalTheme>(() => {
    const saved = localStorage.getItem('log-viewer-theme')
    return (saved as TerminalTheme) || defaultTheme
  })
  const { t } = useTranslation()
  const [timestamps, setTimestamps] = useState(false)
  const [filterTerm, setFilterTerm] = useState('')
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
  const [editorReady, setEditorReady] = useState(false)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const updatingEditor = useRef(false)
  const [newLines, setNewLines] = useState(0)
  const previousInputEntries = useRef<readonly LogViewerEntry[]>([])
  const parsedEntries = useRef(new Map<LogViewerEntry['id'], ParsedEntry>())
  const preparedEntries = useMemo(() => {
    const cache = new Map<LogViewerEntry['id'], ParsedEntry>()
    // Retain the ANSI state of the first surviving entry when a buffer trims its head.
    let state = parsedEntries.current.get(entries[0]?.id)?.initialState ?? {}
    for (const entry of entries) {
      let parsed = parsedEntries.current.get(entry.id)
      if (
        !parsed ||
        parsed.text !== entry.text ||
        parsed.timestamp !== entry.timestamp ||
        parsed.initialState.color !== state.color ||
        parsed.initialState.backgroundColor !== state.backgroundColor ||
        parsed.initialState.bold !== state.bold ||
        parsed.initialState.italic !== state.italic ||
        parsed.initialState.underline !== state.underline
      ) {
        const { segments, finalState } = parseAnsi(entry.text, state)
        parsed = {
          ...entry,
          initialState: state,
          finalState,
          segments,
          plainText: segments.map((segment) => segment.text).join(''),
          displayTime:
            entry.timestamp === undefined
              ? ''
              : format(entry.timestamp, 'yyyy-MM-dd HH:mm:ss.SSS'),
        }
      }
      cache.set(entry.id, parsed)
      state = parsed.finalState
    }
    parsedEntries.current = cache
    return [...cache.values()]
  }, [entries])
  const visibleEntries = useMemo(() => {
    const query = filterTerm.toLocaleLowerCase()
    return preparedEntries.flatMap((entry) => {
      const prefix =
        timestamps && entry.displayTime ? `${entry.displayTime} ` : ''
      const text = prefix + entry.plainText
      if (query && !text.toLocaleLowerCase().includes(query)) return []
      return [{ ...entry, text, prefix }]
    })
  }, [preparedEntries, filterTerm, timestamps])
  const renderedEntries = useRef<{
    entries: typeof visibleEntries
    lineStarts: number[]
    decorations: string[][]
  }>({ entries: [], lineStarts: [], decorations: [] })
  const logCount = visibleEntries.length
  const currentTheme = TERMINAL_THEMES[logTheme]

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

  // Quick theme cycling function
  const cycleTheme = useCallback(() => {
    const currentIndex = TERMINAL_THEME_KEYS.indexOf(logTheme)
    const nextIndex = (currentIndex + 1) % TERMINAL_THEME_KEYS.length
    handleThemeChange(TERMINAL_THEME_KEYS[nextIndex])
  }, [logTheme, handleThemeChange])

  const handleEditorMount: OnMount = useCallback((instance) => {
    editorRef.current = instance
    setEditorReady(true)
    const listener = instance.onDidScrollChange((event) => {
      if (updatingEditor.current || !event.scrollTopChanged) return
      const atBottom =
        instance.getScrollHeight() -
          instance.getScrollTop() -
          instance.getLayoutInfo().height <=
        8
      followingRef.current = atBottom
      setFollowing(atBottom)
      if (atBottom) setNewLines(0)
    })
    instance.onDidDispose(() => listener.dispose())
    instance.updateOptions({
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'never',
        seedSearchStringFromSelection: 'never',
      },
    })
  }, [])

  useEffect(() => {
    const instance = editorRef.current
    const model = instance?.getModel()
    if (!editorReady || !instance || !model) return
    const previous = renderedEntries.current
    const previousInput = previousInputEntries.current
    previousInputEntries.current = entries
    const head = visibleEntries.length
      ? Math.max(
          0,
          previous.entries.findIndex(
            (entry) => entry.id === visibleEntries[0].id
          )
        )
      : 0
    let unchanged = 0
    while (
      unchanged + head < previous.entries.length &&
      unchanged < visibleEntries.length &&
      previous.entries[unchanged + head].id === visibleEntries[unchanged].id &&
      previous.entries[unchanged + head].text ===
        visibleEntries[unchanged].text &&
      previous.entries[unchanged + head].segments ===
        visibleEntries[unchanged].segments
    )
      unchanged++
    if (
      head === 0 &&
      unchanged === previous.entries.length &&
      unchanged === visibleEntries.length
    )
      return

    const firstVisible = instance.getVisibleRanges()[0]
    let anchorIndex = previous.lineStarts.length - 1
    while (
      anchorIndex >= 0 &&
      previous.lineStarts[anchorIndex] > (firstVisible?.startLineNumber ?? 1)
    )
      anchorIndex--
    const anchor =
      firstVisible && anchorIndex >= 0
        ? {
            id: previous.entries[anchorIndex].id,
            line:
              firstVisible.startLineNumber - previous.lineStarts[anchorIndex],
            column: firstVisible.startColumn,
            offset:
              instance.getTopForPosition(
                firstVisible.startLineNumber,
                firstVisible.startColumn
              ) - instance.getScrollTop(),
            scrollLeft: instance.getScrollLeft(),
          }
        : undefined

    updatingEditor.current = true
    // Delete only evicted entries, leaving retained text and selections in place.
    const removedLines = head > 0 ? previous.lineStarts[head] - 1 : 0
    if (head > 0) {
      model.deltaDecorations(previous.decorations.slice(0, head).flat(), [])
      model.applyEdits([
        {
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: removedLines + 1,
            endColumn: 1,
          },
          text: '',
          forceMoveMarkers: false,
        },
      ])
    }
    const lineStarts = previous.lineStarts
      .slice(head, head + unchanged)
      .map((line) => line - removedLines)
    const decorationIds = previous.decorations.slice(head, head + unchanged)
    const retainedCount = previous.entries.length - head
    if (unchanged !== retainedCount || unchanged !== visibleEntries.length) {
      const oldEnd = model.getLineCount()
      const appending = unchanged === retainedCount && unchanged > 0
      const trimming = unchanged === visibleEntries.length && unchanged > 0
      const startLine = appending
        ? oldEnd
        : trimming
          ? previous.lineStarts[head + unchanged] - removedLines - 1
          : (previous.lineStarts[head + unchanged] ?? 1) - removedLines
      const startColumn =
        appending || trimming ? model.getLineMaxColumn(startLine) : 1
      let line = appending ? oldEnd + 1 : startLine
      const texts: string[] = []
      const decorations: editor.IModelDeltaDecoration[][] = []
      for (const entry of visibleEntries.slice(unchanged)) {
        lineStarts.push(line)
        texts.push(entry.text)
        let column = 1 + entry.prefix.length
        const entryDecorations: editor.IModelDeltaDecoration[] = []
        for (const segment of entry.segments) {
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
      model.deltaDecorations(
        previous.decorations.slice(head + unchanged).flat(),
        []
      )
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
    }
    renderedEntries.current = {
      entries: visibleEntries,
      lineStarts,
      decorations: decorationIds,
    }
    if (followingRef.current) {
      instance.revealLine(model.getLineCount())
    } else {
      const index = anchor
        ? visibleEntries.findIndex((entry) => entry.id === anchor.id)
        : -1
      if (anchor && index >= 0) {
        const line = Math.min(
          lineStarts[index] + anchor.line,
          (lineStarts[index + 1] ?? model.getLineCount() + 1) - 1
        )
        instance.setScrollPosition({
          scrollTop:
            instance.getTopForPosition(
              line,
              Math.min(anchor.column, model.getLineMaxColumn(line))
            ) - anchor.offset,
          scrollLeft: anchor.scrollLeft,
        })
      } else instance.setScrollTop(0)
      const oldIds = new Set(previousInput.map((entry) => entry.id))
      setNewLines((count) =>
        entries.length === 0
          ? 0
          : count +
            visibleEntries.filter((entry) => !oldIds.has(entry.id)).length
      )
    }
    updatingEditor.current = false
  }, [editorReady, entries, visibleEntries])

  const downloadLogs = () => {
    const model = editorRef?.current?.getModel()
    if (model) {
      const content = model.getValue()
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadFilename
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
        'py-0 overflow-hidden',
        isFullscreen && 'fixed inset-0 z-50 m-0 rounded-none',
        wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'
      )}
    >
      <style>{ANSI_CSS}</style>
      <CardHeader className="px-3 py-2">
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {header}
          <div
            className={cn(
              'flex w-full min-w-0 flex-wrap items-center gap-2',
              header && 'md:w-auto md:justify-end'
            )}
          >
            {toolbar}
            <div
              className={cn(
                'relative min-w-0 flex-1 basis-40',
                header && 'md:w-48 md:flex-none md:basis-auto'
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

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (following) {
                  followingRef.current = false
                  setFollowing(false)
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
                  {settings}
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
              onClick={() => {
                onClear?.()
                setNewLines(0)
              }}
              disabled={!onClear}
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
            padding: { top: 8, bottom: 8 },
          }}
        />
        {!following && (
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
              {newLines > 0 &&
                ` · ${t('logViewer.newLines', { count: newLines })}`}
            </Button>
          </div>
        )}
      </CardContent>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-1 text-xs text-muted-foreground tabular-nums">
        <span className="flex items-center gap-2">
          {status}
          <span>{t('logViewer.lines', { count: logCount })}</span>
        </span>
        <span>{t('logViewer.searchHint')}</span>
      </div>
    </Card>
  )
}
