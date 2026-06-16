import { authApiClient } from '../api-client'
import type {
  WebAuthnAssertionResponseJSON,
  WebAuthnCreationOptionsJSON,
  WebAuthnRegistrationResponseJSON,
  WebAuthnRequestOptionsJSON,
} from '../webauthn'

export type CredentialProvider = 'password' | 'ldap'

export interface AuthUser {
  id: string
  username: string
  name: string
  avatar_url: string
  provider: string
  mfa_enabled?: boolean
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
  password: string,
  mfaCode?: string
): Promise<void> => {
  await authApiClient.post<void>(
    `/auth/login/${provider}`,
    {
      username,
      password,
      ...(mfaCode ? { mfa_code: mfaCode } : {}),
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

export const updateCurrentUser = async (data: {
  name: string
}): Promise<AuthUser> => {
  return authApiClient.put<AuthUser>('/users/me', data)
}

export const changeCurrentUserPassword = async (
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  await authApiClient.post<void>('/users/me/password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
}

export interface MFASetupResponse {
  secret: string
  otpauth_url: string
  qr_code: string
}

export interface PasskeyCredential {
  id: number
  name: string
  credential_id: string
  createdAt: string
  last_used_at?: string
}

export const setupCurrentUserMFA = async (
  currentPassword: string
): Promise<MFASetupResponse> => {
  return authApiClient.post<MFASetupResponse>('/users/me/mfa/setup', {
    current_password: currentPassword,
  })
}

export const enableCurrentUserMFA = async (code: string): Promise<AuthUser> => {
  return authApiClient.post<AuthUser>('/users/me/mfa/enable', { code })
}

export const disableCurrentUserMFA = async (
  code: string
): Promise<AuthUser> => {
  return authApiClient.post<AuthUser>('/users/me/mfa/disable', { code })
}

export const listCurrentUserPasskeys = async (): Promise<
  PasskeyCredential[]
> => {
  const result = await authApiClient.get<{ passkeys: PasskeyCredential[] }>(
    '/users/me/passkeys'
  )
  return result.passkeys
}

export const beginCurrentUserPasskeyRegistration = async (
  name: string,
  currentPassword: string,
  mfaCode?: string
): Promise<WebAuthnCreationOptionsJSON> => {
  return authApiClient.post<WebAuthnCreationOptionsJSON>(
    '/users/me/passkeys/begin',
    {
      name,
      current_password: currentPassword,
      ...(mfaCode ? { mfa_code: mfaCode } : {}),
    }
  )
}

export const finishCurrentUserPasskeyRegistration = async (
  credential: WebAuthnRegistrationResponseJSON
): Promise<PasskeyCredential> => {
  return authApiClient.post<PasskeyCredential>(
    '/users/me/passkeys/finish',
    credential
  )
}

export const deleteCurrentUserPasskey = async (id: number): Promise<void> => {
  await authApiClient.delete<void>(`/users/me/passkeys/${id}`)
}

export const beginPasskeyLogin =
  async (): Promise<WebAuthnRequestOptionsJSON> => {
    return authApiClient.post<WebAuthnRequestOptionsJSON>(
      '/auth/passkey/login/begin',
      undefined,
      { retryOnUnauthorized: false }
    )
  }

export const finishPasskeyLogin = async (
  credential: WebAuthnAssertionResponseJSON
): Promise<void> => {
  await authApiClient.post<void>('/auth/passkey/login/finish', credential, {
    retryOnUnauthorized: false,
  })
}
