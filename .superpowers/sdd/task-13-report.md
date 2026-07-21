# Task 13 Report — `device-registry.ts` (persisted positive device list)

## Status: DONE

Commit `1fa220f` — `feat(security): persisted positive device registry (Slice 25b Incr 3, D4)`.

## Registry API (`src/server/security/device-registry.ts`)
- `DeviceRecord = { deviceId, label, createdAt, exp }` — aligns exactly with `DeviceDtoSchema` in `src/contracts/dto.ts` (T4). No token field anywhere.
- `createDeviceRegistry({ path? }): DeviceRegistry`, default path `~/.agent/devices.json` via `defaultDeviceRegistryPath()`.
- `list(now = Date.now())` — returns live devices, drops `exp <= now` (predicate `exp > now`), and **persists** the prune so a fresh registry over the same file sees the same result.
- `append(rec)` — **upsert**: filters out any existing row with the same `deviceId`, then appends (last write wins). No duplicate deviceIds.
- `remove(deviceId)` — drops one (no-op if absent).
- `clear()` — drops all (T19 rotate-root).

## Secure-file handling — matched siblings
- **Mode/atomicity:** dir `mkdirSync(..., { mode: 0o700 })`, file written `0o600`. Writes are **atomic temp+rename** — serialize to `${path}.<rand>.tmp` (minted 0600 up front so data is never briefly world-readable), then `renameSync` over the target; temp is unlinked on failure. This is stronger than the siblings' plain `writeFileSync` but satisfies the Task-13 security bar's explicit "atomic (temp+rename)" requirement while keeping the same 0600/0700 convention — additive hardening, not an invented idiom.
- **Fail-closed on corrupt:** `load()` mirrors `loadRevoked` in `session-token.ts` exactly — ABSENT file (ENOENT) → `[]` (nothing paired yet); PRESENT-but-unparseable JSON → throws; PRESENT-but-not-a-JSON-array → throws. A tampered/unreadable positive list refuses to start rather than silently collapsing to "no devices" (which would drop the audit trail / un-list every device). Valid arrays are field-validated (deviceId/label:string, createdAt/exp:number) so malformed rows are filtered.
- **Path traversal:** the file path is fixed (config or `~/.agent/devices.json`); `deviceId`/`label` are stored as record fields only, never interpolated into any filesystem path.

## No-token-stored confirmation
Registry persists only the four metadata fields. Test `append then list returns the device (no token field ever)` asserts `'token' in item === false`. The minted token lives only in the pair response body (T17), never here.

## TDD RED → GREEN
- RED: `bun test` → "Cannot find module device-registry.ts" (module missing).
- GREEN: 7 tests, 12 expect() calls, all pass. Coverage: append→list (no token field), upsert-on-duplicate, prune-expired-and-persist (incl. fresh-registry-over-same-file), remove+clear, corrupt-JSON fail-closed, non-array fail-closed, and **0600 mode assertion** (`statSync(path).mode & 0o777 === 0o600`).

## Gate
- `bun run typecheck` clean.
- `bun run lint:file` clean (biome, after auto-format/import-sort).
- `bun test tests/server/` → 329 pass / 0 fail (71 files) — no regressions.

## Files changed
- `src/server/security/device-registry.ts` (new)
- `tests/server/security/device-registry.test.ts` (new)

## Concerns
- None blocking. Reviewer note: I chose atomic temp+rename over the siblings' plain `writeFileSync` because the Task-13 security bar explicitly requires atomicity; the siblings write tiny payloads and don't do this, so this is a deliberate hardening, not a divergence to flag. If the increment prefers strict idiom-matching the temp+rename could be dropped — but that would weaken the crash-safety the brief asked for.

## Fix — runtime field-strip (security-review follow-up, commit `67fc6ec`)

**Finding:** the no-secret invariant ("registry never stores the minted token")
was enforced only by the `DeviceRecord` TypeScript type, not at runtime. A
caller that constructed `{...record, token}` (e.g. via an `as any` cast or a
spread from the pair-response object) would sail past the type checker and
`append()` would happily serialize the token straight into
`~/.agent/devices.json`.

**Fix:** both write/read paths now explicitly pick only the four allowed
fields, dropping anything else before it can reach disk or a caller:

```ts
// append(rec) — src/server/security/device-registry.ts
const clean: DeviceRecord = {
  deviceId: rec.deviceId,
  label: rec.label,
  createdAt: rec.createdAt,
  exp: rec.exp,
};
devices = [...devices.filter((d) => d.deviceId !== clean.deviceId), clean];
persist();
```

`load()` applies the same pick (`.map` after the existing shape-validating
`.filter`) so even a pre-existing on-disk file with stray extra keys is
normalized on read, not just on write. No API signature, file mode,
atomicity, or fail-closed logic changed.

**Test added** (`tests/server/security/device-registry.test.ts`, `append
strips extra properties (e.g. a token) at runtime, never persisting them`):
appends a record cast `as unknown as Parameters<typeof reg.append>[0]` with
extra `token: 'SUPER_SECRET'` and `foo: 1` fields, then:
- `list()`'s returned item has neither `'token' in item` nor `'foo' in item`.
- The **raw file contents** (`readFileSync(path, 'utf8')`) do **not** contain
  the substring `'SUPER_SECRET'` — proving the secret never touched disk, not
  just that the in-memory accessor hides it.

Result: 8/8 tests pass (up from 7) — new test included, no regressions.

**Gate:** `bun run typecheck` clean; `bun run lint:file -- src/server/security/device-registry.ts tests/server/security/device-registry.test.ts` clean (biome, no fixes needed); `bun test tests/server/` → 330 pass / 0 fail across 71 files.

**Commit:** `67fc6ec` — `fix(security): runtime field-strip so device registry can never persist a token (Slice 25b T13 review)`. Only the two files above were staged.

---

# Task 13 Report (Slice 25 — Scheduled + Triggered Agents) — `chain.ts` job-completion observer + pool onSettled seam (HARD §7.3)

## Status: DONE

Commit `2d6e358` — `feat(triggers): job-chain observer + pool onSettled seam (terminal-only)`.

## What shipped
- **`src/queue/pool.ts`** — added the `onSettled?: (job, status: Done|Failed) => void` seam to `createWorkerPool` opts + a private `safeSettled(job, status)` wrapper.
  - Success path: `safeSettled(job, Done)` is called **inside the existing try, immediately after `markDone` succeeds** (I5). A throwing `markDone` falls to the catch WITHOUT firing — no phantom chain off an uncommitted completion.
  - Fail path: `else if (after?.status === Failed) safeSettled(after, Failed)` after the existing retry re-read, inside the try. A retry re-queue (Queued) never reaches it; `markCanceled`/`markInterrupted` never call it. Terminal-only.
  - `safeSettled` wraps `opts.onSettled?.(...)` in try/catch so a throwing observer can never wedge `runOne`/the claim loop.
- **`src/triggers/chain.ts`** (new) — `createChainObserver({ triggerStore, fire, maxChainDepth })` → `{ handleJobSettled(job, status) }`. Iterates `triggerStore.list()`, skips non-enabled / non-`JobChain` (explicit `trigger.type === TriggerType.JobChain` branch — T1 non-discriminated-union carry), matches `(config as JobChainConfig)`: `onStatus === status` AND (`!onKind || onKind === job.kind`) AND (`!onName || onName === payloadName(job.payload)`). On a match: `fire(trigger, { reason: 'chain', chainDepth: (job.chainDepth ?? 0) + 1, vars: { 'chain.jobId': job.id, 'chain.runId': job.runId ?? '' } })`.

## F1 trust-boundary carry (critical) — honored
Fired depth derives ONLY from the finished job's PERSISTED `chainDepth` (`(job.chainDepth ?? 0) + 1`) — never any external input. The observer always increments + delegates; the cap is enforced downstream in `fire.ts` (verified: `fire.ts` treats `depth > maxChainDepth()` and non-integer/negative as cap-exceeded → Failed, no enqueue). `maxChainDepth` is kept in the observer deps for interface parity (per the brief signature) but is intentionally NOT consulted for capping — documented inline.

## onName field resolution
`onName` matches the finished job's `payload.name`. Confirmed via `src/server/jobs/dispatch.ts` (`CrewJobPayloadSchema`/`WorkflowJobPayloadSchema` = `{ name, input, ... }`) and `src/server/crews/run.ts` / `workflows/run.ts` (`payload: { name, input }`). `payloadName()` safely reads a string `name` off an object payload; chat/pull/build payloads have no `name`, so an `onName` filter never matches them.

## Robustness
`fire()` is fire-and-forget from the synchronous `handleJobSettled` seam; its returned promise gets a `.catch(() => {})` so a chain-fire rejection never surfaces as an unhandledRejection (the pool's `safeSettled` guards synchronous throws, not promise rejections).

## Tests — TDD RED → GREEN
- `tests/queue/pool-onsettled.test.ts` (5): onSettled(Done) fires once; onSettled(Failed) fires on terminal non-retryable failure; NOT called on retry re-queue; NOT called when `markDone` throws (no phantom + runOne does not reject); a throwing observer never wedges the claim loop (2nd job still reaches Done, no unhandledRejection).
- `tests/triggers/chain.test.ts` (6): matching completion fires with depth+1 + correct reason/vars; depth threading passes `max+1` (cap enforced downstream); onStatus mismatch → no fire; onKind narrows; onName match/mismatch; disabled trigger skipped.
- Result: **11/11 pass**. Broader regression: `bun test ./tests/queue/ ./tests/triggers/` → **141 pass / 0 fail** (logged SQLITE errors are other tests' intentional fault-injection).

## Gate
- `bun run typecheck` clean.
- `bun run lint:file -- src/queue/pool.ts src/triggers/chain.ts tests/triggers/chain.test.ts tests/queue/pool-onsettled.test.ts` clean (biome, after auto-format).
- `bun run test -- -t "onSettled"` → 5 pass / 0 fail.
- pre-commit `docs:check` passed on commit.

## Concerns
- **Wiring not in scope:** this task only adds the seam + observer. Nothing yet calls `createWorkerPool({ onSettled })` with `createChainObserver(...).handleJobSettled` — that wiring (daemon composition) is a downstream task. Flagging so the slice's integration/live-verify step connects them.
- **`maxChainDepth` unused in the observer body** by design (cap lives in fire.ts). Kept per the mandated brief signature; an adversarial reviewer may question it — rationale documented inline in `chain.ts`.
- `triggerStore.list()` returns ALL triggers and the observer filters in-memory (no `listByType`). Fine at current scale; a `WHERE type='jobchain' AND enabled` query would be the optimization if trigger counts grow.
