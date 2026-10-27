import fs from 'node:fs/promises'
import { Sandbox, apiKey, runFile } from './sdk.mjs'

const state = JSON.parse(await fs.readFile(runFile('state.json'), 'utf8'))
const cleanup = { completedAt: new Date().toISOString(), sandboxes: [] }
for (const id of [state.clone, state.donor].filter(Boolean)) {
  try {
    const sandbox = await Sandbox.connect(id, { apiKey })
    await sandbox.kill()
    cleanup.sandboxes.push({ id, killed: true })
  } catch (error) {
    cleanup.sandboxes.push({ id, killed: false, error: error.message })
    process.exitCode = 1
  }
}
if (state.snapshot) {
  try {
    cleanup.snapshot = {
      id: state.snapshot,
      deleted: await Sandbox.deleteSnapshot(state.snapshot, { apiKey }),
    }
  } catch (error) {
    cleanup.snapshot = {
      id: state.snapshot,
      deleted: false,
      error: error.message,
    }
    process.exitCode = 1
  }
}
await fs.writeFile(runFile('cleanup.json'), JSON.stringify(cleanup, null, 2))
console.log(JSON.stringify(cleanup, null, 2))
