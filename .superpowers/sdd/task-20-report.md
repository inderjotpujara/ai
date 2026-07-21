# Task 20 Report — `POST /api/jobs/:id/retry` + main.ts device/rotate security wiring (Slice 25b Ops Console)

**Status:** DONE. Commit `de97d6f` on `slice-25b-ops-console`.

## Part A — Retry endpoint (§11 lineage)

`src/server/jobs/retry.ts` → `handleJobRetry(id, deps: {jobStore, runsRoot})`:
- Loads the referenced job. Retryable set = `Failed`/`Canceled`/`Interrupted` only.
- Unknown id OR a non-retryable state (`Done`/`Queued`/`Running`) → **404** (terminal-mismatch
  collapses to 404, the same non-leaking idiom as detail/stream — a caller can't distinguish
  "no such job" from "not retryable"). The brief resolved the top-level "404 or 409" ambiguity to
  a uniform 404; implemented as 404.
- On success: mints a fresh `runId`, pre-creates the run dir (`createRun`, mirroring the enqueue
  path so an immediate `/api/runs/:runId/stream` never 404s), then
  `enqueue({kind, payload, retriedFrom: job.id, runId})` — `retriedFrom` uses the T1 `retried_from`
  column. Returns `202 JobLaunchResponse {jobId, runId}` (schema-parsed). `recordJobRetry` span emitted.
- Route wired in `app.ts` as `POST /api/jobs/:id/retry`, matched BEFORE the bare `/api/jobs/:id`
  detail and alongside `cancelMatch` (action-before-detail discipline). Behind the shared session
  guard — a job mutation like cancel, NOT trusted-local.

## Part B — SECURITY-CRITICAL main.ts wiring (audit CRITICAL-1 completion)

### The exact getter + same-instance construction (quoted)

Hoisted ONE `rootStore` above the auth `if/else` so pool/session-store/deps all share it:

```typescript
const rootStore =
  opts.rootTokens ??
  createRootTokenStore({
    path: opts.rootTokenPath ?? defaultRootTokenPath(),
  });
```

Session store in the standalone `else` branch uses a root GETTER (not a captured string):

```typescript
sessionTokens = createSessionTokenStore({
  path: opts.sessionRevocationPath ?? defaultRevocationPath(),
  rootToken: () => rootStore.getOrCreateRoot(), // GETTER: honours rotate() on the live store
});
```

And the SAME instance is passed as `deps.rootTokens`:

```typescript
deviceRegistry,
rootTokens: rootStore,
publicBaseUrl,
```

Invariant: the guard verifies via `deps.sessionTokens` whose getter re-reads
`rootStore.getOrCreateRoot()`; rotate-root calls `rootStore.rotate()` (same instance) → the getter
immediately sees the new root → every prior session token's HMAC sig stops verifying. With the old
captured-string bug (`rootToken: rootStore.getOrCreateRoot()`), rotate would return 200 while
revoked devices kept authenticating — the silent no-op this closes.

### Other deps wired
- `deviceRegistry = createDeviceRegistry({ path: opts.deviceRegistryPath ?? defaultDeviceRegistryPath() })`.
- `publicBaseUrl = opts.publicBaseUrl ?? ((cfg.AGENT_WEB_PUBLIC_URL as string) || \`http://${bind}:${port}\`)`
  (`??`/`||` parenthesized — mixing them unparenthesized is a syntax error).
- `AGENT_WEB_PUBLIC_URL` config row added to `src/config/schema.ts`.
- `StartOptions` gained `rootTokens?`, `deviceRegistryPath?`, `publicBaseUrl?` for test injection.
- `sessionTokens` + `policy` already threaded; the pair/revoke/rotate routes assemble their exact
  Deps via `need(...)` in app.ts (unchanged) — the optional ServerDeps fields now carry real values,
  so those routes stop 503-ing.

### One-pool / one-rootStore invariant
The daemon (`src/daemon/core.ts:118`) injects ONLY `queue: {jobStore, pool, concurrency}` — NOT
`sessionTokens`/`rootTokens`. So BOTH standalone and daemon boot flow through the same `else` branch;
wiring the getter there covers both. No second rootStore or session store is constructed.

## MANDATORY live rotate-invalidation test
`tests/server/rotate-invalidation.integration.test.ts` boots a REAL standalone `startWebServer`
(temp dirs, no injected session store = production path):
1. Pairs a device from loopback (POST /api/devices, 202) → device token.
2. Device token authenticates (GET /api/jobs → 200).
3. POST /api/security/rotate-root with the correct root secret → 200, re-minted local token.
4. Device token now → **401** (getter re-read the rotated root — the no-op-if-wired-wrong assertion).
5. Re-minted local token → **200** (operator's tab survives, anti-self-DoS).
6. Old local token → **401** (signed with the pre-rotate root, now dead).

Fails if the session store captured the root as a string or used a different rootStore than
`deps.rootTokens`. Passes → the wiring is correct.

## TDD RED/GREEN
- Retry: `tests/server/jobs/retry.test.ts` (5 tests incl. Canceled/Interrupted retryable,
  unknown→404, Queued→404) → implemented → GREEN (5 pass).
- Rotate wiring: live integration test → GREEN (1 pass, 6 assertions).

## Gate results
- `bun run typecheck` — clean.
- `bun run lint:file` on all 6 changed files — clean (biome auto-formatted 2 test/impl files).
- `bun test tests/server/ tests/queue/` — **429 pass, 0 fail** (92 files). Existing device/rotate
  route tests + auth-durable + main-ops-deps all green against the wired harness.

## Files changed
- `src/server/jobs/retry.ts` (new)
- `src/server/app.ts` (retry route + import)
- `src/server/main.ts` (hoisted rootStore + getter + deviceRegistry/rootTokens/publicBaseUrl deps + StartOptions)
- `src/config/schema.ts` (AGENT_WEB_PUBLIC_URL row)
- `tests/server/jobs/retry.test.ts` (new)
- `tests/server/rotate-invalidation.integration.test.ts` (new)

## Concerns
- `publicBaseUrl` loopback fallback uses the configured `port` at deps-construction time; when booted
  with `opts.port: 0` (tests) the fallback string reads `:0`. Harmless — it's only a display string
  for the pairing URL, and any real remote deployment sets `AGENT_WEB_PUBLIC_URL`.
- Task 20b (loopback-only local-token injection, §7.1b) is a SEPARATE task in the brief, NOT in this
  Task 20 scope — not implemented here.
- Docs surfaces (architecture.md/README/ROADMAP/ledger/Artifact) are the slice-landing gate's
  concern at increment close — not touched per-task.


---

# Task 20 Report — Generalize markDaemonOrigin + retry provenance carry (Slice 25 Triggers)

**Status:** DONE. Commit `5eba90d` on `slice-25-triggers`.

## What shipped
1. **Provenance generalization** (`src/server/jobs/dispatch.ts`): renamed
   `markDaemonOrigin(runsRoot, runId)` → `markJobOrigin(runsRoot, runId, origin)`.
   The `createJobDispatch` wrapper now passes `job.origin ?? RunOrigin.Daemon`, so a
   cron-fired run stamps `runs/<id>/origin=schedule`, webhook→`webhook`,
   file/chain→`api` (whatever `fire.ts` set), and a directly-enqueued job still
   defaults to `daemon` (unchanged). The runs `?origin=` facet (Slice 25b) then
   filters trigger-fired runs for free. `RunOrigin` already had Schedule/Webhook/Api
   — no enum change. `markDaemonOrigin` had no external callers (only comments in
   fire.ts:166 / daemon/spans.ts:42), so it was renamed cleanly, no alias needed.

2. **I6 carry** (`src/server/jobs/retry.ts`): the `handleJobRetry` re-enqueue now
   carries `origin: job.origin` and `chainDepth: job.chainDepth` forward. Previously
   a retried webhook/schedule job silently reset to daemon (dropped off the facet)
   and a chained job reset to chainDepth 0 (evading the A→B→A cap on its next hop —
   the T9 F1 finding: chainDepth must survive every hop incl. manual retry).

3. **app.ts `/hooks/:token` route:** NOT modified — already wired by a prior task
   (buildFetch lines 247-272, inside the perimeter, outside the /api session guard,
   with malformed-token→404 handling). Added `tests/server/app-hooks-route.test.ts`
   to lock the boundary the brief specified: forbidden Origin→403 (perimeter),
   loopback POST no-bearer unknown token→404 not 401 (outside session guard), GET
   falls through (POST-only).

## Tests
`bun test` (dispatch-origin + retry-origin + app-hooks-route + pre-existing
dispatch/retry/app/hooks-webhook): 54 pass, 0 fail. Broader sweep
`tests/server/jobs tests/triggers`: 149 pass, 0 fail. typecheck clean; lint clean.

New test files: `tests/server/dispatch-origin.test.ts` (Schedule/Webhook stamp +
Daemon default), `tests/server/jobs/retry-origin.test.ts` (webhook+chainDepth=2,
schedule+chainDepth=3, plain job stays undefined/0), `tests/server/app-hooks-route.test.ts`.

## Concerns
None. The app.ts deliverable in the brief was already complete from an earlier task;
the added route test closes the coverage gap the brief called for.
