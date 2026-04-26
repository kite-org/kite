import type { Job } from 'kubernetes-types/batch/v1'
import type { useTranslation } from 'react-i18next'

type TranslationFn = ReturnType<typeof useTranslation>['t']

export interface JobStatusBadge {
  key: 'failed' | 'complete' | 'running' | 'pending'
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

export function getJobStatusBadge(job: Job): JobStatusBadge {
  const conditions = job.status?.conditions || []
  const completed = conditions.find(
    (condition) => condition.type === 'Complete'
  )
  const failed = conditions.find((condition) => condition.type === 'Failed')

  if (failed?.status === 'True') {
    return { key: 'failed', label: 'Failed', variant: 'destructive' }
  }

  if (completed?.status === 'True') {
    return { key: 'complete', label: 'Complete', variant: 'default' }
  }

  if ((job.status?.active || 0) > 0) {
    return { key: 'running', label: 'Running', variant: 'secondary' }
  }

  return { key: 'pending', label: 'Pending', variant: 'outline' }
}

export function formatJobStatusBadge(
  badge: JobStatusBadge,
  t: TranslationFn,
  namespace = 'jobs.statuses'
) {
  return t(`${namespace}.${badge.key}`, {
    defaultValue: badge.label,
  })
}
