import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import { useAIChatContext } from '@/contexts/ai-chat-context'
import { useLocation, useSearchParams } from 'react-router-dom'

import { useAIStatus } from '@/lib/api'
import { useIsMobile } from '@/hooks/use-mobile'
import { AIChatPanel } from '@/components/ai-chat/ai-chat-panel'
import { AIChatTrigger } from '@/components/ai-chat/ai-chat-trigger'

const MIN_HEIGHT = 200
const DESKTOP_DEFAULT_HEIGHT_RATIO = 0.62
const MIN_WIDTH = 320
const DEFAULT_WIDTH = 420
const DESKTOP_MARGIN = 16
const MOBILE_DEFAULT_HEIGHT_RATIO = 0.62

export function StandaloneAIChatbox() {
  const [searchParams] = useSearchParams()
  return (
    <AIChatbox
      standalone
      sessionId={searchParams.get('sessionId')?.trim() || ''}
    />
  )
}

export function AIChatbox({
  standalone = false,
  sessionId = '',
}: {
  standalone?: boolean
  sessionId?: string
}) {
  const isMobile = useIsMobile()
  const { isOpen, openChat, closeChat } = useAIChatContext()
  const { data: { enabled: aiEnabled } = { enabled: false } } = useAIStatus()
  const { pathname } = useLocation()
  const shouldShowAIChatbox = standalone || !/^\/settings\/?$/.test(pathname)

  const [height, setHeight] = useState(() =>
    Math.round(
      (window.visualViewport?.height ?? window.innerHeight) *
        DESKTOP_DEFAULT_HEIGHT_RATIO
    )
  )
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  }))
  const heightDragging = useRef(false)
  const widthDragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)
  const startX = useRef(0)
  const startW = useRef(0)

  const getDesktopBounds = useCallback((vw: number, vh: number) => {
    const maxWidth = Math.max(MIN_WIDTH, Math.min(720, vw - DESKTOP_MARGIN))
    const minWidth = Math.min(MIN_WIDTH, maxWidth)
    const maxHeight = Math.max(MIN_HEIGHT, vh * 0.85)
    const minHeight = Math.min(MIN_HEIGHT, maxHeight)
    return { minWidth, maxWidth, minHeight, maxHeight }
  }, [])

  useEffect(() => {
    const updateViewport = () =>
      setViewportSize({
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
      })

    updateViewport()
    window.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('resize', updateViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('resize', updateViewport)
    }
  }, [])

  useEffect(() => {
    if (isMobile) return
    const bounds = getDesktopBounds(viewportSize.width, viewportSize.height)
    setWidth((prev) =>
      Math.min(bounds.maxWidth, Math.max(bounds.minWidth, prev))
    )
    setHeight((prev) =>
      Math.min(bounds.maxHeight, Math.max(bounds.minHeight, prev))
    )
  }, [getDesktopBounds, isMobile, viewportSize.height, viewportSize.width])

  const desktopBounds = getDesktopBounds(
    viewportSize.width,
    viewportSize.height
  )
  const desktopWidth = Math.min(
    desktopBounds.maxWidth,
    Math.max(desktopBounds.minWidth, width)
  )
  const desktopHeight = Math.min(
    desktopBounds.maxHeight,
    Math.max(desktopBounds.minHeight, height)
  )

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (isMobile) return
      heightDragging.current = true
      startY.current = e.clientY
      startH.current = height
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [height, isMobile]
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!heightDragging.current || isMobile) return
      const { minHeight, maxHeight } = getDesktopBounds(
        window.innerWidth,
        window.innerHeight
      )
      const newH = Math.min(
        maxHeight,
        Math.max(minHeight, startH.current + (startY.current - e.clientY))
      )
      setHeight(newH)
    },
    [getDesktopBounds, isMobile]
  )

  const onPointerUp = useCallback(() => {
    heightDragging.current = false
  }, [])

  const onWidthPointerDown = useCallback(
    (e: PointerEvent) => {
      if (isMobile) return
      widthDragging.current = true
      startX.current = e.clientX
      startW.current = width
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [isMobile, width]
  )

  const onWidthPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!widthDragging.current || isMobile) return
      const { minWidth, maxWidth } = getDesktopBounds(
        window.innerWidth,
        window.innerHeight
      )
      const newW = Math.min(
        maxWidth,
        Math.max(minWidth, startW.current + (startX.current - e.clientX))
      )
      setWidth(newW)
    },
    [getDesktopBounds, isMobile]
  )

  const onWidthPointerUp = useCallback(() => {
    widthDragging.current = false
  }, [])

  if (!shouldShowAIChatbox) return null
  if (!aiEnabled) return null

  if (!standalone && !isOpen) {
    return <AIChatTrigger onOpen={openChat} />
  }

  return (
    <div
      className={
        standalone
          ? 'fixed inset-0 z-50 flex flex-col bg-background'
          : `fixed z-50 flex flex-col border bg-background shadow-2xl ${
              isMobile
                ? 'left-2 right-2 rounded-lg'
                : 'bottom-4 right-4 rounded-lg'
            }`
      }
      style={
        standalone
          ? undefined
          : isMobile
            ? {
                bottom: `calc(env(safe-area-inset-bottom, 0px) + 0.5rem)`,
                height: `${MOBILE_DEFAULT_HEIGHT_RATIO * 100}%`,
              }
            : {
                width: desktopWidth,
                height: desktopHeight,
              }
      }
    >
      {!isMobile && !standalone && (
        <div
          className="absolute -top-1 left-4 right-4 z-10 h-2 cursor-ns-resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
      {!isMobile && !standalone && (
        <div
          className="absolute -left-1 top-11 bottom-0 z-10 w-2 cursor-ew-resize"
          onPointerDown={onWidthPointerDown}
          onPointerMove={onWidthPointerMove}
          onPointerUp={onWidthPointerUp}
        />
      )}

      <AIChatPanel
        standalone={standalone}
        sessionId={sessionId}
        onClose={standalone ? () => window.close() : closeChat}
      />
    </div>
  )
}
