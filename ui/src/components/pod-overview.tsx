import { useMemo, useState, type ReactNode } from 'react'
import { Event as KubernetesEvent, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import {
  getEventTime,
  getOwnerInfo,
  getPodErrorMessage,
  getPodStatus,
} from '@/lib/k8s'
import { cn, formatDate, getAge } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PodStatusIcon } from '@/components/pod-status-icon'

import { ContainerDetailDialog } from './pod-container-detail-dialog'
import {
  PodContainersCard,
  type PodContainerAction,
} from './pod-container-matrix'
import { PodOverviewSidebar } from './pod-overview-sidebar'
import type { PodOverviewContainer } from './pod-overview-types'

type TranslationFn = ReturnType<typeof useTranslation>['t']

type PodOverviewProps = {
  pod: Pod
  namespace: string
  name: string
  events?: KubernetesEvent[]
  isEventsLoading: boolean
}

export function PodOverview({
  pod,
  namespace,
  name,
  events,
  isEventsLoading,
}: PodOverviewProps) {
  const podStatus = useMemo(() => getPodStatus(pod), [pod])
  const podErrorMessage = useMemo(() => getPodErrorMessage(pod), [pod])
  const containers = useMemo<PodOverviewContainer[]>(() => {
    return [
      ...(pod.spec?.initContainers || []).map((container) => ({
        container,
        init: true,
        status: pod.status?.initContainerStatuses?.find(
          (item) => item.name === container.name
        ),
      })),
      ...(pod.spec?.containers || []).map((container) => ({
        container,
        init: false,
        status: pod.status?.containerStatuses?.find(
          (item) => item.name === container.name
        ),
      })),
    ]
  }, [pod])

  const sortedEvents = useMemo(() => {
    return (events || []).slice().sort((a, b) => {
      const timeDiff = getEventTime(b).getTime() - getEventTime(a).getTime()
      if (timeDiff !== 0) {
        return timeDiff
      }
      return (
        Number(b.metadata?.resourceVersion || 0) -
        Number(a.metadata?.resourceVersion || 0)
      )
    })
  }, [events])
  const [selectedContainer, setSelectedContainer] =
    useState<PodOverviewContainer | null>(null)
  const [, setSearchParams] = useSearchParams()

  const handleContainerSelect = (
    item: PodOverviewContainer,
    action: PodContainerAction = 'details'
  ) => {
    if (action === 'logs' || action === 'terminal') {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev)
          nextParams.set('tab', action)
          nextParams.set('container', item.container.name)
          return nextParams
        },
        { replace: true }
      )
      setSelectedContainer(null)
      return
    }

    setSelectedContainer(item)
  }

  return (
    <div className="space-y-3">
      <PodSummaryGrid pod={pod} podStatus={podStatus} />

      {podErrorMessage ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-pretty text-destructive shadow-none">
          {podErrorMessage}
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <PodContainersCard
            containers={containers}
            namespace={namespace}
            podName={name}
            onContainerSelect={handleContainerSelect}
          />
          <PodInformationCard pod={pod} />
        </div>

        <PodOverviewSidebar
          pod={pod}
          namespace={namespace}
          name={name}
          events={sortedEvents}
          isEventsLoading={isEventsLoading}
        />
      </div>
      <ContainerDetailDialog
        item={selectedContainer}
        open={!!selectedContainer}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedContainer(null)
          }
        }}
      />
    </div>
  )
}

function PodSummaryGrid({
  pod,
  podStatus,
}: {
  pod: Pod
  podStatus: ReturnType<typeof getPodStatus>
}) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <PodSummaryCard
        label={t('common.fields.status')}
        value={
          <span className="inline-flex min-w-0 items-center gap-2">
            <PodStatusIcon
              status={podStatus.reason}
              className="size-4 shrink-0"
            />
            <span className="truncate">
              {formatStatusLabel(podStatus.reason, t)}
            </span>
          </span>
        }
        detail={
          pod.status?.phase
            ? formatStatusLabel(pod.status.phase, t)
            : t('status.unknown')
        }
      />
      <PodSummaryCard
        label={t('common.fields.ready')}
        value={`${podStatus.readyContainers}/${podStatus.totalContainers}`}
        detail={t('common.fields.containers')}
      />
      <PodSummaryCard
        label={t('common.fields.restartCount')}
        value={podStatus.restartString}
        detail={t('common.fields.allContainers')}
      />
      <PodSummaryCard
        label={t('common.fields.node')}
        value={
          pod.spec?.nodeName ? (
            <Link
              to={`/nodes/${pod.spec.nodeName}`}
              className="app-link inline-block max-w-full truncate"
            >
              {pod.spec.nodeName}
            </Link>
          ) : (
            '-'
          )
        }
        detail={pod.status?.hostIP || '-'}
      />
      <PodSummaryCard
        label="IP"
        value={pod.status?.podIP || '-'}
        detail={t('common.fields.podIP')}
        mono
      />
      <PodSummaryCard
        label={t('common.fields.created')}
        value={
          pod.metadata?.creationTimestamp
            ? t('common.messages.timeAgo', {
                time: getAge(pod.metadata.creationTimestamp),
              })
            : '-'
        }
        detail={
          pod.metadata?.creationTimestamp
            ? formatDate(pod.metadata.creationTimestamp)
            : t('common.messages.notCreated')
        }
      />
    </div>
  )
}

function PodInformationCard({ pod }: { pod: Pod }) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const ownerInfo = getOwnerInfo(pod.metadata)
  const uid = pod.metadata?.uid
  const priorityClass =
    pod.spec?.priorityClassName || pod.spec?.priority?.toString()
  const nodeSelectorEntries = Object.entries(pod.spec?.nodeSelector || {})
  const nodeSelectorSummary = nodeSelectorEntries
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
  const schedulerName = pod.spec?.schedulerName
  const volumeTabSearchParams = new URLSearchParams(searchParams)
  volumeTabSearchParams.set('tab', 'volumes')
  const volumeTabSearch = `?${volumeTabSearchParams.toString()}`

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('common.fields.information')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <PodInfoBlock
              label={t('common.fields.owner')}
              truncate={!!ownerInfo}
            >
              {ownerInfo ? (
                <Link
                  to={ownerInfo.path}
                  className="app-link inline-block max-w-full truncate"
                >
                  {ownerInfo.kind}/{ownerInfo.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">
                  {t('common.values.none')}
                </span>
              )}
            </PodInfoBlock>
            <PodInfoBlock label={t('common.fields.started')}>
              {pod.status?.startTime
                ? formatDate(pod.status.startTime, true)
                : t('common.messages.notStarted')}
            </PodInfoBlock>
          </div>

          <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
            <PodInfoRow label={t('common.fields.serviceAccount')} mono>
              {pod.spec?.serviceAccountName || '-'}
            </PodInfoRow>
            <PodInfoRow label={t('pods.qosClass')}>
              {pod.status?.qosClass || '-'}
            </PodInfoRow>
            <PodInfoRow label={t('pods.restartPolicy')}>
              {pod.spec?.restartPolicy || '-'}
            </PodInfoRow>
            <PodInfoRow label={t('pods.priorityClass')} mono>
              {priorityClass || '-'}
            </PodInfoRow>
            <PodInfoRow label={t('pods.dnsPolicy')}>
              {pod.spec?.dnsPolicy || '-'}
            </PodInfoRow>
            <PodInfoRow label={t('pods.hostNetwork')}>
              {pod.spec?.hostNetwork
                ? t('common.values.yes')
                : t('common.values.no')}
            </PodInfoRow>
            <PodInfoRow label={t('pods.terminationGrace')}>
              {pod.spec?.terminationGracePeriodSeconds !== undefined
                ? `${pod.spec.terminationGracePeriodSeconds}s`
                : '-'}
            </PodInfoRow>
            <PodInfoRow label={t('common.fields.volumes')}>
              <Link to={volumeTabSearch} className="app-link">
                {pod.spec?.volumes?.length ?? 0}
              </Link>
            </PodInfoRow>
            {pod.spec?.runtimeClassName ? (
              <PodInfoRow label={t('pods.runtimeClass')} mono>
                {pod.spec.runtimeClassName}
              </PodInfoRow>
            ) : null}
            {schedulerName && schedulerName !== 'default-scheduler' ? (
              <PodInfoRow label={t('pods.scheduler')} mono>
                {schedulerName}
              </PodInfoRow>
            ) : null}
            {nodeSelectorEntries.length > 0 ? (
              <PodInfoRow label={t('pods.nodeSelector')} mono>
                {nodeSelectorSummary}
              </PodInfoRow>
            ) : null}
          </div>

          <div className="border-t border-border/60 pt-2">
            <PodInfoRow label="UID" mono truncate={false} compact>
              <span className="break-all">{uid || '-'}</span>
            </PodInfoRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PodSummaryCard({
  label,
  value,
  detail,
  mono,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  mono?: boolean
}) {
  return (
    <Card className="gap-0 rounded-lg border-border/70 py-0 shadow-none">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={cn(
            'mt-2 min-w-0 truncate text-lg font-semibold tabular-nums',
            mono && 'font-mono'
          )}
          title={typeof value === 'string' ? value : undefined}
        >
          {value}
        </div>
        {detail ? (
          <div
            className="mt-1 truncate text-xs text-muted-foreground"
            title={typeof detail === 'string' ? detail : undefined}
          >
            {detail}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PodInfoBlock({
  label,
  children,
  mono,
  truncate = true,
}: {
  label: string
  children: ReactNode
  mono?: boolean
  truncate?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 min-w-0 text-sm text-foreground/70 tabular-nums',
          mono && 'font-mono',
          truncate && 'truncate'
        )}
      >
        {children}
      </div>
    </div>
  )
}

function PodInfoRow({
  label,
  children,
  mono,
  compact,
  truncate = true,
}: {
  label: string
  children: ReactNode
  mono?: boolean
  compact?: boolean
  truncate?: boolean
}) {
  return (
    <div
      className={cn(
        'grid min-w-0 items-baseline gap-3 text-sm',
        compact
          ? 'grid-cols-[3rem_minmax(0,1fr)]'
          : 'grid-cols-[8.5rem_minmax(0,1fr)]'
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 text-foreground/70 tabular-nums',
          mono && 'font-mono',
          truncate && 'truncate'
        )}
      >
        {children}
      </span>
    </div>
  )
}

function formatStatusLabel(value: string, t: TranslationFn) {
  const key = value.charAt(0).toLowerCase() + value.slice(1)
  return t(`status.${key}`, { defaultValue: value })
}
