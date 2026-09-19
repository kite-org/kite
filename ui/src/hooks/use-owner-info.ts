import { useQuery } from '@tanstack/react-query'
import type { CustomResourceDefinitionList } from 'kubernetes-types/apiextensions/v1'
import type { ObjectMeta } from 'kubernetes-types/meta/v1'

import { fetchAPI } from '@/lib/api/shared'
import { withCurrentClusterPath } from '@/lib/current-cluster'
import { getCRDResourcePath } from '@/lib/k8s'
import { getResourceDetailPath, resourceCatalog } from '@/lib/resource-catalog'

import { useCluster } from './use-cluster'

export function useOwnerInfo(metadata?: ObjectMeta) {
  const owner = metadata?.ownerReferences?.[0]
  const group = owner?.apiVersion.includes('/')
    ? owner.apiVersion.split('/')[0]
    : ''
  const resource = resourceCatalog.find(
    (entry) =>
      'apiGroup' in entry &&
      entry.apiGroup === group &&
      entry.singular === owner?.kind.toLowerCase()
  )
  const { currentCluster } = useCluster()
  const { data: crds } = useQuery({
    queryKey: ['crds', 'owner-references', currentCluster],
    queryFn: () =>
      fetchAPI<CustomResourceDefinitionList>(
        withCurrentClusterPath('/crds', currentCluster)
      ),
    enabled: !!owner && !resource && !!currentCluster,
    staleTime: 5000,
  })

  if (!owner) return null

  const crd = crds?.items.find(
    (item) => item.spec.group === group && item.spec.names.kind === owner.kind
  )
  const path = resource
    ? getResourceDetailPath(resource.type, owner.name, metadata?.namespace)
    : crd
      ? getCRDResourcePath(
          crd.spec.names.plural,
          owner.apiVersion,
          crd.spec.scope === 'Namespaced' ? metadata?.namespace : undefined,
          owner.name
        )
      : undefined

  return {
    kind: owner.kind,
    name: owner.name,
    path,
    controller: owner.controller || false,
  }
}
