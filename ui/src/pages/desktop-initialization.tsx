import { useEffect, useState } from 'react'
import Logo from '@/assets/icon.svg'
import {
  IconArrowRight,
  IconArrowUpRight,
  IconChevronDown,
  IconServer,
  IconWorld,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { importClusters, useClusterList } from '@/lib/api'
import { setCurrentCluster } from '@/lib/current-cluster'
import { DesktopService, events } from '@/lib/mygo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ClusterImportDialog } from '@/components/settings/cluster-import-dialog'

export function DesktopInitializationPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const {
    data: clusters = [],
    isLoading,
    error,
    refetch,
  } = useClusterList({ refetchInterval: 3000 })
  const [selected, setSelected] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importConfig, setImportConfig] = useState('')
  const [importPath, setImportPath] = useState('')
  const [importVersion, setImportVersion] = useState(0)
  const [importError, setImportError] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const selectedCluster =
    clusters.find((cluster) => cluster.name === selected) ??
    clusters.find((cluster) => cluster.isDefault) ??
    clusters[0]

  useEffect(
    () =>
      events.desktopCommand.on((command) => {
        if (command.action !== 'import-kubeconfig') return
        setImportConfig(command.config ?? '')
        setImportPath(command.path ?? '')
        setImportError(
          command.error ? t('clusterManagement.messages.fileReadError') : ''
        )
        setImportVersion((version) => version + 1)
        setImportOpen(true)
      }),
    [t]
  )

  const handleImport = async (config: string, path?: string) => {
    setImportError('')
    setIsImporting(true)
    try {
      const importedCount = path
        ? await DesktopService.importKubeconfig(path)
        : (await importClusters({ config })).importedCount
      if (!importedCount) {
        setImportError(t('desktop.setup.noContexts'))
        return
      }
      await refetch()
      setImportOpen(false)
    } catch (err) {
      setImportError(
        err instanceof Error
          ? err.message
          : t('initialization.step2.importError')
      )
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="desktop-child-titlebar fixed inset-x-0 top-0 z-10 flex items-center border-b bg-sidebar">
        <span className="text-sm font-medium text-muted-foreground">Kite</span>
      </div>
      <div className="min-h-dvh pt-12 [font-family:var(--font-sans)] lg:grid lg:grid-cols-[20rem_1fr] xl:grid-cols-[24rem_1fr]">
        <aside className="flex flex-col border-b bg-[#f7f8fc] px-6 py-6 dark:bg-muted/30 sm:px-8 lg:min-h-full lg:border-r lg:border-b-0 lg:py-8 xl:px-10">
          <div className="flex items-center gap-3">
            <img src={Logo} alt="" className="size-9" />
            <span className="font-mono text-2xl font-semibold tracking-tight">
              Kite
            </span>
          </div>
          <div className="mt-8 lg:mt-16">
            <h1 className="text-2xl font-semibold tracking-tight lg:text-[1.75rem]">
              {t('initialization.welcome')}
            </h1>
            <p className="mt-3 text-base leading-6 text-muted-foreground">
              {t('desktop.setup.subtitle')}
            </p>
          </div>
          <div className="mt-auto hidden items-center gap-6 pt-12 text-sm text-muted-foreground lg:flex">
            <a
              href="https://kitehq.dev"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              {t('initialization.documentation')}{' '}
              <IconArrowUpRight className="size-4" />
            </a>
            <a
              href="https://github.com/zxh326/kite"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              GitHub <IconArrowUpRight className="size-4" />
            </a>
          </div>
        </aside>
        <main className="relative min-w-0 px-6 py-8 sm:px-10 lg:flex lg:items-center lg:px-16 lg:py-16">
          <div className="absolute top-5 right-6 lg:right-8">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="gap-2 text-sm font-normal"
                  aria-label={t('common.fields.language')}
                >
                  <IconWorld className="size-4 text-muted-foreground" />
                  {i18n.language.startsWith('zh') ? '中文' : 'English'}
                  <IconChevronDown className="size-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => i18n.changeLanguage('en')}>
                  English
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => i18n.changeLanguage('zh')}>
                  中文
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mx-auto w-full max-w-[38rem] pt-12 lg:pt-0">
            <header className="mb-6">
              <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                {t('desktop.setup.heading')}
              </h2>
              <p className="mt-2 text-base leading-6 text-muted-foreground">
                {t(
                  isLoading
                    ? 'desktop.setup.loadingDescription'
                    : clusters.length
                      ? 'desktop.setup.description'
                      : 'desktop.setup.emptyDescription'
                )}
              </p>
            </header>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">
                {t('cluster.loading')}
              </p>
            ) : error ? (
              <Alert variant="destructive">
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : clusters.length > 0 ? (
              <div
                className="max-h-80 space-y-2 overflow-y-auto"
                role="radiogroup"
                aria-label={t('desktop.setup.heading')}
              >
                {clusters.map((cluster) => (
                  <label
                    key={cluster.name}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="cluster"
                      value={cluster.name}
                      checked={selectedCluster?.name === cluster.name}
                      onChange={() => setSelected(cluster.name)}
                    />
                    <IconServer className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {cluster.name}
                    </span>
                    {cluster.isDefault && (
                      <span className="text-xs text-muted-foreground">
                        {t('desktop.setup.defaultCluster')}
                      </span>
                    )}
                    {cluster.error && (
                      <span className="text-xs text-destructive">
                        {t('desktop.setup.connectionError')}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              {selectedCluster && !error && (
                <Button
                  className="gap-2"
                  onClick={() => {
                    setCurrentCluster(selectedCluster.name)
                    localStorage.setItem('kite-desktop-setup-complete', 'true')
                    navigate('/', { replace: true })
                  }}
                >
                  {t('desktop.setup.continue')}{' '}
                  <IconArrowRight className="size-4" />
                </Button>
              )}
              <Button
                variant={selectedCluster ? 'outline' : 'default'}
                disabled={isLoading || !!error}
                onClick={() => {
                  setImportConfig('')
                  setImportPath('')
                  setImportError('')
                  setImportVersion((version) => version + 1)
                  setImportOpen(true)
                }}
              >
                {t('clusterManagement.actions.import')}
              </Button>
            </div>
          </div>
        </main>
      </div>
      <ClusterImportDialog
        key={importVersion}
        open={importOpen}
        onOpenChange={setImportOpen}
        onSubmit={handleImport}
        isSubmitting={isImporting}
        error={importError}
        initialConfig={importConfig}
        initialPath={importPath}
        pickKubeconfig={DesktopService.pickKubeconfig}
      />
    </div>
  )
}
