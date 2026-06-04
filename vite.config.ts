import { defineConfig, type Plugin } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import manifest from './public/manifest.json'

// @crxjs emits the service worker as a tiny loader that pulls in the background
// chunk via an ES-module `import`. On some Chrome/Vite combinations that module
// worker fails to register with "Service worker registration failed. Status
// code: 2" — the import resolution is the fragile part.
//
// Our background bundle has no imports of its own, so after the build we inline
// the chunk's code directly into the loader file. The result is a single,
// self-contained worker with nothing to import — which registers reliably.
const inlineServiceWorker = (): Plugin => ({
  name: 'inline-service-worker',
  // Run after @crxjs has written the loader + chunk
  closeBundle() {
    const dist = resolve('dist')
    const loaderPath = resolve(dist, 'service-worker-loader.js')
    if (!existsSync(loaderPath)) return

    const loader = readFileSync(loaderPath, 'utf8')
    const match = loader.match(/import\s+['"](.+?)['"]/)
    if (!match) return // already inlined or unexpected shape — leave it alone

    const chunkPath = resolve(dist, match[1].replace(/^\.?\//, ''))
    if (!existsSync(chunkPath)) return

    writeFileSync(loaderPath, readFileSync(chunkPath, 'utf8'))
  },
})

export default defineConfig({
  plugins: [
    crx({ manifest }),
    inlineServiceWorker(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
