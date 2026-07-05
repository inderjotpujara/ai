# Task 2 report — Process supervisor (spawn + health-poll + reuse + stop)

## Changes
- Created `src/runtime/process-supervisor.ts`:
  - Exports `ChildHandle`, `SpawnFn`, `SupervisedServer`, `SuperviseDeps`, `SuperviseCfg` types exactly per the brief's interface block.
  - `superviseServer(cfg, deps)`: spawns via `deps.spawn ?? defaultSpawn`, computes `baseUrl = http://{host}:{port}{basePath}` and `healthUrl = http://{host}:{port}{healthPath}`, then polls `healthUrl` every `pollMs` (default 250) inside `withWallClock(startTimeoutMs, ...)` (default 30000) from `src/reliability/timeout.ts`. Each poll wraps `fetchImpl` in a try/catch (network errors/non-ok just fall through to the next poll) and calls `healthOk(res)` (default `res.ok`) to decide readiness. On the wall-clock's `Error('timeout')` rejection, the child is killed with `SIGTERM` and the function throws `Error('runtime failed to become healthy after ${startTimeoutMs}ms')`.
  - `stop()` on the returned `SupervisedServer` sends `SIGTERM` to the child.
  - `defaultSpawn` uses `Bun.spawn` exactly as given in the brief's snippet (stdout/stderr ignored, env merged with `process.env`).
- Created `tests/runtime/process-supervisor.test.ts` — the two tests from the brief, verbatim, with one adjustment: removed the unused `type ChildHandle` import (flagged by biome's `noUnusedImports`; the test never references `ChildHandle` directly, only via `SpawnFn`'s return type).

## Test output (verbatim)

Before implementation (confirming failure):
```
bun test v1.3.11 (af24e281)

tests/runtime/process-supervisor.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../../src/runtime/process-supervisor.ts' from '/Users/inderjotsingh/ai/tests/runtime/process-supervisor.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [16.00ms]
```

After implementation:
```
bun test v1.3.11 (af24e281)

 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [46.00ms]
```

## Typecheck
```
$ tsc --noEmit
```
(no output — clean)

## Lint
```
$ biome check src/runtime/process-supervisor.ts tests/runtime/process-supervisor.test.ts
Checked 2 files in 3ms. No fixes applied.
```
(Ran `bunx biome check --write` once first to apply the project's formatting style — trailing multi-line object/import formatting — which biome's own formatter enforces; the unused `ChildHandle` import was an unsafe fix so I removed it by hand since it's genuinely unused.)

## docs:check
```
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```
No architecture.md change was needed — `src/runtime/` is an existing documented subsystem; this task adds one more file to it, not a new top-level subsystem.

## Commit
```
$ git commit -m "feat(runtime): process supervisor with health-poll + kill-on-timeout" (+ body)
[slice-26-altruntime-remote-auth d0b6d7b] feat(runtime): process supervisor with health-poll + kill-on-timeout
 2 files changed, 154 insertions(+)
 create mode 100644 src/runtime/process-supervisor.ts
 create mode 100644 tests/runtime/process-supervisor.test.ts
```
Only the two task files were staged/committed; other files already modified in the working tree (`.remember/*`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`, task-1 files) were left untouched as out of scope for this task.

## Self-review
- Interfaces match the brief's `Produces` block exactly (types, function signature, defaults: `startTimeoutMs` 30000, `pollMs` 250, `healthOk` defaults to `res.ok`).
- Poll loop matches the brief's pseudocode: per-poll `fetchImpl` call wrapped in try/catch, `AbortSignal.timeout(pollMs + 1000)` per attempt, `sleep(pollMs)` between attempts, whole loop wrapped in `withWallClock`.
- On timeout: child killed with `SIGTERM`, then rethrown with the more descriptive `after ${startTimeoutMs}ms` message (per the task instructions' "Key context," which is stricter than the brief's plain `Error('runtime failed to become healthy')` — the test only asserts `.rejects.toThrow('healthy')`, a substring match, so both messages satisfy it; used the more informative one per the explicit key-context instruction).
- `defaultSpawn` copied verbatim from the brief's snippet.
- `stop()` kills the child but does not await its exit; the brief's spec for `stop()` is just "kills the child (SIGTERM)" with no wait-for-exit requirement, so this matches spec.
- No lingering timers: `withWallClock`'s `finally` clears its own timer; the poll loop's `setTimeout` calls are one-shot and not stored/leaked beyond their own resolution.

## Concerns
- Minor, non-blocking: `stop()` does not await the child's actual exit (only sends the signal) — matches the brief's literal spec, but a later "managed base" task building on this may want a `stop()` that resolves only after `onExit` fires, if callers need a synchronous-shutdown guarantee before reusing the port.

## Fix: orphaned health-poll loop after wall-clock timeout (reviewer finding)

**Finding:** In `superviseServer`, the health-poll `for (;;)` loop inside `withWallClock`'s callback was the "loser" of the internal `Promise.race` in `src/reliability/timeout.ts` — when the wall-clock deadline won the race, `withWallClock` rejected and `superviseServer` threw, but the loser promise (the poll loop) was never cancelled and kept running forever, repeatedly calling the (by then killed) health endpoint. Unbounded orphaned loop burning CPU/sockets in production.

**Fix (`src/runtime/process-supervisor.ts`):**
- Hoisted `let timedOut = false;` above the `try` block (previously the loop used `for (;;)`).
- Changed the poll loop to `while (!timedOut)`.
- In the `catch` block (kill-child + rethrow "failed to become healthy" path), set `timedOut = true` before killing the child and throwing, so the still-in-flight loop iteration observes the flag on its next check and exits instead of looping forever.
- Success path and fetch-throws-while-not-timed-out behavior unchanged (fetch errors are still swallowed and the loop keeps retrying until either health succeeds or the timeout flag flips).

**Regression test added (`tests/runtime/process-supervisor.test.ts`):**
`'stops polling the health endpoint once the wall-clock deadline wins'` — uses an always-throwing `fetchImpl` that counts calls, `pollMs: 0`, `startTimeoutMs: 20`. Awaits the rejection (`.rejects.toThrow('healthy')`), records the call count at rejection, waits ~100ms, then asserts `calls - callsAtRejection <= 1` (allows at most one in-flight call that was already started before the flag flipped; proves the loop does not keep looping indefinitely).

### Commands run

```
$ bun test tests/runtime/process-supervisor.test.ts
bun test v1.3.11 (af24e281)

 3 pass
 0 fail
 5 expect() calls
Ran 3 tests across 1 file. [170.00ms]
```

```
$ bun run typecheck
$ tsc --noEmit
```
(no output — clean)

```
$ bun run lint:file src/runtime/process-supervisor.ts tests/runtime/process-supervisor.test.ts
$ biome check src/runtime/process-supervisor.ts tests/runtime/process-supervisor.test.ts
Checked 2 files in 4ms. No fixes applied.
```

### Commit
Committed as a fix on branch `slice-26-altruntime-remote-auth` (see git log for SHA), scoped to `src/runtime/process-supervisor.ts`, `tests/runtime/process-supervisor.test.ts`, and this report file.

### Concerns
None outstanding — the fix is minimal and behavior-preserving on the success and "still retrying" paths; only the timeout-then-orphaned-loop path changes (loop now terminates).
