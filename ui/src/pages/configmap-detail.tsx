import { useMemo } from 'react'
import { ConfigMap } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { updateResource, useResource } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { KeyValueDataViewer } from '@/components/key-value-data-viewer'
import { ResourceOverview } from '@/components/resource-overview'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function ConfigMapDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const { t } = useTranslation()

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
          <ResourceOverview
            resourceType="configmaps"
            name={name}
            namespace={namespace}
            metadata={data.metadata}
            fields={[
              {
                label: t('resourceDetail.keys'),
                value: totalCount,
              },
              {
                label: t('resourceDetail.data'),
                value: dataCount,
              },
              {
                label: t('resourceDetail.binaryData'),
                value: binaryDataCount,
              },
              {
                label: t('resourceDetail.resourceVersion'),
                value: data.metadata?.resourceVersion || '-',
                mono: true,
              },
            ]}
          />
        ) : null
      }
      preYamlTabs={tabs}
    />
  )
}
