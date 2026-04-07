const CURRENT_CLUSTER_STORAGE_KEY = 'current-cluster'
const CURRENT_CLUSTER_HEADER_KEY = 'x-cluster-name'
const CLEAR_COOKIE_EXPIRES = 'Thu, 01 Jan 1970 00:00:00 GMT'

export function getCurrentCluster() {
  return localStorage.getItem(CURRENT_CLUSTER_STORAGE_KEY)
}

export function setCurrentCluster(clusterName: string) {
  localStorage.setItem(CURRENT_CLUSTER_STORAGE_KEY, clusterName)
  document.cookie = `${CURRENT_CLUSTER_HEADER_KEY}=${clusterName}; path=/`
}

export function clearCurrentCluster() {
  localStorage.removeItem(CURRENT_CLUSTER_STORAGE_KEY)
  document.cookie = `${CURRENT_CLUSTER_HEADER_KEY}=; path=/; expires=${CLEAR_COOKIE_EXPIRES}`
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
    headers[CURRENT_CLUSTER_HEADER_KEY] = currentCluster
  }
}

export function getClusterScopedStorageKey(key: string) {
  const currentCluster = getCurrentCluster()
  return `${currentCluster || ''}${key}`
}
