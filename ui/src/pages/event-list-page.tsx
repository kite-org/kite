import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Event } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const eventSearchFilter = createSearchFilter<Event>(
  (e) => e.metadata?.name,
  (e) => e.reason,
  (e) => e.message,
  (e) => e.type,
  (e) => e.involvedObject?.name,
  (e) => e.involvedObject?.kind
)

export function EventListPage() {
  const { t } = useTranslation()
  const columnHelper = createColumnHelper<Event>()

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (row) =>
          `${row.involvedObject?.kind || ''} ${row.involvedObject?.name || ''}`,
        {
          id: 'involvedObject',
          header: t('events.involvedObject', 'Involved Object'),
          enableColumnFilter: true,
          cell: ({ row }) => {
            const obj = row.original.involvedObject
            if (!obj) return '-'

            const kind = obj.kind || ''
            const name = obj.name || ''
            const namespace = obj.namespace

            const resourcePath = kind.toLowerCase() + 's'
            const link = namespace
              ? `/${resourcePath}/${namespace}/${name}`
              : `/${resourcePath}/${name}`

            return (
              <div className="flex flex-col gap-0.5">
                <div className="text-xs text-muted-foreground">{kind}</div>
                <Link to={link} className="font-medium app-link text-sm">
                  {name}
                </Link>
              </div>
            )
          },
        }
      ),
      columnHelper.accessor((row) => row.type, {
        id: 'type',
        header: t('events.type'),
        enableColumnFilter: true,
        cell: ({ getValue }) => {
          const type = getValue() || ''
          const variant = type === 'Normal' ? 'default' : 'destructive'
          return <Badge variant={variant}>{type}</Badge>
        },
      }),
      columnHelper.accessor((row) => row.reason, {
        id: 'reason',
        header: t('events.reason'),
        cell: ({ getValue }) => (
          <div className="font-medium">{getValue() || '-'}</div>
        ),
      }),
      columnHelper.accessor((row) => row.message, {
        id: 'message',
        header: t('events.message'),
        cell: ({ getValue }) => (
          <div className="text-sm max-w-md whitespace-pre-wrap break-words">
            {getValue() || '-'}
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.reportingComponent, {
        id: 'source',
        header: t('events.source'),
        cell: ({ getValue }) => (
          <div className="text-muted-foreground text-sm max-w-sm whitespace-pre-wrap break-words">
            {getValue() || '-'}
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.count, {
        id: 'count',
        header: t('events.count'),
        cell: ({ getValue }) => {
          const count = getValue() || 1
          return <span className="text-muted-foreground text-sm">{count}</span>
        },
      }),
      columnHelper.accessor(
        (row) =>
          row.lastTimestamp || row.eventTime || row.metadata?.creationTimestamp,
        {
          id: 'lastSeen',
          header: t('events.lastSeen'),
          cell: ({ getValue }) => {
            const dateStr = formatDate(getValue() || '')
            return (
              <span className="text-muted-foreground text-sm">{dateStr}</span>
            )
          },
        }
      ),
    ],
    [columnHelper, t]
  )

  return (
    <ResourceTable<Event>
      resourceName="Events"
      columns={columns}
      clusterScope={false}
      searchQueryFilter={eventSearchFilter}
    />
  )
}
