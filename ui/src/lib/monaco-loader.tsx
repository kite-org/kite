import { lazy } from 'react'

type ReactMonacoModule = typeof import('@monaco-editor/react')

let monacoSetupPromise: Promise<ReactMonacoModule> | null = null

function configureMonaco(): Promise<ReactMonacoModule> {
  if (!monacoSetupPromise) {
    monacoSetupPromise = Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    ])
      .then(([reactMonacoModule, monacoModule, workerModule]) => {
        const MonacoWorker = workerModule.default
        const globalScope = globalThis as typeof globalThis & {
          MonacoEnvironment?: {
            getWorker: () => Worker
          }
        }

        globalScope.MonacoEnvironment = {
          getWorker() {
            return new MonacoWorker()
          },
        }

        reactMonacoModule.loader.config({ monaco: monacoModule })
        return reactMonacoModule
      })
      .catch((error) => {
        monacoSetupPromise = null
        throw error
      })
  }

  return monacoSetupPromise
}

export const MonacoEditor = lazy(async () => {
  const module = await configureMonaco()
  return { default: module.default }
})

export const MonacoDiffEditor = lazy(async () => {
  const module = await configureMonaco()
  return { default: module.DiffEditor }
})
