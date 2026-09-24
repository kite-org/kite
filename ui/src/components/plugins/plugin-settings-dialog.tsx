import { usePlugins } from '@/plugins/plugin-context'
import { PluginView } from '@/plugins/plugin-view'
import { pluginLabel } from '@/plugins/sidebar'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function PluginSettingsDialog({
  pluginId,
  onClose,
}: {
  pluginId: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const { plugins } = usePlugins()
  const plugin = plugins.find((entry) => entry.manifest.id === pluginId)
  const label = plugin?.manifest.settings?.label ?? plugin?.manifest.name

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {label ? pluginLabel(label, i18n.language) : pluginId}
          </DialogTitle>
        </DialogHeader>
        {plugin?.error || plugin?.invalid ? (
          <p role="alert" className="text-sm text-destructive">
            {plugin.error ?? t('plugins.loadFailed')}
          </p>
        ) : plugin?.module?.settings ? (
          <PluginView
            plugin={plugin}
            fallback={<p role="alert">{t('plugins.loadFailed')}</p>}
          >
            {(module) => module.settings?.element ?? null}
          </PluginView>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('plugins.loadingPlugin')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
