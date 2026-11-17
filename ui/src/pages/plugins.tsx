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
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Puzzle,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import gt from 'semver/functions/gt'
import rcompare from 'semver/functions/rcompare'
import { toast } from 'sonner'

import {
  deletePlugin,
  installPlugin,
  updatePlugin,
  useCommunityPlugins,
  useInstalledPlugins,
  useNPMPluginUpdates,
  usePluginCatalog,
  type CatalogPlugin,
  type CommunityPlugin,
  type InstalledPlugin,
} from '@/lib/api/plugins'
import { usePageTitle } from '@/hooks/use-page-title'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  const npmUpdates = useNPMPluginUpdates(
    installed.data?.plugins,
    isAdmin && tab === 'installed'
  )
  const community = useCommunityPlugins(isAdmin && tab === 'catalog')
  const [search, setSearch] = useState('')
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
  const [npmOpen, setNpmOpen] = useState(false)
  const [communityInstall, setCommunityInstall] =
    useState<CommunityPlugin | null>(null)
  const [packageName, setPackageName] = useState('')
  const [registry, setRegistry] = useState<'npmjs' | 'npmmirror'>('npmjs')
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
  const catalogRows = useMemo<(CatalogPlugin | CommunityPlugin)[]>(
    () =>
      [...entries, ...(community.data?.plugins ?? [])].filter((plugin) =>
        `${'packageName' in plugin ? plugin.packageName : `${plugin.name} ${plugin.id}`} ${plugin.description ?? ''}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      ),
    [entries, community.data, search]
  )
  const installedRows = useMemo(
    () =>
      (installed.data?.plugins ?? [])
        .map((plugin) => {
          const npmUpdate = npmUpdates.updates[plugin.id]
          const latest = plugin.npm
            ? npmUpdate
            : entries.find((entry) => entry.id === plugin.id)
          return {
            plugin,
            manifest: plugin.manifest,
            runtime: plugins.find((item) => item.manifest.id === plugin.id),
            latest:
              latest?.version &&
              !latest.error &&
              gt(latest.version, plugin.version)
                ? latest.version
                : undefined,
            updateError: plugin.npm ? npmUpdate?.error : undefined,
          }
        })
        .filter(({ plugin, manifest }) =>
          `${manifest?.name ?? ''} ${plugin.id} ${manifest?.description ?? ''}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        ),
    [installed.data?.plugins, plugins, entries, npmUpdates.updates, search]
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
          original: { plugin, latest, updateError },
        },
      }) => (
        <div className="space-y-1">
          <span className="tabular-nums">{plugin.version}</span>
          {latest && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {t('plugins.availableVersion', { version: latest })}
            </p>
          )}
          {updateError && (
            <p
              role="alert"
              className="max-w-xs whitespace-normal text-xs text-destructive"
            >
              {t('plugins.updateCheckFailed', { error: updateError })}
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
                action.mutate(() =>
                  installPlugin(
                    { id: plugin.id, version: latest, npm: plugin.npm },
                    plugin.enabled
                  )
                )
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
  const catalogPageCount = Math.max(
    1,
    Math.ceil(catalogRows.length / catalogPagination.pageSize)
  )
  const catalogPageIndex = Math.min(
    catalogPagination.pageIndex,
    catalogPageCount - 1
  )
  const catalogPage = catalogRows.slice(
    catalogPageIndex * catalogPagination.pageSize,
    (catalogPageIndex + 1) * catalogPagination.pageSize
  )
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
  const emptyState =
    empty && (isLoading || (isCatalog && community.isLoading)) ? (
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
            disabled={
              catalog.isFetching ||
              community.isFetching ||
              npmUpdates.isFetching ||
              action.isPending
            }
            aria-label={t(
              isCatalog ? 'plugins.refreshCatalog' : 'plugins.checkUpdates'
            )}
            title={t(
              isCatalog ? 'plugins.refreshCatalog' : 'plugins.checkUpdates'
            )}
            onClick={() => {
              void catalog.refetch()
              if (isCatalog) void community.refetch()
              if (!isCatalog) void npmUpdates.refetch()
            }}
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
              onChange={(event) => {
                setSearch(event.target.value)
                setCatalogPagination((previous) => ({
                  ...previous,
                  pageIndex: 0,
                }))
              }}
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
          <Dialog
            open={npmOpen}
            onOpenChange={(open) => {
              if (action.isPending) return
              action.reset()
              setCommunityInstall(null)
              setNpmOpen(open)
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" disabled={action.isPending}>
                <Download className="size-4" />
                {t('plugins.installFromNpm')}
              </Button>
            </DialogTrigger>
            <DialogContent showCloseButton={!action.isPending}>
              <DialogHeader>
                <DialogTitle>{t('plugins.installFromNpm')}</DialogTitle>
                <DialogDescription>
                  {communityInstall
                    ? `${communityInstall.packageName} · ${communityInstall.version}`
                    : t('plugins.npmDescription')}
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (action.isPending || !packageName.trim()) return
                  action.mutate(async () => {
                    await installPlugin({
                      packageName: packageName.trim(),
                      registry,
                      version: communityInstall?.version,
                    })
                    setNpmOpen(false)
                    setPackageName('')
                    setCommunityInstall(null)
                    setTab('installed')
                  })
                }}
              >
                {communityInstall && (
                  <Alert>
                    <ShieldAlert className="size-4" />
                    <AlertTitle>{t('plugins.community')}</AlertTitle>
                    <AlertDescription>
                      {t('plugins.communityWarning')}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="npm-package-name">
                    {t('plugins.npmPackageName')}
                  </Label>
                  <Input
                    id="npm-package-name"
                    value={packageName}
                    onChange={(event) => setPackageName(event.target.value)}
                    placeholder={t('plugins.npmPackagePlaceholder')}
                    maxLength={214}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={action.isPending}
                    readOnly={communityInstall !== null}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="npm-registry">
                    {t('plugins.npmRegistry')}
                  </Label>
                  <Select
                    value={registry}
                    onValueChange={(value: 'npmjs' | 'npmmirror') =>
                      setRegistry(value)
                    }
                    disabled={action.isPending}
                  >
                    <SelectTrigger id="npm-registry" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="npmjs">npmjs</SelectItem>
                      <SelectItem value="npmmirror">npmmirror</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {action.error && (
                  <p
                    role="alert"
                    className="break-words text-sm text-destructive"
                  >
                    {action.error.message}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() => setNpmOpen(false)}
                  >
                    {t('common.actions.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={action.isPending || !packageName.trim()}
                  >
                    {t(
                      action.isPending ? 'plugins.working' : 'plugins.install'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <p className="flex items-start gap-2 text-pretty text-xs leading-5 text-muted-foreground">
        {isCatalog && (
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        )}
        {t(isCatalog ? 'plugins.catalogNotice' : 'plugins.trust')}
      </p>
      {action.error && !npmOpen && (
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
      {isCatalog && catalog.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('plugins.loadingCatalog')}
        </p>
      )}
      {isCatalog && community.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('plugins.loadingCommunity')}
        </p>
      )}
      {isCatalog && community.error && (
        <p role="alert" className="text-sm text-destructive">
          {t('plugins.communityLoadFailed', { error: community.error.message })}
        </p>
      )}
      {isCatalog && (
        <>
          {emptyState || (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {catalogPage.map((plugin) => {
                const isCommunity = 'packageName' in plugin
                const name = isCommunity ? plugin.packageName : plugin.name
                const author = isCommunity ? plugin.publisher : plugin.author
                const existing = installed.data?.plugins.find((item) =>
                  isCommunity
                    ? item.npmPackageName === plugin.packageName
                    : item.id === plugin.id
                )
                const isInstalled =
                  existing &&
                  (isCommunity
                    ? !gt(plugin.version, existing.version)
                    : existing.version === plugin.version)
                const error = isCommunity ? undefined : plugin.error
                return (
                  <Card
                    key={
                      isCommunity
                        ? `npm:${plugin.packageName}`
                        : `catalog:${plugin.id}`
                    }
                    className="min-w-0 gap-3 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {isCommunity ? (
                            <a
                              href={`https://www.npmjs.com/package/${plugin.packageName}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate text-sm font-medium app-link"
                              title={name}
                            >
                              {name}
                            </a>
                          ) : (
                            <button
                              id={`plugin-readme-${plugin.id}`}
                              type="button"
                              className="truncate text-sm font-medium app-link"
                              title={name}
                              aria-label={t('plugins.previewReadme', { name })}
                              onClick={(event) => {
                                readmeTrigger.current = event.currentTarget.id
                                setReadmePlugin(plugin)
                              }}
                            >
                              {name}
                            </button>
                          )}
                          {!isCommunity && (
                            <span
                              className="shrink-0 text-emerald-600 dark:text-emerald-400"
                              title={t('plugins.catalogListed')}
                            >
                              <BadgeCheck
                                className="size-4"
                                aria-label={t('plugins.catalogListed')}
                              />
                            </span>
                          )}
                        </div>
                        <p
                          className="truncate text-xs tabular-nums text-muted-foreground"
                          title={`${author ? `@${author}，` : ''}v${plugin.version}`}
                        >
                          {author && `@${author}，`}v{plugin.version}
                        </p>
                      </div>
                      {isInstalled ? (
                        <span className="inline-flex h-7 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Check className="size-3.5" aria-hidden="true" />
                          {t('plugins.alreadyInstalled')}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs"
                          disabled={
                            action.isPending || !installed.isSuccess || !!error
                          }
                          onClick={() => {
                            if (!isCommunity) {
                              action.mutate(() =>
                                installFromCatalog(plugin, existing)
                              )
                            } else if (existing) {
                              action.mutate(() =>
                                installPlugin(
                                  {
                                    id: existing.id,
                                    version: plugin.version,
                                    npm: true,
                                  },
                                  existing.enabled
                                )
                              )
                            } else {
                              action.reset()
                              setCommunityInstall(plugin)
                              setPackageName(plugin.packageName)
                              setNpmOpen(true)
                            }
                          }}
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          {t(
                            existing && gt(plugin.version, existing.version)
                              ? 'plugins.update'
                              : 'plugins.install'
                          )}
                        </Button>
                      )}
                    </div>
                    <p
                      className="min-h-10 text-pretty text-sm leading-5 text-muted-foreground line-clamp-2"
                      title={plugin.description}
                    >
                      {plugin.description || '-'}
                    </p>
                    {error && (
                      <p className="text-pretty text-xs text-destructive">
                        {error}
                      </p>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
          {!emptyState && (
            <div className="flex flex-wrap items-center justify-between gap-3 py-1 text-xs text-muted-foreground">
              <span>
                {t('plugins.resultCount', { count: catalogRows.length })}
              </span>
              <div className="flex items-center gap-3">
                <Select
                  value={String(catalogPagination.pageSize)}
                  onValueChange={(value) =>
                    setCatalogPagination({
                      pageIndex: 0,
                      pageSize: Number(value),
                    })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-auto text-xs"
                    aria-label={t('plugins.pageSize')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {t('plugins.perPage', { count: size })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="tabular-nums">
                  {catalogPageIndex + 1} / {catalogPageCount}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8"
                  aria-label={t('plugins.previousPage')}
                  disabled={catalogPageIndex === 0}
                  onClick={() =>
                    setCatalogPagination((previous) => ({
                      ...previous,
                      pageIndex: catalogPageIndex - 1,
                    }))
                  }
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8"
                  aria-label={t('plugins.nextPage')}
                  disabled={catalogPageIndex >= catalogPageCount - 1}
                  onClick={() =>
                    setCatalogPagination((previous) => ({
                      ...previous,
                      pageIndex: catalogPageIndex + 1,
                    }))
                  }
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
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
