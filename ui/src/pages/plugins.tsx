import { useMemo, useRef, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { usePlugins } from '@/plugins/plugin-context'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Check, Puzzle, RefreshCw, Search, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import gt from 'semver/functions/gt'
import rcompare from 'semver/functions/rcompare'
import { toast } from 'sonner'

import {
  deletePlugin,
  installPlugin,
  updatePlugin,
  useInstalledPlugins,
  usePluginCatalog,
  type CatalogPlugin,
  type InstalledPlugin,
} from '@/lib/api/plugins'
import { usePageTitle } from '@/hooks/use-page-title'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'
import { PluginReadme } from '@/components/plugins/plugin-readme'
import { PluginSettingsDialog } from '@/components/plugins/plugin-settings-dialog'
import { ResourceTableView } from '@/components/resource-table-view'

export function PluginManagementPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin() ?? false
  const queryClient = useQueryClient()
  const installed = useInstalledPlugins(isAdmin)
  const catalog = usePluginCatalog(isAdmin)
  const { plugins, loadPlugin } = usePlugins()
  const [params, setParams] = useSearchParams()
  const tab = ['catalog', 'installed'].includes(params.get('tab') ?? '')
    ? params.get('tab')!
    : 'catalog'
  const [search, setSearch] = useState('')
  const [selectedVersions, setSelectedVersions] = useState<
    Record<string, string>
  >({})
  const [catalogPagination, setCatalogPagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  })
  const [installedPagination, setInstalledPagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  })
  const [deleting, setDeleting] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [readmePlugin, setReadmePlugin] = useState<CatalogPlugin | null>(null)
  const readmeTrigger = useRef<string | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  usePageTitle(t('plugins.title'))

  const action = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => {
      setDeleting(null)
      toast.success(t('plugins.saved'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['plugins'] }),
  })
  const setTab = (value: string) => {
    if (value) setParams({ tab: value })
  }
  const catalogVersions = useMemo(() => {
    const groups = new Map<string, CatalogPlugin[]>()
    for (const plugin of catalog.data?.plugins ?? []) {
      const versions = groups.get(plugin.id) ?? []
      versions.push(plugin)
      groups.set(plugin.id, versions)
    }
    for (const versions of groups.values()) {
      versions.sort((a, b) => rcompare(a.version, b.version))
    }
    return groups
  }, [catalog.data?.plugins])
  const entries = useMemo(
    () =>
      [...catalogVersions.values()].map(
        (versions) => versions.find((plugin) => !plugin.error) ?? versions[0]
      ),
    [catalogVersions]
  )
  const catalogRows = useMemo(
    () =>
      entries
        .map(
          (plugin) =>
            catalogVersions
              .get(plugin.id)!
              .find((entry) => entry.version === selectedVersions[plugin.id]) ??
            plugin
        )
        .filter((plugin) =>
          `${plugin.name} ${plugin.id} ${plugin.description ?? ''}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        ),
    [entries, catalogVersions, selectedVersions, search]
  )
  const installedRows = useMemo(
    () =>
      (installed.data?.plugins ?? [])
        .map((plugin) => ({
          plugin,
          manifest: plugin.manifest,
          runtime: plugins.find((item) => item.manifest.id === plugin.id),
          latest: entries.find(
            (entry) =>
              entry.id === plugin.id &&
              !entry.error &&
              gt(entry.version, plugin.version)
          ),
        }))
        .filter(({ plugin, manifest }) =>
          `${manifest?.name ?? ''} ${plugin.id} ${manifest?.description ?? ''}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        ),
    [installed.data?.plugins, plugins, entries, search]
  )
  const installFromCatalog = (
    plugin: CatalogPlugin,
    existing?: InstalledPlugin
  ) => {
    return installPlugin(
      {
        id: plugin.id,
        version: plugin.version,
      },
      existing?.enabled ?? true
    )
  }

  const catalogColumn = createColumnHelper<(typeof catalogRows)[number]>()
  const catalogColumns = [
    catalogColumn.display({
      id: 'name',
      header: t('plugins.plugin'),
      cell: ({ row: { original: plugin } }) => (
        <div className="min-w-48">
          <button
            id={`plugin-readme-${plugin.id}`}
            type="button"
            className="block truncate font-medium app-link"
            aria-label={t('plugins.previewReadme', { name: plugin.name })}
            onClick={(event) => {
              readmeTrigger.current = event.currentTarget.id
              setReadmePlugin(plugin)
            }}
          >
            {plugin.name}
          </button>
          {plugin.author && (
            <div className="truncate text-xs text-muted-foreground">
              @{plugin.author}
            </div>
          )}
        </div>
      ),
    }),
    catalogColumn.display({
      id: 'version',
      header: t('common.fields.version'),
      cell: ({ row: { original: plugin } }) => (
        <Select
          value={plugin.version}
          disabled={action.isPending}
          onValueChange={(version) =>
            setSelectedVersions((previous) => ({
              ...previous,
              [plugin.id]: version,
            }))
          }
        >
          <SelectTrigger
            className="w-32 tabular-nums"
            size="sm"
            aria-label={t('common.fields.version')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {catalogVersions.get(plugin.id)!.map((entry) => (
              <SelectItem key={entry.version} value={entry.version}>
                {entry.version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    }),
    catalogColumn.display({
      id: 'description',
      header: t('common.fields.description'),
      cell: ({ row: { original: plugin } }) => (
        <span
          className="block min-w-64 whitespace-normal break-words text-left text-pretty text-sm leading-5 text-muted-foreground line-clamp-2"
          title={plugin.description}
        >
          {plugin.description || '-'}
        </span>
      ),
    }),
    catalogColumn.display({
      id: 'actions',
      header: t('common.fields.actions'),
      cell: ({ row: { original: plugin } }) => {
        const existing = installed.data?.plugins.find(
          (item) => item.id === plugin.id
        )
        if (existing?.version === plugin.version) {
          return (
            <span className="inline-flex h-8 items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="size-4" aria-hidden="true" />
              {t('plugins.alreadyInstalled')}
            </span>
          )
        }
        return (
          <div className="space-y-1">
            <Button
              size="sm"
              variant="outline"
              disabled={
                action.isPending || !installed.isSuccess || !!plugin.error
              }
              onClick={() =>
                action.mutate(() => installFromCatalog(plugin, existing))
              }
            >
              {t(
                existing && gt(plugin.version, existing.version)
                  ? 'plugins.update'
                  : 'plugins.install'
              )}
            </Button>
            {plugin.error && (
              <p className="max-w-xs whitespace-normal text-pretty text-xs text-destructive">
                {plugin.error}
              </p>
            )}
          </div>
        )
      },
    }),
  ]
  const installedColumn = createColumnHelper<(typeof installedRows)[number]>()
  const installedColumns = [
    installedColumn.display({
      id: 'name',
      header: t('plugins.plugin'),
      cell: ({
        row: {
          original: { plugin, manifest },
        },
      }) => (
        <div className="min-w-48">
          <div className="truncate font-medium">
            {manifest?.name ?? plugin.id}
          </div>
          {manifest?.author && (
            <div className="truncate text-xs text-muted-foreground">
              @{manifest.author}
            </div>
          )}
        </div>
      ),
    }),
    installedColumn.display({
      id: 'version',
      header: t('common.fields.version'),
      cell: ({
        row: {
          original: { plugin, latest },
        },
      }) => (
        <div className="space-y-1">
          <span className="tabular-nums">{plugin.version}</span>
          {latest && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {t('plugins.availableVersion', { version: latest.version })}
            </p>
          )}
        </div>
      ),
    }),
    installedColumn.display({
      id: 'description',
      header: t('common.fields.description'),
      cell: ({
        row: {
          original: { manifest },
        },
      }) => (
        <span
          className="block min-w-64 whitespace-normal break-words text-left text-pretty text-sm leading-5 text-muted-foreground line-clamp-2"
          title={manifest?.description}
        >
          {manifest?.description || '-'}
        </span>
      ),
    }),
    installedColumn.display({
      id: 'status',
      header: t('common.fields.status'),
      cell: ({
        row: {
          original: { plugin, runtime },
        },
      }) => (
        <div className="space-y-1">
          <Badge variant="outline" className="px-1.5 text-muted-foreground">
            {t(plugin.enabled ? 'plugins.enabled' : 'plugins.disabled')}
          </Badge>
          {(plugin.error || runtime?.error) && (
            <p
              role="alert"
              className="max-w-xs whitespace-normal break-words text-pretty text-xs text-destructive"
            >
              {plugin.error || runtime?.error}
            </p>
          )}
        </div>
      ),
    }),
    installedColumn.display({
      id: 'actions',
      header: t('common.fields.actions'),
      cell: ({
        row: {
          original: { plugin, manifest, runtime, latest },
        },
      }) => (
        <div className="flex items-center justify-end gap-2">
          {manifest?.settings && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                action.isPending ||
                !plugin.enabled ||
                !runtime ||
                runtime.invalid
              }
              onClick={() => {
                loadPlugin(plugin.id)
                setConfiguring(plugin.id)
              }}
            >
              {t('plugins.configure')}
            </Button>
          )}
          {latest && (
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(() => installFromCatalog(latest, plugin))
              }
            >
              {t('plugins.update')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(() =>
                updatePlugin(plugin.id, { enabled: !plugin.enabled })
              )
            }
          >
            {t(plugin.enabled ? 'plugins.disable' : 'plugins.enable')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() => {
              action.reset()
              setDeleting(plugin.id)
            }}
          >
            {t('plugins.uninstall')}
          </Button>
        </div>
      ),
    }),
  ]
  const catalogTable = useReactTable({
    data: catalogRows,
    columns: catalogColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (plugin) => plugin.id,
    enableSorting: false,
    state: { pagination: catalogPagination },
    onPaginationChange: setCatalogPagination,
  })
  const installedTable = useReactTable({
    data: installedRows,
    columns: installedColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: ({ plugin }) => plugin.id,
    enableSorting: false,
    state: { pagination: installedPagination },
    onPaginationChange: setInstalledPagination,
  })
  const isCatalog = tab === 'catalog'
  const isLoading = installed.isLoading || (isCatalog && catalog.isLoading)
  const empty = isCatalog
    ? catalogRows.length === 0
    : installedRows.length === 0
  const hasFilters = Boolean(search)
  const emptyState = isLoading ? (
    <Skeleton className="h-72 w-full" />
  ) : empty ? (
    <div className="flex h-72 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full bg-muted/30 p-6">
        <Puzzle className="size-12 text-muted-foreground" />
      </div>
      <h3 className="text-balance text-lg font-medium">
        {t(
          hasFilters
            ? 'plugins.noSearchResults'
            : isCatalog
              ? 'plugins.emptyCatalog'
              : 'plugins.emptyInstalled'
        )}
      </h3>
      {hasFilters ? (
        <Button variant="outline" onClick={() => setSearch('')}>
          {t('plugins.clearFilters')}
        </Button>
      ) : isCatalog ? (
        <Button variant="outline" asChild>
          <Link to="/settings?tab=general">
            {t('plugins.configureCatalog')}
          </Link>
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setTab('catalog')}>
          {t('plugins.browseCatalog')}
        </Button>
      )}
    </div>
  ) : null

  if (!isAdmin) return <p>{t('plugins.adminOnly')}</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            className="w-full sm:w-fit"
            value={tab}
            onValueChange={setTab}
            aria-label={t('plugins.title')}
          >
            <ToggleGroupItem
              value="catalog"
              className="px-3 max-sm:whitespace-normal max-sm:text-xs"
            >
              {t('plugins.catalog')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="installed"
              className="px-3 max-sm:whitespace-normal max-sm:text-xs"
            >
              {t('plugins.installed')}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="outline"
            size="icon"
            disabled={catalog.isFetching || action.isPending}
            aria-label={t('plugins.refreshCatalog')}
            title={t('plugins.refreshCatalog')}
            onClick={() => void catalog.refetch()}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="relative min-w-0 flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9 pr-4"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('plugins.search')}
              aria-label={t('plugins.search')}
            />
          </div>
          <input
            ref={upload}
            type="file"
            accept=".tar.gz,.tgz"
            className="hidden"
            aria-label={t('plugins.upload')}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file)
                action.mutate(async () => {
                  await installPlugin(file)
                  setTab('installed')
                })
              event.target.value = ''
            }}
          />
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => upload.current?.click()}
          >
            <Upload className="size-4" />
            {t('plugins.upload')}
          </Button>
        </div>
      </div>
      <p className="text-pretty text-xs text-muted-foreground">
        {t('plugins.trust')}
      </p>
      {action.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {action.error.message}
        </p>
      )}
      {action.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('plugins.working')}
        </p>
      )}
      {installed.error && (
        <p role="alert" className="text-sm text-destructive">
          {installed.error.message}
        </p>
      )}
      {isCatalog && catalog.error && (
        <p role="alert" className="text-sm text-destructive">
          {catalog.error.message}
        </p>
      )}
      {isCatalog && (
        <ResourceTableView
          table={catalogTable}
          columnCount={catalogColumns.length}
          isLoading={isLoading}
          data={catalogRows}
          fitViewportHeight
          emptyState={emptyState}
          hasActiveFilters={hasFilters}
          filteredRowCount={catalogRows.length}
          totalRowCount={entries.length}
          searchQuery={search}
          pagination={catalogPagination}
          setPagination={setCatalogPagination}
          shrinkFirstColumn={false}
        />
      )}
      {tab === 'installed' && (
        <ResourceTableView
          table={installedTable}
          columnCount={installedColumns.length}
          isLoading={isLoading}
          data={installedRows}
          fitViewportHeight
          emptyState={emptyState}
          hasActiveFilters={hasFilters}
          filteredRowCount={installedRows.length}
          totalRowCount={installed.data?.plugins.length ?? 0}
          searchQuery={search}
          pagination={installedPagination}
          setPagination={setInstalledPagination}
          shrinkFirstColumn={false}
        />
      )}
      <PluginReadme
        plugin={readmePlugin}
        onClose={() => setReadmePlugin(null)}
        triggerId={readmeTrigger.current}
      />
      <DeleteConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        resourceName={deleting ?? ''}
        resourceType={t('plugins.plugin')}
        onConfirm={() => {
          if (deleting)
            action.mutate(async () => {
              await deletePlugin(deleting)
              queryClient.removeQueries({
                queryKey: ['plugin-settings', deleting],
              })
            })
        }}
        isDeleting={action.isPending}
      />
      {configuring && (
        <PluginSettingsDialog
          pluginId={configuring}
          onClose={() => setConfiguring(null)}
        />
      )}
    </div>
  )
}
