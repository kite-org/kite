import { useMemo, useState, type ReactNode } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'

import type {
  HelmChartContentType,
  HelmChartDetail,
  HelmChartTemplate,
  HelmChartVersion,
} from '@/types/api'
import { useHelmChart, useHelmChartContent } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ErrorMessage } from '@/components/error-message'
import { HelmChartIcon } from '@/components/helm-chart-icon'
import { HelmInstallDialog } from '@/components/helm-install-dialog'
import { SimpleTable } from '@/components/simple-table'
import { TextViewer } from '@/components/text-viewer'
import { YamlFileTreeViewerNative as YamlFileTreeViewer } from '@/components/yaml-file-tree-viewer-native'

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
  content,
  templates,
}: {
  title: string
  value?: string
  emptyMessage: string
  content?: HelmChartContentType
  templates?: HelmChartTemplate[]
}) {
  if (content === 'templates') {
    if (!templates?.length) {
      return (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {emptyMessage}
          </CardContent>
        </Card>
      )
    }
    return (
      <YamlFileTreeViewer
        files={templates}
        title={title}
        emptyMessage={emptyMessage}
      />
    )
  }

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
      content={content}
      templates={data?.templates}
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
              header: t('helm.fields.publishedAt'),
              accessor: (item) => item.publishedAt,
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
                    <Badge
                      variant="outline"
                      className="shrink-0 font-normal text-muted-foreground"
                    >
                      Artifact Hub
                    </Badge>
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
        <HelmInstallDialog
          chart={data}
          open={installDialogOpen}
          onOpenChange={setInstallDialogOpen}
        />
      ) : null}
    </div>
  )
}
