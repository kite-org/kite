import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ThemeProvider, useTheme } from './theme-provider'

function createStorage() {
  let store: Record<string, string> = {}

  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

vi.stubGlobal('localStorage', createStorage())
vi.stubGlobal('sessionStorage', createStorage())

function createMatchMedia(matches: boolean) {
  let currentMatches = matches
  const listeners = new Set<(event: Event) => void>()

  const mediaQueryList = {
    get matches() {
      return currentMatches
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(
      (event: string, listener: (event: Event) => void) => {
        if (event === 'change') {
          listeners.add(listener)
        }
      }
    ),
    removeEventListener: vi.fn(
      (event: string, listener: (event: Event) => void) => {
        if (event === 'change') {
          listeners.delete(listener)
        }
      }
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatch(nextMatches: boolean) {
      currentMatches = nextMatches
      listeners.forEach((listener) => listener(new Event('change')))
    },
  }

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mediaQueryList)
  )

  return mediaQueryList
}

function ThemeConsumer() {
  const { theme, actualTheme, setTheme } = useTheme()

  return (
    <div>
      <span data-testid="state">
        {theme}/{actualTheme}
      </span>
      <button type="button" onClick={() => setTheme('dark')}>
        set dark
      </button>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('persists theme changes and updates the root theme class', async () => {
    createMatchMedia(false)

    render(
      <ThemeProvider defaultTheme="light" storageKey="theme-key">
        <ThemeConsumer />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'set dark' }))

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('dark/dark')
    })
    expect(localStorage.getItem('theme-key')).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement).not.toHaveClass('light')
  })

  it('tracks system theme changes when the theme is system', async () => {
    const mediaQueryList = createMatchMedia(false)

    render(
      <ThemeProvider defaultTheme="system" storageKey="theme-key">
        <ThemeConsumer />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('system/light')
      expect(document.documentElement).toHaveClass('light')
    })

    mediaQueryList.dispatch(true)

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('system/dark')
      expect(document.documentElement).toHaveClass('dark')
      expect(document.documentElement).not.toHaveClass('light')
    })
  })
})
