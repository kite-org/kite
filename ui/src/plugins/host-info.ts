import { useMemo } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { version as sdkVersion } from '@kite-dev/plugin-sdk/package.json'

export function useHostInfo() {
  const { kiteVersion } = useAuth()
  // Plugins render only after bootstrap has provided the authenticated user.
  return useMemo(
    () => ({ kiteVersion: kiteVersion!, sdkVersion }),
    [kiteVersion]
  )
}
