import { useEffect, useState } from 'react'
import type {
  DiffEditorProps,
  EditorProps,
  default as MonacoEditorComponent,
} from '@monaco-editor/react'

import { configureMonaco } from './monaco-runtime'

type ReactMonacoModule = typeof import('@monaco-editor/react')

function useReactMonacoModule() {
  const [module, setModule] = useState<ReactMonacoModule | null>(null)

  useEffect(() => {
    let cancelled = false

    void configureMonaco().then((loadedModule) => {
      if (!cancelled) {
        setModule(loadedModule)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return module
}

export function MonacoEditor(props: EditorProps) {
  const module = useReactMonacoModule()

  if (!module) {
    return <>{props.loading || 'Loading...'}</>
  }

  const Editor = module.default as typeof MonacoEditorComponent
  return <Editor {...props} />
}

export function MonacoDiffEditor(props: DiffEditorProps) {
  const module = useReactMonacoModule()

  if (!module) {
    return <>{props.loading || 'Loading...'}</>
  }

  const DiffEditor = module.DiffEditor
  return <DiffEditor {...props} />
}
