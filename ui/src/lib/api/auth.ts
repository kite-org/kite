import { authApiClient } from '../api-client'

export type CredentialProvider = 'password' | 'ldap'

export interface AuthUser {
  id: string
  username: string
  name: string
  avatar_url: string
  provider: string
  roles?: { name: string }[]
  sidebar_preference?: string
}

export interface OAuthLoginResponse {
  auth_url: string
  provider: string
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
