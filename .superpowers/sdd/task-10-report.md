# Task 10 report: migrate provisioning onto reliability/{retry,timeout}

## Commit
`a3b8e5c` — `refactor(provisioning): migrate retry/stall onto reliability module`

## What was migrated
- Created `src/reliability/download-retry.ts`: `defaultDownloadRetry()` (attempts via
  `Number(process.env.AGENT_DOWNLOAD_ATTEMPTS)||6`, `baseMs`/`capMs` from
  `retryBaseMs()`/`retryCapMs()`, full-ish jitter) and `downloadStallMs()`
  (`Number(process.env.AGENT_DOWNLOAD_STALL_MS)||90_000`), per the brief.
- `src/provisioning/supervisor.ts`: deleted the local `abortableSleep`, `withRetry`,
  `StallWatchdog` bodies; now re-exports `abortableSleep`/`withRetry` from
  `reliability/retry.ts` and `IdleWatchdog as StallWatchdog` from
  `reliability/timeout.ts`. `checkDiskSpace`/`PreflightInput` untouched.
- `src/provisioning/providers/ollama.ts`: `withRetry` call now spreads
  `defaultDownloadRetry()`; `StallWatchdog`/`STALL_MS` replaced with
  `IdleWatchdog`/`downloadStallMs()`.
- `src/provisioning/providers/hf-fetch.ts`: `DEFAULT_RETRY` replaced by
  `deps.retry ?? defaultDownloadRetry()` (the `RetryConfig` injection seam type
  already matched `defaultDownloadRetry()`'s return shape, so no widening was
  needed); `STALL_MS`/`StallWatchdog` replaced with `downloadStallMs()`/`IdleWatchdog`.

## Regression found and fixed (not a detail — a real behavior change)
`reliability/retry.ts`'s `withRetry` defaults to retrying **only the `Transient`
classify() lane** (network-coded errors, retryable `APICallError`s) — by design,
per its own doc comment and `tests/reliability/retry.test.ts` ("does NOT retry a
RouteWorthy error (ProviderError)"). The **old local** `supervisor.ts` `withRetry`
had **no classification at all** — it retried unconditionally on any thrown error.

This is exactly the download subsystem's intended behavior: a bad HTTP status
(`ProviderError`, classify → `RouteWorthy`), a plain `Error` from a flaky
`fetchImpl`/stream, or a stall-abort all need to be retried, and none of those
classify as `Transient` by default. Proven by running the suite before adding a
fix:
- `tests/provisioning/hf-fetch.test.ts` — "retries a transient fetchImpl failure
  and completes the download on the second attempt" **failed**: the injected
  `Error('ECONNRESET: simulated transient network blip')` has no `.code`
  property (classify() only recognizes `err.code`, not the message text), so it
  classified as `Terminal` and was not retried.
- `tests/provisioning/supervisor.test.ts` — "retries a failing fn then succeeds,
  calling onRetry each time" **failed** the same way with a plain `Error('boom')`.

**Fix (code, not test-softening):** added `retryable: () => true` explicitly at
both download call sites (`ollama.ts`'s `withRetry(...)` for the whole-pull retry,
`hf-fetch.ts`'s per-file `withRetry(...)`), restoring "retry on any failure" —
matching the pre-migration local implementation. `defaultDownloadRetry()`'s
returned shape was kept exactly as specified in the brief
(`{attempts, baseMs, capMs, jitter}`); `retryable` is passed as a sibling option
at the call site rather than baked into the shared config function, since it's a
call-site retry *policy* choice, not a backoff *parameter*.

## Test I changed, and why (detail vs regression classification)
- **`tests/provisioning/supervisor.test.ts` `withRetry` describe block (3 tests)
  — changed, classified as "asserting old-implementation-detail behavior."**
  These three tests exercise generic `withRetry` mechanics with plain `Error`
  objects and no explicit `retryable`. Under the old local implementation
  (no classification), that was fine. Now that `supervisor.ts` delegates to the
  shared `reliability/retry.ts` (which classifies by design, with `retryable` as
  the documented escape hatch — see `tests/reliability/retry.test.ts`'s "honours a
  custom retryable predicate"), these tests need `retryable: () => true` to
  exercise the same "retry any error" path that the real download call sites now
  request explicitly. This is not weakening the assertions — I kept (and for the
  "rethrows after exhausting attempts" case, *strengthened*, by adding a
  `calls === 2` check) the original intent: retry-then-succeed, exhaust-then-throw,
  abort-short-circuits-backoff. Without `retryable: () => true` the "rethrows
  after exhausting attempts" test would still nominally pass (`calls` would be 1,
  not 2, immediately throwing as unclassified-Terminal) but for the wrong reason,
  so I added the `calls` assertion to lock in the correct code path.
- **`StallWatchdog` describe block in the same file — left unchanged, no
  regression.** Verified by hand-tracing `IdleWatchdog`'s semantics against all
  three cases: `IdleWatchdog` arms `lastAdvanceAt = now()` at construction, but
  every test's first `beat()` call also advances `lastProgress` from its `-1`
  sentinel and re-stamps `lastAdvanceAt` to that same current `now()` — so for any
  test that calls `beat()` at least once before relying on elapsed time (all
  three do, or call only `stop()`), construction-time arming is a no-op and
  produces byte-identical results to the old beat-armed-flag semantics. Ran
  unchanged and green.

## Test results
- `bun test tests/provisioning/` — **90 pass, 0 fail** (supervisor, hf-fetch,
  ollama-pull, ollama-catalog, and all other provisioning suites).
- `bun test tests/reliability/download-retry.test.ts` — **1 pass**.
- `bun test tests/provisioning/ tests/reliability/` — **128 pass, 0 fail**
  (full reliability suite included, confirming no cross-module fallout).
- `bun run typecheck` — clean.
- `bun run lint:file` on all 6 changed/created files — clean (one formatting
  fix applied to `supervisor.test.ts` before it passed).
- Pre-commit hook (`docs-check`) ran clean on commit.

## Files changed
- `src/reliability/download-retry.ts` (new)
- `tests/reliability/download-retry.test.ts` (new)
- `src/provisioning/supervisor.ts`
- `src/provisioning/providers/ollama.ts`
- `src/provisioning/providers/hf-fetch.ts`
- `tests/provisioning/supervisor.test.ts`

## Concerns
- None blocking. One thing worth a future look (not fixed here, out of scope for
  Task 10): `classify()` only inspects `err.code`, not error message text, so a
  hand-rolled `Error('ECONNRESET: ...')` without a `.code` field won't classify
  as `Transient` on its own — real Node fetch/stream errors normally carry
  `.code`, and this is moot for the provisioning call sites since they now pass
  `retryable: () => true` regardless, but it's a latent trap for any *other*
  future caller of `withRetry` that expects string-matching on error messages.
- Did not touch `.superpowers/sdd/task-10-brief.md`, `progress.md`, or other
  task briefs/reports showing as modified in `git status` — those diffs predate
  this task's work (other Slice 21 tasks running in parallel) and were
  deliberately left out of this commit's staged files.
