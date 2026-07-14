# Task 5 report: contract client + transport port interface (Slice-30b Phase 1b)

## Note on this file
This overwrites a stale `task-5-report.md` from an earlier Slice-30b Phase 1
task ("Config — `ConfigEntry.strict?` flag + server `AGENT_WEB_*` entries"),
which shares this filename due to per-phase task numbering. That content is
preserved in git history. This report covers the actual current Task 5
(Slice-30b **Phase 1b**, frontend-scaffold plan: contract client + transport
port interface).

## Status: DONE

## Files
- `web/src/shared/contract/client.ts` — `sessionToken()`, `apiFetch<T>()`, `getHealth()`, `class ApiError extends Error`.
- `web/src/shared/contract/client.test.ts` — 3 tests (token read, bearer+zod-parse happy path, non-2xx → ApiError).
- `web/src/shared/transport/types.ts` — `TransportEvent`, `ChatTransport`, `RunStream` (all `type`, no `ai`/`@ai-sdk/*` import).
- `web/src/shared/transport/types.test.ts` — 2 tests (stub adapter shape, `RunStream` cursor).

## Commit
`08d46a1bf26b002a8a3a9d91143fbf58ef31f870` — feat(web): token'd contract client + bidirectional transport port interface

## TDD RED → GREEN
- RED: ran `cd web && bun run test src/shared/contract/ src/shared/transport/` before writing sources.
  `client.test.ts` failed as expected: `Failed to resolve import "./client.ts" from "src/shared/contract/client.test.ts"`.
  `types.test.ts` unexpectedly showed 2 passed at RED time — because its only
  imports of `./types.ts` (`ChatTransport`, `RunStream`) are `import type`-only,
  so esbuild elides the import statement entirely under `verbatimModuleSyntax`;
  the module is never resolved at runtime by Vitest. Noting this as an
  observation (not a defect): the file still had to exist for `bun run
  typecheck`, since `tsc` (unlike the Vitest/esbuild transform) does resolve
  type-only imports to check them, and it's committed regardless as scoped by
  the brief.
- GREEN: wrote `client.ts` and `types.ts` per the brief, then re-ran the same
  command — 5/5 passed.

## Brief sample-code defect found and fixed
The brief's `types.test.ts` sample yields:
```ts
yield { type: StatusEventType.RunStart, eventId: '1', data: { runId: 'r1' } };
```
The actual `RunStartEventSchema` in `src/contracts/events.ts` is:
```ts
z.object({ type: z.literal(StatusEventType.RunStart), runId: z.string(), task: z.string().optional() })
```
— a **flat** `runId` field, not a nested `data` object. The brief's literal
would fail to satisfy `TransportEvent = StatusEvent & { eventId: string }`
under `tsc` (the object doesn't match any member of the `RunStart`
discriminated-union arm — missing `runId`, extraneous `data`). Fixed the test
to `{ type: StatusEventType.RunStart, eventId: '1', runId: 'r1' }`, matching
the real contract shape. Per the standing "plan sample code ships defects"
lesson, this was corrected against the actual contract rather than softened
or worked around.

## @contracts alias resolution — confirmed both ways
- **Vitest**: `types.test.ts` imports `StatusEventType` (a value — a real
  string enum, not type-only) from `@contracts` and invokes it at runtime
  inside the async generator; the 5/5 green run proves the alias resolves
  under Vitest's own resolver (`web/vitest.config.ts`'s
  `resolve.alias['@contracts'] → ../src/contracts/index.ts`), independent of
  tsc's `paths` mapping.
- **tsc**: `client.ts` imports `ZodType` (type) from `zod`; `types.ts` imports
  `RespondRequest`/`StatusEvent` (types) from `@contracts`. `bun run
  typecheck` (from `web/`) is clean, proving `web/tsconfig.json`'s `paths: {
  "@contracts": ["../src/contracts/index.ts"] }` maps correctly.
- `zod` (root dependency, pinned `^4.4.3`) resolves from `web/` via workspace
  hoisting — confirmed via `node -e "require.resolve('zod')"` run from
  `web/`, resolving to `node_modules/.bun/zod@4.4.3/node_modules/zod`. No
  divergent zod version was added; the root pin is reused as-is.

## Gate 1 — tests
Command: `cd web && bun run test src/shared/contract/ src/shared/transport/`
```
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

## Gate 2 — typecheck
Command: `cd web && bun run typecheck`
```
$ tsc --noEmit
```
(clean — no output, exit 0)

## Gate 3 — lint
Command: `bun run lint:file -- "web/src/shared/contract/client.ts" "web/src/shared/contract/client.test.ts" "web/src/shared/transport/types.ts" "web/src/shared/transport/types.test.ts"`
```
$ biome check web/src/shared/contract/client.ts web/src/shared/contract/client.test.ts web/src/shared/transport/types.ts web/src/shared/transport/types.test.ts
Checked 4 files in 4ms. No fixes applied.
```
0 errors, 0 warnings on the new files after fixes. Two rounds of `biome check
--write` were applied first (import sorting + formatting: multi-line function
signatures, import order in `types.test.ts` and `client.test.ts`). One
`lint/style/noNonNullAssertion` warning surfaced on
`fetchMock.mock.calls[0]!` in the non-2xx test; resolved with a scoped
`// biome-ignore lint/style/noNonNullAssertion` + reason (array access is
guaranteed non-empty — the test just awaited the one call that populates it)
— matching the brief's own anticipation that a scoped ignore might be needed
in this file's test cleanup.

Also ran repo-wide `bun run lint` (563 files) — 14 pre-existing warnings
elsewhere in the repo (`noExplicitAny` in earlier-slice test files), 0
errors; none touch the new files.

Also ran `bun run docs:check` (mirrors the pre-commit hook) both before and
as part of the commit — passed both times: `✔ docs-check: living docs
present + linked; every src subsystem documented.` This task adds only
`web/src/**` (frontend, not a new `src/<subsystem>`), so no
`docs/architecture.md` update was required for this task specifically; the
slice-level docs update (architecture.md / README / ROADMAP / SDD ledger) is
the responsibility of the slice landing, not each individual task commit.

## Self-review
- `sessionToken()` reads via `(globalThis as { window?: {...} }).window?.__AGENT_TOKEN__ ?? ''`
  — correct for real browsers (`globalThis.window` self-refers), for Vitest's
  `vi.stubGlobal('window', ...)` stubbing, and degrades to `''` when `window`
  is absent (test cleanup does `delete (globalThis as any).window`).
- `apiFetch` sets `content-type` only when a body is present (no spurious
  header on GETs), defaults `method` to GET/POST based on body presence, and
  always parses the response through the caller-supplied zod `schema` — no
  `any` escapes the boundary.
- `ApiError` carries `status: number` and a fixed `name = 'ApiError'` (via
  `override name`), matching the test's
  `toMatchObject({ name: 'ApiError', status: 401 } satisfies Partial<ApiError>)`.
- `transport/types.ts` is 100% `type`-only, imports nothing from
  `ai`/`@ai-sdk/*`, keeping the AI-SDK boundary out of the contract/transport
  layer per the plan's D14 requirement (bidirectional + resumable shape:
  `stream(runId?, fromCursor?)` + `respond(runId, payload)`,
  `RunStream.cursor` for Last-Event-ID resume).
- `getHealth()` correctly uses a **local** `z.object({ ok: z.boolean() })`
  schema rather than importing from `@contracts` — confirmed health is not
  present in `src/contracts/index.ts`'s barrel (only `dto.ts`, `enums.ts`,
  `events.ts`, `requests.ts` are re-exported).
- No vacuous assertions: the bearer-token test checks the actual
  `Authorization` header value sent to the stubbed `fetch`; the non-2xx test
  checks both `name` and `status` on the thrown error.

## Concerns
- The one real finding — the brief's `types.test.ts` sample using a nested
  `data.runId` shape that doesn't match the actual `RunStartEventSchema` — was
  caught and corrected before it could compile-fail. Flagging it here so the
  Phase-1b plan document / task-6+ briefs (which likely reuse similar
  `StatusEvent` literals) can be checked against the real flat shape too.
- The working tree has several unstaged modifications from prior
  tasks/session bookkeeping (`.remember/now.md`, `.superpowers/sdd/progress.md`,
  task 1–4 briefs/reports, the phase-1b plan doc) — left untouched/uncommitted
  since they are out of this task's scope; only Task 5's four new files were
  staged and committed.
