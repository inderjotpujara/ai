# Task 13 report — parameterize the SSE transport frame-payload schema

Slice 30b Phase 3 (Runs), web layer. **Note:** this filename previously held
a Task 13 report for the Phase 2 streaming-chat feature (`useChat` +
AI-Elements/streamdown) — that content is superseded by this report; the
historical text is preserved in git history at prior commits if needed.

## Status

DONE.

## Commit

`01f4f31` `feat(web): parameterize SSE transport frame-payload schema (default StatusEvent; SpanDTO for runs)`

## Summary

`ChatTransport.stream` is now generic over the SSE frame-payload schema:
`stream<T = StatusEvent>(runId?, fromCursor?, schema?: ZodType<T>): AsyncIterable<T & { eventId: string }>`.
Default schema is `StatusEventSchema`, so the existing chat path is
byte-for-byte unchanged; the runs live-tail can now pass `SpanDtoSchema` to
decode `SpanDTO` frames through the same `readSseStream`/`parseSseFrame`
reader (reused verbatim, untouched).

## Files changed (4 — see deviation note)

- `web/src/shared/transport/types.ts` — generic `stream<T>` signature on
  `ChatTransport`; added `import type { ZodType } from 'zod'`.
- `web/src/shared/transport/sse-adapter.ts` — `stream` implementation takes
  the optional `schema` param, defaults via
  `const payloadSchema = (schema ?? StatusEventSchema) as ZodType<T>`, parses
  each frame with it, yields `{ ...(parsed as object), eventId } as T & { eventId: string }`.
  Import list reordered (`type ZodType` before `z`) to satisfy biome's
  `organizeImports`.
- `web/src/shared/transport/sse-adapter.test.ts` — added
  `describe('createSseTransport stream() payload schema', …)` with the
  brief's exact SpanDTO test case, reusing the file's existing `sseResponse`
  helper (didn't redeclare a second copy, to avoid a duplicate-symbol clash
  with the brief's inline sample). Imports `SpanDtoSchema` from `@contracts`.
- `web/src/shared/transport/types.test.ts` — **not listed in the brief**, but
  its `ChatTransport` stub had a non-generic `async *stream()` that no longer
  satisfied the new generic interface (`tsc` error: return type
  incompatible). Made it `async *stream<T = StatusEvent>()`, casting the
  yielded literal via `as unknown as T & { eventId: string }`. This is a
  required consequence of the interface widening, not scope creep — omitting
  it leaves `bun run typecheck` red. Included in the commit for that reason.

## Confirmed contract export names

Read `src/contracts/dto.ts` and `src/contracts/index.ts` directly:
`SpanDtoSchema` (schema, line 29) and `SpanDTO` (type, line 68) — exactly as
the brief assumed, no rename needed. `StatusEvent`/`StatusEventSchema`
confirmed in `src/contracts/events.ts`; all re-exported through
`src/contracts/index.ts` → `@contracts` (alias resolves to
`../src/contracts/index.ts` in both `web/vite.config.ts` and
`web/vitest.config.ts`).

## TDD sequence

1. **RED** — added the SpanDTO test to `sse-adapter.test.ts`, ran
   `cd web && bun run test src/shared/transport/sse-adapter.test.ts` →
   1 failed / 3 passed. Failure was a `ZodError` from
   `StatusEventSchema.parse` ("No matching discriminator", listing all 9
   `StatusEventType` variants) — failed for the expected reason (schema not
   yet parameterized), not a typo/setup error.
2. **GREEN** — implemented the generic `stream<T>` in `types.ts` and
   `sse-adapter.ts` per the brief's sample code.
3. Re-ran the same command → all 4 tests pass (3 pre-existing StatusEvent
   cases + 1 new SpanDTO case).
4. Fixed the incidental `types.test.ts` typecheck break (see above), reran
   both files' tests, full web suite, typecheck, and lint.

## Test commands + output

```
$ cd web && bun run test src/shared/transport/sse-adapter.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

```
$ cd web && bun run test src/shared/transport/sse-adapter.test.ts src/shared/transport/types.test.ts
 Test Files  2 passed (2)
      Tests  6 passed (6)
```

```
$ cd web && bun run test        # full web suite, regression check
 Test Files  16 passed (16)
      Tests  67 passed (67)
```

## Typecheck

`cd web && bun run typecheck` → clean (`tsc --noEmit`, no output/errors).

## Lint

Root linter DOES cover `web/` (it's biome). Ran
`bun run lint:file -- "web/src/shared/transport/types.ts" "web/src/shared/transport/sse-adapter.ts" "web/src/shared/transport/sse-adapter.test.ts"`
→ clean after one fix (import order: `type ZodType` before `z` in
`sse-adapter.ts`, biome `assist/source/organizeImports`). Also linted the 4th
touched file `types.test.ts` → clean after applying biome's two suggested
fixes (import order + line-wrap formatting).

## Concerns / notes

- The 4th file (`types.test.ts`) was necessarily touched even though the
  brief named only 3 files; no behavior change there — purely a
  type-signature accommodation for the stub, re-verified with its own
  passing test.
- Grepped `web/src` for other production callers of `.stream(` — none exist
  yet outside tests, so the interface widening has no other blast radius in
  this task.
- Commit staged only these 4 transport files (explicit paths, not `-A`);
  other unrelated pending changes already in the working tree (from other
  tasks/sessions: `.remember/`, other `.superpowers/sdd/task-*` files,
  `docs/superpowers/plans/...`) were left untouched.
- No live-endpoint wiring in this task — Task 13 is transport-layer only;
  the runs live-tail feature that will actually call
  `stream(runId, cursor, SpanDtoSchema)` is presumably a later task in this
  phase.
