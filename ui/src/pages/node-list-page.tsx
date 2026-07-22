import { useMemo, useState } from 'react'
import {
  IconBan,
  IconCircleCheckFilled,
  IconDroplet,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { NodeWithMetrics } from '@/types/api'
import { cordonNode, drainNode, uncordonNode } from '@/lib/api'
import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MetricCell } from '@/components/metrics-cell'
import { NodeStatusIcon } from '@/components/node-status-icon'
import { ResourceBatchActionDialog } from '@/components/resource-batch-action-dialog'
import {
  ResourceTable,
  type ResourceTableBatchAction,
} from '@/components/resource-table'

function getNodeStatus(node: NodeWithMetrics): string {
  const conditions = node.status?.conditions || []
  const isUnschedulable = node.spec?.unschedulable || false

  // Check if node is ready first
  const readyCondition = conditions.find((c) => c.type === 'Ready')
  const isReady = readyCondition?.status === 'True'

  if (isUnschedulable) {
    if (isReady) {
      return 'Ready,SchedulingDisabled'
    } else {
      return 'NotReady,SchedulingDisabled'
    }
  }

  if (isReady) {
    return 'Ready'
  }

  const networkUnavailable = conditions.find(
    (c) => c.type === 'NetworkUnavailable'
  )
  if (networkUnavailable?.status === 'True') {
    return 'NetworkUnavailable'
  }

  const memoryPressure = conditions.find((c) => c.type === 'MemoryPressure')
  if (memoryPressure?.status === 'True') {
    return 'MemoryPressure'
  }

  const diskPressure = conditions.find((c) => c.type === 'DiskPressure')
  if (diskPressure?.status === 'True') {
    return 'DiskPressure'
  }

  const pidPressure = conditions.find((c) => c.type === 'PIDPressure')
  if (pidPressure?.status === 'True') {
    return 'PIDPressure'
  }

  return 'NotReady'
}

function getNodeRoles(node: NodeWithMetrics): string[] {
  const labels = node.metadata?.labels || {}
  const roles: string[] = []

  // Check for common node role labels
  if (
    labels['node-role.kubernetes.io/master'] !== undefined ||
    labels['node-role.kubernetes.io/control-plane'] !== undefined
  ) {
    roles.push('control-plane')
  }

  if (labels['node-role.kubernetes.io/worker'] !== undefined) {
    roles.push('worker')
  }

  if (labels['node-role.kubernetes.io/etcd'] !== undefined) {
    roles.push('etcd')
  }

  Object.keys(labels).forEach((key) => {
    if (
      key.startsWith('node-role.kubernetes.io/') &&
      !['master', 'control-plane', 'worker', 'etcd'].includes(key.split('/')[1])
    ) {
      const role = key.split('/')[1]
      if (role && !roles.includes(role)) {
        roles.push(role)
      }
    }
  })

  return roles // Do not assume a default role if none are found
}

// Prefer Internal IP, then External IP, then fallback to hostname
function getNodeIP(node: NodeWithMetrics): string {
  const addresses = node.status?.addresses || []

  const internalIP = addresses.find((addr) => addr.type === 'InternalIP')
  if (internalIP) {
    return internalIP.address
  }

  const externalIP = addresses.find((addr) => addr.type === 'ExternalIP')
  if (externalIP) {
    return externalIP.address
  }

  const hostname = addresses.find((addr) => addr.type === 'Hostname')
  if (hostname) {
    return hostname.address
  }

  return 'N/A'
}

const nodeSearchFilter = createSearchFilter<NodeWithMetrics>(
  (n) => n.metadata?.name,
  (n) => n.status?.nodeInfo?.kubeletVersion,
  (n) => getNodeStatus(n),
  (n) => getNodeRoles(n),
  (n) => getNodeIP(n)
)

const columnHelper = createColumnHelper<NodeWithMetrics>()

export function NodeListPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [activeBatchAction, setActiveBatchAction] = useState<
    'cordon' | 'uncordon' | 'drain' | null
  >(null)
  const [batchNodes, setBatchNodes] = useState<NodeWithMetrics[]>([])
  const [drainOptions, setDrainOptions] = useState({
    force: false,
    gracePeriod: 30,
    deleteLocalData: false,
    ignoreDaemonsets: true,
  })

  const batchActions = useMemo<ResourceTableBatchAction<NodeWithMetrics>[]>(
    () => [
      {
        id: 'cordon',
        label: t('common.actions.cordon'),
        icon: <IconBan className="size-4" />,
        onSelect: (nodes) => {
          setBatchNodes(nodes)
          setActiveBatchAction('cordon')
        },
      },
      {
        id: 'uncordon',
        label: t('common.actions.uncordon'),
        icon: <IconCircleCheckFilled className="size-4" />,
        onSelect: (nodes) => {
          setBatchNodes(nodes)
          setActiveBatchAction('uncordon')
        },
      },
      {
        id: 'drain',
        label: t('common.actions.drain'),
        icon: <IconDroplet className="size-4" />,
        onSelect: (nodes) => {
          setBatchNodes(nodes)
          setActiveBatchAction('drain')
        },
      },
    ],
    [t]
  )

  // Define columns for the node table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.fields.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link to={`/nodes/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => getNodeStatus(row), {
        id: 'status',
        header: t('common.fields.status'),
        cell: ({ getValue }) => {
          const status = getValue()
          return (
            <Badge variant="outline" className="text-muted-foreground px-1.5">
              <NodeStatusIcon status={status} />
              {status}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => getNodeRoles(row).join(', '), {
        id: 'roles',
        header: 'Roles',
        cell: ({ row }) => {
          const roles = getNodeRoles(row.original)
          return (
            <div>
              {roles.map((role) => (
                <Badge
                  key={role}
                  variant={role === 'control-plane' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {role}
                </Badge>
              ))}
            </div>
          )
        },
      }),
      columnHelper.accessor((row) => row.metrics?.pods || 0, {
        id: 'pods',
        header: 'Pods',
        cell: ({ row }) => (
          <Link
            to={`/nodes/${row.original.metadata!.name}?tab=pods`}
            className="text-muted-foreground hover:text-primary/80 hover:underline transition-colors cursor-pointer"
          >
            {row.original.metrics?.pods || 0} /{' '}
            {row.original.metrics?.podsLimit || 0}
          </Link>
        ),
      }),
      columnHelper.accessor((row) => row.metrics?.cpuUsage || 0, {
        id: 'cpu',
        header: 'CPU',
        cell: ({ row }) => (
          <MetricCell
            metrics={row.original.metrics}
            type="cpu"
            limitLabel="Allocatable"
            showPercentage={true}
          />
        ),
      }),
      columnHelper.accessor((row) => row.metrics?.memoryUsage || 0, {
        id: 'memory',
        header: 'Memory',
        cell: ({ row }) => (
          <MetricCell
            metrics={row.original.metrics}
            type="memory"
            limitLabel="Allocatable"
            showPercentage={true}
          />
        ),
      }),
      columnHelper.accessor((row) => getNodeIP(row), {
        id: 'ip',
        header: 'IP Address',
        cell: ({ getValue }) => {
          const ip = getValue()
          return (
            <span className="text-sm font-mono text-muted-foreground">
              {ip}
            </span>
          )
        },
      }),
      columnHelper.accessor('status.nodeInfo.kubeletVersion', {
        header: 'Version',
        cell: ({ getValue }) => {
          const version = getValue()
          return version ? (
            <span className="text-sm font-mono">{version}</span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        },
      }),
      columnHelper.accessor('status.nodeInfo.kernelVersion', {
        header: 'Kernel Version',
        cell: ({ getValue }) => {
          const kernelVersion = getValue()
          return kernelVersion ? (
            <span className="text-sm">{kernelVersion}</span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        },
      }),
      columnHelper.accessor('status.nodeInfo.osImage', {
        header: 'OS Image',
        cell: ({ getValue }) => {
          const osImage = getValue()
          return osImage ? (
            <span className="text-sm">{osImage}</span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.fields.created'),
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')
          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
    ],
    [t]
  )

  const executeBatchAction = async (node: NodeWithMetrics) => {
    const name = node.metadata!.name!
    if (activeBatchAction === 'cordon') return cordonNode(name)
    if (activeBatchAction === 'uncordon') return uncordonNode(name)
    return drainNode(name, drainOptions)
  }

  const activeActionLabel = activeBatchAction
    ? t(`common.actions.${activeBatchAction}`)
    : ''

  return (
    <>
      <ResourceTable
        resourceName="Nodes"
        resourceType="nodes"
        columns={columns}
        clusterScope={true}
        searchQueryFilter={nodeSearchFilter}
        showCreateButton={false}
        batchActions={batchActions}
        defaultHiddenColumns={[
          'status_nodeInfo_kernelVersion',
          'status_nodeInfo_osImage',
        ]}
      />

      {activeBatchAction && (
        <ResourceBatchActionDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setActiveBatchAction(null)
          }}
          resources={batchNodes}
          title={t(
            `resourceTable.batchActions.${activeBatchAction}NodesTitle`,
            { count: batchNodes.length }
          )}
          description={t(
            `resourceTable.batchActions.${activeBatchAction}NodesDescription`,
            { count: batchNodes.length }
          )}
          actionLabel={activeActionLabel}
          onExecute={executeBatchAction}
          onComplete={() =>
            queryClient.invalidateQueries({ queryKey: ['nodes'] })
          }
          sequential={activeBatchAction === 'drain'}
          destructive={activeBatchAction === 'drain'}
          options={
            activeBatchAction === 'drain'
              ? (disabled) => (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="batch-drain-force"
                        checked={drainOptions.force}
                        onCheckedChange={(checked) =>
                          setDrainOptions((current) => ({
                            ...current,
                            force: checked === true,
                          }))
                        }
                        disabled={disabled}
                      />
                      <Label htmlFor="batch-drain-force">
                        {t('detail.dialogs.drainNode.forceDrain')}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="batch-drain-local-data"
                        checked={drainOptions.deleteLocalData}
                        onCheckedChange={(checked) =>
                          setDrainOptions((current) => ({
                            ...current,
                            deleteLocalData: checked === true,
                          }))
                        }
                        disabled={disabled}
                      />
                      <Label htmlFor="batch-drain-local-data">
                        {t('detail.dialogs.drainNode.deleteLocalData')}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="batch-drain-daemonsets"
                        checked={drainOptions.ignoreDaemonsets}
                        onCheckedChange={(checked) =>
                          setDrainOptions((current) => ({
                            ...current,
                            ignoreDaemonsets: checked === true,
                          }))
                        }
                        disabled={disabled}
                      />
                      <Label htmlFor="batch-drain-daemonsets">
                        {t('detail.dialogs.drainNode.ignoreDaemonSets')}
                      </Label>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="batch-drain-grace-period">
                        {t('detail.dialogs.drainNode.gracePeriod')}
                      </Label>
                      <Input
                        id="batch-drain-grace-period"
                        type="number"
                        min={0}
                        value={drainOptions.gracePeriod}
                        onChange={(event) =>
                          setDrainOptions((current) => ({
                            ...current,
                            gracePeriod: Number(event.target.value),
                          }))
                        }
                        disabled={disabled}
                        className="w-28 tabular-nums"
                      />
                    </div>
                  </div>
                )
              : undefined
          }
        />
      )}
    </>
  )
}
