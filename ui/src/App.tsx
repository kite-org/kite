import './App.css'
import './desktop.css'

import { ReactNode, useEffect, useState } from 'react'
import { AIChatProvider, useAIChatContext } from '@/contexts/ai-chat-context'
import { useAuth } from '@/contexts/auth-context'
import { ClusterProvider } from '@/contexts/cluster-context'
import { TerminalProvider, useTerminal } from '@/contexts/terminal-context'
import { WorkspaceProvider } from '@/contexts/workspace-context'
import { Overview } from '@/pages/overview'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { toast } from 'sonner'

import {
  isDesktop,
  isDesktopChild,
  openDesktopChat,
  openDesktopWorkspace,
  setPendingDesktopImport,
} from '@/lib/desktop'
import { DesktopService, events } from '@/lib/mygo'
import { useCluster } from '@/hooks/use-cluster'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import type { PageContext } from '@/components/ai-chat/ai-chat-types'
import { AIChatbox, StandaloneAIChatbox } from '@/components/ai-chat/ai-chatbox'
import { AppSidebar } from '@/components/app-sidebar'
import { DesktopWorkspace } from '@/components/desktop-workspace'
import { ErrorBoundary } from '@/components/error-boundary'
import { FloatingTerminal } from '@/components/floating-terminal'
import { GlobalSearch } from '@/components/global-search'
import {
  GlobalSearchProvider,
  useGlobalSearch,
} from '@/components/global-search-provider'
import { PortForwardManager } from '@/components/port-forward'
import { SiteHeader } from '@/components/site-header'
import { UserMenu } from '@/components/user-menu'

export function DesktopReady() {
  const { isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
      </div>
    )
  }
  if (
    location.pathname === '/' &&
    !localStorage.getItem('kite-desktop-setup-complete')
  ) {
    return <Navigate to="/setup" replace />
  }
  return <Outlet />
}

export function DesktopOverview() {
  const { clusters } = useCluster()
  return clusters.length === 0 ? (
    <Navigate to="/settings?tab=clusters" replace />
  ) : (
    <Overview />
  )
}

function ClusterGate({
  children,
  expectedCluster,
}: {
  children: ReactNode
  expectedCluster?: string
}) {
  const { t } = useTranslation()
  const { isLoading, error, currentCluster, clusters } = useCluster()

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <span>{t('cluster.loading')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-red-500">
          <p>{t('cluster.error', { error: error.message })}</p>
        </div>
      </div>
    )
  }

  if (
    expectedCluster &&
    (currentCluster !== expectedCluster ||
      !clusters.some((cluster) => cluster.name === expectedCluster))
  ) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {t('desktop.clusterUnavailable', { cluster: expectedCluster })}
      </p>
    )
  }

  return <>{children}</>
}

function MainContent() {
  const { t } = useTranslation()
  const { currentCluster, clusters } = useCluster()
  const location = useLocation()
  const clusterUnavailable =
    isDesktop &&
    currentCluster &&
    !clusters.some((cluster) => cluster.name === currentCluster) &&
    location.pathname !== '/settings'
  return (
    <div className="@container/main flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 py-4 md:gap-6">
        <div className="flex min-h-0 flex-1 flex-col px-4 lg:px-6">
          <ErrorBoundary>
            {clusterUnavailable ? (
              <p role="alert" className="text-sm text-destructive">
                {t('desktop.clusterUnavailable', { cluster: currentCluster })}
              </p>
            ) : (
              <Outlet />
            )}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}

function WebLayout() {
  const { isOpen: isTerminalOpen } = useTerminal()
  return (
    <>
      <SidebarProvider>
        <AppSidebar variant="inset" />
        <SidebarInset className="h-dvh overflow-y-auto overscroll-none scrollbar-hide">
          <SiteHeader />
          <MainContent />
        </SidebarInset>
      </SidebarProvider>
      {isTerminalOpen && (
        <ErrorBoundary fallback={null}>
          <FloatingTerminal />
        </ErrorBoundary>
      )}
      <ErrorBoundary fallback={null}>
        <AIChatbox />
      </ErrorBoundary>
    </>
  )
}

function DesktopHeaderActions() {
  const { t } = useTranslation()
  const { openChat } = useAIChatContext()
  return (
    <>
      <PortForwardManager />
      <Button
        variant="ghost"
        size="icon"
        onClick={openChat}
        aria-label={t('aiChat.openInWindow')}
        title={t('aiChat.openInWindow')}
      >
        <Bot className="size-5" />
      </Button>
    </>
  )
}

function DesktopLayout() {
  const navigate = useNavigate()
  const { openChat } = useAIChatContext()
  const { currentCluster } = useCluster()
  const { t } = useTranslation()
  useEffect(
    () =>
      events.desktopCommand.on((command) => {
        if (command.action === 'open-ai') openChat()
        if (command.action === 'import-kubeconfig') {
          if (command.error) {
            toast.error(t('clusterManagement.messages.fileReadError'))
            return
          }
          setPendingDesktopImport(command)
          navigate('/settings?tab=clusters', { state: { desktopImport: true } })
        }
      }),
    [navigate, openChat, t]
  )
  return (
    <SidebarProvider className="desktop-shell min-h-0 flex-col">
      <SiteHeader
        className="desktop-titlebar"
        extraActions={<DesktopHeaderActions />}
        openKubectl={() => {
          void DesktopService.openKubectl(currentCluster || '').catch(
            (error: Error) => toast.error(t(error.message))
          )
        }}
        userMenu={<UserMenu showAccount={false} />}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar variant="sidebar" />
        <SidebarInset className="min-h-0 overflow-y-auto overscroll-none">
          <MainContent />
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

function DesktopChildLayout() {
  const [title, setTitle] = useState(document.title)
  useEffect(() => {
    const titleElement = document.querySelector('title')!
    const observer = new MutationObserver(() => setTitle(document.title))
    observer.observe(titleElement, { childList: true })
    setTitle(document.title)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="desktop-child flex h-dvh flex-col bg-background">
      <header className="desktop-child-titlebar flex shrink-0 items-center border-b bg-sidebar">
        <span className="truncate text-sm font-medium text-muted-foreground">
          {title.replace(/ - Kite$/, '')}
        </span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3 lg:px-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}

function AppContent({ children }: { children: ReactNode }) {
  const { isOpen, closeSearch } = useGlobalSearch()
  const [searchParams] = useSearchParams()
  if (isDesktopChild) return <DesktopChildLayout />
  if (searchParams.get('iframe') === 'true') return <Outlet />
  return (
    <>
      {children}
      {isOpen && <GlobalSearch open={isOpen} onOpenChange={closeSearch} />}
      <Toaster />
    </>
  )
}

function AppProviders({
  children,
  initialCluster,
  openChatWindow,
}: {
  children: ReactNode
  initialCluster?: string
  openChatWindow?: (context: PageContext) => void
}) {
  return (
    <TerminalProvider>
      <ClusterProvider initialCluster={initialCluster}>
        <GlobalSearchProvider>
          <AIChatProvider openWindow={openChatWindow}>
            {children}
          </AIChatProvider>
        </GlobalSearchProvider>
      </ClusterProvider>
    </TerminalProvider>
  )
}

export function WebApp() {
  return (
    <AppProviders>
      <ClusterGate>
        <AppContent>
          <WebLayout />
        </AppContent>
      </ClusterGate>
    </AppProviders>
  )
}

export function DesktopApp() {
  return (
    <AppProviders openChatWindow={openDesktopChat}>
      <WorkspaceProvider openWorkspace={openDesktopWorkspace}>
        <ClusterGate>
          <AppContent>
            <DesktopLayout />
          </AppContent>
        </ClusterGate>
      </WorkspaceProvider>
    </AppProviders>
  )
}

export function StandaloneAIChatApp() {
  return (
    <AppProviders>
      <ClusterGate>
        <StandaloneAIChatbox />
      </ClusterGate>
    </AppProviders>
  )
}

export function DesktopAIChatApp() {
  const [searchParams] = useSearchParams()
  const cluster = searchParams.get('cluster') || undefined
  return (
    <AppProviders initialCluster={cluster}>
      <ClusterGate expectedCluster={cluster}>
        <StandaloneAIChatbox desktop />
      </ClusterGate>
    </AppProviders>
  )
}

export function DesktopWorkspaceApp() {
  const [searchParams] = useSearchParams()
  const cluster = searchParams.get('cluster') || undefined
  return (
    <AppProviders initialCluster={cluster}>
      <ClusterGate expectedCluster={cluster}>
        <DesktopWorkspace />
      </ClusterGate>
    </AppProviders>
  )
}
