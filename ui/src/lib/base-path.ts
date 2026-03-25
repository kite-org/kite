const basePathPattern = /^(?:\/[A-Za-z0-9._~-]+)*$/

export function normalizeBasePath(basePath?: string): string {
  if (!basePath) {
    return ''
  }

  const normalizedBasePath = basePath.startsWith('/')
    ? basePath
    : `/${basePath}`
  const trimmedBasePath = normalizedBasePath.replace(/\/+$/, '')

  if (!trimmedBasePath) {
    return ''
  }

  if (!basePathPattern.test(trimmedBasePath)) {
    throw new Error(
      `Invalid KITE_BASE "${trimmedBasePath}": expected slash-separated path segments containing only letters, digits, '.', '_', '-', or '~'`
    )
  }

  return trimmedBasePath
}
