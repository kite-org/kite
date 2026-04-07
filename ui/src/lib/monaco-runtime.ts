type ReactMonacoModule = typeof import('@monaco-editor/react')

let monacoSetupPromise: Promise<ReactMonacoModule> | null = null

export function configureMonaco(): Promise<ReactMonacoModule> {
  monacoSetupPromise ??= loadMonaco().catch((error) => {
    monacoSetupPromise = null
    throw error
  })
  return monacoSetupPromise
}

async function loadMonaco(): Promise<ReactMonacoModule> {
  const [reactMonaco, monacoApi, , workerModule] = await Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor/esm/vs/editor/editor.api.js'),
    import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
  ])

  self.MonacoEnvironment = {
    getWorker: () => new workerModule.default(),
  }

  reactMonaco.loader.config({
    monaco:
      monacoApi as typeof import('monaco-editor/esm/vs/editor/editor.api.js'),
  })

  return reactMonaco
}
