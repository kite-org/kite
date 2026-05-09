import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import * as yaml from 'js-yaml'
import { Download, ExternalLink, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'

import type {
  HelmChartContentType,
  HelmChartDetail,
  HelmChartVersion,
} from '@/types/api'
import {
  installHelmRelease,
  useHelmChart,
  useHelmChartContent,
} from '@/lib/api'
import { cn, formatDate, translateError } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ErrorMessage } from '@/components/error-message'
import { HelmChartIcon } from '@/components/helm-chart-icon'
import { NamespaceSelector } from '@/components/selector/namespace-selector'
import { SimpleTable } from '@/components/simple-table'
import { SimpleYamlEditor } from '@/components/simple-yaml-editor'
import { TextViewer } from '@/components/text-viewer'

const artifactHubSource = 'artifacthub'

function chartDetailPath(chart: HelmChartDetail, version: string) {
  const params = new URLSearchParams({
    version,
    tab: 'versions',
  })
  if (chart.source === artifactHubSource) {
    params.set('source', artifactHubSource)
  }
  return `/charts/${encodeURIComponent(chart.repositoryName)}/${encodeURIComponent(chart.name)}?${params.toString()}`
}

function MarkdownCard({
  title,
  content,
  emptyMessage,
}: {
  title: string
  content?: string
  emptyMessage: string
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2 !pb-2">
        <CardTitle className="text-balance text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        {content ? (
          <div className="ai-markdown max-w-none overflow-x-auto text-pretty text-sm text-foreground/80 [font-family:var(--font-sans)]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => {
                  const isExternal =
                    typeof href === 'string' && /^https?:\/\//.test(href)
                  return (
                    <a
                      {...props}
                      href={href}
                      target={isExternal ? '_blank' : undefined}
                      rel={isExternal ? 'noopener noreferrer' : undefined}
                    >
                      {children}
                    </a>
                  )
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  )
}

function DetailItem({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-pretty break-words">{children}</dd>
    </div>
  )
}

function ChartDetailsCard({ chart }: { chart: HelmChartDetail }) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2 !pb-2">
        <CardTitle className="text-balance text-sm">
          {t('common.fields.details')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 text-sm">
        <dl className="space-y-3">
          <DetailItem label={t('common.fields.source')}>
            {chart.source === artifactHubSource ? (
              chart.artifactHubUrl ? (
                <a
                  href={chart.artifactHubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 app-link"
                >
                  Artifact Hub
                  <ExternalLink className="size-3" />
                </a>
              ) : (
                'Artifact Hub'
              )
            ) : (
              t('helmCharts.filters.repositories')
            )}
          </DetailItem>
          <DetailItem label={t('helmCharts.fields.repository')}>
            {chart.repositoryName}
          </DetailItem>
          <DetailItem label={t('helm.fields.chart')}>{chart.name}</DetailItem>
          <DetailItem label={t('helm.fields.version')}>
            <span className="tabular-nums">{chart.version || '-'}</span>
          </DetailItem>
          <DetailItem label={t('helm.fields.appVersion')}>
            <span className="tabular-nums">{chart.appVersion || '-'}</span>
          </DetailItem>
          <DetailItem label={t('helm.fields.kubeVersion')}>
            <span className="tabular-nums">{chart.kubeVersion || '-'}</span>
          </DetailItem>
          <DetailItem label={t('common.fields.updated')}>
            <span className="tabular-nums">
              {chart.updatedAt ? formatDate(chart.updatedAt) : '-'}
            </span>
          </DetailItem>
          <DetailItem label={t('common.fields.status')}>
            {chart.deprecated ? (
              <Badge variant="outline">
                {t('helmCharts.fields.deprecated')}
              </Badge>
            ) : (
              <Badge variant="outline">{t('common.fields.available')}</Badge>
            )}
          </DetailItem>
          {chart.home ? (
            <DetailItem label="Home">
              <a
                href={chart.home}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all app-link"
              >
                {chart.home}
              </a>
            </DetailItem>
          ) : null}
          {chart.sources?.length ? (
            <DetailItem label={t('helmCharts.fields.sources')}>
              <div className="space-y-1">
                {chart.sources.map((source) => (
                  <a
                    key={source}
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all app-link"
                  >
                    {source}
                  </a>
                ))}
              </div>
            </DetailItem>
          ) : null}
          {chart.keywords?.length ? (
            <DetailItem label={t('helmCharts.fields.keywords')}>
              <div className="flex flex-wrap gap-1">
                {chart.keywords.map((keyword) => (
                  <Badge key={keyword} variant="outline">
                    {keyword}
                  </Badge>
                ))}
              </div>
            </DetailItem>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

function HelmChartOverview({ chart }: { chart: HelmChartDetail }) {
  const { t } = useTranslation()

  return (
    <div className="@container/helm-chart-overview space-y-3">
      <div className="grid gap-3 @4xl/helm-chart-overview:grid-cols-3">
        <div className="space-y-3 @4xl/helm-chart-overview:col-span-2">
          <MarkdownCard
            title="README"
            content={chart.readme}
            emptyMessage={t('helmCharts.messages.noReadme')}
          />
        </div>
        <div className="space-y-3">
          <ChartDetailsCard chart={chart} />
        </div>
      </div>
    </div>
  )
}

function ChartTextTab({
  title,
  value,
  emptyMessage,
}: {
  title: string
  value?: string
  emptyMessage: string
}) {
  if (!value) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    )
  }

  return <TextViewer value={value} title={title} />
}

function LazyChartTextTab({
  title,
  repository,
  name,
  version,
  source,
  content,
  enabled,
  emptyMessage,
}: {
  title: string
  repository?: string
  name?: string
  version?: string
  source?: 'repository' | 'artifacthub'
  content: HelmChartContentType
  enabled: boolean
  emptyMessage: string
}) {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch } = useHelmChartContent(
    repository,
    name,
    content,
    version,
    source,
    enabled
  )

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {t('common.messages.loading')}
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <ErrorMessage
        resourceName={title}
        error={error}
        refetch={() => void refetch()}
      />
    )
  }

  return (
    <ChartTextTab
      title={title}
      value={data?.content}
      emptyMessage={emptyMessage}
    />
  )
}

function HelmChartVersionsTable({ chart }: { chart: HelmChartDetail }) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('helmCharts.fields.versions')}</CardTitle>
      </CardHeader>
      <CardContent>
        <SimpleTable
          data={chart.versions}
          emptyMessage={t('helmCharts.messages.noVersions')}
          columns={[
            {
              header: t('helm.fields.version'),
              accessor: (item) => item,
              cell: (value) => {
                const item = value as HelmChartVersion
                const isCurrent = item.version === chart.version
                return (
                  <Link
                    to={chartDetailPath(chart, item.version)}
                    className={cn(
                      'app-link tabular-nums',
                      isCurrent && 'font-semibold'
                    )}
                  >
                    {item.version}
                  </Link>
                )
              },
            },
            {
              header: t('helm.fields.appVersion'),
              accessor: (item) => item.appVersion || '-',
              cell: (value) => value as string,
            },
            {
              header: t('common.fields.updated'),
              accessor: (item) => item.updatedAt,
              cell: (value) => (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {value ? formatDate(value as string) : '-'}
                </span>
              ),
            },
          ]}
          pagination={{ enabled: true, pageSize: 15 }}
        />
      </CardContent>
    </Card>
  )
}

function defaultReleaseName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || name
  )
}

function InstallHelmChartDialog({
  chart,
  open,
  onOpenChange,
}: {
  chart: HelmChartDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [releaseName, setReleaseName] = useState(() =>
    defaultReleaseName(chart.name)
  )
  const [namespace, setNamespace] = useState('default')
  const [isNamespaceManual, setIsNamespaceManual] = useState(false)
  const [createNamespace, setCreateNamespace] = useState(true)
  const [valuesYaml, setValuesYaml] = useState('')
  const [error, setError] = useState('')
  const [isInstalling, setIsInstalling] = useState(false)
  const defaultValuesQuery = useHelmChartContent(
    chart.repositoryName,
    chart.name,
    'values',
    chart.version,
    chart.source,
    open
  )
  const defaultValues = defaultValuesQuery.isLoading
    ? t('common.messages.loading')
    : defaultValuesQuery.data?.content || ''

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (!chart.chartUrl) {
      setError(
        t('helmCharts.messages.noChartUrl', {
          defaultValue: 'Chart package URL is missing.',
        })
      )
      return
    }

    let values: Record<string, unknown> = {}
    if (valuesYaml.trim()) {
      try {
        const parsed = yaml.load(valuesYaml)
        if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          setError(
            t('helmCharts.messages.invalidValues', {
              defaultValue: 'Values must be a YAML object.',
            })
          )
          return
        }
        values = (parsed || {}) as Record<string, unknown>
      } catch (err) {
        setError(translateError(err, t))
        return
      }
    }

    const targetNamespace = namespace.trim()
    setIsInstalling(true)
    try {
      const release = await installHelmRelease(targetNamespace, {
        releaseName: releaseName.trim(),
        namespace: targetNamespace,
        chartUrl: chart.chartUrl,
        repositoryName: chart.repositoryName,
        source: chart.source,
        createNamespace: isNamespaceManual && createNamespace,
        values,
      })
      const installedNamespace = release.metadata?.namespace || targetNamespace
      const targetName = release.metadata?.name || releaseName.trim()
      toast.success(
        t('helmCharts.messages.installed', {
          defaultValue: 'Helm release installed',
        })
      )
      onOpenChange(false)
      navigate(
        `/helmrelease/${encodeURIComponent(installedNamespace)}/${encodeURIComponent(targetName)}`
      )
    } catch (err) {
      setError(translateError(err, t))
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] w-[calc(100vw-4rem)] !max-w-[calc(100vw-4rem)] flex-col overflow-hidden">
        <form
          onSubmit={handleSubmit}
          className="flex h-full min-h-0 flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>
              {t('helmCharts.actions.install', { defaultValue: 'Install' })}
            </DialogTitle>
            <DialogDescription>
              {chart.repositoryName}/{chart.name}:{chart.version}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="helm-release-name">
                  {t('helm.fields.releaseName')}
                </Label>
                <Input
                  id="helm-release-name"
                  value={releaseName}
                  onChange={(event) => setReleaseName(event.target.value)}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="helm-release-namespace">
                  {t('common.fields.namespace', { defaultValue: 'Namespace' })}
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <NamespaceSelector
                    selectedNamespace={namespace}
                    handleNamespaceChange={(value) => {
                      setNamespace(value)
                      setIsNamespaceManual(false)
                    }}
                    disabled={isInstalling}
                    triggerClassName="w-44 sm:w-44 sm:min-w-0"
                  />
                  <Input
                    id="helm-release-namespace"
                    value={namespace}
                    onChange={(event) => {
                      setNamespace(event.target.value)
                      setIsNamespaceManual(true)
                      setCreateNamespace(true)
                    }}
                    disabled={isInstalling}
                    required
                    className="w-48"
                  />
                </div>
              </div>
            </div>

            <div className="grid min-h-0 gap-4 lg:grid-cols-2">
              <div className="grid min-h-0 gap-2">
                <Label>{t('helmCharts.fields.defaultValues')}</Label>
                <SimpleYamlEditor
                  value={defaultValues}
                  onChange={() => undefined}
                  disabled
                  height="calc(100dvh - 20rem)"
                />
              </div>

              <div className="grid min-h-0 gap-2">
                <Label>{t('helmCharts.fields.customValues')}</Label>
                <SimpleYamlEditor
                  value={valuesYaml}
                  onChange={(value) => setValuesYaml(value || '')}
                  disabled={isInstalling}
                  height="calc(100dvh - 20rem)"
                />
              </div>
            </div>

            {defaultValuesQuery.error ? (
              <p className="text-sm text-destructive">
                {translateError(defaultValuesQuery.error, t)}
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-end">
            {isNamespaceManual ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="helm-create-namespace"
                  checked={createNamespace}
                  onCheckedChange={(value) =>
                    setCreateNamespace(value === true)
                  }
                  disabled={isInstalling}
                />
                <Label
                  htmlFor="helm-create-namespace"
                  className="text-sm font-normal"
                >
                  {t('helm.fields.createNamespace')}
                </Label>
              </div>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isInstalling}
              >
                {t('common.actions.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={
                  !releaseName.trim() ||
                  !namespace.trim() ||
                  !chart.chartUrl ||
                  isInstalling
                }
              >
                {isInstalling ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t('helmCharts.actions.install', { defaultValue: 'Install' })}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HelmChartDetailPage() {
  const { repository, name } = useParams()
  const [searchParams] = useSearchParams()
  const { t } = useTranslation()
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const version = searchParams.get('version') || undefined
  const source =
    searchParams.get('source') === artifactHubSource
      ? artifactHubSource
      : undefined
  const isIframe = searchParams.get('iframe') === 'true'
  const tabParam = searchParams.get('tab')
  const activeTab =
    tabParam === 'values' || tabParam === 'template' || tabParam === 'versions'
      ? tabParam
      : 'overview'
  const { data, isLoading, error, refetch } = useHelmChart(
    repository,
    name,
    version,
    source
  )

  usePageTitle(
    data ? `${data.name} (${t('nav.helmCharts')})` : t('nav.helmCharts')
  )

  const tabs = useMemo(
    () =>
      data
        ? [
            {
              value: 'overview',
              label: t('common.tabs.overview'),
              content: <HelmChartOverview chart={data} />,
            },
            {
              value: 'values',
              label: t('helm.tabs.values'),
              content: (
                <LazyChartTextTab
                  title={t('helm.tabs.values')}
                  repository={repository}
                  name={name}
                  version={version}
                  source={source}
                  content="values"
                  enabled={activeTab === 'values'}
                  emptyMessage={t('helmCharts.messages.noValues')}
                />
              ),
            },
            {
              value: 'template',
              label: t('common.fields.template'),
              content: (
                <LazyChartTextTab
                  title={t('common.fields.template')}
                  repository={repository}
                  name={name}
                  version={version}
                  source={source}
                  content="templates"
                  enabled={activeTab === 'template'}
                  emptyMessage={t('helmCharts.messages.noTemplates')}
                />
              ),
            },
            {
              value: 'versions',
              label: t('helmCharts.fields.versions'),
              content: <HelmChartVersionsTable chart={data} />,
            },
          ]
        : [],
    [activeTab, data, name, repository, source, t, version]
  )

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">
            {t('common.messages.loading')}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    return (
      <ErrorMessage
        resourceName={t('nav.helmCharts')}
        error={error}
        refetch={refetch}
      />
    )
  }

  return (
    <div className={cn(isIframe && 'px-4 py-3 lg:px-6')}>
      <ResponsiveTabs
        className="gap-4"
        stickyHeader={
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <HelmChartIcon
                icon={data.icon}
                name={data.name}
                className="size-11"
              />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-lg font-extrabold">
                    {data.name}
                  </h1>
                  {data.source === artifactHubSource ? (
                    data.artifactHubUrl ? (
                      <a
                        href={data.artifactHubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0"
                      >
                        <Badge
                          variant="outline"
                          className="gap-1 font-normal text-muted-foreground"
                        >
                          Artifact Hub
                          <ExternalLink className="size-3" />
                        </Badge>
                      </a>
                    ) : (
                      <Badge
                        variant="outline"
                        className="shrink-0 font-normal text-muted-foreground"
                      >
                        Artifact Hub
                      </Badge>
                    )
                  ) : null}
                </div>
                <p className="text-pretty break-words text-sm text-muted-foreground">
                  {data.description || '-'}
                </p>
              </div>
            </div>
            <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
              <Button
                disabled={!data.chartUrl}
                size="sm"
                onClick={() => setInstallDialogOpen(true)}
              >
                <Download className="size-4" />
                {t('helmCharts.actions.install', { defaultValue: 'Install' })}
              </Button>
            </div>
          </div>
        }
        stickyHeaderClassName={cn(
          'sticky z-40 bg-background px-4',
          isIframe
            ? 'top-0 -mx-4 lg:-mx-6 lg:px-6'
            : 'top-(--header-height) -mx-4 -mt-4 pt-4 lg:-mx-6 lg:px-6'
        )}
        tabs={tabs}
      />
      {installDialogOpen ? (
        <InstallHelmChartDialog
          chart={data}
          open={installDialogOpen}
          onOpenChange={setInstallDialogOpen}
        />
      ) : null}
    </div>
  )
}
