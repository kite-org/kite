import { useCallback, useRef, useState } from 'react'
import { useTerminal } from '@/contexts/terminal-context'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

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
  const { isOpen, isMinimized, closeTerminal, minimizeTerminal, openTerminal } =
    useTerminal()
  const [height, setHeight] = useState(
    () => (window.innerHeight * DEFAULT_HEIGHT_VH) / 100
  )
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMinimized) return
      dragging.current = true
      startY.current = e.clientY
      startH.current = height
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [height, isMinimized]
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

  if (!isOpen) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t bg-background shadow-2xl"
      style={{ height: isMinimized ? 40 : height }}
    >
      {/* Drag handle */}
      {!isMinimized && (
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
          onClick={() => (isMinimized ? openTerminal() : minimizeTerminal())}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-green-500 shadow-sm" />
          Kubectl Terminal
        </button>

        <div className="flex items-center">
          <Separator orientation="vertical" className="mx-1 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() =>
                  isMinimized ? openTerminal() : minimizeTerminal()
                }
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
                onClick={closeTerminal}
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
