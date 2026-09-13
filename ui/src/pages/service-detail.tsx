import { useMemo } from 'react'
import { Service } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  updateResource,
  useResource,
  useResources,
  useResourcesEvents,
  useResourcesWatch,
} from '@/lib/api'
import { EventTable } from '@/components/event-table'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { ServiceOverview } from '@/components/service-overview'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function ServiceDetail(props: { name: string; namespace?: string }) {
  const { namespace, name } = props
  const { t } = useTranslation()

  const { data, isLoading, isError, error, refetch } = useResource(
    'services',
    name,
    namespace
  )
  const labelSelector = data?.spec?.selector
    ? Object.entries(data.spec.selector)
        .map(([key, value]) => `${key}=${value}`)
        .join(',')
    : undefined
  const {
    data: relatedPods,
    isLoading: isLoadingPods,
    refetch: refetchPods,
  } = useResourcesWatch('pods', namespace, {
    labelSelector,
    enabled: !!namespace && !!labelSelector,
  })
  const {
    data: endpoints,
    isLoading: isEndpointsLoading,
    refetch: refetchEndpoints,
  } = useResource('endpoints', name, namespace)
  const serviceEndpoints = useMemo(
    () => (endpoints ? [endpoints] : []),
    [endpoints]
  )
  const endpointSlicesQuery = useResources('endpointslices', namespace, {
    labelSelector: `kubernetes.io/service-name=${name}`,
  })
  const { data: serviceEvents, isLoading: isEventsLoading } =
    useResourcesEvents('services', name, namespace)

  const handleRefresh = async () => {
    await Promise.all([
      refetch(),
      refetchPods(),
      refetchEndpoints(),
      endpointSlicesQuery.refetch(),
    ])
  }

  const handleSaveYaml = async (content: Service) => {
    await updateResource('services', name, namespace, content)
    toast.success(t('common.messages.yamlSaved'))
    await handleRefresh()
  }

  const tabs = useMemo<ResourceDetailShellTab<Service>[]>(
    () => [
      {
        value: 'related',
        label: t('common.tabs.related'),
        content: (
          <RelatedResourcesTable
            resource="services"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'events',
        label: t('common.tabs.events'),
        content: (
          <EventTable resource="services" name={name} namespace={namespace} />
        ),
      },
      {
        value: 'history',
        label: t('common.tabs.history'),
        content: data ? (
          <ResourceHistoryTable
            resourceType="services"
            name={name}
            namespace={namespace}
            currentResource={data}
          />
        ) : null,
      },
    ],
    [data, name, namespace, t]
  )

  return (
    <ResourceDetailShell
      resourceType="services"
      resourceLabel="Service"
      name={name}
      namespace={namespace}
      data={data}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={handleRefresh}
      onSaveYaml={handleSaveYaml}
      overview={
        data ? (
          <ServiceOverview
            service={data}
            namespace={namespace}
            name={name}
            pods={relatedPods}
            isPodsLoading={isLoadingPods}
            endpoints={serviceEndpoints}
            isEndpointsLoading={isEndpointsLoading}
            endpointSlices={endpointSlicesQuery.data}
            isEndpointSlicesLoading={endpointSlicesQuery.isLoading}
            events={serviceEvents}
            isEventsLoading={isEventsLoading}
          />
        ) : null
      }
      extraTabs={tabs}
    />
  )
}
