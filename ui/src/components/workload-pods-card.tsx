import { useState, type ReactNode } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import { Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { getPodStatus } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { cn, formatDate, getAge } from '@/lib/utils'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type TranslationFn = ReturnType<typeof useTranslation>['t']

export function WorkloadPodsCard({
  title,
  pods,
  isLoading,
  loadingText,
  emptyText,
  ageLabel,
}: {
  title: ReactNode
  pods: Pod[]
  isLoading: boolean
  loadingText: ReactNode
  emptyText: ReactNode
  ageLabel: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {title} ({pods.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-96 px-0">
        <ScrollArea className="max-h-96">
          <Table className="w-full min-w-[820px] table-fixed">
            <colgroup>
              <col />
              <col className="w-44" />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-32" />
              <col className="w-20" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="h-8 px-4">{t('nav.pods')}</TableHead>
                <TableHead className="h-8 px-1 text-center">
                  {t('common.fields.status')}
                </TableHead>
                <TableHead className="h-8 px-1 text-center">
                  {t('common.fields.ready')}
                </TableHead>
                <TableHead className="h-8 px-1 text-center">
                  {t('common.fields.restart')}
                </TableHead>
                <TableHead className="h-8 px-1 text-center">
                  {t('common.fields.node')}
                </TableHead>
                <TableHead className="h-8 px-1 text-center">
                  {ageLabel}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="px-4 py-3 text-center text-muted-foreground"
                  >
                    {loadingText}
                  </TableCell>
                </TableRow>
              ) : pods.length > 0 ? (
                pods.map((pod) => (
                  <WorkloadPodRow
                    key={pod.metadata?.uid || pod.metadata?.name}
                    pod={pod}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="px-4 py-3 text-center text-muted-foreground"
                  >
                    {emptyText}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function WorkloadPodRow({ pod }: { pod: Pod }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const podStatus = getPodStatus(pod)
  const podName = pod.metadata?.name || '-'
  const namespace = pod.metadata?.namespace
  const path =
    namespace && pod.metadata?.name
      ? `/pods/${namespace}/${pod.metadata.name}`
      : undefined
  const age = pod.metadata?.creationTimestamp
    ? getAge(pod.metadata.creationTimestamp)
    : '-'
  const isIframe = searchParams.get('iframe') === 'true'

  return (
    <TableRow>
      <TableCell className="px-4 py-1.5">
        <div className="min-w-0 leading-tight">
          {path ? (
            isIframe ? (
              <Link
                to={`${path}?iframe=true`}
                className="app-link block max-w-full cursor-pointer truncate text-left font-mono"
                title={podName}
              >
                {podName}
              </Link>
            ) : (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="app-link block max-w-full cursor-pointer truncate text-left font-mono"
                    title={podName}
                  >
                    {podName}
                  </button>
                </DialogTrigger>
                <DialogContent className="!h-[calc(100dvh-1rem)] !max-w-[calc(100vw-1rem)] flex min-h-0 flex-col gap-0 p-0 md:!h-[80%] md:!max-w-[60%]">
                  <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3 pr-14">
                    <DialogTitle>Pod</DialogTitle>
                    <a
                      href={withSubPath(path)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
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
          ) : (
            <span className="block max-w-full truncate font-mono">
              {podName}
            </span>
          )}
          <div
            className="truncate text-xs text-muted-foreground"
            title={pod.status?.podIP || '-'}
          >
            {pod.status?.podIP || '-'}
          </div>
        </div>
      </TableCell>
      <TableCell className="px-1 py-1.5 text-center">
        <span className="inline-flex max-w-full items-center justify-center gap-2">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              getPodStatusDotClassName(podStatus.reason)
            )}
          />
          <span className="truncate">
            {formatPodStatus(podStatus.reason, t)}
          </span>
        </span>
      </TableCell>
      <TableCell className="px-1 py-1.5 text-center tabular-nums">
        {podStatus.readyContainers}/{podStatus.totalContainers}
      </TableCell>
      <TableCell className="px-1 py-1.5 text-center tabular-nums">
        {podStatus.restartString}
      </TableCell>
      <TableCell className="px-1 py-1.5">
        <div className="flex min-w-0 justify-center text-center">
          {pod.spec?.nodeName ? (
            <Link
              to={`/nodes/${pod.spec.nodeName}`}
              className="app-link block max-w-full truncate"
              title={pod.spec.nodeName}
            >
              {pod.spec.nodeName}
            </Link>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      </TableCell>
      <TableCell
        className="px-1 py-1.5 text-center text-muted-foreground tabular-nums"
        title={
          pod.metadata?.creationTimestamp
            ? formatDate(pod.metadata.creationTimestamp, true)
            : undefined
        }
      >
        {age}
      </TableCell>
    </TableRow>
  )
}

function formatPodStatus(value: string, t: TranslationFn) {
  const key = value.charAt(0).toLowerCase() + value.slice(1)
  return t(`status.${key}`, { defaultValue: value })
}

function getPodStatusDotClassName(status: string) {
  if (
    status === 'Running' ||
    status === 'Succeeded' ||
    status === 'Completed'
  ) {
    return 'bg-emerald-500'
  }
  if (status === 'Pending' || status === 'Unknown') {
    return 'bg-yellow-500'
  }
  return 'bg-destructive'
}
