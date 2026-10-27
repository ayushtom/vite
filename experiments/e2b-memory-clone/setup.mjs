import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Sandbox, apiKey, runFile, artifactPath } from './sdk.mjs'
const here = new URL('.', import.meta.url)
const statePath = runFile('state.json')
const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
const sb = await Sandbox.connect(state.donor, { apiKey })
const root = '/home/user/vite-clone'
await sb.commands.run(`mkdir -p ${root}/.storybook ${root}/sb`)
await sb.files.write(
  root + '/vite-patched.tgz',
  await fs.readFile(artifactPath),
)
state.packageSha256 = crypto
  .createHash('sha256')
  .update(await fs.readFile(artifactPath))
  .digest('hex')
for (const file of ['probe.mjs', 'server.mjs'])
  await sb.files.write(
    root + '/' + file,
    await fs.readFile(new URL(file, here), 'utf8'),
  )
await sb.files.write(
  root + '/.storybook/main.mjs',
  await fs.readFile(new URL('./storybook-main.mjs', here), 'utf8'),
)
await sb.files.write(
  root + '/.storybook/preview-head.html',
  await fs.readFile(new URL('./fixture/preview-head.html', here), 'utf8'),
)
await sb.files.write(
  root + '/sb/Preview.stories.tsx',
  await fs.readFile(new URL('./fixture/Preview.stories.tsx', here), 'utf8'),
)
await sb.files.write(
  root + '/sb/preview.css',
  await fs.readFile(new URL('./fixture/preview.css', here), 'utf8'),
)
await sb.files.write(
  root + '/sb/icon.svg',
  await fs.readFile(new URL('./fixture/icon.svg', here), 'utf8'),
)
for (const name of ['index.html', 'link.css', 'tile.svg', 'src']) {
  const local = new URL('../../playground/relative-dev-base/' + name, here)
  async function copy(localPath, remote) {
    const stat = await fs.stat(localPath)
    if (stat.isDirectory()) {
      await sb.commands.run(`mkdir -p ${remote}`)
      for (const entry of await fs.readdir(localPath))
        await copy(path.join(localPath, entry), remote + '/' + entry)
    } else await sb.files.write(remote, await fs.readFile(localPath))
  }
  await copy(local.pathname, root + '/' + name)
}
await sb.files.write(
  root + '/src/message.js',
  "export const message = 'donor:initial'\n",
)
await sb.files.write(
  root + '/package.json',
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      vite: 'file:./vite-patched.tgz',
      picocolors: '1.1.1',
      storybook: '10.4.6',
      '@storybook/react-vite': '10.4.6',
      react: '19.2.3',
      'react-dom': '19.2.3',
    },
  }),
)
await fs.writeFile(statePath, JSON.stringify(state, null, 2))
console.log('Files uploaded; installing isolated sandbox dependencies')
const install = await sb.commands.run(
  `cd ${root} && corepack pnpm@10.34.5 install > install.log 2>&1`,
  { timeoutMs: 240000 },
)
if (install.exitCode)
  throw Error(
    'Sandbox dependency installation failed: ' +
      (await sb.files.read(root + '/install.log')).slice(-3000),
  )
const launch = await sb.commands.run(
  `cd ${root}\nVITE_CLONE_DONOR=${state.donor} nohup node server.mjs > vite.log 2>&1 < /dev/null &\necho $! > vite.pid\nVITE_CLONE_DONOR=${state.donor} nohup node node_modules/storybook/dist/bin/dispatcher.js dev --port 6006 --ci --no-open > storybook.log 2>&1 < /dev/null &\necho $! > storybook.pid\n`,
  { timeoutMs: 10000 },
)
console.log('Launch commands completed', launch.exitCode)
for (const port of [6007, 6006]) {
  const ready = await sb.commands.run(
    `python3 - <<'PY'
import urllib.request,time
for i in range(120):
 try:
  print(urllib.request.urlopen('http://localhost:${port}/__clone_probe').read().decode());break
 except Exception:
  time.sleep(1)
else: raise RuntimeError('Server ${port} not ready')
PY`,
    { timeoutMs: 130000 },
  )
  console.log(port, ready.stdout)
}
