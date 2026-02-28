import { createContext, ReactNode, useContext, useState } from 'react'

interface TerminalContextType {
  isOpen: boolean
  isMinimized: boolean
  openTerminal: () => void
  closeTerminal: () => void
  minimizeTerminal: () => void
  toggleTerminal: () => void
}

const TerminalContext = createContext<TerminalContextType | undefined>(
  undefined
)

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)

  // Open (or un-minimize) the terminal
  const openTerminal = () => {
    setIsOpen(true)
    setIsMinimized(false)
  }

  // Fully close and destroy the session
  const closeTerminal = () => {
    setIsOpen(false)
    setIsMinimized(false)
  }

  // Hide the panel but keep the session alive
  const minimizeTerminal = () => {
    setIsMinimized(true)
  }

  // Toggle open/minimized
  const toggleTerminal = () => {
    if (!isOpen) {
      openTerminal()
    } else if (isMinimized) {
      setIsMinimized(false)
    } else {
      minimizeTerminal()
    }
  }

  return (
    <TerminalContext.Provider
      value={{
        isOpen,
        isMinimized,
        openTerminal,
        closeTerminal,
        minimizeTerminal,
        toggleTerminal,
      }}
    >
      {children}
    </TerminalContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTerminal() {
  const context = useContext(TerminalContext)
  if (context === undefined) {
    throw new Error('useTerminal must be used within a TerminalProvider')
  }
  return context
}
