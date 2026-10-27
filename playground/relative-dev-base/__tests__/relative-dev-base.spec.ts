import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import {
  gatewayUrl,
  requests,
  roots,
  servers,
  disconnectSockets,
} from './serve'
import { page, isBuild, extractSourcemap } from '~utils'

test.skipIf(isBuild)(
  'keeps files and live updates isolated under relocatable preview paths',
  async () => {
    const context = await page.context().browser()!.newContext()
    const a = await context.newPage()
    const b = await context.newPage()
    const moved = await context.newPage()
    const diagnostics: string[] = []
    for (const tab of [a, b, moved]) {
      tab.on('pageerror', (e) => diagnostics.push(e.message))
      tab.on('console', (e) => {
        if (e.type() === 'error') diagnostics.push(e.text())
      })
      tab.on('response', (r) => {
        if (r.status() >= 400) diagnostics.push(r.status() + ' ' + r.url())
      })
    }
    try {
      await context.addCookies([
        { name: 'e2b_sandbox', value: 'wrong:6007', url: gatewayUrl },
      ])
      await Promise.all([
        a.goto(gatewayUrl + '/_preview/a/'),
        b.goto(gatewayUrl + '/_preview/b/'),
      ])
      for (const [tab, label] of [
        [a, 'a'],
        [b, 'b'],
      ] as const) {
        await expect
          .poll(() => tab.textContent('#message'))
          .toBe(label + ':initial')
        expect(
          await tab.evaluate(() => document.documentElement.dataset.base),
        ).toBe('/_preview/' + label + '/')
        await expect.poll(() => tab.textContent('#lazy')).toBe('ready')
        await expect
          .poll(() => tab.textContent('#virtual'))
          .toBe('ready:function')
        await expect.poll(() => tab.textContent('#worker')).toBe('worker:ready')
        await expect
          .poll(() => tab.textContent('#classic'))
          .toBe('classic:ready')
        await expect
          .poll(() =>
            tab.evaluate(() => document.documentElement.dataset.preamble),
          )
          .toBe('ready')
        expect(
          await tab
            .locator('#image')
            .evaluate((el: HTMLImageElement) => el.naturalWidth),
        ).toBe(4)
        expect(
          await tab
            .locator('.background')
            .evaluate((el) => getComputedStyle(el).backgroundImage),
        ).toContain('/_preview/' + label + '/')
        await expect
          .poll(() =>
            tab.evaluate(() => document.querySelector('#message')?.textContent),
          )
          .toBe(label + ':initial')
      }
      const generated = await (
        await a.request.get(gatewayUrl + '/_preview/a/src/main.js')
      ).text()
      const original = await fs.readFile(
        path.join(roots[0], 'src/main.js'),
        'utf8',
      )
      const generatedLines = generated.split('\n')
      const line = generatedLines.findIndex((line) =>
        line.includes('source map marker'),
      )
      const position = originalPositionFor(
        new TraceMap(extractSourcemap(generated)),
        {
          line: line + 1,
          column: generatedLines[line].indexOf('source map marker'),
        },
      )
      expect(position.line).toBe(
        original
          .split('\n')
          .findIndex((line) => line.includes('source map marker')) + 1,
      )
      expect(position.source).toMatch(/main\.js$/)
      await Promise.all(
        [a, b].map((tab) =>
          tab.evaluate(() => {
            document.documentElement.dataset.keep = 'preserved'
          }),
        ),
      )
      await Promise.all(
        roots.map((root, i) =>
          fs.writeFile(
            path.join(root, 'src/message.js'),
            `export const message = '${i === 0 ? 'a' : 'b'}:updated'\n`,
          ),
        ),
      )
      await expect.poll(() => a.textContent('#message')).toBe('a:updated')
      await expect.poll(() => b.textContent('#message')).toBe('b:updated')
      await fs.writeFile(
        path.join(roots[0], 'src/style.css'),
        '.background { color: rgb(0, 0, 255); }\n',
      )
      await expect
        .poll(() =>
          a.locator('.background').evaluate((el) => getComputedStyle(el).color),
        )
        .toBe('rgb(0, 0, 255)')
      expect(
        await b
          .locator('.background')
          .evaluate((el) => getComputedStyle(el).color),
      ).toBe('rgb(255, 0, 0)')
      await fs.writeFile(
        path.join(roots[0], 'link.css'),
        'body { background-color: rgb(0, 128, 0); }\n',
      )
      await expect
        .poll(() =>
          a
            .locator('body')
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        )
        .toBe('rgb(0, 128, 0)')
      expect(
        await a.evaluate(() => document.documentElement.dataset.keep),
      ).toBe('preserved')
      expect(
        await b.evaluate(() => document.documentElement.dataset.keep),
      ).toBe('preserved')
      await moved.goto(gatewayUrl + '/_preview/moved/')
      await expect.poll(() => moved.textContent('#message')).toBe('a:updated')
      expect(
        await moved.evaluate(() => document.documentElement.dataset.base),
      ).toBe('/_preview/moved/')
      await Promise.all([a.reload(), b.reload()])
      await expect.poll(() => a.textContent('#message')).toBe('a:updated')
      await expect.poll(() => b.textContent('#message')).toBe('b:updated')
      await b.evaluate(() => {
        document.documentElement.dataset.keep = 'preserved'
      })
      const reloaded = a.waitForEvent('load')
      servers[0].ws.send({ type: 'full-reload', path: '/index.html' })
      await reloaded
      await expect.poll(() => a.textContent('#message')).toBe('a:updated')
      expect(
        await a.evaluate(() => document.documentElement.dataset.keep),
      ).toBeUndefined()
      expect(
        await b.evaluate(() => document.documentElement.dataset.keep),
      ).toBe('preserved')
      const reconnected = a.waitForEvent('load')
      const updateConnection = a.waitForEvent(
        'console',
        (message) => message.text() === '[vite] connected.',
      )
      disconnectSockets()
      await reconnected
      await updateConnection
      await expect.poll(() => a.textContent('#message')).toBe('a:updated')
      await fs.writeFile(
        path.join(roots[0], 'src/message.js'),
        "export const message = 'a:after-reconnect'\n",
      )
      await expect
        .poll(() => a.textContent('#message'))
        .toBe('a:after-reconnect')
      await expect.poll(() => b.textContent('#message')).toBe('b:updated')
      expect(diagnostics).toEqual([])
      expect(servers).toHaveLength(2)
      expect(
        requests.filter(
          (url) => !url.startsWith('/_preview/') && url !== '/favicon.ico',
        ),
      ).toEqual([])
    } catch (error) {
      throw new Error(
        String(error) +
          '\n' +
          JSON.stringify({ diagnostics, requests }, null, 2),
      )
    } finally {
      await context.close()
    }
  },
)

test.skipIf(isBuild)(
  'soft invalidation refreshes a transitive dependency without reloading',
  async () => {
    const tab = await page.context().browser()!.newPage()
    try {
      await tab.goto(gatewayUrl + '/_preview/a/soft.html')
      await expect
        .poll(() => tab.textContent('#soft'))
        .toBe('initial dependency')
      await tab.evaluate(() => (document.documentElement.dataset.keep = 'yes'))
      await fs.writeFile(
        path.join(roots[0], 'src/soft-child.js'),
        "export const value = 'updated dependency'\n",
      )
      await expect
        .poll(() => tab.textContent('#soft'))
        .toBe('updated dependency')
      expect(
        await tab.evaluate(() => document.documentElement.dataset.keep),
      ).toBe('yes')
    } finally {
      await tab.close()
    }
  },
)

test.skipIf(isBuild)(
  'dot-prefixed source names remain relative specifiers',
  async () => {
    const tab = await page.context().browser()!.newPage()
    try {
      await tab.goto(gatewayUrl + '/_preview/a/hidden.html')
      await expect
        .poll(() => tab.textContent('#hidden'))
        .toBe('hidden:generated')
    } finally {
      await tab.close()
    }
  },
)

test.skipIf(isBuild)(
  'absolute virtual module assets use the served module URL',
  async () => {
    const tab = await page.context().browser()!.newPage()
    try {
      await tab.goto(gatewayUrl + '/_preview/a/virtual.html')
      await expect
        .poll(() =>
          tab
            .locator('#virtual-image')
            .evaluate((el: HTMLImageElement) => el.naturalWidth),
        )
        .toBe(4)
      expect(await tab.locator('#virtual-image').getAttribute('src')).toContain(
        '/_preview/a/tile.svg',
      )
    } finally {
      await tab.close()
    }
  },
)

test.skipIf(isBuild)(
  'fallback HTML CSS resolves against the loaded document',
  async () => {
    const tab = await page.context().browser()!.newPage()
    try {
      await tab.goto(gatewayUrl + '/_preview/a/nested/route')
      for (const selector of ['.inline-background', '#inline-attr']) {
        expect(
          await tab
            .locator(selector)
            .evaluate((el) => getComputedStyle(el).backgroundImage),
        ).toContain('/_preview/a/tile.svg')
      }
    } finally {
      await tab.close()
    }
  },
)

test.skipIf(isBuild)(
  'CSS asset URLs survive punctuation in the preview prefix',
  async () => {
    const tab = await page.context().browser()!.newPage()
    try {
      const loadedAsset = tab.waitForResponse(
        (response) =>
          response.url().includes('tile.svg') &&
          !response.url().includes('import'),
      )
      await tab.goto(gatewayUrl + '/_preview/a(quoted)/prefix.html')
      expect((await loadedAsset).status()).toBe(200)
      await expect
        .poll(() =>
          tab
            .locator('.prefix-background')
            .evaluate((el) => getComputedStyle(el).backgroundImage),
        )
        .not.toBe('none')
    } finally {
      await tab.close()
    }
  },
)

test.skipIf(isBuild).each([
  ['a', 'alias.html', 'direct-alias.html'],
  ['b', 'direct-alias.html', 'alias.html'],
])(
  'shared module aliases retain imports and BASE_URL in request order %s',
  async (label, first, second) => {
    const tab = await page.context().browser()!.newPage()
    const file = path.join(roots[label === 'b' ? 1 : 0], 'src/alias-entry.js')
    const original = await fs.readFile(file, 'utf8')
    try {
      const redirect = await tab.request.get(
        gatewayUrl +
          '/_preview/' +
          label +
          '/alias.js?import&t=123&custom=kept',
        { maxRedirects: 0 },
      )
      expect(redirect.status()).toBe(307)
      const location = redirect.headers().location
      expect(location.startsWith('./src/alias-entry.js?')).toBe(true)
      const query = new URL(location, gatewayUrl).searchParams
      expect(query.has('import')).toBe(true)
      expect(query.get('t')).toBe('123')
      expect(query.get('custom')).toBe('kept')
      await tab.goto(gatewayUrl + '/_preview/' + label + '/' + first)
      await expect
        .poll(() => tab.textContent('#alias'))
        .toBe('ready:/_preview/' + label + '/')
      const connected = tab.waitForEvent(
        'console',
        (message) => message.text() === '[vite] connected.',
      )
      await tab.goto(gatewayUrl + '/_preview/' + label + '/' + second)
      await connected
      await expect
        .poll(() => tab.textContent('#alias'))
        .toBe('ready:/_preview/' + label + '/')
      await tab.evaluate(() => {
        document.documentElement.dataset.keep = 'yes'
      })
      await fs.writeFile(
        file,
        original.replace("stable + ':'", "stable + ':updated:'"),
      )
      await expect
        .poll(() => tab.textContent('#alias'))
        .toBe('ready:updated:/_preview/' + label + '/')
      expect(
        await tab.evaluate(() => document.documentElement.dataset.keep),
      ).toBe('yes')
    } finally {
      await fs.writeFile(file, original)
      await tab.close()
    }
  },
)

test.skipIf(isBuild)(
  'late inline style serialization preserves quote delimiters and literal entities',
  async () => {
    const tab = await page.context().browser()!.newPage()
    try {
      await tab.goto(gatewayUrl + '/_preview/a/')
      for (const id of ['initial-entity-style', 'entity-style']) {
        expect(await tab.locator('#' + id).getAttribute('style')).toContain(
          'literal=&copy;',
        )
        expect(await tab.locator('#' + id).getAttribute('data-preserved')).toBe(
          'yes',
        )
        expect(
          await tab
            .locator('#' + id)
            .evaluate((el) => getComputedStyle(el).backgroundImage),
        ).toContain('literal=&copy;')
      }
    } finally {
      await tab.close()
    }
  },
)

test.skipIf(isBuild)(
  'accepted virtual dependencies update through their existing graph node',
  async () => {
    const tab = await page.context().browser()!.newPage()
    const file = path.join(roots[0], 'src/virtual-hmr-child.js')
    const original = await fs.readFile(file, 'utf8')
    try {
      const connected = tab.waitForEvent(
        'console',
        (message) => message.text() === '[vite] connected.',
      )
      await tab.goto(gatewayUrl + '/_preview/a/virtual-hmr.html')
      await connected
      await expect
        .poll(() => tab.textContent('#virtual-hmr'))
        .toBe('virtual initial')
      await tab.evaluate(() => {
        document.documentElement.dataset.keep = 'yes'
      })
      await fs.writeFile(
        file,
        original.replace('virtual initial', 'virtual updated'),
      )
      await expect
        .poll(() => tab.textContent('#virtual-hmr'))
        .toBe('virtual updated')
      expect(
        await tab.evaluate(() => document.documentElement.dataset.keep),
      ).toBe('yes')
    } finally {
      await fs.writeFile(file, original)
      await tab.close()
    }
  },
)

test.skipIf(isBuild).each([
  ['percent-alias.js', 'literal percent'],
  ['encoded-percent-alias.js', 'literal percent20'],
])(
  'alias %s preserves literal percent characters in the resolved filename',
  async (alias, expected) => {
    const tab = await page.context().browser()!.newPage()
    try {
      await tab.goto(gatewayUrl + '/_preview/a/alias.html')
      expect(
        await tab.evaluate(
          `import(${JSON.stringify(gatewayUrl + '/_preview/a/' + alias)}).then(mod => mod.default)`,
        ),
      ).toBe(expected)
    } finally {
      await tab.close()
    }
  },
)
