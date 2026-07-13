import { useState } from 'react'
import { IconRefreshAlert, IconServer2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { GpuNode, GpuOccupant } from '../types'
import { GpuCardSlot, SyntheticSlot } from './gpu-slot'
import { ResetDevicePluginDialog } from './reset-device-plugin-dialog'

// Expand basic-mode pod allocations into one synthetic slot per requested
// GPU, followed by idle slots up to the node's allocatable count.
function syntheticSlots(node: GpuNode): (GpuOccupant | null)[] {
  const slots: (GpuOccupant | null)[] = []
  for (const res of node.resources) {
    for (const pod of res.pods) {
      for (const container of pod.containers) {
        for (let i = 0; i < container.count; i++) {
          slots.push({
            namespace: pod.namespace,
            pod: pod.name,
            container: container.name,
          })
        }
      }
    }
    const allocatable = res.allocatable
    while (slots.length < allocatable) {
      slots.push(null)
    }
  }
  return slots
}

export function NodeGpuCard({
  node,
  level,
}: {
  node: GpuNode
  level: 'basic' | 'dcgm'
}) {
  const { t } = useTranslation()
  const [resetOpen, setResetOpen] = useState(false)
  const allocatable = node.resources.reduce((sum, r) => sum + r.allocatable, 0)
  const allocated = node.resources.reduce((sum, r) => sum + r.allocated, 0)
  const useCards = level === 'dcgm' && (node.cards?.length ?? 0) > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconServer2 className="h-4 w-4 text-sidebar-primary" />
            <Link
              to={`/nodes/${node.name}`}
              className="hover:underline"
            >
              {node.name}
            </Link>
          </CardTitle>
          {!node.ready && (
            <Badge variant="destructive" className="text-[10px]">
              {t('plugin.gpu.nodeNotReady')}
            </Badge>
          )}
          {node.gpuModel && (
            <Badge variant="secondary" className="text-[10px]">
              {node.gpuModel}
            </Badge>
          )}
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
            {t('plugin.gpu.allocated')} {allocated}/{allocatable}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setResetOpen(true)}
              >
                <IconRefreshAlert className="h-3.5 w-3.5" />
                {t('plugin.gpu.resetGpu')}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-xs">
              {t('plugin.gpu.resetDescription')}
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <ResetDevicePluginDialog
        node={node.name}
        open={resetOpen}
        onOpenChange={setResetOpen}
      />
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {useCards
            ? node.cards!.map((card) => (
                <GpuCardSlot key={`${card.uuid}-${card.index}`} card={card} />
              ))
            : syntheticSlots(node).map((occupant, i) => (
                <SyntheticSlot key={i} index={i} occupant={occupant} />
              ))}
        </div>
        {useCards &&
          allocated > 0 &&
          !node.cards!.some((c) => c.occupant) && (
            <div className="flex flex-col gap-1 border-t pt-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {t('plugin.gpu.occupiedBy')}
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {node.resources.flatMap((res) =>
                  res.pods.map((pod) => (
                    <Link
                      key={`${pod.namespace}/${pod.name}`}
                      to={`/pods/${pod.namespace}/${pod.name}`}
                      className="text-xs text-primary hover:underline"
                    >
                      {pod.namespace}/{pod.name}
                      <span className="text-muted-foreground"> ×{pod.count}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}
      </CardContent>
    </Card>
  )
}
