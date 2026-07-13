import { IconCpu2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { formatMemory } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import type { GpuCard, GpuOccupant } from '../types'

function OccupantLink({ occupant }: { occupant: GpuOccupant }) {
  return (
    <div className="min-w-0 text-xs">
      <Link
        to={`/pods/${occupant.namespace}/${occupant.pod}`}
        className="block truncate font-medium text-primary hover:underline"
        title={`${occupant.namespace}/${occupant.pod}`}
      >
        {occupant.namespace}/{occupant.pod}
      </Link>
      {occupant.container && (
        <span className="block truncate text-muted-foreground">
          {occupant.container}
        </span>
      )}
    </div>
  )
}

function SlotFrame({
  occupied,
  children,
}: {
  occupied: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-md border p-2.5 ${
        occupied ? 'border-primary/40 bg-primary/5' : 'border-dashed bg-muted/30'
      }`}
    >
      {children}
    </div>
  )
}

function utilizationColor(pct: number) {
  if (pct > 90) return 'bg-red-500'
  if (pct > 60) return 'bg-yellow-500'
  return 'bg-blue-500'
}

// Real card reported by dcgm-exporter. A card counts as active when a
// workload is attributed to it or it shows utilization (exporters without
// Kubernetes pod mapping report no occupant).
export function GpuCardSlot({ card }: { card: GpuCard }) {
  const { t } = useTranslation()
  const pct = Math.min(Math.max(card.utilization, 0), 100)
  const active = card.occupant !== null || pct > 0

  return (
    <SlotFrame occupied={active}>
      <div className="flex items-center justify-between gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-xs font-semibold">
              <IconCpu2 className="h-3.5 w-3.5 text-sidebar-primary" />
              GPU {card.index}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              {card.modelName && <div>{card.modelName}</div>}
              <div className="text-muted-foreground">{card.uuid}</div>
            </div>
          </TooltipContent>
        </Tooltip>
        <Badge variant={active ? 'default' : 'outline'} className="text-[10px]">
          {active ? `${pct.toFixed(0)}%` : t('plugin.gpu.idle')}
        </Badge>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-1.5 rounded-full transition-all duration-300 ${utilizationColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {card.memoryTotalBytes ? (
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t('plugin.gpu.memory')}: {formatMemory(card.memoryUsedBytes ?? 0)} /{' '}
          {formatMemory(card.memoryTotalBytes)}
        </span>
      ) : null}

      {card.occupant ? (
        <OccupantLink occupant={card.occupant} />
      ) : (
        !active && (
          <span className="text-xs text-muted-foreground">
            {t('plugin.gpu.idle')}
          </span>
        )
      )}
    </SlotFrame>
  )
}

// Synthetic slot for the basic (scheduler view) mode: derived from pod
// resource requests, not an actual card binding.
export function SyntheticSlot({
  index,
  occupant,
}: {
  index: number
  occupant: GpuOccupant | null
}) {
  const { t } = useTranslation()
  return (
    <SlotFrame occupied={occupant !== null}>
      <div className="flex items-center justify-between gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-xs font-semibold">
              <IconCpu2 className="h-3.5 w-3.5 text-sidebar-primary" />
              GPU {index}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-56 text-xs">
            {t('plugin.gpu.syntheticSlotHint')}
          </TooltipContent>
        </Tooltip>
        <Badge
          variant={occupant ? 'default' : 'outline'}
          className="text-[10px]"
        >
          {occupant ? t('plugin.gpu.allocated') : t('plugin.gpu.idle')}
        </Badge>
      </div>
      {occupant ? (
        <OccupantLink occupant={occupant} />
      ) : (
        <span className="text-xs text-muted-foreground">
          {t('plugin.gpu.idle')}
        </span>
      )}
    </SlotFrame>
  )
}
