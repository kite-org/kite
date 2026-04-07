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

interface MemoryUsageChartProps {
  data: UsageDataPoint[]
  isLoading?: boolean
  error?: Error | null
  syncId?: string
}

const MemoryUsageChart = React.memo((prop: MemoryUsageChartProps) => {
  const { data, isLoading, error, syncId } = prop

  const memoryChartData = React.useMemo(
    () => toChartData(data, 'memory', (v) => Math.max(0, v)),
    [data]
  )

  const sameDay = React.useMemo(
    () => isSameDay(memoryChartData),
    [memoryChartData]
  )

  const useGB = React.useMemo(() => {
    if (!memoryChartData.length) return false
    const maxMemory = Math.max(
      ...memoryChartData.map((point) => point.memory as number)
    )
    return maxMemory > 900
  }, [memoryChartData])

  const processedData = React.useMemo(() => {
    if (!useGB) return memoryChartData
    return memoryChartData.map((point) => ({
      ...point,
      memory: (point.memory as number) / 1024,
    }))
  }, [memoryChartData, useGB])

  const chartConfig = React.useMemo(
    () => ({
      memory: {
        label: `Memory (${useGB ? 'GB' : 'MB'})`,
        theme: {
          light: 'hsl(142, 70%, 50%)',
          dark: 'hsl(150, 80%, 60%)',
        },
      },
    }),
    [useGB]
  ) satisfies ChartConfig

  return (
    <ChartStateWrapper
      title="Memory Usage"
      isLoading={isLoading}
      error={error}
      isEmpty={!data || data.length === 0}
    >
      <ChartContainer config={chartConfig} className="h-[250px] w-full">
        <AreaChart data={processedData} syncId={syncId}>
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
            tickFormatter={(value) =>
              `${value.toFixed(useGB ? 2 : 1)}${useGB ? 'GB' : 'MB'}`
            }
            domain={[0, (dataMax: number) => dataMax * 1.1]}
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
            dataKey="memory"
            type="monotone"
            fill="var(--color-memory)"
            stroke="var(--color-memory)"
          />
        </AreaChart>
      </ChartContainer>
    </ChartStateWrapper>
  )
})

export default MemoryUsageChart
