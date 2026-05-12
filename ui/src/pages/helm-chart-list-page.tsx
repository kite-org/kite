import { useEffect, useMemo, useState, type SubmitEvent } from 'react'
import { useAuth } from '@/contexts/auth-context'
import {
  ColumnFiltersState,
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  PaginationState,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table'
import {
  Box,
  Database,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { HelmChart, HelmRepository } from '@/types/api'
import {
  createHelmRepository,
  deleteHelmRepository,
  useArtifactHubCharts,
  useHelmCharts,
  useHelmRepositories,
} from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'
import { ErrorMessage } from '@/components/error-message'
import { HelmChartIcon } from '@/components/helm-chart-icon'
import { ResourceTableView } from '@/components/resource-table-view'

const allRepositories = 'all'
const artifactHubSource = 'artifacthub'
const repositoriesSource = 'repositories'
const columnHelper = createColumnHelper<HelmChart>()
type ChartSource = typeof artifactHubSource | typeof repositoriesSource
type HelmChartListSessionState = {
  chartSource?: ChartSource
  verifiedPublisherOnly?: boolean
  searchQuery?: string
  repositoryFilter?: string
  pagination?: PaginationState
}

const helmChartListSessionStorageKey = 'kite-helm-chart-list-state'
const defaultPagination: PaginationState = {
  pageIndex: 0,
  pageSize: 20,
}

function readHelmChartListSessionState(): HelmChartListSessionState {
  const value = sessionStorage.getItem(helmChartListSessionStorageKey)
  if (!value) {
    return {}
  }

  try {
    const state = JSON.parse(value) as HelmChartListSessionState
    const pagination = state.pagination

    return {
      chartSource:
        state.chartSource === artifactHubSource ||
        state.chartSource === repositoriesSource
          ? state.chartSource
          : undefined,
      verifiedPublisherOnly:
        typeof state.verifiedPublisherOnly === 'boolean'
          ? state.verifiedPublisherOnly
          : undefined,
      searchQuery:
        typeof state.searchQuery === 'string' ? state.searchQuery : undefined,
      repositoryFilter:
        typeof state.repositoryFilter === 'string'
          ? state.repositoryFilter
          : undefined,
      pagination:
        pagination &&
        Number.isInteger(pagination.pageIndex) &&
        pagination.pageIndex >= 0 &&
        Number.isInteger(pagination.pageSize) &&
        pagination.pageSize > 0
          ? pagination
          : undefined,
    }
  } catch {
    return {}
  }
}

function chartDetailPath(chart: HelmChart) {
  const path = `/charts/${encodeURIComponent(chart.repositoryName)}/${encodeURIComponent(chart.name)}`
  if (chart.source !== artifactHubSource) {
    return path
  }
  return `${path}?source=${artifactHubSource}`
}

function ChartNameLink({ chart }: { chart: HelmChart }) {
  return (
    <Link
      to={chartDetailPath(chart)}
      className="block truncate font-medium app-link"
    >
      {chart.name}
    </Link>
  )
}

function chartMatchesSearch(chart: HelmChart, query: string) {
  const searchQuery = query.trim().toLowerCase()
  if (!searchQuery) {
    return true
  }

  return [
    chart.name,
    chart.repositoryName,
    chart.version,
    chart.appVersion,
    chart.description,
    ...(chart.keywords || []),
  ].some((value) => value?.toLowerCase().includes(searchQuery))
}

function AddRepositoryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [url, setURL] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await createHelmRepository({ name, url, username, password })
      toast.success(t('helmCharts.messages.repositoryAdded'))
      setName('')
      setURL('')
      setUsername('')
      setPassword('')
      onOpenChange(false)
      await onCreated()
    } catch (err) {
      setError(translateError(err, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('helmCharts.actions.addRepository')}</DialogTitle>
            <DialogDescription>
              {t('helmCharts.messages.addRepositoryDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="helm-repository-name">
                {t('common.fields.name')}
              </Label>
              <Input
                id="helm-repository-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="helm-repository-url">URL</Label>
              <Input
                id="helm-repository-url"
                type="url"
                value={url}
                onChange={(event) => setURL(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="helm-repository-username">
                  {t('common.fields.username')}
                </Label>
                <Input
                  id="helm-repository-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="helm-repository-password">
                  {t('common.fields.password')}
                </Label>
                <Input
                  id="helm-repository-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.actions.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HelmChartListPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [initialSessionState] = useState(readHelmChartListSessionState)
  const [chartSource, setChartSource] = useState<ChartSource>(
    initialSessionState.chartSource ?? artifactHubSource
  )
  const [verifiedPublisherOnly, setVerifiedPublisherOnly] = useState(
    initialSessionState.verifiedPublisherOnly ?? false
  )
  const [searchQuery, setSearchQuery] = useState(
    initialSessionState.searchQuery ?? ''
  )
  const [repositoryFilter, setRepositoryFilter] = useState(
    initialSessionState.repositoryFilter ?? allRepositories
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [repositoryToDelete, setRepositoryToDelete] =
    useState<HelmRepository | null>(null)
  const [isDeletingRepository, setIsDeletingRepository] = useState(false)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [pagination, setPagination] = useState<PaginationState>(
    initialSessionState.pagination ?? defaultPagination
  )
  const selectedRepository =
    repositoryFilter === allRepositories ? undefined : repositoryFilter
  const isArtifactHubSource = chartSource === artifactHubSource
  const canManageRepositories = user?.isAdmin() ?? false

  usePageTitle(t('nav.helmCharts'))

  useEffect(() => {
    sessionStorage.setItem(
      helmChartListSessionStorageKey,
      JSON.stringify({
        chartSource,
        verifiedPublisherOnly,
        searchQuery,
        repositoryFilter,
        pagination,
      })
    )
  }, [
    chartSource,
    verifiedPublisherOnly,
    searchQuery,
    repositoryFilter,
    pagination,
  ])

  const { data: repositories = [], refetch: refetchRepositories } =
    useHelmRepositories()
  const selectedRepositoryItem = repositories.find(
    (repository) => repository.name === selectedRepository
  )
  const localChartsQuery = useHelmCharts({
    repository: selectedRepository,
    enabled: !isArtifactHubSource,
  })
  const artifactHubChartsQuery = useArtifactHubCharts({
    query: searchQuery,
    verifiedPublisher: verifiedPublisherOnly,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    enabled: isArtifactHubSource,
  })
  const activeChartsQuery = isArtifactHubSource
    ? artifactHubChartsQuery
    : localChartsQuery
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch: refetchCharts,
  } = activeChartsQuery
  const charts = data?.items || []
  const totalRowCount = isArtifactHubSource
    ? (data?.total ?? charts.length)
    : charts.length

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: t('helm.fields.chart'),
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-[22rem] items-center gap-3">
            <HelmChartIcon
              icon={row.original.icon}
              name={row.original.name}
              className="size-8"
            />
            <div className="min-w-0">
              <ChartNameLink chart={row.original} />
              <div className="truncate text-xs text-muted-foreground">
                {row.original.repositoryName}
              </div>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('version', {
        header: t('helm.fields.version'),
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue() || '-'}</span>
        ),
      }),
      columnHelper.accessor('appVersion', {
        header: t('helm.fields.appVersion'),
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue() || '-'}</span>
        ),
      }),
      columnHelper.accessor('description', {
        header: t('common.fields.description'),
        cell: ({ getValue }) => (
          <span className="block whitespace-normal break-words text-left text-sm leading-5 text-muted-foreground line-clamp-2">
            {getValue() || '-'}
          </span>
        ),
      }),
      columnHelper.accessor('updatedAt', {
        header: t('helmCharts.fields.updatedAt'),
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {getValue() ? formatDate(getValue() || '') : '-'}
          </span>
        ),
      }),
    ],
    [t]
  )

  const table = useReactTable({
    data: charts,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    enableSorting: false,
    manualPagination: isArtifactHubSource,
    pageCount: isArtifactHubSource
      ? Math.ceil(totalRowCount / pagination.pageSize) || 0
      : undefined,
    getRowId: (chart) =>
      `${chart.source || repositoriesSource}/${chart.repositoryUrl}/${chart.name}`,
    globalFilterFn: (row, _columnId, value) =>
      chartMatchesSearch(row.original, String(value)),
    state: {
      columnFilters,
      globalFilter: isArtifactHubSource ? '' : searchQuery,
      columnVisibility,
      pagination,
    },
    autoResetPageIndex: false,
  })

  const handleCreated = async () => {
    await Promise.all([refetchRepositories(), localChartsQuery.refetch()])
  }

  const handleDeleteRepository = async () => {
    if (!repositoryToDelete) {
      return
    }
    setIsDeletingRepository(true)
    try {
      await deleteHelmRepository(repositoryToDelete.id)
      toast.success(t('helmCharts.messages.repositoryDeleted'))
      setRepositoryFilter(allRepositories)
      setRepositoryToDelete(null)
      await Promise.all([refetchRepositories(), localChartsQuery.refetch()])
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setIsDeletingRepository(false)
    }
  }

  const updateChartSource = (value: string) => {
    if (!value) {
      return
    }
    setChartSource(value as ChartSource)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }

  const updateSearchQuery = (value: string) => {
    setSearchQuery(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }

  const updateVerifiedPublisherOnly = (value: boolean) => {
    setVerifiedPublisherOnly(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }

  const updateRepositoryFilter = (value: string) => {
    setRepositoryFilter(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }

  const filteredRowCount = isArtifactHubSource
    ? charts.length
    : table.getFilteredRowModel().rows.length
  const emptyState = (() => {
    if (isLoading && charts.length === 0) {
      return (
        <div className="flex h-72 flex-col items-center justify-center">
          <div className="mb-4 rounded-full bg-muted/30 p-6">
            <Database className="size-12 text-muted-foreground" />
          </div>
          <h3 className="mb-1 text-lg font-medium">
            {t('common.messages.loading')}
          </h3>
        </div>
      )
    }

    if (isError) {
      return (
        <ErrorMessage
          resourceName={t('nav.helmCharts')}
          error={error}
          refetch={refetchCharts}
        />
      )
    }

    if (charts.length === 0) {
      return (
        <div className="flex h-72 flex-col items-center justify-center">
          <div className="mb-4 rounded-full bg-muted/30 p-6">
            <Box className="size-12 text-muted-foreground" />
          </div>
          <h3 className="mb-1 text-lg font-medium">
            {t('helmCharts.messages.noCharts')}
          </h3>
          {!isArtifactHubSource && canManageRepositories ? (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="size-4" />
              {t('helmCharts.actions.addRepository')}
            </Button>
          ) : null}
        </div>
      )
    }

    return null
  })()

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              value={chartSource}
              onValueChange={updateChartSource}
              aria-label={t('common.fields.source')}
            >
              <ToggleGroupItem value={artifactHubSource} className="px-3">
                {t('helmCharts.filters.artifactHub')}
              </ToggleGroupItem>
              <ToggleGroupItem value={repositoriesSource} className="px-3">
                {t('helmCharts.filters.repositories')}
              </ToggleGroupItem>
            </ToggleGroup>
            {!isArtifactHubSource ? (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Select
                  value={repositoryFilter}
                  onValueChange={updateRepositoryFilter}
                >
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={allRepositories}>
                      {t('helmCharts.filters.allRepositories')}
                    </SelectItem>
                    {repositories.map((repository) => (
                      <SelectItem key={repository.id} value={repository.name}>
                        {repository.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedRepositoryItem && canManageRepositories ? (
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t('helmCharts.actions.deleteRepository')}
                    onClick={() =>
                      setRepositoryToDelete(selectedRepositoryItem)
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
            {isArtifactHubSource ? (
              <div className="flex h-9 items-center gap-2 rounded-md border px-3">
                <Switch
                  id="artifacthub-verified-publisher"
                  checked={verifiedPublisherOnly}
                  onCheckedChange={updateVerifiedPublisherOnly}
                />
                <Label
                  htmlFor="artifacthub-verified-publisher"
                  className="whitespace-nowrap text-sm font-normal"
                >
                  {t('helmCharts.filters.verifiedPublisher')}
                </Label>
              </div>
            ) : null}
            <Button
              variant="outline"
              size="icon"
              disabled={isFetching}
              aria-label={t('common.actions.refresh')}
              onClick={() => void refetchCharts()}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-[280px]">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('helmCharts.placeholders.search')}
                  value={searchQuery}
                  onChange={(event) => updateSearchQuery(event.target.value)}
                  className="w-full pl-9 pr-4"
                />
              </div>
              {searchQuery ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => updateSearchQuery('')}
                  className="size-9"
                  aria-label={t('common.actions.close')}
                >
                  <XCircle className="size-4" />
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {!isArtifactHubSource && canManageRepositories ? (
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="size-4" />
                  {t('helmCharts.actions.addRepository')}
                </Button>
              ) : null}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Toggle columns"
                  >
                    <Settings2 className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {table
                    .getAllLeafColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => {
                      const header = column.columnDef.header
                      const headerText =
                        typeof header === 'string' ? header : column.id

                      return (
                        <DropdownMenuCheckboxItem
                          key={column.id}
                          className="capitalize"
                          checked={column.getIsVisible()}
                          onCheckedChange={(value) =>
                            column.toggleVisibility(!!value)
                          }
                        >
                          {headerText}
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {isArtifactHubSource ? (
          <p className="text-pretty text-xs text-muted-foreground">
            <Trans
              i18nKey="helmCharts.messages.artifactHubTrafficNotice"
              components={{
                artifactHub: (
                  <a
                    href="https://artifacthub.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="app-link"
                  />
                ),
              }}
            />
          </p>
        ) : null}

        <ResourceTableView
          table={table}
          columnCount={columns.length}
          isLoading={isLoading}
          data={charts}
          fitViewportHeight={true}
          emptyState={emptyState}
          hasActiveFilters={Boolean(searchQuery)}
          filteredRowCount={filteredRowCount}
          totalRowCount={totalRowCount}
          searchQuery={searchQuery}
          pagination={pagination}
          setPagination={setPagination}
          shrinkFirstColumn={false}
          showAllPageSize={!isArtifactHubSource}
        />
      </div>

      <AddRepositoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
      <DeleteConfirmationDialog
        open={Boolean(repositoryToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setRepositoryToDelete(null)
          }
        }}
        resourceName={repositoryToDelete?.name || ''}
        resourceType={t('helmCharts.fields.repository')}
        onConfirm={() => void handleDeleteRepository()}
        isDeleting={isDeletingRepository}
        additionalNote={t('helmCharts.messages.deleteRepositoryDescription')}
      />
    </>
  )
}
