import { useMemo } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import { Service } from 'kubernetes-types/core/v1'
import { toast } from 'sonner'

import { updateResource, useResource } from '@/lib/api'
import { withSubPath } from '@/lib/subpath'
import { formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { OwnerInfoDisplay } from '@/components/owner-info-display'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function ServiceDetail(props: { name: string; namespace?: string }) {
  const { namespace, name } = props

  const { data, isLoading, isError, error, refetch } = useResource(
    'services',
    name,
    namespace
  )

  const handleSaveYaml = async (content: Service) => {
    await updateResource('services', name, namespace, content)
    toast.success('YAML saved successfully')
    await refetch()
  }

  const tabs = useMemo<ResourceDetailShellTab<Service>[]>(
    () => [
      {
        value: 'related',
        label: 'Related',
        content: (
          <RelatedResourcesTable
            resource="services"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'events',
        label: 'Events',
        content: (
          <EventTable resource="services" name={name} namespace={namespace} />
        ),
      },
      {
        value: 'history',
        label: 'History',
        content: data ? (
          <ResourceHistoryTable
            resourceType="services"
            name={name}
            namespace={namespace}
            currentResource={data}
          />
        ) : null,
      },
    ],
    [data, name, namespace]
  )

  return (
    <ResourceDetailShell
      resourceType="services"
      resourceLabel="Service"
      name={name}
      namespace={namespace}
      data={data}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={refetch}
      onSaveYaml={handleSaveYaml}
      overview={
        data ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="capitalize">
                  Service Information
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
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Ports
                    </Label>
                    <div className="flex flex-wrap items-center gap-1">
                      {(data.spec?.ports || []).map((port, index, array) => (
                        <span key={`${port.port}-${port.protocol}`}>
                          <a
                            href={withSubPath(
                              `/api/v1/namespaces/${namespace}/services/${name}:${port.port}/proxy/`
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono app-link"
                          >
                            {(port.name || port.protocol) &&
                              `${port.name || port.protocol}:`}
                            {port.port}
                            <IconExternalLink className="w-3 h-3" />
                          </a>
                          {index < array.length - 1 && ', '}
                        </span>
                      ))}
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
        ) : null
      }
      extraTabs={tabs}
    />
  )
}
