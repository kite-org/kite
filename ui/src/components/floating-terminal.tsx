import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useTerminal } from '@/contexts/terminal-context'
import { ChevronDown, ChevronUp, Maximize2, Minimize2, X } from 'lucide-react'

import { useGeneralSetting } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Terminal } from '@/components/terminal'

const MIN_HEIGHT = 120
const DEFAULT_HEIGHT_VH = 40

export function FloatingTerminal() {
  const { user } = useAuth()
  const { isOpen, isMinimized, closeTerminal, minimizeTerminal, openTerminal } =
    useTerminal()
  const isAdmin = user?.isAdmin() ?? false
  const { data: generalSetting } = useGeneralSetting({
    enabled: isAdmin && isOpen,
  })
  const kubectlEnabled = generalSetting?.kubectlEnabled ?? true
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [height, setHeight] = useState(
    () => (window.innerHeight * DEFAULT_HEIGHT_VH) / 100
  )
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMinimized || isFullscreen) return
      dragging.current = true
      startY.current = e.clientY
      startH.current = height
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [height, isFullscreen, isMinimized]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const maxHeight = window.innerHeight * 0.5
    const newH = Math.min(
      maxHeight,
      Math.max(MIN_HEIGHT, startH.current + (startY.current - e.clientY))
    )
    setHeight(newH)
  }, [])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  useEffect(() => {
    if (isOpen && !kubectlEnabled) {
      closeTerminal()
    }
  }, [closeTerminal, isOpen, kubectlEnabled])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev)
  }, [])

  const handleMinimize = useCallback(() => {
    setIsFullscreen(false)
    if (isMinimized) {
      openTerminal()
      return
    }
    minimizeTerminal()
  }, [isMinimized, minimizeTerminal, openTerminal])

  const handleClose = useCallback(() => {
    setIsFullscreen(false)
    closeTerminal()
  }, [closeTerminal])

  if (!kubectlEnabled) return null
  if (!isOpen) return null

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-background shadow-2xl'
          : 'fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t bg-background shadow-2xl'
      }
      style={{
        height: isMinimized ? 40 : isFullscreen ? '100dvh' : height,
      }}
    >
      {/* Drag handle */}
      {!isMinimized && !isFullscreen && (
        <div
          className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-10"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}

      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b bg-muted/50 px-3">
        <button
          className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground hover:opacity-70 transition-opacity"
          onClick={handleMinimize}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-green-500 shadow-sm" />
          Kubectl Terminal
        </button>

        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={toggleFullscreen}
                disabled={isMinimized}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleMinimize}
              >
                {isMinimized ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isMinimized ? 'Restore' : 'Minimize'}
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-destructive hover:text-destructive-foreground"
                onClick={handleClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Close (ends session)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 w-full"
        style={{ display: isMinimized ? 'none' : 'flex' }}
      >
        <Terminal type="kubectl" embedded />
      </div>
    </div>
  )
}
