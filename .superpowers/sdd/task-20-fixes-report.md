# Slice-26 whole-branch final-review fixes (Task 20)

Branch: `slice-26-altruntime-remote-auth`

## FIX 1 — single-flight/serialized `warm` (`src/runtime/managed-openai-compatible.ts`)

**Problem.** `doWarm` (reuse-check → `stopCurrent` → `portAlloc` → spawn → set
`current`) had no mutual exclusion, but the workflow engine warms runtimes
concurrently (parallel agent-step batches call `rt.control.warm` per step).
Two concurrent warms on the same runtime singleton raced on the single
`current` slot:
- same `(model, ctx)` → both pass the reuse check before either sets
  `current` → both spawn → one process orphaned (leaked port + RAM).
- different models → both read `current` as unset/stale → each calls
  `stopCurrent()` on what it thinks is current, or overwrites `current` out
  from under the other → SIGTERM racing a just-spawned server mid-request.

**Fix — a per-instance promise-chain queue ("single-flight lock"), not a
mutex library.** Added inside `createManagedRuntime` (module-instance scope,
so each managed runtime has its own independent queue — no cross-runtime
contention):

```ts
let warmQueue: Promise<void> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const turn = warmQueue.then(fn, fn);
  warmQueue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}
```

`warm` becomes:

```ts
warm: (model, numCtx) =>
  breaker.run(() => serialized(() => doWarm(model, numCtx))),
```

**How it works.** `warmQueue` is a scheduling gate, not a result carrier.
Each call chains its turn (`fn`) onto the *tail* of the queue via
`.then(fn, fn)` — so `fn` (the actual `doWarm` body) runs only after every
previously-queued turn has settled, whatever their outcome. The queue itself
(`warmQueue = turn.then(() => undefined, () => undefined)`) is rewritten to a
promise that **always resolves**, regardless of whether `turn` resolved or
rejected — so a throwing `doWarm` still hands the baton to the next queued
caller instead of poisoning the chain (no deadlock/wedge). The caller-facing
promise returned by `serialized` (`turn`) still carries the real
resolution/rejection, so `breaker.run` still sees success/failure correctly
and callers still get the real error.

Because JS is single-threaded and both synchronous halves of two concurrent
`warm()` calls (up to their first `await`) run in call order before either
continuation resumes, the queue order matches call order deterministically
— useful for asserting ordering in tests without artificial delays.

Kept unchanged: `breakerFor('runtime:' + kind)` still wraps the whole
serialized turn, `withRuntimeSpan` telemetry inside `doWarm` untouched,
`warm`'s signature/return type untouched.

**Error-release guarantee (self-review ask).** `serialized`'s `turn` is
built with `.then(fn, fn)` — `fn` runs whether the *previous* turn resolved
or rejected. And `warmQueue`'s replacement (`turn.then(() => undefined, () =>
undefined)`) uses a two-arg `.then` that converts **either** outcome of the
turn just run into a resolved `undefined` — so the queue is never left in a
rejected state. A `warm()` that throws (e.g. `launch()` throws, or
`superviseServer` times out) rejects its own `turn` (so the throwing
caller's `await rt.control.warm(...)` correctly rejects), but the *queue*
moves on immediately. Verified with a dedicated test (see below).

## FIX 2 — token-store temp-file hardening (`src/mcp/token-store.ts`)

**Problem.** `writeFileSync(tmp, ..., { mode: 0o600 })` only applies `mode`
on file **creation** — if `${path}.tmp` (a predictable name) already exists
from a prior crashed write, `writeFileSync` reuses the existing inode/mode
and permissions stay whatever they were (potentially group/world-readable).
Worse: if that leftover is a symlink planted by another local user,
`writeFileSync` follows it and writes secrets through to the symlink target.

**Fix.** In `writeTokenStore`:
```ts
const tmp = `${path}.tmp`;
rmSync(tmp, { force: true });               // NEW: drop any stale temp/symlink first
writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
chmodSync(tmp, 0o600);                      // NEW: re-assert mode regardless of prior state
renameSync(tmp, path);
chmodSync(path, 0o600);                     // unchanged (belt-and-suspenders)
```
`rmSync(tmp, { force: true })` unlinks whatever is at that path (silently
no-ops if absent) — for a symlink, unlinking removes the link itself, not
the target, so `writeFileSync` right after is guaranteed to create a fresh
regular file rather than following a stale link. `chmodSync(tmp, 0o600)`
immediately after write is a second belt-and-suspenders in case a future
refactor changes creation semantics.

**Test added** (`tests/mcp/token-store.test.ts`): pre-creates
`${path}.tmp` with mode `0o644`, then calls `setServerAuth` and asserts (a)
the stale temp is gone, (b) the final file is `0o600`, (c) the write
succeeded normally. Existing token-store tests are unaffected (round-trip,
missing-file, corrupt-file, merge, directory-mode, path-default) — all still
pass.

## FIX 3 — hygiene

- Added `beforeEach(() => resetBreakers())` at the top of
  `tests/runtime/managed-openai-compatible.test.ts`. The breaker registry in
  `src/reliability/breaker.ts` is a shared module-level `Map` keyed by
  `runtime:<kind>` — without a reset, the existing "emits outcome=failed"
  telemetry test (which intentionally trips a failure) could leak state
  into any later test reusing `RuntimeKind.LlamaCpp`, including the new
  concurrency tests below it in file order.
- Added a `control.unload` → `daemonUnload` coverage test: builds a
  daemon-style (`daemonLoad`/`daemonUnload`, `contextCapability: 'reload'`,
  LM-Studio-shaped) fake strategy, warms it, calls `control.unload('m')`,
  and asserts `daemonUnload` was invoked with the model name. This closes
  the previously-logged gap where `stopCurrent`'s `daemonUnload` branch had
  no direct test (it was only exercised indirectly via `daemonLoad`'s own
  test, which never unloads).

## New concurrency tests (`tests/runtime/managed-openai-compatible.test.ts`, describe block "warm concurrency (Slice 26 final review — single-flight)")

1. **Same `(model, ctx)` concurrently** — `Promise.all([warm('m',4096),
   warm('m',4096)])` → strategy's `launch` call-count asserted `=== 1`
   (second call reuses `current` instead of spawning again). This is the
   test that fails without the fix (both calls would launch before FIX 1).
2. **Different models concurrently** — `Promise.all([warm('m1',4096),
   warm('m2',4096)])` with a spawn fake that records the pid killed by
   `stop()`. Asserts `launched` (the strategy's `launch` calls) is exactly
   `['m1', 'm2']` in call order (proves serialization, not just an
   eventual-consistency race that happened to pass) and `killedPids` is
   exactly `[1]` — i.e. the first server (pid 1, launched for `m1`) was
   fully stopped before the second (`m2`) was spawned, so there is no
   window where both processes are alive/orphaned and no cross-SIGTERM of
   the second server.
3. **Error-release test** — a strategy whose `launch` throws on the first
   call and succeeds on the second. `warm('m1', ...)` is asserted to reject
   with the original error, and a subsequent `warm('m2', ...)` is asserted
   to still run (not hang) and succeed — direct evidence the lock releases
   on error rather than wedging future callers.

## Test / verification evidence

```
$ bun test tests/runtime/managed-openai-compatible.test.ts tests/mcp/token-store.test.ts
29 pass, 0 fail, 56 expect() calls

$ bun run typecheck
(clean, no errors)

$ bun run lint:file -- src/runtime/managed-openai-compatible.ts src/mcp/token-store.ts \
    tests/runtime/managed-openai-compatible.test.ts tests/mcp/token-store.test.ts
Checked 4 files. No fixes applied.

$ bun run docs:check
docs-check: living docs present + linked; every src subsystem documented.
```

No architecture-doc change was required: this is a fix to existing,
already-documented mechanisms (the managed-runtime warm lifecycle and the
MCP token store) — no new subsystem, module boundary, or data-flow edge was
introduced. `bun run docs:check` confirms no gap was created.

## Self-review

- **No deadlock:** confirmed via the error-release test above — the queue
  variable is always rewritten to a *resolved* promise
  (`turn.then(() => undefined, () => undefined)`) regardless of the turn's
  outcome, so a throwing `doWarm` never leaves `warmQueue` in a rejected
  state that would propagate into the next `.then(fn, fn)`'s rejection
  branch and skip execution.
- **Non-concurrent behavior unchanged:** all 9 pre-existing
  `managed-openai-compatible.test.ts` tests plus all 4 telemetry describe-
  block tests pass unmodified; `warm`'s signature/return type and the
  `breakerFor`/`withRuntimeSpan` wrapping are untouched — a single
  sequential `warm()` call takes the same path as before (queue is a no-op
  on an uncontended chain).
- **Token-store:** all pre-existing tests plus the new stale-temp test
  pass; `getServerAuth`/`setServerAuth`/`readTokenStore` call signatures are
  unchanged.
