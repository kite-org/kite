/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import type { AuthProviderCatalog, CredentialProvider } from '@/lib/api'
import {
  loginWithCredentials as authenticateWithCredentials,
  initiateOAuthLogin,
  logout as logoutUser,
  refreshAuthToken,
  useAuthProviders,
  useCurrentUser,
  type AuthUser,
  type CurrentUserResponse,
} from '@/lib/api'
import { withSubPath } from '@/lib/subpath'

interface User extends AuthUser {
  isAdmin(): boolean

  Key(): string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  hasGlobalSidebarPreference: boolean
  globalSidebarPreference: string
  credentialProviders: CredentialProvider[]
  oauthProviders: string[]
  login: (provider?: string) => Promise<void>
  loginWithCredentials: (
    provider: CredentialProvider,
    username: string,
    password: string
  ) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  refreshToken: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

function normalizeUser(user: AuthUser): User {
  return {
    ...user,
    isAdmin() {
      return (
        this.roles?.some((role: { name: string }) => role.name === 'admin') ||
        false
      )
    },
    Key() {
      return this.username || this.id
    },
  }
}

function applyAuthProviderCatalog(
  catalog: AuthProviderCatalog,
  setCredentialProviders: (providers: CredentialProvider[]) => void,
  setOAuthProviders: (providers: string[]) => void
) {
  setCredentialProviders(catalog.credentialProviders)
  setOAuthProviders(catalog.oauthProviders)
}

function applyCurrentUser(
  response: CurrentUserResponse | null,
  setUser: (user: User | null) => void,
  setGlobalSidebarPreference: (value: string) => void
) {
  if (!response) {
    setUser(null)
    setGlobalSidebarPreference('')
    return
  }

  setGlobalSidebarPreference(String(response.globalSidebarPreference || ''))
  setUser(normalizeUser(response.user))
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [globalSidebarPreference, setGlobalSidebarPreference] = useState('')
  const [credentialProviders, setCredentialProviders] = useState<
    CredentialProvider[]
  >([])
  const [oauthProviders, setOAuthProviders] = useState<string[]>([])

  const { refetch: refetchAuthProviders } = useAuthProviders({
    enabled: false,
  })
  const { refetch: refetchCurrentUser } = useCurrentUser({
    enabled: false,
  })

  const checkAuth = useCallback(async () => {
    const result = await refetchCurrentUser()
    applyCurrentUser(result.data ?? null, setUser, setGlobalSidebarPreference)
  }, [refetchCurrentUser])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setIsLoading(true)

      const [providersResult, userResult] = await Promise.all([
        refetchAuthProviders(),
        refetchCurrentUser(),
      ])

      if (cancelled) {
        return
      }

      if (providersResult.data) {
        applyAuthProviderCatalog(
          providersResult.data,
          setCredentialProviders,
          setOAuthProviders
        )
      }

      applyCurrentUser(
        userResult.data ?? null,
        setUser,
        setGlobalSidebarPreference
      )
      setIsLoading(false)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [refetchAuthProviders, refetchCurrentUser])

  const login = async (provider: string = 'github') => {
    const { auth_url } = await initiateOAuthLogin(provider)
    window.location.href = auth_url
  }

  const loginWithCredentials = async (
    provider: CredentialProvider,
    username: string,
    password: string
  ) => {
    await authenticateWithCredentials(provider, username, password)
    await checkAuth()
  }

  const refreshToken = useCallback(async () => {
    try {
      await refreshAuthToken()
    } catch (error) {
      console.error('Token refresh failed:', error)
      setUser(null)
      window.location.href = withSubPath('/login')
    }
  }, [])

  const logout = async () => {
    await logoutUser()
    setUser(null)
    window.location.href = withSubPath('/login')
  }

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

  const hasGlobalSidebarPreference = globalSidebarPreference.trim() !== ''

  const value = {
    user,
    isLoading,
    hasGlobalSidebarPreference,
    globalSidebarPreference,
    credentialProviders,
    oauthProviders,
    login,
    loginWithCredentials,
    logout,
    checkAuth,
    refreshToken,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
