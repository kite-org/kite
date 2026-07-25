import { useState } from 'react'
import { IconUpload } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ClusterImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (config: string) => void
  isSubmitting: boolean
  error?: string
}

export function ClusterImportDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  error,
}: ClusterImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ClusterImportDialogContent
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          isSubmitting={isSubmitting}
          error={error}
        />
      ) : null}
    </Dialog>
  )
}

function ClusterImportDialogContent({
  onOpenChange,
  onSubmit,
  isSubmitting,
  error,
}: Omit<ClusterImportDialogProps, 'open'>) {
  const { t } = useTranslation()
  const [config, setConfig] = useState('')
  const [fileError, setFileError] = useState('')

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setConfig(await file.text())
      setFileError('')
    } catch {
      setFileError(
        t(
          'clusterManagement.messages.fileReadError',
          'Failed to read kubeconfig file'
        )
      )
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onSubmit(config)
  }

  return (
    <DialogContent className="sm:max-w-[600px]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-balance">
          <IconUpload className="size-5" />
          {t('clusterManagement.dialog.importTitle', 'Import Clusters')}
        </DialogTitle>
        <DialogDescription className="text-pretty">
          {t(
            'clusterManagement.dialog.importDescription',
            'Import all Kubernetes contexts from a kubeconfig file.'
          )}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cluster-import-file">
            {t('clusterManagement.dialog.importFile', 'Kubeconfig File')}
          </Label>
          <Input
            id="cluster-import-file"
            type="file"
            onChange={handleFileSelect}
          />
          <p className="text-xs text-muted-foreground text-pretty">
            {t(
              'clusterManagement.dialog.importFileHint',
              'Choose a kubeconfig file, or paste its content below.'
            )}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cluster-import-config">
            {t('clusterManagement.dialog.config', 'Kubeconfig')} *
          </Label>
          <Textarea
            id="cluster-import-config"
            value={config}
            onChange={(event) => {
              setConfig(event.target.value)
              setFileError('')
            }}
            placeholder={t(
              'clusterManagement.dialog.configPlaceholder',
              'Paste kubeconfig content here...'
            )}
            rows={10}
            className="font-mono text-sm"
            required
          />
        </div>

        {(fileError || error) && (
          <p role="alert" className="text-sm text-destructive text-pretty">
            {fileError || error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('common.actions.cancel', 'Cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting || !config.trim()}>
            {isSubmitting
              ? t('clusterManagement.actions.importing', 'Importing...')
              : t('clusterManagement.actions.import', 'Import Clusters')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
