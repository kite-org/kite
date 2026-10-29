import { createContext, useContext, type ReactNode } from 'react'

type WorkspaceTarget = { namespace?: string; name?: string; container?: string }
type OpenWorkspace = (
  view: 'logs' | 'terminal',
  target: WorkspaceTarget
) => void

const WorkspaceContext = createContext<OpenWorkspace | null>(null)

export function WorkspaceProvider({
  children,
  openWorkspace,
}: {
  children: ReactNode
  openWorkspace: OpenWorkspace
}) {
  return (
    <WorkspaceContext.Provider value={openWorkspace}>
      {children}
    </WorkspaceContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  return useContext(WorkspaceContext)
}
