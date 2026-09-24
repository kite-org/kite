import { lazy, Suspense } from 'react'

import type { LogViewerProps } from '@/components/log-viewer-content'

const LogViewer = lazy(() =>
  import('@/components/log-viewer').then((module) => ({
    default: module.LogViewer,
  }))
)

export function PluginLogViewer(props: LogViewerProps) {
  return (
    <Suspense fallback={null}>
      <LogViewer {...props} />
    </Suspense>
  )
}
