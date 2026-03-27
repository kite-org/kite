import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GlobalSearchProvider, useGlobalSearch } from './global-search-provider'

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

function GlobalSearchConsumer() {
  const { isOpen, openSearch, closeSearch } = useGlobalSearch()

  return (
    <div>
      <span data-testid="state">{isOpen ? 'open' : 'closed'}</span>
      <button type="button" onClick={openSearch}>
        open
      </button>
      <button type="button" onClick={closeSearch}>
        close
      </button>
    </div>
  )
}

describe('GlobalSearchProvider', () => {
  it('toggles from the keyboard and closes on escape', async () => {
    render(
      <GlobalSearchProvider>
        <GlobalSearchConsumer />
      </GlobalSearchProvider>
    )

    expect(screen.getByTestId('state')).toHaveTextContent('closed')

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('open')
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('closed')
    })
  })
})
