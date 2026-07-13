// Mirrors pkg/plugins/gpu/types.go
export interface GpuSummary {
  totalGPUs: number
  allocatedGPUs: number
  freeGPUs: number
}

export interface GpuContainerAllocation {
  name: string
  count: number
}

export interface GpuPodAllocation {
  namespace: string
  name: string
  count: number
  containers: GpuContainerAllocation[]
}

export interface GpuNodeResource {
  key: string
  allocatable: number
  allocated: number
  pods: GpuPodAllocation[]
}

export interface GpuOccupant {
  namespace: string
  pod: string
  container?: string
}

export interface GpuCard {
  index: string
  uuid: string
  modelName?: string
  utilization: number
  memoryUsedBytes?: number
  memoryTotalBytes?: number
  occupant: GpuOccupant | null
}

export interface GpuNode {
  name: string
  ready: boolean
  gpuModel?: string
  resources: GpuNodeResource[]
  cards?: GpuCard[]
}

export type GpuLevel = 'basic' | 'dcgm'

export interface GpuOverview {
  level: GpuLevel
  resourceKeys: string[]
  summary: GpuSummary
  nodes: GpuNode[]
  unassignedCards?: GpuCard[]
}

export interface ResetPodRef {
  namespace: string
  name: string
}

export interface ResetDevicePluginResponse {
  dryRun: boolean
  pods: ResetPodRef[]
}
