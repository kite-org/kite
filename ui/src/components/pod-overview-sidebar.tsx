import { useMemo, useState } from 'react'
import { IconBox, IconExternalLink } from '@tabler/icons-react'
import { Event as KubernetesEvent, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import type { RelatedResources } from '@/types/api'
import { useRelatedResources } from '@/lib/api'
import {
  getCRDResourcePath,
  getEventTime,
  getPodPorts,
  isStandardK8sResource,
  type PodPort,
} from '@/lib/k8s'
import {
  getResourceDetailPath,
  getResourceMetadata,
  resourceIconMap,
} from '@/lib/resource-catalog'
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
import { ScrollArea } from '@/components/ui/scroll-area'

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
        <MetadataListCard title="common.fields.labels" entries={labels} />
      ) : null}
      {Object.keys(annotations).length > 0 ? (
        <MetadataListCard
          title="common.fields.annotations"
          entries={annotations}
        />
      ) : null}
    </div>
  )
}

export function CompactRelatedResourcesCard({
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
          {t('common.fields.relatedResources')} ({resources.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {t('pods.loadingRelatedResources')}
          </div>
        ) : resources.length > 0 ? (
          <ScrollArea className="max-h-64 divide-y divide-border/70">
            {resources.map((resource, index) => (
              <CompactRelatedResourceRow
                key={`${resource.type}-${resource.namespace || ''}-${resource.name}-${index}`}
                resource={resource}
              />
            ))}
          </ScrollArea>
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
  const [searchParams] = useSearchParams()
  const metadata = getResourceMetadata(resource.type)
  const Icon = metadata?.icon ? resourceIconMap[metadata.icon] : IconBox
  const path = useMemo(() => getRelatedResourcePath(resource), [resource])
  const isIframe = searchParams.get('iframe') === 'true'
  const rowContent = (
    <>
      <span className="inline-flex min-w-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">
          {metadata?.shortLabel || metadata?.singularLabel || resource.type}
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

  if (isIframe) {
    return (
      <Link
        to={`${path}?iframe=true`}
        className="grid w-full min-w-0 cursor-pointer grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40"
      >
        {rowContent}
      </Link>
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
      <DialogContent className="!h-[calc(100dvh-1rem)] !max-w-[calc(100vw-1rem)] flex min-h-0 flex-col gap-0 p-0 md:!h-[80%] md:!max-w-[80%]">
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
  const metadata = getResourceMetadata(resource.type)

  if (isStandardK8sResource(resource.type)) {
    return getResourceDetailPath(
      metadata?.type || resource.type,
      resource.name,
      resource.namespace
    )
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
        <CardTitle className="text-balance text-sm">
          {t('common.fields.ports')} ({ports.length})
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

export function MetadataListCard({
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
          <ScrollArea className="max-h-72 divide-y">
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
          </ScrollArea>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {t('common.values.none')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function CompactEventsCard({
  events,
  isLoading,
}: {
  events: KubernetesEvent[]
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const sortedEvents = useMemo(() => {
    return events.slice().sort((a, b) => {
      const timeDiff = getEventTime(a).getTime() - getEventTime(b).getTime()
      if (timeDiff !== 0) {
        return timeDiff
      }
      return (
        Number(a.metadata?.resourceVersion || 0) -
        Number(b.metadata?.resourceVersion || 0)
      )
    })
  }, [events])

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('events.title')} ({sortedEvents.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {t('events.loading')}
          </div>
        ) : sortedEvents.length > 0 ? (
          <ScrollArea className="max-h-56 font-mono text-xs">
            <div className="sticky top-0 grid grid-cols-[3.75rem_4.25rem_2.25rem_5rem_minmax(0,1fr)] gap-x-0.5 border-b border-border/70 bg-card px-2 py-1.5 font-medium text-muted-foreground">
              <span>{t('common.fields.type')}</span>
              <span>{t('common.fields.reason')}</span>
              <span>{t('common.fields.age')}</span>
              <span>{t('common.fields.from', { defaultValue: 'From' })}</span>
              <span className="min-w-0">{t('common.fields.message')}</span>
            </div>
            {sortedEvents.map((event, index) => (
              <div
                key={`${event.reason}-${event.message}-${index}`}
                className="grid grid-cols-[3.75rem_4.25rem_2.25rem_5rem_minmax(0,1fr)] items-start gap-x-0.5 border-b border-border/70 px-2 py-2 last:border-b-0"
              >
                <span
                  className={cn(
                    'font-medium',
                    getEventTypeClassName(event.type)
                  )}
                >
                  {formatEventType(event.type, t)}
                </span>
                <span className="min-w-0 break-words font-medium">
                  {event.reason || '-'}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEventAge(event)}
                </span>
                <span className="min-w-0 break-words text-muted-foreground">
                  {getEventSource(event)}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words leading-snug text-pretty text-muted-foreground">
                  {event.message || '-'}
                </span>
              </div>
            ))}
          </ScrollArea>
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
  return t(`status.${key}`, { defaultValue: type })
}

function formatEventAge(event: KubernetesEvent) {
  const eventTime = getEventTime(event)
  if (eventTime.getTime() <= 0) {
    return '-'
  }

  const age = getAge(eventTime.toISOString())
  if (event.count && event.count > 1 && event.firstTimestamp) {
    return `${age} (x${event.count} over ${getAge(event.firstTimestamp)})`
  }
  return age
}

function getEventSource(event: KubernetesEvent) {
  return (
    event.reportingComponent ||
    event.source?.component ||
    event.reportingInstance ||
    '-'
  )
}

function getEventTypeClassName(type?: string) {
  if (type === 'Normal') {
    return 'text-emerald-600'
  }
  if (type === 'Warning') {
    return 'text-yellow-600'
  }
  return 'text-destructive'
}
