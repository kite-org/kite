import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useLocation, useParams } from 'react-router-dom'

interface PageContext {
  page: string
  namespace: string
  resourceName: string
  resourceKind: string
}

interface AIChatContextType {
  isOpen: boolean
  openChat: () => void
  closeChat: () => void
  toggleChat: () => void
  pageContext: PageContext
}

const AIChatContext = createContext<AIChatContextType | undefined>(undefined)

const singularResourceMap: Record<string, string> = {
  pods: 'pod',
  services: 'service',
  configmaps: 'configmap',
  secrets: 'secret',
  namespaces: 'namespace',
  nodes: 'node',
  persistentvolumeclaims: 'persistentvolumeclaim',
  persistentvolumes: 'persistentvolume',
  serviceaccounts: 'serviceaccount',
  deployments: 'deployment',
  statefulsets: 'statefulset',
  daemonsets: 'daemonset',
  replicasets: 'replicaset',
  jobs: 'job',
  cronjobs: 'cronjob',
  ingresses: 'ingress',
  networkpolicies: 'networkpolicy',
  storageclasses: 'storageclass',
  events: 'event',
}

function toSingularResource(resource: string) {
  if (!resource) return resource
  const normalized = resource.toLowerCase()
  if (singularResourceMap[normalized]) {
    return singularResourceMap[normalized]
  }
  if (normalized.endsWith('s')) {
    return normalized.slice(0, -1)
  }
  return normalized
}

export function AIChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const location = useLocation()
  const params = useParams()

  const openChat = useCallback(() => {
    setIsOpen(true)
  }, [])

  const closeChat = useCallback(() => {
    setIsOpen(false)
  }, [])

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => !prev)
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
