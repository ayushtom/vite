# Relative URLs during development

Local prototype on `ayush/relative-dev-urls`, based on upstream Vite 8.2.2
(`de1111ab0be00879b404e7ed3b2a80e264edddc1`). Personal fork:
https://github.com/ayushtom/vite.

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  experimental: { relativeDevBase: true },
})
```

This opt-in mode lets a path-stripping reverse proxy serve the same running Vite
server below different browser URL prefixes. It emits browser-relative module
references and derives the update client's external base from its own loaded
URL. The server keeps its canonical module URLs and HMR graph. No sandbox ID,
routing cookie, or per-request mutation of Vite configuration is required.

For example, the proxy can expose `/preview/a/` and `/preview/moved/`, stripping
either prefix before forwarding HTTP and WebSocket requests to Vite. Both
locations work without restarting Vite. Separate runtimes can use separate
prefixes on that same proxy.

## What changes

- HTML entry URLs, inline module proxies and imports injected by HTML plugins.
- Static/dynamic module imports, virtual modules and optimized dependencies.
- Imported asset exports, `new URL(..., import.meta.url)`, direct CSS and CSS
  injected from modules. Injected CSS uses browser-computed asset URLs because
  its base differs from the original stylesheet's location.
- Module/classic workers and their environment-module imports.
- `import.meta.env.BASE_URL` follows the loaded browser prefix unless explicitly
  overridden with `define`. Server-side environment handling remains unchanged.
- Vite's socket, update imports, CSS link replacements, full-reload matching and
  reconnection use the loaded client's preview prefix. Direct-address fallback
  is disabled in this mode so it cannot reconnect to an inherited server address.
- Alternate served URLs for the same resolved module redirect to one canonical
  browser URL. The relative redirect preserves the proxy prefix, query flags and
  literal percent characters in filenames. Vite still caches one transform per
  resolved ID. Built-in client paths and unwrapped internal virtual-module URLs
  retain Vite's existing conventions.
- Rewritten HTML attributes are serialized from decoded values with escaping
  for ampersands and quoted/unquoted delimiters. This also applies to inline
  styles transformed before and after HTML plugins.

Defaults and production build behavior are unchanged. This prototype requires
unbundled development and `base: './'` or `''`. It rejects `server.origin`, fixed
WebSocket host/port/protocol overrides and bundled client environments. A proxy
must forward WebSocket upgrades under the same external prefix; `server.ws.path`
and `server.ws.server` remain available for an explicit path or middleware host.

Application API requests and intentionally external URLs are not rewritten.
Arbitrary JavaScript runtime strings, untransformed public files, import-map
values and custom plugin protocols are not a general relocation API. Source
maps use the existing Vite pipeline; a complete source-map fidelity audit is not
claimed. An authored `<base href>` can change relative URL resolution and needs
integration-specific review.

## Local verification

Use the repository's pnpm version via Corepack:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter vite build
corepack pnpm test-unit
corepack pnpm test-serve --maxWorkers=3
corepack pnpm test-build --maxWorkers=3
corepack pnpm test-serve-bundled --maxWorkers=3
corepack pnpm --filter vite typecheck
```

Run browser suites sequentially: their global setup owns the shared
`playground-temp` directory. The focused check is
`corepack pnpm test-serve relative-dev-base --maxWorkers=1`.

The browser fixture starts two independent runtimes and a local proxy. It uses
a deliberately wrong shared routing cookie and rejects requests outside the
preview prefixes. It verifies nested lazy/virtual/dependency imports, image/CSS
URLs, module and classic workers, plugin-injected imports, independent JS/CSS
updates without reloading the document, direct CSS replacement, a new prefix for
the same running server, manual/server-requested reloads, socket reconnection,
and an edit after reconnect. The test failed on unpatched Vite before changing
production code.

Review-driven regressions cover transitive soft invalidation, dotfile imports,
absolute virtual-module asset URLs, SPA-fallback inline CSS, CSS asset URLs under
a parenthesized prefix, shared module aliases in both request orders, query
preservation, alias HMR, initial/late inline-style entities, dependency acceptance
through a virtual module, and literal `%` / `%20` filenames. Each reported defect
was reproduced before its fix. The reconnection test waits for Vite's connected
message before editing, so it checks live updates after the connection is ready.

The separate architectural review agreed that canonical URLs and relative
browser serialization fit Vite's transform-cache model. It identified the alias
cache, HTML serialization and redirect encoding defects. The real Storybook
check additionally exposed the virtual-module representation mismatch; a minimal
browser regression now checks that acceptance updates without replacing the
document. This is a local engineering assessment, not approval from Vite's
maintainers.

This fixture proves local relocation and isolation. A separate
[real E2B memory-clone run](experiments/e2b-memory-clone/RESULTS.md) now also
passes Vite and Storybook preview/HMR/reload/reconnect checks without restarting
their inherited servers. This does not prove the full deployed Fiddle integration
or replace the existing runtime identity safeguard. Storybook's separate
server-channel socket also needs its existing Fiddle adapter; Vite does not own
that channel.

A supplementary local Storybook 10.4.6 / React sample lives in the ignored
`temp/storybook-relative/` directory. Its configuration links the patched Vite,
preserves Storybook's middleware WebSocket server while dropping fixed browser
port overrides, and adapts Storybook's own channel to the local preview prefix.
This sample is diagnostic material, not a published package or Fiddle change.

## Results from this local run

- Full Vite package build and typecheck passed.
- Unit suite: 68 files, 941 passed, 3 skipped.
- Full development browser suite: 92 files passed, 17 skipped; 1,140 tests
  passed, 167 skipped.
- Full production-build browser suite: 93 files passed, 15 skipped; 923 tests
  passed, 295 skipped.
- Full bundled-development browser suite: 70 files passed, 18 skipped; 659 tests
  passed, 227 skipped. Existing upstream bundled-mode exclusions remain.
- Relative-mode fixture: 12 browser tests passed, including true HMR checks
  that assert the existing document survives the edit.
- The new mode also checks a generated JavaScript source-map position against
  its original source line.
- Changed-file lint and formatting passed.
- Supplementary Storybook sample: Default and Alternate rendered under two
  prefixes; changing the Default heading preserved the document and the
  Alternate state; both reloaded correctly; imported SVG loaded; no captured
  failed HTTP responses, browser exceptions or unscoped HTTP requests. Both
  Vite and Storybook sockets used their respective preview prefixes.

Two earlier full bundled runs timed out on different existing tests: JSON reload
and a Lightning CSS Sass update. Both had 658 passed, 1 failed and 227 skipped.
The focused JSON rerun passed 10 tests; an unmodified upstream v8.2.2 build passed
its full bundled suite (647 passed, 227 skipped, excluding the new fixture). The
final patched build then passed the full suite (659 passed, 227 skipped) with
three workers and no retries. These intermittent failures were not consistently
reproduced or attributed; no unrelated implementation or test was changed to
hide them. The final results above are from the patched build after restoring it
from the temporary upstream comparison.

Storybook evidence: `temp/storybook-relative/result.json`. This is one Storybook
server exposed at two prefixes; the committed Vite fixture separately tests two
independent servers. Neither is an E2B memory-clone test. An initial diagnostic attempt timed out while the middleware/socket setup was
being corrected. After preserving the old Storybook optimization cache and
starting with a fresh cache, the complete two-prefix lifecycle check passed
again. The final alias fix temporarily introduced a virtual-module graph mismatch
that the Storybook edit check caught; the accepted-virtual-dependency regression
reproduced it, and both checks passed after restoring Vite's unwrapped virtual
graph URLs. These are functional checks, not startup-performance measurements.

The implementation remains local on this branch; no patch was pushed or
published and no existing Fiddle runtime, repository, or deployment was modified.
The E2B experiment created its own fresh donor and clone, then cleaned up both
sandboxes and their snapshot after preserving the evidence.

## Install in generated preview workspaces

The install target is each generated workspace's Storybook/preview package, such
as Supabase's `packages/storybook/package.json`, which already uses Vite8.2.2.
Replace its Vite dependency with the pinned fork tarball, update its lockfile,
and enable the relative development configuration above. Keep `vite` imports
and existing Storybook commands. Preserve the middleware WebSocket server and
the separate Storybook channel adapter while removing startup-fixed browser
origin/socket address overrides. This does not require changing Fiddle's web
application build tool.
The generated runtime wrapper must preserve the opt-in relative base and socket
configuration rather than reapplying its legacy fixed address overrides.

The exact E2B-tested package is saved locally as
`temp/e2b-memory-clone/vite-8.2.2-fiddle.0a47270.tgz`, with a SHA256 checksum and
SHA512-integrity manifest beside it. Its package metadata stays `vite@8.2.2`;
the artifact filename and hash identify the fork. Nothing has been published to
a registry or GitHub release. For shared installs, build from a pinned fork
commit and attach the tarball to a tagged fork release; consumers can pin that
release asset URL. Vite's repository root is a monorepo, and generated `dist`
files are not committed, so a plain root Git dependency does not supply this
installable artifact. Scope any deduplication override to the target preview
workspace and its compatible Vite dependencies.
