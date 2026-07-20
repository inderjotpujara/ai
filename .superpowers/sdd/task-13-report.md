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
