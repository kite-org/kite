/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react'

import type { BootstrapCapabilities, CredentialProvider } from '@/lib/api'
import {
  loginWithCredentials as authenticateWithCredentials,
  initiateOAuthLogin,
  logout as logoutUser,
  refreshAuthToken,
  useBootstrap,
  type AuthUser,
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
  loginPrompt: string
  capabilities: BootstrapCapabilities
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

const defaultCapabilities: BootstrapCapabilities = {
  aiEnabled: false,
  kubectlEnabled: true,
}

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

export function AuthProvider({ children }: AuthProviderProps) {
  const {
    data: bootstrap,
    isLoading,
    refetch: refetchBootstrap,
  } = useBootstrap()

  const checkAuth = useCallback(async () => {
    await refetchBootstrap()
  }, [refetchBootstrap])

  const login = useCallback(async (provider: string = 'github') => {
    const { auth_url } = await initiateOAuthLogin(provider)
    window.location.href = auth_url
  }, [])

  const loginWithCredentials = useCallback(
    async (
      provider: CredentialProvider,
      username: string,
      password: string
    ) => {
      await authenticateWithCredentials(provider, username, password)
      await checkAuth()
    },
    [checkAuth]
  )

  const logout = useCallback(async () => {
    await logoutUser()
    await refetchBootstrap()
    window.location.href = withSubPath('/login')
  }, [refetchBootstrap])

  const refreshToken = useCallback(async () => {
    try {
      await refreshAuthToken()
    } catch (error) {
      console.error('Token refresh failed:', error)
      await refetchBootstrap()
      window.location.href = withSubPath('/login')
    }
  }, [refetchBootstrap])

  const user = useMemo(
    () => (bootstrap?.user ? normalizeUser(bootstrap.user) : null),
    [bootstrap?.user]
  )

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

  const globalSidebarPreference = String(
    bootstrap?.globalSidebarPreference || ''
  )
  const hasGlobalSidebarPreference =
    bootstrap?.hasGlobalSidebarPreference ??
    globalSidebarPreference.trim() !== ''
  const credentialProviders = bootstrap?.auth.credentialProviders ?? []
  const oauthProviders = bootstrap?.auth.oauthProviders ?? []
  const loginPrompt = bootstrap?.auth.loginPrompt || ''
  const capabilities = bootstrap?.capabilities ?? defaultCapabilities

  const value = useMemo(
    () => ({
      user,
      isLoading,
      hasGlobalSidebarPreference,
      globalSidebarPreference,
      credentialProviders,
      oauthProviders,
      loginPrompt,
      capabilities,
      login,
      loginWithCredentials,
      logout,
      checkAuth,
      refreshToken,
    }),
    [
      user,
      isLoading,
      hasGlobalSidebarPreference,
      globalSidebarPreference,
      credentialProviders,
      oauthProviders,
      loginPrompt,
      capabilities,
      login,
      loginWithCredentials,
      logout,
      checkAuth,
      refreshToken,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
