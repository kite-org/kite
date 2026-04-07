import { useMemo } from 'react'

import { ResourceType, ResourceTypeMap } from '@/types/api'
import { updateResource, useResource } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { OwnerInfoDisplay } from '@/components/owner-info-display'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'

import { getResourceLabel } from './resource-definitions'
import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function SimpleResourceDetail<T extends ResourceType>(props: {
  resourceType: T
  name: string
  namespace?: string
}) {
  const { namespace, name, resourceType } = props

  const { data, isLoading, error, refetch } = useResource(
    resourceType,
    name,
    namespace
  )

  const resourceLabel = getResourceLabel(resourceType)

  const handleSaveYaml = async (content: ResourceTypeMap[T]) => {
    await updateResource(resourceType, name, namespace, content)
    await refetch()
  }

  const tabs = useMemo<ResourceDetailShellTab<ResourceTypeMap[T]>[]>(
    () => [
      {
        value: 'related',
        label: 'Related',
        content: (
          <RelatedResourcesTable
            resource={resourceType}
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
            resource={resourceType}
            namespace={namespace}
            name={name}
          />
        ),
      },
      {
        value: 'history',
        label: 'History',
        content: data ? (
          <ResourceHistoryTable
            resourceType={resourceType}
            name={name}
            namespace={namespace}
            currentResource={data}
          />
        ) : null,
      },
    ],
    [data, name, namespace, resourceType]
  )

  return (
    <ResourceDetailShell
      resourceType={resourceType}
      resourceLabel={resourceLabel}
      name={name}
      namespace={namespace}
      data={data}
      isLoading={isLoading}
      error={error}
      onRefresh={refetch}
      onSaveYaml={handleSaveYaml}
      overview={
        data ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="capitalize">
                  {resourceLabel} Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Created
                    </Label>
                    <p className="text-sm">
                      {formatDate(data.metadata?.creationTimestamp || '')}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">UID</Label>
                    <p className="text-sm font-mono">
                      {data.metadata?.uid || 'N/A'}
                    </p>
                  </div>
                  <OwnerInfoDisplay metadata={data.metadata} />
                </div>
                <LabelsAnno
                  labels={data.metadata?.labels || {}}
                  annotations={data.metadata?.annotations || {}}
                />
              </CardContent>
            </Card>
          </div>
        ) : null
      }
      extraTabs={tabs}
    />
  )
}
