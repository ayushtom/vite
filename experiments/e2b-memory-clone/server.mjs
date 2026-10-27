// This fixture runs in the sandbox project, which installs the packed Vite.
// eslint-disable-next-line n/no-extraneous-import
import { createServer } from 'vite'
import { probePlugin } from './probe.mjs'
const server = await createServer({
  configFile: false,
  root: '/home/user/vite-clone',
  base: './',
  experimental: { relativeDevBase: true },
  server: {
    host: '0.0.0.0',
    port: 6007,
    strictPort: true,
    allowedHosts: true,
    ws: { path: 'updates' },
    watch: { usePolling: true, interval: 100 },
  },
  optimizeDeps: { include: ['picocolors'] },
  plugins: [
    probePlugin('vite'),
    {
      name: 'fixture-virtual-modules',
      resolveId(id) {
        if (id === 'virtual:message') return '\0virtual:message'
      },
      load(id) {
        if (id === '\0virtual:message')
          return `export { stable as message } from '/src/stable.js'`
      },
      transformIndexHtml: {
        order: 'post',
        handler() {
          return [
            {
              tag: 'script',
              attrs: { type: 'module' },
              children: `import { stable } from '/src/stable.js'; document.documentElement.dataset.preamble = stable`,
            },
          ]
        },
      },
    },
  ],
})
await server.listen()
console.log('VITE_MEMORY_CLONE_READY')
