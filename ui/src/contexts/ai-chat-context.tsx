import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { PageContext } from '@/components/ai-chat/ai-chat-types'
import { toSingularResource } from '@/components/ai-chat/ai-chat-utils'

interface AIChatContextType {
  isOpen: boolean
  openChat: () => void
  closeChat: () => void
  toggleChat: () => void
  pageContext: PageContext
}

const AIChatContext = createContext<AIChatContextType | undefined>(undefined)

export function AIChatProvider({
  children,
  openWindow,
}: {
  children: ReactNode
  openWindow?: (context: PageContext) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const location = useLocation()
  const params = useParams()

  const closeChat = useCallback(() => {
    setIsOpen(false)
  }, [])

  const pageContext = useMemo<PageContext>(() => {
    const path = location.pathname
    const searchParams = new URLSearchParams(location.search)

    if (path === '/ai-chat-box') {
      return {
        page: searchParams.get('page') || 'overview',
        namespace: searchParams.get('namespace') || '',
        resourceName: searchParams.get('resourceName') || '',
        resourceKind: toSingularResource(
          searchParams.get('resourceKind') || ''
        ),
      }
    }

    const resource = params.resource || ''
    const name = params.name || ''
    const namespace = params.namespace || ''
    const normalizedKind = toSingularResource(resource)

    let page = 'overview'
    if (path === '/' || path === '/dashboard') {
      page = 'overview'
    } else if (name) {
      page = `${normalizedKind}-detail`
    } else if (resource) {
      page = `${resource}-list`
    }

    return {
      page,
      namespace,
      resourceName: name,
      resourceKind: normalizedKind,
    }
  }, [
    location.pathname,
    location.search,
    params.resource,
    params.name,
    params.namespace,
  ])

  const openChat = useCallback(() => {
    if (openWindow) {
      openWindow(pageContext)
      return
    }
    setIsOpen(true)
  }, [openWindow, pageContext])

  const toggleChat = useCallback(() => {
    if (openWindow) {
      openChat()
      return
    }
    setIsOpen((prev) => !prev)
  }, [openChat, openWindow])

  return (
    <AIChatContext.Provider
      value={{
        isOpen,
        openChat,
        closeChat,
        toggleChat,
        pageContext,
      }}
    >
      {children}
    </AIChatContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAIChatContext() {
  const context = useContext(AIChatContext)
  if (context === undefined) {
    throw new Error('useAIChatContext must be used within an AIChatProvider')
  }
  return context
}
