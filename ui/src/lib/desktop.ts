import type { PageContext } from '@/components/ai-chat/ai-chat-types'

import { getCurrentCluster } from './current-cluster'
import { withSubPath } from './subpath'

declare global {
  interface Window {
    __kiteDesktop?: boolean
  }
}

export const isDesktop = window.__kiteDesktop === true

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
  view: 'logs' | 'terminal' | 'kubectl',
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
