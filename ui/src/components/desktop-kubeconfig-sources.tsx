import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DesktopService, type KubeconfigSource } from '@/lib/mygo'
import { Button } from '@/components/ui/button'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

export function DesktopKubeconfigSources() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<KubeconfigSource | null>(null)
  const { data: sources = [], error } = useQuery({
    queryKey: ['kubeconfig-sources'],
    queryFn: DesktopService.kubeconfigSources,
    refetchInterval: 3000,
  })
  const remove = useMutation({
    mutationFn: DesktopService.removeKubeconfigSource,
    onSuccess: () => {
      setRemoving(null)
      void queryClient.invalidateQueries({ queryKey: ['kubeconfig-sources'] })
      void queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    )
  if (!sources.length) return null

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('desktop.kubeconfig.sources')}</p>
      {sources.map((source) => (
        <div key={source.id} className="rounded-md border p-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              {source.paths.map((path) => (
                <p key={path} className="break-all font-mono">
                  {path}
                </p>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRemoving(source)}
            >
              {t('common.actions.remove')}
            </Button>
          </div>
          {source.error && (
            <p
              role="alert"
              className="mt-2 break-words text-xs text-destructive"
            >
              {source.error}
            </p>
          )}
        </div>
      ))}
      <DeleteConfirmationDialog
        key={removing?.id}
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        resourceName={removing?.paths.join(', ') || ''}
        resourceType="kubeconfig"
        additionalNote={t('desktop.kubeconfig.removeHint')}
        isDeleting={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
        }}
      />
    </div>
  )
}
