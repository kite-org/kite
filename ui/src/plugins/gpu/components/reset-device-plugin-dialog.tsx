import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { resetDevicePlugin } from '../api'
import type { ResetPodRef } from '../types'

// Confirmation dialog for resetting a node's GPU registration. On open it
// dry-runs the reset to show exactly which device-plugin pod(s) will be
// deleted; the DaemonSet recreates them, which re-registers the GPUs.
export function ResetDevicePluginDialog({
  node,
  open,
  onOpenChange,
}: {
  node: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [targets, setTargets] = useState<ResetPodRef[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    if (!open) {
      setTargets(null)
      setPreviewError(null)
      return
    }
    let cancelled = false
    resetDevicePlugin(node, true)
      .then((res) => {
        if (!cancelled) setTargets(res.pods)
      })
      .catch((err) => {
        if (!cancelled)
          setPreviewError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [open, node])

  const handleConfirm = async () => {
    setIsResetting(true)
    try {
      const res = await resetDevicePlugin(node, false)
      toast.success(
        t('plugin.gpu.resetSuccess', {
          pods: res.pods.map((p) => `${p.namespace}/${p.name}`).join(', '),
        })
      )
      queryClient.invalidateQueries({ queryKey: ['plugin-gpu'] })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-left">
                {t('plugin.gpu.resetTitle', { node })}
              </DialogTitle>
              <DialogDescription className="text-left">
                {t('plugin.gpu.resetDescription')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm">
          <p className="mb-2 font-medium text-destructive">
            {t('plugin.gpu.resetWillDelete')}
          </p>
          {previewError ? (
            <p className="text-muted-foreground">{previewError}</p>
          ) : targets === null ? (
            <Skeleton className="h-5 w-3/4" />
          ) : (
            <ul className="space-y-1 font-mono text-xs text-muted-foreground">
              {targets.map((p) => (
                <li key={`${p.namespace}/${p.name}`}>
                  {p.namespace}/{p.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isResetting}
          >
            {t('common.actions.cancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isResetting || !targets || targets.length === 0}
          >
            {isResetting
              ? t('plugin.gpu.resetting')
              : t('plugin.gpu.resetConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
