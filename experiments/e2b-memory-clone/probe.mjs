import fs from 'node:fs'
import crypto from 'node:crypto'

export function probePlugin(name) {
  const fingerprint = {
    pid: process.pid,
    startTicks: fs.readFileSync('/proc/self/stat', 'utf8').split(' ')[21],
    launchNonce: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    inheritedSandboxId: process.env.E2B_SANDBOX_ID,
    donorAtLaunch: process.env.VITE_CLONE_DONOR,
    patchCommit: '0a4727045d0a01103d530b6654ec3999e6514c5f',
  }
  const launches = `/home/user/vite-clone/${name}-launches.jsonl`
  fs.appendFileSync(launches, JSON.stringify(fingerprint) + '\n')
  let memoryMarker = null
  let requests = 0
  return {
    name: 'memory-clone-process-probe',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://vite.test')
        if (url.pathname !== '/__clone_probe') return next()
        const action = url.searchParams.get('action')
        if (action && req.method !== 'POST') {
          res.writeHead(405).end()
          return
        }
        if (action === 'seed') memoryMarker = url.searchParams.get('marker')
        if (action === 'full-reload')
          server.ws.send({ type: 'full-reload', path: '*' })
        if (action === 'disconnect') {
          for (const client of server.ws.clients) client.socket.terminate()
        }
        requests++
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(
          JSON.stringify({
            ...fingerprint,
            memoryMarker,
            requests,
            launches: fs.readFileSync(launches, 'utf8').trim().split('\n')
              .length,
            connections: server.ws.clients.size,
            relativeDevBase: server.config.experimental.relativeDevBase,
            base: server.config.base,
          }),
        )
      })
    },
  }
}
