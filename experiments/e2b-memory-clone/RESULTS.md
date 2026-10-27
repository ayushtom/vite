# Real E2B memory-clone result — 2026-10-27

**Passed all 11 lifecycle phases. No inherited server was restarted after the
snapshot or during verification. No Vite code fix was needed.**

- Core patch: `0a4727045d0a01103d530b6654ec3999e6514c5f` (Vite8.2.2 fork).
- Donor: `if47pml5e0kwzuhfj26kp`.
- Clone: `i67zs4grrlm0l4s5mdac5`.
- Full memory snapshot: `w03zlf8eeuh0ytxb0dcq:default`.
- Run:18:17:17–18:18:52 IST (12:47:17–12:48:52 UTC).
- Sandbox runtime: Linux x86_64, Node20.20.2; Storybook10.4.6 / React19.2.3.
- Plain Vite port6007 and real Storybook port6006, both installed from the actual
  patched npm tarball. The installed server bundle's SHA256 matched the local
  build. Both donor browsers were open and warmed before the snapshot.

| Process   | PID in donor and clone | Start ticks | Launch count throughout tested lifecycle |
| --------- | ---------------------- | ----------- | ---------------------------------------- |
| Vite      | 1763                   | 22184       | 1                                        |
| Storybook | 1844                   | 45139       | 2                                        |

The Storybook count is2 because its separate host allowlist was corrected and
the donor Storybook restarted during initial setup, **before warming or taking
any snapshot**. The fingerprint used for all comparisons was captured after
that setup. Its launch count never increased during or after cloning.

Random launch UUIDs and startup timestamps also remained identical. Both clone
processes still reported the donor's `E2B_SANDBOX_ID` and `VITE_CLONE_DONOR`.
An HTTP-seeded marker held only in process memory survived in each cloned
process. Updating that marker through the clone's address left the donor's
marker unchanged. This demonstrates memory restoration and independent runtime
ownership, rather than a filesystem-only copy or requests falling back to A.

Passed:

1. Exact package-bundle hash and baseline process identity.
2. Warm donor Vite and Storybook previews through explicit proxy paths.
3. Full memory snapshot and creation of a new sandbox from it.
4. Clone file edits and both inherited previews rendering distinct content.
5. Independent JS and React Storybook HMR, preserving each existing document.
6. Injected and linked CSS updates, preserving the document.
7. Manual reloads after opening the sibling preview.
8. Server-requested full reloads without reloading the sibling runtime.
9. Disconnecting each Vite socket, reconnecting, then applying another live edit.
10. Storybook Alternate state and return to the correct Default state.
11. Final HTTP/socket ownership and screenshots.

The browser used one local origin and production-shaped
`/_proxy/e2b/<sandbox>/<port>/...` URLs with a deliberately wrong shared routing
cookie. Captured473 HTTP requests and42 WebSocket connections, with no captured
failed HTTP responses, unscoped requests or browser errors. The socket check
included Storybook's distinct browser-derived channel path. Reconnection was
forced on Vite sockets; this is not an exhaustive outage test of Storybook's
separate channel transport.

Final visible headings:

| Preview   | Donor                                        | Clone                                        |
| --------- | -------------------------------------------- | -------------------------------------------- |
| Vite      | donor:initial updated reconnected            | clone:initial updated reconnected            |
| Storybook | Local relative Storybook updated reconnected | Clone relative Storybook updated reconnected |

Initial setup hit an npm10 dependency-resolution error; pnpm10.34.5 installed
successfully. The first public Storybook probe returned403 until its separate
`core.allowedHosts` setting permitted E2B hosts. These setup corrections happened
before any snapshot; no inherited server was restarted to obtain the result.

## Package and adoption

The exact tested artifact is saved locally as
`temp/e2b-memory-clone/vite-8.2.2-fiddle.0a47270.tgz`. SHA256:

```text
b8fbfc7b8c8ef9283ea1214be09cd4093adb6ab4c2f36666fbba1fe60aa04364
```

The filename identifies the fork commit; its npm manifest still identifies
`vite@8.2.2`, preserving existing peer ranges. It is a locally packed artifact,
not a registry publication. A manifest with SHA512 integrity and a checksum file
sit beside it. No fork release/tag/asset was published during this test.

Install this in the generated **preview workspace**. Supabase's current
`packages/storybook/package.json` already uses Vite8.2.2; replacing that dependency
with the immutable fork artifact and updating the lockfile is the relevant
installation path. Configure `base: './'` and
`experimental.relativeDevBase: true`, remove startup-fixed origin/socket address
overrides, and preserve Storybook's middleware socket server and channel adapter.
No Fiddle web application dependency migration is needed.
The generated runtime wrapper must also honor this opt-in configuration rather
than reapplying legacy fixed base/host overrides. Installing the package alone
does not alter that wrapper.

A clean shared distribution is a built tarball attached to a tagged release of
`ayushtom/vite`, then pinned by URL and lockfile integrity in each workspace.
Vite's raw Git repository is a monorepo and omits generated `dist`; a plain root
Git dependency is not the installable package. Scope any deduplication override
to that workspace and its compatible preview dependencies.

Evidence remains in the ignored `temp/e2b-memory-clone/` run directory:
`result.json`, `state.json`, `routes.json`, four final screenshots, artifact
manifest/checksum and `cleanup.json`. The reusable experiment is in this folder.
After preserving the evidence, both test sandboxes were killed and their
persistent snapshot deleted; all three cleanup operations succeeded.

## Limits

This closes the real memory-clone gap for these controlled Vite and Storybook
fixtures. The browser used a local path-stripping gateway and real remote E2B
sandboxes; it did not exercise the deployed Fiddle worker, allocator/readiness
guard or sync system, nor the full Supabase catalog. Keep the production runtime
identity safeguard until that workspace integration is separately verified.
Complete source-map fidelity is still not audited. E2B briefly pauses a sandbox
to take its memory snapshot; a platform pause is distinct from restarting the
Node processes.
