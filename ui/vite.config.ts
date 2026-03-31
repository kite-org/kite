import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { normalizeBasePath } from './src/lib/base-path'

const devSubPath = normalizeBasePath(process.env.KITE_BASE)
const runtimeBasePlaceholder = '__KITE_BASE__'

function getDevBase() {
  return devSubPath ? `${devSubPath}/` : '/'
}

function getManualChunk(id: string) {
  const normalizedId = id.replaceAll('\\', '/')

  if (normalizedId.includes('/node_modules/recharts/')) {
    return 'recharts'
  }

  return undefined
}

function runtimeBaseHtmlPlugin(): Plugin {
  let buildOutDir = ''

  return {
    name: 'kite-runtime-base-html',
    apply: 'build',
    configResolved(config) {
      buildOutDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const indexHtmlPath = path.join(buildOutDir, 'index.html')
      const html = readFileSync(indexHtmlPath, 'utf8')

      // Make the first HTML-loaded assets runtime-base aware without relying on <base href>.
      const nextHtml = html.replaceAll(
        /((?:href|src)=["'])\.\/assets\//g,
        `$1${runtimeBasePlaceholder}/assets/`
      )

      if (nextHtml !== html) {
        writeFileSync(indexHtmlPath, nextHtml)
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : getDevBase(),
  plugins: [react(), tailwindcss(), runtimeBaseHtmlPlugin()],
  envPrefix: ['VITE_', 'KITE_'],
  build: {
    outDir: '../static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rolldownOptions: {
      output: {
        manualChunks: getManualChunk,
      },
    },
  },
  server: {
    watch: {
      ignored: ['**/.vscode/**'],
    },
    proxy: {
      [devSubPath + '/api/']: {
        changeOrigin: true,
        target: 'http://localhost:8080',
      },
      '^/ws/.*': {
        target: 'ws://localhost:8080',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  define: {
    global: 'globalThis',
  },
}))
