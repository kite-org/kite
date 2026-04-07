import { useMemo } from 'react'
import { ConfigMap } from 'kubernetes-types/core/v1'
import { toast } from 'sonner'

import { updateResource, useResource } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { KeyValueDataViewer } from '@/components/key-value-data-viewer'
import { LabelsAnno } from '@/components/lables-anno'
import { OwnerInfoDisplay } from '@/components/owner-info-display'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function ConfigMapDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props

  const { data, isLoading, isError, error, refetch } = useResource(
    'configmaps',
    name,
    namespace
  )
  const dataCount = data ? Object.keys(data.data || {}).length : 0
  const binaryDataCount = data ? Object.keys(data.binaryData || {}).length : 0
  const totalCount = dataCount + binaryDataCount

  const handleSaveYaml = async (content: ConfigMap) => {
    await updateResource('configmaps', name, namespace, content)
    toast.success('YAML saved successfully')
    await refetch()
  }

  const tabs = useMemo<ResourceDetailShellTab<ConfigMap>[]>(
    () => [
      {
        value: 'data',
        label: (
          <>
            Data
            {totalCount > 0 ? (
              <Badge variant="secondary">{totalCount}</Badge>
            ) : null}
          </>
        ),
        content: data ? (
          <div className="space-y-4">
            {dataCount > 0 && (
              <KeyValueDataViewer
                entries={data.data!}
                emptyMessage="No data entries"
              />
            )}
            {binaryDataCount > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Binary Data
                </p>
                <KeyValueDataViewer
                  entries={Object.fromEntries(
                    Object.entries(data.binaryData || {}).map(
                      ([key, value]) => [key, atob(value)]
                    )
                  )}
                  emptyMessage="No binary data entries"
                />
              </div>
            )}
          </div>
        ) : null,
      },
    ],
    [binaryDataCount, data, dataCount, totalCount]
  )

  return (
    <ResourceDetailShell
      resourceType="configmaps"
      resourceLabel="ConfigMap"
      name={name}
      namespace={namespace}
      data={data}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={refetch}
      onSaveYaml={handleSaveYaml}
      overview={
        data ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>ConfigMap Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Created
                    </Label>
                    <p className="text-sm">
                      {formatDate(data.metadata!.creationTimestamp!, true)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Keys
                    </Label>
                    <p className="text-sm">{totalCount}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">UID</Label>
                    <p className="text-sm font-mono">{data.metadata!.uid}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Resource Version
                    </Label>
                    <p className="text-sm font-mono">
                      {data.metadata!.resourceVersion}
                    </p>
                  </div>
                  <OwnerInfoDisplay metadata={data.metadata} />
                </div>
                <LabelsAnno
                  labels={data.metadata!.labels || {}}
                  annotations={data.metadata!.annotations || {}}
                />
              </CardContent>
            </Card>
          </div>
        ) : null
      }
      preYamlTabs={tabs}
    />
  )
}
