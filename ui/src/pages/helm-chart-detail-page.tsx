import { useMemo, useState, type ReactNode } from 'react'
import { IconRefresh } from '@tabler/icons-react'
import { Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'

import type { HelmChartDetail, HelmChartVersion } from '@/types/api'
import { useHelmChart } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ErrorMessage } from '@/components/error-message'
import { SimpleTable } from '@/components/simple-table'
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

function ChartIcon({
  icon,
  name,
  className,
}: {
  icon?: string
  name: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (icon && !failed) {
    return (
      <img
        src={icon}
        alt=""
        className={cn(
          'size-9 rounded-md border bg-background object-contain',
          className
        )}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground',
        className
      )}
      aria-hidden="true"
    >
      <Package className="size-4" />
      <span className="sr-only">{name}</span>
    </div>
  )
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
          <DetailItem label={t('common.fields.description')}>
            {chart.description || '-'}
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
                  <Button
                    asChild
                    variant={isCurrent ? 'default' : 'outline'}
                    size="sm"
                  >
                    <Link to={chartDetailPath(chart, item.version)}>
                      {item.version}
                    </Link>
                  </Button>
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
          pagination={{ enabled: true, pageSize: 10 }}
        />
      </CardContent>
    </Card>
  )
}

export function HelmChartDetailPage() {
  const { repository, name } = useParams()
  const [searchParams] = useSearchParams()
  const { t } = useTranslation()
  const version = searchParams.get('version') || undefined
  const source =
    searchParams.get('source') === artifactHubSource
      ? artifactHubSource
      : undefined
  const isIframe = searchParams.get('iframe') === 'true'
  const { data, isLoading, error, refetch, isFetching } = useHelmChart(
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
                <ChartTextTab
                  title={t('helm.tabs.values')}
                  value={data.values}
                  emptyMessage={t('helmCharts.messages.noValues')}
                />
              ),
            },
            {
              value: 'template',
              label: t('common.fields.template'),
              content: (
                <ChartTextTab
                  title={t('common.fields.template')}
                  value={data.templates}
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
    [data, t]
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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ChartIcon icon={data.icon} name={data.name} className="size-11" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold">{data.name}</h1>
            <p className="truncate text-sm text-muted-foreground">
              repo: <span className="font-medium">{data.repositoryName}</span>,
              chart: <span className="font-medium">{data.name}</span>
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button
            disabled={isLoading || isFetching}
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            <IconRefresh className="size-4" />
            {t('common.actions.refresh')}
          </Button>
        </div>
      </div>

      <ResponsiveTabs
        className="gap-4"
        stickyHeaderClassName={cn(
          'sticky z-40 bg-background px-4',
          isIframe
            ? 'top-0 -mx-4 lg:-mx-6 lg:px-6'
            : 'top-(--header-height) -mx-4 lg:-mx-6 lg:px-6'
        )}
        tabs={tabs}
      />
    </div>
  )
}
