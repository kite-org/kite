import { useCallback, useMemo } from 'react'

import { MetricsData } from '@/types/api'
import { formatMemory } from '@/lib/utils'

import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export function MetricCell({
  metrics,
  type,
  limitLabel = 'Limit',
  showPercentage = false,
}: {
  metrics?: MetricsData
  type: 'cpu' | 'memory'
  limitLabel?: string // e.g., "Limit" or "Capacity"
  showPercentage?: boolean // Whether to show percentage in the display
}) {
  const metricValue =
    type === 'cpu' ? metrics?.cpuUsage || 0 : metrics?.memoryUsage || 0

  const metricLimit = type === 'cpu' ? metrics?.cpuLimit : metrics?.memoryLimit

  const metricRequest =
    type === 'cpu' ? metrics?.cpuRequest : metrics?.memoryRequest

  const formatValue = useCallback(
    (val?: number) => {
      if (val === undefined || val === null) return '-'
      return type === 'cpu' ? `${val}m` : formatMemory(val)
    },
    [type]
  )

  return useMemo(() => {
    const percentage = metricLimit
      ? Math.min((metricValue / metricLimit) * 100, 100)
      : 0

    const requestPercentage =
      metricRequest && metricLimit
        ? Math.min((metricRequest / metricLimit) * 100, 100)
        : 0

    const getProgressColor = () => {
      if (percentage > 90) return 'bg-red-500'
      if (percentage > 60) return 'bg-yellow-500'
      return 'bg-blue-500'
    }

    return (
      <div className="flex items-center justify-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-14 h-2 relative">
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${getProgressColor()}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              {metricRequest && metricLimit && (
                <div
                  className="absolute -top-0.5 h-3 flex items-center justify-center"
                  style={{
                    left: `${requestPercentage}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="w-0.5 h-3 bg-muted-foreground dark:bg-gray-400 rounded-sm shadow-sm"></div>
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-sm grid grid-cols-2 gap-x-3 gap-y-0.5 min-w-0">
              <span>Usage:</span>
              <span className="text-right">{formatValue(metricValue)}</span>
              <span>Request:</span>
              <span className="text-right">{formatValue(metricRequest)}</span>
              <span>{limitLabel}:</span>
              <span className="text-right">{formatValue(metricLimit)}</span>
            </div>
          </TooltipContent>
        </Tooltip>
        <span
          className={`${type === 'cpu' ? 'min-w-[4ch]' : 'min-w-[10ch]'} text-right inline-block text-xs text-muted-foreground whitespace-nowrap tabular-nums`}
        >
          {formatValue(metricValue)}
          {metricLimit && (
            <>
              <span className="opacity-30 mx-1">/</span>
              <span className="opacity-70">{formatValue(metricLimit)}</span>
            </>
          )}
          {showPercentage && metricLimit && metricValue > 0 && (
            <span className="hidden xl:inline text-[10px] opacity-50 ml-1">
              ({percentage.toFixed(0)}%)
            </span>
          )}
        </span>
      </div>
    )
  }, [
    metricLimit,
    metricValue,
    metricRequest,
    formatValue,
    limitLabel,
    type,
    showPercentage,
  ])
}
