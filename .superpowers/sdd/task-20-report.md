# Task 20 report — `src/a2a/client.ts` + `src/a2a/canonical.ts` (CONSUME-side discover/validate/PIN, §7.3)

**Status:** DONE. Commit `f1cd431` — `feat(a2a): remote client discover/validate/PIN (canonical hash, redirect:error SSRF guard)` on `slice-31-a2a-multimachine`.

> Note: this path previously held a stale Slice-25b Task-20 report (different slice, same task number); it is preserved in git history and was overwritten per the task brief.

## Implemented
- **`src/a2a/canonical.ts`** — shared, deterministic card canonicalization/hash.
  - `canonicalizeCard(card)`: recursively **key-sorts objects, keeps arrays in order**, then `JSON.stringify`. Order-stable AND swap-safe AND array-order-significant (see self-check).
  - `hashCard(card)`: `sha256(canonicalizeCard(card))` hex.
- **`src/a2a/client.ts`** — `createA2aClient({ fetchImpl? })` → `{ discover, verifyPin, invoke }`, plus exported `RemoteAgent` / `DiscoverResult` types matching the brief's Produces block verbatim.
  - `discover(cardUrl)`: `noRedirectFetch` GET (`redirect:'error'`) → non-200 reject → JSON-parse → explicit `protocolVersion !== '1.0'` reject → `AgentCardSchema.safeParse` → `{ ok:true, card, pinnedCardHash: hashCard(card) }`.
  - `verifyPin(remote)`: re-fetches via the same guarded path; `hashCard(current) !== remote.pinnedCardHash` is a **HARD `{ ok:false }`** — never a silent re-pin (§7.3). Emits `a2a.client.discover` span outcome `pin-mismatch`.
  - `invoke(remote, method, params)`: for message-bearing methods validates `params.message` with `MessageSchema` (outbound guard), then POSTs a JSON-RPC 2.0 envelope to `remote.baseUrl` via `noRedirectFetch` with `Authorization: Bearer <token>` + `x-a2a-timestamp` + `x-a2a-nonce` (peer's Task-16 replay guard). JSON-RPC `error` → thrown; non-200 → thrown; else returns `result`.
  - Telemetry: `recordA2aClientDiscover` / `recordA2aClientInvoke` with **peer HOST only** (`new URL(...).host`), never the full URL, never the token.
- **`src/a2a/card.ts`** — removed the local `canonicalize`/`createHash`; `cardEtag` now delegates to the shared `hashCard`, so the expose-side ETag and the consume-side pin can never diverge.

## TDD RED → GREEN
- RED: `bun run test:file -- tests/a2a/canonical.test.ts tests/a2a/client.test.ts` → `Cannot find module '../../src/a2a/canonical.ts'` (2 fail, modules absent).
- GREEN (focused): `... canonical.test.ts client.test.ts card.test.ts` → **16 pass / 0 fail** (incl. the pre-existing `card.test.ts cardEtag` test still passing after the re-point).
- Full a2a suite: `bun test ./tests/a2a/` → **61 pass / 0 fail** across 11 files (no regressions).

Tests cover: canonicalize stable under key reorder (same hash), **swap-safe** (moved value → different hash), **array-order significant** (reordered inputModes/skills → different hash), 64-hex stability; discover happy-path pin, discover rejects `protocolVersion!=='1.0'`, discover rejects non-200, discover blocks a 302 host (+ asserts `redirect:'error'` was passed); verifyPin pass, verifyPin HARD-reject on altered card, verifyPin blocks a 301 host; invoke POSTs correct envelope + Bearer + freshness headers to baseUrl, invoke throws on JSON-RPC error.

## Gate
- `bun run typecheck` → clean.
- `bun run lint:file -- <5 files>` → clean (fixed 3 `noNonNullAssertion` + import-sort issues surfaced on first run).

## Self-review (SECURITY lens, §7.3)
- **Order-stable?** Yes — recursive key sort; the reorder test confirms identical hash for shuffled-key cards, so a benign peer re-serialize never false-trips the pin.
- **Swap-safe?** Yes — `JSON.stringify` preserves `"key":value` identity, so moving a value onto a different key changes the string → different hash (dedicated test).
- **Array order significant?** Yes — arrays recursed but never sorted (dedicated test).
- **`redirect:'error'` on ALL fetches (no SSRF)?** Yes — discover, verifyPin, and invoke all route through `noRedirectFetch` with `redirect:'error'`; a 3xx is rejected (belt-and-suspenders with the impl's redirect option). Redirect/transport failures are caught and returned as `ok:false`, never followed.
- **Hash mismatch = HARD reject, never silent re-pin?** Yes — `verifyPin` returns `{ ok:false }` and emits `pin-mismatch`; it never writes back a new pin.
- **Bearer never logged/span'd?** Yes — the token is only placed in the `Authorization` header to `remote.baseUrl`; spans carry `peerHost` (host only). Freshness headers are per-request random/time, not secrets.

## Concerns
- `invoke` uses `Date.now()`/`randomUUID()` for the replay headers directly (not injectable); fine for real use, no test needed to pin those. A downstream task wanting deterministic replay-header tests could thread a clock/nonce dep later.
- `invoke`'s outbound `MessageSchema` guard assumes `params.message` for `message/send`|`message/stream` (matches the server's `handleMessageSend`). Other methods pass `params` through unvalidated (correct — no message payload).

---

## Fix wave (§7.3 outbound-fetch DoS)

**Gap:** `discover` / `verifyPin` / `invoke` fetched from a REMOTE peer with NO request timeout and NO response-size cap. §7.3's threat model is a peer that turns malicious (the rug-pull the pin defends against — and `verifyPin` re-fetches from exactly that peer). Such a peer could (a) return an unbounded body → `res.json()` buffers it whole → memory-exhaustion DoS, or (b) hang the socket forever → the local process stalls. The Slice-21 reliability posture mandates wall-clock timeouts; they were missing on this outbound path.

### Fix
- **Two config knobs** (`src/config/schema.ts`, AGENT_A2A_* group, `{env,kind,def,doc}` shape, doc names read site `a2a/client.ts`): `AGENT_A2A_FETCH_TIMEOUT_MS` (number, def `15_000`) and `AGENT_A2A_MAX_CARD_BYTES` (number, def `262_144` = 256 KiB). Env-fallback only; never hardcoded at the call site. `createA2aClient(deps)` gained optional `timeoutMs` / `maxCardBytes` overrides (read from `loadConfig().values` when unset) so the guards are testable without touching `process.env`.
- **Timeout — `timedFetch(url, init)`** wraps `noRedirectFetch` for ALL three outbound fetches. It arms an `AbortController` + `setTimeout(timeoutMs)`: on timeout it `controller.abort()`s the real request AND rejects the returned promise itself (via a `Promise` race), so a hung peer rejects cleanly even when `fetchImpl` ignores the abort signal (the injected test stub does). `redirect:'error'` is still forced, so the existing SSRF guard is untouched. `discover`/`verifyPin` catch the rejection → `{ ok:false, reason:'card fetch failed (redirect, timeout, or transport)' }`; `invoke` lets it throw (caught by its caller). No hang, no unhandled throw.
- **Size cap — `readCappedJson(res)`** replaces `res.json()` on every read path. The cap is enforced **twice**: (1) a fast reject on the declared `Content-Length` (no bytes read), then (2) a running byte count while draining `res.body.getReader()` — the moment `total > maxCardBytes` it throws and `reader.cancel()`s the stream instead of buffering. **This is how the cap survives a lying/absent Content-Length:** a peer that omits or under-states the header still cannot slip an unbounded body through, because the streamed count aborts mid-flight (proven by a test that streams forever and would hang if the body were buffered whole). Over-cap → `ResponseTooLargeError` → `discover`/`verifyPin` `{ ok:false, reason:'...exceeds cap...' }` / `invoke` thrown-then-caught. Never OOM.

### RED → GREEN (4 new tests in `tests/a2a/client.test.ts`)
- **RED:** before the fix, `bun test tests/a2a/client.test.ts` **hung indefinitely** (killed at exit 144) — the "hung peer" stubs never resolve and the unbounded-stream stub buffers forever, which IS the bug the fix closes.
- **GREEN:** `bun test --timeout 15000 tests/a2a/client.test.ts` → **13 pass / 0 fail** (9 pre-existing + 4 new), 30 expect() calls, ~140ms (no hang).
- New cases: discover rejects a hung peer within the timeout (<2s, not the 15s default); invoke rejects a hung peer within the timeout; discover rejects an over-cap card by declared Content-Length (never buffered); discover rejects an over-cap body with a lying/absent Content-Length via the streamed byte-count guard (asserts a bounded number of stream pulls — proof of mid-stream abort, not whole-body buffering).

### Existing tests stay green
- Task-20 focused suite (`canonical.test.ts client.test.ts card.test.ts`): **16 → 20 pass / 0 fail** (the 4 additions; all 16 prior tests unchanged and green).
- Full a2a suite (`bun test tests/a2a/`): **61 → 65 pass / 0 fail** across 11 files — no regressions.

### Gate
- `bun run typecheck` → clean.
- `bun run lint:file -- src/a2a/client.ts src/config/schema.ts tests/a2a/client.test.ts` → clean (one Biome line-wrap fix applied).
- `bun run docs:check` → clean (living docs present + linked; every src subsystem documented).
