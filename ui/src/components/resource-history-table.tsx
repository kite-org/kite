import { useCallback, useMemo, useState } from 'react'
import { IconAlertCircle, IconEye, IconLoader } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ResourceHistory, ResourceType, ResourceTypeMap } from '@/types/api'
import { applyResource, useResourceHistory } from '@/lib/api'
import { formatDate } from '@/lib/utils'

import { Column, SimpleTable } from './simple-table'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { YamlDiffViewer } from './yaml-diff-viewer'

interface ResourceHistoryTableProps<T extends ResourceType> {
  resourceType: T
  name: string
  namespace?: string
  currentResource?: ResourceTypeMap[T]
}

export function ResourceHistoryTable<T extends ResourceType>({
  resourceType,
  name,
  namespace,
  currentResource,
}: ResourceHistoryTableProps<T>) {
  const { t } = useTranslation()
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(10)
  const [selectedHistory, setSelectedHistory] =
    useState<ResourceHistory | null>(null)
  const [isDiffOpen, setIsDiffOpen] = useState(false)
  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)

  const {
    data: historyResponse,
    refetch: refetchHistory,
    isLoading,
    isError,
    error,
  } = useResourceHistory(
    resourceType,
    namespace ?? '_all',
    name,
    currentPage,
    pageSize
  )

  const history = historyResponse?.data || []
  // const pagination = historyResponse?.pagination

  // Convert current resource to YAML
  const currentYaml = useMemo(() => {
    if (!currentResource) return ''
    try {
      return yaml.dump(currentResource, { indent: 2, sortKeys: true })
    } catch (error) {
      console.error('Failed to convert current resource to YAML:', error)
      return ''
    }
  }, [currentResource])

  const handleViewDiff = (item: ResourceHistory) => {
    setSelectedHistory(item)
    setIsDiffOpen(true)
  }

  const handleViewError = (item: ResourceHistory) => {
    setSelectedHistory(item)
    setIsErrorDialogOpen(true)
  }

  // Handle rollback operations
  const handleRollback = async (yamlContent: string) => {
    try {
      setIsRollingBack(true)
      await applyResource(yamlContent)

      // Show success toast
      toast.success(t('resourceHistory.rollback.success'))

      // Close the dialog after successful rollback
      setIsDiffOpen(false)
      refetchHistory()
      // Refresh the history data
      // You might want to add a refetch function here if available
    } catch (error) {
      console.error('Failed to rollback resource:', error)

      // Show error toast
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'
      toast.error(`${t('resourceHistory.rollback.error')}: ${errorMessage}`)
    } finally {
      setIsRollingBack(false)
    }
  }

  const getOperationTypeColor = (operationType: string) => {
    switch (operationType.toLowerCase()) {
      case 'create':
        return 'default'
      case 'update':
        return 'secondary'
      case 'delete':
        return 'destructive'
      case 'apply':
        return 'outline'
      default:
        return 'secondary'
    }
  }

  const getOperationTypeLabel = useCallback(
    (operationType: string) => {
      switch (operationType.toLowerCase()) {
        case 'create':
          return t('resourceHistory.create')
        case 'update':
          return t('resourceHistory.update')
        case 'delete':
          return t('resourceHistory.delete')
        case 'apply':
          return t('resourceHistory.apply')
        default:
          return operationType
      }
    },
    [t]
  )

  // History table columns
  const historyColumns = useMemo(
    (): Column<ResourceHistory>[] => [
      {
        header: 'ID',
        accessor: (item: ResourceHistory) => item.id,
        cell: (value: unknown) => (
          <div className="font-mono text-sm">{value as number}</div>
        ),
      },
      {
        header: t('resourceHistory.operator'),
        accessor: (item: ResourceHistory) => item,
        cell: (value: unknown) => {
          const item = value as ResourceHistory
          return (
            <div className="font-medium">
              {item.operator.username}
              {item.operator.provider === 'api_key' && (
                <span className="ml-2 text-xs text-muted-foreground italic">
                  apikey
                </span>
              )}
              {item.operationSource === 'ai' && (
                <span className="ml-2 text-xs text-muted-foreground italic">
                  AI
                </span>
              )}
            </div>
          )
        },
      },
      {
        header: t('resourceHistory.operationTime'),
        accessor: (item: ResourceHistory) => item.createdAt,
        cell: (value: unknown) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(value as string)}
          </span>
        ),
      },
      {
        header: t('resourceHistory.operationType'),
        accessor: (item: ResourceHistory) => item.operationType,
        cell: (value: unknown) => {
          const operationType = value as string
          return (
            <Badge variant={getOperationTypeColor(operationType)}>
              {getOperationTypeLabel(operationType)}
            </Badge>
          )
        },
      },
      {
        header: t('resourceHistory.status'),
        accessor: (item: ResourceHistory) => item.success,
        cell: (value: unknown) => {
          const success = value as boolean
          return (
            <Badge variant={success ? 'default' : 'destructive'}>
              {success
                ? t('resourceHistory.success')
                : t('resourceHistory.failed')}
            </Badge>
          )
        },
      },
      {
        header: t('resourceHistory.actions'),
        accessor: (item: ResourceHistory) => item,
        cell: (value: unknown) => {
          const item = value as ResourceHistory
          const isSuccess = item.success

          if (!isSuccess) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleViewError(item)}
                disabled={!item.errorMessage}
              >
                <IconAlertCircle className="w-4 h-4 mr-1" />
                {t('resourceHistory.viewError', 'view error')}
              </Button>
            )
          }

          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleViewDiff(item)}
              disabled={!item.resourceYaml && !item.previousYaml}
            >
              <IconEye className="w-4 h-4 mr-1" />
              {t('resourceHistory.viewDiff')}
            </Button>
          )
        },
      },
    ],
    [getOperationTypeLabel, t]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <IconLoader className="animate-spin mr-2" />
        {t('resourceHistory.loadingHistory')}
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-destructive">
            {t('resourceHistory.failedToLoadHistory')}: {error?.message}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('resourceHistory.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleTable
            data={history || []}
            columns={historyColumns}
            emptyMessage={t('resourceHistory.noHistoryFound')}
            pagination={{
              enabled: true,
              pageSize,
              showPageInfo: true,
              currentPage,
              onPageChange: setCurrentPage,
            }}
          />
        </CardContent>
      </Card>

      {selectedHistory && (
        <YamlDiffViewer
          original={selectedHistory.previousYaml || ''}
          modified={selectedHistory.resourceYaml || ''}
          current={currentYaml}
          open={isDiffOpen}
          onOpenChange={setIsDiffOpen}
          onRollback={handleRollback}
          isRollingBack={isRollingBack}
          title={`${t('resourceHistory.yamlDiff')}`}
        />
      )}

      {selectedHistory && (
        <Dialog open={isErrorDialogOpen} onOpenChange={setIsErrorDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {t('resourceHistory.errorDetails', 'error details')}
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4">
              <pre className="bg-destructive/10 text-destructive p-4 rounded-md overflow-auto max-h-96 text-sm">
                {selectedHistory.errorMessage ||
                  t(
                    'resourceHistory.noErrorMessage',
                    'no error message available'
                  )}
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
