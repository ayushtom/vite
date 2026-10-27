import { createServer as createHttpServer, request } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { rootDir, setViteUrl } from '~utils'

export const servers: ViteDevServer[] = []
export const roots: string[] = []
export const requests: string[] = []
export let gatewayUrl: string
const sockets = new Set<Socket>()
export function disconnectSockets() {
  for (const socket of sockets) socket.destroy()
}

export async function serve() {
  for (const label of ['a', 'b']) {
    const root = path.join(rootDir, 'runtime-' + label)
    await fs.mkdir(root, { recursive: true })
    for (const file of [
      'index.html',
      'alias.html',
      'direct-alias.html',
      'hidden.html',
      'virtual.html',
      'virtual-hmr.html',
      'soft.html',
      'prefix.html',
      'link.css',
      'tile.svg',
      'src',
    ]) {
      await fs.cp(path.join(rootDir, file), path.join(root, file), {
        recursive: true,
      })
    }
    await fs.writeFile(
      path.join(root, 'src/message.js'),
      `export const message = '${label}:initial'\n`,
    )
    roots.push(root)
    const server = await createServer({
      configFile: false,
      root,
      base: './',
      experimental: { relativeDevBase: true },
      logLevel: 'silent',
      server: {
        port: 0,
        ws: { path: 'updates' },
        watch: { usePolling: true, interval: 50 },
      },
      optimizeDeps: { include: ['picocolors'] },
      plugins: [
        {
          name: 'virtual-message',
          resolveId(id) {
            if (id === 'virtual:message') return '\0virtual:message'
            if (id === 'virtual:hot-message') return '\0virtual:hot-message'
            if (id === '/percent-alias.js')
              return path.join(root, 'src/percent%.js')
            if (id === '/encoded-percent-alias.js')
              return path.join(root, 'src/percent%20.js')
            if (id === '/virtual/asset.js') return id
            if (id.split('?')[0] === '/alias.js')
              return (
                path.join(root, 'src/alias-entry.js') +
                id.slice('/alias.js'.length)
              )
          },
          load(id) {
            if (id === '/virtual/asset.js')
              return `export default new URL('/tile.svg?no-inline', import.meta.url).href`
            if (id === '\0virtual:message')
              return `export { stable as message } from '/src/stable.js'`
            if (id === '\0virtual:hot-message')
              return `export { message } from '/src/virtual-hmr-child.js'`
          },
          transformIndexHtml: {
            order: 'post',
            handler(html) {
              return {
                html: html.replace(
                  '</body>',
                  `<div id="entity-style" style='background-image: url(&#39;/tile.svg?literal=&amp;copy;&#39;)' data-preserved="yes"></div></body>`,
                ),
                tags: [
                  {
                    tag: 'script',
                    attrs: { type: 'module' },
                    children: `import { stable } from '/src/stable.js'; document.documentElement.dataset.preamble = stable`,
                  },
                ],
              }
            },
          },
        },
      ],
    })
    await server.listen()
    servers.push(server)
  }
  const target = (url: string) => {
    const match = /^\/_preview\/([^/]+)\//.exec(url)
    if (!match) return null
    const label = decodeURIComponent(match[1])
    return ['a', 'b', 'moved', 'a(quoted)'].includes(label)
      ? { prefix: match[0], server: servers[label === 'b' ? 1 : 0] }
      : null
  }
  const gateway = createHttpServer((req, res) => {
    requests.push(req.url!)
    const dest = target(req.url!)
    if (!dest) {
      res.writeHead(418).end('Unscoped preview request')
      return
    }
    const port = (dest.server.httpServer!.address() as AddressInfo).port
    const upstream = request(
      {
        host: 'localhost',
        port,
        path: '/' + req.url!.slice(dest.prefix.length),
        method: req.method,
        headers: { ...req.headers, host: 'localhost:' + port },
      },
      (response) => {
        res.writeHead(response.statusCode!, response.headers)
        response.pipe(res)
      },
    )
    upstream.on('error', () => res.writeHead(502).end())
    req.pipe(upstream)
  })
  gateway.on('upgrade', (req, socket, head) => {
    const dest = target(req.url!)
    if (!dest) {
      socket.destroy()
      return
    }
    const port = (dest.server.httpServer!.address() as AddressInfo).port
    const upstream = request({
      host: 'localhost',
      port,
      path: '/' + req.url!.slice(dest.prefix.length),
      headers: { ...req.headers, host: 'localhost:' + port },
    })
    upstream.on('upgrade', (response, remote, remoteHead) => {
      sockets.add(remote)
      remote.on('close', () => sockets.delete(remote))
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n') +
          '\r\n\r\n',
      )
      if (head.length) remote.write(head)
      if (remoteHead.length) socket.write(remoteHead)
      socket.pipe(remote).pipe(socket)
      socket.on('error', () => remote.destroy())
      remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy())
      remote.on('close', () => socket.destroy())
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  })
  await new Promise<void>((resolve) => gateway.listen(0, 'localhost', resolve))
  gatewayUrl = `http://localhost:${(gateway.address() as AddressInfo).port}`
  setViteUrl(gatewayUrl + '/_preview/a/')
  return {
    async close() {
      await Promise.all(servers.map((server) => server.close()))
      gateway.closeAllConnections()
      await new Promise<void>((resolve) => gateway.close(() => resolve()))
    },
  }
}
