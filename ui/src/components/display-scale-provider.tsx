/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { isDesktop } from '@/lib/desktop'
import { DesktopService, events } from '@/lib/mygo'

const MIN_DISPLAY_SCALE = 80
const MAX_DISPLAY_SCALE = isDesktop ? 125 : 120
const DISPLAY_SCALE_STEP = 5
const DESKTOP_SCALE_STEPS = [80, 90, 100, 110, 125]

export function nextDisplayScale(current: number, direction: 1 | -1) {
  if (!isDesktop) return current + direction * DISPLAY_SCALE_STEP
  if (direction === 1) {
    return (
      DESKTOP_SCALE_STEPS.find((step) => step > current) ?? MAX_DISPLAY_SCALE
    )
  }
  return (
    [...DESKTOP_SCALE_STEPS].reverse().find((step) => step < current) ??
    MIN_DISPLAY_SCALE
  )
}

type DisplayScaleProviderProps = {
  children: React.ReactNode
  defaultDisplayScale?: number
  storageKey?: string
}

type DisplayScaleProviderState = {
  displayScale: number
  setDisplayScale: (displayScale: number) => void
}

const initialState: DisplayScaleProviderState = {
  displayScale: 95,
  setDisplayScale: () => null,
}

const DisplayScaleProviderContext =
  createContext<DisplayScaleProviderState>(initialState)

function clampDisplayScale(value: number) {
  return Math.min(MAX_DISPLAY_SCALE, Math.max(MIN_DISPLAY_SCALE, value))
}

function normalizeDisplayScale(value: number) {
  return clampDisplayScale(
    Math.round(value / DISPLAY_SCALE_STEP) * DISPLAY_SCALE_STEP
  )
}

export function DisplayScaleProvider({
  children,
  defaultDisplayScale = 95,
  storageKey = 'vite-ui-display-scale',
  ...props
}: DisplayScaleProviderProps) {
  const [displayScale, setDisplayScaleState] = useState(() => {
    const stored = localStorage.getItem(storageKey)
    const value = stored === null ? defaultDisplayScale : Number(stored)

    return Number.isFinite(value)
      ? normalizeDisplayScale(value)
      : normalizeDisplayScale(defaultDisplayScale)
  })

  useEffect(() => {
    if (isDesktop) {
      void DesktopService.setDisplayScale(displayScale)
    } else {
      window.document.documentElement.style.setProperty(
        '--app-display-scale',
        `${displayScale}%`
      )
    }
    localStorage.setItem(storageKey, String(displayScale))
  }, [displayScale, storageKey])

  useEffect(() => {
    if (!isDesktop) return
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue !== null) {
        setDisplayScaleState(normalizeDisplayScale(Number(event.newValue)))
      }
    }
    window.addEventListener('storage', onStorage)
    const off = events.desktopCommand.on((command) => {
      if (command.action === 'zoom-in') {
        setDisplayScaleState((current) => nextDisplayScale(current, 1))
      } else if (command.action === 'zoom-out') {
        setDisplayScaleState((current) => nextDisplayScale(current, -1))
      } else if (command.action === 'zoom-reset') {
        setDisplayScaleState(100)
      }
    })
    return () => {
      window.removeEventListener('storage', onStorage)
      off()
    }
  }, [storageKey])

  const value = useMemo(
    () => ({
      displayScale,
      setDisplayScale: (nextDisplayScale: number) => {
        setDisplayScaleState(normalizeDisplayScale(nextDisplayScale))
      },
    }),
    [displayScale]
  )

  return (
    <DisplayScaleProviderContext.Provider {...props} value={value}>
      {children}
    </DisplayScaleProviderContext.Provider>
  )
}

export const useDisplayScale = () => {
  const context = useContext(DisplayScaleProviderContext)
  if (context === undefined)
    throw new Error(
      'useDisplayScale must be used within a DisplayScaleProvider'
    )
  return context
}
