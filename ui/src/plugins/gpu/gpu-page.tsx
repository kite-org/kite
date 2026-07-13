import { IconCpu2, IconInfoCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import './i18n'

import { useGpuOverview } from './api'
import { GpuCardSlot } from './components/gpu-slot'
import { NodeGpuCard } from './components/node-gpu-card'

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}

export function GpuPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useGpuOverview()

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <h2 className="text-lg font-semibold">{t('plugin.gpu.failedToLoad')}</h2>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold">{t('plugin.gpu.title')}</h1>
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (data.nodes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <IconCpu2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t('plugin.gpu.noGpuInCluster')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t('plugin.gpu.title')}</h1>
        {data.level === 'dcgm' ? (
          <Badge>{t('plugin.gpu.modeDcgm')}</Badge>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="cursor-help gap-1">
                {t('plugin.gpu.modeBasic')}
                <IconInfoCircle className="h-3 w-3" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-xs">
              {t('plugin.gpu.basicModeHint')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label={t('plugin.gpu.totalGpus')}
          value={data.summary.totalGPUs}
        />
        <SummaryCard
          label={t('plugin.gpu.allocated')}
          value={data.summary.allocatedGPUs}
        />
        <SummaryCard label={t('plugin.gpu.free')} value={data.summary.freeGPUs} />
      </div>

      <div className="flex flex-col gap-4">
        {data.nodes.map((node) => (
          <NodeGpuCard key={node.name} node={node} level={data.level} />
        ))}
      </div>

      {data.unassignedCards && data.unassignedCards.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t('plugin.gpu.unassignedCards')}
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {data.unassignedCards.map((card) => (
              <GpuCardSlot key={`${card.uuid}-${card.index}`} card={card} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
