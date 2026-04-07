'use client'

import React from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import { UsageDataPoint } from '@/types/api'
import { formatChartXTicks, formatDate } from '@/lib/utils'

import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '../ui/chart'
import {
  ChartStateWrapper,
  formatBytes,
  isSameDay,
  mergeDualSeries,
} from './chart-utils'

interface DiskIOUsageChartProps {
  diskRead: UsageDataPoint[]
  diskWrite: UsageDataPoint[]
  isLoading?: boolean
  error?: Error | null
  syncId?: string
}

const chartConfig = {
  diskWrite: {
    label: 'Write',
    color: 'oklch(0.55 0.22 235)',
  },
  diskRead: {
    label: 'Read',
    color: 'oklch(0.55 0.20 145)',
  },
} satisfies ChartConfig

const DiskIOUsageChart = React.memo((prop: DiskIOUsageChartProps) => {
  const { diskRead, diskWrite, isLoading, error, syncId } = prop

  const chartData = React.useMemo(
    () => mergeDualSeries(diskRead, diskWrite, 'diskRead', 'diskWrite'),
    [diskRead, diskWrite]
  )
  const sameDay = React.useMemo(() => isSameDay(chartData), [chartData])

  return (
    <ChartStateWrapper
      title="Disk I/O Usage"
      isLoading={isLoading}
      error={error}
      isEmpty={
        !diskRead ||
        !diskWrite ||
        (diskRead.length === 0 && diskWrite.length === 0)
      }
      contentClassName="px-2 sm:px-6"
    >
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[250px] w-full"
      >
        <AreaChart data={chartData} syncId={syncId}>
          <defs>
            <linearGradient id="fillDiskWrite" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-diskWrite)"
                stopOpacity={0.8}
              />
              <stop
                offset="95%"
                stopColor="var(--color-diskWrite)"
                stopOpacity={0.1}
              />
            </linearGradient>
            <linearGradient id="fillDiskRead" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-diskRead)"
                stopOpacity={0.8}
              />
              <stop
                offset="95%"
                stopColor="var(--color-diskRead)"
                stopOpacity={0.1}
              />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <ReferenceLine y={0} stroke="#666" strokeDasharray="2 2" />
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            allowDataOverflow={true}
            tickFormatter={(value) => formatChartXTicks(value, sameDay)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => formatBytes(Math.abs(value))}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatDate(value)}
                formatter={(value, name) => [
                  <div key="indicator" className="flex items-center gap-2">
                    <div
                      className="shrink-0 rounded-[2px] w-1 h-3"
                      style={{
                        backgroundColor:
                          chartConfig[name as keyof typeof chartConfig]
                            ?.color || '#666',
                      }}
                    />
                    <span>
                      {chartConfig[name as keyof typeof chartConfig]?.label ||
                        name}
                    </span>
                  </div>,
                  formatBytes(Math.abs(Number(value))),
                ]}
              />
            }
          />
          <Area
            isAnimationActive={false}
            dataKey="diskWrite"
            type="monotone"
            fill="url(#fillDiskWrite)"
            stroke="var(--color-diskWrite)"
            strokeWidth={2}
            dot={false}
          />
          <Area
            isAnimationActive={false}
            dataKey="diskRead"
            type="monotone"
            fill="url(#fillDiskRead)"
            stroke="var(--color-diskRead)"
            strokeWidth={2}
            dot={false}
          />
          <ChartLegend content={<ChartLegendContent />} />
        </AreaChart>
      </ChartContainer>
    </ChartStateWrapper>
  )
})

DiskIOUsageChart.displayName = 'DiskIOUsageChart'

export default DiskIOUsageChart
