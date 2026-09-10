/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { NamespaceContext as NamespaceValue } from '@kite-dev/plugin-sdk/hooks'

import { getClusterScopedStorageKey } from '@/lib/current-cluster'

const NamespaceContext = createContext<NamespaceValue | null>(null)

export function PluginNamespaceProvider({ children }: { children: ReactNode }) {
  const storageKey = getClusterScopedStorageKey('selectedNamespace')
  const [namespace, setValue] = useState(
    () =>
      sessionStorage.getItem(storageKey) ||
      localStorage.getItem(storageKey) ||
      'default'
  )
  const setNamespace = (value: string) => {
    sessionStorage.setItem(storageKey, value)
    localStorage.setItem(storageKey, value)
    setValue(value)
  }
  return (
    <NamespaceContext.Provider value={{ namespace, setNamespace }}>
      {children}
    </NamespaceContext.Provider>
  )
}

export function usePluginNamespace() {
  return useContext(NamespaceContext)!
}
