import type { Container, ContainerStatus } from 'kubernetes-types/core/v1'

export type PodOverviewContainer = {
  container: Container
  init: boolean
  status?: ContainerStatus
}
