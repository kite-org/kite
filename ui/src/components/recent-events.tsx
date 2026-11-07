import { useMemo } from 'react'
import { IconAlertTriangle, IconInfoCircle, IconX } from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { useResources } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function RecentEvents() {
  const { t } = useTranslation()
  const { data, isLoading } = useResources('events', undefined, {
    limit: 20,
  })

  const events = useMemo(() => {
    return data?.slice().sort((a, b) => {
      const dateA = new Date(
        a.metadata.creationTimestamp || a.firstTimestamp || ''
      )
      const dateB = new Date(
        b.metadata.creationTimestamp || b.firstTimestamp || ''
      )
      return dateB.getTime() - dateA.getTime() // Sort by most recent first
    })
  }, [data])
  const getEventIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'warning':
        return <IconAlertTriangle className="size-4 text-yellow-600" />
      case 'error':
        return <IconX className="size-4 text-red-600" />
      default:
        return <IconInfoCircle className="size-4 text-blue-600" />
    }
  }

  const getEventBadgeVariant = (type: string) => {
    switch (type.toLowerCase()) {
      case 'warning':
        return 'outline' as const
      case 'error':
        return 'destructive' as const
      default:
        return 'secondary' as const
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="animate-pulse">
          <div className="h-6  bg-muted rounded w-1/3 mb-2"></div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 scrollbar-hide overflow-auto">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-4 h-4  bg-muted rounded-full mt-1"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4  bg-muted rounded w-3/4"></div>
                  <div className="h-3  bg-muted rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!events || events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('overview.recentEvents')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            No recent events
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overview.recentEvents')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto scrollbar-hide">
          <div className="divide-y divide-border">
            {events.map((event, index) => (
              <div
                key={index}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="mt-1">{getEventIcon(event.type ?? '')}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words text-sm font-normal">
                        {event.reason}
                      </span>
                      <Badge
                        variant={getEventBadgeVariant(event.type ?? '')}
                        className={cn(
                          'font-normal',
                          event.type?.toLowerCase() === 'warning' &&
                            'border-yellow-600/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                        )}
                      >
                        {event.type ?? ''}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(
                        new Date(
                          event.metadata.creationTimestamp ||
                            event.firstTimestamp ||
                            ''
                        ),
                        {
                          addSuffix: true,
                        }
                      )}
                    </div>
                  </div>
                  <p className="mt-1 break-words text-pretty text-sm text-muted-foreground">
                    {event.message}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {event.involvedObject.kind}:{' '}
                      {event.involvedObject.namespace ? (
                        <>{event.involvedObject.namespace}/</>
                      ) : null}
                      {event.involvedObject.name}
                    </span>
                    {event.reportingComponent && (
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        Reporter: {event.reportingComponent}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
