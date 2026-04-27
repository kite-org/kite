import { useMemo } from 'react'
import { IconLoader } from '@tabler/icons-react'
import { Event } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'

import { ResourceType } from '@/types/api'
import { useResourcesEvents } from '@/lib/api'
import { getEventTime } from '@/lib/k8s'
import { cn, getAge } from '@/lib/utils'

import { Column, SimpleTable } from './simple-table'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

export function EventTable(props: {
  resource: ResourceType
  name: string
  namespace?: string
}) {
  const { t } = useTranslation()
  const { data: events, isLoading } = useResourcesEvents(
    props.resource,
    props.name,
    props.namespace
  )
  const sortedEvents = useMemo(() => {
    return (events || []).slice().sort((a, b) => {
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

  // Event table columns
  const eventColumns = useMemo(
    (): Column<Event>[] => [
      {
        header: t('common.fields.type'),
        accessor: (event: Event) => event.type || '',
        cell: (value: unknown) => {
          const type = value as string
          return (
            <span
              className={cn(
                'font-mono text-sm font-medium',
                getEventTypeClassName(type)
              )}
            >
              {type || '-'}
            </span>
          )
        },
        align: 'left',
      },
      {
        header: t('common.fields.reason'),
        accessor: (event: Event) => event.reason || '',
        cell: (value: unknown) => (
          <div className="font-mono text-sm font-medium">
            {(value as string) || '-'}
          </div>
        ),
        align: 'left',
      },
      {
        header: t('common.fields.age'),
        accessor: (event: Event) => formatEventAge(event),
        cell: (value: unknown) => (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {value as string}
          </span>
        ),
        align: 'left',
      },
      {
        header: t('common.fields.from', { defaultValue: 'From' }),
        accessor: (event: Event) => getEventSource(event),
        cell: (value: unknown) => {
          return (
            <span className="block max-w-40 truncate font-mono text-sm text-muted-foreground">
              {value as string}
            </span>
          )
        },
        align: 'left',
      },
      {
        header: t('common.fields.message'),
        accessor: (event: Event) => event.message || '',
        cell: (value: unknown) => {
          return (
            <div className="max-w-2xl whitespace-pre-wrap break-words font-mono text-sm text-pretty">
              {(value as string) || '-'}
            </div>
          )
        },
        align: 'left',
      },
    ],
    [t]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <IconLoader className="animate-spin mr-2" />
        {t('common.messages.loading')}
      </div>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('events.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <SimpleTable
          data={sortedEvents}
          columns={eventColumns}
          emptyMessage={t('events.noEventsFound')}
        />
      </CardContent>
    </Card>
  )
}

function formatEventAge(event: Event) {
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

function getEventSource(event: Event) {
  return (
    event.reportingComponent ||
    event.source?.component ||
    event.reportingInstance ||
    '-'
  )
}

function getEventTypeClassName(type: string) {
  if (type === 'Normal') {
    return 'text-emerald-600'
  }
  if (type === 'Warning') {
    return 'text-yellow-600'
  }
  return 'text-destructive'
}
