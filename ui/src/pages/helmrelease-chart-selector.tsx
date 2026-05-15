import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { HelmReleaseChartSelection } from './helmrelease-chart-selection'

export function HelmReleaseChartSelector({
  selection,
  disabled,
  label,
  detailVersion,
  className,
  onSelectedRepositoryChange,
}: {
  selection: HelmReleaseChartSelection
  disabled: boolean
  label?: string
  detailVersion?: string
  className?: string
  onSelectedRepositoryChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const {
    chartName,
    chartCandidates,
    chartKey,
    chartOptionSourceLabel,
    activeChart,
    activeChartSource,
    activeRepository,
    isChartSourceLoading,
    chartLookupError,
    chartSourceLabel,
  } = selection
  const chartDetailSearchParams = new URLSearchParams()
  if (activeChartSource === 'artifacthub') {
    chartDetailSearchParams.set('source', 'artifacthub')
  }
  if (detailVersion) {
    chartDetailSearchParams.set('version', detailVersion)
  }
  const chartDetailSearch = chartDetailSearchParams.toString()
  const chartDetailPath = activeChart
    ? `/charts/${encodeURIComponent(activeRepository)}/${encodeURIComponent(activeChart.name)}${chartDetailSearch ? `?${chartDetailSearch}` : ''}`
    : ''

  return (
    <div className={cn('grid gap-2', className)}>
      <Label>{label || t('helm.fields.chart')}</Label>
      {isChartSourceLoading && chartCandidates.length === 0 ? (
        <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="truncate">
            {t('helm.messages.loadingChart', {
              defaultValue: 'Loading chart...',
            })}
          </span>
        </div>
      ) : chartCandidates.length > 1 ? (
        <Select
          value={activeChart ? chartKey(activeChart) : ''}
          onValueChange={onSelectedRepositoryChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={t('helm.placeholders.selectChart', {
                defaultValue: 'Select a chart...',
              })}
            />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {chartCandidates.map((chart) => (
              <SelectItem key={chartKey(chart)} value={chartKey(chart)}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">
                    {chart.repositoryName}/{chart.name}
                  </span>
                  <Badge
                    variant="outline"
                    className="ml-auto px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                  >
                    {chartOptionSourceLabel(chart)}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex h-9 min-w-0 items-center rounded-md border bg-muted/30 px-3 text-sm">
          <span className="truncate">
            {activeChart
              ? `${activeChart.repositoryName}/${activeChart.name}`
              : chartName || '-'}
          </span>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {isChartSourceLoading ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            {t('helm.messages.loadingChart', {
              defaultValue: 'Loading chart...',
            })}
          </span>
        ) : (
          <>
            <span>{chartSourceLabel}</span>
            {chartDetailPath ? (
              <Link
                to={chartDetailPath}
                target="_blank"
                rel="noopener noreferrer"
                className="app-link whitespace-nowrap"
              >
                {t('helm.messages.chartDetailsLink', {
                  defaultValue: 'Chart details',
                })}
              </Link>
            ) : null}
          </>
        )}
      </p>
      {chartLookupError ? (
        <p className="text-sm text-muted-foreground">{chartLookupError}</p>
      ) : null}
    </div>
  )
}
