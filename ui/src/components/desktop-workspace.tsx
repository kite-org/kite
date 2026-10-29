import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { useResource } from '@/lib/api'
import { usePageTitle } from '@/hooks/use-page-title'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBoundary } from '@/components/error-boundary'
import { ErrorMessage } from '@/components/error-message'
import { LogViewer } from '@/components/log-viewer'
import { Terminal } from '@/components/terminal'

function PodWorkspace({
  view,
  namespace,
  name,
  container,
}: {
  view: 'logs' | 'terminal'
  namespace: string
  name: string
  container?: string
}) {
  const { t } = useTranslation()
  const {
    data: pod,
    isLoading,
    error,
    refetch,
  } = useResource('pods', name, namespace)
  if (isLoading) return <Skeleton className="h-full w-full" />
  if (error)
    return <ErrorMessage resourceName={name} error={error} refetch={refetch} />
  if (!pod) return null
  const fixedContainer =
    container && container !== '_all' ? container : undefined
  if (
    fixedContainer &&
    ![
      ...(pod.spec?.containers ?? []),
      ...(pod.spec?.initContainers ?? []),
      ...(pod.spec?.ephemeralContainers ?? []),
    ].some((item) => item.name === fixedContainer)
  ) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {t('desktop.containerUnavailable', { container: fixedContainer })}
      </p>
    )
  }
  const props = {
    namespace,
    podName: name,
    containers: pod.spec?.containers.filter(
      (item) => !fixedContainer || item.name === fixedContainer
    ),
    initContainers: pod.spec?.initContainers?.filter(
      (item) => !fixedContainer || item.name === fixedContainer
    ),
    ephemeralContainers: pod.spec?.ephemeralContainers?.filter(
      (item) => !fixedContainer || item.name === fixedContainer
    ),
    selectedContainerName: container,
  }
  return view === 'logs' ? (
    <LogViewer {...props} />
  ) : (
    <Terminal
      {...props}
      attachContainerName={
        pod.metadata?.annotations?.['kite.io/debug-container']
      }
    />
  )
}

export function DesktopWorkspace() {
  const [params] = useSearchParams()
  const { t } = useTranslation()
  const { user, capabilities } = useAuth()
  const view = params.get('view')
  const cluster = params.get('cluster')
  const namespace = params.get('namespace')
  const name = params.get('name')
  const container = params.get('container') || undefined
  const title =
    view === 'kubectl'
      ? 'Kubectl'
      : t(view === 'logs' ? 'common.tabs.logs' : 'common.tabs.terminal')
  usePageTitle([title, name, container, cluster].filter(Boolean).join(' · '))

  if (
    !cluster ||
    !['logs', 'terminal', 'kubectl'].includes(view || '') ||
    (view !== 'kubectl' && (!namespace || !name)) ||
    (view === 'kubectl' && (!user?.isAdmin() || !capabilities.kubectlEnabled))
  ) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {t('desktop.workspaceUnavailable')}
      </p>
    )
  }
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b bg-sidebar px-4 py-2">
        <span className="text-sm font-medium">{title}</span>
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={[cluster, namespace, name, container]
            .filter(Boolean)
            .join(' / ')}
        >
          {[cluster, namespace, name, container].filter(Boolean).join(' / ')}
        </span>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <ErrorBoundary>
          {view === 'kubectl' ? (
            <Terminal type="kubectl" />
          ) : (
            <PodWorkspace
              view={view as 'logs' | 'terminal'}
              namespace={namespace!}
              name={name!}
              container={container}
            />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}
