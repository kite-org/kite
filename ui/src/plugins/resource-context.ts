import { createContext, useContext } from 'react'
import type {
  KubernetesResource,
  ResourceContext,
} from '@kite-dev/plugin-sdk/resources'

export const PluginResourceContext =
  createContext<ResourceContext<unknown> | null>(null)

export function useResourceContext<T = KubernetesResource>() {
  const context = useContext(PluginResourceContext)
  if (!context)
    throw new Error(
      'useResourceContext must be used inside a resource extension'
    )
  return context as ResourceContext<T>
}
