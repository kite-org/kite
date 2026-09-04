import type { Container, ContainerStatus } from 'kubernetes-types/core/v1'

export type PodOverviewContainer = {
  container: Container
  init: boolean
  ephemeral?: boolean
  status?: ContainerStatus
}
