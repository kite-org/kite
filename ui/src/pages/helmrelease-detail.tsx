import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  IconCircleCheckFilled,
  IconExclamationCircle,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import type { Container, Pod } from 'kubernetes-types/core/v1'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import type {
  HelmChartVersion,
  HelmRelease,
  HelmReleaseDryRunResponse,
  HelmReleaseHistoryItem,
  HelmReleaseResource,
  HelmReleaseUpgradeRequest,
  RelatedResources,
} from '@/types/api'
import {
  dryRunUpgradeHelmRelease,
  rollbackHelmRelease,
  upgradeHelmRelease,
  useArtifactHubCharts,
  useHelmChart,
  useHelmChartContent,
  useHelmCharts,
  useHelmReleaseAutoUpgrade,
  useHelmReleaseHistory,
  useResource,
  useResourcesWatch,
} from '@/lib/api'
import {
  dumpSortedYaml,
  isRecord,
  mergeValuesDeep,
  mergeValuesIntoYamlText,
  parseRecordYaml,
  pruneDefaultsDeep,
} from '@/lib/helm-values'
import { getCRDResourcePath } from '@/lib/k8s'
import {
  getResourceDetailPath,
  resourceMetadataList,
  type ResourceMetadata,
} from '@/lib/resource-metadata'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { HelmChartIcon } from '@/components/helm-chart-icon'
import { LogViewer } from '@/components/log-viewer'
import {
  CompactRelatedResourcesCard,
  MetadataListCard,
} from '@/components/pod-overview-sidebar'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { ResourceIframeDialogContent } from '@/components/resource-iframe-dialog-content'
import { SimpleTable } from '@/components/simple-table'
import { SimpleYamlEditor } from '@/components/simple-yaml-editor'
import { ValuesDiffEditor } from '@/components/values-diff-editor'
import { WorkloadSummaryCard } from '@/components/workload-overview-parts'
import { WorkloadPodsCard } from '@/components/workload-pods-card'
import { YamlEditor } from '@/components/yaml-editor'
import {
  YamlFileTreeDiffViewerNative as YamlFileTreeDiffViewer,
  YamlFileTreeViewerNative as YamlFileTreeViewer,
  type YamlDiffTreeItem,
  type YamlFileTreeItem,
} from '@/components/yaml-file-tree-viewer-native'

import { HelmReleaseAutoUpgradeDialog } from './helmrelease-auto-upgrade-dialog'
import {
  isSameHelmVersion,
  useHelmReleaseChartSelection,
} from './helmrelease-chart-selection'
import { HelmReleaseChartSelector } from './helmrelease-chart-selector'
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
      <ResourceIframeDialogContent title={resource.kind} path={path} />
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

function toDryRunDiffFiles(
  resources: HelmReleaseDryRunResponse['resources'],
  options?: { ignoreMetadataChanges?: boolean }
): YamlDiffTreeItem[] {
  return resources.map((resource) => {
    let originalContent = resource.originalContent || ''
    let modifiedContent = resource.modifiedContent || ''
    let status = resource.status || 'unchanged'

    if (options?.ignoreMetadataChanges && status === 'changed') {
      originalContent = stripYamlMetadataChanges(originalContent)
      modifiedContent = stripYamlMetadataChanges(modifiedContent)
      if (originalContent === modifiedContent) {
        status = 'unchanged'
      }
    }

    return {
      path: resource.path,
      originalContent,
      modifiedContent,
      status,
    }
  })
}

function stripYamlMetadataChanges(content: string) {
  if (!content.trim()) {
    return content
  }

  try {
    const parsed = yaml.load(content)
    return yaml
      .dump(stripMetadataLabelsAndAnnotations(parsed), {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      })
      .trim()
  } catch {
    return content
  }
}

function stripMetadataLabelsAndAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripMetadataLabelsAndAnnotations)
  }
  if (!isRecord(value)) {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'metadata' && isRecord(child)) {
      const metadata = stripMetadataLabelsAndAnnotations(child)
      if (!isRecord(metadata)) {
        continue
      }
      delete metadata.labels
      delete metadata.annotations
      if (Object.keys(metadata).length > 0) {
        next[key] = metadata
      }
      continue
    }
    next[key] = stripMetadataLabelsAndAnnotations(child)
  }
  return next
}

function toManifestFiles(
  manifest: string,
  defaultNamespace: string,
  resources: HelmReleaseResource[] = []
): YamlFileTreeItem[] {
  let resourceIndex = 0

  return splitManifestDocuments(manifest).flatMap((doc, index) => {
    if (isCommentOnlyManifestDocument(doc)) {
      return []
    }

    const content = trimHelmSourceComment(doc)
    let path = `manifest-${index + 1}.yaml`

    try {
      const parsed = yaml.load(doc) as
        | {
            kind?: string
            metadata?: {
              name?: string
              namespace?: string
            }
          }
        | undefined

      if (parsed?.kind && parsed.metadata?.name) {
        const resource = resources[resourceIndex]
        resourceIndex += 1
        path = manifestResourcePath(
          resource || {
            apiVersion: '',
            kind: parsed.kind,
            name: parsed.metadata.name,
            namespace: parsed.metadata.namespace || defaultNamespace,
          },
          index
        )
      }
    } catch {
      path = `manifest-${index + 1}.yaml`
    }

    return [{ path, content }]
  })
}

function splitManifestDocuments(manifest: string) {
  const docs: string[] = []
  let lines: string[] = []

  for (const line of manifest.split('\n')) {
    const marker = line.replace(/[ \t\r]+$/, '')
    if (marker === '---' || marker.startsWith('--- #')) {
      const doc = lines.join('\n').trim()
      if (doc) {
        docs.push(doc)
      }
      lines = []
      continue
    }
    lines.push(line)
  }

  const doc = lines.join('\n').trim()
  if (doc) {
    docs.push(doc)
  }
  return docs
}

function trimHelmSourceComment(content: string) {
  const lines = content.split('\n')
  if (lines[0]?.trim().startsWith('# Source:')) {
    return lines.slice(1).join('\n').trim()
  }
  return content
}

function isCommentOnlyManifestDocument(content: string) {
  return content
    .split('\n')
    .every((line) => !line.trim() || line.trim().startsWith('#'))
}

function manifestResourcePath(resource: HelmReleaseResource, index: number) {
  const scope = resource.namespace || 'cluster'
  const kind = resource.kind || 'Resource'
  const name = resource.name || `manifest-${index + 1}`
  return `${scope}/${kind}/${name}.yaml`
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

function HelmReleaseHistoryDiffDialog({
  base,
  target,
  open,
  onOpenChange,
}: {
  base: HelmReleaseHistoryItem
  target: HelmReleaseHistoryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [older, newer] =
    base.revision <= target.revision ? [base, target] : [target, base]
  const originalYaml = yaml.dump(older.values || {}, { indent: 2 })
  const modifiedYaml = yaml.dump(newer.values || {}, { indent: 2 })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-4rem)] w-[calc(100vw-4rem)] !max-w-4xl flex-col overflow-hidden sm:!max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('helm.actions.compareValues')}</DialogTitle>
          <DialogDescription>
            {t('common.fields.revision')} {older.revision} →{' '}
            {t('common.fields.revision')} {newer.revision}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <ValuesDiffEditor
            original={originalYaml}
            modified={modifiedYaml}
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
  const [selectedRevisions, setSelectedRevisions] = useState<number[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const {
    data,
    isLoading,
    isError,
    error,
    refetch: refetchHistory,
  } = useHelmReleaseHistory(namespace, name)
  const itemByRevision = useMemo(
    () =>
      new Map(
        (data?.items || []).map((item): [number, HelmReleaseHistoryItem] => [
          item.revision,
          item,
        ])
      ),
    [data?.items]
  )
  // Toggle a revision in the compare selection, capped at 2 — picking a third drops the oldest.
  const toggleRevision = (revision: number) => {
    setSelectedRevisions((prev) =>
      prev.includes(revision)
        ? prev.filter((r) => r !== revision)
        : [...prev, revision].slice(-2)
    )
  }

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
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('common.tabs.history')}</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {selectedRevisions.length}/2
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedRevisions.length !== 2}
            onClick={() => setCompareOpen(true)}
          >
            {t('helm.actions.compareValues')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <SimpleTable
          data={data?.items || []}
          emptyMessage={t('helm.messages.noHistory', 'No history found')}
          columns={[
            {
              header: '',
              accessor: (item) => item,
              cell: (value) => {
                const item = value as HelmReleaseHistoryItem
                return (
                  <Checkbox
                    checked={selectedRevisions.includes(item.revision)}
                    onCheckedChange={() => toggleRevision(item.revision)}
                    aria-label={`Select revision ${item.revision}`}
                  />
                )
              },
              align: 'center',
            },
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
      {compareOpen && selectedRevisions.length === 2 ? (
        <HelmReleaseHistoryDiffDialog
          base={itemByRevision.get(selectedRevisions[0])!}
          target={itemByRevision.get(selectedRevisions[1])!}
          open={compareOpen}
          onOpenChange={setCompareOpen}
        />
      ) : null}
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
    dumpSortedYaml(
      mergeValuesDeep(release.spec?.defaultValues, release.spec?.values || {})
    )
  )
  const [sideBySide, setSideBySide] = useState(false)
  // Distinguishes real user edits from programmatic prefills: the diff editor
  // echoes prop-driven updates through onModifiedChange, so only a value that
  // differs from the last state we set counts as "touched" (kubeapps'
  // valuesModified flag).
  const [valuesTouched, setValuesTouched] = useState(false)
  const valuesYamlRef = useRef(valuesYaml)
  const [forceConflicts, setForceConflicts] = useState(false)
  const [wait, setWait] = useState(false)
  const [rollbackOnFailure, setRollbackOnFailure] = useState(false)
  const [ignoreMetadataChanges, setIgnoreMetadataChanges] = useState(false)
  const [highlightDiff, setHighlightDiff] = useState(true)
  const [compareAgainst, setCompareAgainst] = useState<'deployed' | 'package'>(
    'deployed'
  )
  const [error, setError] = useState('')
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [isDryRunning, setIsDryRunning] = useState(false)
  const [dryRunPreview, setDryRunPreview] =
    useState<HelmReleaseDryRunResponse | null>(null)
  const chartSelection = useHelmReleaseChartSelection({
    chartName,
    currentVersion,
    open: open && !!chartName,
    selectedRepository,
  })
  const {
    activeChart,
    activeChartSource,
    activeRepository,
    selectedChart,
    currentVersionChart,
  } = chartSelection
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
  // Raw values.yaml of the installed version — the comment-preserving source
  // for the "deployed values" diff baseline.
  const currentDefaultsQuery = useHelmChartContent(
    activeRepository || undefined,
    chartName,
    'values',
    currentVersion || undefined,
    activeChartSource,
    open && !!activeChart && !!currentVersion
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
  const chartUrl = canUseCurrentChart
    ? undefined
    : selectedChartQuery.data?.chartUrl
  const isVersionLoading = !!activeChart && latestChartQuery.isLoading
  const isChartPackageLoading =
    !!activeChart && !canUseCurrentChart && selectedChartQuery.isLoading
  const isDefaultValuesLoading = defaultValuesQuery.isLoading
  const readableError = error.replace(/\s&&\s/g, '\n')
  // Default values of the currently selected chart version (falls back to the
  // installed version's defaults until the query resolves).
  const selectedVersionDefaultsObj = useMemo(
    () =>
      parseRecordYaml(
        defaultValuesQuery.data?.content,
        release.spec?.defaultValues || {}
      ),
    [defaultValuesQuery.data?.content, release.spec?.defaultValues]
  )
  // Prefill and both diff baselines, always built from the same source shape
  // so the diff never shows phantom changes. Preferred: comment-preserving
  // YAML AST surgery on the raw values.yaml texts (needs both the selected and
  // the installed version's text); fallback: normalized object-level merge.
  const selectedDefaultsText = defaultValuesQuery.data?.content
  const currentDefaultsText = currentDefaultsQuery.data?.content
  const valuesModel = useMemo(() => {
    const userValues = release.spec?.values || {}
    if (selectedDefaultsText && currentDefaultsText) {
      const prefill = mergeValuesIntoYamlText(selectedDefaultsText, userValues)
      const deployedBaseline = mergeValuesIntoYamlText(
        currentDefaultsText,
        userValues
      )
      if (prefill !== null && deployedBaseline !== null) {
        return {
          prefill,
          deployedBaseline,
          packageBaseline: selectedDefaultsText,
        }
      }
    }
    return {
      prefill: dumpSortedYaml(
        mergeValuesDeep(selectedVersionDefaultsObj, userValues)
      ),
      deployedBaseline: dumpSortedYaml(
        mergeValuesDeep(release.spec?.defaultValues, userValues)
      ),
      // selectedVersionDefaultsObj already resolves to the installed version's
      // defaults when the selected version's text hasn't loaded, so a single
      // sorted dump covers both the loaded and fallback cases.
      packageBaseline: dumpSortedYaml(selectedVersionDefaultsObj),
    }
  }, [
    currentDefaultsText,
    release.spec?.defaultValues,
    release.spec?.values,
    selectedDefaultsText,
    selectedVersionDefaultsObj,
  ])
  // kubeapps-style: disabling the diff keeps the same editor but diffs the
  // value against itself, so no highlights are rendered.
  const diffOriginal = highlightDiff
    ? compareAgainst === 'package'
      ? valuesModel.packageBaseline
      : valuesModel.deployedBaseline
    : valuesYaml

  // Prefill: until the user edits the values themselves, follow the selected
  // version — its full default values with the user's deployed overrides
  // merged on top (same keys auto-overridden). The diff against the deployed
  // baseline then shows exactly what the upgrade changes.
  useEffect(() => {
    if (valuesTouched) {
      return
    }
    valuesYamlRef.current = valuesModel.prefill
    setValuesYaml(valuesModel.prefill)
  }, [valuesModel.prefill, valuesTouched])
  const dryRunDiffFiles = useMemo(
    () =>
      dryRunPreview
        ? toDryRunDiffFiles(dryRunPreview.resources, {
            ignoreMetadataChanges,
          })
        : [],
    [dryRunPreview, ignoreMetadataChanges]
  )

  const buildUpgradeRequest = (): HelmReleaseUpgradeRequest | null => {
    setError('')

    if (!chartUrl && !canUseCurrentChart) {
      setError(t('helmCharts.messages.noChartUrl'))
      return null
    }

    let values: Record<string, unknown> = {}
    if (valuesYaml.trim()) {
      try {
        const parsed = yaml.load(valuesYaml)
        if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          setError(t('helmCharts.messages.invalidValues'))
          return null
        }
        // The editor shows the full merged configuration; submit only the
        // minimal override set so chart defaults keep evolving on upgrades.
        const pruned = pruneDefaultsDeep(
          parsed || {},
          selectedVersionDefaultsObj
        )
        values = (pruned || {}) as Record<string, unknown>
      } catch (err) {
        setError(translateError(err, t))
        return null
      }
    }

    return {
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
  }

  const handleDryRun = async () => {
    const request = buildUpgradeRequest()
    if (!request) {
      return
    }

    setIsDryRunning(true)
    try {
      const preview = await dryRunUpgradeHelmRelease(
        release.metadata.namespace,
        release.metadata.name,
        request
      )
      setDryRunPreview(preview)
    } catch (err) {
      const message = translateError(err, t)
      setError(message)
    } finally {
      setIsDryRunning(false)
    }
  }

  const handleUpgrade = async () => {
    const request = buildUpgradeRequest()
    if (!request) {
      return
    }

    setIsUpgrading(true)
    try {
      await upgradeHelmRelease(
        release.metadata.namespace,
        release.metadata.name,
        request
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (dryRunPreview) {
      await handleUpgrade()
      return
    }
    await handleDryRun()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] w-[calc(100vw-4rem)] !max-w-[calc(100vw-4rem)] flex-col overflow-hidden"
        onPointerDownOutside={(event) => {
          event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
        }}
      >
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

          <div
            className={
              dryRunPreview
                ? 'flex min-h-0 flex-1 flex-col gap-4 overflow-hidden pr-1'
                : 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1'
            }
          >
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
              <HelmReleaseChartSelector
                selection={chartSelection}
                disabled={isUpgrading || isDryRunning || !!dryRunPreview}
                detailVersion={activeVersion}
                className="md:max-w-xl"
                onSelectedRepositoryChange={(value) => {
                  setSelectedRepository(value)
                  setSelectedVersion('')
                  setDryRunPreview(null)
                }}
              />

              <div className="grid gap-2">
                <Label>{t('helm.fields.version')}</Label>
                {visibleVersionOptions.length > 0 ? (
                  <Select
                    value={activeVersion}
                    onValueChange={(value) => {
                      setSelectedVersion(value)
                      setDryRunPreview(null)
                    }}
                    disabled={isUpgrading || isDryRunning || !!dryRunPreview}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      className="min-w-80"
                      viewportClassName="h-auto max-h-72 overflow-y-auto"
                    >
                      {visibleVersionOptions.map((version) => (
                        <SelectItem
                          key={version.version}
                          value={version.version}
                          textValue={version.version}
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
                          {version.publishedAt ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatDate(version.publishedAt)}
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

            {dryRunPreview ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
                  <Label
                    htmlFor="helm-dry-run-ignore-metadata-changes"
                    className="flex items-center gap-2 font-normal text-muted-foreground"
                  >
                    <Checkbox
                      id="helm-dry-run-ignore-metadata-changes"
                      checked={ignoreMetadataChanges}
                      onCheckedChange={(value) =>
                        setIgnoreMetadataChanges(value === true)
                      }
                      disabled={isUpgrading || isDryRunning}
                    />
                    {t('helm.fields.ignoreLabelsAnnotationsChanges')}
                  </Label>
                </div>
                <YamlFileTreeDiffViewer
                  files={dryRunDiffFiles}
                  title={t('helm.fields.dryRunPreview')}
                  emptyMessage={t('helm.messages.noDryRunResources')}
                  fillHeight
                />
              </div>
            ) : (
              <div className="grid min-h-0 gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>{t('helm.tabs.values')}</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    {highlightDiff ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">
                          {t('helm.fields.compareAgainst')}
                        </span>
                        <ToggleGroup
                          type="single"
                          size="sm"
                          variant="outline"
                          value={compareAgainst}
                          onValueChange={(value) =>
                            value &&
                            setCompareAgainst(value as 'deployed' | 'package')
                          }
                        >
                          <ToggleGroupItem
                            value="deployed"
                            className="flex-none px-2"
                          >
                            {t('helm.fields.deployedValues')}
                          </ToggleGroupItem>
                          <ToggleGroupItem
                            value="package"
                            className="flex-none px-2"
                          >
                            {t('helm.fields.packageValues')}
                          </ToggleGroupItem>
                        </ToggleGroup>
                        {compareAgainst === 'package' &&
                        isDefaultValuesLoading ? (
                          <Loader2 className="size-3 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                    ) : null}
                    <Label
                      htmlFor="helm-upgrade-highlight-diff"
                      className="flex items-center gap-2 font-normal text-muted-foreground"
                    >
                      <Checkbox
                        id="helm-upgrade-highlight-diff"
                        checked={highlightDiff}
                        onCheckedChange={(value) =>
                          setHighlightDiff(value === true)
                        }
                      />
                      {t('helm.fields.highlightChanges')}
                    </Label>
                    <Label
                      htmlFor="helm-upgrade-side-by-side"
                      className="flex items-center gap-2 font-normal text-muted-foreground"
                    >
                      <Checkbox
                        id="helm-upgrade-side-by-side"
                        checked={sideBySide}
                        onCheckedChange={(value) =>
                          setSideBySide(value === true)
                        }
                      />
                      {t('helm.fields.sideBySide')}
                    </Label>
                  </div>
                </div>
                <ValuesDiffEditor
                  original={diffOriginal}
                  modified={valuesYaml}
                  renderSideBySide={sideBySide}
                  onModifiedChange={(value) => {
                    if (value !== valuesYamlRef.current) {
                      setValuesTouched(true)
                    }
                    valuesYamlRef.current = value
                    setValuesYaml(value)
                    setDryRunPreview(null)
                  }}
                  readOnly={isUpgrading || isDryRunning}
                  height="calc(100dvh - 20rem)"
                />
              </div>
            )}

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
                  disabled={isUpgrading || isDryRunning}
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
                  disabled={isUpgrading || isDryRunning}
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
                  disabled={isUpgrading || isDryRunning}
                />
                {t('helm.fields.rollbackOnFailure')}
              </Label>
            </div>
            {dryRunPreview ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDryRunPreview(null)}
                disabled={isUpgrading || isDryRunning}
              >
                {t('helm.actions.backToValues')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isUpgrading || isDryRunning}
              >
                {t('common.actions.cancel')}
              </Button>
            )}
            {!dryRunPreview ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDryRun()}
                disabled={
                  isUpgrading ||
                  isDryRunning ||
                  !activeVersion ||
                  isChartPackageLoading ||
                  (!chartUrl && !canUseCurrentChart)
                }
              >
                {isDryRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t('helm.actions.dryRun')}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => void handleUpgrade()}
              disabled={
                isUpgrading ||
                isDryRunning ||
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
  const [autoUpgradeDialogOpen, setAutoUpgradeDialogOpen] = useState(false)
  const { data, isLoading, error, refetch } = useResource(
    'helmrelease',
    name,
    namespace
  )
  const autoUpgradeQuery = useHelmReleaseAutoUpgrade(namespace, name, {
    enabled: !!data,
    staleTime: 30_000,
  })
  const isAutoUpgradeEnabled = autoUpgradeQuery.data?.enabled === true
  const autoUpgradeLastError = isAutoUpgradeEnabled
    ? autoUpgradeQuery.data?.lastError?.trim() || ''
    : ''
  const autoUpgradeButtonTitle = autoUpgradeLastError
    ? `${t('helm.actions.autoUpgrade')} (${t('common.fields.error')}: ${autoUpgradeLastError})`
    : isAutoUpgradeEnabled
      ? `${t('helm.actions.autoUpgrade')} (${t('status.enabled')})`
      : t('helm.actions.autoUpgrade')
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
  const manifestFiles = useMemo(
    () =>
      toManifestFiles(
        data?.spec?.manifest || '',
        data?.spec?.namespace || namespace,
        data?.status?.resources
      ),
    [
      data?.spec?.manifest,
      data?.spec?.namespace,
      data?.status?.resources,
      namespace,
    ]
  )

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
          <YamlFileTreeViewer
            files={manifestFiles}
            title={t('helm.tabs.manifest')}
            emptyMessage={t('helm.messages.noResources')}
          />
        ) : null,
      },
    ],
    [
      containers,
      data,
      initContainers,
      labelSelector,
      manifestFiles,
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
      showClone={false}
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
            title={autoUpgradeButtonTitle}
            aria-label={autoUpgradeButtonTitle}
            onClick={() => setAutoUpgradeDialogOpen(true)}
          >
            {autoUpgradeLastError ? (
              <IconExclamationCircle className="size-4 fill-red-500 dark:fill-red-400" />
            ) : isAutoUpgradeEnabled ? (
              <IconCircleCheckFilled className="size-4 fill-green-500 dark:fill-green-400" />
            ) : null}
            {t('helm.actions.autoUpgrade')}
          </Button>
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
          {data && autoUpgradeDialogOpen ? (
            <HelmReleaseAutoUpgradeDialog
              release={data}
              open={autoUpgradeDialogOpen}
              onOpenChange={setAutoUpgradeDialogOpen}
              onSaved={autoUpgradeQuery.refetch}
            />
          ) : null}
        </>
      }
    />
  )
}
