import { useEffect, useState } from 'react'
import {
  IconExternalLink,
  IconLoader,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { Service } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { ResourceType } from '@/types/api'
import { updateResource, useResource } from '@/lib/api'
import { getOwnerInfo } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { formatDate, translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { DescribeDialog } from '@/components/describe-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { YamlEditor } from '@/components/yaml-editor'

export function ServiceDetail(props: { name: string; namespace?: string }) {
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
  } = useResource('services', name, namespace)

  useEffect(() => {
    if (data) {
      setYamlContent(yaml.dump(data, { indent: 2 }))
    }
  }, [data])

  const handleSaveYaml = async (content: Service) => {
    setIsSavingYaml(true)
    try {
      await updateResource('services', name, namespace, content)
      toast.success('YAML saved successfully')
      // Refresh data after successful save
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
    // Increment refresh key to force YamlEditor re-render
    setRefreshKey((prev) => prev + 1)
    await handleRefresh()
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading service details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorMessage
        resourceName={'service'}
        error={error}
        refetch={handleRefresh}
      />
    )
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{name}</h1>
          {namespace && (
            <p className="text-muted-foreground">
              Namespace: <span className="font-medium">{namespace}</span>
            </p>
          )}
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button
            disabled={isLoading}
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
          >
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <DescribeDialog
            resourceType={'services' as ResourceType}
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
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="capitalize">
                      Service Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(data.metadata?.creationTimestamp || '')}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          UID
                        </Label>
                        <p className="text-sm font-mono">
                          {data.metadata?.uid || 'N/A'}
                        </p>
                      </div>
                      {getOwnerInfo(data.metadata) && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Owner
                          </Label>
                          <p className="text-sm">
                            {(() => {
                              const ownerInfo = getOwnerInfo(data.metadata)
                              if (!ownerInfo) {
                                return 'No owner'
                              }
                              return (
                                <Link to={ownerInfo.path} className="app-link">
                                  {ownerInfo.kind}/{ownerInfo.name}
                                </Link>
                              )
                            })()}
                          </p>
                        </div>
                      )}
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Ports
                        </Label>
                        <div className="flex flex-wrap items-center gap-1">
                          {(data?.spec?.ports || []).map(
                            (port, index, array) => (
                              <span key={`${port.port}-${port.protocol}`}>
                                <a
                                  href={withSubPath(
                                    `/api/v1/namespaces/${namespace}/services/${name}:${port.port}/proxy/`
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono app-link inline-flex items-center gap-1"
                                >
                                  {(port.name || port.protocol) &&
                                    `${port.name || port.protocol}:`}
                                  {port.port}
                                  <IconExternalLink className="w-3 h-3" />
                                </a>
                                {index < array.length - 1 && ', '}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                    <LabelsAnno
                      labels={data.metadata?.labels || {}}
                      annotations={data.metadata?.annotations || {}}
                    />
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <div className="space-y-4">
                <YamlEditor<'services'>
                  key={refreshKey}
                  value={yamlContent}
                  title="YAML Configuration"
                  onSave={handleSaveYaml}
                  onChange={handleYamlChange}
                  isSaving={isSavingYaml}
                />
              </div>
            ),
          },
          {
            value: 'Related',
            label: 'Related',
            content: (
              <RelatedResourcesTable
                resource={'services'}
                name={name}
                namespace={namespace}
              />
            ),
          },
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource={'services'}
                namespace={namespace}
                name={name}
              />
            ),
          },
          {
            value: 'history',
            label: 'History',
            content: (
              <ResourceHistoryTable<'services'>
                resourceType={'services'}
                name={name}
                namespace={namespace}
                currentResource={data}
              />
            ),
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={name}
        resourceType="services"
        namespace={namespace}
      />
    </div>
  )
}
