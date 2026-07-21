# Task 19 report — `POST /api/security/rotate-root` (break-glass rotate + local re-mint)

> NOTE: this file previously held a stale Task-19 entry from an EARLIER slice's
> task-numbering (Slice 30b `src/contracts/telemetry.ts`). Fully overwritten for
> Slice 25b Task 19; nothing from the old content was merged.

**Status: COMPLETE.** Commit `cfb9bcf` — `feat(security): POST /api/security/rotate-root break-glass + local re-mint (Slice 25b Incr 3, §7.1)`.

## Files changed (5, `git add`-scoped — no `-A`)
- **Create** `src/server/security/rotate.ts` — `rotateRoot(deps)` orchestrator.
- **Create** `src/server/security/rotate-route.ts` — `handleRotateRoot(req, deps, guard)` route.
- **Modify** `src/server/app.ts` — import + route wiring (via `need()` for optional deps).
- **Test** `tests/server/security/rotate.test.ts` — 7 route-level security tests.
- **Test** `tests/server/app.test.ts` — +1 app-level 503-unwired / 401-unauth test.

## §7.1 security bar — each invariant, its enforcement, and the proving test

### §7.1(1) — Gate FIRST (403 remote/tunnel, zero side-effect)
`handleRotateRoot` calls `requireTrustedLocal(req, guard, deps.policy)` as the **first statement**, before body parse / secret compare / any mutation. `requireTrustedLocal` (Task 14, unchanged) requires `principal === 'local'` AND `isLoopbackHost` AND `originAllowed` — a paired remote (random-UUID principal) or a `'local'` token replayed over a tunnel (non-loopback Host) gets 403.
**Test:** *"a non-local caller is 403 (before any secret check), zero side-effect"* — principal `'uuid'` → 403, and asserts root unchanged, registry length 1, the other-device token still verifies as `phone`. So the 403 truly precedes every side effect.

### §7.1(2) — Wrong `rootSecret` → 401, zero side-effect, constant-time compare
`secretMatches(expected, candidate)` = length-guard then `timingSafeEqual` (the exact `session-token.ts` / `token.ts` idiom) — never a content-dependent `===`, no char-by-char early exit. On mismatch the route returns 401 **before** calling `rotateRoot()` / `deviceRegistry.clear()`, so root + registry + all sessions are untouched.
**Test:** *"a wrong rootSecret is 401, root + registry untouched"* — `'WRONG'` → 401; asserts `getOrCreateRoot()` still equals the original secret, registry length 1, and the `phone` token still verifies.

### §7.1(3) — Correct secret → rotate; ALL old sessions die, ONLY re-minted local survives (self-DoS avoided)
On match: `rotateRoot()` calls `rootTokens.rotate()` (overwrites the on-disk root), then `sessionTokens.mintSessionToken({deviceId:'local'})`. Because the session store was built over the **root getter** (`() => rootTokens.getOrCreateRoot()`, Task 15), the re-mint signs under the NEW root while every previously-minted token (paired remotes) stops verifying. The re-minted `'local'` token is returned so the operator's tab survives.
**Test (shared-rootStore end-to-end proof):** *"rotate invalidates OTHER sessions while re-minting a working local token"* — mints `otherToken` (deviceId `phone`) under the old root via a store sharing the SAME `rootStore` instance; after rotate a FRESH store built over the post-rotate root shows `verifySessionToken(otherToken) === null` (old dies) while `verifySessionToken(body.token).deviceId === 'local'` (re-minted survives). Real end-to-end invalidation, not a no-op.

### §7.1(4) — No secret/root in span / response / error / log
Response body is `{ token: localToken }` only. `recordRotateRoot('local')` sets the principal attribute + an `all-sessions-invalidated` event — no DEVICE_ID, no root, no secret (Task 15 span, unchanged). Error bodies are static (`'unauthorized'` / `'bad request'` / `'forbidden: trusted-local only'`) — the submitted secret is never echoed.
**Test:** *"never leaks the root secret in the 200 body or the 401 error body"* — asserts `Object.keys(okBody) === ['token']`, the serialized 200 body does not contain the root secret, and a wrong-secret error body does not contain the guessed value.

### §7.1(5) — Idempotent-ish: a second rotate with the now-STALE old secret → 401
After a successful rotate the root has changed, so replaying the old secret fails the constant-time compare → 401 (no second mass-invalidation).
**Test:** *"§7.1(5) idempotent-ish: a second rotate with the now-STALE old secret is 401"* — first rotate 200, second (same old secret) 401.

### Extra hardening
- *"malformed body (missing rootSecret) is 400 — before any rotate"* — `RotateRootRequestSchema.parse` failure → 400 with root + registry untouched.
- **app-level** *"POST /api/security/rotate-root requires the bearer token and degrades to 503 when unwired"* — no token → 401 (shared session guard); `Bearer TOKEN` but optional deps unset → clean 503 `server dependency not configured: rootTokens` (the first `need()`), never an opaque 500/crash.

## The constant-time compare
`secretMatches` mirrors `session-token.ts::sigMatches` exactly: `Buffer.from` both sides, `if (a.length !== b.length) return false`, then `timingSafeEqual(a, b)`. `timingSafeEqual` throws on unequal-length buffers, so the length guard is mandatory and also correct security-wise (revealing only length-equality, not content). No hand-rolled `===` on secret material.

## Self-DoS-avoided / registry-clear decision
- **Self-DoS avoided:** the same live session store re-mints `'local'` under the new root inside the same request; the route returns that token so the operator's tab swaps to it and keeps working. Proven by the end-to-end test (local token verifies post-rotate).
- **Registry clear = YES.** The brief's acceptance text explicitly states rotate *"also clears the device registry (the old paired devices' tokens are all dead now)."* `deps.deviceRegistry.clear()` runs after `rotateRoot()`. Every paired device's HMAC token is already dead (root changed); clearing the positive registry list keeps `GET /api/devices` consistent (no phantom rows for devices that can no longer authenticate). The `'local'` session is NOT a registry row (pairing never appends it), so clearing the registry does not affect the re-minted local token.

## Wiring dependency (T15/T20)
The route consumes `deps.rootTokens` and `deps.sessionTokens` as-is; correctness depends on `main.ts` (T20) constructing the session store with `rootToken: () => rootStore.getOrCreateRoot()` over the SAME `rootStore` instance passed as `rootTokens`. The tests prove this end-to-end by wiring exactly that shared-instance getter in their `ctx()` fixture. In `app.ts` both come from `need(deps.rootTokens)` / `need(deps.sessionTokens)`, so until T20 wires them the route cleanly 503s.

## TDD RED → GREEN
- **RED:** first run failed with `Cannot find module '.../rotate-route.ts'` (0 pass, 1 error).
- **GREEN:** after implementing `rotate.ts` + `rotate-route.ts` + wiring, `rotate.test.ts` (7) + `session-token.test.ts` + `app.test.ts` = 41 pass / 0 fail. Full `tests/server/` = **370 pass / 0 fail**.

## Gate
- `bun run typecheck` — clean.
- `bun run lint:file --` (all 5 changed files) — clean (one auto-format applied).
- `bun test tests/server/` — 370 pass / 0 fail.

## Concerns / notes for the controller & Fable
- **No contradiction found** between the brief and the real `rotate()` / getter API — `RootTokenStore.rotate()`, `DeviceRegistry.clear()`, the `rootToken: string | (() => string)` getter, `RotateRootRequestSchema`, and `recordRotateRoot(principal)` all exist as the brief describes. No `NEEDS_CONTEXT`.
- **`session-token.ts` NOT modified** — the brief's Step 7 listed it in the `git add`, but the getter it depends on was already landed by T15, so this task changed nothing there. Left out of the commit to keep the add scoped to actual changes.
- **503 ordering:** in `app.ts` the `need()` calls run before `handleRotateRoot`, so an unwired dep 503s before `requireTrustedLocal`. This matches the sibling device routes exactly (a missing dep is an operator/config fault, surfaced as 503 regardless of caller trust) and does not leak anything.
- The route file lives in `src/server/security/` (per brief) while the sibling pair/revoke routes live in `src/server/devices/`; its `recordRotateRoot` span still comes from `../devices/spans.ts` (shared ops-telemetry module).

---

## T19 review follow-up — fail-OPEN root-token forgery vector (Fable adversarial review)

**Commit:** `1baf48ae31abc762ace67d3117cb278dfa9ca4eb` — fix(security): atomic root-token write + non-empty guard (empty HMAC key = forgeable) (Slice 25b T19 review)

### Vulnerability (pre-existing Slice-24 code, `src/server/security/root-token.ts`)
`rotate()` wrote the new root with a NON-ATOMIC `writeFileSync(path, root, {flag:'w'})` — the `'w'` flag truncates the file to 0 bytes *before* writing, so a crash inside that truncate-then-write window left an EMPTY `daemon-token`. `getOrCreateRoot()`'s EEXIST-recovery branch then did `readFileSync(path).trim()` and returned it with NO non-empty guard, so it could return `''`. The root is the HMAC-SHA256 key every session token is signed with; an empty key makes those signatures computable by anyone (HMAC with an empty key), so any perimeter-passing caller could forge a valid session token. Fail-OPEN — low probability, critical impact.

### Fixes
1. **Atomic writes (crash can never leave a truncated/empty root).** Both write paths now mirror `device-registry.ts` (temp minted 0600 in the same dir, then rename/link, temp cleaned up on failure):
   - `rotate()` → `atomicOverwrite()`: temp-file + `renameSync` over the target (rename is atomic within a filesystem → either the old full root or the new full root, never a partial).
   - mint-once → `exclusiveCreate()`: temp-file + `linkSync` onto the target (`link()` is atomic AND fails EEXIST if the target exists, preserving the single-writer race semantics the old O_EXCL `'wx'` gave, but now also crash-atomic).
2. **Non-empty read guard + self-heal.** `readNonEmpty()` returns `null` for an empty/whitespace/absent value, and `getOrCreateRoot()` runs a capped retry loop: a corrupt/empty remnant is unlinked and a fresh root is re-minted atomically; an EEXIST race re-reads the winner's token. The store NEVER returns `''` as an HMAC key. 0600 perms and mint-once/rotate semantics preserved for all callers.

### Test results (all green)
- **Empty-file → re-mint:** an existing EMPTY `daemon-token` → `getOrCreateRoot()` returns a non-empty 64-hex root (`/^[0-9a-f]{64}$/`), asserts it is never `''`, and the on-disk file is now the real non-empty root. Added a whitespace-only variant too.
- **rotate atomicity:** after `rotate()` the on-disk root is a valid non-empty 64-hex value differing from the pre-rotate value, and **no `.tmp` file is left behind** (`readdirSync(dir).filter(f=>f.endsWith('.tmp'))` is empty).
- All pre-existing root-token tests stay green (mint-once, rotate-changes-value, 0600 mode, EEXIST single-writer).
- **Minor / test hygiene:** the dead control block in `tests/server/security/rotate.test.ts` (created `d`/`bad`, asserted nothing) now asserts the valid rotate is 200 and its body carries only `token` with no echo of `d.rootSecret`.

**Gates:** `bun run typecheck` clean · `bun run lint:file` (3 files) clean · `bun test tests/server/security/root-token.test.ts tests/server/security/rotate.test.ts` → 14 pass / 0 fail · `bun test tests/server/` → 373 pass / 0 fail (session-token/rotate/pair/revoke all green).


---

# Task 19 report — Slice 25 (Scheduled + Triggered Agents): `POST /hooks/:token` webhook receiver (HARD §7.1)

**Status:** COMPLETE. **Commit:** `3f7e58e`.

## What was built
- `src/triggers/webhook-verify.ts` (pure, unit-testable):
  - `hashToken(token)` = `createHash('sha256').update(token).digest('hex')`.
  - `constantTimeEqualHex(a,b)` — double length-guard (string, then decoded
    bytes — `Buffer.from(hex)` drops invalid/odd nibbles) before
    `timingSafeEqual` (which throws on length mismatch).
  - `verifyHmac(...)` — replay window checked FIRST (unix SECONDS per M4;
    `Number(...)`, non-finite/absent/wrong-unit-ms → 409), THEN constant-time
    HMAC-SHA256 compare over `${timestampHeader}.${rawBody}` (Stripe-verbatim,
    raw body bytes; bad sig / missing sig header → 401).
- `src/server/hooks/webhook.ts` — `handleWebhook(token, req, deps)` inside
  `withServerRequestSpan({ route:'/hooks/:token' })`. Order: token→sha256 lookup
  via `getByTokenHash` (miss/non-webhook/disabled → 404, uniform shape) → body
  cap (Content-Length pre-check vs `AGENT_WEB_MAX_BODY_BYTES`, injectable
  `maxBodyBytes` for tests → 413) → read raw body ONCE → HMAC when
  `cfg.hmac` (secretStore.get(); missing secret → 500 fail-closed; 401/409 per
  verifyHmac) → run-dir limiter (429) → `fire(trigger,{reason:'webhook',
  vars:{'webhook.body':rawBody}})` fire-and-forget → 202 {jobId,runId} (or
  202 {skipped:outcome} on overlap/cap skip). Raw token/secret never
  logged/spanned/returned.
- `src/server/app.ts` — `/hooks/:token` POST branch placed AFTER
  `new URL()`/`enforcePerimeter` but BEFORE the `/api` session-guard block
  (outside bearer guard, inside Host/Origin perimeter). Absent `deps.triggers`
  → explicit 503 (DepUnavailableError message shape), not the outer-catch 500.
  Only POST matches; other methods fall through to serveStatic (exposes nothing
  new). Wired store/secretStore/fire from `deps.triggers`, runLimiter from
  `deps.runLimiter` (shared process limiter).

## Tests (TDD)
`tests/triggers/webhook-verify.test.ts` + `tests/server/hooks-webhook.test.ts`:
**20 pass / 0 fail (46 assertions).** Covers: good HMAC→202+fire; bad HMAC→401
no-fire; stale/absent/garbage/millisecond-unit timestamp→409; replay-before-sig
ordering; unknown/disabled/non-webhook token→404 no-fire; hmac-off→202 on token
alone; missing secret→500; over-cap Content-Length→413 before buffering;
rate-limit→429; overlap-skip→202; token/secret-never-in-response assertions.
Regression: app.test.ts + principal.test.ts (22 pass).

Gate: `bun run typecheck` clean; `bun run lint:file` on all 5 files clean;
focused tests green. Staged only the 5 touched files.

## Concerns / notes
- Handler adds a Content-Length pre-check (mirroring /api/telemetry) as
  defense-in-depth so 413 is unit-testable; Bun.serve `maxRequestBodySize`
  remains the runtime backstop. It rejects only when CL is present and > cap
  (chunked/absent-CL bodies still rely on the Bun.serve backstop) — deliberate,
  to avoid breaking chunked senders.
- GET `/hooks/:token` (extensionless) falls through to serveStatic's SPA
  fallback (returns index HTML 200), same as any extensionless path — no
  webhook function is exposed; only POST fires. Acceptable / pre-existing.
- The route branch bypasses `handleApi`'s span/telemetry wrapper by design (it
  runs its own `withServerRequestSpan` inside `handleWebhook`). Docs
  (architecture.md/README/ROADMAP/ledger) are the slice-landing gate's job, not
  this per-task commit.

## Fix pass

Task 19's dual review (spec-review + §7.1 adversarial, both SOUND/Approved —
no security break) found one LOW code fix + two security-posture doc notes.
All three applied in one commit.

- **FIX 1 (LOW code — status oracle).** `src/server/app.ts`'s route branch
  called `handleWebhook(decodeURIComponent(hookMatch[1]), …)` directly.
  `decodeURIComponent('%zz')` throws a `URIError`, which escaped to the outer
  try/catch → an opaque 500 — a minor 500-vs-404 status oracle breaking the
  "any invalid token → uniform 404" contract. Fixed by wrapping the decode in
  its own try/catch: a decode failure now returns the SAME 404 shape
  (`{ error: 'not found' }`) as an unknown/disabled-trigger miss, BEFORE any
  store lookup. Valid tokens still decode+hash identically (unchanged path).
  **Test added:** `tests/server/app.test.ts` — `POST /hooks/%zz` → 404 with
  body `{ error: 'not found' }`, using a dedicated fixture server whose
  triggerStore/secretStore/fire stubs all throw if invoked (proves the decode
  failure short-circuits before any lookup).
- **FIX 2 (doc — in-window replay, no code change).** `src/triggers/webhook-verify.ts`
  — added a comment at the replay-window check in `verifyHmac` stating
  in-window HMAC replay is intentionally NOT deduped (no nonce/delivery-id
  store); the ±windowMs window bounds exposure, it doesn't eliminate it. This
  mirrors GitHub/Stripe (both push idempotency to the consumer) and is
  accepted for a local single-owner daemon; tightening would need an LRU of
  seen signatures — deferred as out-of-scope for this task.
- **FIX 3 (doc — empty-secret contract, no code change).** `src/triggers/webhook-verify.ts`
  — added a one-line contract comment on `verifyHmac`'s doc block: the caller
  MUST pass a non-empty secret (an empty HMAC key is attacker-computable);
  `verifyHmac` does not itself validate that, relying on two upstream guards
  (the handler's `if (!secret)` → 500, and the secret store's `load()`
  dropping empty/whitespace secrets at rest).

No nonce dedup added, rate limiter not reordered, HMAC/replay behavior
unchanged — matches the fix brief exactly.

**Gate:** `bun run typecheck` clean; `bun run lint:file` on the 4 touched
files clean; `bun run test:file -- tests/server/app.test.ts
tests/server/hooks-webhook.test.ts` → 32 pass / 0 fail (88 assertions);
broader regression `tests/server` + `tests/triggers` → 515 pass / 0 fail.
Commit `fix(triggers): webhook malformed-token 404 (was 500) + replay/empty-secret contract notes`.
