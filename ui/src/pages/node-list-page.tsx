import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { NodeWithMetrics } from '@/types/api'
import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { MetricCell } from '@/components/metrics-cell'
import { NodeStatusIcon } from '@/components/node-status-icon'
import { ResourceTable } from '@/components/resource-table'

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

export function NodeListPage() {
  const { t } = useTranslation()

  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<NodeWithMetrics>()

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
      columnHelper.accessor((row) => getNodeRoles(row), {
        id: 'roles',
        header: 'Roles',
        cell: ({ getValue }) => {
          const roles = getValue()
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
      columnHelper.accessor((row) => row.metrics, {
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
    [columnHelper, t]
  )

  return (
    <ResourceTable
      resourceName="Nodes"
      resourceType="nodes"
      columns={columns}
      clusterScope={true}
      searchQueryFilter={nodeSearchFilter}
      showCreateButton={false}
      defaultHiddenColumns={[
        'status_nodeInfo_kernelVersion',
        'status_nodeInfo_osImage',
      ]}
    />
  )
}
