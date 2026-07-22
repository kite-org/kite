'use client'

import React from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { UsageDataPoint } from '@/types/api'
import { formatChartXTicks } from '@/lib/utils'

import { Alert, AlertDescription } from '../ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '../ui/chart'
import { Skeleton } from '../ui/skeleton'

interface ResourceUtilizationChartProps {
  cpu: UsageDataPoint[]
  memory: UsageDataPoint[]
  isLoading?: boolean
  error?: Error | null
}

const ResourceUtilizationChart = React.memo(
  (prop: ResourceUtilizationChartProps) => {
    const { t } = useTranslation()
    const { cpu, memory, isLoading, error } = prop
    const chartConfig = {
      usage: {
        label: t('monitoring.usage'),
      },
      cpu: {
        label: t('common.fields.cpu'),
        color: 'hsl(220, 70%, 50%)',
      },
      memory: {
        label: t('common.fields.memory'),
        color: 'hsl(142, 70%, 50%)',
      },
    } satisfies ChartConfig
    const chartData = React.useMemo(() => {
      if (!cpu || !memory) return []

      // Combine CPU and Memory data by timestamp
      const combinedData = new Map()

      // Add CPU data
      cpu.forEach((point) => {
        const timestamp = new Date(point.timestamp).getTime()
        combinedData.set(timestamp, {
          timestamp: point.timestamp,
          time: timestamp,
          cpu: point.value,
        })
      })

      // Add Memory data
      memory.forEach((point) => {
        const timestamp = new Date(point.timestamp).getTime()
        const existing = combinedData.get(timestamp) || {
          timestamp: point.timestamp,
          time: timestamp,
        }
        existing.memory = point.value
        combinedData.set(timestamp, existing)
      })

      // Convert to array and sort by timestamp
      return Array.from(combinedData.values()).sort((a, b) => a.time - b.time)
    }, [cpu, memory])

    // Show loading skeleton
    if (isLoading) {
      return (
        <Card className="@container/card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('monitoring.resourceUtilization')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            <div className="space-y-3">
              <Skeleton className="h-[250px] w-full" />
            </div>
          </CardContent>
        </Card>
      )
    }

    // Show error state
    if (error) {
      return (
        <Card className="@container/card">
          <CardHeader>
            <CardTitle>{t('monitoring.resourceUtilization')}</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )
    }

    // Show empty state
    if (!cpu || !memory || (cpu.length === 0 && memory.length === 0)) {
      return (
        <Card className="@container/card">
          <CardHeader>
            <CardTitle>{t('monitoring.resourceUtilization')}</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            <div className="flex h-[250px] w-full items-center justify-center text-muted-foreground">
              <p>{t('monitoring.noResourceUtilizationData')}</p>
            </div>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t('monitoring.resourceUtilization')}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="fillCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-cpu)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-cpu)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id="fillMemory" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-memory)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-memory)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return date.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                domain={[
                  (dataMin: number) => Math.min(0, dataMin),
                  (dataMax: number) => Math.max(100, dataMax),
                ]}
                tickFormatter={(value) => `${value}%`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(value) => formatChartXTicks(value, false)}
                  />
                }
              />
              <Area
                dataKey="cpu"
                type="monotone"
                fill="url(#fillCpu)"
                stroke="var(--color-cpu)"
                strokeWidth={2}
              />
              <Area
                dataKey="memory"
                type="monotone"
                fill="url(#fillMemory)"
                stroke="var(--color-memory)"
                strokeWidth={2}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    )
  }
)

export default ResourceUtilizationChart
