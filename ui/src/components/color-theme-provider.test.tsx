import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ColorThemeProvider, useColorTheme } from './color-theme-provider'

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

function ColorThemeConsumer() {
  const { colorTheme, setColorTheme } = useColorTheme()

  return (
    <div>
      <span data-testid="state">{colorTheme}</span>
      <button type="button" onClick={() => setColorTheme('claude')}>
        set claude
      </button>
    </div>
  )
}

describe('ColorThemeProvider', () => {
  it('applies the stored color theme and replaces the root class on update', async () => {
    localStorage.clear()
    localStorage.setItem('color-theme-key', 'eye-care')
    document.documentElement.className = 'color-default'

    render(
      <ColorThemeProvider
        defaultColorTheme="default"
        storageKey="color-theme-key"
      >
        <ColorThemeConsumer />
      </ColorThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('eye-care')
    })
    expect(document.documentElement).toHaveClass('color-eye-care')
    expect(document.documentElement).not.toHaveClass('color-default')

    fireEvent.click(screen.getByRole('button', { name: 'set claude' }))

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('claude')
    })
    expect(localStorage.getItem('color-theme-key')).toBe('claude')
    expect(document.documentElement).toHaveClass('color-claude')
    expect(document.documentElement).not.toHaveClass('color-eye-care')
  })
})
