import http from 'node:http'
import https from 'node:https'

export async function createGateway(state) {
  const ids = new Set([state.donor, state.clone].filter(Boolean))
  const routes = []
  const failures = []
  const sockets = new Set()
  const target = (url) => {
    const match = /^\/_proxy\/e2b\/([^/]+)\/(6006|6007)\//.exec(url)
    if (!match || !ids.has(match[1])) return null
    return {
      id: match[1],
      port: Number(match[2]),
      path: '/' + url.slice(match[0].length),
      prefix: match[0],
    }
  }
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') return res.writeHead(204).end()
    const dest = target(req.url)
    if (!dest) {
      failures.push({ kind: 'unscoped', url: req.url })
      return res.writeHead(418).end('Request lacks explicit sandbox ownership')
    }
    routes.push({
      id: dest.id,
      port: dest.port,
      path: dest.path.replace(/([?&]token=)[^&]+/g, '$1[redacted]'),
    })
    const hostname = `${dest.port}-${dest.id}.e2b.app`
    const upstream = https.request(
      {
        hostname,
        path: dest.path,
        method: req.method,
        headers: { ...req.headers, host: hostname },
      },
      (response) => {
        if (response.statusCode >= 400)
          failures.push({
            id: dest.id,
            port: dest.port,
            status: response.statusCode,
            path: dest.path,
          })
        res.writeHead(response.statusCode, response.headers)
        response.pipe(res)
      },
    )
    upstream.on('error', (error) => {
      failures.push({ id: dest.id, port: dest.port, error: error.message })
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    const dest = target(req.url)
    if (!dest) return socket.destroy()
    const hostname = `${dest.port}-${dest.id}.e2b.app`
    routes.push({
      kind: 'websocket',
      id: dest.id,
      port: dest.port,
      path: dest.path.replace(/([?&]token=)[^&]+/g, '$1[redacted]'),
    })
    const upstream = https.request({
      hostname,
      path: dest.path,
      headers: { ...req.headers, host: hostname },
    })
    upstream.on('upgrade', (response, remote, remoteHead) => {
      sockets.add(socket)
      sockets.add(remote)
      socket.on('close', () => {
        sockets.delete(socket)
        remote.destroy()
      })
      remote.on('close', () => {
        sockets.delete(remote)
        socket.destroy()
      })
      socket.on('error', () => remote.destroy())
      remote.on('error', () => socket.destroy())
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
    })
    upstream.on('response', (response) => {
      failures.push({
        kind: 'websocket',
        id: dest.id,
        port: dest.port,
        status: response.statusCode,
      })
      socket.destroy()
    })
    upstream.on('error', (error) => {
      failures.push({
        kind: 'websocket',
        id: dest.id,
        port: dest.port,
        error: error.message,
      })
      socket.destroy()
    })
    upstream.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    routes,
    failures,
    addClone(id) {
      ids.add(id)
    },
    url(id, port, suffix = '') {
      return this.origin + `/_proxy/e2b/${id}/${port}/` + suffix
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
