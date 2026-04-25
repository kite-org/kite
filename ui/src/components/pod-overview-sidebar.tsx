import { useMemo, useState } from 'react'
import { IconBox, IconExternalLink } from '@tabler/icons-react'
import { Event as KubernetesEvent, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'

import type { RelatedResources } from '@/types/api'
import { useRelatedResources } from '@/lib/api'
import {
  getCRDResourcePath,
  getEventTime,
  getPodPorts,
  isStandardK8sResource,
  type PodPort,
} from '@/lib/k8s'
import { getResourceMetadata, resourceIconMap } from '@/lib/resource-catalog'
import { withSubPath } from '@/lib/subpath'
import { cn, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type TranslationFn = ReturnType<typeof useTranslation>['t']

export function PodOverviewSidebar({
  pod,
  namespace,
  name,
  events,
  isEventsLoading,
}: {
  pod: Pod
  namespace: string
  name: string
  events: KubernetesEvent[]
  isEventsLoading: boolean
}) {
  const ports = getPodPorts(pod)
  const labels = pod.metadata?.labels || {}
  const annotations = pod.metadata?.annotations || {}
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('pods', name, namespace)

  return (
    <div className="space-y-3">
      <CompactEventsCard events={events} isLoading={isEventsLoading} />
      <CompactRelatedResourcesCard
        resources={relatedResources || []}
        isLoading={isRelatedLoading}
      />
      {ports.length > 0 ? (
        <PodPortsCard ports={ports} namespace={namespace} name={name} />
      ) : null}
      {Object.keys(labels).length > 0 ? (
        <MetadataListCard title="pods.labels" entries={labels} />
      ) : null}
      {Object.keys(annotations).length > 0 ? (
        <MetadataListCard title="pods.annotations" entries={annotations} />
      ) : null}
    </div>
  )
}

function CompactRelatedResourcesCard({
  resources,
  isLoading,
}: {
  resources: RelatedResources[]
  isLoading: boolean
}) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('pods.relatedResources')} ({resources.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {t('pods.loadingRelatedResources')}
          </div>
        ) : resources.length > 0 ? (
          <div className="max-h-64 divide-y divide-border/70 overflow-y-auto">
            {resources.map((resource, index) => (
              <CompactRelatedResourceRow
                key={`${resource.type}-${resource.namespace || ''}-${resource.name}-${index}`}
                resource={resource}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {t('pods.noRelatedResources')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CompactRelatedResourceRow({
  resource,
}: {
  resource: RelatedResources
}) {
  const [open, setOpen] = useState(false)
  const metadata = getResourceMetadata(resource.type)
  const Icon = metadata?.icon ? resourceIconMap[metadata.icon] : IconBox
  const path = useMemo(() => getRelatedResourcePath(resource), [resource])
  const rowContent = (
    <>
      <span className="inline-flex min-w-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">
          {metadata?.singularLabel || resource.type}
        </span>
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span className="truncate font-mono">{resource.name}</span>
      </span>
    </>
  )

  if (!path) {
    return (
      <div className="grid w-full min-w-0 grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-left text-xs">
        {rowContent}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="grid w-full min-w-0 cursor-pointer grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40"
        >
          {rowContent}
        </button>
      </DialogTrigger>
      <DialogContent className="!h-[calc(100dvh-1rem)] !max-w-[calc(100vw-1rem)] flex min-h-0 flex-col gap-0 p-0 md:!h-[80%] md:!max-w-[60%]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3 pr-14">
          <DialogTitle>{metadata?.singularLabel || resource.type}</DialogTitle>
          <a href={withSubPath(path)} target="_blank" rel="noopener noreferrer">
            <Button
              variant="outline"
              size="icon"
              aria-label="Open resource in new tab"
            >
              <IconExternalLink size={12} />
            </Button>
          </a>
        </DialogHeader>
        <iframe
          src={`${withSubPath(path)}?iframe=true`}
          className="min-h-0 w-full flex-grow border-none"
        />
      </DialogContent>
    </Dialog>
  )
}

function getRelatedResourcePath(resource: RelatedResources) {
  if (isStandardK8sResource(resource.type)) {
    return `/${resource.type}/${resource.namespace ? `${resource.namespace}/` : ''}${resource.name}`
  }
  if (!resource.apiVersion) {
    return undefined
  }
  return getCRDResourcePath(
    resource.type,
    resource.apiVersion,
    resource.namespace,
    resource.name
  )
}

function PodPortsCard({
  ports,
  namespace,
  name,
}: {
  ports: PodPort[]
  namespace: string
  name: string
}) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="border-b border-border/70 px-4 py-3 !pb-3">
        <CardTitle className="text-balance text-base">
          {t('pods.ports')} ({ports.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {ports.map(({ containerName, port }, index) => (
            <div
              key={`${containerName}-${port.name || 'port'}-${port.containerPort}-${port.protocol}-${index}`}
              className="flex min-w-0 items-center gap-3 px-4 py-2.5 text-sm"
            >
              <a
                href={withSubPath(
                  `/api/v1/namespaces/${namespace}/pods/${name}:${port.containerPort}/proxy/`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="app-link inline-flex min-w-0 items-center gap-1 font-mono tabular-nums"
              >
                <span className="truncate">{port.containerPort}</span>
                <IconExternalLink className="size-3 shrink-0" />
              </a>
              <span className="text-xs text-muted-foreground">
                {port.protocol || 'TCP'}
              </span>
              {port.name ? (
                <Badge variant="secondary" className="ml-auto text-xs">
                  {port.name}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MetadataListCard({
  title,
  entries,
}: {
  title: string
  entries: Record<string, string>
}) {
  const { t } = useTranslation()
  const rows = Object.entries(entries)

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t(title)} ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length > 0 ? (
          <div className="max-h-72 divide-y overflow-y-auto">
            {rows.map(([key, value]) => (
              <div
                key={key}
                className="flex min-w-0 items-center gap-2 px-4 py-2.5 text-xs"
              >
                <Badge
                  variant="outline"
                  className="min-w-0 shrink truncate font-mono"
                  title={key}
                >
                  {key}
                </Badge>
                <span
                  className="min-w-0 flex-1 truncate text-right font-mono text-muted-foreground"
                  title={value}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {t('common.none')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CompactEventsCard({
  events,
  isLoading,
}: {
  events: KubernetesEvent[]
  isLoading: boolean
}) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('events.title')} ({events.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {t('events.loading')}
          </div>
        ) : events.length > 0 ? (
          <div className="max-h-56 divide-y divide-border/70 overflow-y-auto">
            {events.map((event, index) => (
              <div
                key={`${event.reason}-${event.message}-${index}`}
                className="px-3 py-2"
              >
                <div className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'inline-flex min-w-0 items-center gap-1.5 font-medium',
                      event.type === 'Normal' && 'text-emerald-600',
                      event.type === 'Warning' && 'text-yellow-600',
                      event.type !== 'Normal' &&
                        event.type !== 'Warning' &&
                        'text-destructive'
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        getEventTypeDotClassName(event.type)
                      )}
                    />
                    <span className="truncate">
                      {formatEventType(event.type, t)}
                    </span>
                  </span>
                  <span className="truncate font-medium">
                    {event.reason || '-'}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {formatEventAge(event, t)}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-1 pl-[5.25rem] text-xs leading-snug text-pretty text-muted-foreground">
                  {event.message || '-'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {t('events.noRecentEvents')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function formatEventType(type: string | undefined, t: TranslationFn) {
  if (!type) {
    return '-'
  }
  const key = type.charAt(0).toLowerCase() + type.slice(1)
  return t(`events.types.${key}`, { defaultValue: type })
}

function formatEventAge(event: KubernetesEvent, t: TranslationFn) {
  const eventTime = getEventTime(event)
  return eventTime.getTime() > 0
    ? t('common.timeAgo', { time: getAge(eventTime.toISOString()) })
    : '-'
}

function getEventTypeDotClassName(type?: string) {
  if (type === 'Normal') {
    return 'bg-emerald-500'
  }
  if (type === 'Warning') {
    return 'bg-yellow-500'
  }
  return 'bg-destructive'
}
