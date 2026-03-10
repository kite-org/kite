import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconAlertCircle, IconEye } from '@tabler/icons-react'
import {
  ColumnDef,
  getCoreRowModel,
  PaginationState,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { ResourceHistory } from '@/types/api'
import { useAuditLogs, useClusterList, useUserList } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ResourceTableView } from '@/components/resource-table-view'
import { YamlDiffViewer } from '@/components/yaml-diff-viewer'

export function AuditLog() {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [operatorId, setOperatorId] = useState<number | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [operationFilter, setOperationFilter] = useState('')
  const [clusterFilter, setClusterFilter] = useState('')
  const [selectedHistory, setSelectedHistory] =
    useState<ResourceHistory | null>(null)
  const [isDiffOpen, setIsDiffOpen] = useState(false)
  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false)

  const { data: usersData } = useUserList(1, 200)
  const { data: clusters = [] } = useClusterList()
  const showCluster = clusters.length > 1
  const {
    data: auditData,
    isLoading,
    error,
  } = useAuditLogs(
    pagination.pageIndex + 1,
    pagination.pageSize,
    operatorId,
    searchQuery,
    operationFilter || undefined,
    showCluster ? clusterFilter || undefined : undefined
  )

  useEffect(() => {
    if (!showCluster && clusterFilter) {
      setClusterFilter('')
    }
  }, [clusterFilter, showCluster])

  const handleUserFilterChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    if (value === 'all') {
      setOperatorId(undefined)
      return
    }
    const parsed = Number(value)
    setOperatorId(Number.isNaN(parsed) ? undefined : parsed)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setSearchQuery(value)
  }, [])

  const handleOperationChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setOperationFilter(value === 'all' ? '' : value)
  }, [])

  const handleClusterChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setClusterFilter(value === 'all' ? '' : value)
  }, [])

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

  const columns = useMemo<ColumnDef<ResourceHistory>[]>(
    () => [
      {
        id: 'time',
        header: t('auditLog.table.time', 'Time'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'operator',
        header: t('auditLog.table.operator', 'Operator'),
        cell: ({ row }) => (
          <div className="font-medium">
            {row.original.operator?.username || '-'}
            {row.original.operator?.provider === 'api_key' && (
              <span className="ml-2 text-xs text-muted-foreground italic">
                apikey
              </span>
            )}
            {row.original.operationSource === 'ai' && (
              <span className="ml-2 text-xs text-muted-foreground italic">
                AI
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'operationType',
        header: t('auditLog.table.operation', 'Operation'),
        cell: ({ row }) => (
          <Badge variant={getOperationTypeColor(row.original.operationType)}>
            {getOperationTypeLabel(row.original.operationType)}
          </Badge>
        ),
      },
      {
        id: 'resource',
        header: t('auditLog.table.resource', 'Resource'),
        cell: ({ row }) => {
          const resource = row.original
          const name = resource.namespace
            ? `${resource.namespace}/${resource.resourceName}`
            : resource.resourceName
          return (
            <div className="text-sm">
              <div className="font-medium">{name || '-'}</div>
              <div className="text-muted-foreground text-xs">
                {resource.resourceType || '-'}
              </div>
            </div>
          )
        },
      },
      ...(showCluster
        ? [
            {
              id: 'cluster',
              header: t('auditLog.table.cluster', 'Cluster'),
              cell: ({ row }: { row: { original: ResourceHistory } }) => (
                <span className="text-sm text-muted-foreground">
                  {row.original.clusterName || '-'}
                </span>
              ),
            },
          ]
        : []),
      {
        id: 'status',
        header: t('auditLog.table.status', 'Status'),
        cell: ({ row }) => (
          <Badge variant={row.original.success ? 'default' : 'destructive'}>
            {row.original.success
              ? t('auditLog.status.success', 'Success')
              : t('auditLog.status.failed', 'Failed')}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: t('auditLog.table.actions', 'Actions'),
        cell: ({ row }) => {
          const item = row.original
          if (!item.success) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedHistory(item)
                  setIsErrorDialogOpen(true)
                }}
                disabled={!item.errorMessage}
              >
                <IconAlertCircle className="w-4 h-4 mr-1" />
                {t('auditLog.actions.viewError', 'View Error')}
              </Button>
            )
          }
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedHistory(item)
                setIsDiffOpen(true)
              }}
              disabled={!item.resourceYaml && !item.previousYaml}
            >
              <IconEye className="w-4 h-4 mr-1" />
              {t('auditLog.actions.viewDiff', 'View Diff')}
            </Button>
          )
        },
      },
    ],
    [getOperationTypeLabel, showCluster, t]
  )

  const table = useReactTable({
    data: auditData?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { pagination },
    onPaginationChange: setPagination,
    manualPagination: true,
    pageCount: Math.ceil((auditData?.total ?? 0) / pagination.pageSize) || 0,
  })

  const emptyState = (() => {
    if (isLoading) {
      return (
        <div className="py-10 text-center text-muted-foreground">
          {t('auditLog.loading', 'Loading audit logs...')}
        </div>
      )
    }
    if (error) {
      return (
        <div className="py-10 text-center text-destructive">
          {t('auditLog.loadFailed', 'Failed to load audit logs')}
        </div>
      )
    }
    if ((auditData?.data.length ?? 0) === 0) {
      return (
        <div className="py-10 text-center text-muted-foreground">
          {t('auditLog.empty', 'No audit logs found')}
        </div>
      )
    }
    return null
  })()

  const totalRowCount = auditData?.total ?? 0
  const filteredRowCount = auditData?.data.length ?? 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('auditLog.title', 'Audit Logs')}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t(
                'auditLog.description',
                'Track who changed resources and review YAML diffs'
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              placeholder={t(
                'auditLog.filters.search',
                'Search resource name...'
              )}
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              className="w-64"
            />
            <Select
              value={operationFilter || 'all'}
              onValueChange={handleOperationChange}
            >
              <SelectTrigger className="w-44">
                <SelectValue
                  placeholder={t(
                    'auditLog.filters.operation',
                    'All operations'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('auditLog.filters.allOperations', 'All operations')}
                </SelectItem>
                <SelectItem value="create">
                  {t('resourceHistory.create')}
                </SelectItem>
                <SelectItem value="update">
                  {t('resourceHistory.update')}
                </SelectItem>
                <SelectItem value="delete">
                  {t('resourceHistory.delete')}
                </SelectItem>
                <SelectItem value="apply">
                  {t('resourceHistory.apply')}
                </SelectItem>
                <SelectItem value="patch">
                  {t('resourceHistory.patch')}
                </SelectItem>
              </SelectContent>
            </Select>
            {showCluster && (
              <Select
                value={clusterFilter || 'all'}
                onValueChange={handleClusterChange}
              >
                <SelectTrigger className="w-56">
                  <SelectValue
                    placeholder={t('auditLog.filters.cluster', 'All clusters')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('auditLog.filters.allClusters', 'All clusters')}
                  </SelectItem>
                  {clusters.map((cluster) => (
                    <SelectItem key={cluster.name} value={cluster.name}>
                      {cluster.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={operatorId ? String(operatorId) : 'all'}
              onValueChange={handleUserFilterChange}
            >
              <SelectTrigger className="w-56">
                <SelectValue
                  placeholder={t('auditLog.filters.user', 'All users')}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('auditLog.filters.allUsers', 'All users')}
                </SelectItem>
                {(usersData?.users ?? []).map((user) => (
                  <SelectItem key={user.id} value={String(user.id)}>
                    {user.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResourceTableView
          table={table}
          columnCount={columns.length}
          isLoading={isLoading}
          data={auditData?.data}
          allPageSize={totalRowCount}
          emptyState={emptyState}
          hasActiveFilters={
            Boolean(operatorId) ||
            Boolean(searchQuery) ||
            Boolean(operationFilter) ||
            (showCluster && Boolean(clusterFilter))
          }
          filteredRowCount={filteredRowCount}
          totalRowCount={totalRowCount}
          searchQuery={searchQuery}
          pagination={pagination}
          setPagination={setPagination}
          maxBodyHeightClassName="max-h-[600px]"
        />
      </CardContent>

      {selectedHistory && (
        <YamlDiffViewer
          open={isDiffOpen}
          onOpenChange={(open) => {
            setIsDiffOpen(open)
            if (!open) {
              setSelectedHistory(null)
            }
          }}
          original={selectedHistory.previousYaml || ''}
          modified={selectedHistory.resourceYaml || ''}
          title={t('auditLog.diffTitle', 'YAML Diff')}
          height={560}
        />
      )}

      <Dialog
        open={isErrorDialogOpen}
        onOpenChange={(open) => {
          setIsErrorDialogOpen(open)
          if (!open) {
            setSelectedHistory(null)
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t('auditLog.errorTitle', 'Error Details')}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {selectedHistory?.errorMessage ||
              t('auditLog.noErrorMessage', 'No error message')}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
