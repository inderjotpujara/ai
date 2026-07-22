# Task 16 report — Bearer gate on POST /api/a2a (verify-before-parse + replay + body cap)

**Slice 31 · Increment 5 · commit `8f6c1eb`**
`feat(a2a): Bearer gate on POST /api/a2a (verify-before-parse, replay window, body cap)`

## Implemented

The `POST /api/a2a` route now authenticates. Ordering in `handleA2aRpc` (after the
`AGENT_A2A_ENABLED`-off 404 fail-safe, which stays first):

1. **Extract `Authorization: Bearer` + length-cap up front** (`MAX_BEARER_TOKEN_LEN`,
   token.ts idiom). Absent / non-Bearer / over-long → `401` before any crypto.
2. **`deps.enrollment.verify(raw)` BEFORE the JSON-RPC body is read.** Verify failure →
   `401` and the body is NEVER parsed. A thrown verify (corrupt registry, fail-closed
   per Task 15) is caught → `401` deny, never a 500/crash.
3. **Replay guard** against `x-a2a-timestamp` (seconds→ms) + `x-a2a-nonce`: missing
   nonce / non-finite ts → `401`; stale ts or replayed nonce → `409`. Enforced before
   dispatch.
4. **Only then** `req.json()` + dispatch (the `maxRequestBodySize` 413 fronts the
   handler at `Bun.serve`).

The Bearer / timestamp / nonce never enter a log, DTO, or span — rejections return a
fixed featureless `{ error }` body.

### Files changed
- **Created** `src/a2a/replay-guard.ts` — `createReplayGuard(windowMs, now?)` → `{ check(nonce, tsMs) }`.
  Bounded insertion-ordered LRU (`Map`), evicts entries past the window on each check, hard
  cap `MAX_SEEN_NONCES=50_000`. `401` for malformed proof, `409` for stale/replay.
- **Modified** `src/server/a2a/rpc.ts` — the gate above; lazy process-wide replay-guard
  singleton keyed to `AGENT_A2A_REPLAY_WINDOW_MS` (state must persist across requests).
  Removed the "Task 16 seam" comment; updated the module header to the shipped posture.
- **Modified** `src/a2a/server.ts` — grew `A2aServerDeps` with required `enrollment: A2aEnrollment`.
- **Modified** `src/server/app.ts` — updated the `ServerDeps.a2a` doc (enrollment/Task 16);
  the route already passes the whole `A2aServerDeps`, so enrollment is threaded by type.
- **Tests created** `tests/a2a/replay-guard.test.ts`, `tests/server/a2a-auth.test.ts`.
- **Tests updated** (required-field + gate-now-fronts-them): `tests/server/a2a-rpc-route.test.ts`
  (real enrollment + valid Bearer/replay headers on the two reachability tests),
  `tests/server/a2a-card-route.test.ts`, `tests/a2a/server.test.ts`,
  `tests/a2a/consent-fail-closed.test.ts`, `tests/server/a2a-stream-route.test.ts` (stub enrollment
  for dispatch-level harnesses that bypass the route gate).

## TDD RED → GREEN

**RED** (`bun test tests/a2a/replay-guard.test.ts tests/server/a2a-auth.test.ts`):
`1 pass / 8 fail / 1 error` — replay-guard suite errored (module absent); auth suite
returned `200` where `401`/`409` expected (route ungated).

**GREEN** (after implementation), focused:
`bun test tests/a2a/replay-guard.test.ts tests/server/a2a-auth.test.ts tests/server/a2a-rpc-route.test.ts tests/server/a2a-card-route.test.ts`
→ `19 pass / 0 fail`.

Full a2a + server suites: `bun test tests/a2a tests/server` → **522 pass / 0 fail** (103 files).

## Gate
- `bun run typecheck` — clean (after adding enrollment to the 5 downstream A2aServerDeps sites).
- `bun run lint:file -- <11 files>` — clean (one biome format auto-fix applied).
- `bun run docs:check` — pass.

## Self-review (SECURITY lens, §7.2)
- **Verify PROVABLY precedes parse:** step 2 (`enrollment.verify`) runs before the only
  `req.json()` call (step 4). The `no/absent Bearer → 401 BEFORE parse` test sends a
  malformed body with no Bearer and asserts `401` with NO `jsonrpc` field — a parse error
  would have been HTTP 200 `-32700`. Proven.
- **Thrown verify caught → 401:** `try/catch` around `deps.enrollment.verify`. The
  corrupt-registry test issues a valid-sig token, corrupts the registry on disk, presents
  the token → verify's re-read throws → route returns `401` (asserted `not 500`).
- **D5 device token rejected:** the route consults ONLY `deps.enrollment` (A2A store),
  never the device session guard. Test mints a real session token sharing the same root →
  `enrollment.verify` returns false (no `kind:'a2a'`) → `401`.
- **Replay enforced pre-dispatch:** same nonce+ts twice → second is `409`; a ~1h-stale ts
  → `409`; both before body dispatch.
- **No secret in logs/spans:** no `console.*`; rejections carry a fixed generic body; the
  handleApi span records only route/method/status, never the token/ts/nonce.
- **DoS guard:** over-long Bearer rejected before verify; replay LRU hard-capped.

## Concerns
- The replay guard is a **lazy process-wide singleton** in rpc.ts (state must persist
  across requests; not in the brief's `ServerDeps.a2a` grow-list, so not injected). It
  reads the window once on first use. Acceptable and testable (unit test drives
  `createReplayGuard` directly with an injected clock); noting the design choice.
- `deps.a2a` (hence `enrollment`) is **not yet wired into a live daemon/main** — no
  production construction site exists yet (only tests construct `A2aServerDeps`). Live
  wiring is a downstream increment; nothing here breaks boot.
