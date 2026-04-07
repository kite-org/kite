/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { UsageDataPoint } from '@/types/api'

import { Alert, AlertDescription } from '../ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Skeleton } from '../ui/skeleton'

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = bytes / Math.pow(k, i)
  return value >= 10
    ? Math.round(value) + sizes[i]
    : value.toFixed(1) + sizes[i]
}

export function isSameDay(data: Array<{ timestamp: string }>): boolean {
  if (data.length < 2) return true
  const first = new Date(data[0].timestamp)
  const last = new Date(data[data.length - 1].timestamp)
  return first.toDateString() === last.toDateString()
}

export function toChartData(
  data: UsageDataPoint[],
  metricKey: string,
  transform?: (value: number) => number
) {
  if (!data) return []
  return data
    .map((point) => ({
      timestamp: point.timestamp,
      time: new Date(point.timestamp).getTime(),
      [metricKey]: transform ? transform(point.value) : point.value,
    }))
    .sort((a, b) => a.time - b.time)
}

export function mergeDualSeries(
  series1: UsageDataPoint[],
  series2: UsageDataPoint[],
  key1: string,
  key2: string
) {
  if (!series1 || !series2) return []
  const combined = new Map<
    number,
    { timestamp: string; time: number; [k: string]: unknown }
  >()

  series1.forEach((point) => {
    const time = new Date(point.timestamp).getTime()
    combined.set(time, {
      timestamp: point.timestamp,
      time,
      [key1]: Math.max(0, point.value),
    })
  })

  series2.forEach((point) => {
    const time = new Date(point.timestamp).getTime()
    const existing = combined.get(time) || {
      timestamp: point.timestamp,
      time,
    }
    ;(existing as Record<string, unknown>)[key2] = Math.max(0, point.value)
    combined.set(time, existing)
  })

  return Array.from(combined.values()).sort((a, b) => a.time - b.time)
}

interface ChartStateWrapperProps {
  title: string
  isLoading?: boolean
  error?: Error | null
  isEmpty?: boolean
  cardClassName?: string
  contentClassName?: string
  children: React.ReactNode
}

export function ChartStateWrapper({
  title,
  isLoading,
  error,
  isEmpty,
  cardClassName = '@container/card',
  contentClassName,
  children,
}: ChartStateWrapperProps) {
  if (isLoading) {
    return (
      <Card className={cardClassName}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className={contentClassName}>
          <div className="space-y-3">
            <Skeleton className="h-[250px] w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={cardClassName}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className={contentClassName}>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  if (isEmpty) {
    return (
      <Card className={cardClassName}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className={contentClassName}>
          <div className="flex h-[250px] w-full items-center justify-center text-muted-foreground">
            <p>No {title.toLowerCase()} data available</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cardClassName}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}
