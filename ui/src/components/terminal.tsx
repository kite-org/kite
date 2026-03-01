import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconClearAll,
  IconMaximize,
  IconMinimize,
  IconPalette,
  IconSettings,
  IconTerminal,
} from '@tabler/icons-react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as XTerm } from '@xterm/xterm'
import { Container, Pod } from 'kubernetes-types/core/v1'

import '@xterm/xterm/css/xterm.css'

import { useTranslation } from 'react-i18next'

import { TERMINAL_THEMES, TerminalTheme } from '@/types/themes'
import { toSimpleContainer } from '@/lib/k8s'
import { getWebSocketUrl } from '@/lib/subpath'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

import { ConnectionIndicator } from './connection-indicator'
import { NetworkSpeedIndicator } from './network-speed-indicator'
import { ContainerSelector } from './selector/container-selector'
import { PodSelector } from './selector/pod-selector'

interface TerminalProps {
  type?: 'node' | 'pod' | 'kubectl'
  namespace?: string
  podName?: string
  nodeName?: string
  pods?: Pod[]
  containers?: Container[]
  initContainers?: Container[]
  /** When true, hides the internal toolbar and fills parent container */
  embedded?: boolean
}

export function Terminal({
  namespace,
  podName,
  pods,
  nodeName,
  containers: _containers = [],
  initContainers = [],
  type = 'pod',
  embedded = false,
}: TerminalProps) {
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers)
  }, [_containers, initContainers])
  const [selectedPod, setSelectedPod] = useState<string>('')
  const [selectedContainer, setSelectedContainer] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [reconnectFlag, setReconnectFlag] = useState(false)
  const [networkSpeed, setNetworkSpeed] = useState({ upload: 0, download: 0 })
  const [terminalTheme, setTerminalTheme] = useState<TerminalTheme>(() => {
    const saved = localStorage.getItem('terminal-theme')
    return (saved as TerminalTheme) || 'classic'
  })
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('log-viewer-font-size')
    return saved ? parseInt(saved, 10) : 14
  })
  const [cursorStyle, setCursorStyle] = useState<'block' | 'underline' | 'bar'>(
    () => {
      const saved = localStorage.getItem('terminal-cursor-style')
      return (saved as 'block' | 'underline' | 'bar') || 'bar'
    }
  )
  const [isFullscreen, setIsFullscreen] = useState(false)

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const networkStatsRef = useRef({
    lastReset: Date.now(),
    bytesReceived: 0,
    bytesSent: 0,
    lastUpdate: Date.now(),
  })
  const speedUpdateTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const { t } = useTranslation()

  // Initialize pod/container state on props change
  useEffect(() => {
    setSelectedPod(podName || pods?.[0]?.metadata?.name || '')
  }, [podName, pods])

  useEffect(() => {
    if (containers.length === 0) {
      setSelectedContainer('')
      return
    }

    setSelectedContainer((current) => {
      if (!current || !containers.find((c) => c.name === current)) {
        return containers[0].name
      }
      return current
    })
  }, [containers])

  // Handle theme change and persist to localStorage
  const handleThemeChange = useCallback((theme: TerminalTheme) => {
    setTerminalTheme(theme)
    localStorage.setItem('terminal-theme', theme)
    // Update terminal theme without recreating the instance
    if (xtermRef.current) {
      const currentTheme = TERMINAL_THEMES[theme]
      xtermRef.current.options.theme = {
        background: currentTheme.background,
        foreground: currentTheme.foreground,
        cursor: currentTheme.cursor,
        selectionBackground: currentTheme.selection,
        black: currentTheme.black,
        red: currentTheme.red,
        green: currentTheme.green,
        yellow: currentTheme.yellow,
        blue: currentTheme.blue,
        magenta: currentTheme.magenta,
        cyan: currentTheme.cyan,
        white: currentTheme.white,
        brightBlack: currentTheme.brightBlack,
        brightRed: currentTheme.brightRed,
        brightGreen: currentTheme.brightGreen,
        brightYellow: currentTheme.brightYellow,
        brightBlue: currentTheme.brightBlue,
        brightMagenta: currentTheme.brightMagenta,
        brightCyan: currentTheme.brightCyan,
        brightWhite: currentTheme.brightWhite,
      }
      // Force refresh to apply the new theme
      xtermRef.current.refresh(0, xtermRef.current.rows - 1)
    }
  }, [])

  // Handle font size change and persist to localStorage
  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size)
    localStorage.setItem('log-viewer-font-size', size.toString()) // 与 log viewer 共用同一个 key
    // Update terminal font size without recreating the instance
    if (xtermRef.current && fitAddonRef.current) {
      xtermRef.current.options.fontSize = size
      // Delay fit to ensure font size has been applied
      setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit()
        }
      }, 100)
    }
  }, [])

  const handleCursorStyleChange = useCallback(
    (style: 'block' | 'underline' | 'bar') => {
      setCursorStyle(style)
      localStorage.setItem('terminal-cursor-style', style)
      if (xtermRef.current) {
        xtermRef.current.options.cursorStyle = style
      }
    },
    []
  )

  // Quick theme cycling function
  const cycleTheme = useCallback(() => {
    const themes = Object.keys(TERMINAL_THEMES) as TerminalTheme[]
    const currentIndex = themes.indexOf(terminalTheme)
    const nextIndex = (currentIndex + 1) % themes.length
    handleThemeChange(themes[nextIndex])
  }, [terminalTheme, handleThemeChange])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v)
    setTimeout(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
    }, 200)
  }, [])

  const handleContainerChange = useCallback((containerName?: string) => {
    if (containerName) setSelectedContainer(containerName)
  }, [])

  const handlePodChange = useCallback((podName?: string) => {
    setSelectedPod(podName || '')
  }, [])

  // Calculate network speed
  const updateNetworkStats = useCallback(
    (dataSize: number, isOutgoing: boolean) => {
      const stats = networkStatsRef.current

      if (isOutgoing) {
        stats.bytesSent += dataSize
      } else {
        stats.bytesReceived += dataSize
      }
    },
    []
  )

  // Unified terminal and websocket lifecycle
  useEffect(() => {
    if (type === 'pod') {
      if (!pods || pods.length === 0) if (!selectedPod) return
      if (!selectedContainer) return
    }
    if (type === 'node' && !nodeName) return
    if (type === 'kubectl') {
      // kubectl type needs no pod/container selection
    }
    if (!terminalRef.current) return

    if (xtermRef.current) xtermRef.current.dispose()
    if (wsRef.current) wsRef.current.close()

    const currentTheme = TERMINAL_THEMES[terminalTheme]
    const terminal = new XTerm({
      fontFamily: '"Maple Mono", Monaco, Menlo, "Ubuntu Mono", monospace',
      fontSize,
      theme: {
        background: currentTheme.background,
        foreground: currentTheme.foreground,
        cursor: currentTheme.cursor,
        selectionBackground: currentTheme.selection,
        black: currentTheme.black,
        red: currentTheme.red,
        green: currentTheme.green,
        yellow: currentTheme.yellow,
        blue: currentTheme.blue,
        magenta: currentTheme.magenta,
        cyan: currentTheme.cyan,
        white: currentTheme.white,
        brightBlack: currentTheme.brightBlack,
        brightRed: currentTheme.brightRed,
        brightGreen: currentTheme.brightGreen,
        brightYellow: currentTheme.brightYellow,
        brightBlue: currentTheme.brightBlue,
        brightMagenta: currentTheme.brightMagenta,
        brightCyan: currentTheme.brightCyan,
        brightWhite: currentTheme.brightWhite,
      },
      cursorBlink: true,
      allowTransparency: true,
      cursorStyle,
      scrollback: 10000,
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.open(terminalRef.current)
    fitAddon.fit()
    xtermRef.current = terminal
    fitAddonRef.current = fitAddon

    // Apply additional styles to prevent scroll bubbling
    if (terminal.element) {
      terminal.element.style.overscrollBehavior = 'none'
      terminal.element.style.touchAction = 'none'
      terminal.element.addEventListener(
        'wheel',
        (e) => {
          e.stopPropagation()
          e.preventDefault()
        },
        { passive: false }
      )
    }

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    // WebSocket connection
    setIsConnected(false)
    const currentCluster = localStorage.getItem('current-cluster')
    const wsPath =
      type === 'pod'
        ? `/api/v1/terminal/${namespace}/${selectedPod}/ws?container=${selectedContainer}&x-cluster-name=${currentCluster}`
        : type === 'node'
          ? `/api/v1/node-terminal/${nodeName}/ws?x-cluster-name=${currentCluster}`
          : `/api/v1/kubectl-terminal/ws?x-cluster-name=${currentCluster}`
    const wsUrl = getWebSocketUrl(wsPath)
    const websocket = new WebSocket(wsUrl)
    wsRef.current = websocket

    websocket.onopen = () => {
      setIsConnected(true)
      networkStatsRef.current = {
        lastReset: Date.now(),
        bytesReceived: 0,
        bytesSent: 0,
        lastUpdate: Date.now(),
      }
      setNetworkSpeed({ upload: 0, download: 0 })
      if (speedUpdateTimerRef.current)
        clearInterval(speedUpdateTimerRef.current)
      if (fitAddonRef.current) {
        const { cols, rows } = fitAddonRef.current.proposeDimensions()!
        if (cols && rows) {
          const message = JSON.stringify({ type: 'resize', cols, rows })
          websocket.send(message)
          updateNetworkStats(new Blob([message]).size, true)
        }
      }
      speedUpdateTimerRef.current = setInterval(() => {
        const now = Date.now()
        const stats = networkStatsRef.current
        const timeDiff = (now - stats.lastReset) / 1000
        if (timeDiff > 0) {
          setNetworkSpeed({
            upload: stats.bytesSent / timeDiff,
            download: stats.bytesReceived / timeDiff,
          })
          if (timeDiff >= 3) {
            stats.lastReset = now
            stats.bytesSent = 0
            stats.bytesReceived = 0
          }
        }
      }, 500)

      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      pingTimerRef.current = setInterval(() => {
        if (websocket.readyState === WebSocket.OPEN) {
          const pingMessage = JSON.stringify({ type: 'ping' })
          websocket.send(pingMessage)
          updateNetworkStats(new Blob([pingMessage]).size, true)
        }
      }, 30000)

      terminal.writeln(
        `\x1b[32mConnected to ${type === 'kubectl' ? 'kubectl' : type} terminal!\x1b[0m`
      )
      terminal.writeln('')
    }

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        const dataSize = new Blob([event.data]).size
        updateNetworkStats(dataSize, false)
        switch (message.type) {
          case 'stdout':
          case 'stderr':
            terminal.write(message.data)
            break
          case 'info':
            terminal.writeln(`\x1b[34m${message.data}\x1b[0m`)
            break
          case 'connected':
            terminal.writeln(`\x1b[32m${message.data}\x1b[0m`)
            break
          case 'error':
            terminal.writeln(
              `\x1b[31mError: ${translateError(new Error(message.data), t)}\x1b[0m`
            )
            setIsConnected(false)
            break
          case 'pong':
            // Ignore pong messages from server
            break
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error)
      terminal.writeln('\x1b[31mWebSocket connection error\x1b[0m')
      setIsConnected(false)
    }

    websocket.onclose = (event) => {
      setIsConnected(false)
      setNetworkSpeed({ upload: 0, download: 0 })
      if (speedUpdateTimerRef.current) {
        clearInterval(speedUpdateTimerRef.current)
        speedUpdateTimerRef.current = null
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current)
        pingTimerRef.current = null
      }
      if (event.code !== 1000) {
        terminal.writeln('\x1b[31mConnection closed unexpectedly\x1b[0m')
      } else {
        terminal.writeln('\x1b[32mConnection closed\x1b[0m')
      }
    }

    terminal.onData((data) => {
      if (websocket.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ type: 'stdin', data })
        websocket.send(message)
        updateNetworkStats(new Blob([message]).size, true)
      }
    })

    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
    const handleTerminalResize = () => {
      // Debounce: wait for CSS transition to finish before fitting/resizing
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer)
      resizeDebounceTimer = setTimeout(() => {
        if (!fitAddonRef.current || websocket.readyState !== WebSocket.OPEN) {
          return
        }
        fitAddonRef.current.fit()
        const { cols, rows } = terminal
        const message = JSON.stringify({ type: 'resize', cols, rows })
        websocket.send(message)
        updateNetworkStats(new Blob([message]).size, true)
      }, 150)
    }

    let resizeObserver: ResizeObserver | null = null
    if (terminalRef.current) {
      resizeObserver = new ResizeObserver(handleTerminalResize)
      resizeObserver.observe(terminalRef.current)
    }

    const handleWheelEvent = (e: WheelEvent | TouchEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }

    const currentTerminalRef = terminalRef.current
    if (currentTerminalRef) {
      currentTerminalRef.addEventListener('wheel', handleWheelEvent, {
        passive: false,
      })
      currentTerminalRef.addEventListener('touchmove', handleWheelEvent, {
        passive: false,
      })
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      if (currentTerminalRef) {
        currentTerminalRef.removeEventListener('wheel', handleWheelEvent)
        currentTerminalRef.removeEventListener('touchmove', handleWheelEvent)
      }
      terminal.dispose()
      websocket.close()
      if (speedUpdateTimerRef.current)
        clearInterval(speedUpdateTimerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedPod,
    selectedContainer,
    namespace,
    type,
    updateNetworkStats,
    reconnectFlag,
  ])

  // Clear terminal
  const clearTerminal = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear()
    }
  }, [])

  // Shared terminal div (the actual xterm canvas)
  const terminalDiv = (
    <div
      ref={terminalRef}
      className="flex-1 h-full min-h-0 w-full"
      style={{
        maxHeight: '100%',
        overflow: 'hidden',
        overscrollBehavior: 'none',
        touchAction: 'none',
        position: 'relative',
        isolation: 'isolate',
      }}
    />
  )

  // Embedded mode: no header, fills parent completely
  if (embedded) {
    return (
      <div className="flex flex-col h-full w-full min-h-0">{terminalDiv}</div>
    )
  }

  return (
    <Card
      className={`flex flex-col gap-0 py-2 ${isFullscreen ? 'fixed inset-0 z-50 h-[100dvh]' : 'h-[calc(100dvh-180px)]'}`}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <IconTerminal className="h-5 w-5" />
              Terminal
            </CardTitle>
            <ConnectionIndicator
              isConnected={isConnected}
              onReconnect={() => {
                setReconnectFlag((prev) => !prev)
              }}
            />
            <NetworkSpeedIndicator
              uploadSpeed={networkSpeed.upload}
              downloadSpeed={networkSpeed.download}
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Container Selector */}
            {containers.length > 1 && (
              <ContainerSelector
                containers={containers}
                showAllOption={false}
                selectedContainer={selectedContainer}
                onContainerChange={handleContainerChange}
              />
            )}

            {/* Pod Selector */}
            {pods && pods.length > 0 && (
              <PodSelector
                pods={pods}
                selectedPod={selectedPod}
                onPodChange={handlePodChange}
              />
            )}

            {/* Quick Theme Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={cycleTheme}
              title={`Current theme: ${TERMINAL_THEMES[terminalTheme].name} (Ctrl+T to cycle)`}
              className="relative"
            >
              <IconPalette className="h-4 w-4" />
              <div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-gray-400"
                style={{
                  backgroundColor: TERMINAL_THEMES[terminalTheme].background,
                }}
              ></div>
            </Button>

            {/* Settings */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <IconSettings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  {/* Terminal Theme Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="terminal-theme">Terminal Theme</Label>
                      <Select
                        value={terminalTheme}
                        onValueChange={handleThemeChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TERMINAL_THEMES).map(
                            ([key, theme]) => (
                              <SelectItem key={key} value={key}>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full border border-gray-400"
                                    style={{
                                      backgroundColor: theme.background,
                                    }}
                                  ></div>
                                  <span className="text-sm">{theme.name}</span>
                                </div>
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Theme Preview */}
                    <div
                      className="p-3 rounded space-y-1"
                      style={{
                        backgroundColor:
                          TERMINAL_THEMES[terminalTheme].background,
                        color: TERMINAL_THEMES[terminalTheme].foreground,
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      <div>
                        <span
                          style={{
                            color: TERMINAL_THEMES[terminalTheme].green,
                          }}
                        >
                          user@pod:~$
                        </span>{' '}
                        ls -la
                      </div>
                      <div
                        style={{ color: TERMINAL_THEMES[terminalTheme].blue }}
                      >
                        drwxr-xr-x 3 user user 4096 Dec 9 10:30 .
                      </div>
                      <div
                        style={{ color: TERMINAL_THEMES[terminalTheme].yellow }}
                      >
                        -rw-r--r-- 1 user user 220 Dec 9 10:30 README.md
                      </div>
                      <div
                        style={{ color: TERMINAL_THEMES[terminalTheme].red }}
                      >
                        -rwx------ 1 user user 1024 Dec 9 10:30 script.sh
                      </div>
                    </div>
                  </div>

                  {/* Font Size Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="font-size">Font Size</Label>
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

                  {/* Cursor Style Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cursor-style">Cursor Style</Label>
                      <Select
                        value={cursorStyle}
                        onValueChange={handleCursorStyleChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="block">Block</SelectItem>
                          <SelectItem value="underline">Underline</SelectItem>
                          <SelectItem value="bar">Bar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Clear Terminal */}
            <Button variant="outline" size="sm" onClick={clearTerminal}>
              <IconClearAll className="h-4 w-4" />
            </Button>

            <Button variant="outline" size="sm" onClick={toggleFullscreen}>
              {isFullscreen ? (
                <IconMinimize className="h-4 w-4" />
              ) : (
                <IconMaximize className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex h-full min-h-0">
        {terminalDiv}
      </CardContent>
    </Card>
  )
}
