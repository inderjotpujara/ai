# Task 10 Report: hf-fetch retry + stall-watchdog parity

## Summary

`src/provisioning/providers/hf-fetch.ts` now wraps each per-file download in
`withRetry(...)` + a `StallWatchdog`, mirroring `ollama.ts`'s pattern
(`StallWatchdog(90_000, onStall)` on a `5_000`ms tick, full-ish jitter
`0.5 + Math.random()/2`, same `capMs: 45_000`). Retry is applied **per file**
(inside `downloadFile`, which now wraps the original single-attempt logic
renamed to `downloadFileOnce`), so one flaky file in a multi-file MLX
snapshot retries without restarting the whole snapshot.

Design note / deviation: `attempts: 4` (not ollama's `6`) — a per-file retry
budget doesn't need to match a whole-pull retry budget; the task brief itself
specifies 4. The backoff *shape* (baseMs, capMs, jitter formula) is an exact
copy of `ollama.ts`'s constants, not new numbers.

## Invariants preserved

- **`.part` finally-cleanup runs per attempt**: `downloadFileOnce`'s own
  `try/finally` (destroy stream + `unlink` the `.part` if present) is
  untouched and re-runs on every retry attempt, since `withRetry` re-invokes
  the whole `downloadFileOnce` call fresh each time. `createWriteStream`'s
  default `'w'` flag also truncates on reopen, so a retry never appends to a
  stale `.part`.
- **`safeJoin`, `expectedOid` verification, snapshot tree enumeration,
  degrade-never-crash, single terminal `Done`**: all untouched — the retry
  wrapper is purely an outer shell around the existing `downloadFileOnce`
  call; none of that logic moved.
- **Abort promptness / no retry-after-abort**: `signal` (outer) is threaded
  into `withRetry`'s `signal` option (which already refuses to start a new
  attempt or wait out a backoff once aborted — reused unchanged from
  `supervisor.ts`) *and* into a fresh per-attempt `AbortController` whose
  `ctrl.signal` is what actually gets passed to `fetchImpl`/the reader, so an
  outer abort (or a stall) aborts the in-flight fetch immediately rather than
  waiting for it to finish.
- **Stall detection**: `watchdog.beat(p.bytesCompleted)` is called on every
  progress event from `downloadFileOnce` (matching `ollama.ts`'s
  unconditional `beat` inside its progress-relay), so a stalled transfer
  (bytes stop advancing for 90s) triggers `ctrl.abort()`, which fails the
  current attempt and lets `withRetry` retry it.

## A test-speed design call (worth flagging)

Wrapping the *entire* `downloadFileOnce` call (not just the fetch) in retry
means genuinely **permanent** failures — a sha256 mismatch, or a write-stream
error — also go through the retry loop by default, since `withRetry` doesn't
distinguish transient vs. permanent errors (neither does `ollama.ts`'s own
usage). With production defaults (`attempts: 4`, `baseMs: 1_000`,
`capMs: 45_000`), three pre-existing tests that exercise deterministic,
every-attempt failures (`HfSnapshot`/`HfGguf` sha256-mismatch tests, and the
`ErroringWriteStream` write-failure test) would each burn ~3.5–7s of real
backoff before finally rejecting — close to or over Bun's default 5s
per-test timeout, and needlessly slow either way.

Fix: added an optional `retry?: RetryConfig` test seam to
`createHfFetchProvider`'s `deps` (defaulting to the production constants
above — nothing changes for real usage). The three affected pre-existing
tests now pass `retry: { attempts: 1, baseMs: 0, capMs: 0, jitter: () => 0 }`
(a single attempt — they're testing failure *semantics*, not retry
behavior). The new retry test uses `{ attempts: 3, baseMs: 0, capMs: 0,
jitter: () => 0 }` for a fast, deterministic single-retry cycle with no real
timers. This mirrors the existing convention in
`tests/provisioning/supervisor.test.ts` (`baseMs: 0, capMs: 0, jitter: () =>
0` is already how that file keeps `withRetry` unit tests instant).

## TDD

**RED** — stashed the `src/provisioning/providers/hf-fetch.ts` change only
(kept the new/edited tests) and ran the file:

```
$ bun test tests/provisioning/hf-fetch.test.ts
...
(fail) createHfFetchProvider > retries a transient fetchImpl failure and completes the download on the second attempt [0.28ms]
error: ECONNRESET: simulated transient network blip
      at fetchImpl (tests/provisioning/hf-fetch.test.ts:311:21)
      at downloadFile (src/provisioning/providers/hf-fetch.ts:119:23)
      ...
 12 pass
 1 fail
 36 expect() calls
Ran 13 tests across 1 file. [36.00ms]
```

Confirmed: without retry, a `fetchImpl` that throws on its first call fails
the whole download outright — the new test fails as expected.

**GREEN** — restored the implementation (`git stash pop`) and re-ran:

```
$ bun run test:file -- "tests/provisioning/hf-fetch.test.ts"
$ bun test tests/provisioning/hf-fetch.test.ts
 13 pass
 0 fail
 41 expect() calls
Ran 13 tests across 1 file. [34.00ms]
```

All 13 pass (12 pre-existing + 1 new), in 34ms total — no real-timer slowdown
introduced anywhere in the file.

## Verify

```
$ bun run typecheck
$ tsc --noEmit
(0 errors)
```

```
$ bun run test:file -- "tests/provisioning/hf-fetch.test.ts"
13 pass, 0 fail, 41 expect() calls
```

Per instructions, the full `bun test` suite was **not** run here — the
caller runs it after commit.

## Files changed

- `src/provisioning/providers/hf-fetch.ts` — added `STALL_MS`, `RetryConfig`
  type, `DEFAULT_RETRY`; renamed the original `downloadFile` body to
  `downloadFileOnce` (unchanged); added a new `downloadFile` wrapper that
  applies `withRetry` + `StallWatchdog` per file; added an optional
  `deps.retry` test seam.
- `tests/provisioning/hf-fetch.test.ts` — added the new retry test; gave the
  three deterministically-every-attempt-failing tests a fast
  `retry: { attempts: 1, ... }` override so they stay single-attempt and
  fast.
