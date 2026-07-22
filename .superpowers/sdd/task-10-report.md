# Task 10 report — Wire `POST /api/a2a` JSON-RPC route (session-guard exception)

**Slice 31 (A2A interop), Increment 3. Commit `6ed0be6`.**

## Implemented

- **`src/server/a2a/rpc.ts` (new)** — `handleA2aRpc(req, deps: A2aServerDeps): Promise<Response>`:
  - **404 when `AGENT_A2A_ENABLED` is off** (fail-safe, `loadConfig().values.AGENT_A2A_ENABLED !== true` → featureless `notFound()`, identical shape to the card route so a caller past the perimeter cannot distinguish "A2A off" from "no such route").
  - Parses the JSON body (JSON-parse failure → JSON-RPC `-32700` Parse Error, `id: null`).
  - Best-effort `extractId` echoes the caller's `id` (string/number/null) on the response envelope even for an invalid envelope.
  - Calls `dispatchA2aRpc(body, deps)` (Task 9) and wraps the `A2aRpcResult` as a `JsonRpcResponse` validated by `JsonRpcResponseSchema.parse`. JSON-RPC rides **HTTP 200** for both success and application errors; the only non-200 is the enable-gate 404.
  - An explicit **"Task 16 seam"** comment marks where the A2A-Bearer check slots in — on `req`'s Authorization header, against the SEPARATE A2A token store (D5), before any parse/dispatch.

- **`src/server/app.ts` (modified)**:
  - Grew `ServerDeps.a2a` from `{ allowlist: A2aAllowlist }` to `A2aServerDeps` (allowlist + jobStore + runsRoot + taskIndex, plus the optional `pool` Task 12 wires). Swapped the `A2aAllowlist` import for `A2aServerDeps`; added `handleA2aRpc` import. The card route still reads only `.allowlist`.
  - **Guard exception** in `buildFetch`: added `isA2aRpc = POST && /api/a2a` alongside `isBeacon`, so `POST /api/a2a` is let past the **device session** guard (`!isBeacon && !isA2aRpc && !guard.verify(req)`). This is inside the `/api` block, which runs AFTER `enforcePerimeter` — so the route stays behind the Host/Origin perimeter.
  - **Route** in `handleApi` (next to `/api/telemetry`): `handleA2aRpc(req, need(deps.a2a, 'a2a'))`, reflecting the real status into the request span.

- **`tests/server/a2a-card-route.test.ts` (modified)** — its `a2a: { allowlist }` was widened to the full `A2aServerDeps` (jobStore/runsRoot/taskIndex) so the grown type typechecks; card behavior unchanged (still 4/4 pass).

## TDD RED → GREEN

**RED** — wrote `tests/server/a2a-rpc-route.test.ts` (3 tests) before implementing:
```
$ bun run test:file -- "tests/server/a2a-rpc-route.test.ts"
Expected: 200 / 404 … Received: 401   (all 3 fail — blocked by the session guard, route unwired)
 0 pass  3 fail
```

**GREEN** — after `rpc.ts` + app.ts wiring:
```
$ bun run test:file -- tests/server/a2a-rpc-route.test.ts tests/server/a2a-card-route.test.ts tests/a2a/server.test.ts
 14 pass  0 fail  48 expect() calls
```

The three route tests assert: (1) reachable with NO Authorization header → 200 + JSON-RPC error `-32600` (NOT a 401 from the guard); (2) `message/send` to allowlisted skill `ask` → 200, `id` echoed, `result.kind === 'task'`, `result.status.state === 'submitted'`; (3) flag off → 404.

## Gate

```
bun run typecheck   → clean (tsc --noEmit)
bun run lint:file   → clean (biome; auto-format applied to import sort + line wraps)
bun run docs:check  → pass (no src subsystem undocumented — src/server/a2a already covered)
```

## Security self-review

- **Past the device guard, behind the perimeter?** YES. The `isA2aRpc` exception only skips `guard.verify(req)`; it lives inside the `url.pathname.startsWith('/api')` block, which is reached only after `enforcePerimeter(req, deps.policy)` returns no block. Test 1 (no Authorization → 200, not 401) is the positive proof of "past the device guard"; the perimeter still fronts it.
- **404-when-off holds?** YES — enforced inside `handleA2aRpc` (test 3). Mirrors the card route exactly.
- **Device token can NEVER be mistaken for the A2A Bearer (D5)?** YES, structurally. `handleA2aRpc` is handed only `A2aServerDeps` — it receives no `guard`, no `sessionTokens`, no device registry, and reads no `Authorization` header at all. It is impossible for a device session token to satisfy A2A auth through this path. The device-session guard is bypassed, not re-consulted.
- **T16 can add Bearer cleanly?** YES — the seam is a single documented insertion point at the top of the enabled handler, operating on `req` against a separate store, before envelope parse/dispatch. No refactor of the device path required.

## Concerns

- **Pre-Bearer window (the intended, documented gap).** Between this commit and Task 16, if `AGENT_A2A_ENABLED` were turned on, `POST /api/a2a` would accept UNAUTHENTICATED JSON-RPC from any caller that clears the Host/Origin perimeter — including `message/send`, which creates a run and enqueues an `origin=Remote` job (allowlist §7.4 still rejects unlisted skills pre-enqueue, so only allowlisted skills are reachable). This is SAFE under two invariants and only those: (a) `AGENT_A2A_ENABLED` defaults **off** (route 404s), and (b) Slice 31 increments never ship independently — the slice merges to main only at the end, after Task 16 adds the Bearer. If either invariant is broken (e.g. someone flips the flag on a partial build), the surface is open. Task 16 MUST land before any enabled deploy.
- **503-vs-404 asymmetry when disabled.** If A2A is off AND `deps.a2a` is unwired, the route returns 503 (via `need()`) rather than 404 (the enable-gate never runs). This is identical to the card route's established behavior (`if (!deps.a2a) return 503` precedes the handler's 404-when-off), so it is consistent, not new — but a disabled+unwired daemon technically returns a different status than a disabled+wired one. Minor; matches the accepted card-route pattern.

## Files changed
- `src/server/a2a/rpc.ts` (new)
- `src/server/app.ts` (a2a type grown, guard exception, route)
- `tests/server/a2a-rpc-route.test.ts` (new)
- `tests/server/a2a-card-route.test.ts` (a2a dep widened to typecheck)
