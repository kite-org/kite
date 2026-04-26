import { useEffect, useMemo, useState } from 'react'
import * as yaml from 'js-yaml'
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

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

function getDecodedYamlContent(secret: Secret, showDecodedYaml: boolean) {
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

  return yaml.dump(showSecret, { indent: 2 })
}

function SecretYamlToolbar({
  setYamlContent,
  secret,
  showDecodedYaml,
  onToggle,
}: {
  setYamlContent: (value: string) => void
  secret: Secret
  showDecodedYaml: boolean
  onToggle: (next: boolean) => void
}) {
  useEffect(() => {
    setYamlContent(getDecodedYamlContent(secret, showDecodedYaml))
  }, [secret, setYamlContent, showDecodedYaml])

  if (!secret.data || Object.keys(secret.data).length === 0) {
    return null
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onToggle(!showDecodedYaml)}
    >
      {showDecodedYaml ? 'Show Base64' : 'Decode Values'}
    </Button>
  )
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

  const tabs = useMemo<ResourceDetailShellTab<Secret>[]>(
    () => [
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
    ],
    [data, dataCount, name, namespace]
  )

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
      onSaveYaml={handleSaveYaml}
      yamlToolbar={(context) => (
        <SecretYamlToolbar
          setYamlContent={context.setYamlContent}
          secret={data as Secret}
          showDecodedYaml={showDecodedYaml}
          onToggle={setShowDecodedYaml}
        />
      )}
      overview={
        data ? (
          <ResourceOverview
            resourceType="secrets"
            name={name}
            namespace={namespace}
            metadata={data.metadata}
            fields={[
              {
                label: t('resourceDetail.type'),
                value: <Badge variant="outline">{data.type || 'Opaque'}</Badge>,
              },
              {
                label: t('resourceDetail.keys'),
                value: dataCount,
              },
              {
                label: t('resourceDetail.size'),
                value: `${dataSize} ${t('resourceDetail.bytes')}`,
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
      preYamlTabs={tabs.slice(0, 1)}
      extraTabs={tabs.slice(1)}
    />
  )
}
