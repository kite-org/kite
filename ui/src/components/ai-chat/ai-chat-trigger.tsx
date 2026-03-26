import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const FAB_SIZE = 48
const FAB_BASE_BOTTOM = 24
const FAB_MIN_MARGIN = 16
const FAB_DRAG_THRESHOLD = 4

function getViewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight
}

export function AIChatTrigger({ onOpen }: { onOpen: () => void }) {
  const [viewportHeight, setViewportHeight] = useState(() =>
    getViewportHeight()
  )
  const [translateY, setTranslateY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const startYRef = useRef(0)
  const startTranslateYRef = useRef(0)
  const translateYRef = useRef(0)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(false)

  const minTranslateY = Math.min(
    0,
    FAB_MIN_MARGIN - (viewportHeight - FAB_SIZE - FAB_BASE_BOTTOM)
  )

  const applyTranslateY = useCallback(
    (nextTranslateY: number, commit = false) => {
      const clamped = Math.max(minTranslateY, Math.min(0, nextTranslateY))
      translateYRef.current = clamped
      if (buttonRef.current) {
        buttonRef.current.style.transform = `translate3d(0, ${clamped}px, 0)`
      }
      if (commit) {
        setTranslateY(clamped)
      }
      return clamped
    },
    [minTranslateY]
  )

  useEffect(() => {
    const updateViewportHeight = () => {
      setViewportHeight(getViewportHeight())
    }

    updateViewportHeight()
    window.addEventListener('resize', updateViewportHeight)
    window.visualViewport?.addEventListener('resize', updateViewportHeight)
    return () => {
      window.removeEventListener('resize', updateViewportHeight)
      window.visualViewport?.removeEventListener('resize', updateViewportHeight)
    }
  }, [])

  useEffect(() => {
    applyTranslateY(translateYRef.current || translateY, true)
  }, [applyTranslateY, translateY])

  const stopDragging = useCallback(
    (pointerId: number) => {
      if (activePointerIdRef.current !== pointerId) return
      activePointerIdRef.current = null
      setIsDragging(false)
      suppressClickRef.current = movedRef.current
      if (movedRef.current) {
        applyTranslateY(translateYRef.current, true)
      }
    },
    [applyTranslateY]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      activePointerIdRef.current = e.pointerId
      startYRef.current = e.clientY
      startTranslateYRef.current = translateYRef.current
      movedRef.current = false
      suppressClickRef.current = false
      setIsDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    []
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return
      const deltaY = e.clientY - startYRef.current
      if (!movedRef.current && Math.abs(deltaY) < FAB_DRAG_THRESHOLD) {
        return
      }
      movedRef.current = true
      applyTranslateY(startTranslateYRef.current + deltaY)
    },
    [applyTranslateY]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      stopDragging(e.pointerId)
    },
    [stopDragging]
  )

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      stopDragging(e.pointerId)
    },
    [stopDragging]
  )

  const handleLostPointerCapture = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      stopDragging(e.pointerId)
    },
    [stopDragging]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      onOpen()
    },
    [onOpen]
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={buttonRef}
          className={`fixed right-6 z-50 h-12 w-12 rounded-full shadow-lg ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } transition-none select-none`}
          size="icon"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handleLostPointerCapture}
          style={{
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 1.5rem)`,
            transform: `translate3d(0, ${translateY}px, 0)`,
            touchAction: 'none',
            willChange: 'transform',
          }}
        >
          <Bot className="h-5 w-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">AI Assistant</TooltipContent>
    </Tooltip>
  )
}
