import { useQuery } from '@tanstack/react-query'
import type { CustomResourceDefinitionList } from 'kubernetes-types/apiextensions/v1'
import type { ObjectMeta } from 'kubernetes-types/meta/v1'

import { fetchAPI } from '@/lib/api/shared'
import { withCurrentClusterPath } from '@/lib/current-cluster'
import { getCRDResourcePath, isStandardK8sResource } from '@/lib/k8s'
import {
  getResourceDetailPath,
  getResourceMetadata,
} from '@/lib/resource-catalog'

import { useCluster } from './use-cluster'

export function useOwnerInfo(metadata?: ObjectMeta) {
  const owner = metadata?.ownerReferences?.[0]
  const group = owner?.apiVersion.includes('/')
    ? owner.apiVersion.split('/')[0]
    : ''
  const standardType =
    owner && isStandardK8sResource(owner.kind)
      ? getResourceMetadata(owner.kind)?.type
      : undefined
  const { currentCluster } = useCluster()
  const { data: crds } = useQuery({
    queryKey: ['crds', 'owner-references', currentCluster],
    queryFn: () =>
      fetchAPI<CustomResourceDefinitionList>(
        withCurrentClusterPath('/crds', currentCluster)
      ),
    enabled: !!owner && !standardType && !!currentCluster,
    staleTime: 5000,
  })

  if (!owner) return null

  const crd = crds?.items.find(
    (item) => item.spec.group === group && item.spec.names.kind === owner.kind
  )
  const path = standardType
    ? getResourceDetailPath(standardType, owner.name, metadata?.namespace)
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
