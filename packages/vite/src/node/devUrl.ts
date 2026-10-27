import path from 'node:path'
import fs from 'node:fs'
import type { PartialResolvedId } from 'rolldown'
import { cleanUrl, wrapId, withTrailingSlash } from '../shared/utils'
import type { ResolvedConfig } from './config'
import { FS_PREFIX } from './constants'
import type { DevEnvironment } from './server/environment'
import type { Environment } from './environment'

/** Keep module graph IDs canonical; only browser-facing references are relative. */
export function relativeDevUrl(
  config: ResolvedConfig,
  url: string,
  importerUrl: string,
): string {
  if (
    config.command !== 'serve' ||
    !config.experimental.relativeDevBase ||
    !url.startsWith('/') ||
    url.startsWith('//')
  ) {
    return url
  }
  const pathname = cleanUrl(url)
  const importer = cleanUrl(
    importerUrl.startsWith('/') ? importerUrl : wrapId(importerUrl),
  )
  const directory = importer.endsWith('/')
    ? importer
    : path.posix.dirname(importer)
  const relative = path.posix.relative(directory, pathname)
  return (
    (relative.startsWith('./') || relative.startsWith('../')
      ? relative
      : './' + relative) + url.slice(pathname.length)
  )
}

/** Use the actual served URL; loading hooks can fall back to Vite's canonicalizer. */
export function devUrlForId(environment: Environment, id: string): string {
  if (environment.mode !== 'dev')
    throw new Error('Development URL requested outside development')
  return (
    environment.moduleGraph.getModuleById(id)?.url ??
    normalizeResolvedIdToUrl(environment, id, { id })
  )
}

/** Resolve emitted relative references only for canonical graph lookups. */
export function resolveRelativeDevUrl(
  url: string,
  importerUrl: string,
): string {
  if (!url.startsWith('./') && !url.startsWith('../')) return url
  const importer = importerUrl.startsWith('/')
    ? importerUrl
    : wrapId(importerUrl)
  const pathname = cleanUrl(url)
  return (
    path.posix.resolve(path.posix.dirname(cleanUrl(importer)), pathname) +
    url.slice(pathname.length)
  )
}

export function normalizeResolvedIdToUrl(
  environment: DevEnvironment,
  url: string,
  resolved: PartialResolvedId,
): string {
  const root = environment.config.root
  const depsOptimizer = environment.depsOptimizer

  // normalize all imports into resolved URLs
  // e.g. `import 'foo'` -> `import '/@fs/.../node_modules/foo/index.js'`
  if (resolved.id.startsWith(withTrailingSlash(root))) {
    // in root: infer short absolute path from root
    url = resolved.id.slice(root.length)
  } else if (
    depsOptimizer?.isOptimizedDepFile(resolved.id) ||
    // vite-plugin-react isn't following the leading \0 virtual module convention.
    // This is a temporary hack to avoid expensive fs checks for React apps.
    // We'll remove this as soon we're able to fix the react plugins.
    (resolved.id !== '/@react-refresh' &&
      path.isAbsolute(resolved.id) &&
      fs.existsSync(cleanUrl(resolved.id)))
  ) {
    // an optimized deps may not yet exists in the filesystem, or
    // a regular file exists but is out of root: rewrite to absolute /@fs/ paths
    url = path.posix.join(FS_PREFIX, resolved.id)
  } else {
    url = resolved.id
  }

  // if the resolved id is not a valid browser import specifier,
  // prefix it to make it valid. We will strip this before feeding it
  // back into the transform pipeline
  if (url[0] !== '.' && url[0] !== '/') {
    url = wrapId(resolved.id)
  }

  return url
}
