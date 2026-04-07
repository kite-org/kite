import { useEffect, useMemo, useState } from 'react'
import * as yaml from 'js-yaml'
import { Secret } from 'kubernetes-types/core/v1'
import { toast } from 'sonner'

import { updateResource, useResource } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { EventTable } from '@/components/event-table'
import { KeyValueDataViewer } from '@/components/key-value-data-viewer'
import { LabelsAnno } from '@/components/lables-anno'
import { OwnerInfoDisplay } from '@/components/owner-info-display'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'

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
  const [showDecodedYaml, setShowDecodedYaml] = useState(false)

  const { data, isLoading, isError, error, refetch } = useResource(
    'secrets',
    name,
    namespace
  )

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
            {data && (
              <Badge variant="secondary">
                {Object.keys(data.data || {}).length}
              </Badge>
            )}
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
    [data, name, namespace]
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
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Secret Information</CardTitle>
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
                      Type
                    </Label>
                    <p className="text-sm">
                      <Badge variant="outline">{data.type || 'Opaque'}</Badge>
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Keys
                    </Label>
                    <p className="text-sm">
                      {Object.keys(data.data || {}).length}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Size
                    </Label>
                    <p className="text-sm">
                      {Object.values(data.data || {}).reduce(
                        (total, value) => total + value.length,
                        0
                      )}{' '}
                      bytes
                    </p>
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
      preYamlTabs={tabs.slice(0, 1)}
      extraTabs={tabs.slice(1)}
    />
  )
}
