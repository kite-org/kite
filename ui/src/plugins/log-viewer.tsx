import { lazy, Suspense } from 'react'

import type { LogViewerProps } from '@/components/log-viewer-content'
import type { LogViewerPanelProps } from '@/components/log-viewer-panel'

const LogViewer = lazy(() =>
  import('@/components/log-viewer').then((module) => ({
    default: module.LogViewer,
  }))
)

const LogViewerPanel = lazy(() =>
  import('@/components/log-viewer-panel').then((module) => ({
    default: module.LogViewerPanel,
  }))
)

export function PluginLogViewer(props: LogViewerProps) {
  return (
    <Suspense fallback={null}>
      <LogViewer {...props} />
    </Suspense>
  )
}

export function PluginLogViewerPanel(props: LogViewerPanelProps) {
  return (
    <Suspense fallback={null}>
      <LogViewerPanel {...props} />
    </Suspense>
  )
}
