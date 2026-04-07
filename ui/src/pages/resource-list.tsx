import { useParams } from 'react-router-dom'

import { ResourceType } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'

import { getResourceDefinition, getResourceLabel } from './resource-definitions'
import { SimpleListPage } from './simple-list-page'

export function ResourceList() {
  const { resource } = useParams()
  const resourceDefinition = resource
    ? getResourceDefinition(resource)
    : undefined

  usePageTitle(resource ? getResourceLabel(resource, true) : 'Resources')

  if (resourceDefinition?.listPage) {
    return resourceDefinition.listPage()
  }

  return <SimpleListPage resourceType={resource as ResourceType} />
}
