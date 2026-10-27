# E2B memory-clone verification

This optional experiment installs the packed fork into a fresh E2B sandbox,
warms Vite and Storybook, creates a full memory snapshot, and restores a second
sandbox. It verifies both running servers without restarting their inherited
processes. It is independent of Vite's normal test suite and package dependencies.

The completed run and its limits are recorded in [RESULTS.md](RESULTS.md).

## Run

Use an E2B account that supports snapshots. This creates two paid sandboxes and
a persistent snapshot; clean them up even if a verification phase fails.

From the Vite repository root:

```sh
corepack pnpm --filter vite build
mkdir -p temp/e2b-memory-clone
corepack pnpm --filter vite pack --pack-destination "$PWD/temp/e2b-memory-clone"
corepack pnpm --dir experiments/e2b-memory-clone install --frozen-lockfile
corepack pnpm --dir experiments/e2b-memory-clone exec playwright install chromium

export E2B_ENV_FILE=/absolute/path/to/your/.env
export VITE_CLONE_RUN_DIR="$PWD/temp/e2b-memory-clone-next"
export VITE_CLONE_ARTIFACT="$PWD/temp/e2b-memory-clone/vite-8.2.2.tgz"

node experiments/e2b-memory-clone/create.mjs
node experiments/e2b-memory-clone/setup.mjs
node experiments/e2b-memory-clone/verify.mjs
node experiments/e2b-memory-clone/cleanup.mjs
```

`E2B_API_KEY` can be supplied directly through the environment instead of an env
file. Only that key is read from `E2B_ENV_FILE`; it is not uploaded to the sandbox.
`E2B_SDK_PACKAGE_JSON` optionally locates an existing installation of
`@e2b/code-interpreter`, otherwise the experiment's pinned dependency is used.

`create.mjs` refuses to overwrite a run directory containing `state.json`.
Output includes state, phase results, process fingerprints, redacted request
routes and screenshots. `cleanup.mjs` kills only the two sandboxes recorded in
that run and deletes its recorded snapshot. Sandbox expiry is also bounded to
30 minutes when the run starts.

## What is asserted

- The installed Vite server bundle matches the locally built bundle byte for byte.
- In-memory markers survive the snapshot. Changing the clone's marker does not
  change the donor's marker.
- PIDs, process start ticks, launch UUIDs, startup timestamps and launch counts
  stay unchanged through every lifecycle phase. Clone processes retain the
  donor's startup sandbox identity.
- Both previews render their own content through one browser origin and
  `/_proxy/e2b/<sandbox>/<port>/` paths, despite a deliberately wrong routing cookie.
- Static, lazy, virtual and optimized imports, imported images, module/classic
  workers, injected/direct CSS, and late HTML imports stay functional.
- Independent JS, React and CSS edits preserve the existing document.
- Manual/full reloads and Vite socket reconnection preserve ownership, including
  another live edit after reconnect. Storybook's separate channel uses the
  existing browser-derived adapter.

The local gateway strips the explicit sandbox prefix and transports HTTP and
WebSocket traffic to E2B. It does not rewrite response bodies or restart servers.
The experiment does not invoke Fiddle's deployed allocator, readiness safeguard,
sync services or Cloudflare worker.
