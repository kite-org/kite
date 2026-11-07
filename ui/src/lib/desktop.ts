import type { PageContext } from '@/components/ai-chat/ai-chat-types'

import { getCurrentCluster } from './current-cluster'
import { DesktopService, type DesktopCommand } from './mygo'
import { withSubPath } from './subpath'

declare global {
  interface Window {
    __kiteDesktop?: boolean
    __kiteDesktopChild?: boolean
  }
}

export const isDesktop = window.__kiteDesktop === true
export const isDesktopChild = window.__kiteDesktopChild === true

export let pendingDesktopImport: DesktopCommand | undefined

export function setPendingDesktopImport(command: DesktopCommand | undefined) {
  pendingDesktopImport = command
}

export async function saveTextFile(
  title: string,
  filename: string,
  content: string
) {
  if (isDesktop) return DesktopService.saveText(title, filename, content)
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function openDesktopChat(pageContext: PageContext) {
  const params = new URLSearchParams({
    ...pageContext,
    cluster: getCurrentCluster() || '',
  })
  window.open(
    withSubPath(`/ai-chat-box?${params}`),
    '_blank',
    'noopener,noreferrer'
  )
}

export function openDesktopWorkspace(
  view: 'logs' | 'terminal',
  target: { namespace?: string; name?: string; container?: string } = {}
) {
  const params = new URLSearchParams({
    view,
    cluster: getCurrentCluster() || '',
  })
  for (const [key, value] of Object.entries(target)) {
    if (value) params.set(key, value)
  }
  window.open(
    withSubPath(`/desktop/workspace?${params}`),
    '_blank',
    'noopener,noreferrer'
  )
}
