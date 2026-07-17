export type DeploymentStatusType =
  | 'Unknown'
  | 'Paused'
  | 'Scaled Down'
  | 'Not Available'
  | 'Progressing'
  | 'Terminating'
  | 'Available'

export type PodStatus = {
  readyContainers: number
  totalContainers: number
  reason: string
  restarts: number
  restartString: string
}

export type SimpleContainer = Array<{
  name: string
  image: string
  init?: boolean
}>

/**
 * @link https://kubernetes.io/docs/reference/node/node-status/#condition
 */
export type NodeConditionType =
  | 'Ready'
  | 'DiskPressure'
  | 'MemoryPressure'
  | 'PIDPressure'
  | 'NetworkUnavailable'
