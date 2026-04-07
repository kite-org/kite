'use client'

import React from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { UsageDataPoint } from '@/types/api'
import { formatChartXTicks, formatDate } from '@/lib/utils'

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '../ui/chart'
import { ChartStateWrapper, isSameDay, toChartData } from './chart-utils'

interface CpuUsageChartProps {
  data: UsageDataPoint[]
  isLoading?: boolean
  error?: Error | null
  syncId?: string
}

const cpuChartConfig = {
  cpu: {
    label: 'CPU (cores)',
    theme: {
      light: 'hsl(220, 70%, 50%)',
      dark: 'hsl(210, 80%, 60%)',
    },
  },
} satisfies ChartConfig

const CPUUsageChart = React.memo((prop: CpuUsageChartProps) => {
  const { data, isLoading, error, syncId } = prop
  const chartData = React.useMemo(() => toChartData(data, 'cpu'), [data])
  const sameDay = React.useMemo(() => isSameDay(chartData), [chartData])

  return (
    <ChartStateWrapper
      title="CPU Usage"
      isLoading={isLoading}
      error={error}
      isEmpty={!data || data.length === 0}
    >
      <ChartContainer config={cpuChartConfig} className="h-[250px] w-full">
        <AreaChart data={chartData} syncId={syncId}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={30}
            allowDataOverflow={true}
            tickFormatter={(value) => formatChartXTicks(value, sameDay)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => `${value.toFixed(3)}`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatDate(value)}
              />
            }
          />
          <Area
            isAnimationActive={false}
            dataKey="cpu"
            type="monotone"
            fill="var(--color-cpu)"
            stroke="var(--color-cpu)"
          />
        </AreaChart>
      </ChartContainer>
    </ChartStateWrapper>
  )
})

export default CPUUsageChart
