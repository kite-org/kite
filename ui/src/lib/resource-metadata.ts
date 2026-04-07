import { resourceCatalog } from './resource-catalog'

interface ResourceMetadataBase {
  singular: string
  singularLabel: string
  pluralLabel: string
  shortLabel?: string
  clusterScope: boolean
}

export type ResourceType = (typeof resourceCatalog)[number]['type']

export type ResourceMetadata = ResourceMetadataBase & {
  type: ResourceType
}

export const resourceMetadataList: readonly ResourceMetadata[] =
  resourceCatalog.map((item) => ({
    type: item.type,
    singular: item.singular,
    singularLabel: item.singularLabel,
    pluralLabel: item.pluralLabel,
    shortLabel: 'shortLabel' in item ? item.shortLabel : undefined,
    clusterScope: item.clusterScope,
  }))

const resourceMetadataMap = new Map(
  resourceMetadataList.map((item) => [item.type, item] as const)
)

export const clusterScopedResourceTypes = resourceMetadataList
  .filter((item) => item.clusterScope)
  .map((item) => item.type) as ResourceType[]

function fallbackMetadata(resource: string): ResourceMetadata {
  const singular = resource.endsWith('s') ? resource.slice(0, -1) : resource
  const label = singular.charAt(0).toUpperCase() + singular.slice(1)
  return {
    type: resource as ResourceType,
    singular,
    singularLabel: label,
    pluralLabel: resource.charAt(0).toUpperCase() + resource.slice(1),
    clusterScope: false,
  }
}

export function getResourceMetadata(
  resource?: string | null
): ResourceMetadata | undefined {
  if (!resource) {
    return undefined
  }
  return (
    resourceMetadataMap.get(resource as ResourceType) ??
    fallbackMetadata(resource)
  )
}

export function getResourceSingular(resource?: string | null) {
  return getResourceMetadata(resource)?.singular || ''
}

export function getResourceSingularLabel(resource?: string | null) {
  return getResourceMetadata(resource)?.singularLabel || ''
}

export function getResourcePluralLabel(resource?: string | null) {
  return getResourceMetadata(resource)?.pluralLabel || ''
}

export function getResourceShortLabel(resource?: string | null) {
  const metadata = getResourceMetadata(resource)
  return metadata?.shortLabel || metadata?.singularLabel || ''
}

export function isClusterScopedResource(resource?: string | null) {
  return getResourceMetadata(resource)?.clusterScope ?? false
}

export function getResourceListPath(resource: string) {
  return `/${resource}`
}

export function getResourceDetailPath(
  resource: string,
  name: string,
  namespace?: string
) {
  return isClusterScopedResource(resource) || !namespace
    ? `/${resource}/${name}`
    : `/${resource}/${namespace}/${name}`
}

export function getResourceQueryKey(
  resource: string,
  namespace?: string,
  name?: string
) {
  return [resource, namespace || '_all', name || '_all']
}
