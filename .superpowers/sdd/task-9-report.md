# Task 9 Report: `withServerRequestSpan` telemetry helper (Slice 30b)

Note: this filename was previously reused for earlier, unrelated Task 9s from
prior slices (Slice 26 runtime-download live-verify; Slice 29 voice-input mic
capture). That content is superseded here — this is the Slice 30b web-BFF
telemetry Task 9.

## Summary

Implemented per brief, TDD (RED → GREEN), followed by typecheck + full-suite regression
check, then committed. No deviations from the brief's exact values.

## Files touched

- `src/telemetry/spans.ts` — modified (shared file).
- `tests/telemetry/server-request-span.test.ts` — new test file.

## Exact edits

### 1. `ATTR` object (added before the closing `} as const;`, after the `VOICE_*` block)

```ts
  // Server / web BFF (Slice 30b)
  SERVER_ROUTE: 'server.route',
  SERVER_METHOD: 'http.request.method',
  SERVER_STATUS: 'http.response.status_code',
  SERVER_DURATION_MS: 'server.duration_ms',
  /** Request principal/owner; reserved "local" now, upgrades to audit-grade in Slice 35. */
  SERVER_PRINCIPAL: 'server.principal',
```

### 2. `withServerRequestSpan` helper (added right before `setRunOutcome`, i.e. near the
other `with*Span` helpers and immediately after `withRunSpan`)

```ts
/**
 * Span for one HTTP request handled by the web BFF (Slice 30b). Follows the
 * recorder-callback pattern (`withRuntimeSpan`): opens a `server.request` span,
 * sets route/method + the reserved principal, runs `fn` (which reports the final
 * status via `rec.status`), records the duration in a `finally`, and — via
 * `inSpan` — records an error status if `fn` throws.
 */
export function withServerRequestSpan<T>(
  info: { route: string; method: string; principal?: string },
  fn: (rec: { status: (code: number) => void }) => Promise<T>,
): Promise<T> {
  return inSpan('server.request', async (span) => {
    const startedAt = performance.now();
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    span.setAttribute(ATTR.SERVER_METHOD, info.method);
    span.setAttribute(ATTR.SERVER_PRINCIPAL, info.principal ?? 'local');
    try {
      return await fn({
        status: (code) => span.setAttribute(ATTR.SERVER_STATUS, code),
      });
    } finally {
      span.setAttribute(
        ATTR.SERVER_DURATION_MS,
        Math.round(performance.now() - startedAt),
      );
    }
  });
}
```

Uses the existing module-private `inSpan('server.request', ...)` (same pattern as
`withRunSpan`, `withRuntimeSpan`, etc.) — `inSpan` sets `SpanStatusCode.ERROR` and
rethrows on throw, and always ends the span in its own `finally`. No changes to
`inSpan` itself were needed.

### 3. Test file (verbatim from the brief, step 1)

`tests/telemetry/server-request-span.test.ts` — two tests:
1. Happy path: emits `server.request` span with `server.route`, `http.request.method`,
   `http.response.status_code`, `server.principal` (defaulted to `'local'`), and a
   numeric `server.duration_ms`.
2. Throwing handler: span still ends, `status.code === SpanStatusCode.ERROR`.

Uses `registerTestProvider()` from `tests/helpers/otel-test-provider.ts`, storing the
returned `{ exporter, provider }` in a module-level `h` var; `afterAll` calls
`h.provider.shutdown()` (not on the whole return object).

## Test commands + results

### RED (before implementation)

```
$ bun test tests/telemetry/server-request-span.test.ts
SyntaxError: Export named 'withServerRequestSpan' not found in module
'/Users/inderjotsingh/ai/src/telemetry/spans.ts'.
0 pass / 1 fail / 1 error
```

### GREEN (after implementation)

```
$ bun test tests/telemetry/server-request-span.test.ts
2 pass
0 fail
8 expect() calls
Ran 2 tests across 1 file. [82.00ms]
```

### Typecheck (clean)

```
$ bun run typecheck
$ tsc --noEmit
(no output — exit 0)
```

### No-regression confirmation (full telemetry suite, including the new file)

```
$ bun test tests/telemetry
39 pass
0 fail
117 expect() calls
Ran 39 tests across 13 files. [93.00ms]
```

All pre-existing telemetry tests (12 other files) plus the new one pass; no
regressions introduced.

## Commit

```
commit 3ee90f0
feat(telemetry): add server.request span helper for the web BFF
 2 files changed, 70 insertions(+)
 create mode 100644 tests/telemetry/server-request-span.test.ts
```

The pre-commit hook ran `docs:check` (docs-only gate for this repo) and passed:
"docs-check: living docs present + linked; every src subsystem documented."

## Self-review

- Followed the brief verbatim for ATTR key names/values and the helper signature —
  no deviation.
- `withServerRequestSpan` mirrors sibling helpers (`withRunSpan`, `withRuntimeSpan`)
  in structure: opens via `inSpan`, sets up-front attributes, exposes a recorder
  callback (`rec.status`) for attributes only knowable at settle-time, and uses a
  `finally` for the duration measurement so it's recorded even if `fn` throws
  (verified by the throwing-handler test).
- `principal` defaults to `'local'` exactly as specified — matches the reserved
  "local, upgrades in Slice 35" comment on the ATTR key.
- Only the two required files were touched; no changes to `inSpan`, other `ATTR`
  keys, or unrelated helpers.
- Did not touch the sdd ledger/progress.md, README, ROADMAP, or architecture.md —
  out of scope for a single per-task brief (assumed handled at slice-review/closeout
  level, consistent with prior task reports in this same ledger sequence).

## Concerns

None. Implementation is a small, additive, self-contained helper with no
observed regressions; typecheck is clean under strict tsconfig.
