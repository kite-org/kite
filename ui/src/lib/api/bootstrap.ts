import { useQuery } from '@tanstack/react-query'

import type { AuthUser, CredentialProvider } from './auth'
import { fetchAPI } from './shared'

export interface BootstrapSetup {
  initialized: boolean
  step: number
}

export interface BootstrapCapabilities {
  aiEnabled: boolean
  kubectlEnabled: boolean
}

export interface AuthProviderCatalog {
  providers: string[]
  credentialProviders: CredentialProvider[]
  oauthProviders: string[]
  loginPrompt: string
  mfaEnabled: boolean
  passkeyLoginEnabled: boolean
}

export interface BootstrapResponse {
  setup: BootstrapSetup
  auth: AuthProviderCatalog
  capabilities: BootstrapCapabilities
  user: AuthUser | null
  hasGlobalSidebarPreference: boolean
  globalSidebarPreference: string
}

export const fetchBootstrap = (): Promise<BootstrapResponse> => {
  return fetchAPI<BootstrapResponse>('/bootstrap')
}

export const useBootstrap = (options?: {
  enabled?: boolean
  staleTime?: number
}) => {
  return useQuery({
    queryKey: ['bootstrap'],
    queryFn: fetchBootstrap,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
