# Relative URLs during development

An opt-in mode, `experimental.relativeDevBase`, on top of Vite 8.3.8
(`b39e6e63d`).

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  experimental: { relativeDevBase: true },
})
```

## The issue

The dev server writes root-absolute URLs into everything it serves:
`/src/main.ts`, `/@vite/client`, `/@fs/...`, `/@id/...`, asset URLs in CSS and
the HMR socket address. `base` is the only way to prefix them, and it applies
both to the URLs Vite generates and to the paths the dev server answers on. It
also has to be known when the server starts.

That makes one common deployment impossible: a reverse proxy that exposes the
dev server below a path prefix and strips that prefix before forwarding. With
`base: '/'` the page asks for `/src/main.ts`, which never reaches the proxy
route. With `base: '/prefix/'` the page asks for the right URL, but Vite then
expects the prefix on the request the proxy has already stripped. A relative
`base` (`'./'` or `''`) is honoured by `vite build` only; in development it is
treated as `/`.

This is the request tracked upstream in
[vitejs/vite#19980](https://github.com/vitejs/vite/issues/19980), "Allow to use
different `base` for dev server and generated import paths". The advice there
is to configure the proxy to keep the prefix, or to add a plugin that strips
the base from incoming requests. Both still need the prefix fixed in the Vite
config before the server starts, so neither covers a prefix that is only known
to the proxy, or one server reached through several prefixes.

## The fix

With the option on, the server keeps answering on root paths and keeps its
module graph unchanged, but every URL it sends to the browser is written
relative to the document or module that references it. The browser resolves
those against whatever URL it loaded, so the same running server works below
any prefix, and below several prefixes at once, with no prefix in its config.

Vite 8.3 separates a module's URL in the graph (ModuleURL) from the URL sent to
the browser (BrowserURL). The option only changes the second: after a
BrowserURL is produced, `relativeDevUrl` rewrites it against the importer's
URL. Server-side module IDs, HMR identities and transform caches are untouched.

What is rewritten:

- HTML entry URLs, inline module proxies and imports that HTML plugins inject.
- Static and dynamic imports, virtual modules and optimized dependencies.
- Imported asset exports and `new URL(..., import.meta.url)`.
- CSS: `url()` and `image-set()` in stylesheets requested directly, and in CSS
  injected from modules. Injected CSS computes asset URLs in the browser,
  because its base differs from the stylesheet's own location.
- Module and classic workers, including the environment module they import.
- `import.meta.env.BASE_URL`, which follows the loaded prefix unless it is set
  with `define`.
- The client: its socket address, update imports, CSS link replacement,
  full-reload matching and reconnection all derive from the URL the client
  itself was loaded from. Falling back to a direct server address is disabled,
  so a page cannot reconnect to an address it was not served from.

Two supporting changes keep one module from being transformed twice:

- A request for an alternate URL of a module (for example its `/@fs/` path when
  it also has a root-relative one) is redirected to the canonical URL. The
  `Location` is relative, so the proxy prefix survives, along with query flags
  and literal percent characters in file names.
- Soft invalidation resolves a relative import back to its graph URL before
  looking the module up.

Rewritten HTML attributes are serialized from decoded values, escaping
ampersands and both quoted and unquoted delimiters. That also covers inline
styles transformed before and after HTML plugins. Authored CSS content is
preserved when asset URLs are substituted into injected CSS.

## Limits

- Defaults and `vite build` are unchanged.
- Requires `base: './'` or `''` and unbundled development. It is rejected
  together with `server.origin`, with `experimental.bundledDev`, and with fixed
  WebSocket `host`, `port`, `clientPort` or `protocol`. `server.ws.path` and
  `server.ws.server` remain available.
- The proxy must forward WebSocket upgrades below the same prefix.
- Not rewritten: application API requests, intentionally external URLs,
  strings built at runtime, untransformed files in `public`, import-map values
  and custom plugin protocols.
- An authored `<base href>` changes how relative URLs resolve and needs its own
  review.
- Source maps go through the existing pipeline; no separate audit of their
  `sources` under a prefix was done.

## Verification

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm --filter vite typecheck
corepack pnpm test-unit
corepack pnpm test-serve --maxWorkers=3
corepack pnpm test-serve relative-dev-base --maxWorkers=1
```

Run the browser suites one at a time; their global setup owns the shared
`playground-temp` directory.

`playground/relative-dev-base` starts two independent dev servers behind a
local prefix-stripping proxy that rejects any request outside its prefixes and
carries a deliberately wrong routing cookie. It checks nested lazy, virtual and
dependency imports, image and CSS URLs, module and classic workers,
plugin-injected imports, JS and CSS updates without a document reload, direct
CSS replacement, a second prefix for an already running server, manual and
server-requested reloads, socket reconnection and an edit after reconnecting.
Further cases cover transitive soft invalidation, dotfile imports, absolute
asset URLs from virtual modules, inline CSS on SPA fallback pages, redirect
encoding and preserved authored CSS.

On this branch: `relative-dev-base` 13 of 13, the full `test-serve` suite and
`test-unit` pass, and `typecheck` is clean.
