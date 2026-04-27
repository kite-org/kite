/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const MIN_DISPLAY_SCALE = 80
const MAX_DISPLAY_SCALE = 120
const DISPLAY_SCALE_STEP = 5

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
    window.document.documentElement.style.setProperty(
      '--app-display-scale',
      `${displayScale}%`
    )
    localStorage.setItem(storageKey, String(displayScale))
  }, [displayScale, storageKey])

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
