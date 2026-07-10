const CURRENT_CLUSTER_STORAGE_KEY = 'current-cluster'
const CURRENT_CLUSTER_HEADER_KEY = 'x-cluster-name'

export function getCurrentCluster() {
  return (
    sessionStorage.getItem(CURRENT_CLUSTER_STORAGE_KEY) ||
    localStorage.getItem(CURRENT_CLUSTER_STORAGE_KEY)
  )
}

export function setCurrentCluster(clusterName: string) {
  sessionStorage.setItem(CURRENT_CLUSTER_STORAGE_KEY, clusterName)
  localStorage.setItem(CURRENT_CLUSTER_STORAGE_KEY, clusterName)
}

export function clearCurrentCluster() {
  sessionStorage.removeItem(CURRENT_CLUSTER_STORAGE_KEY)
  localStorage.removeItem(CURRENT_CLUSTER_STORAGE_KEY)
}

export function appendCurrentClusterParam(params: URLSearchParams) {
  const currentCluster = getCurrentCluster()
  if (currentCluster) {
    params.append(CURRENT_CLUSTER_HEADER_KEY, currentCluster)
  }
}

export function appendCurrentClusterHeader(headers: Record<string, string>) {
  const currentCluster = getCurrentCluster()
  if (currentCluster) {
    headers[CURRENT_CLUSTER_HEADER_KEY] = encodeURIComponent(currentCluster)
  }
}

export function withCurrentClusterPath(path: string) {
  const currentCluster = getCurrentCluster()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!currentCluster) {
    return normalizedPath
  }
  return `/_clusters/${encodeURIComponent(currentCluster)}${normalizedPath}`
}

export function getClusterScopedStorageKey(key: string) {
  const currentCluster = getCurrentCluster()
  return `${currentCluster || ''}${key}`
}
