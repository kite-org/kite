import {
  LogViewer as LogViewerContent,
  type LogViewerProps,
} from './log-viewer-content'

export function LogViewer(props: LogViewerProps) {
  return <LogViewerContent {...props} />
}
