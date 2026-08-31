import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { WorkloadRevisionItem, WorkloadRevisionResourceType } from '@/types/api'
import { rollbackWorkload, useWorkloadRevisions } from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'

import { Column, SimpleTable } from './simple-table'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

const revisionObjectLabelKey: Record<WorkloadRevisionResourceType, string> = {
  deployments: 'workloads.fields.replicaSet',
  statefulsets: 'workloads.fields.controllerRevision',
  daemonsets: 'workloads.fields.controllerRevision',
}

function WorkloadRollbackButton({
  item,
  namespace,
  name,
  disabled,
  onRollback,
}: {
  item: WorkloadRevisionItem
  namespace: string
  name: string
  disabled: boolean
  onRollback: (revision: number) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleConfirm = async () => {
    if (await onRollback(item.revision)) {
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-24"
          disabled={disabled}
        >
          {t('workloads.actions.rollback')}
        </Button>
      </DialogTrigger>
      <DialogContent className="!max-w-md sm:!max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('workloads.messages.rollbackConfirmTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('workloads.messages.rollbackConfirmDescription', {
              namespace,
              name,
              revision: item.revision,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={disabled}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={disabled}
          >
            {t('workloads.actions.rollback')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WorkloadRevisionsTable({
  resourceType,
  namespace,
  name,
  onRollbackComplete,
}: {
  resourceType: WorkloadRevisionResourceType
  namespace: string
  name: string
  onRollbackComplete: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [rollingBackRevision, setRollingBackRevision] = useState<number | null>(
    null
  )
  const {
    data,
    isLoading,
    isError,
    error,
    refetch: refetchRevisions,
  } = useWorkloadRevisions(resourceType, namespace, name)

  const handleRollback = async (revision: number) => {
    setRollingBackRevision(revision)
    try {
      await rollbackWorkload(resourceType, namespace, name, revision)
    } catch (err) {
      toast.error(translateError(err, t))
      setRollingBackRevision(null)
      return false
    }

    toast.success(t('workloads.messages.rollbackStarted'))
    await Promise.allSettled([refetchRevisions(), onRollbackComplete()])
    setRollingBackRevision(null)
    return true
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {t('common.messages.loading')}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          {translateError(error, t)}
        </CardContent>
      </Card>
    )
  }

  const columns: Column<WorkloadRevisionItem>[] = [
    {
      header: t('common.fields.revision'),
      accessor: (item) => item.revision,
      cell: (value) => (
        <span className="font-medium tabular-nums">{value as number}</span>
      ),
    },
    {
      header: t(revisionObjectLabelKey[resourceType]),
      accessor: (item) => item.revisionObject,
      cell: (value) => value as string,
      align: 'left',
    },
    ...(resourceType === 'deployments'
      ? [
          {
            header: t('common.fields.replicas'),
            accessor: (item: WorkloadRevisionItem) => item.replicas,
            cell: (value: unknown) => (
              <span className="tabular-nums">{value as number}</span>
            ),
            align: 'left' as const,
          },
        ]
      : []),
    {
      header: t('common.fields.created'),
      accessor: (item) => item.createdAt,
      cell: (value) => (
        <span className="text-sm text-muted-foreground">
          {value ? formatDate(value as string) : '-'}
        </span>
      ),
      align: 'left',
    },
    {
      header: t('common.tabs.containers'),
      accessor: (item) => item.images,
      cell: (value) => (
        <div className="max-w-md whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {((value as string[]) || []).join(', ') || '-'}
        </div>
      ),
      align: 'left',
    },
    {
      header: t('workloads.fields.changeCause'),
      accessor: (item) => item.changeCause || '-',
      cell: (value) => (
        <span className="text-sm text-muted-foreground">{value as string}</span>
      ),
      align: 'left',
    },
    {
      header: t('common.fields.actions'),
      accessor: (item) => item,
      cell: (value) => {
        const item = value as WorkloadRevisionItem
        return (
          <div className="ml-auto w-max">
            {item.current ? (
              <Button variant="outline" size="sm" className="w-24" disabled>
                {t('common.fields.current')}
              </Button>
            ) : (
              <WorkloadRollbackButton
                item={item}
                namespace={namespace}
                name={name}
                disabled={rollingBackRevision !== null}
                onRollback={handleRollback}
              />
            )}
          </div>
        )
      },
      align: 'right',
    },
  ]

  return (
    <Card>
      <CardContent>
        <SimpleTable
          data={data?.items ?? []}
          emptyMessage={t('workloads.messages.noRevisions')}
          columns={columns}
          pagination={{ enabled: true, pageSize: 10 }}
        />
      </CardContent>
    </Card>
  )
}
