import type { ReactNode } from 'react'
import { IconBulb, IconFileText, IconTerminal2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { usePodMetrics } from '@/lib/api'
import { getContainerState, getLastContainerState } from '@/lib/k8s'
import { cn, formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { PodOverviewContainer } from './pod-overview-types'

type TranslationFn = ReturnType<typeof useTranslation>['t']
export type PodContainerAction = 'details' | 'logs' | 'terminal'

export function PodContainersCard({
  containers,
  namespace,
  podName,
  onContainerSelect,
}: {
  containers: PodOverviewContainer[]
  namespace: string
  podName: string
  onContainerSelect: (
    item: PodOverviewContainer,
    action?: PodContainerAction
  ) => void
}) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('common.fields.containers')} ({containers.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table className="w-full min-w-full table-fixed">
          <colgroup>
            <col />
            <col className="w-36" />
            <col className="w-14" />
            <col className="w-32" />
            <col className="w-40" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">
                {t('common.fields.container')}
              </TableHead>
              <TableHead className="px-1 text-center">
                {t('common.fields.state')}
              </TableHead>
              <TableHead className="px-1 text-center">
                {t('common.fields.restart')}
              </TableHead>
              <TableHead className="px-1 text-center">
                {t('common.fields.cpu')}
              </TableHead>
              <TableHead className="px-1 text-center">
                {t('common.fields.memory')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {containers.length > 0 ? (
              containers.map((item) => (
                <PodOverviewContainerRow
                  key={`${item.init ? 'init' : 'container'}-${item.container.name}`}
                  item={item}
                  namespace={namespace}
                  podName={podName}
                  onContainerSelect={onContainerSelect}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="px-4 text-center text-muted-foreground"
                >
                  {t('pods.noContainersDefined')}
                </TableCell>
              </TableRow>
            )}
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="px-3 py-1.5 text-[11px] leading-none text-muted-foreground"
              >
                <span className="inline-flex items-center gap-1.5">
                  <IconBulb className="size-3 shrink-0" />
                  {t('pods.containerClickHint')}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function PodOverviewContainerRow({
  item,
  namespace,
  podName,
  onContainerSelect,
}: {
  item: PodOverviewContainer
  namespace: string
  podName: string
  onContainerSelect: (
    item: PodOverviewContainer,
    action?: PodContainerAction
  ) => void
}) {
  const { t } = useTranslation()
  const { container, init, status } = item
  const { data: metrics } = usePodMetrics(namespace, podName, '30m', {
    container: container.name,
  })
  const state = getContainerState(status)
  const lastState = getLastContainerState(status)
  const lastStateLabel = lastState
    ? t('pods.lastState', {
        state: formatStatusLabel(lastState, t),
      })
    : undefined
  const startedAt =
    status?.state?.running?.startedAt || status?.state?.terminated?.startedAt
  const startedLabel =
    typeof status?.started === 'boolean'
      ? status.started
        ? startedAt
          ? t('common.messages.startedAgo', {
              time: getAge(startedAt),
            })
          : t('common.messages.startedShort')
        : t('common.messages.notStarted')
      : undefined

  return (
    <TableRow className="group/container-row">
      <TableCell className="px-4">
        <div className="min-w-0 space-y-1">
          <div className="flex min-h-6 min-w-0 items-center gap-0.5">
            <Badge
              asChild
              variant="outline"
              className="min-w-0 max-w-full shrink justify-start truncate border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
            >
              <button
                type="button"
                title={t('pods.openContainerDetails', { name: container.name })}
                onClick={() => onContainerSelect(item)}
              >
                {container.name}
              </button>
            </Badge>
            <span className="hidden shrink-0 items-center gap-0 group-hover/container-row:inline-flex group-focus-within/container-row:inline-flex">
              <ContainerQuickAction
                label={`${t('common.tabs.logs')}: ${container.name}`}
                onClick={() => onContainerSelect(item, 'logs')}
              >
                <IconFileText className="size-3.5" />
              </ContainerQuickAction>
              <ContainerQuickAction
                label={`${t('common.tabs.terminal')}: ${container.name}`}
                onClick={() => onContainerSelect(item, 'terminal')}
              >
                <IconTerminal2 className="size-3.5" />
              </ContainerQuickAction>
            </span>
            {init ? (
              <Badge variant="secondary" className="text-xs">
                {container.restartPolicy === 'Always' ? 'Sidecar' : 'Init'}
              </Badge>
            ) : null}
          </div>
          <div
            className="w-full truncate font-mono text-xs text-muted-foreground"
            title={container.image || '-'}
          >
            {container.image || '-'}
          </div>
          {lastStateLabel ? (
            <div
              className="line-clamp-2 text-xs leading-snug text-pretty text-muted-foreground"
              title={lastStateLabel}
            >
              {lastStateLabel}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="px-1 text-center">
        <div className="flex min-w-0 flex-col items-center gap-1">
          <span className="inline-flex max-w-full items-center gap-2">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                getStatusDotClassName(state)
              )}
            />
            <span className="truncate">{formatStatusLabel(state, t)}</span>
          </span>
          {startedLabel ? (
            <span
              className="max-w-full truncate text-xs text-muted-foreground"
              title={startedAt ? formatDate(startedAt, true) : startedLabel}
            >
              {startedLabel}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="px-1 text-center tabular-nums">
        {status?.restartCount ?? 0}
      </TableCell>
      <TableCell className="px-1 text-center">
        <UsageSummary
          points={metrics?.cpu || []}
          value={formatCpuUsage(getLastMetricValue(metrics?.cpu))}
          limit={container.resources?.limits?.cpu}
          colorClassName="text-emerald-500"
        />
      </TableCell>
      <TableCell className="px-1 text-center">
        <UsageSummary
          points={metrics?.memory || []}
          value={formatMemoryUsage(getLastMetricValue(metrics?.memory))}
          limit={container.resources?.limits?.memory}
          colorClassName="text-sky-500"
        />
      </TableCell>
    </TableRow>
  )
}

function ContainerQuickAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function UsageSummary({
  points,
  value,
  limit,
  colorClassName,
}: {
  points: { timestamp: string; value: number }[]
  value: string
  limit?: string
  colorClassName: string
}) {
  const { t } = useTranslation()
  const hasUsage = value !== '-'
  const summary =
    hasUsage || limit
      ? `${hasUsage ? value : t('common.messages.noData')} / ${limit || '-'}`
      : t('common.messages.noData')

  return (
    <div className="mx-auto flex w-[82%] max-w-full flex-col items-center justify-center gap-0.5 tabular-nums">
      <div
        className="h-4 w-full min-w-0 truncate text-left text-xs font-medium leading-none text-muted-foreground"
        title={summary}
      >
        {summary}
      </div>
      <MiniSparkline points={points} className={colorClassName} />
    </div>
  )
}

function MiniSparkline({
  points,
  className,
}: {
  points: { timestamp: string; value: number }[]
  className?: string
}) {
  const values = points.slice(-24).map((point) => point.value)
  if (values.length < 2) {
    return <span className="h-4 w-full" />
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const linePoints = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = range === 0 ? 12 : 22 - ((value - min) / range) * 20
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const areaPoints = `0,24 ${linePoints} 100,24`

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={cn('h-3.5 w-full', className)}
    >
      <polygon points={areaPoints} fill="currentColor" opacity="0.08" />
      <polyline
        points={linePoints}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
        opacity="0.72"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function getStatusDotClassName(state: string) {
  if (state === 'Running' || state === 'Completed') {
    return 'bg-emerald-500'
  }
  if (state === 'Waiting' || state.startsWith('Init')) {
    return 'bg-yellow-500'
  }
  return 'bg-destructive'
}

function formatStatusLabel(value: string, t: TranslationFn) {
  const key = value.charAt(0).toLowerCase() + value.slice(1)
  return t(`status.${key}`, { defaultValue: value })
}

function getLastMetricValue(points?: { timestamp: string; value: number }[]) {
  if (!points || points.length === 0) {
    return undefined
  }
  return points[points.length - 1].value
}

function formatCpuUsage(value?: number) {
  if (value === undefined) {
    return '-'
  }
  return `${Math.round(value * 1000)}m`
}

function formatMemoryUsage(value?: number) {
  if (value === undefined) {
    return '-'
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)}Gi`
  }
  return `${Math.round(value)}Mi`
}
