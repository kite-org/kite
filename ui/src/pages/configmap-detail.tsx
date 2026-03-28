import { useEffect, useState } from 'react'
import { IconLoader, IconRefresh, IconTrash } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { ConfigMap } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { updateResource, useResource } from '@/lib/api'
import { getOwnerInfo } from '@/lib/k8s'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { DescribeDialog } from '@/components/describe-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { KeyValueDataViewer } from '@/components/key-value-data-viewer'
import { LabelsAnno } from '@/components/lables-anno'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { YamlEditor } from '@/components/yaml-editor'

export function ConfigMapDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const { t } = useTranslation()

  const {
    data,
    isLoading,
    isError,
    error,
    refetch: handleRefresh,
  } = useResource('configmaps', name, namespace)

  useEffect(() => {
    if (data) {
      setYamlContent(yaml.dump(data, { indent: 2 }))
    }
  }, [data])

  const handleSaveYaml = async (content: ConfigMap) => {
    setIsSavingYaml(true)
    try {
      await updateResource('configmaps', name, namespace, content)
      toast.success('YAML saved successfully')
      await handleRefresh()
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleManualRefresh = async () => {
    setRefreshKey((prev) => prev + 1)
    await handleRefresh()
  }

  if (isLoading)
    return (
      <div className="flex items-center justify-center p-8">
        <IconLoader className="h-6 w-6 animate-spin" />
      </div>
    )

  if (isError) {
    return (
      <ErrorMessage
        error={error}
        resourceName="ConfigMap"
        refetch={handleRefresh}
      />
    )
  }

  if (!data) {
    return <div>ConfigMap not found</div>
  }

  const configmap = data as ConfigMap
  const ownerInfo = getOwnerInfo(configmap.metadata)
  const dataCount = Object.keys(configmap.data || {}).length
  const binaryDataCount = Object.keys(configmap.binaryData || {}).length
  const totalCount = dataCount + binaryDataCount

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{configmap.metadata!.name}</h1>
          <p className="text-muted-foreground">
            Namespace:{' '}
            <span className="font-medium">{configmap.metadata!.namespace}</span>
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button variant="outline" size="sm" onClick={handleManualRefresh}>
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <DescribeDialog
            resourceType="configmaps"
            namespace={namespace}
            name={name}
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsDeleteDialogOpen(true)}
          >
            <IconTrash className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </div>

      <ResponsiveTabs
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>ConfigMap Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(
                            configmap.metadata!.creationTimestamp!,
                            true
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Keys
                        </Label>
                        <p className="text-sm">{totalCount}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          UID
                        </Label>
                        <p className="text-sm font-mono">
                          {configmap.metadata!.uid}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Resource Version
                        </Label>
                        <p className="text-sm font-mono">
                          {configmap.metadata!.resourceVersion}
                        </p>
                      </div>
                      {ownerInfo && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Owner
                          </Label>
                          <p className="text-sm">
                            <Link
                              to={ownerInfo.path}
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {ownerInfo.kind}/{ownerInfo.name}
                            </Link>
                          </p>
                        </div>
                      )}
                    </div>
                    <LabelsAnno
                      labels={configmap.metadata!.labels || {}}
                      annotations={configmap.metadata!.annotations || {}}
                    />
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            value: 'data',
            label: (
              <>
                Data
                {totalCount > 0 && (
                  <Badge variant="secondary">{totalCount}</Badge>
                )}
              </>
            ),
            content: (
              <div className="space-y-4">
                {dataCount > 0 && (
                  <KeyValueDataViewer
                    entries={configmap.data!}
                    emptyMessage="No data entries"
                  />
                )}
                {binaryDataCount > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Binary Data
                    </p>
                    <KeyValueDataViewer
                      entries={Object.fromEntries(
                        Object.entries(configmap.binaryData!).map(([k, v]) => [
                          k,
                          v as unknown as string,
                        ])
                      )}
                      base64Encoded
                      emptyMessage="No binary data entries"
                    />
                  </div>
                )}
                {totalCount === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No data entries
                  </p>
                )}
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <div className="space-y-4">
                <YamlEditor<'configmaps'>
                  key={refreshKey}
                  value={yamlContent}
                  onChange={(c) => setYamlContent(c)}
                  onSave={handleSaveYaml}
                  isSaving={isSavingYaml}
                />
              </div>
            ),
          },
          {
            value: 'related',
            label: 'Related',
            content: (
              <RelatedResourcesTable
                resource="configmaps"
                name={configmap.metadata!.name!}
                namespace={configmap.metadata!.namespace}
              />
            ),
          },
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource="configmaps"
                name={configmap.metadata!.name!}
                namespace={configmap.metadata!.namespace}
              />
            ),
          },
          {
            value: 'history',
            label: 'History',
            content: (
              <ResourceHistoryTable
                resourceType="configmaps"
                name={name}
                namespace={namespace}
                currentResource={configmap}
              />
            ),
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={configmap.metadata!.name!}
        resourceType="configmaps"
        namespace={namespace}
      />
    </div>
  )
}
