import { useQuery } from '@tanstack/react-query'

import { authApiClient } from '../api-client'
import type { AuthProviderCatalog, CredentialProvider } from './admin'

export interface AuthUser {
  id: string
  username: string
  name: string
  avatar_url: string
  provider: string
  roles?: { name: string }[]
  sidebar_preference?: string
}

export interface CurrentUserResponse {
  user: AuthUser
  hasGlobalSidebarPreference: boolean
  globalSidebarPreference: string
}

export interface OAuthLoginResponse {
  auth_url: string
  provider: string
}

function normalizeAuthProviderCatalog(
  data: Partial<AuthProviderCatalog>
): AuthProviderCatalog {
  if (data.credentialProviders || data.oauthProviders) {
    return {
      providers: data.providers || [],
      credentialProviders: data.credentialProviders || [],
      oauthProviders: data.oauthProviders || [],
    }
  }

  const providers = data.providers || []
  const credentialProviders = providers.filter(
    (provider): provider is CredentialProvider =>
      provider === 'password' || provider === 'ldap'
  )
  const oauthProviders = providers.filter(
    (provider) => provider !== 'password' && provider !== 'ldap'
  )

  return {
    providers,
    credentialProviders,
    oauthProviders,
  }
}

export const fetchAuthProviders = async (): Promise<AuthProviderCatalog> => {
  const data = await authApiClient.get<Partial<AuthProviderCatalog>>(
    '/auth/providers',
    { retryOnUnauthorized: false }
  )
  return normalizeAuthProviderCatalog(data)
}

export const useAuthProviders = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: fetchAuthProviders,
    enabled: options?.enabled ?? false,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const fetchCurrentUser = async (): Promise<CurrentUserResponse> => {
  return authApiClient.get<CurrentUserResponse>('/auth/user', {
    retryOnUnauthorized: false,
  })
}

export const useCurrentUser = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['auth', 'current-user'],
    queryFn: fetchCurrentUser,
    enabled: options?.enabled ?? false,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const initiateOAuthLogin = async (
  provider: string
): Promise<OAuthLoginResponse> => {
  return authApiClient.get<OAuthLoginResponse>(
    `/auth/login?provider=${encodeURIComponent(provider)}`,
    {
      retryOnUnauthorized: false,
    }
  )
}

export const loginWithCredentials = async (
  provider: CredentialProvider,
  username: string,
  password: string
): Promise<void> => {
  await authApiClient.post<void>(
    `/auth/login/${provider}`,
    {
      username,
      password,
    },
    { retryOnUnauthorized: false }
  )
}

export const refreshAuthToken = async (): Promise<void> => {
  await authApiClient.post<void>('/auth/refresh', undefined, {
    retryOnUnauthorized: false,
  })
}

export const logout = async (): Promise<void> => {
  await authApiClient.post<void>('/auth/logout', undefined, {
    retryOnUnauthorized: false,
  })
}
