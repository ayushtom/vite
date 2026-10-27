import fs from 'node:fs/promises'
import { Sandbox, apiKey, runFile } from './sdk.mjs'
try {
  await fs.access(runFile('state.json'))
  throw Error(
    'This run directory already has state.json; clean up that run and choose a new VITE_CLONE_RUN_DIR',
  )
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const sandbox = await Sandbox.create({
  apiKey,
  timeoutMs: 1800000,
  metadata: {
    purpose: 'vite-relative-memory-clone-0a47270',
    owner: 'ayushtom',
  },
})
await fs.writeFile(
  runFile('state.json'),
  JSON.stringify(
    { donor: sandbox.sandboxId, donorHost: sandbox.getHost(6007), port: 6007 },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({ donor: sandbox.sandboxId, host: sandbox.getHost(6007) }),
)
const result = await sandbox.commands.run(
  'node --version && npm --version && uname -m && python3 --version',
)
console.log(result.stdout)
