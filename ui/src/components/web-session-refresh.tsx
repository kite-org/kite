import { useEffect } from 'react'
import { useAuth } from '@/contexts/auth-context'

export function WebSessionRefresh() {
  const { user, refreshToken } = useAuth()

  useEffect(() => {
    if (!user) return
    const refreshKey = 'lastRefreshTokenAt'
    const lastRefreshAt = localStorage.getItem(refreshKey)
    const now = Date.now()

    if (!lastRefreshAt || now - Number(lastRefreshAt) > 30 * 60 * 1000) {
      refreshToken()
      localStorage.setItem(refreshKey, String(now))
    }

    const refreshInterval = setInterval(
      () => {
        refreshToken()
        localStorage.setItem(refreshKey, String(Date.now()))
      },
      30 * 60 * 1000
    )

    return () => clearInterval(refreshInterval)
  }, [user, refreshToken])

  return null
}
