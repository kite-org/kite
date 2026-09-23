/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { usePlugins } from '@/plugins/plugin-context'
import type { LocalizedLabel } from '@kite-dev/plugin-sdk'

export const colorThemes = {
  default: '',
  'eye-care': '',
  darkmatter: '',
  notebook: '',
  'clean-slate': '',
  claude: '',
}

export type BuiltInColorTheme = keyof typeof colorThemes
export type PluginColorTheme = `plugin-${string}`
export type ColorTheme = BuiltInColorTheme | PluginColorTheme

export interface PluginColorThemeEntry {
  id: PluginColorTheme
  label: LocalizedLabel
  pluginId: string
  pluginName: string
  styles: string[]
}

type ColorThemeProviderProps = {
  children: React.ReactNode
  defaultColorTheme?: ColorTheme
  storageKey?: string
}

type ColorThemeProviderState = {
  colorTheme: ColorTheme
  setColorTheme: (colorTheme: ColorTheme) => void
  pluginThemes: PluginColorThemeEntry[]
}

const initialState: ColorThemeProviderState = {
  colorTheme: 'default',
  setColorTheme: () => null,
  pluginThemes: [],
}

const ColorThemeProviderContext =
  createContext<ColorThemeProviderState>(initialState)

const pluginThemePrefix = 'plugin-'
const pluginThemeLinkAttribute = 'data-kite-plugin-theme'

function isPluginColorTheme(theme: string): theme is PluginColorTheme {
  return theme.startsWith(pluginThemePrefix)
}

// `plugin-my-plugin-dark` becomes the root class `color-my-plugin-dark`.
export function pluginThemeClass(theme: PluginColorTheme) {
  return `color-${theme.slice(pluginThemePrefix.length)}`
}

function applyColorThemeClass(theme: ColorTheme) {
  const root = window.document.documentElement
  const previous = root.dataset.colorThemeClass
  if (previous) root.classList.remove(previous)
  root.classList.remove(
    ...Object.keys(colorThemes).map((name) => `color-${name}`)
  )
  const className = isPluginColorTheme(theme)
    ? pluginThemeClass(theme)
    : `color-${theme}`
  root.classList.add(className)
  if (isPluginColorTheme(theme)) root.dataset.colorThemeClass = className
  else delete root.dataset.colorThemeClass
}

// Plugin theme stylesheets stay in the document only while their theme is active.
function syncPluginThemeStyles(styles: readonly string[]) {
  const head = window.document.head
  const existing = new Map<string, HTMLLinkElement>()
  for (const link of head.querySelectorAll<HTMLLinkElement>(
    `link[${pluginThemeLinkAttribute}]`
  )) {
    existing.set(link.href, link)
  }
  const wanted = new Set(styles)
  for (const [href, link] of existing) {
    if (!wanted.has(href)) link.remove()
  }
  for (const href of wanted) {
    if (existing.has(href)) continue
    const link = window.document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.setAttribute(pluginThemeLinkAttribute, '')
    head.append(link)
  }
}

type CachedPluginTheme = { theme: PluginColorTheme; styles: string[] }

function readCachedPluginTheme(storageKey: string): CachedPluginTheme | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { theme, styles } = parsed as Record<string, unknown>
    if (typeof theme !== 'string' || !isPluginColorTheme(theme)) return null
    if (!Array.isArray(styles) || !styles.every((s) => typeof s === 'string'))
      return null
    return { theme, styles }
  } catch {
    return null
  }
}

export function ColorThemeProvider({
  children,
  defaultColorTheme = 'default',
  storageKey = 'vite-ui-color-theme',
  ...props
}: ColorThemeProviderProps) {
  const { plugins, isReady } = usePlugins()
  const assetsStorageKey = `${storageKey}-plugin-assets`

  const pluginThemes = useMemo(
    () =>
      plugins
        .filter((plugin) => !plugin.invalid && !plugin.error)
        .flatMap<PluginColorThemeEntry>((plugin) => {
          const base = new URL(plugin.assetBaseUrl, window.location.origin)
          return (plugin.manifest.themes ?? []).map<PluginColorThemeEntry>(
            (theme) => ({
              id: `${pluginThemePrefix}${plugin.manifest.id}-${theme.id}`,
              label: theme.label ?? theme.id,
              pluginId: plugin.manifest.id,
              pluginName: plugin.manifest.name,
              styles: theme.styles.map((style) => new URL(style, base).href),
            })
          )
        }),
    [plugins]
  )

  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    const stored =
      (window.localStorage.getItem(storageKey) as ColorTheme | null) ??
      defaultColorTheme
    if (isPluginColorTheme(stored)) {
      // Apply the cached stylesheets synchronously so a reload does not flash
      // the default theme while plugin metadata is still loading.
      const cached = readCachedPluginTheme(assetsStorageKey)
      if (cached?.theme === stored) {
        applyColorThemeClass(stored)
        syncPluginThemeStyles(cached.styles)
      }
    }
    return stored
  })

  const activePluginTheme = useMemo(
    () => pluginThemes.find((theme) => theme.id === colorTheme),
    [pluginThemes, colorTheme]
  )

  useEffect(() => {
    applyColorThemeClass(colorTheme)
    if (!isPluginColorTheme(colorTheme)) {
      syncPluginThemeStyles([])
      window.localStorage.removeItem(assetsStorageKey)
      return
    }
    if (!activePluginTheme) return
    syncPluginThemeStyles(activePluginTheme.styles)
    window.localStorage.setItem(
      assetsStorageKey,
      JSON.stringify({
        theme: activePluginTheme.id,
        styles: activePluginTheme.styles,
      })
    )
  }, [colorTheme, activePluginTheme, assetsStorageKey])

  useEffect(() => {
    if (!isReady) return
    if (!isPluginColorTheme(colorTheme) || activePluginTheme) return
    window.localStorage.setItem(storageKey, defaultColorTheme)
    setColorThemeState(defaultColorTheme)
  }, [isReady, colorTheme, activePluginTheme, defaultColorTheme, storageKey])

  const value = {
    colorTheme,
    setColorTheme: (colorTheme: ColorTheme) => {
      window.localStorage.setItem(storageKey, colorTheme)
      setColorThemeState(colorTheme)
    },
    pluginThemes,
  }

  return (
    <ColorThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ColorThemeProviderContext.Provider>
  )
}

export const useColorTheme = () => {
  const context = useContext(ColorThemeProviderContext)

  if (context === undefined)
    throw new Error('useColorTheme must be used within a ColorThemeProvider')

  return context
}
