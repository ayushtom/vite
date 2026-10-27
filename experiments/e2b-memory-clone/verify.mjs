/* global document, getComputedStyle */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-chromium'
import { Sandbox, apiKey, runDir } from './sdk.mjs'
import { createGateway } from './gateway.mjs'

const here = pathToFileURL(runDir + '/')
const statePath = new URL('./state.json', here)
const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
const result = {
  startedAt: new Date().toISOString(),
  patchCommit: '0a47270',
  donor: state.donor,
  phases: [],
  fingerprints: [],
  errors: [],
  sockets: [],
}
const save = () =>
  fs.writeFile(new URL('./result.json', here), JSON.stringify(result, null, 2))
async function phase(name, fn) {
  console.log('START', name)
  const start = performance.now()
  await fn()
  result.phases.push({
    name,
    passed: true,
    elapsedMs: Math.round(performance.now() - start),
  })
  await save()
  console.log('PASS', name)
}
async function until(fn, message, timeout = 30000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      last = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw Error(message + (last ? ': ' + last.message : ''))
}
const donor = await Sandbox.connect(state.donor, { apiKey })
await donor.setTimeout(1800000)
const root = '/home/user/vite-clone'
// Storybook owns this socket separately from Vite. Use the existing adapter's
// role, deriving its path from the loaded document rather than startup env.
await donor.files.write(
  root + '/.storybook/preview-head.html',
  `<script>
const NativeWebSocket = window.WebSocket;
window.WebSocket = class extends NativeWebSocket {
 constructor(url, protocols) {
  const target = new URL(url, location.href);
  if (target.pathname === '/storybook-server-channel') target.pathname = new URL('./storybook-server-channel', location.href).pathname;
  super(target.href, protocols);
 }
};
</script>`,
)
const gateway = await createGateway(state)
const browser = await chromium.launch()
const context = await browser.newContext()
await context.addCookies([
  {
    name: 'e2b_sandbox',
    value: 'deliberately-wrong-destination:6007',
    url: gateway.origin,
  },
])
const views = []
const baseline = new Map()
let clone
const url = (id, port) =>
  gateway.url(
    id,
    port,
    port === 6006 ? 'iframe.html?id=preview--default&viewMode=story' : '',
  )
async function probe(id, port, action, marker) {
  const address = gateway.url(id, port, '__clone_probe')
  const query = new URLSearchParams()
  if (action) query.set('action', action)
  if (marker) query.set('marker', marker)
  const response = await fetch(address + (query.size ? '?' + query : ''), {
    method: action ? 'POST' : 'GET',
  })
  assert.equal(response.status, 200, `probe ${id}:${port}`)
  return response.json()
}
async function identity(phaseName) {
  for (const sb of [donor, clone].filter(Boolean))
    for (const port of [6007, 6006]) {
      const data = await probe(sb.sandboxId, port)
      const original = baseline.get(port)
      for (const key of [
        'pid',
        'startTicks',
        'launchNonce',
        'startedAt',
        'launches',
      ])
        assert.equal(
          data[key],
          original[key],
          `server restarted: ${phaseName} ${sb.sandboxId}:${port} ${key}`,
        )
      assert.equal(data.inheritedSandboxId, state.donor)
      assert.equal(data.donorAtLaunch, state.donor)
      result.fingerprints.push({
        phase: phaseName,
        runtime: sb.sandboxId,
        port,
        ...data,
      })
    }
}
async function view(sb, port, expected) {
  const page = await context.newPage()
  const entry = {
    sb,
    id: sb.sandboxId,
    port,
    page,
    connected: 0,
    navigations: 0,
    expected,
  }
  views.push(entry)
  page.on('console', (message) => {
    if (message.text() === '[vite] connected.') entry.connected++
    if (message.type() === 'error')
      result.errors.push({
        id: entry.id,
        port,
        kind: 'console',
        text: message.text(),
      })
  })
  page.on('pageerror', (error) =>
    result.errors.push({
      id: entry.id,
      port,
      kind: 'page',
      text: error.message,
    }),
  )
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) entry.navigations++
  })
  page.on('websocket', (socket) =>
    result.sockets.push({
      id: entry.id,
      port,
      url: socket.url().replace(/([?&]token=)[^&]+/g, '$1[redacted]'),
    }),
  )
  await page.goto(url(entry.id, port), { waitUntil: 'load', timeout: 90000 })
  await until(
    () =>
      page
        .textContent(port === 6006 ? '#storybook-root h1' : '#message')
        .then((text) => text === expected),
    'initial preview content ' + port,
    90000,
  )
  await until(() => entry.connected > 0, 'Vite connection ' + port)
  if (port === 6007) {
    assert.equal(await page.textContent('#virtual'), 'ready:function')
    await until(
      () => page.textContent('#worker').then((text) => text === 'worker:ready'),
      'module worker',
    )
    await until(
      () =>
        page.textContent('#classic').then((text) => text === 'classic:ready'),
      'classic worker',
    )
    assert.equal(await page.textContent('#lazy'), 'ready')
    assert.equal(
      await page.locator('#image').evaluate((el) => el.naturalWidth),
      4,
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.base),
      `/_proxy/e2b/${entry.id}/${port}/`,
    )
    assert.ok(
      (
        await page
          .locator('.background')
          .evaluate((el) => getComputedStyle(el).backgroundImage)
      ).includes(`/_proxy/e2b/${entry.id}/${port}/`),
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.preamble),
      'ready',
    )
  } else
    assert.equal(
      await page
        .locator('#storybook-root img')
        .evaluate((el) => el.naturalWidth),
      4,
    )
  return entry
}
async function text(entry) {
  return entry.page.textContent(
    entry.port === 6006 ? '#storybook-root h1' : '#message',
  )
}
async function change(entry, next) {
  const selector =
    entry.port === 6006 ? 'sb/Preview.stories.tsx' : 'src/message.js'
  const previous = entry.expected
  const token = crypto.randomUUID()
  await entry.page.evaluate((token) => {
    document.documentElement.dataset.keep = token
  }, token)
  const navigations = entry.navigations
  const source = await entry.sb.files.read(root + '/' + selector)
  assert.ok(source.includes(previous), 'edit target missing')
  await entry.sb.files.write(
    root + '/' + selector,
    source.replace(previous, next),
  )
  await until(
    () => text(entry).then((value) => value === next),
    'HMR content ' + entry.id + ':' + entry.port,
  )
  assert.equal(
    await entry.page.evaluate(() => document.documentElement.dataset.keep),
    token,
    'HMR replaced the document',
  )
  assert.equal(entry.navigations, navigations, 'HMR navigated')
  entry.expected = next
  for (const other of views.filter((other) => other !== entry))
    assert.equal(await text(other), other.expected, 'sibling changed')
}
async function reload(entry, action) {
  const prior = entry.navigations
  const connections = entry.connected
  if (action) await probe(entry.id, entry.port, action)
  else await entry.page.reload({ waitUntil: 'load', timeout: 60000 })
  await until(
    () => entry.navigations > prior && entry.connected > connections,
    'reload/reconnect navigation ' + entry.id + ':' + entry.port,
  )
  await until(
    () => text(entry).then((value) => value === entry.expected),
    'reload content',
  )
}
try {
  await phase(
    'verify exact patched package and capture server identities',
    async () => {
      const hash = crypto
        .createHash('sha256')
        .update(
          await fs.readFile(
            new URL(
              '../../packages/vite/dist/node/chunks/node.js',
              import.meta.url,
            ),
          ),
        )
        .digest('hex')
      const remote = await donor.commands.run(
        `cd ${root} && sha256sum node_modules/vite/dist/node/chunks/node.js`,
      )
      assert.equal(remote.stdout.split(' ')[0], hash)
      result.nodeBundleSha256 = hash
      for (const port of [6007, 6006]) {
        const data = await probe(state.donor, port)
        assert.equal(data.relativeDevBase, true)
        assert.ok(data.launches >= 1)
        baseline.set(port, data)
      }
    },
  )
  await phase(
    'warm donor Vite and real Storybook through explicit preview paths',
    async () => {
      await view(donor, 6007, 'donor:initial')
      await view(donor, 6006, 'Local relative Storybook')
      for (const port of [6007, 6006]) {
        const marker = 'memory-only-' + crypto.randomUUID()
        const seeded = await probe(state.donor, port, 'seed', marker)
        result.fingerprints.push({
          phase: 'seed-before-snapshot',
          runtime: state.donor,
          port,
          ...seeded,
        })
        state['memoryMarker' + port] = marker
      }
      await identity('warm-donor')
    },
  )
  await phase(
    'create full memory snapshot and restore a new sandbox',
    async () => {
      const snapshot = await donor.createSnapshot()
      state.snapshot = snapshot.snapshotId
      await fs.writeFile(statePath, JSON.stringify(state, null, 2))
      console.log('Snapshot ready', snapshot.snapshotId)
      clone = await Sandbox.create(snapshot.snapshotId, {
        apiKey,
        timeoutMs: 1800000,
        metadata: { purpose: 'vite-relative-memory-clone-child-0a47270' },
      })
      state.clone = clone.sandboxId
      state.cloneHost = clone.getHost(6007)
      result.clone = clone.sandboxId
      result.snapshot = snapshot.snapshotId
      await fs.writeFile(statePath, JSON.stringify(state, null, 2))
      gateway.addClone(clone.sandboxId)
      for (const port of [6007, 6006]) {
        const inherited = await until(
          () => probe(clone.sandboxId, port),
          'inherited server not listening',
          60000,
        )
        assert.equal(
          inherited.memoryMarker,
          state['memoryMarker' + port],
          'in-memory seed not restored',
        )
        assert.equal(
          inherited.inheritedSandboxId,
          state.donor,
          'donor process environment changed',
        )
        await probe(clone.sandboxId, port, 'seed', 'clone-only-' + port)
        assert.equal(
          (await probe(state.donor, port)).memoryMarker,
          state['memoryMarker' + port],
          'clone request reached donor',
        )
      }
      await identity('immediately-after-memory-clone')
    },
  )
  await phase(
    'edit clone files and render both inherited previews without restart',
    async () => {
      await clone.files.write(
        root + '/src/message.js',
        "export const message = 'clone:initial'\n",
      )
      const source = await clone.files.read(root + '/sb/Preview.stories.tsx')
      await clone.files.write(
        root + '/sb/Preview.stories.tsx',
        source.replace('Local relative Storybook', 'Clone relative Storybook'),
      )
      await view(clone, 6007, 'clone:initial')
      await view(clone, 6006, 'Clone relative Storybook')
      for (const entry of views) assert.equal(await text(entry), entry.expected)
      await identity('both-previews-rendered')
    },
  )
  await phase(
    'independent JS HMR and React Storybook HMR without document replacement',
    async () => {
      for (const entry of views)
        await change(entry, entry.expected + ' updated')
      await identity('after-independent-js-hmr')
    },
  )
  await phase(
    'independent direct and injected CSS updates without reload',
    async () => {
      for (const entry of views.filter((entry) => entry.port === 6007)) {
        const token = crypto.randomUUID()
        await entry.page.evaluate((token) => {
          document.documentElement.dataset.keep = token
        }, token)
        const color =
          entry.id === state.donor ? 'rgb(0, 0, 255)' : 'rgb(0, 128, 0)'
        await entry.sb.files.write(
          root + '/src/style.css',
          `.background { color: ${color}; background-image: url('/tile.svg?no-inline'); }`,
        )
        await until(
          () =>
            entry.page
              .locator('.background')
              .evaluate((el) => getComputedStyle(el).color)
              .then((value) => value === color),
          'injected CSS HMR',
        )
        await entry.sb.files.write(
          root + '/link.css',
          `body { background-color: ${color}; }`,
        )
        await until(
          () =>
            entry.page
              .locator('body')
              .evaluate((el) => getComputedStyle(el).backgroundColor)
              .then((value) => value === color),
          'linked CSS HMR',
        )
        assert.equal(
          await entry.page.evaluate(
            () => document.documentElement.dataset.keep,
          ),
          token,
        )
      }
      await identity('after-css-hmr')
    },
  )
  await phase('reload each preview after opening its sibling', async () => {
    for (const entry of views) await reload(entry)
    for (const entry of views) assert.equal(await text(entry), entry.expected)
    await identity('after-manual-reloads')
  })
  await phase(
    'server-requested full reloads retain runtime ownership',
    async () => {
      for (const entry of views) {
        const others = views
          .filter((other) => other !== entry)
          .map((other) => [other, other.navigations])
        await reload(entry, 'full-reload')
        for (const [other, count] of others)
          assert.equal(other.navigations, count, 'sibling reloaded')
      }
      await identity('after-server-reloads')
    },
  )
  await phase(
    'disconnect and reconnect every Vite socket, then apply another live edit',
    async () => {
      for (const entry of views) {
        await reload(entry, 'disconnect')
        await change(entry, entry.expected + ' reconnected')
      }
      await identity('after-reconnect-and-edit')
    },
  )
  await phase(
    'Storybook alternate story and return preserve each runtime',
    async () => {
      for (const entry of views.filter((entry) => entry.port === 6006)) {
        await entry.page.goto(
          gateway.url(
            entry.id,
            6006,
            'iframe.html?id=preview--alternate&viewMode=story',
          ),
        )
        await until(
          () =>
            entry.page
              .textContent('#storybook-root h1')
              .then((value) => value === 'Alternate relative state'),
          'alternate story',
        )
        await entry.page.goto(url(entry.id, 6006))
        await until(
          () => text(entry).then((value) => value === entry.expected),
          'return default',
        )
      }
      await identity('final')
    },
  )
  await phase(
    'verify HTTP and socket ownership and capture final previews',
    async () => {
      assert.deepEqual(gateway.failures, [])
      assert.deepEqual(result.errors, [])
      for (const entry of views) {
        const prefix = `/_proxy/e2b/${entry.id}/${entry.port}/`
        for (const socket of result.sockets.filter(
          (item) => item.id === entry.id && item.port === entry.port,
        ))
          assert.ok(
            new URL(socket.url).pathname.startsWith(prefix),
            'unscoped socket',
          )
        await entry.page.screenshot({
          path: new URL(
            `./${entry.id === state.donor ? 'donor' : 'clone'}-${entry.port}.png`,
            here,
          ).pathname,
          fullPage: true,
        })
      }
      result.previewContents = await Promise.all(
        views.map(async (entry) => ({
          id: entry.id,
          port: entry.port,
          text: await text(entry),
          navigations: entry.navigations,
          connections: entry.connected,
        })),
      )
      result.httpRequestCount = gateway.routes.filter(
        (route) => !route.kind,
      ).length
      result.webSocketCount = gateway.routes.filter(
        (route) => route.kind === 'websocket',
      ).length
      await fs.writeFile(
        new URL('./routes.json', here),
        JSON.stringify(gateway.routes, null, 2),
      )
    },
  )
  result.passed = true
} catch (error) {
  result.passed = false
  result.failure = error.stack
  result.gatewayFailures = gateway.failures
  for (const entry of views) {
    try {
      await entry.page.screenshot({
        path: new URL(
          `./failure-${entry.id === state.donor ? 'donor' : 'clone'}-${entry.port}.png`,
          here,
        ).pathname,
        fullPage: true,
      })
    } catch {}
  }
  await fs.writeFile(
    new URL('./routes.json', here),
    JSON.stringify(gateway.routes, null, 2),
  )
  console.error(error.stack)
  process.exitCode = 1
} finally {
  result.completedAt = new Date().toISOString()
  await save()
  await browser.close()
  await gateway.close()
}
