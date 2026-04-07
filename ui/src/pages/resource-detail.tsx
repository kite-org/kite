import { useParams } from 'react-router-dom'

import { ResourceType } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'
import { Card, CardContent } from '@/components/ui/card'

import { getResourceDefinition, getResourceLabel } from './resource-definitions'
import { SimpleResourceDetail } from './simple-resource-detail'

export function ResourceDetail() {
  const { resource, namespace, name } = useParams()
  const resourceDefinition = resource
    ? getResourceDefinition(resource)
    : undefined

  usePageTitle(
    resource && name ? `${name} (${getResourceLabel(resource)})` : 'Resource'
  )

  if (!resource || !name) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              Invalid parameters. name are required.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (resourceDefinition?.detailPage) {
    return resourceDefinition.detailPage({ name, namespace })
  }

  return (
    <SimpleResourceDetail
      resourceType={resource as ResourceType}
      namespace={namespace}
      name={name}
    />
  )
}
