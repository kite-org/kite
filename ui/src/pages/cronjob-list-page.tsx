import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { CronJob } from 'kubernetes-types/batch/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

function getSuspendBadge(cronjob: CronJob) {
  const isSuspended = cronjob.spec?.suspend ?? false
  return {
    label: isSuspended ? 'Suspended' : 'Active',
    variant: isSuspended ? ('secondary' as const) : ('default' as const),
  }
}

const cronJobSearchFilter = createSearchFilter<CronJob>(
  (cj) => cj.metadata?.name,
  (cj) => cj.metadata?.namespace
)

export function CronJobListPage() {
  const { t } = useTranslation()
  const columnHelper = createColumnHelper<CronJob>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/cronjobs/${row.original.metadata!.namespace}/${
                row.original.metadata!.name
              }`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.display({
        id: 'schedule',
        header: 'Schedule',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.spec?.schedule || '-'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'suspend',
        header: 'State',
        cell: ({ row }) => {
          const badge = getSuspendBadge(row.original)
          return <Badge variant={badge.variant}>{badge.label}</Badge>
        },
      }),
      columnHelper.display({
        id: 'active',
        header: 'Active Jobs',
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.status?.active?.length || 0}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'lastSchedule',
        header: 'Last Schedule',
        cell: ({ row }) => {
          const lastSchedule = row.original.status?.lastScheduleTime
          if (!lastSchedule) {
            return <span className="text-sm text-muted-foreground">-</span>
          }
          return (
            <span className="text-sm text-muted-foreground">
              {formatDate(lastSchedule)}
            </span>
          )
        },
      }),
      columnHelper.display({
        id: 'lastSuccess',
        header: 'Last Success',
        cell: ({ row }) => {
          const lastSuccess = row.original.status?.lastSuccessfulTime
          if (!lastSuccess) {
            return <span className="text-sm text-muted-foreground">-</span>
          }
          return (
            <span className="text-sm text-muted-foreground">
              {formatDate(lastSuccess)}
            </span>
          )
        },
      }),
    ],
    [columnHelper, t]
  )

  return (
    <ResourceTable
      resourceName="CronJobs"
      resourceType="cronjobs"
      columns={columns}
      searchQueryFilter={cronJobSearchFilter}
    />
  )
}
