import { usePlugins } from '@/plugins/plugin-context'
import { IconPuzzle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function PluginIndicator({ pluginId }: { pluginId?: string }) {
  const { plugins } = usePlugins()
  const { t } = useTranslation()
  const plugin = plugins.find((item) => item.manifest.id === pluginId)
  if (!plugin) return null

  const label = t('plugins.providedBy', { name: plugin.manifest.name })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 items-center text-muted-foreground"
          role="img"
          aria-label={label}
        >
          <IconPuzzle className="size-3" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
