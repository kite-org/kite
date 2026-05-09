import { useMemo, useState, type FormEvent } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import type { Container, Pod } from 'kubernetes-types/core/v1'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import type {
  HelmChart,
  HelmChartVersion,
  HelmRelease,
  HelmReleaseHistoryItem,
  HelmReleaseResource,
  RelatedResources,
} from '@/types/api'
import {
  rollbackHelmRelease,
  upgradeHelmRelease,
  useArtifactHubCharts,
  useHelmChart,
  useHelmChartContent,
  useHelmCharts,
  useHelmReleaseHistory,
  useResource,
  useResourcesWatch,
} from '@/lib/api'
import { getCRDResourcePath } from '@/lib/k8s'
import {
  getResourceDetailPath,
  resourceMetadataList,
  type ResourceMetadata,
} from '@/lib/resource-metadata'
import { withSubPath } from '@/lib/subpath'
import {
  formatDate,
  getAge,
  isVersionAtLeast,
  translateError,
} from '@/lib/utils'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { HelmChartIcon } from '@/components/helm-chart-icon'
import { LogViewer } from '@/components/log-viewer'
import {
  CompactRelatedResourcesCard,
  MetadataListCard,
} from '@/components/pod-overview-sidebar'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { SimpleTable } from '@/components/simple-table'
import { SimpleYamlEditor } from '@/components/simple-yaml-editor'
import { TextViewer } from '@/components/text-viewer'
import { WorkloadSummaryCard } from '@/components/workload-overview-parts'
import { WorkloadPodsCard } from '@/components/workload-pods-card'
import { YamlEditor } from '@/components/yaml-editor'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

const helmResourceMetadataByAlias = new Map<string, ResourceMetadata>(
  resourceMetadataList.flatMap((item) =>
    [item.type, item.singular, item.singularLabel, item.pluralLabel]
      .concat(item.shortLabel ? [item.shortLabel] : [])
      .map((alias) => [alias.toLowerCase(), item] as const)
  )
)
const helmResourceKindAliases = new Map([['customresourcedefinition', 'crds']])

function ResourcesTable({ resources }: { resources?: HelmReleaseResource[] }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('common.fields.resources')}</CardTitle>
      </CardHeader>
      <CardContent>
        <SimpleTable
          data={resources || []}
          emptyMessage={t('helm.messages.noResources')}
          columns={[
            {
              header: 'Kind',
              accessor: (item) => item.kind,
              cell: (value) => value as string,
              align: 'left',
            },
            {
              header: t('common.fields.name'),
              accessor: (item) => item,
              cell: (value) => {
                const item = value as HelmReleaseResource
                return <HelmReleaseResourceLink resource={item} />
              },
              align: 'left',
            },
            {
              header: 'API Version',
              accessor: (item) => item.apiVersion,
              cell: (value) => value as string,
              align: 'left',
            },
          ]}
          pagination={{ enabled: true, pageSize: 20 }}
        />
      </CardContent>
    </Card>
  )
}

function HelmReleaseResourceLink({
  resource,
}: {
  resource: HelmReleaseResource
}) {
  const [open, setOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const path = getHelmReleaseResourcePath(resource)
  const label = resource.namespace
    ? `${resource.namespace}/${resource.name}`
    : resource.name
  const isIframe = searchParams.get('iframe') === 'true'

  if (!path) {
    return <span className="font-medium">{label}</span>
  }

  if (isIframe) {
    return (
      <Link to={`${path}?iframe=true`} className="font-medium app-link">
        {label}
      </Link>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="max-w-full truncate text-left font-medium app-link"
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent className="!h-[calc(100dvh-1rem)] !max-w-[calc(100vw-1rem)] flex min-h-0 flex-col gap-0 p-0 md:!h-[80%] md:!max-w-[60%]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3 pr-14">
          <DialogTitle>{resource.kind}</DialogTitle>
          <a href={withSubPath(path)} target="_blank" rel="noopener noreferrer">
            <Button
              variant="outline"
              size="icon"
              aria-label="Open resource in new tab"
            >
              <IconExternalLink size={12} />
            </Button>
          </a>
        </DialogHeader>
        <iframe
          src={`${withSubPath(path)}?iframe=true`}
          className="min-h-0 w-full flex-grow border-none"
        />
      </DialogContent>
    </Dialog>
  )
}

function getHelmReleaseResourcePath(resource: HelmReleaseResource) {
  const metadata = getHelmReleaseResourceMetadata(resource)

  if (metadata) {
    return getResourceDetailPath(
      metadata.type,
      resource.name,
      resource.namespace
    )
  }

  if (!resource.apiVersion) {
    return undefined
  }
  return getCRDResourcePath(
    `${resource.kind.toLowerCase()}s`,
    resource.apiVersion,
    resource.namespace,
    resource.name
  )
}

function getHelmReleaseResourceMetadata(resource: HelmReleaseResource) {
  const kind = resource.kind.toLowerCase()
  return helmResourceMetadataByAlias.get(
    helmResourceKindAliases.get(kind) || kind
  )
}

function toHelmRelatedResource(
  resource: HelmReleaseResource
): RelatedResources {
  const metadata = getHelmReleaseResourceMetadata(resource)
  return {
    type: (metadata?.type ||
      `${resource.kind.toLowerCase()}s`) as RelatedResources['type'],
    apiVersion: resource.apiVersion,
    name: resource.name,
    namespace: resource.namespace,
  }
}

function getHelmRelatedResourceGroupOrder(resource: RelatedResources) {
  switch (resource.type) {
    case 'deployments':
    case 'statefulsets':
    case 'daemonsets':
    case 'replicasets':
    case 'jobs':
    case 'cronjobs':
    case 'pods':
      return 0
    case 'configmaps':
    case 'secrets':
      return 1
    case 'persistentvolumeclaims':
    case 'persistentvolumes':
      return 1.5
    case 'services':
    case 'ingresses':
    case 'gateways':
    case 'httproutes':
      return 2
    default:
      return 3
  }
}

function sortHelmRelatedResources(resources: RelatedResources[]) {
  return resources.slice().sort((a, b) => {
    const orderDiff =
      getHelmRelatedResourceGroupOrder(a) - getHelmRelatedResourceGroupOrder(b)
    if (orderDiff !== 0) {
      return orderDiff
    }
    const typeDiff = a.type.localeCompare(b.type)
    if (typeDiff !== 0) {
      return typeDiff
    }
    return `${a.namespace || ''}/${a.name}`.localeCompare(
      `${b.namespace || ''}/${b.name}`
    )
  })
}

function HelmReleaseHistoryValuesDialog({
  item,
}: {
  item: HelmReleaseHistoryItem
}) {
  const { t } = useTranslation()
  const valuesYaml = yaml.dump(item.values || {}, { indent: 2 })

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-24">
          {t('helm.tabs.values')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[calc(100dvh-4rem)] w-[calc(100vw-4rem)] !max-w-4xl flex-col overflow-hidden sm:!max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('helmCharts.fields.customValues')}</DialogTitle>
          <DialogDescription>
            {t('common.fields.revision')} {item.revision}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <SimpleYamlEditor
            value={valuesYaml}
            onChange={() => undefined}
            disabled
            height="calc(100dvh - 14rem)"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HelmReleaseRollbackButton({
  item,
  namespace,
  name,
  disabled,
  onRollback,
}: {
  item: HelmReleaseHistoryItem
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
          {t('helm.actions.rollback')}
        </Button>
      </DialogTrigger>
      <DialogContent className="!max-w-md sm:!max-w-md">
        <DialogHeader>
          <DialogTitle>{t('helm.messages.rollbackConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('helm.messages.rollbackConfirmDescription', {
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
            {t('helm.actions.rollback')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HelmReleaseHistoryTable({
  namespace,
  name,
  currentRevision,
  onRollbackComplete,
}: {
  namespace: string
  name: string
  currentRevision?: number
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
    refetch: refetchHistory,
  } = useHelmReleaseHistory(namespace, name)

  const handleRollback = async (revision: number) => {
    setRollingBackRevision(revision)
    try {
      await rollbackHelmRelease(namespace, name, revision)
      toast.success(t('helm.messages.rollbackStarted'))
      await Promise.all([refetchHistory(), onRollbackComplete()])
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
        <CardTitle>{t('common.tabs.history')}</CardTitle>
      </CardHeader>
      <CardContent>
        <SimpleTable
          data={data?.items || []}
          emptyMessage={t('helm.messages.noHistory', 'No history found')}
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
              header: t('common.fields.updated'),
              accessor: (item) => item,
              cell: (value) => {
                const item = value as HelmReleaseHistoryItem
                const timestamp =
                  item.lastDeployed || item.deleted || item.firstDeployed
                return (
                  <span className="text-sm text-muted-foreground">
                    {timestamp ? formatDate(timestamp) : '-'}
                  </span>
                )
              },
              align: 'left',
            },
            {
              header: t('common.fields.status'),
              accessor: (item) => item.status || '-',
              cell: (value) => value as string,
              align: 'left',
            },
            {
              header: t('helm.fields.chart'),
              accessor: (item) => item,
              cell: (value) => {
                const item = value as HelmReleaseHistoryItem
                return (
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {item.chartName || item.chart || '-'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.chartVersion || '-'}
                    </div>
                  </div>
                )
              },
              align: 'left',
            },
            {
              header: t('helm.fields.appVersion'),
              accessor: (item) => item.appVersion || '-',
              cell: (value) => value as string,
              align: 'left',
            },
            {
              header: t('common.fields.description'),
              accessor: (item) => item.description || '-',
              cell: (value) => (
                <div className="max-w-md whitespace-pre-wrap break-words text-sm">
                  {value as string}
                </div>
              ),
              align: 'left',
            },
            {
              header: t('common.fields.actions'),
              accessor: (item) => item,
              cell: (value) => {
                const item = value as HelmReleaseHistoryItem
                const isCurrent = item.revision === currentRevision
                return (
                  <div className="ml-auto grid w-max grid-cols-[6rem_6rem] gap-2">
                    <HelmReleaseHistoryValuesDialog item={item} />
                    {isCurrent ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-24"
                        disabled
                      >
                        {t('common.fields.current')}
                      </Button>
                    ) : (
                      <HelmReleaseRollbackButton
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

function HelmReleaseOverview({
  release,
  pods,
  isPodsLoading,
}: {
  release: HelmRelease
  pods?: Pod[]
  isPodsLoading: boolean
}) {
  const { t } = useTranslation()
  const annotations = release.metadata?.annotations || {}
  const relatedResources = useMemo(
    () =>
      sortHelmRelatedResources(
        (release.status?.resources || []).map(toHelmRelatedResource)
      ),
    [release.status?.resources]
  )

  return (
    <div className="@container/helmrelease-overview space-y-3">
      <HelmReleaseSummaryGrid release={release} />

      <div className="grid gap-3 @4xl/helmrelease-overview:grid-cols-3">
        <div className="space-y-3 @4xl/helmrelease-overview:col-span-2">
          <WorkloadPodsCard
            title={t('common.fields.pods')}
            pods={pods || []}
            isLoading={isPodsLoading}
            loadingText={t('common.messages.loadingPods')}
            emptyText={t('common.messages.noPods')}
            ageLabel={t('common.fields.age')}
          />
          <HelmReleaseTextCard
            title={t('helm.tabs.notes')}
            content={release.spec?.notes}
          />
        </div>

        <div className="space-y-3">
          <CompactRelatedResourcesCard
            resources={relatedResources}
            isLoading={false}
          />
          <HelmReleaseTextCard
            title={t('common.fields.description')}
            content={release.spec?.description}
          />
          {Object.keys(annotations).length > 0 ? (
            <MetadataListCard
              title="common.fields.annotations"
              entries={annotations}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function HelmReleaseSummaryGrid({ release }: { release: HelmRelease }) {
  const { t } = useTranslation()
  const chartName = release.spec?.chartName || release.spec?.chart || '-'
  const chartVersion = release.spec?.chartVersion || '-'
  const status = release.status?.status || '-'

  return (
    <div className="grid gap-3 md:grid-cols-2 @4xl/helmrelease-overview:grid-cols-6">
      <WorkloadSummaryCard
        label={t('common.fields.status')}
        value={
          <span className="inline-flex min-w-0 items-center gap-2">
            <PodStatusIcon
              status={helmStatusToPodStatus(status)}
              className="size-4 shrink-0"
            />
            <span className="truncate">{status}</span>
          </span>
        }
      />
      <WorkloadSummaryCard
        label={t('helm.fields.chart')}
        value={chartName}
        detail={
          <HelmReleaseChartVersionDetail
            chartName={release.spec?.chartName || ''}
            currentVersion={chartVersion}
          />
        }
      />
      <WorkloadSummaryCard
        label={t('helm.fields.appVersion')}
        value={release.spec?.appVersion || '-'}
      />
      <WorkloadSummaryCard
        label={t('common.fields.revision')}
        value={release.spec?.revision || '-'}
      />
      <WorkloadSummaryCard
        label={t('helm.fields.lastDeployed')}
        value={
          release.status?.lastDeployed
            ? t('common.messages.timeAgo', {
                time: getAge(release.status.lastDeployed),
              })
            : '-'
        }
        detail={
          release.status?.lastDeployed
            ? formatDate(release.status.lastDeployed)
            : '-'
        }
      />
      <WorkloadSummaryCard
        label={t('helm.fields.firstDeployed')}
        value={
          release.status?.firstDeployed
            ? t('common.messages.timeAgo', {
                time: getAge(release.status.firstDeployed),
              })
            : '-'
        }
        detail={
          release.status?.firstDeployed
            ? formatDate(release.status.firstDeployed)
            : '-'
        }
      />
    </div>
  )
}

function HelmReleaseChartVersionDetail({
  chartName,
  currentVersion,
}: {
  chartName: string
  currentVersion: string
}) {
  const { t } = useTranslation()
  const canCheck = Boolean(
    chartName && currentVersion && currentVersion !== '-'
  )
  const chartsQuery = useHelmCharts({
    query: chartName,
    enabled: canCheck,
  })
  const managedChartCandidates = useMemo(
    () =>
      (chartsQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [chartName, chartsQuery.data?.items]
  )
  const shouldSearchArtifactHub =
    canCheck && !chartsQuery.isLoading && managedChartCandidates.length === 0
  const artifactHubQuery = useArtifactHubCharts({
    query: chartName,
    verifiedPublisher: false,
    limit: 20,
    enabled: shouldSearchArtifactHub,
  })
  const artifactHubCandidates = useMemo(
    () =>
      (artifactHubQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [artifactHubQuery.data?.items, chartName]
  )
  const candidates =
    managedChartCandidates.length > 0
      ? managedChartCandidates
      : artifactHubCandidates
  const latestVersion = candidates.length === 1 ? candidates[0].version : ''
  const hasNewVersion =
    latestVersion &&
    latestVersion !== currentVersion &&
    !isVersionAtLeast(currentVersion, latestVersion)

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="truncate tabular-nums">{currentVersion}</span>
      {hasNewVersion ? (
        <Badge
          variant="outline"
          className="shrink-0 border-amber-500/30 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-300"
        >
          {t('helm.messages.newVersionAvailable', {
            version: latestVersion,
          })}
        </Badge>
      ) : null}
    </span>
  )
}

function normalizeHelmVersion(version?: string) {
  return version?.trim().replace(/^v/i, '') || ''
}

function isSameHelmVersion(left?: string, right?: string) {
  return normalizeHelmVersion(left) === normalizeHelmVersion(right)
}

function helmStatusToPodStatus(status: string) {
  switch (status) {
    case 'deployed':
      return 'Running'
    case 'failed':
      return 'Failed'
    case 'pending-install':
    case 'pending-upgrade':
    case 'pending-rollback':
      return 'Pending'
    case 'uninstalling':
      return 'Terminating'
    case 'uninstalled':
      return 'Completed'
    default:
      return status
  }
}

function HelmReleaseTextCard({
  title,
  content,
}: {
  title: string
  content?: string
}) {
  if (!content) {
    return null
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2 !pb-2">
        <CardTitle className="text-balance text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2 pt-0">
        <pre className="m-0 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/70">
          {content}
        </pre>
      </CardContent>
    </Card>
  )
}

function UpgradeHelmReleaseDialog({
  release,
  open,
  onOpenChange,
  onComplete,
}: {
  release: HelmRelease
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const chartName = release.spec?.chartName || release.spec?.chart || ''
  const currentVersion = release.spec?.chartVersion || ''
  const [selectedRepository, setSelectedRepository] = useState('')
  const [selectedVersion, setSelectedVersion] = useState('')
  const [valuesYaml, setValuesYaml] = useState(() =>
    yaml.dump(release.spec?.values || {}, { indent: 2 })
  )
  const [forceConflicts, setForceConflicts] = useState(false)
  const [wait, setWait] = useState(false)
  const [rollbackOnFailure, setRollbackOnFailure] = useState(false)
  const releaseDefaultValues = useMemo(
    () => yaml.dump(release.spec?.defaultValues || {}, { indent: 2 }),
    [release.spec?.defaultValues]
  )
  const [error, setError] = useState('')
  const [isUpgrading, setIsUpgrading] = useState(false)
  const chartsQuery = useHelmCharts({
    query: chartName,
    enabled: open && !!chartName,
  })
  const managedChartCandidates = useMemo(
    () =>
      (chartsQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [chartName, chartsQuery.data?.items]
  )
  const shouldSearchArtifactHub =
    open &&
    !!chartName &&
    !chartsQuery.isLoading &&
    managedChartCandidates.length === 0
  const verifiedArtifactHubQuery = useArtifactHubCharts({
    query: chartName,
    verifiedPublisher: true,
    limit: 20,
    enabled: shouldSearchArtifactHub,
  })
  const verifiedArtifactHubCandidates = useMemo(
    () =>
      (verifiedArtifactHubQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [chartName, verifiedArtifactHubQuery.data?.items]
  )
  const artifactHubQuery = useArtifactHubCharts({
    query: chartName,
    verifiedPublisher: false,
    limit: 20,
    enabled: shouldSearchArtifactHub,
  })
  const artifactHubCandidates = useMemo(
    () =>
      (artifactHubQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [artifactHubQuery.data?.items, chartName]
  )
  const chartCandidates =
    managedChartCandidates.length > 0
      ? managedChartCandidates
      : artifactHubCandidates
  const chartKey = (chart: HelmChart) =>
    `${chart.source || 'repository'}:${chart.repositoryName}`
  const isVerifiedArtifactHubChart = (chart: HelmChart) =>
    chart.source === 'artifacthub' &&
    verifiedArtifactHubCandidates.some(
      (candidate) => chartKey(candidate) === chartKey(chart)
    )
  const chartOptionSourceLabel = (chart: HelmChart) => {
    if (chart.source !== 'artifacthub') {
      return t('helmCharts.filters.repositories')
    }
    if (isVerifiedArtifactHubChart(chart)) {
      return t('helm.messages.chartSourceArtifactHubVerifiedShort', {
        defaultValue: 'Artifact Hub (verified)',
      })
    }
    return t('helmCharts.filters.artifactHub')
  }
  const selectedChart = chartCandidates.find(
    (chart) => chartKey(chart) === selectedRepository
  )
  const currentVersionChart = chartCandidates.find((chart) =>
    isSameHelmVersion(chart.version, currentVersion)
  )
  const canAutoSelectChart =
    managedChartCandidates.length > 0 ||
    chartCandidates.length <= 1 ||
    !!currentVersionChart
  const activeChart =
    selectedChart ||
    currentVersionChart ||
    (canAutoSelectChart ? chartCandidates[0] : undefined)
  const activeChartSource = activeChart?.source || 'repository'
  const activeRepository = activeChart?.repositoryName || ''
  const latestChartQuery = useHelmChart(
    activeRepository || undefined,
    chartName,
    undefined,
    activeChartSource
  )
  const currentVersionOption = latestChartQuery.data?.versions?.find(
    (version) => isSameHelmVersion(version.version, currentVersion)
  )
  const activeVersion =
    selectedVersion ||
    currentVersionChart?.version ||
    currentVersionOption?.version ||
    currentVersion ||
    latestChartQuery.data?.version ||
    activeChart?.version ||
    ''
  const canUseCurrentChart =
    isSameHelmVersion(activeVersion, currentVersion) && !selectedChart
  const selectedChartQuery = useHelmChart(
    activeRepository || undefined,
    chartName,
    activeVersion || undefined,
    activeChartSource,
    !canUseCurrentChart
  )
  const defaultValuesQuery = useHelmChartContent(
    activeRepository || undefined,
    chartName,
    'values',
    activeVersion || undefined,
    activeChartSource,
    open && !!activeChart && !!activeVersion
  )
  const versionOptions = useMemo<HelmChartVersion[]>(() => {
    if (latestChartQuery.data?.versions?.length) {
      return latestChartQuery.data.versions
    }
    if (activeVersion) {
      return [{ version: activeVersion }]
    }
    return []
  }, [activeVersion, latestChartQuery.data?.versions])
  const visibleVersionOptions = useMemo<HelmChartVersion[]>(() => {
    if (
      !activeVersion ||
      versionOptions.some((version) =>
        isSameHelmVersion(version.version, activeVersion)
      )
    ) {
      return versionOptions
    }
    return [{ version: activeVersion }, ...versionOptions]
  }, [activeVersion, versionOptions])
  const chartLookupError =
    chartsQuery.error ||
    verifiedArtifactHubQuery.error ||
    artifactHubQuery.error
      ? translateError(
          chartsQuery.error ||
            verifiedArtifactHubQuery.error ||
            artifactHubQuery.error,
          t
        )
      : !chartsQuery.isLoading &&
          !verifiedArtifactHubQuery.isLoading &&
          !artifactHubQuery.isLoading &&
          chartName &&
          chartCandidates.length === 0
        ? t('helm.messages.chartNotFound', {
            defaultValue:
              'Chart not found in managed Helm repositories or Artifact Hub.',
          })
        : ''
  const chartUrl = canUseCurrentChart
    ? undefined
    : selectedChartQuery.data?.chartUrl
  const isChartSourceLoading =
    chartsQuery.isLoading ||
    verifiedArtifactHubQuery.isLoading ||
    artifactHubQuery.isLoading
  const isVersionLoading = !!activeChart && latestChartQuery.isLoading
  const isChartPackageLoading =
    !!activeChart && !canUseCurrentChart && selectedChartQuery.isLoading
  const isDefaultValuesLoading = defaultValuesQuery.isLoading
  const readableError = error.replace(/\s&&\s/g, '\n')
  const chartSourceLabel = activeChart
    ? activeChartSource === 'artifacthub'
      ? verifiedArtifactHubCandidates.some(
          (chart) => chartKey(chart) === chartKey(activeChart)
        )
        ? t('helm.messages.chartSourceArtifactHubVerified', {
            repository: activeRepository,
            defaultValue:
              'Using Artifact Hub chart from {{repository}} (verified publisher).',
          })
        : t('helm.messages.chartSourceArtifactHub', {
            repository: activeRepository,
            defaultValue: 'Using Artifact Hub chart from {{repository}}.',
          })
      : t('helm.messages.chartSourceManagedRepository', {
          repository: activeRepository,
          defaultValue: 'Using managed chart repository {{repository}}.',
        })
    : chartCandidates.length > 1
      ? t('helm.messages.chartSourceSelectChart', {
          defaultValue: 'Select a chart to use a different chart package.',
        })
      : t('helm.messages.chartSourceCurrentRelease', {
          defaultValue: 'Using the chart stored in the current release.',
        })
  const defaultValues = isDefaultValuesLoading
    ? t('helm.messages.loadingValues', {
        defaultValue: 'Loading values...',
      })
    : defaultValuesQuery.data?.content || releaseDefaultValues

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (!chartUrl && !canUseCurrentChart) {
      setError(t('helmCharts.messages.noChartUrl'))
      return
    }

    let values: Record<string, unknown> = {}
    if (valuesYaml.trim()) {
      try {
        const parsed = yaml.load(valuesYaml)
        if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          setError(t('helmCharts.messages.invalidValues'))
          return
        }
        values = (parsed || {}) as Record<string, unknown>
      } catch (err) {
        setError(translateError(err, t))
        return
      }
    }

    setIsUpgrading(true)
    try {
      await upgradeHelmRelease(
        release.metadata.namespace,
        release.metadata.name,
        {
          ...(chartUrl
            ? {
                chartUrl,
                repositoryName: activeChart?.repositoryName,
                source: activeChart?.source,
              }
            : {}),
          values,
          forceConflicts,
          wait,
          rollbackOnFailure,
        }
      )
      onOpenChange(false)
      await onComplete()
    } catch (err) {
      const message = translateError(err, t)
      setError(message)
    } finally {
      setIsUpgrading(false)
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
            <DialogTitle>{t('helm.actions.upgrade')}</DialogTitle>
            <DialogDescription>
              {release.metadata.namespace}/{release.metadata.name}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div
              role="alert"
              className="max-h-40 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-5"
            >
              <div className="mb-1 font-medium text-destructive">
                {t('common.fields.errorDetails')}
              </div>
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                {readableError}
              </pre>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="grid gap-2 md:max-w-xl">
                <Label>{t('helm.fields.chart')}</Label>
                {isChartSourceLoading && chartCandidates.length === 0 ? (
                  <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="truncate">
                      {t('helm.messages.loadingChart', {
                        defaultValue: 'Loading chart...',
                      })}
                    </span>
                  </div>
                ) : chartCandidates.length > 1 ? (
                  <Select
                    value={activeChart ? chartKey(activeChart) : ''}
                    onValueChange={(value) => {
                      setSelectedRepository(value)
                      setSelectedVersion('')
                    }}
                    disabled={isUpgrading}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={t('helm.placeholders.selectChart', {
                          defaultValue: 'Select a chart...',
                        })}
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {chartCandidates.map((chart: HelmChart) => (
                        <SelectItem
                          key={chartKey(chart)}
                          value={chartKey(chart)}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate">
                              {chart.repositoryName}/{chart.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="ml-auto px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                            >
                              {chartOptionSourceLabel(chart)}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 min-w-0 items-center rounded-md border bg-muted/30 px-3 text-sm">
                    <span className="truncate">
                      {activeChart
                        ? `${activeChart.repositoryName}/${activeChart.name}`
                        : chartName || '-'}
                    </span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {isChartSourceLoading ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin" />
                      {t('helm.messages.loadingChart', {
                        defaultValue: 'Loading chart...',
                      })}
                    </span>
                  ) : (
                    chartSourceLabel
                  )}
                </p>
              </div>

              <div className="grid gap-2">
                <Label>{t('helm.fields.version')}</Label>
                {visibleVersionOptions.length > 0 ? (
                  <Select
                    value={activeVersion}
                    onValueChange={setSelectedVersion}
                    disabled={isUpgrading}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent viewportClassName="h-auto max-h-72 overflow-y-auto">
                      {visibleVersionOptions.map((version) => (
                        <SelectItem
                          key={version.version}
                          value={version.version}
                        >
                          <span className="tabular-nums">
                            {version.version}
                          </span>
                          {isSameHelmVersion(
                            version.version,
                            currentVersion
                          ) ? (
                            <span className="text-xs text-muted-foreground">
                              {t('common.fields.current')}
                            </span>
                          ) : null}
                          {version.appVersion ? (
                            <span className="text-xs text-muted-foreground">
                              {version.appVersion}
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                    {isVersionLoading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {t('helm.messages.loadingVersions', {
                          defaultValue: 'Loading versions...',
                        })}
                      </>
                    ) : (
                      '-'
                    )}
                  </div>
                )}
                {isVersionLoading ? (
                  <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {t('helm.messages.loadingVersions', {
                      defaultValue: 'Loading versions...',
                    })}
                  </p>
                ) : null}
                {isChartPackageLoading ? (
                  <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {t('helm.messages.loadingChartPackage', {
                      defaultValue: 'Loading chart package...',
                    })}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid min-h-0 gap-4 lg:grid-cols-2">
              <div className="grid min-h-0 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>{t('helmCharts.fields.defaultValues')}</Label>
                  {isDefaultValuesLoading ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {t('helm.messages.loadingValues', {
                        defaultValue: 'Loading values...',
                      })}
                    </span>
                  ) : null}
                </div>
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
                  disabled={isUpgrading}
                  height="calc(100dvh - 20rem)"
                />
              </div>
            </div>

            {chartLookupError ? (
              <p className="text-sm text-muted-foreground">
                {chartLookupError}
              </p>
            ) : null}
            {defaultValuesQuery.error ? (
              <p className="text-sm text-destructive">
                {translateError(defaultValuesQuery.error, t)}
              </p>
            ) : null}
          </div>

          <DialogFooter className="items-center gap-3">
            <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
              <Label
                htmlFor="helm-upgrade-force-conflicts"
                className="flex items-center gap-2 font-normal text-muted-foreground"
              >
                <Checkbox
                  id="helm-upgrade-force-conflicts"
                  checked={forceConflicts}
                  onCheckedChange={(value) => setForceConflicts(value === true)}
                  disabled={isUpgrading}
                />
                {t('helm.fields.forceConflicts')}
              </Label>
              <Label
                htmlFor="helm-upgrade-wait"
                className="flex items-center gap-2 font-normal text-muted-foreground"
              >
                <Checkbox
                  id="helm-upgrade-wait"
                  checked={wait}
                  onCheckedChange={(value) => setWait(value === true)}
                  disabled={isUpgrading}
                />
                {t('helm.fields.wait')}
              </Label>
              <Label
                htmlFor="helm-upgrade-rollback-on-failure"
                className="flex items-center gap-2 font-normal text-muted-foreground"
              >
                <Checkbox
                  id="helm-upgrade-rollback-on-failure"
                  checked={rollbackOnFailure}
                  onCheckedChange={(value) =>
                    setRollbackOnFailure(value === true)
                  }
                  disabled={isUpgrading}
                />
                {t('helm.fields.rollbackOnFailure')}
              </Label>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isUpgrading}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                isUpgrading ||
                !activeVersion ||
                isChartPackageLoading ||
                (!chartUrl && !canUseCurrentChart)
              }
            >
              {isUpgrading ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('helm.actions.upgrade')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HelmReleaseDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const { t } = useTranslation()
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const { data, isLoading, error, refetch } = useResource(
    'helmrelease',
    name,
    namespace
  )
  const releaseName = data?.spec?.releaseName || data?.metadata?.name
  const labelSelector = releaseName
    ? `app.kubernetes.io/instance=${releaseName}`
    : undefined
  const { data: releasePods, isLoading: isPodsLoading } = useResourcesWatch(
    'pods',
    namespace,
    {
      labelSelector,
      enabled: !!labelSelector,
    }
  )
  const containers = useMemo<Container[]>(() => {
    const seen = new Set<string>()
    const items: Container[] = []
    for (const pod of releasePods || []) {
      for (const container of pod.spec?.containers || []) {
        if (seen.has(container.name)) {
          continue
        }
        seen.add(container.name)
        items.push(container)
      }
    }
    return items
  }, [releasePods])
  const initContainers = useMemo<Container[]>(() => {
    const seen = new Set<string>()
    const items: Container[] = []
    for (const pod of releasePods || []) {
      for (const container of pod.spec?.initContainers || []) {
        if (seen.has(container.name)) {
          continue
        }
        seen.add(container.name)
        items.push(container)
      }
    }
    return items
  }, [releasePods])

  const tabs = useMemo<ResourceDetailShellTab<HelmRelease>[]>(
    () => [
      {
        value: 'values',
        label: t('helm.tabs.values'),
        content: data ? (
          <YamlEditor
            value={yaml.dump(data.spec?.values || {}, { indent: 2 })}
            title={t('helm.tabs.values')}
            readOnly
            showControls={false}
          />
        ) : null,
      },
      {
        value: 'resources',
        label: t('common.fields.resources'),
        content: <ResourcesTable resources={data?.status?.resources} />,
      },
      {
        value: 'history',
        label: t('common.tabs.history'),
        content: (
          <HelmReleaseHistoryTable
            namespace={namespace}
            name={name}
            currentRevision={data?.spec?.revision}
            onRollbackComplete={refetch}
          />
        ),
      },
      {
        value: 'logs',
        label: t('common.tabs.logs'),
        content: (
          <LogViewer
            namespace={namespace}
            pods={releasePods || []}
            containers={containers}
            initContainers={initContainers}
            labelSelector={labelSelector}
          />
        ),
      },
      {
        value: 'manifest',
        label: t('helm.tabs.manifest'),
        content: data ? (
          <TextViewer
            value={data.spec?.manifest || ''}
            title={t('helm.tabs.manifest')}
          />
        ) : null,
      },
    ],
    [
      containers,
      data,
      initContainers,
      labelSelector,
      name,
      namespace,
      refetch,
      releasePods,
      t,
    ]
  )

  return (
    <ResourceDetailShell
      resourceType="helmrelease"
      resourceLabel="Helm Release"
      name={name}
      namespace={namespace}
      data={data}
      isLoading={isLoading}
      error={error}
      onRefresh={refetch}
      titleIcon={
        data ? (
          <HelmChartIcon
            icon={data.spec?.icon}
            name={data.spec?.chartName || name}
            className="size-11"
          />
        ) : null
      }
      overview={
        data ? (
          <HelmReleaseOverview
            release={data}
            pods={releasePods}
            isPodsLoading={isPodsLoading}
          />
        ) : null
      }
      preYamlTabs={tabs}
      showDescribe={false}
      showDelete
      headerActions={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!data}
            onClick={() => setUpgradeDialogOpen(true)}
          >
            {t('helm.actions.upgrade')}
          </Button>
          {data && upgradeDialogOpen ? (
            <UpgradeHelmReleaseDialog
              release={data}
              open={upgradeDialogOpen}
              onOpenChange={setUpgradeDialogOpen}
              onComplete={refetch}
            />
          ) : null}
        </>
      }
    />
  )
}
