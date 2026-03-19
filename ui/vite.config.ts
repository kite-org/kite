import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { dynamicBase } from 'vite-plugin-dynamic-base'

const devBase = process.env.KITE_BASE || ''

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/__dynamic_base__/' : devBase,
  plugins: [
    dynamicBase({
      publicPath: 'window.__dynamic_base__',
      transformIndexHtml: true,
    }),
    react(),
    tailwindcss(),
  ],
  envPrefix: ['VITE_', 'KITE_'],
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    watch: {
      ignored: ['**/.vscode/**'],
    },
    proxy: {
      [devBase + '/api/']: {
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
})
