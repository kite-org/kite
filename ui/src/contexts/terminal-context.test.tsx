import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TerminalProvider, useTerminal } from './terminal-context'

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

function TerminalConsumer() {
  const {
    isOpen,
    isMinimized,
    openTerminal,
    closeTerminal,
    minimizeTerminal,
    toggleTerminal,
  } = useTerminal()

  return (
    <div>
      <span data-testid="state">
        {isOpen ? 'open' : 'closed'}/{isMinimized ? 'minimized' : 'expanded'}
      </span>
      <button type="button" onClick={openTerminal}>
        open
      </button>
      <button type="button" onClick={closeTerminal}>
        close
      </button>
      <button type="button" onClick={minimizeTerminal}>
        minimize
      </button>
      <button type="button" onClick={toggleTerminal}>
        toggle
      </button>
    </div>
  )
}

describe('TerminalProvider', () => {
  it('drives the terminal state through its public actions', async () => {
    render(
      <TerminalProvider>
        <TerminalConsumer />
      </TerminalProvider>
    )

    expect(screen.getByTestId('state')).toHaveTextContent('closed/expanded')

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('open/expanded')
    })

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('open/minimized')
    })

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('open/expanded')
    })

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('closed/expanded')
    })
  })
})
