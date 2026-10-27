import path from 'node:path'
import { cleanUrl, wrapId } from '../shared/utils'
import type { ResolvedConfig } from './config'
import type { Environment } from './environment'
import { resolvedIdToModuleUrl } from './server/moduleUrl'

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
    resolvedIdToModuleUrl(environment, id)
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
