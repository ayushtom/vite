import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(
  process.env.E2B_SDK_PACKAGE_JSON ||
    new URL('./package.json', import.meta.url),
)
export const { Sandbox } = require('@e2b/code-interpreter')
const envFile = process.env.E2B_ENV_FILE
  ? fs.readFileSync(process.env.E2B_ENV_FILE, 'utf8')
  : ''
const key =
  /^\s*(?:export\s+)?E2B_API_KEY\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#]+))/m.exec(
    envFile,
  )
export const apiKey = process.env.E2B_API_KEY || key?.slice(1).find(Boolean)
if (!apiKey) throw Error('Set E2B_API_KEY or E2B_ENV_FILE')
export const runDir = path.resolve(
  process.env.VITE_CLONE_RUN_DIR ||
    fileURLToPath(new URL('../../temp/e2b-memory-clone', import.meta.url)),
)
fs.mkdirSync(runDir, { recursive: true })
export const runFile = (name) => path.join(runDir, name)
export const artifactPath = path.resolve(
  process.env.VITE_CLONE_ARTIFACT || runFile('vite-8.2.2.tgz'),
)
