import { normalizeBasePath } from './base-path'

declare global {
  interface Window {
    __dynamic_base__?: string
  }
}

export function getSubPath(): string {
  if (import.meta.env.DEV) {
    return normalizeBasePath(import.meta.env.KITE_BASE)
  }
  return normalizeBasePath(window.__dynamic_base__)
}

export function withSubPath(path: string): string {
  const subPath = getSubPath()
  if (!subPath) return path

  if (path.startsWith('/')) {
    return `${subPath}${path}`
  }
  return `${subPath}/${path}`
}

export function getWebSocketUrl(path: string): string {
  const subPath = getSubPath()
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const isDev = process.env.NODE_ENV === 'development'
  const host = isDev ? 'localhost:8080' : window.location.host

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const fullPath = subPath ? `${subPath}${normalizedPath}` : normalizedPath

  return `${protocol}//${host}${fullPath}`
}
