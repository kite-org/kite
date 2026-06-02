import { ReactNode } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { Navigate, useLocation } from 'react-router-dom'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!user) {
    const href = location.pathname + location.search + location.hash
    return <Navigate to={`/login?href=${encodeURIComponent(href)}`} replace />
  }

  const pendingRedirect = sessionStorage.getItem('loginRedirectHref')
  if (pendingRedirect) {
    sessionStorage.removeItem('loginRedirectHref')
    return <Navigate to={pendingRedirect} replace />
  }

  return <>{children}</>
}
