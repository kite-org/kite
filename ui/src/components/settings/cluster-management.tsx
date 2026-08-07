import { useCallback, useMemo, useState } from 'react'
import {
  IconCopy,
  IconEdit,
  IconPlus,
  IconServer,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Cluster } from '@/types/api'
import {
  ClusterCreateRequest,
  ClusterUpdateRequest,
  createCluster,
  deleteCluster,
  importClusters,
  updateCluster,
  useClusterList,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { ClusterDialog } from './cluster-dialog'
import { ClusterImportDialog } from './cluster-import-dialog'

export function ClusterManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const {
    data: clusters = [],
    isLoading,
    error,
  } = useClusterList({
    refetchInterval: 5000,
  })

  const [showClusterDialog, setShowClusterDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [editingCluster, setEditingCluster] = useState<Cluster | null>(null)
  const [deletingCluster, setDeletingCluster] = useState<Cluster | null>(null)
  const [connectorCommand, setConnectorCommand] = useState('')
  const [connectorYaml, setConnectorYaml] = useState('')
  const [connectorCopyError, setConnectorCopyError] = useState<
    'command' | 'yaml' | null
  >(null)

  const getClusterTypeBadge = useCallback(
    (cluster: Cluster) => {
      if (cluster.connector) {
        return (
          <Badge
            variant="outline"
            className="bg-violet-50 text-violet-700 border-violet-200"
          >
            {t('clusterManagement.type.connector', 'Kite Connector')}
          </Badge>
        )
      }
      if (cluster.inCluster) {
        return (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200"
          >
            {t('clusterManagement.type.inCluster', 'In-Cluster')}
          </Badge>
        )
      }
      return (
        <Badge
          variant="outline"
          className="bg-gray-50 text-gray-700 border-gray-200"
        >
          {t('clusterManagement.type.external', 'External')}
        </Badge>
      )
    },
    [t]
  )

  const getStatusBadge = useCallback(
    (cluster: Cluster) => {
      if (!cluster.enabled) {
        return (
          <Badge variant="secondary">{t('status.disabled', 'Disabled')}</Badge>
        )
      }
      if (cluster.connector && !cluster.connected) {
        return (
          <Badge variant="outline">
            {t('clusterManagement.status.waiting', 'Waiting for Connector')}
          </Badge>
        )
      }
      if (cluster.connector) {
        return (
          <Badge variant="default">
            {t('clusterManagement.status.connected', 'Connected')}
          </Badge>
        )
      }
      return <Badge variant="default">{t('status.enabled', 'Enabled')}</Badge>
    },
    [t]
  )

  const columns = useMemo<ColumnDef<Cluster>[]>(
    () => [
      {
        id: 'name',
        header: t('common.fields.name', 'Name'),
        cell: ({ row: { original: cluster } }) => (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{cluster.name}</span>
              {cluster.isDefault && <Badge variant="secondary">Default</Badge>}
            </div>
            {cluster.description && (
              <div className="text-sm text-muted-foreground">
                {cluster.description}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'version',
        header: t('common.fields.version', 'Version'),
        cell: ({ row: { original: cluster } }) => {
          if (cluster.connector && !cluster.connected) {
            return <span className="text-muted-foreground">-</span>
          }
          if (cluster.error) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive">Error</Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs break-all">{cluster.error}</p>
                </TooltipContent>
              </Tooltip>
            )
          }
          return (
            <Badge variant="secondary" className="font-mono">
              {cluster.version || '-'}
            </Badge>
          )
        },
      },
      {
        id: 'type',
        header: t('common.fields.type', 'Type'),
        cell: ({ row: { original: cluster } }) => getClusterTypeBadge(cluster),
      },
      {
        id: 'status',
        header: t('common.fields.status', 'Status'),
        cell: ({ row: { original: cluster } }) => (
          <div className="flex items-center gap-3">
            {getStatusBadge(cluster)}
          </div>
        ),
      },
      {
        id: 'Prometheus',
        header: t('common.fields.prometheus', 'Prometheus'),
        cell: ({ row: { original: cluster } }) => (
          <div className="text-sm text-muted-foreground">
            {cluster.prometheusURL ? 'Yes' : 'No'}
          </div>
        ),
      },
    ],
    [getClusterTypeBadge, getStatusBadge, t]
  )

  const actions = useMemo<Action<Cluster>[]>(
    () => [
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.actions.edit', 'Edit')}
          </>
        ),
        onClick: (cluster) => {
          setEditingCluster(cluster)
          setShowClusterDialog(true)
        },
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.actions.delete', 'Delete')}
          </div>
        ),
        shouldDisable: (cluster) => cluster.isDefault,
        onClick: (cluster) => {
          setDeletingCluster(cluster)
        },
      },
    ],
    [t]
  )

  const createMutation = useMutation({
    mutationFn: createCluster,
    onSuccess: ({ connectorServer, connectorToken }) => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
      toast.success(
        t('clusterManagement.messages.created', 'Cluster created successfully')
      )
      setShowClusterDialog(false)
      if (connectorServer && connectorToken) {
        setConnectorCopyError(null)
        setConnectorCommand(
          `kite connector --server='${connectorServer}' --token='${connectorToken}'`
        )
        setConnectorYaml(`apiVersion: v1
kind: Secret
metadata:
  name: kite-connector-token
  namespace: kube-system
type: Opaque
stringData:
  token: ${JSON.stringify(connectorToken)}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kite-connector
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kite-connector
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: kite-connector
    namespace: kube-system
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kite-connector
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: kite-connector
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kite-connector
    spec:
      serviceAccountName: kite-connector
      containers:
        - name: connector
          image: ghcr.io/kite-org/kite:latest
          command:
            - /app/kite
          args:
            - connector
            - --server=$(KITE_SERVER)
            - --token=$(CONNECTOR_TOKEN)
          env:
            - name: KITE_SERVER
              value: ${JSON.stringify(connectorServer)}
            - name: CONNECTOR_TOKEN
              valueFrom:
                secretKeyRef:
                  name: kite-connector-token
                  key: token`)
      }
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'clusterManagement.messages.createError',
            'Failed to create cluster'
          )
      )
    },
  })

  const importMutation = useMutation({
    mutationFn: (config: string) => importClusters({ config }),
    onSuccess: ({ importedCount }) => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
      queryClient.invalidateQueries({ queryKey: ['clusters'] })
      toast.success(
        t(
          'clusterManagement.messages.imported',
          'Imported or updated {{count}} clusters successfully',
          { count: importedCount }
        )
      )
      setShowImportDialog(false)
    },
  })

  // Update cluster mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ClusterUpdateRequest }) =>
      updateCluster(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
      toast.success(
        t('clusterManagement.messages.updated', 'Cluster updated successfully')
      )
      setShowClusterDialog(false)
      setEditingCluster(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'clusterManagement.messages.updateError',
            'Failed to update cluster'
          )
      )
    },
  })

  // Delete cluster mutation
  const deleteMutation = useMutation({
    mutationFn: deleteCluster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
      toast.success(
        t('clusterManagement.messages.deleted', 'Cluster deleted successfully')
      )
      setDeletingCluster(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'clusterManagement.messages.deleteError',
            'Failed to delete cluster'
          )
      )
    },
  })

  const handleSubmitCluster = (clusterData: ClusterCreateRequest) => {
    if (editingCluster) {
      // Update existing cluster - use the form data directly
      updateMutation.mutate({
        id: editingCluster.id,
        data: clusterData,
      })
    } else {
      // Create new cluster
      createMutation.mutate(clusterData)
    }
  }

  const handleDeleteCluster = () => {
    if (!deletingCluster) return
    deleteMutation.mutate(deletingCluster.id)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.messages.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-destructive">
          {t('clusterManagement.errors.loadFailed', 'Failed to load clusters')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconServer className="h-5 w-5" />
                {t('clusterManagement.title', 'Cluster Management')}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  importMutation.reset()
                  setShowImportDialog(true)
                }}
                className="gap-2"
              >
                <IconUpload className="size-4" />
                {t('clusterManagement.actions.import', 'Import Clusters')}
              </Button>
              <Button
                onClick={() => {
                  setEditingCluster(null)
                  setShowClusterDialog(true)
                }}
                className="gap-2"
              >
                <IconPlus className="h-4 w-4" />
                {t('clusterManagement.actions.add', 'Add Cluster')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ActionTable data={clusters} columns={columns} actions={actions} />
          {clusters.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconServer className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t('clusterManagement.empty.title', 'No clusters configured')}
              </p>
              <p className="text-sm mt-1">
                {t(
                  'clusterManagement.empty.description',
                  'Add your first cluster to get started'
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cluster Dialog (Add/Edit) */}
      <ClusterDialog
        open={showClusterDialog}
        onOpenChange={(open) => {
          setShowClusterDialog(open)
          if (!open) {
            setEditingCluster(null)
          }
        }}
        cluster={editingCluster}
        onSubmit={handleSubmitCluster}
      />

      <ClusterImportDialog
        open={showImportDialog}
        onOpenChange={(open) => {
          setShowImportDialog(open)
          if (!open) importMutation.reset()
        }}
        onSubmit={(config) => importMutation.mutate(config)}
        isSubmitting={importMutation.isPending}
        error={importMutation.error?.message}
      />

      <Dialog
        open={!!connectorCommand}
        onOpenChange={(open) => {
          if (!open) {
            setConnectorCommand('')
            setConnectorYaml('')
            setConnectorCopyError(null)
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-balance">
              {t('clusterManagement.connector.title', 'Connect Kite Connector')}
            </DialogTitle>
            <DialogDescription className="text-pretty">
              {t(
                'clusterManagement.connector.description',
                'Choose a command or Kubernetes YAML to run inside the target cluster. This connection information is shown only once.'
              )}
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="command">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="command">
                {t('clusterManagement.connector.command', 'Command')}
              </TabsTrigger>
              <TabsTrigger value="yaml">
                {t('clusterManagement.connector.yaml', 'Kubernetes YAML')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="command" className="space-y-2">
              <div className="flex gap-2">
                <Input
                  readOnly
                  className="font-mono"
                  aria-label={t(
                    'clusterManagement.connector.command',
                    'Command'
                  )}
                  value={connectorCommand}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t(
                    'clusterManagement.connector.copyCommand',
                    'Copy command'
                  )}
                  onClick={async () => {
                    if (!connectorCommand) return
                    try {
                      await navigator.clipboard.writeText(connectorCommand)
                      setConnectorCopyError(null)
                      toast.success(t('common.messages.copied', 'Copied'))
                    } catch {
                      setConnectorCopyError('command')
                    }
                  }}
                >
                  <IconCopy className="size-4" />
                </Button>
              </div>
              {connectorCopyError === 'command' && (
                <p role="alert" className="text-sm text-destructive">
                  {t(
                    'clusterManagement.connector.copyError',
                    'Failed to copy. Copy the content manually.'
                  )}
                </p>
              )}
            </TabsContent>
            <TabsContent value="yaml" className="space-y-2">
              <Textarea
                readOnly
                className="h-96 resize-none font-mono text-xs"
                aria-label={t(
                  'clusterManagement.connector.yaml',
                  'Kubernetes YAML'
                )}
                value={connectorYaml}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (!connectorYaml) return
                    try {
                      await navigator.clipboard.writeText(connectorYaml)
                      setConnectorCopyError(null)
                      toast.success(t('common.messages.copied', 'Copied'))
                    } catch {
                      setConnectorCopyError('yaml')
                    }
                  }}
                >
                  <IconCopy className="size-4" />
                  {t('clusterManagement.connector.copyYaml', 'Copy YAML')}
                </Button>
              </div>
              {connectorCopyError === 'yaml' && (
                <p role="alert" className="text-sm text-destructive">
                  {t(
                    'clusterManagement.connector.copyError',
                    'Failed to copy. Copy the content manually.'
                  )}
                </p>
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setConnectorCommand('')
                setConnectorYaml('')
                setConnectorCopyError(null)
              }}
            >
              {t('common.actions.close', 'Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={!!deletingCluster}
        onOpenChange={() => setDeletingCluster(null)}
        onConfirm={handleDeleteCluster}
        resourceName={deletingCluster?.name || ''}
        resourceType="cluster"
        additionalNote={t(
          'clusterManagement.deleteConfirmation',
          "This action will only remove the current cluster's configuration in kite and will not delete any cluster resources."
        )}
      />
    </div>
  )
}
