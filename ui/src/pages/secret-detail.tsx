import { useState } from 'react'
import { Secret } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { updateResource, useResource } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EventTable } from '@/components/event-table'
import { KeyValueDataViewer } from '@/components/key-value-data-viewer'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { ResourceOverview } from '@/components/resource-overview'
import { ResourceYaml } from '@/components/resource-yaml'

import { ResourceDetailShell } from './resource-detail-shell'

function getSecretYamlValue(secret: Secret, showDecodedYaml: boolean) {
  const showSecret = { ...secret } as Secret
  if (showDecodedYaml) {
    if (showSecret.data) {
      const decodedData: Record<string, string> = {}
      Object.entries(showSecret.data).forEach(([key, value]) => {
        decodedData[key] = atob(value)
      })
      showSecret.stringData = decodedData
      showSecret.data = undefined
    }
  } else if (showSecret.stringData) {
    const data: Record<string, string> = {}
    Object.entries(showSecret.stringData).forEach(([key, value]) => {
      data[key] = btoa(value)
    })
    showSecret.data = data
    showSecret.stringData = undefined
  }

  return showSecret
}

export function SecretDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const { t } = useTranslation()
  const [showDecodedYaml, setShowDecodedYaml] = useState(false)

  const { data, isLoading, isError, error, refetch } = useResource(
    'secrets',
    name,
    namespace
  )
  const dataCount = data ? Object.keys(data.data || {}).length : 0
  const dataSize = data
    ? Object.values(data.data || {}).reduce(
        (total, value) => total + value.length,
        0
      )
    : 0

  const handleSaveYaml = async (content: Secret) => {
    await updateResource('secrets', name, namespace, content)
    toast.success('YAML saved successfully')
    await refetch()
  }

  return (
    <ResourceDetailShell
      resourceType="secrets"
      resourceLabel="Secret"
      name={name}
      namespace={namespace}
      data={data}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={refetch}
      tabs={[
        {
          value: 'overview',
          label: t('common.tabs.overview'),
          content: data ? (
            <ResourceOverview
              resourceType="secrets"
              name={name}
              namespace={namespace}
              metadata={data.metadata}
              fields={[
                {
                  label: t('common.fields.type'),
                  value: (
                    <Badge variant="outline">{data.type || 'Opaque'}</Badge>
                  ),
                },
                {
                  label: t('common.fields.keys'),
                  value: dataCount,
                },
                {
                  label: t('common.fields.size'),
                  value: `${dataSize} ${t('common.fields.bytes')}`,
                },
                {
                  label: t('common.fields.resourceVersion'),
                  value: data.metadata?.resourceVersion || '-',
                  mono: true,
                },
              ]}
            />
          ) : null,
        },
        {
          value: 'data',
          label: (
            <>
              Data
              {data && <Badge variant="secondary">{dataCount}</Badge>}
            </>
          ),
          content: data ? (
            <KeyValueDataViewer
              entries={data.data || {}}
              sensitive
              base64Encoded
              emptyMessage="No data entries"
            />
          ) : null,
        },
        {
          value: 'yaml',
          label: t('common.tabs.yaml'),
          content: ({ resource, refreshKey }) => (
            <ResourceYaml
              key={refreshKey}
              value={getSecretYamlValue(resource, showDecodedYaml)}
              onSave={handleSaveYaml}
              actions={
                resource.data && Object.keys(resource.data).length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDecodedYaml(!showDecodedYaml)}
                  >
                    {showDecodedYaml
                      ? t('secret.showBase64')
                      : t('secret.decodeValues')}
                  </Button>
                ) : null
              }
              fillHeight
            />
          ),
        },
        {
          value: 'related',
          label: 'Related',
          content: (
            <RelatedResourcesTable
              resource="secrets"
              name={name}
              namespace={namespace}
            />
          ),
        },
        {
          value: 'events',
          label: 'Events',
          content: (
            <EventTable resource="secrets" name={name} namespace={namespace} />
          ),
        },
        {
          value: 'history',
          label: 'History',
          content: data ? (
            <ResourceHistoryTable
              resourceType="secrets"
              name={name}
              namespace={namespace}
              currentResource={data}
            />
          ) : null,
        },
      ]}
    />
  )
}
