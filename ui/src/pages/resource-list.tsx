import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { ResourceType } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'

import { getResourceDefinition, getResourceLabel } from './resource-definitions'
import { SimpleListPage } from './simple-list-page'

export function ResourceList() {
  const { resource } = useParams()
  const { t } = useTranslation()
  const resourceDefinition = resource
    ? getResourceDefinition(resource)
    : undefined
  const resourceName = resource
    ? resourceDefinition?.titleKey
      ? t(resourceDefinition.titleKey, {
          defaultValue: getResourceLabel(resource, true),
        })
      : getResourceLabel(resource, true)
    : 'Resources'

  usePageTitle(resourceName)

  if (resourceDefinition?.listPage) {
    return resourceDefinition.listPage()
  }

  return <SimpleListPage resourceType={resource as ResourceType} />
}
