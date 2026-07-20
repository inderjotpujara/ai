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
