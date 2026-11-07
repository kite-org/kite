import { useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'

import { useOverview, useResourceUsageHistory } from '@/lib/api'
import NetworkUsageChart from '@/components/chart/network-usage-chart'
import ResourceUtilizationChart from '@/components/chart/resource-utilization'
import { ClusterStatsCards } from '@/components/cluster-stats-cards'
import { RecentEvents } from '@/components/recent-events'
import { ResourceCharts } from '@/components/resources-charts'
import { SettingsHint } from '@/components/settings-hint'

export function Overview() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [isDismissed] = useState(() => {
    const dismissed = localStorage.getItem('settings-hint-dismissed')
    if (dismissed === 'true') {
      return true
    }
    return false
  })

  const [timeRange] = useState('30m')
  const { data: overview, isLoading, error, isError } = useOverview()

  const {
    data: resourceUsage,
    isLoading: isLoadingResourceUsage,
    error: errorResourceUsage,
  } = useResourceUsageHistory(timeRange, {
    enabled: overview?.prometheusEnabled ?? false,
  })

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <h2 className="text-lg font-semibold">{t('overview.failedToLoad')}</h2>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t('overview.unknownError')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('overview.title')}</h1>
      </div>

      <ClusterStatsCards stats={overview} isLoading={isLoading} />
      {!isDismissed &&
        user?.provider !== 'Anonymous' &&
        user?.roles?.some((role) => role.name === 'admin') && <SettingsHint />}

      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
        <ResourceCharts
          data={overview?.resource}
          isLoading={isLoading}
          error={error}
          isError={isError}
        />
        <RecentEvents />
      </div>

      {overview?.prometheusEnabled && (
        <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
          <ResourceUtilizationChart
            cpu={resourceUsage?.cpu || []}
            memory={resourceUsage?.memory || []}
            isLoading={isLoadingResourceUsage}
            error={errorResourceUsage}
          />

          <NetworkUsageChart
            networkIn={resourceUsage?.networkIn || []}
            networkOut={resourceUsage?.networkOut || []}
            isLoading={isLoadingResourceUsage}
            error={errorResourceUsage}
          />
        </div>
      )}
    </div>
  )
}
