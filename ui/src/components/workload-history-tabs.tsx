import { useTranslation } from 'react-i18next'

import { ResourceTypeMap, WorkloadRevisionResourceType } from '@/types/api'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { WorkloadRevisionsTable } from '@/components/workload-revisions-table'

export function WorkloadHistoryTabs<T extends WorkloadRevisionResourceType>({
  resourceType,
  namespace,
  name,
  resource,
  onRollbackComplete,
}: {
  resourceType: T
  namespace: string
  name: string
  resource: ResourceTypeMap[T]
  onRollbackComplete: () => Promise<unknown>
}) {
  const { t } = useTranslation()

  return (
    <Tabs defaultValue="revisions" className="gap-3">
      <TabsList className="gap-1">
        <TabsTrigger value="revisions">
          {t('workloads.tabs.rolloutRevisions')}
        </TabsTrigger>
        <TabsTrigger value="kiteAudit">
          {t('workloads.tabs.kiteAudit')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="revisions">
        <WorkloadRevisionsTable
          resourceType={resourceType}
          namespace={namespace}
          name={name}
          onRollbackComplete={onRollbackComplete}
        />
      </TabsContent>

      <TabsContent value="kiteAudit">
        <ResourceHistoryTable
          resourceType={resourceType}
          name={name}
          namespace={namespace}
          currentResource={resource}
        />
      </TabsContent>
    </Tabs>
  )
}
