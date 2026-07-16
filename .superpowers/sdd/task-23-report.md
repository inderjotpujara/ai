# Task 23 report — `POST /api/mcp/test-mount` (SSE, closes the D10 consent gap)

Slice 30b Phase 5, Increment 4 (MCP). Commit `53dc2a3`
`feat(server): POST /api/mcp/test-mount — closes the D10 silent-skip consent gap (Phase 5)`.

## What I implemented

The interactive MCP test-mount route: `POST /api/mcp/test-mount` SSE-streams an
attempt to mount ONE configured MCP server, pausing mid-flow for consent (the
D10 silent-skip gap), on the SAME AI-SDK UI-message-stream wire contract the
builder route (T11 `src/server/builders/build.ts`) established and the T13 web
fold consumes.

Files changed (6):
- `src/contracts/requests.ts` — appended `McpTestMountRequestSchema = z.object({ name: z.string() })` + type.
- `src/cli/with-mcp-run.ts` — changed `function buildAuthProviders` → `export function buildAuthProviders` (doc comment added). No behavior change; `withMcpRun` still calls it at line 97 exactly as before.
- `src/server/mcp/mount-one.ts` (new) — the injectable single-entry mount seam: `McpMountOne` type + `createRealMcpMountOne()`. Live-verified in T31, not unit-tested (mirrors Phase-4 `launch-turns.ts` `createRealRunCrewTurn` discipline).
- `src/server/mcp/test-mount.ts` (new) — `handleMcpTestMount(req, deps)`.
- `tests/cli/with-mcp-run.test.ts` — added the `buildAuthProviders` export regression test (+ `test`, `buildAuthProviders` imports).
- `tests/server/mcp-test-mount.test.ts` (new) — 5 handler tests incl. the adversarial suspend/resume case.

`src/mcp/mount.ts` has **ZERO diff** (verified `git diff --stat src/mcp/mount.ts` → empty). The `isTTY: true` override lives entirely in the new `createRealMcpMountOne`, passed as a per-call `consent` override to `mountAll(config, { consent })`; the CLI's own `mountAll(config)` path (`withMcpRun`) keeps its `isTTY: interactiveTTY()` default untouched.

## TDD evidence (RED → GREEN)

1. **`buildAuthProviders` export test** — wrote test importing `buildAuthProviders`; RED: `SyntaxError: Export named 'buildAuthProviders' not found in module .../with-mcp-run.ts`. Applied the `export`; GREEN: 9 pass.
2. **Handler tests** — wrote all 5 `tests/server/mcp-test-mount.test.ts` cases; RED: `Cannot find module '.../test-mount.ts'`. Created `test-mount.ts`; GREEN: 5 pass.

Final gate (all three, clean):
- `bun run typecheck` → 0 errors.
- `bun run lint:file -- <6 files>` → "Checked 6 files. No fixes applied." (0 errors, 0 warnings).
- `bun test tests/server/mcp-test-mount.test.ts tests/cli/with-mcp-run.test.ts` → **14 pass / 0 fail / 28 expect()**.

## Wire-frame shapes (confirmed SAME contract as T11)

The events sink is byte-identical to `build.ts`:
`const events: EventSink = (e) => writer.write({ type: e.type, data: e, transient: true });`

Frames emitted, in order, for a successful mount:
- `{ type: 'data-run-start', data: { type:'data-run-start', runId }, transient:true }`
- `{ type: 'data-mcp-mount', data: { type:'data-mcp-mount', server, outcome:'mounting' }, transient:true }`
- (if consent needed) `{ type: 'data-confirm', data: { type:'data-confirm', promptId, kind:'mcp-mount', question }, transient:true }`
- `{ type: 'data-mcp-mount', data: { ..., outcome:'mounted' | 'skipped' | 'warn: …' }, transient:true }`
- terminal `{ type: 'data-mcp-server', data: <McpServerDTO>, transient:true }` (or `mapMcpDormantToDto(...)` for a dormant entry)
- `{ type: 'data-run-end', data: { type:'data-run-end', runId, outcome:'done' }, transient:true }`

`StatusEventType` values are the `data-*` strings (`data-run-start`/`data-mcp-mount`/`data-confirm`/`data-run-end`), so every part is a valid AI-SDK custom data part and the T13 `postSseStream`/fold reads them exactly as it does builder frames. Terminal DTO rides as a structured `data` part (same discipline as T11's `data-build-result`), so T25 reads `part.data` directly — the type name differs (`data-mcp-server` vs `data-build-result`) because the payload differs, but the {top-level type + data} shape matches.

Divergence from T11 (deliberate, per brief Step 8): the terminal `data-mcp-server` part is `transient:true`, whereas T11's `data-build-result` is NOT transient. Rationale: a test-mount stream is entirely ephemeral status (there is no persisted "message" for a connectivity check), unlike a builder build that produces a persisted result. All test-mount frames are transient.

## Consent pause/resume + promptId lifecycle + abort/timeout + span-once

- **Pause/resume**: `ask` calls `deps.consent.port({ kind:'mcp-mount', question }, events)`, which mints a fresh unguessable promptId (`randomBytes(32).toString('hex')`), emits the `data-confirm` frame through the same sink, and returns a Promise that stays pending until `consent.resolve(promptId, value)` — the SAME mechanism `POST /api/runs/:id/respond` (`handleRespond` → `consent.resolve`) uses. The adversarial test proves the genuine suspend: it reads the stream until the `data-confirm` frame's promptId lands, asserts `consent.pending()` contains it AND `askedOutcome` is still `undefined` (execute is suspended inside `mountOne`), then calls `resolve(promptId, true)` and drains — `askedOutcome` becomes `'approved'`. Frames flush incrementally (the test receives the confirm frame before resolving), confirming no event-loop stall / no buffering-until-return.
- **promptId lifecycle**: fresh per ask; `resolve` does delete-then-invoke (second resolve is a no-op returning false); unknown/settled ids return false. The registry is unchanged by this task.
- **abort/timeout fail-closed**: this route does NOT itself add a wall-clock cap around the `ask` await — see Concerns; per brief note (c) this is a filed fast-follow, not central to the D10 closure. A client disconnect mid-await leaks one pending resolver (identical to the accepted builder behavior documented in `build.ts` `withConfirmTimeout`), and the unguessable promptId prevents any cross-talk with a later unrelated test-mount (verifier requirement (c)). `execute` is not detached, so an abort never tears the attempt down mid-stage.
- **span/run ended exactly once**: `withRunTelemetry` creates the run and shuts telemetry down once in its `finally`. RunStart/RunEnd emit once each. The `mcp.mount` span is opened+closed once by `withMcpMountSpan` inside `createRealMcpMountOne` (inside `withRunContext`, so it lands in `runs/<id>/spans.jsonl`). The terminal `data-mcp-server` part is written exactly once per attempt: the dormant branch and the mount branch are mutually exclusive via an early `return` (verifier requirement (d)).

## OAuth (fork-2) — reuses the existing loopback, NO new BFF route

`createRealMcpMountOne` builds providers via the reused `buildAuthProviders(config)` from `src/cli/with-mcp-run.ts` (now exported), which calls `createOAuthProvider` (the Slice-26 loopback-pop: ephemeral 127.0.0.1 callback + `Bun.spawn(open)`). No `/api/mcp/oauth/callback` BFF route was created (`grep -rn 'oauth/callback' src/server/` → none). The `buildAuthProviders` regression test confirms a provider is built for an `oauth` HTTP entry. The BFF callback route stays reserved/documented for later, per the locked fork-2 decision.

## Shared-helper factoring

The reusable piece factored was `buildAuthProviders` (promoted from module-private to exported in `with-mcp-run.ts`) so `mount-one.ts` reuses the exact CLI OAuth-provider construction rather than duplicating it. No other T9/T11 machinery was duplicated — the events sink, `createUIMessageStream`/`createUIMessageStreamResponse`, and `ISOLATION_HEADERS` are used directly. I did NOT touch `build.ts` (builder route behavior unchanged, as instructed).

## Self-review (fresh eyes) + concerns

Concurrency reasoning: the only shared mutable state is `ConsentRegistry.pendingResolvers`, keyed by a 256-bit random promptId — concurrent test-mounts cannot collide. `McpMountStatus` is a per-name `Map.set`/`get` with no read-modify-write race. Each request mints its own runId and its own scoped registry inside `mountOne`; nothing is shared across requests. Frames flush incrementally (proven by the adversarial test), so a suspended consent does not block the event loop.

Concerns / notes for the adversarial-verify:
1. **Wall-clock cap on `ask` (fast-follow, per brief note (c))**: unlike the T11 builder route (which wraps `confirm` in `withConfirmTimeout` → decline on timeout), T23 does NOT cap the consent await. The brief explicitly scoped this out ("file it as a fast-follow ... not central to the D10 gap-closure"). Recommended fast-follow within Phase 5: wrap `deps.mountOne(...)`'s `ask` in the same wall-clock→false cap (a ~2-line change, factoring `withConfirmTimeout` out of `build.ts` into a shared consent helper to avoid divergent duplication). No correctness bug today — a leaked resolver is memory-only and cross-talk-safe.
2. **`name` not length-bounded**: `McpTestMountRequestSchema` uses bare `z.string()` (per brief), whereas `McpAddRequestSchema` bounds `name` to `.max(128)`. Low risk here — `name` is only used for an in-memory `find` against the config and is never persisted; an oversized name simply misses and returns 404. Could add `.max(128)` for consistency if desired.
3. **Real seam untested by unit tests**: `createRealMcpMountOne` is covered by T31 live-verify only (deliberate, mirrors `launch-turns.ts`). The handler tests inject a mock `McpMountOne`, so the handler's stream/consent/DTO logic is fully unit-covered while the real mount wiring is deferred to live-verify.

Status: DONE. All five handler tests (incl. adversarial suspend/resume) + the export regression test pass; typecheck + lint clean; `src/mcp/mount.ts` zero-diff; OAuth reuses the engine loopback; no new BFF route.

## Follow-up fix (post-verify) — 2026-07-16

Two Important findings from the Task 23 adversarial-verify, fixed by making T23 match the proven T11 builder-route pattern (`src/server/builders/build.ts`). `src/mcp/mount.ts` untouched (zero-diff); no new BFF OAuth route.

**Finding 1 — no wall-clock cap on the consent await (perpetual run + held connection + leaked telemetry).** Fixed by importing T11's own helpers verbatim — `withWallClock` (`src/reliability/timeout.ts`) + `confirmWaitMs` (`src/server/builders/config.ts`, ~15min default via `AGENT_BUILDER_CONFIRM_WAIT_MS`) — and adding the identical `withConfirmTimeout(ask) = withWallClock(confirmWaitMs(), ask).catch(() => false)` helper. The consent `ask` is now `withConfirmTimeout(() => askRaw(question))`, so an abandoned/never-answered confirm settles as a DECLINE (false, fail-closed — never auto-approve). That decline flows through `mountOne` to a normal 'skipped' terminal, `execute` completes, and the `mcp.mount` span + run-scoped telemetry close via `withRunTelemetry`'s `finally` instead of leaking on the daemon. (Resolves the concern I had filed as fast-follow note #1 above.)

**Finding 2 — no try/catch around `mountOne` (terminal frame + RunEnd skipped on throw).** Fixed by mirroring `build.ts`'s try/catch around `runBuilderTurn`: the mount is wrapped so on ANY throw (reg.close / buildAuthProviders / withMcpMountSpan) we synthesize a 'skipped' terminal carrying the error as its `reason`, then record + emit the `data-mcp-server` frame + `data-run-end` on the shared path after the try/catch. Terminal is now written **exactly once on every path** — mounted, skipped/declined, timeout-decline, and throw — with a single `writer.write({type:'data-mcp-server'})` reached by all branches (dormant branch stays mutually-exclusive via early return).

**Tests added (TDD):** `[REVIEW-FIX a]` forces a tiny `AGENT_BUILDER_CONFIRM_WAIT_MS=20` (same env var `confirmWaitMs()` reads — no new mechanism, no 15min wait), a consent that never settles → asserts the timed-out consent resolves to a DECLINE, terminal `skipped` + `data-run-end` emitted, `data-mcp-server` exactly once, and `execute` completes (no hang). `[REVIEW-FIX b]` a throwing `mountOne` → asserts status 200 (never 500), terminal `data-mcp-server` exactly once, error surfaced as the reason, `data-run-end` present.

**Gate:** `bun test tests/server/mcp-test-mount.test.ts` → 7 pass / 0 fail (5 existing green + 2 new); broader `bun test tests/server/ tests/cli/with-mcp-run.test.ts` → 152 pass / 0 fail. `bun run typecheck` clean; `bun run lint:file -- src/server/mcp/test-mount.ts tests/server/mcp-test-mount.test.ts` → 0 errors. `git diff src/mcp/mount.ts` empty (zero-diff). No new OAuth route.
