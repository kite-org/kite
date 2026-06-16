export interface WebAuthnCredentialDescriptorJSON extends Omit<
  PublicKeyCredentialDescriptor,
  'id'
> {
  id: string
}

export interface WebAuthnCreationOptionsJSON {
  publicKey: Omit<
    PublicKeyCredentialCreationOptions,
    'challenge' | 'user' | 'excludeCredentials'
  > & {
    challenge: string
    user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string }
    excludeCredentials?: WebAuthnCredentialDescriptorJSON[]
  }
}

export interface WebAuthnRequestOptionsJSON {
  publicKey: Omit<
    PublicKeyCredentialRequestOptions,
    'challenge' | 'allowCredentials'
  > & {
    challenge: string
    allowCredentials?: WebAuthnCredentialDescriptorJSON[]
  }
}

export interface WebAuthnRegistrationResponseJSON {
  id: string
  rawId: string
  type: PublicKeyCredentialType
  response: {
    clientDataJSON: string
    attestationObject: string
    transports?: AuthenticatorTransport[]
  }
  clientExtensionResults: AuthenticationExtensionsClientOutputs
  authenticatorAttachment?: string
}

export interface WebAuthnAssertionResponseJSON {
  id: string
  rawId: string
  type: PublicKeyCredentialType
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle?: string
  }
  clientExtensionResults: AuthenticationExtensionsClientOutputs
  authenticatorAttachment?: string
}

export async function createPasskeyCredential(
  options: WebAuthnCreationOptionsJSON
): Promise<WebAuthnRegistrationResponseJSON> {
  ensureWebAuthnSupport()
  const credential = await navigator.credentials.create({
    publicKey: decodeCreationOptions(options.publicKey),
  })
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Passkey registration was cancelled')
  }

  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: bufferToBase64URL(credential.rawId),
    type: credential.type as PublicKeyCredentialType,
    response: {
      clientDataJSON: bufferToBase64URL(response.clientDataJSON),
      attestationObject: bufferToBase64URL(response.attestationObject),
      transports:
        typeof response.getTransports === 'function'
          ? (response.getTransports() as AuthenticatorTransport[])
          : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: getAuthenticatorAttachment(credential),
  }
}

export async function getPasskeyCredential(
  options: WebAuthnRequestOptionsJSON
): Promise<WebAuthnAssertionResponseJSON> {
  ensureWebAuthnSupport()
  const credential = await navigator.credentials.get({
    publicKey: decodeRequestOptions(options.publicKey),
  })
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Passkey sign-in was cancelled')
  }

  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: bufferToBase64URL(credential.rawId),
    type: credential.type as PublicKeyCredentialType,
    response: {
      clientDataJSON: bufferToBase64URL(response.clientDataJSON),
      authenticatorData: bufferToBase64URL(response.authenticatorData),
      signature: bufferToBase64URL(response.signature),
      userHandle: response.userHandle
        ? bufferToBase64URL(response.userHandle)
        : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: getAuthenticatorAttachment(credential),
  }
}

function decodeCreationOptions(
  options: WebAuthnCreationOptionsJSON['publicKey']
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64URLToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64URLToBuffer(options.user.id),
    },
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      ...credential,
      id: base64URLToBuffer(credential.id),
    })),
  }
}

function decodeRequestOptions(
  options: WebAuthnRequestOptionsJSON['publicKey']
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64URLToBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: base64URLToBuffer(credential.id),
    })),
  }
}

function ensureWebAuthnSupport() {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('Passkeys are not available in this browser')
  }
}

function base64URLToBuffer(value: string): ArrayBuffer {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '='
  )
  const base64 = padded.replaceAll('-', '+').replaceAll('_', '/')
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window
    .btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function getAuthenticatorAttachment(credential: PublicKeyCredential) {
  return (
    credential as PublicKeyCredential & { authenticatorAttachment?: string }
  ).authenticatorAttachment
}
