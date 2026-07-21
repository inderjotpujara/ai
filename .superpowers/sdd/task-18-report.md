# Task 18 Report — `POST /api/devices/:id/revoke` (Slice 25b Incr 3, §7.1)

> Note: this report path previously held Slice 30b's Task-18 report; overwritten
> here for Slice 25b Task 18 (device revocation).

## Status: COMPLETE — committed `250c369`

## Gate (run inline before reporting)
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/server/devices/revoke.ts src/server/app.ts tests/server/devices/revoke.test.ts tests/server/app.test.ts` → "Checked 4 files. No fixes applied."
- `bun test tests/server/devices/revoke.test.ts` → **8 pass / 0 fail, 25 expect()**.
- `bun test tests/server/` sanity → **363 pass / 0 fail, 922 expect()** across 77 files.
- Full suite = controller at increment boundary (not run here).

## Files changed
- **Create** `src/server/devices/revoke.ts` — `handleDeviceRevoke(id, req, deps, guard)`.
- **Modify** `src/server/app.ts` — import + action-sub-path route `POST /api/devices/:id/revoke`, placed AFTER `POST /api/devices` (pair) and BEFORE `/api/jobs` (no bare `/api/devices/:id` exists; action-before-detail discipline preserved). Removed the stale "lands beside these later" TODO comment.
- **Test (new)** `tests/server/devices/revoke.test.ts` — 8 security-bar unit tests.
- **Test (mod)** `tests/server/app.test.ts` — added route-level 503-unwired + 401-unauth test mirroring the GET /api/devices one.

## TDD RED → GREEN
- RED: wrote `revoke.test.ts` first → `Cannot find module '.../revoke.ts'` (1 fail, 1 error).
- GREEN: implemented handler + wired route → 8/8 pass.

## Security-bar proof

### 1. Trusted-local gate FIRST, zero side-effect on 403
`requireTrustedLocal(req, guard, deps.policy)` runs BEFORE any `revokeDevice`/`remove`; on failure returns 403 immediately, NO mutation executes. Two failure-mode tests:
- **remote principal** (`'uuid-remote'`) → 403; after: registry still `['d1']` AND `verifySessionToken(token).deviceId==='d1'` (NOT in negative set).
- **non-loopback Host** (`'local'` principal over `agent.ts.net`) → 403, same zero-side-effect asserts. Tunnel-replay defense: `isLoopbackHost` false for a tunnel host even with the `'local'` token.

### 2. Revocation real + complete (BOTH effects)
After successful revoke of `d1`:
- (a) `deviceRegistry.list()` → `[]` (positive-list prune via `remove`).
- (b) `verifySessionToken(token)` → `null` (negative-set add via `revokeDevice`; token valid the line before now fails). Closes the naive-failure-mode (prune row, leave token alive).

### 3. Idempotent / unknown id
Per the brief's Set.add/filter semantics, unknown or already-revoked id → safe **200 `{revoked:true}`** (idempotent — the brief's contract, not 404):
- unknown `does-not-exist` → 200, d1 untouched.
- revoke `d1` twice → both 200, stays revoked, no crash.

### 4. Forged / traversal id
`:id` captured by `/^\/api\/devices\/([^/]+)\/revoke$/` — one non-`/` segment — used ONLY as a Set key and registry filter value; never touches the filesystem. Test: `'../../etc/passwd'` → 200, no crash, d1 untouched.

## Self-revoke of `'local'` — DECISION + FLAG
**Brief is SILENT.** Following the brief's exact code (no special-case), revoking `'local'` is permitted:
- `'local'` is never in the POSITIVE registry (only paired remotes are appended), so `remove('local')` is a no-op.
- `revokeDevice('local')` adds `'local'` to the negative set → the local browser's session token stops verifying. Stateless HMAC means even a freshly-minted `'local'` token would then fail — a **self-lockout**, recoverable only via hand-editing `revoked-devices.json` or the T19 break-glass root rotate.

**Assessment: self-inflicted AVAILABILITY footgun, NOT attacker capability** — reaching it requires already being the authenticated trusted-local operator (remote/tunnel 403'd first). Does not breach security-bar 1–4. Implemented per brief and **PINNED in a test** rather than silently adding an out-of-contract guard (a `'local'` special-case would introduce behavior T21's acceptance doesn't expect).

**Recommendation (follow-up, not this task):** if belt-and-suspenders wanted, add an early guard rejecting `id==='local'` — mirrors pair.ts's "never overwrite `'local'`" IDOR stance. Flagged for increment review / T21.

## 503 / 401 wiring
Route builds deps via `need(...)` (T8) → `DepUnavailableError` → `handleApi` catch → clean **503** until T20 wires stores. `app.test.ts`: no token → **401**; token + unwired → **503** `{error:'server dependency not configured: deviceRegistry'}`. `need()` fires while building the deps object, BEFORE the handler, so 503 is correct even though the route is also trusted-local-gated.

## Span
`recordDeviceRevoke(id, 'local')` emits `ops.devices.revoke` (T15) with `SERVER_PRINCIPAL='local'` + `DEVICE_ID=id`, no token/secret; only after a successful (non-403) revoke.

## Concerns
1. **Self-revoke `'local'` footgun** (above) — FLAGGED for T21/increment-review; implemented per brief.
2. Span principal hardcoded `'local'` (matches pair.ts + brief) — correct because `requireTrustedLocal` guarantees `principal==='local'` by the time the span fires.

---

## Fix follow-up (review): reject self-revoke of the local session

**Status:** COMPLETE — committed `75ff8633b3af6f3de6aa292301372b069e3f0d88` (`fix(devices): reject self-revoke of the local session (Slice 25b T18 review)`)

The original revoke route permitted revoking the `'local'` device, letting the local operator self-lock-out. Not attacker/UI-reachable (Minor), but it broke the symmetric invariant that `'local'` is sacrosanct (pairing never mints it, so revoke should not remove it either). Added an early guard in `handleDeviceRevoke` (`src/server/devices/revoke.ts`), placed AFTER the `requireTrustedLocal` gate (so a remote/tunnel caller still gets 403, not this 400) and BEFORE any mutation:

```
if (id === 'local') return json({ error: 'cannot revoke the local session' }, 400);
```

Updated the test that previously PINNED the self-lockout behavior (`tests/server/devices/revoke.test.ts`) to instead assert the new contract: a trusted-local caller revoking `'local'` now gets 400 with `{error:'cannot revoke the local session'}`, and the `'local'` session token still verifies afterward (not added to the negative set). All other revoke tests (remote→403, unknown-id idempotent, real-device revoke, traversal-id safe) unchanged.

**Gate:**
- `bun run typecheck` → clean.
- `bun run lint:file -- src/server/devices/revoke.ts tests/server/devices/revoke.test.ts` → "Checked 2 files. No fixes applied."
- `bun test tests/server/devices/revoke.test.ts` → 8 pass / 0 fail, 26 expect().
- `bun test tests/server/` sanity → 363 pass / 0 fail, 923 expect() across 77 files.

**Files:** `src/server/devices/revoke.ts`, `tests/server/devices/revoke.test.ts`.

---
---

# Task 18 Report — Webhook secret store `~/.agent/trigger-secrets.json` (Slice 25 Triggers, §7.1)

> Note: content ABOVE this separator is a stale Slice 25b Task-18 report (device revocation) left in this path. The report below is the CURRENT Slice 25 (Scheduled + Triggered Agents) Task 18.

## Status: COMPLETE — committed `70841a6` (branch `slice-25-triggers`)

## What shipped
Replaced the fail-closed Task 16 stub `src/triggers/secret-store.ts` (which returned `resolve()→undefined`) with the real per-trigger HMAC secret store persisting to `~/.agent/trigger-secrets.json`. Mirrors `src/server/security/device-registry.ts` byte-for-byte: `~/.agent` dir `0o700`, file `0o600`, atomic temp-write + `rename`, fail-closed load (ENOENT→`{}`; present-but-corrupt/non-object→THROW).

### Interface alignment (the context the brief could not know)
The brief's Produces block declared a NEW `export type TriggerSecretStore` in secret-store.ts, but the note directed keeping `src/triggers/engine.ts` as the single source of truth and NOT forking. The engine's type was Task 16's `{ resolve }` seam; nothing in production calls `.resolve()` yet (Task 19 will call `get()`). So I **aligned the interface in engine.ts in place** (the engine comment explicitly invited "Task 18 aligns/extends this interface") from `{ resolve }` → `{ mint; get; remove }`, and secret-store.ts **imports** it (no fork). Updated the one consumer stub in `tests/triggers/engine.test.ts` accordingly.

Final interface (engine.ts, verbatim from brief):
```ts
export type TriggerSecretStore = {
  mint(): { secretRef: string; hmacSecret: string };
  get(secretRef: string): string | undefined;
  remove(secretRef: string): void;
};
```
Plus `export function defaultTriggerSecretsPath(): string` and `createTriggerSecretStore(config: { path?: string }): TriggerSecretStore` in secret-store.ts.

## §7.1 security proof
- Secrets minted SERVER-SIDE only: `randomBytes(32).toString('hex')` (secret), `randomBytes(9).toString('hex')` (ref). Never client-supplied.
- `mint()` persists + returns `{ secretRef, hmacSecret }` ONCE (create-response once-only display); thereafter the file is the ONLY at-rest location.
- `get()` returns the raw secret (for Task 19 HMAC verify) or `undefined`. Constant-time compare deliberately left to Task 19.
- `remove()` drops on trigger delete (no-op if absent → no needless write).
- Store object exposes ONLY `mint`/`get`/`remove` — no `toJSON`/enumerable secret field; `JSON.stringify(store) === '{}'` (test-pinned) so a logger/DTO/span serializer cannot pick the secret up. Raw secret never logged / in a DTO / a span attribute.

## Files
- **Modify** `src/triggers/secret-store.ts` — real store (was the stub).
- **Modify** `src/triggers/engine.ts` — aligned `TriggerSecretStore` type (single source of truth) + updated doc comment.
- **Create** `tests/triggers/secret-store.test.ts` — 9 tests.
- **Modify** `tests/triggers/engine.test.ts` — updated the injected `secretStore` stub to the new shape.

## TDD RED → GREEN
- RED: wrote secret-store.test.ts first → `store.mint is not a function` (0 pass / 9 fail) against the old `{ resolve }` stub.
- GREEN: after impl → 9/9 pass.

## Gate (run inline)
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/triggers/secret-store.ts src/triggers/engine.ts tests/triggers/secret-store.test.ts tests/triggers/engine.test.ts` → "Checked 4 files. No fixes applied."
- `bun test tests/triggers/secret-store.test.ts` → **9 pass / 0 fail, 18 expect()**.
- `bun test tests/triggers/` (regression, interface change) → **102 pass / 0 fail, 329 expect()** across 14 files.
- pre-commit `docs:check` → passed on commit.

## Test coverage
mint→persist→get round-trip (incl. across a fresh store over the same file); ref/secret hex-format + per-call distinctness; `get` undefined for unknown ref; `remove` drops + persists + absent-ref no-op; file is `0o600`; corrupt-JSON throws; non-object (array) throws; file holds exactly `{ref: secret}`; store has no serialization surface.

## Concerns
1. **Interface change is cross-task**: engine.ts's `TriggerSecretStore` went `resolve`→`mint/get/remove`. Safe now (no production caller of `.resolve()`), but **Task 19 must consume `get()`** (not `resolve()`) for HMAC verification — that is the intended seam.
2. Docs (architecture.md / README / ROADMAP / ledger) are the slice-landing controller's job, not this per-task commit; not touched here.

## Fix pass

**§7.1 adversarial-verifier finding closed** — commit `da8bfd8` (branch `slice-25-triggers`, on top of `70841a6`).

**Fail-OPEN divergence:** `load()`'s value filter was `if (typeof secret === 'string') out[ref] = secret;` — a tampered/corrupt secrets file containing `{"ref":""}` or `{"ref":"   "}` survived the filter, and `get("ref")` would hand back an empty/whitespace HMAC key: an empty-key HMAC signature is computable by anyone, the exact forgeable-signature vector `src/server/security/root-token.ts` (the precedent this file mirrors) already defends against via its `readNonEmpty` idiom (`t.trim().length > 0 ? t : null`).

**Fix:** tightened the `load()` filter to `if (typeof secret === 'string' && secret.trim().length > 0) out[ref] = secret;`, mirroring root-token.ts's `readNonEmpty`. Empty/whitespace-only values are now dropped at load — never surfacing as a stored secret — so `get()` can never return one. Also updated the `load()` doc comment to name the empty/whitespace case and the root-token.ts parallel. `mint()` is unaffected (already only ever emits 64-hex secrets, so no valid path changes).

**Test added:** `an empty or whitespace-only secret value is dropped at load, not served as a key (§7.1 fail-closed)` — writes `{"ref":""}` and (separately) `{"ref":"   "}` directly to the secrets file, then asserts `get('ref')` is `undefined` in each case.

**Gate:**
- `bun run typecheck` → clean.
- `bun run lint:file -- src/triggers/secret-store.ts tests/triggers/secret-store.test.ts` → "Checked 2 files. No fixes applied."
- `bun run test:file -- tests/triggers/secret-store.test.ts` → **10 pass / 0 fail, 20 expect()** (was 9/9; +1 new test).

Staged only the two files (`src/triggers/secret-store.ts`, `tests/triggers/secret-store.test.ts`); pre-commit `docs:check` passed.
