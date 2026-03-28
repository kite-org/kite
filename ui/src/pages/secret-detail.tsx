import { useEffect, useState } from 'react'
import { IconLoader, IconRefresh, IconTrash } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { Secret } from 'kubernetes-types/core/v1'
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
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { KeyValueDataViewer } from '@/components/key-value-data-viewer'
import { LabelsAnno } from '@/components/lables-anno'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { YamlEditor } from '@/components/yaml-editor'

export function SecretDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [showDecodedYaml, setShowDecodedYaml] = useState(false)

  const { t } = useTranslation()

  const {
    data,
    isLoading,
    isError,
    error,
    refetch: handleRefresh,
  } = useResource('secrets', name, namespace)

  useEffect(() => {
    if (data) {
      setYamlContent(yaml.dump(data, { indent: 2 }))
    }
  }, [data])

  const handleSaveYaml = async (content: Secret) => {
    setIsSavingYaml(true)
    try {
      await updateResource('secrets', name, namespace, content)
      toast.success('YAML saved successfully')
      await handleRefresh()
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
  }

  const handleManualRefresh = async () => {
    setRefreshKey((prev) => prev + 1)
    await handleRefresh()
  }

  const getDecodedYamlContent = () => {
    if (!data) return yamlContent

    const showSecret = { ...data } as Secret
    if (showDecodedYaml) {
      if (showSecret.data) {
        const decodedData: Record<string, string> = {}
        Object.entries(showSecret.data).forEach(([key, value]) => {
          decodedData[key] = atob(value)
        })
        showSecret.stringData = decodedData
        showSecret.data = undefined
      }
    } else {
      if (showSecret.stringData) {
        const data: Record<string, string> = {}
        Object.entries(showSecret.stringData).forEach(([key, value]) => {
          data[key] = btoa(value)
        })
        showSecret.data = data
        showSecret.stringData = undefined
      }
    }
    return yaml.dump(showSecret, { indent: 2 })
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
        resourceName="Secret"
        refetch={handleRefresh}
      />
    )
  }

  if (!data) {
    return <div>Secret not found</div>
  }

  const secret = data as Secret
  const ownerInfo = getOwnerInfo(secret.metadata)
  const isOwnedBy = ownerInfo !== null
  const owner = ownerInfo

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{secret.metadata!.name}</h1>
          <p className="text-muted-foreground">
            Namespace:{' '}
            <span className="font-medium">{secret.metadata!.namespace}</span>
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button variant="outline" size="sm" onClick={handleManualRefresh}>
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
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
                {/* Secret Information */}
                <Card>
                  <CardHeader>
                    <CardTitle>Secret Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(
                            secret.metadata!.creationTimestamp!,
                            true
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Type
                        </Label>
                        <p className="text-sm">
                          <Badge variant="outline">
                            {secret.type || 'Opaque'}
                          </Badge>
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Keys
                        </Label>
                        <p className="text-sm">
                          {Object.keys(secret.data || {}).length}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Size
                        </Label>
                        <p className="text-sm">
                          {Object.values(secret.data || {}).reduce(
                            (total, value) => total + value.length,
                            0
                          )}{' '}
                          bytes
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          UID
                        </Label>
                        <p className="text-sm font-mono">
                          {secret.metadata!.uid}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Resource Version
                        </Label>
                        <p className="text-sm font-mono">
                          {secret.metadata!.resourceVersion}
                        </p>
                      </div>
                      {isOwnedBy && owner && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Owner
                          </Label>
                          <p className="text-sm">
                            <Link to={owner.path} className="app-link">
                              {owner.kind}/{owner.name}
                            </Link>
                          </p>
                        </div>
                      )}
                    </div>
                    <LabelsAnno
                      labels={secret.metadata!.labels || {}}
                      annotations={secret.metadata!.annotations || {}}
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
                {secret.data && (
                  <Badge variant="secondary">
                    {Object.keys(secret.data).length}
                  </Badge>
                )}
              </>
            ),
            content: (
              <KeyValueDataViewer
                entries={secret.data || {}}
                sensitive
                base64Encoded
                emptyMessage="No data entries"
              />
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  {secret.data && Object.keys(secret.data).length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDecodedYaml(!showDecodedYaml)}
                    >
                      {showDecodedYaml ? 'Show Base64' : 'Decode Values'}
                    </Button>
                  )}
                </div>
                <YamlEditor<'secrets'>
                  key={`${refreshKey}-${showDecodedYaml}`}
                  value={getDecodedYamlContent()}
                  onChange={handleYamlChange}
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
                resource="secrets"
                name={secret.metadata!.name!}
                namespace={secret.metadata!.namespace}
              />
            ),
          },
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource="secrets"
                name={secret.metadata!.name!}
                namespace={secret.metadata!.namespace}
              />
            ),
          },
          {
            value: 'history',
            label: 'History',
            content: (
              <ResourceHistoryTable
                resourceType="secrets"
                name={name}
                namespace={namespace}
                currentResource={secret}
              />
            ),
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={secret.metadata!.name!}
        resourceType="secrets"
        namespace={namespace}
      />
    </div>
  )
}
