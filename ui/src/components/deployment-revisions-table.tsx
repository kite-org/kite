import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DeploymentRevisionItem } from '@/types/api'
import { rollbackDeployment, useDeploymentRevisions } from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'

import { SimpleTable } from './simple-table'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

function DeploymentRollbackButton({
  item,
  namespace,
  name,
  disabled,
  onRollback,
}: {
  item: DeploymentRevisionItem
  namespace: string
  name: string
  disabled: boolean
  onRollback: (revision: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleConfirm = async () => {
    await onRollback(item.revision)
    setOpen(false)
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
          {t('deployments.actions.rollback')}
        </Button>
      </DialogTrigger>
      <DialogContent className="!max-w-md sm:!max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('deployments.messages.rollbackConfirmTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('deployments.messages.rollbackConfirmDescription', {
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
            {t('deployments.actions.rollback')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeploymentRevisionsTable({
  namespace,
  name,
  onRollbackComplete,
}: {
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
  } = useDeploymentRevisions(namespace, name)

  const handleRollback = async (revision: number) => {
    setRollingBackRevision(revision)
    try {
      await rollbackDeployment(namespace, name, revision)
      toast.success(t('deployments.messages.rollbackStarted'))
      await Promise.all([refetchRevisions(), onRollbackComplete()])
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setRollingBackRevision(null)
    }
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('common.tabs.revisions')}</CardTitle>
      </CardHeader>
      <CardContent>
        <SimpleTable
          data={data?.items || []}
          emptyMessage={t('deployments.messages.noRevisions')}
          columns={[
            {
              header: t('common.fields.revision'),
              accessor: (item) => item.revision,
              cell: (value) => (
                <span className="font-medium tabular-nums">
                  {value as number}
                </span>
              ),
            },
            {
              header: t('deployments.fields.replicaSet'),
              accessor: (item) => item.replicaSet,
              cell: (value) => value as string,
              align: 'left',
            },
            {
              header: t('common.fields.updated'),
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
              header: t('deployments.fields.changeCause'),
              accessor: (item) => item.changeCause || '-',
              cell: (value) => (
                <span className="text-sm text-muted-foreground">
                  {value as string}
                </span>
              ),
              align: 'left',
            },
            {
              header: t('common.fields.actions'),
              accessor: (item) => item,
              cell: (value) => {
                const item = value as DeploymentRevisionItem
                return (
                  <div className="ml-auto w-max">
                    {item.current ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-24"
                        disabled
                      >
                        {t('common.fields.current')}
                      </Button>
                    ) : (
                      <DeploymentRollbackButton
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
          ]}
          pagination={{ enabled: true, pageSize: 10 }}
        />
      </CardContent>
    </Card>
  )
}
