import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface BatchResource {
  metadata?: {
    name?: string
    namespace?: string
  }
}

interface ResourceBatchActionDialogProps<T extends BatchResource> {
  open: boolean
  onOpenChange: (open: boolean) => void
  resources: T[]
  title: string
  description: string
  actionLabel: string
  onExecute: (resource: T) => Promise<unknown>
  onComplete?: () => void | Promise<void>
  sequential?: boolean
  destructive?: boolean
  options?: (disabled: boolean) => React.ReactNode
}

interface BatchFailure {
  resource: string
  error: string
}

export function ResourceBatchActionDialog<T extends BatchResource>({
  open,
  onOpenChange,
  resources,
  title,
  description,
  actionLabel,
  onExecute,
  onComplete,
  sequential = false,
  destructive = false,
  options,
}: ResourceBatchActionDialogProps<T>) {
  const { t } = useTranslation()
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [failures, setFailures] = useState<BatchFailure[]>([])

  const reset = () => {
    setProgress({ done: 0, total: 0 })
    setFailures([])
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (isRunning) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const handleExecute = async () => {
    setIsRunning(true)
    setFailures([])
    setProgress({ done: 0, total: resources.length })

    const nextFailures: BatchFailure[] = []
    let succeeded = 0

    const executeResource = async (resource: T) => {
      const name = resource.metadata!.name!
      const displayName = resource.metadata?.namespace
        ? `${resource.metadata.namespace}/${name}`
        : name

      try {
        await onExecute(resource)
        succeeded += 1
      } catch (error) {
        nextFailures.push({
          resource: displayName,
          error: translateError(error, t),
        })
      } finally {
        setProgress((current) => ({
          ...current,
          done: current.done + 1,
        }))
      }
    }

    if (sequential) {
      for (const resource of resources) {
        await executeResource(resource)
      }
    } else {
      await Promise.all(resources.map(executeResource))
    }

    await onComplete?.()
    setIsRunning(false)

    if (nextFailures.length === 0) {
      toast.success(
        t('resourceTable.batchActionSuccess', {
          action: actionLabel,
          count: succeeded,
        })
      )
      reset()
      onOpenChange(false)
      return
    }

    setFailures(nextFailures)
    toast.error(
      t('resourceTable.batchActionFailed', {
        count: nextFailures.length,
      })
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        role={destructive ? 'alertdialog' : 'dialog'}
        showCloseButton={!isRunning}
      >
        <DialogHeader>
          <DialogTitle className="text-balance">{title}</DialogTitle>
          <DialogDescription className="text-pretty">
            {description}
          </DialogDescription>
        </DialogHeader>

        {options?.(isRunning)}

        {failures.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="text-pretty text-sm">
              {t('resourceTable.batchActionPartialResult', {
                succeeded: resources.length - failures.length,
                total: resources.length,
              })}
            </p>
            <p className="mt-2 text-sm font-medium text-destructive">
              {t('resourceTable.failedResources', {
                count: failures.length,
              })}
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
              {failures.map((failure) => (
                <li key={failure.resource} className="text-pretty">
                  <span className="font-medium">{failure.resource}:</span>{' '}
                  {failure.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {failures.length > 0 ? (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common.actions.close')}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isRunning}
              >
                {t('common.actions.cancel')}
              </Button>
              <Button
                variant={destructive ? 'destructive' : 'default'}
                onClick={handleExecute}
                disabled={isRunning}
                className="tabular-nums"
              >
                {isRunning
                  ? t('resourceTable.processingProgress', progress)
                  : actionLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
