import { useMemo, useState } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import type { Container, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import type {
  HelmRelease,
  HelmReleaseHistoryItem,
  HelmReleaseResource,
  RelatedResources,
} from '@/types/api'
import {
  rollbackHelmRelease,
  upgradeHelmRelease,
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
import { formatDate, getAge, translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { LogViewer } from '@/components/log-viewer'
import {
  CompactRelatedResourcesCard,
  MetadataListCard,
} from '@/components/pod-overview-sidebar'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { SimpleTable } from '@/components/simple-table'
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
  return helmResourceMetadataByAlias.get(resource.kind.toLowerCase())
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isCurrent || rollingBackRevision !== null}
                    onClick={() => void handleRollback(item.revision)}
                  >
                    {isCurrent
                      ? t('common.fields.current')
                      : t('helm.actions.rollback')}
                  </Button>
                )
              },
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
        detail={release.spec?.chartVersion || '-'}
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

export function HelmReleaseDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const { t } = useTranslation()
  const [isActionLoading, setIsActionLoading] = useState(false)
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

  const handleUpgrade = async () => {
    setIsActionLoading(true)
    try {
      await upgradeHelmRelease(namespace, name)
      toast.success(t('helm.messages.upgradeStarted'))
      await refetch()
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setIsActionLoading(false)
    }
  }

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
        <Button
          variant="outline"
          size="sm"
          disabled={isActionLoading}
          onClick={handleUpgrade}
        >
          {t('helm.actions.upgrade')}
        </Button>
      }
    />
  )
}
