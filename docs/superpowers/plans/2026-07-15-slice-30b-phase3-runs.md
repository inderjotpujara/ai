# Slice 30b Phase 3 (Runs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web UI a rich, searchable Runs history and a live-tailing per-run trace waterfall, fed by a new **stateless span→DTO mapper** that projects the real engine's on-disk `runs/<id>/spans.jsonl` (+ `degradation.jsonl` + artifacts) through the Phase-1 contracts — the first real emitter of `RunDTO`/`SpanDTO` and the first real consumer of the resumable transport port (`stream(runId, cursor)`).

**Architecture:** Five bottom-up layers. **①** extend the zod-only contracts (`ArtifactKind` members + `RunListItemDTO` + `RunListQuery`/`RunListResponse`). **②** a new engine-side mapper (`src/run/run-dto.ts` + `src/run/artifacts.ts`) that reuses the existing `readSpans`/`buildTree` readers and re-reads disk per request (mtime-keyed summary cache for the list — no persistence layer; that is Phase 6). **③** three GET endpoints on the existing thin Bun BFF (`/api/runs`, `/api/runs/:id`, `/api/runs/:id/stream`), all behind the shipped perimeter, path-confined via `confineToDir`, the stream wrapped in a new `runs.stream` span. **④** the web feature (`web/src/features/runs/`) — a rich list, a @visx waterfall, a pure `foldSpan` trace reducer, and live-tailing via a payload-schema-parameterized SSE transport. **⑤** docs across the four living surfaces. Landing is a **PARTIAL slice** (Phase 3 done; slice-30b capability NOT flipped — Phases 4–8 remain).

**Tech Stack:** Bun · Zod v4 (`^4.4.3`) · OpenTelemetry span readers (existing) · React 19 · Vite 8 · TanStack Router · @visx (`scale`/`shape`/`axis`/`group`/`tooltip`) · Tailwind v4 · Vitest 4 + @testing-library/react + happy-dom.

## Global Constraints

- **Test runner by location (do NOT mix).** Root tests (`tests/**`) import from **`bun:test`** (`import { test, expect } from 'bun:test'`) and run under the root script **`bun test --path-ignore-patterns 'web/**'`** — raw `bun test` falsely fails by sweeping in `web/`'s vitest files. `bun:test` provides `describe/it/test/expect/beforeEach/afterEach/mock/spyOn` (there is no `vi`). Web tests (`web/src/**`) import from **`vitest`** (`import { describe, it, expect } from 'vitest'`) + @testing-library/react + happy-dom, and run via `bun run check:web` (or `cd web && bun run test`). Any code snippet below that shows a root test importing from `'vitest'` is a typo — use `'bun:test'`.
- **Per-task gate BEFORE commit** = `bun run typecheck` (clean) **and** `bun run lint` (or `bun run lint:file -- "<files>"`) **and** the focused tests. `bun test` does NOT typecheck and the pre-commit hook is `docs:check` only — so typecheck + lint must run explicitly (SDD lesson: else strict-type + biome drift accumulate to the phase gate). Implementer runs focused tests inline; the controller runs the full suite + `bun run check` between tasks.
- **Contracts isomorphism.** `src/contracts/` imports **nothing but zod** — no `node:*`, no engine, no telemetry, no AI-SDK. `tests/contracts/isomorphic.test.ts` enforces it recursively. The mapper (engine-side) maps *into* the contract enums/DTOs, never the reverse.
- **Code style.** Prefer `enum` over string-literal unions (string enums only — `enum Foo { A = 'A' }`); prefer `type` over `interface`; discriminated object unions stay `type`. Early returns over nested conditionals. Small focused files. Descriptive names. `bun`, never `npm`.
- **Additive / forward-compat.** Never rename or remove an existing enum member or DTO field. `ArtifactKind` gains members; DTOs gain a new list-item type; the transport `stream()` gains an optional param (default preserves the chat path byte-for-byte).
- **Degrade, never crash.** A missing/partial/empty `spans.jsonl` → mapper returns `undefined` (list skips it; detail 404s) — never throws. Missing `degradation.jsonl`/artifacts → empty arrays. Path traversal on `:id` → `MediaPathError` → 404 (no leak of traversal-vs-missing). The stream ends cleanly (records `runs.stream` outcome) if the file vanishes mid-tail. Every handler stays inside `handleApi`'s try/catch (throw → JSON 500) and the `buildFetch` backstop.
- **Perimeter is automatic.** Every `/api/*` route is already behind the Host/Origin allowlist + bearer-token check (`buildFetch` runs `enforcePerimeter` + `guard.verify` before `handleApi`). New routes still (a) gate on HTTP method by hand, (b) Zod-parse input before any disk work, (c) inherit `ISOLATION_HEADERS` (COOP/COEP) via the shared `json()` helper / explicit spread on the SSE response.
- **Reserved fields stay reserved (D2).** `SpanDTO.node` omitted; `RunDTO.origin` = constant `RunOrigin.Manual`; `RunDTO.owner` = constant `"local"`; `server.principal` = `"local"`. Slices 24/25/33/35/38 fill them.
- **Conventional commits.** Subject `type(scope): summary`. End every commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Docs hard-line.** All four living surfaces (`docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, the SDD ledger `.superpowers/sdd/progress.md`) update at the phase close (Task 19) + regenerate-Artifact reminder; the pre-push slice-landing gate blocks landing on `main` otherwise.

## File Structure

**Layer ① Contracts (extend existing):**
- `src/contracts/enums.ts` — extend `ArtifactKind` (Task 1).
- `src/contracts/dto.ts` — add `RunListItemDtoSchema`/`RunListItemDTO` (Task 2).
- `src/contracts/requests.ts` — add `RunListQuerySchema` + `RunListResponseSchema`/`RunListResponse` (Task 3).
- `src/contracts/index.ts` — barrel already `export *`s each of the above; no edit needed (re-exported automatically).

**Layer ② Mapper (NEW, engine-side, imports only `@contracts` types + `node:fs`):**
- `src/run/artifacts.ts` — `readRunArtifacts(runDir)` (Task 4).
- `src/run/run-dto.ts` — `mapRunToDto` + `summarizeRunListItem` + the mtime summary cache (Tasks 5, 6).

**Layer ③ Server (NEW under `src/server/runs/`, wired in `app.ts`):**
- `src/server/app.ts` — `ServerDeps.runsRoot` + route wiring (Tasks 7, 11); `src/server/main.ts` threads `runsRoot` into `deps` (Task 7).
- `src/server/runs/detail.ts` — `handleRunDetail` (Task 8).
- `src/server/runs/list.ts` — `handleRunList` (Task 9).
- `src/server/runs/stream.ts` — `handleRunStream` (Task 10).
- `src/telemetry/spans.ts` — `withRunStreamSpan` + `RUN_STREAM_*` ATTR keys (Task 10).

**Layer ④ Web (NEW under `web/src/features/runs/` + shared edits):**
- `web/package.json` — add @visx deps; `web/src/shared/design/tokens.css` — add `--color-danger` (Task 12).
- `web/src/shared/transport/{types.ts,sse-adapter.ts}` — parameterize the frame-payload schema on `stream()` (Task 13).
- `web/src/features/runs/use-run-trace.ts` — pure `foldSpan` + `useRunTrace` (Task 14).
- `web/src/features/runs/waterfall.tsx` — @visx Gantt + span-detail panel (Task 15).
- `web/src/features/runs/index.tsx` — `RunsArea` rich list (Task 16, replaces stub).
- `web/src/features/runs/run-detail.tsx` — `RunDetail` snapshot + live-tail (Task 17, replaces stub).
- `web/src/app/commands.ts` — jump-to-run ⌘K command(s) (Task 18).

**Layer ⑤ Docs (Task 19):** `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md` (+ Artifact regen reminder).

**Shared interface names (must stay identical across tasks):**
- `RunListItemDTO` = `{ id, startMs, durationMs, outcome: string, lifecycle: RunLifecycle, origin: RunOrigin, models: string[], degraded: boolean, spanCount: number, tokens?: { input?, output? } }`
- `RunListQuery` = `{ search?: string, outcome?: string, degraded?: boolean, limit: number, cursor?: string }`
- `RunListResponse` = `{ items: RunListItemDTO[], nextCursor?: string, total: number }`
- `mapRunToDto(runsRoot: string, id: string): Promise<RunDTO | undefined>`
- `readRunArtifacts(runDir: string): Promise<{ name: string; bytes: number; kind: ArtifactKind }[]>`
- `summarizeRunListItem(runsRoot: string, id: string): Promise<RunListItemDTO | undefined>`
- `RunsDeps = { runsRoot: string }` (structural subset of `ServerDeps`, mirrors Phase-2 `ChatHandlerDeps`)
- `handleRunDetail(id: string, deps: RunsDeps): Promise<Response>`
- `handleRunList(params: URLSearchParams, deps: RunsDeps): Promise<Response>`
- `handleRunStream(id: string, deps: RunsDeps, opts: { lastEventId?: string; signal?: AbortSignal }): Promise<Response>`
- `withRunStreamSpan(info: { route: string; runId: string }, fn: (rec: { chunk(bytes: number): void; resume(): void; outcome(o: string): void }) => Promise<T>): Promise<T>`
- Web transport: `stream<T = StatusEvent>(runId?: string, fromCursor?: string | null, schema?: ZodType<T>): AsyncIterable<T & { eventId: string }>`
- Web trace: `foldSpan(state: RunTraceState, span: SpanDTO): RunTraceState` where `RunTraceState = { spans: SpanDTO[]; cursor: string | null }`

---

## Layer ① — Contracts

### Task 1: Extend `ArtifactKind` with the classification members

**Files:**
- Modify: `src/contracts/enums.ts`
- Test: `tests/contracts/enums.test.ts` (extend), `tests/contracts/dto.test.ts` (already parses `ArtifactKind`; no change expected but re-run)

**Interfaces:**
- Produces: `ArtifactKind` gains `Result='result'`, `Resource='resource'`, `Unverified='unverified'`, `Failed='failed'`, `Error='error'`, `Media='media'`. Pure additions — existing members (`Answer/Gap/Spans/Degradation/Other`) unchanged.

- [ ] **Step 1: Write the failing test** — append to `tests/contracts/enums.test.ts`:

```ts
import { ArtifactKind } from '../../src/contracts/enums.ts';

test('ArtifactKind carries the Phase-3 classification members (additive)', () => {
  expect(Object.values(ArtifactKind) as string[]).toEqual([
    'answer',
    'gap',
    'spans',
    'degradation',
    'other',
    'result',
    'resource',
    'unverified',
    'failed',
    'error',
    'media',
  ]);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/contracts/enums.test.ts` → FAIL (new values absent).

- [ ] **Step 3: Minimal impl** — in `src/contracts/enums.ts`, replace the `ArtifactKind` body (keep the existing five, append six):

```ts
/** Run-artifact classification (mapper-side readdir+classify; Slice 30b Phase 3). */
export enum ArtifactKind {
  Answer = 'answer',
  Gap = 'gap',
  Spans = 'spans',
  Degradation = 'degradation',
  Other = 'other',
  Result = 'result',
  Resource = 'resource',
  Unverified = 'unverified',
  Failed = 'failed',
  Error = 'error',
  Media = 'media',
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/contracts` → PASS (enums + dto + isomorphic all green; the enum is only appended to).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/contracts/enums.ts" "tests/contracts/enums.test.ts"
git add src/contracts/enums.ts tests/contracts/enums.test.ts
git commit -m "feat(contracts): extend ArtifactKind for run-artifact classification (Slice 30b Phase 3)"
```

---

### Task 2: `RunListItemDTO` — the list-cheap summary DTO

**Files:**
- Modify: `src/contracts/dto.ts`
- Test: `tests/contracts/dto.test.ts` (extend)

**Interfaces:**
- Consumes: `RunLifecycle`, `RunOrigin` enums; the module-local `TokensSchema`.
- Produces: `RunListItemDtoSchema` + `RunListItemDTO` = `{ id: string, startMs: number, durationMs: number, outcome: string, lifecycle: RunLifecycle, origin: RunOrigin, models: string[], degraded: boolean, spanCount: number, tokens?: { input?, output? } }` — **no `spans`, no `artifacts`, no `degrades`** (the whole point of the summary cache). Auto-exported by the `export *` barrel.

- [ ] **Step 1: Write the failing test** — append to `tests/contracts/dto.test.ts`:

```ts
import { RunListItemDtoSchema } from '../../src/contracts/dto.ts';

test('RunListItemDTO parses a minimal summary (tokens optional, no spans/artifacts)', () => {
  const parsed = RunListItemDtoSchema.parse({
    id: 'run-1',
    startMs: 1000,
    durationMs: 42,
    outcome: 'answer',
    lifecycle: RunLifecycle.Done,
    origin: RunOrigin.Manual,
    models: ['qwen3.5:9b'],
    degraded: false,
    spanCount: 7,
  });
  expect(parsed.tokens).toBeUndefined();
  expect(parsed.models).toEqual(['qwen3.5:9b']);
  // The list DTO deliberately carries no heavy arrays.
  expect('spans' in parsed).toBe(false);
  expect('artifacts' in parsed).toBe(false);
});

test('RunListItemDTO round-trips with a token roll-up present', () => {
  const parsed = RunListItemDtoSchema.parse({
    id: 'run-2',
    startMs: 0,
    durationMs: 0,
    outcome: 'unknown',
    lifecycle: RunLifecycle.Running,
    origin: RunOrigin.Manual,
    models: [],
    degraded: true,
    spanCount: 0,
    tokens: { input: 12, output: 8 },
  });
  expect(parsed.tokens).toEqual({ input: 12, output: 8 });
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/contracts/dto.test.ts` → FAIL (`RunListItemDtoSchema` not exported).

- [ ] **Step 3: Minimal impl** — append to `src/contracts/dto.ts` (after `RunDtoSchema`; `TokensSchema` is already declared at the top of the file):

```ts
/** Lightweight list summary — no `spans`/`artifacts`/`degrades` (that is the
 *  whole point of the mtime summary cache; Slice 30b Phase 3, Layer ②). */
export const RunListItemDtoSchema = z.object({
  id: z.string(),
  startMs: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  lifecycle: z.enum(RunLifecycle),
  origin: z.enum(RunOrigin),
  models: z.array(z.string()),
  degraded: z.boolean(),
  spanCount: z.number(),
  tokens: TokensSchema,
});
export type RunListItemDTO = z.infer<typeof RunListItemDtoSchema>;
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/contracts/dto.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/contracts/dto.ts" "tests/contracts/dto.test.ts"
git add src/contracts/dto.ts tests/contracts/dto.test.ts
git commit -m "feat(contracts): RunListItemDTO — list-cheap run summary (no spans/artifacts)"
```

---

### Task 3: `RunListQuery` + `RunListResponse` request/response schemas

**Files:**
- Modify: `src/contracts/requests.ts`
- Test: `tests/contracts/requests.test.ts` (extend)

**Interfaces:**
- Consumes: `RunListItemDtoSchema` (Task 2) — imported from `./dto.ts` (a `./` sibling, allowed by the isomorphism guard).
- Produces:
  - `RunListQuerySchema` → `RunListQuery` = `{ search?: string, outcome?: string, degraded?: boolean, limit: number, cursor?: string }`. Query values arrive as strings, so `limit` uses `z.coerce.number()` with `.default(25)` and `degraded` coerces `'true'/'false'` → boolean. (Coercion lives in the contract but stays zod-only — no forbidden import.)
  - `RunListResponseSchema` → `RunListResponse` = `{ items: RunListItemDTO[], nextCursor?: string, total: number }`.

- [ ] **Step 1: Write the failing test** — append to `tests/contracts/requests.test.ts`:

```ts
import {
  RunListQuerySchema,
  RunListResponseSchema,
} from '../../src/contracts/requests.ts';
import { RunLifecycle, RunOrigin } from '../../src/contracts/enums.ts';

test('RunListQuery coerces string query params and defaults limit', () => {
  const parsed = RunListQuerySchema.parse({
    search: 'qwen',
    outcome: 'answer',
    degraded: 'true',
    limit: '10',
  });
  expect(parsed).toEqual({
    search: 'qwen',
    outcome: 'answer',
    degraded: true,
    limit: 10,
  });
});

test('RunListQuery applies the default limit when omitted', () => {
  const parsed = RunListQuerySchema.parse({});
  expect(parsed.limit).toBe(25);
  expect(parsed.degraded).toBeUndefined();
});

test('RunListResponse validates items + pagination', () => {
  const parsed = RunListResponseSchema.parse({
    items: [
      {
        id: 'run-1',
        startMs: 1,
        durationMs: 2,
        outcome: 'answer',
        lifecycle: RunLifecycle.Done,
        origin: RunOrigin.Manual,
        models: [],
        degraded: false,
        spanCount: 1,
      },
    ],
    nextCursor: 'abc',
    total: 1,
  });
  expect(parsed.items).toHaveLength(1);
  expect(parsed.nextCursor).toBe('abc');
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/contracts/requests.test.ts` → FAIL (schemas not exported).

- [ ] **Step 3: Minimal impl** — append to `src/contracts/requests.ts` (add `RunListItemDtoSchema` to the existing `./dto.ts`? there is no such import yet — add one):

```ts
import { RunListItemDtoSchema } from './dto.ts';

/** `GET /api/runs?search=&outcome=&degraded=&limit=&cursor=` query. Values are
 *  raw query strings, so `limit`/`degraded` coerce; `limit` carries a default. */
export const RunListQuerySchema = z.object({
  search: z.string().optional(),
  outcome: z.string().optional(),
  degraded: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  limit: z.coerce.number().int().positive().max(200).default(25),
  cursor: z.string().optional(),
});
export type RunListQuery = z.infer<typeof RunListQuerySchema>;

/** `GET /api/runs` response — a page of run summaries + a cursor when more remain. */
export const RunListResponseSchema = z.object({
  items: z.array(RunListItemDtoSchema),
  nextCursor: z.string().optional(),
  total: z.number(),
});
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/contracts` → PASS (incl. `isomorphic.test.ts`: the new `./dto.ts` import is a `./` sibling, allowed).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/contracts/requests.ts" "tests/contracts/requests.test.ts"
git add src/contracts/requests.ts tests/contracts/requests.test.ts
git commit -m "feat(contracts): RunListQuery + RunListResponse schemas for the Runs list endpoint"
```

---

## Layer ② — The span→DTO mapper

### Task 4: `readRunArtifacts` — readdir + classify into `ArtifactKind`

**Files:**
- Create: `src/run/artifacts.ts`
- Test: `tests/run/artifacts.test.ts`

**Interfaces:**
- Consumes: `ArtifactKind` from `../contracts/index.ts`; `node:fs/promises` (`readdir`, `stat`), `node:path`.
- Produces: `readRunArtifacts(runDir: string): Promise<{ name: string; bytes: number; kind: ArtifactKind }[]>` — `readdir` the run dir; classify each entry by filename via a table (unknown files → `Other`); `bytes` = `stat().size` for files, and for the `media/` **directory** the rolled-up sum of contained file sizes. A missing run dir → `[]` (never throws).

Classification table (from spec):

| entry | `ArtifactKind` |
|---|---|
| `answer.txt` | `Answer` |
| `gap.txt` | `Gap` |
| `resource.txt` | `Resource` |
| `result.txt` | `Result` |
| `unverified.txt` | `Unverified` |
| `failed.txt` | `Failed` |
| `spans.jsonl` | `Spans` |
| `degradation.jsonl` | `Degradation` |
| `error.json` | `Error` |
| `media/` (dir) | `Media` |
| anything else | `Other` |

- [ ] **Step 1: Write the failing test** — `tests/run/artifacts.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactKind } from '../../src/contracts/enums.ts';
import { readRunArtifacts } from '../../src/run/artifacts.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'art-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('classifies known files and falls unknown files through to Other', async () => {
  await writeFile(join(dir, 'answer.txt'), 'hello');
  await writeFile(join(dir, 'result.txt'), 'r');
  await writeFile(join(dir, 'spans.jsonl'), '{}\n');
  await writeFile(join(dir, 'degradation.jsonl'), '{}\n');
  await writeFile(join(dir, 'error.json'), '{}');
  await writeFile(join(dir, 'random.log'), 'x');
  const arts = await readRunArtifacts(dir);
  const byName = new Map(arts.map((a) => [a.name, a]));
  expect(byName.get('answer.txt')?.kind).toBe(ArtifactKind.Answer);
  expect(byName.get('result.txt')?.kind).toBe(ArtifactKind.Result);
  expect(byName.get('spans.jsonl')?.kind).toBe(ArtifactKind.Spans);
  expect(byName.get('degradation.jsonl')?.kind).toBe(ArtifactKind.Degradation);
  expect(byName.get('error.json')?.kind).toBe(ArtifactKind.Error);
  expect(byName.get('random.log')?.kind).toBe(ArtifactKind.Other);
  expect(byName.get('answer.txt')?.bytes).toBe(5);
});

test('classifies the media/ directory as Media with a rolled-up byte size', async () => {
  await mkdir(join(dir, 'media'), { recursive: true });
  await writeFile(join(dir, 'media', 'a.png'), '1234');
  await writeFile(join(dir, 'media', 'b.png'), '56');
  const arts = await readRunArtifacts(dir);
  const media = arts.find((a) => a.name === 'media');
  expect(media?.kind).toBe(ArtifactKind.Media);
  expect(media?.bytes).toBe(6);
});

test('returns [] for a missing run dir (never throws)', async () => {
  expect(await readRunArtifacts(join(dir, 'nope'))).toEqual([]);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/run/artifacts.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/run/artifacts.ts`:

```ts
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactKind } from '../contracts/index.ts';

const FILE_KINDS: Record<string, ArtifactKind> = {
  'answer.txt': ArtifactKind.Answer,
  'gap.txt': ArtifactKind.Gap,
  'resource.txt': ArtifactKind.Resource,
  'result.txt': ArtifactKind.Result,
  'unverified.txt': ArtifactKind.Unverified,
  'failed.txt': ArtifactKind.Failed,
  'spans.jsonl': ArtifactKind.Spans,
  'degradation.jsonl': ArtifactKind.Degradation,
  'error.json': ArtifactKind.Error,
};

/** Sum of file sizes directly under `dir` (one level; media dirs are flat). */
async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    total += (await stat(join(dir, entry.name))).size;
  }
  return total;
}

/** Readdir + classify one run dir's artifacts into the extended ArtifactKind.
 *  Missing dir → [] (the mapper tolerates a run with only spans.jsonl). */
export async function readRunArtifacts(
  runDir: string,
): Promise<{ name: string; bytes: number; kind: ArtifactKind }[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(runDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; bytes: number; kind: ArtifactKind }[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'media') {
        out.push({
          name: 'media',
          bytes: await dirBytes(join(runDir, 'media')),
          kind: ArtifactKind.Media,
        });
      }
      continue;
    }
    const kind = FILE_KINDS[entry.name] ?? ArtifactKind.Other;
    const bytes = (await stat(join(runDir, entry.name))).size;
    out.push({ name: entry.name, bytes, kind });
  }
  return out;
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/run/artifacts.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/run/artifacts.ts" "tests/run/artifacts.test.ts"
git add src/run/artifacts.ts tests/run/artifacts.test.ts
git commit -m "feat(run): readRunArtifacts — readdir+classify run dir into ArtifactKind"
```

---

### Task 5: `mapRunToDto` — flatten spans + degrades + artifacts into a full `RunDTO`

**Files:**
- Create: `src/run/run-dto.ts`
- Test: `tests/run/run-dto.test.ts`

**Interfaces:**
- Consumes: `readSpans`, `buildTree`, `type TraceNode` from `./run-trace.ts`; `type SpanRecord` from `../telemetry/jsonl-exporter.ts`; `ATTR` from `../telemetry/spans.ts`; `readRunArtifacts` (Task 4); `type DegradeEvent` from `../reliability/ledger.ts`; contract types + `RunDtoSchema`, `RunLifecycle`, `RunOrigin`, `SpanStatus`, `DegradeKind` from `../contracts/index.ts`.
- Produces: `mapRunToDto(runsRoot: string, id: string): Promise<RunDTO | undefined>` — `undefined` when the run has no spans (mirrors `summarizeRun`). Output is validated through `RunDtoSchema` before returning (mapper contract).

Per-span projection (from spec Layer ②):
- Walk `buildTree(spans)` assigning `depth` (root 0, child parent+1); flatten in tree/offset order.
- `rootStartUnixNano` = earliest root's `startUnixNano` (`buildTree` returns roots sorted asc, so `roots[0].span.startUnixNano`).
- `offsetMs = (span.startUnixNano - rootStartUnixNano) / 1e6`; `durationMs = span.durationMs` (already ms).
- `status = span.status.code === 2 ? SpanStatus.Error : SpanStatus.Ok`; `statusMessage = span.status.message`.
- `agent` = `attrs[ATTR.DELEGATION_TARGET]` (string) when present.
- `delegation` = `{ target, depth: attrs[ATTR.DELEGATION_DEPTH], ancestors: String(attrs[ATTR.DELEGATION_ANCESTORS]).split(' → ') }` when `DELEGATION_TARGET` present.
- `model` = `{ id, provider?, numCtx?, footprintBytes?, runtimeDegraded? }` from `MODEL_ID`/`MODEL_PROVIDER`/`MODEL_NUM_CTX`/`MODEL_FOOTPRINT_BYTES`/`MODEL_RUNTIME_DEGRADED` when `MODEL_ID` present.
- `tokens` = `{ input?, output? }` from `USAGE_INPUT_TOKENS`/`USAGE_OUTPUT_TOKENS` when either present.
- `degraded` = `span.events.some((e) => e.name === 'reliability.degrade')`.
- `events` → `{ name, offsetMs: (e.timeUnixNano - rootStartUnixNano) / 1e6, attributes? }`.
- `node` omitted (reserved).

Run-level:
- `roots` = tree roots' span ids; `startMs = Math.round(rootStartUnixNano / 1e6)`.
- `root` = span named `agent.run` (else `undefined`); `durationMs = root?.durationMs ?? 0`.
- `outcome` = `attrs[ATTR.OUTCOME]` off `root` else `'unknown'`; `contentPolicy` = `attrs[ATTR.CONTENT_POLICY]` off `root` when present.
- `models` = distinct `MODEL_ID` across spans.
- `tokens` (run) = sum of per-span input/output (each `undefined` when no span carried it).
- `origin = RunOrigin.Manual`; `owner = 'local'`.
- **lifecycle:** `Running` when there is no `agent.run` span yet (BatchSpanProcessor exports a span only on end, so an in-flight run's root is simply absent — same signal the CLI `--follow` uses); else `Failed` when root `status.code === 2` OR `outcome === 'resource'`; else `Done`.
- `degrades` from `degradation.jsonl` (Task-6 helper `readDegrades` shared); `RunDTO.degraded = degrades.length > 0`.
- `malformedSpans` = `readSpans` malformed count; `spanCount = spans.length`.

- [ ] **Step 1: Write the failing test** — `tests/run/run-dto.test.ts` (fixture spans written to a tmp dir; mirror `run-trace.test.ts`'s `span()` builder):

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunDtoSchema } from '../../src/contracts/dto.ts';
import { RunLifecycle, SpanStatus } from '../../src/contracts/enums.ts';
import { mapRunToDto } from '../../src/run/run-dto.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(
  p: Partial<SpanRecord> & { name: string; spanId: string },
): SpanRecord {
  return {
    kind: 0,
    traceId: 't1',
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 1,
    status: { code: 0 },
    attributes: {},
    events: [],
    ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rd-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, spans: SpanRecord[], extra?: { degradation?: string }) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
  if (extra?.degradation) await writeFile(join(dir, 'degradation.jsonl'), extra.degradation);
  return dir;
}

test('maps a clean run: offsets, depth, tokens sum, Done lifecycle; validates through RunDtoSchema', async () => {
  await writeRun('run-1', [
    span({
      name: 'agent.run',
      spanId: 'a',
      startUnixNano: 1_000_000_000,
      durationMs: 50,
      attributes: { 'agent.outcome': 'answer', 'content.policy': 'standard' },
    }),
    span({
      name: 'ai.generateText',
      spanId: 'b',
      parentSpanId: 'a',
      startUnixNano: 1_010_000_000, // +10ms
      durationMs: 30,
      attributes: {
        'gen_ai.request.model': 'qwen3.5:9b',
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 8,
      },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-1');
  expect(dto).toBeDefined();
  const parsed = RunDtoSchema.parse(dto); // throws if the mapper produced a bad shape
  expect(parsed.lifecycle).toBe(RunLifecycle.Done);
  expect(parsed.outcome).toBe('answer');
  expect(parsed.contentPolicy).toBe('standard');
  expect(parsed.models).toEqual(['qwen3.5:9b']);
  expect(parsed.tokens).toEqual({ input: 12, output: 8 });
  const child = parsed.spans.find((s) => s.spanId === 'b');
  expect(child?.depth).toBe(1);
  expect(child?.offsetMs).toBe(10);
  expect(child?.tokens).toEqual({ input: 12, output: 8 });
  expect(child?.model?.id).toBe('qwen3.5:9b');
});

test('error root → Failed lifecycle + span status Error (code 2)', async () => {
  await writeRun('run-2', [
    span({ name: 'agent.run', spanId: 'a', status: { code: 2, message: 'boom' }, attributes: { 'agent.outcome': 'resource' } }),
  ]);
  const dto = await mapRunToDto(root, 'run-2');
  expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  expect(dto?.spans[0]?.status).toBe(SpanStatus.Error);
  expect(dto?.spans[0]?.statusMessage).toBe('boom');
});

test('in-flight run (no agent.run span yet) → Running lifecycle', async () => {
  await writeRun('run-3', [
    span({ name: 'agent.delegation', spanId: 'd', attributes: { 'agent.delegation.target': 'researcher' } }),
  ]);
  const dto = await mapRunToDto(root, 'run-3');
  expect(dto?.lifecycle).toBe(RunLifecycle.Running);
  expect(dto?.spans[0]?.agent).toBe('researcher');
});

test('degrades come from degradation.jsonl and set degraded=true', async () => {
  await writeRun(
    'run-4',
    [span({ name: 'agent.run', spanId: 'a' })],
    { degradation: `${JSON.stringify({ kind: 'tool_skipped', subject: 'voice', reason: 'no audio' })}\n` },
  );
  const dto = await mapRunToDto(root, 'run-4');
  expect(dto?.degraded).toBe(true);
  expect(dto?.degrades[0]).toMatchObject({ kind: 'tool_skipped', subject: 'voice', label: expect.any(String) });
});

test('undefined for a run with no spans; malformed lines are counted', async () => {
  expect(await mapRunToDto(root, 'missing')).toBeUndefined();
  const dir = join(root, 'run-5');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\nNOT JSON\n`);
  const dto = await mapRunToDto(root, 'run-5');
  expect(dto?.malformedSpans).toBe(1);
  expect(dto?.spanCount).toBe(1);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/run/run-dto.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/run/run-dto.ts` (the `readDegrades` + summary/cache parts land in Task 6; this task ships `mapRunToDto` + shared helpers):

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type DegradeDTO,
  DegradeKind,
  type RunDTO,
  RunDtoSchema,
  RunLifecycle,
  RunOrigin,
  type SpanDTO,
  SpanStatus,
} from '../contracts/index.ts';
import type { DegradeEvent } from '../reliability/ledger.ts';
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';
import { ATTR } from '../telemetry/spans.ts';
import { readRunArtifacts } from './artifacts.ts';
import { buildTree, readSpans, type TraceNode } from './run-trace.ts';

const NANOS_PER_MS = 1e6;
const OTEL_STATUS_ERROR = 2;

/** Human label per DegradeKind (mapper-side; the ledger's LABEL map is not exported). */
const DEGRADE_LABEL: Record<DegradeKind, string> = {
  [DegradeKind.ModelDegraded]: 'degraded model',
  [DegradeKind.AgentDropped]: 'dropped agent',
  [DegradeKind.ToolSkipped]: 'skipped tool',
  [DegradeKind.Retried]: 'retried',
  [DegradeKind.CircuitOpen]: 'circuit open',
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function tokensOf(attrs: Record<string, unknown>): SpanDTO['tokens'] {
  const input = num(attrs[ATTR.USAGE_INPUT_TOKENS]);
  const output = num(attrs[ATTR.USAGE_OUTPUT_TOKENS]);
  if (input === undefined && output === undefined) return undefined;
  return { input, output };
}

/** Read degradation.jsonl (one DegradeEvent per line) → DegradeDTO[]. Missing → []. */
export async function readDegrades(runDir: string): Promise<DegradeDTO[]> {
  let raw: string;
  try {
    raw = await readFile(join(runDir, 'degradation.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const out: DegradeDTO[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      const e = JSON.parse(line) as DegradeEvent;
      out.push({
        kind: e.kind,
        label: DEGRADE_LABEL[e.kind] ?? e.kind,
        subject: e.subject,
        reason: e.reason,
        from: e.from,
        to: e.to,
        attempts: e.attempts,
        lane: e.lane,
      });
    } catch {
      // tolerate a torn line; degradation is best-effort telemetry
    }
  }
  return out;
}

function projectSpan(
  span: SpanRecord,
  depth: number,
  rootStartUnixNano: number,
): SpanDTO {
  const a = span.attributes;
  const target = str(a[ATTR.DELEGATION_TARGET]);
  const modelId = str(a[ATTR.MODEL_ID]);
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    offsetMs: (span.startUnixNano - rootStartUnixNano) / NANOS_PER_MS,
    durationMs: span.durationMs,
    depth,
    status:
      span.status.code === OTEL_STATUS_ERROR ? SpanStatus.Error : SpanStatus.Ok,
    statusMessage: span.status.message,
    agent: target,
    delegation: target
      ? {
          target,
          depth: num(a[ATTR.DELEGATION_DEPTH]) ?? depth,
          ancestors: str(a[ATTR.DELEGATION_ANCESTORS])?.split(' → ') ?? [],
        }
      : undefined,
    model: modelId
      ? {
          id: modelId,
          provider: str(a[ATTR.MODEL_PROVIDER]),
          numCtx: num(a[ATTR.MODEL_NUM_CTX]),
          footprintBytes: num(a[ATTR.MODEL_FOOTPRINT_BYTES]),
          runtimeDegraded:
            typeof a[ATTR.MODEL_RUNTIME_DEGRADED] === 'boolean'
              ? (a[ATTR.MODEL_RUNTIME_DEGRADED] as boolean)
              : undefined,
        }
      : undefined,
    tokens: tokensOf(a),
    degraded: span.events.some((e) => e.name === 'reliability.degrade'),
    attributes: a,
    events: span.events.map((e) => ({
      name: e.name,
      offsetMs: (e.timeUnixNano - rootStartUnixNano) / NANOS_PER_MS,
      attributes: e.attributes,
    })),
  };
}

/** Depth-first flatten (tree/offset order), assigning depth. */
function flatten(nodes: TraceNode[], depth: number, rootStart: number, out: SpanDTO[]): void {
  for (const node of nodes) {
    out.push(projectSpan(node.span, depth, rootStart));
    flatten(node.children, depth + 1, rootStart, out);
  }
}

export async function mapRunToDto(
  runsRoot: string,
  id: string,
): Promise<RunDTO | undefined> {
  const runDir = join(runsRoot, id);
  const { spans, malformed } = await readSpans(runDir);
  if (spans.length === 0) return undefined;

  const tree = buildTree(spans);
  const rootStartUnixNano = tree[0]?.span.startUnixNano ?? 0;
  const flat: SpanDTO[] = [];
  flatten(tree, 0, rootStartUnixNano, flat);

  const runRoot = spans.find((s) => s.name === 'agent.run');
  const models = new Set<string>();
  let tokIn: number | undefined;
  let tokOut: number | undefined;
  for (const s of flat) {
    if (s.model?.id) models.add(s.model.id);
    if (s.tokens?.input !== undefined) tokIn = (tokIn ?? 0) + s.tokens.input;
    if (s.tokens?.output !== undefined) tokOut = (tokOut ?? 0) + s.tokens.output;
  }
  const runTokens =
    tokIn === undefined && tokOut === undefined
      ? undefined
      : { input: tokIn, output: tokOut };

  const outcome = str(runRoot?.attributes[ATTR.OUTCOME]) ?? 'unknown';
  const lifecycle = !runRoot
    ? RunLifecycle.Running
    : runRoot.status.code === OTEL_STATUS_ERROR || outcome === 'resource'
      ? RunLifecycle.Failed
      : RunLifecycle.Done;

  const degrades = await readDegrades(runDir);
  const artifacts = await readRunArtifacts(runDir);

  const dto: RunDTO = {
    id,
    owner: 'local',
    origin: RunOrigin.Manual,
    lifecycle,
    startMs: Math.round(rootStartUnixNano / NANOS_PER_MS),
    durationMs: runRoot?.durationMs ?? 0,
    outcome,
    models: [...models],
    contentPolicy: str(runRoot?.attributes[ATTR.CONTENT_POLICY]),
    tokens: runTokens,
    degraded: degrades.length > 0,
    degrades,
    malformedSpans: malformed,
    spanCount: spans.length,
    roots: tree.map((n) => n.span.spanId),
    spans: flat,
    artifacts,
  };
  return RunDtoSchema.parse(dto);
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/run/run-dto.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/run/run-dto.ts" "tests/run/run-dto.test.ts"
git add src/run/run-dto.ts tests/run/run-dto.test.ts
git commit -m "feat(run): mapRunToDto — flatten spans/degrades/artifacts into a validated RunDTO"
```

---

### Task 6: `summarizeRunListItem` + mtime-keyed summary cache

**Files:**
- Modify: `src/run/run-dto.ts`
- Test: `tests/run/run-summary.test.ts`

**Interfaces:**
- Consumes: `readSpans`, `ATTR`, `readDegrades` (Task 5), `RunListItemDtoSchema`/`RunListItemDTO`, `RunLifecycle`, `RunOrigin` from `../contracts/index.ts`; `node:fs/promises` `stat`.
- Produces: `summarizeRunListItem(runsRoot: string, id: string): Promise<RunListItemDTO | undefined>` — the list-cheap projection (spanCount/models/lifecycle/tokens/outcome/degraded), **no full flatten, no artifacts, no degrades-file read** (degraded is derived from span events — cheaper than reading the file). Fronted by a module-level **mtime cache keyed on `spans.jsonl`'s `mtimeMs`** — because appending to `spans.jsonl` bumps the FILE mtime (a directory's mtime does NOT change on content append), so keying on the file is what actually invalidates an in-flight run. A hit returns the memoized item; a miss (or changed mtime) recomputes.

- [ ] **Step 1: Write the failing test** — `tests/run/run-summary.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLifecycle } from '../../src/contracts/enums.ts';
import {
  __summaryCacheSize,
  summarizeRunListItem,
} from '../../src/run/run-dto.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(id: string, spans: SpanRecord[]) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
  return dir;
}

test('summarizes a run without spans/artifacts arrays', async () => {
  await write('r1', [
    span({ name: 'agent.run', spanId: 'a', durationMs: 5, attributes: { 'agent.outcome': 'answer', 'gen_ai.request.model': 'm' } }),
  ]);
  const item = await summarizeRunListItem(root, 'r1');
  expect(item?.outcome).toBe('answer');
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.models).toEqual(['m']);
  expect(item?.spanCount).toBe(1);
});

test('memoizes on unchanged spans.jsonl mtime, recomputes when it changes', async () => {
  await write('r2', [span({ name: 'agent.run', spanId: 'a' })]);
  await summarizeRunListItem(root, 'r2');
  const sizeAfterFirst = __summaryCacheSize();
  await summarizeRunListItem(root, 'r2'); // cache hit — no new entry
  expect(__summaryCacheSize()).toBe(sizeAfterFirst);
  // append a span → file mtime changes → recompute
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(join(root, 'r2', 'spans.jsonl'), `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\n${JSON.stringify(span({ name: 'x', spanId: 'b' }))}\n`);
  const item = await summarizeRunListItem(root, 'r2');
  expect(item?.spanCount).toBe(2);
});

test('undefined for a run with no spans', async () => {
  expect(await summarizeRunListItem(root, 'nope')).toBeUndefined();
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/run/run-summary.test.ts` → FAIL (`summarizeRunListItem`/`__summaryCacheSize` not exported).

- [ ] **Step 3: Minimal impl** — append to `src/run/run-dto.ts`:

```ts
import { stat } from 'node:fs/promises';
import {
  type RunListItemDTO,
  RunListItemDtoSchema,
} from '../contracts/index.ts';

// mtime-keyed summary cache. The rich list would otherwise be O(runs ×
// spans/run) disk reads per keystroke-driven request; a real persisted index
// is Phase 6 — this is the stateless-friendly interim. Keyed on spans.jsonl's
// mtimeMs so an in-flight run (still being appended) always recomputes.
const summaryCache = new Map<string, { mtimeMs: number; item: RunListItemDTO }>();

/** Test-only: current cache entry count (asserts memoization vs recompute). */
export function __summaryCacheSize(): number {
  return summaryCache.size;
}

export async function summarizeRunListItem(
  runsRoot: string,
  id: string,
): Promise<RunListItemDTO | undefined> {
  const runDir = join(runsRoot, id);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(join(runDir, 'spans.jsonl'))).mtimeMs;
  } catch {
    return undefined; // no spans.jsonl → not a completed/started run
  }
  const cached = summaryCache.get(runDir);
  if (cached && cached.mtimeMs === mtimeMs) return cached.item;

  const { spans } = await readSpans(runDir);
  if (spans.length === 0) return undefined;
  const runRoot = spans.find((s) => s.name === 'agent.run');
  const models = new Set<string>();
  let tokIn: number | undefined;
  let tokOut: number | undefined;
  let degraded = false;
  for (const s of spans) {
    const m = str(s.attributes[ATTR.MODEL_ID]);
    if (m) models.add(m);
    const i = num(s.attributes[ATTR.USAGE_INPUT_TOKENS]);
    const o = num(s.attributes[ATTR.USAGE_OUTPUT_TOKENS]);
    if (i !== undefined) tokIn = (tokIn ?? 0) + i;
    if (o !== undefined) tokOut = (tokOut ?? 0) + o;
    if (s.events.some((e) => e.name === 'reliability.degrade')) degraded = true;
  }
  const outcome = str(runRoot?.attributes[ATTR.OUTCOME]) ?? 'unknown';
  const lifecycle = !runRoot
    ? RunLifecycle.Running
    : runRoot.status.code === OTEL_STATUS_ERROR || outcome === 'resource'
      ? RunLifecycle.Failed
      : RunLifecycle.Done;
  const item = RunListItemDtoSchema.parse({
    id,
    startMs: Math.round((runRoot ?? spans[0]).startUnixNano / NANOS_PER_MS),
    durationMs: runRoot?.durationMs ?? 0,
    outcome,
    lifecycle,
    origin: RunOrigin.Manual,
    models: [...models],
    degraded,
    spanCount: spans.length,
    tokens:
      tokIn === undefined && tokOut === undefined
        ? undefined
        : { input: tokIn, output: tokOut },
  });
  summaryCache.set(runDir, { mtimeMs, item });
  return item;
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/run/run-summary.test.ts tests/run/run-dto.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/run/run-dto.ts" "tests/run/run-summary.test.ts"
git add src/run/run-dto.ts tests/run/run-summary.test.ts
git commit -m "feat(run): summarizeRunListItem + mtime-keyed summary cache (Phase-6 index is the real fix)"
```

---

## Layer ③ — Server endpoints

### Task 7: Thread `runsRoot` into `ServerDeps`

**Files:**
- Modify: `src/server/app.ts` (`ServerDeps`), `src/server/main.ts` (pass `runsRoot` into `deps`)
- Modify (fixtures): `tests/server/app.test.ts` (three `ServerDeps` literals gain `runsRoot`)
- Test: existing suites stay green (no new behavior yet — this is the wiring seam the endpoints consume)

**Interfaces:**
- Produces: `ServerDeps` gains a required `runsRoot: string`. `RunsDeps = { runsRoot: string }` (declared in Task 8, the first consumer) is a structural subset — `ServerDeps` satisfies it. `src/server/main.ts` already has `const runsRoot = 'runs'` at line 52; add `runsRoot` to the `deps` object it builds.

- [ ] **Step 1: Add the field** — in `src/server/app.ts` `ServerDeps`, after `uploadsDir`:

```ts
  /** Root dir the Runs endpoints read on-disk spans/artifacts from (Phase 3). */
  runsRoot: string;
```

- [ ] **Step 2: Wire `main.ts`** — in the `deps: ServerDeps = { ... }` literal, add `runsRoot,` (the local `const runsRoot = 'runs'` already exists at line 52).

- [ ] **Step 3: Update fixtures** — in `tests/server/app.test.ts`, add `runsRoot: 'runs'` (or a `mkdtempSync` dir) to each of the three `ServerDeps` literals (`deps`, `throwingDeps`, `confinedDeps`, `symlinkDeps` — every literal that exists). Grep to be sure none are missed: `grep -n "ServerDeps = {" tests/server/app.test.ts`.

- [ ] **Step 4: Run** — `bun run typecheck` clean (proves every `ServerDeps` construction now supplies `runsRoot`); `bun test --path-ignore-patterns 'web/**' tests/server/app.test.ts tests/server/main.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/app.ts" "src/server/main.ts" "tests/server/app.test.ts"
git add src/server/app.ts src/server/main.ts tests/server/app.test.ts
git commit -m "feat(server): thread runsRoot into ServerDeps for the Runs endpoints"
```

---

### Task 8: `handleRunDetail` — `GET /api/runs/:id` → RunDTO / 404

**Files:**
- Create: `src/server/runs/detail.ts`
- Test: `tests/server/runs-detail.test.ts`

**Interfaces:**
- Consumes: `mapRunToDto` (Task 5); `confineToDir`, `MediaPathError` from `../security/media-path.ts`; the `json` helper (re-declare the small local `json` as in `chat/handler.ts`, or import from `../app.ts` — prefer a local copy to avoid a cycle, mirroring `chat/handler.ts`).
- Produces: `type RunsDeps = { runsRoot: string }` and `handleRunDetail(id: string, deps: RunsDeps): Promise<Response>` — `confineToDir(id, runsRoot)` guards traversal (`MediaPathError` → 404, no leak); `mapRunToDto` `undefined` → 404; else 200 JSON `RunDTO` under `ISOLATION_HEADERS`.

- [ ] **Step 1: Write the failing test** — `tests/server/runs-detail.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRunDetail } from '../../src/server/runs/detail.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'det-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('200 with a RunDTO for an existing run', async () => {
  const dir = join(root, 'run-1');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${JSON.stringify(span({ name: 'agent.run', spanId: 'a', attributes: { 'agent.outcome': 'answer' } }))}\n`);
  const res = await handleRunDetail('run-1', { runsRoot: root });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; outcome: string };
  expect(body.id).toBe('run-1');
  expect(body.outcome).toBe('answer');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
});

test('404 for a missing run', async () => {
  const res = await handleRunDetail('nope', { runsRoot: root });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

test('path traversal on :id → 404 (no leak, MediaPathError)', async () => {
  const res = await handleRunDetail('../../../../etc', { runsRoot: root });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-detail.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/server/runs/detail.ts`:

```ts
import { mapRunToDto } from '../../run/run-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';

export type RunsDeps = { runsRoot: string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/runs/:id` — full RunDTO, or 404 (missing OR path-escaping id). */
export async function handleRunDetail(
  id: string,
  deps: RunsDeps,
): Promise<Response> {
  try {
    confineToDir(id, deps.runsRoot); // realpath-confine; throws on ../ / symlink / missing
  } catch (err) {
    if (err instanceof MediaPathError) return json({ error: 'not found' }, 404);
    throw err;
  }
  const dto = await mapRunToDto(deps.runsRoot, id);
  if (!dto) return json({ error: 'not found' }, 404);
  return json(dto, 200);
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-detail.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/runs/detail.ts" "tests/server/runs-detail.test.ts"
git add src/server/runs/detail.ts tests/server/runs-detail.test.ts
git commit -m "feat(server): handleRunDetail — GET /api/runs/:id → RunDTO / 404 (confineToDir guarded)"
```

---

### Task 9: `handleRunList` — `GET /api/runs` filtered/sorted/paginated list

**Files:**
- Create: `src/server/runs/list.ts`
- Test: `tests/server/runs-list.test.ts`

**Interfaces:**
- Consumes: `RunListQuerySchema`, `RunListResponseSchema` from `../../contracts/index.ts`; `summarizeRunListItem` (Task 6); `readdir` from `node:fs/promises`; `RunsDeps` from `./detail.ts`; `ISOLATION_HEADERS`.
- Produces: `handleRunList(params: URLSearchParams, deps: RunsDeps): Promise<Response>` — build a raw object from `params`, `RunListQuerySchema.parse` it, `readdir(runsRoot)` for directories, `summarizeRunListItem` each (cache-fronted), filter (`search` case-insensitive substring over `id` + `models.join(' ')` + `outcome`; `outcome` exact facet; `degraded` exact facet), **sort desc by `startMs`**, then paginate via an opaque cursor. `total` = filtered count; `nextCursor` set when more remain. 200 JSON `RunListResponse`.
- Cursor helpers: `encodeCursor(item) = base64url(`${item.startMs}:${item.id}`)`; `decodeCursor(s)` → `{ startMs, id }`. Pagination: after the desc sort, if a cursor is given, drop items up to and including the one whose `id` matches the cursor's `id`; then take `limit`.

- [ ] **Step 1: Write the failing test** — `tests/server/runs-list.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunListResponse } from '../../src/contracts/requests.ts';
import { handleRunList } from '../../src/server/runs/list.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'list-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, startNano: number, attrs: Record<string, unknown>, extraSpans: SpanRecord[] = []) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const spans = [span({ name: 'agent.run', spanId: `${id}-a`, startUnixNano: startNano, attributes: attrs }), ...extraSpans];
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
}

async function list(qs: string): Promise<RunListResponse> {
  const res = await handleRunList(new URLSearchParams(qs), { runsRoot: root });
  expect(res.status).toBe(200);
  return (await res.json()) as RunListResponse;
}

test('sorts newest-first by startMs and reports total', async () => {
  await writeRun('old', 1_000_000_000, { 'agent.outcome': 'answer', 'gen_ai.request.model': 'qwen' });
  await writeRun('new', 5_000_000_000, { 'agent.outcome': 'answer', 'gen_ai.request.model': 'llama' });
  const page = await list('');
  expect(page.total).toBe(2);
  expect(page.items.map((i) => i.id)).toEqual(['new', 'old']);
});

test('search filters over id/models/outcome (case-insensitive)', async () => {
  await writeRun('run-a', 2_000_000_000, { 'agent.outcome': 'answer', 'gen_ai.request.model': 'qwen3.5:9b' });
  await writeRun('run-b', 1_000_000_000, { 'agent.outcome': 'gap', 'gen_ai.request.model': 'llama' });
  expect((await list('search=QWEN')).items.map((i) => i.id)).toEqual(['run-a']);
  expect((await list('search=gap')).items.map((i) => i.id)).toEqual(['run-b']);
});

test('outcome + degraded facets filter', async () => {
  await writeRun('r-ok', 3_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('r-gap', 2_000_000_000, { 'agent.outcome': 'gap' });
  await writeRun('r-deg', 1_000_000_000, { 'agent.outcome': 'answer' }, [
    span({ name: 'agent.delegation', spanId: 'd', events: [{ name: 'reliability.degrade', timeUnixNano: 0 }] }),
  ]);
  expect((await list('outcome=gap')).items.map((i) => i.id)).toEqual(['r-gap']);
  expect((await list('degraded=true')).items.map((i) => i.id)).toEqual(['r-deg']);
});

test('paginates via limit + opaque cursor', async () => {
  await writeRun('a', 3_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('b', 2_000_000_000, { 'agent.outcome': 'answer' });
  await writeRun('c', 1_000_000_000, { 'agent.outcome': 'answer' });
  const p1 = await list('limit=2');
  expect(p1.items.map((i) => i.id)).toEqual(['a', 'b']);
  expect(p1.nextCursor).toBeDefined();
  const p2 = await list(`limit=2&cursor=${encodeURIComponent(p1.nextCursor as string)}`);
  expect(p2.items.map((i) => i.id)).toEqual(['c']);
  expect(p2.nextCursor).toBeUndefined();
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-list.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/server/runs/list.ts`:

```ts
import { readdir } from 'node:fs/promises';
import type { RunListItemDTO } from '../../contracts/index.ts';
import {
  RunListQuerySchema,
  RunListResponseSchema,
} from '../../contracts/index.ts';
import { summarizeRunListItem } from '../../run/run-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { RunsDeps } from './detail.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

function encodeCursor(item: RunListItemDTO): string {
  return Buffer.from(`${item.startMs}:${item.id}`).toString('base64url');
}
function decodeCursorId(cursor: string): string | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx === -1 ? undefined : decoded.slice(idx + 1);
  } catch {
    return undefined;
  }
}

function matchesSearch(item: RunListItemDTO, search: string): boolean {
  const hay = `${item.id} ${item.models.join(' ')} ${item.outcome}`.toLowerCase();
  return hay.includes(search.toLowerCase());
}

export async function handleRunList(
  params: URLSearchParams,
  deps: RunsDeps,
): Promise<Response> {
  const query = RunListQuerySchema.parse({
    search: params.get('search') ?? undefined,
    outcome: params.get('outcome') ?? undefined,
    degraded: params.get('degraded') ?? undefined,
    limit: params.get('limit') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
  });

  let ids: string[];
  try {
    const entries = await readdir(deps.runsRoot, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return json(RunListResponseSchema.parse({ items: [], total: 0 }), 200);
  }

  const summaries: RunListItemDTO[] = [];
  for (const id of ids) {
    const item = await summarizeRunListItem(deps.runsRoot, id);
    if (item) summaries.push(item);
  }

  const filtered = summaries
    .filter((s) => (query.search ? matchesSearch(s, query.search) : true))
    .filter((s) => (query.outcome ? s.outcome === query.outcome : true))
    .filter((s) =>
      query.degraded === undefined ? true : s.degraded === query.degraded,
    )
    .sort((a, b) => b.startMs - a.startMs);

  let start = 0;
  if (query.cursor) {
    const cursorId = decodeCursorId(query.cursor);
    const idx = filtered.findIndex((s) => s.id === cursorId);
    start = idx === -1 ? 0 : idx + 1;
  }
  const page = filtered.slice(start, start + query.limit);
  const hasMore = start + query.limit < filtered.length;
  const last = page[page.length - 1];

  return json(
    RunListResponseSchema.parse({
      items: page,
      total: filtered.length,
      nextCursor: hasMore && last ? encodeCursor(last) : undefined,
    }),
    200,
  );
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-list.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/runs/list.ts" "tests/server/runs-list.test.ts"
git add src/server/runs/list.ts tests/server/runs-list.test.ts
git commit -m "feat(server): handleRunList — filtered/sorted/paginated GET /api/runs"
```

---

### Task 10: `withRunStreamSpan` + `handleRunStream` (SSE snapshot-then-tail)

**Files:**
- Modify: `src/telemetry/spans.ts` (add `RUN_STREAM_*` ATTR keys + `withRunStreamSpan`)
- Create: `src/server/runs/stream.ts`
- Test: `tests/telemetry/run-stream-span.test.ts`, `tests/server/runs-stream.test.ts`

**Interfaces:**
- Produces (telemetry): new ATTR keys `RUN_STREAM_CHUNKS='run.stream.chunks'`, `RUN_STREAM_BYTES='run.stream.bytes'`, `RUN_STREAM_RESUMES='run.stream.resumes'`, `RUN_STREAM_OUTCOME='run.stream.outcome'`, `RUN_STREAM_RUN_ID='run.stream.run_id'`; and `withRunStreamSpan(info: { route: string; runId: string }, fn: (rec: { chunk(bytes): void; resume(): void; outcome(o): void }) => Promise<T>): Promise<T>` — opens a `runs.stream` span, aggregates chunks/bytes/resumes/outcome in a `finally` (mirror `withUiStreamSpan` at `spans.ts:259`).
- Produces (server): `handleRunStream(id, deps, opts): Promise<Response>` where `opts = { lastEventId?: string; signal?: AbortSignal; pollMs?: number; maxWaitMs?: number }`. `confineToDir` guard → 404. Otherwise a `text/event-stream` Response whose body: (a) emits each `RunDTO.spans` entry as an SSE frame `id: <spanId>\ndata: <SpanDTO json>\n\n` (snapshot), tracking emitted `spanId`s; (b) polls (`mapRunToDto` every `pollMs`, default 250) emitting only new spans until `lifecycle !== Running` (root closed — same stop signal the CLI `--follow` uses) then records outcome + closes; (c) on `lastEventId`, seeds the emitted set with every span up to and including that id from the first snapshot and calls `rec.resume()` (replay only newer). Bounded by `maxWaitMs` (default 600_000) and `signal` abort. Wrapped in `withRunStreamSpan`.

- [ ] **Step 1a: Telemetry test** — `tests/telemetry/run-stream-span.test.ts` (mirror `ui-stream-span.test.ts` exactly — same helper import path `../helpers/otel-test-provider.ts`, same `exporter.getFinishedSpans()` accessor):

```ts
import { describe, expect, it } from 'bun:test';
import { ATTR, withRunStreamSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('runs.stream span', () => {
  it('aggregates chunks/bytes/resumes/outcome + runId', async () => {
    const { exporter, provider } = registerTestProvider();
    await withRunStreamSpan(
      { route: '/api/runs/r1/stream', runId: 'r1' },
      async (rec) => {
        rec.chunk(10);
        rec.chunk(20);
        rec.resume();
        rec.outcome('done');
      },
    );
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runs.stream');
    expect(span?.attributes[ATTR.RUN_STREAM_CHUNKS]).toBe(2);
    expect(span?.attributes[ATTR.RUN_STREAM_BYTES]).toBe(30);
    expect(span?.attributes[ATTR.RUN_STREAM_RESUMES]).toBe(1);
    expect(span?.attributes[ATTR.RUN_STREAM_OUTCOME]).toBe('done');
    expect(span?.attributes[ATTR.RUN_STREAM_RUN_ID]).toBe('r1');
    await provider.shutdown();
  });
});
```

- [ ] **Step 1b: Impl telemetry** — add the five ATTR keys next to the `UI_STREAM_*` block (`spans.ts:155-158`) and `withRunStreamSpan` right after `withUiStreamSpan` (`spans.ts:293`):

```ts
export function withRunStreamSpan<T>(
  info: { route: string; runId: string },
  fn: (rec: {
    chunk: (bytes: number) => void;
    resume: () => void;
    outcome: (o: string) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('runs.stream', async (span) => {
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    span.setAttribute(ATTR.RUN_STREAM_RUN_ID, info.runId);
    let chunks = 0;
    let bytes = 0;
    let resumes = 0;
    let outcome = 'unknown';
    try {
      return await fn({
        chunk: (b) => {
          chunks += 1;
          bytes += b;
        },
        resume: () => {
          resumes += 1;
        },
        outcome: (o) => {
          outcome = o;
        },
      });
    } finally {
      span.setAttribute(ATTR.RUN_STREAM_CHUNKS, chunks);
      span.setAttribute(ATTR.RUN_STREAM_BYTES, bytes);
      span.setAttribute(ATTR.RUN_STREAM_RESUMES, resumes);
      span.setAttribute(ATTR.RUN_STREAM_OUTCOME, outcome);
    }
  });
}
```

- [ ] **Step 1c: Gate telemetry** — `bun test --path-ignore-patterns 'web/**' tests/telemetry/run-stream-span.test.ts` → PASS; `bun run typecheck`.

- [ ] **Step 2: Server stream test** — `tests/server/runs-stream.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRunStream } from '../../src/server/runs/stream.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'strm-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSpans(id: string, spans: SpanRecord[]) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
}

/** Collect SSE `{id,data}` frames from a Response body until it closes. */
async function collect(res: Response): Promise<{ id: string; data: unknown }[]> {
  const out: { id: string; data: unknown }[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep = buf.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let id = '';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length) out.push({ id, data: JSON.parse(data.join('\n')) });
      sep = buf.indexOf('\n\n');
    }
  }
  return out;
}

test('404 on a path-escaping id', async () => {
  const res = await handleRunStream('../../etc', { runsRoot: root }, {});
  expect(res.status).toBe(404);
});

test('snapshot then tail: emits existing spans, then a newly-appended span, then closes on root close', async () => {
  // in-flight: no agent.run yet → Running → keeps tailing
  await writeSpans('r1', [span({ name: 'agent.delegation', spanId: 's1' })]);
  const res = await handleRunStream('r1', { runsRoot: root }, { pollMs: 20, maxWaitMs: 5_000 });
  // append the root while the stream tails → run becomes Done → stream closes
  setTimeout(() => {
    void writeSpans('r1', [
      span({ name: 'agent.delegation', spanId: 's1' }),
      span({ name: 'agent.run', spanId: 'root', attributes: { 'agent.outcome': 'answer' } }),
    ]);
  }, 60);
  const frames = await collect(res);
  const ids = frames.map((f) => f.id);
  expect(ids).toContain('s1');
  expect(ids).toContain('root');
  expect(res.headers.get('content-type')).toContain('text/event-stream');
});

test('Last-Event-ID resume replays only spans after the cursor', async () => {
  await writeSpans('r2', [
    span({ name: 'agent.run', spanId: 'a', attributes: { 'agent.outcome': 'answer' } }),
    span({ name: 'x', spanId: 'b', parentSpanId: 'a' }),
  ]);
  // full run (Done) closes immediately after snapshot
  const first = await collect(await handleRunStream('r2', { runsRoot: root }, { pollMs: 20 }));
  const firstId = first[0]!.id;
  const resumed = await collect(
    await handleRunStream('r2', { runsRoot: root }, { lastEventId: firstId, pollMs: 20 }),
  );
  expect(resumed.map((f) => f.id)).not.toContain(firstId);
  expect(resumed.length).toBeLessThan(first.length);
});
```

- [ ] **Step 3: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-stream.test.ts` → FAIL (module missing).

- [ ] **Step 4: Minimal impl** — `src/server/runs/stream.ts`:

```ts
import { mapRunToDto } from '../../run/run-dto.ts';
import { RunLifecycle, type SpanDTO } from '../../contracts/index.ts';
import { withRunStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunsDeps } from './detail.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function frame(span: SpanDTO): string {
  return `id: ${span.spanId}\ndata: ${JSON.stringify(span)}\n\n`;
}

export type RunStreamOpts = {
  lastEventId?: string;
  signal?: AbortSignal;
  pollMs?: number;
  maxWaitMs?: number;
};

export async function handleRunStream(
  id: string,
  deps: RunsDeps,
  opts: RunStreamOpts,
): Promise<Response> {
  try {
    confineToDir(id, deps.runsRoot);
  } catch (err) {
    if (err instanceof MediaPathError) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
      });
    }
    throw err;
  }

  const pollMs = opts.pollMs ?? 250;
  const maxWaitMs = opts.maxWaitMs ?? 600_000;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void withRunStreamSpan(
        { route: `/api/runs/${id}/stream`, runId: id },
        async (rec) => {
          const emitted = new Set<string>();
          let seededResume = false;
          const deadline = Date.now() + maxWaitMs;
          try {
            for (;;) {
              if (opts.signal?.aborted || Date.now() > deadline) {
                rec.outcome('aborted');
                break;
              }
              const dto = await mapRunToDto(deps.runsRoot, id);
              if (dto) {
                // Resume: on the first snapshot, mark everything up to and
                // including lastEventId as already-emitted so only newer spans go.
                if (!seededResume && opts.lastEventId) {
                  seededResume = true;
                  rec.resume();
                  for (const s of dto.spans) {
                    emitted.add(s.spanId);
                    if (s.spanId === opts.lastEventId) break;
                  }
                }
                for (const s of dto.spans) {
                  if (emitted.has(s.spanId)) continue;
                  emitted.add(s.spanId);
                  const text = frame(s);
                  controller.enqueue(encoder.encode(text));
                  rec.chunk(text.length);
                }
                if (dto.lifecycle !== RunLifecycle.Running) {
                  rec.outcome(dto.outcome);
                  break;
                }
              }
              await sleep(pollMs);
            }
          } catch (err) {
            rec.outcome('error');
            // Degrade: end the stream with the last known spans, never crash.
            void err;
          } finally {
            controller.close();
          }
        },
      );
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      ...ISOLATION_HEADERS,
    },
  });
}
```

- [ ] **Step 5: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-stream.test.ts` → PASS.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/telemetry/spans.ts" "src/server/runs/stream.ts" "tests/telemetry/run-stream-span.test.ts" "tests/server/runs-stream.test.ts"
git add src/telemetry/spans.ts src/server/runs/stream.ts tests/telemetry/run-stream-span.test.ts tests/server/runs-stream.test.ts
git commit -m "feat(server): runs.stream span + handleRunStream (SSE snapshot-then-tail + Last-Event-ID resume)"
```

---

### Task 11: Wire the three GET routes into `handleApi`

**Files:**
- Modify: `src/server/app.ts` (`handleApi`)
- Test: `tests/server/runs-routes.test.ts` (through `buildFetch`, perimeter + token still enforced)

**Interfaces:**
- Consumes: `handleRunDetail` (Task 8), `handleRunList` (Task 9), `handleRunStream` (Task 10).
- Produces: three GET matches in `handleApi`, ordered **stream before bare-id** (so `:id/stream` is not swallowed by `:id`), and list before both. The existing POST `/api/runs/:id/respond` match stays. `handleRunStream` passes `{ lastEventId: req.headers.get('Last-Event-ID') ?? undefined, signal: req.signal }`.

- [ ] **Step 1: Write the failing test** — `tests/server/runs-routes.test.ts` (mirror `app.test.ts`'s `buildFetch` boot with a `runsRoot` pointed at a tmp dir holding one run):

```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';

const TOKEN = 'a'.repeat(64);
const policy = { port: 0, allowedOrigins: [] as string[] };
const runsRoot = mkdtempSync(join(tmpdir(), 'routes-runs-'));
mkdirSync(join(runsRoot, 'run-1'), { recursive: true });
writeFileSync(
  join(runsRoot, 'run-1', 'spans.jsonl'),
  `${JSON.stringify({ name: 'agent.run', kind: 0, traceId: 't', spanId: 'a', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: { 'agent.outcome': 'answer' }, events: [] })}\n`,
);
const noRun: RunChatTurn = async () => { throw new Error('unused'); };
const deps: ServerDeps = {
  token: TOKEN, policy, recordIo: false, indexHtml: '<!doctype html><title>t</title>',
  runChatTurn: noRun, consent: createConsentRegistry(), uploadsDir: runsRoot, runsRoot,
};

let server: ReturnType<typeof Bun.serve>;
let base: string;
beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: buildFetch(deps), idleTimeout: 0 });
  const { port } = server;
  if (port === undefined) throw new Error('no port');
  policy.port = port;
  base = `http://localhost:${port}`;
});
afterAll(() => server.stop(true));

const auth = { authorization: `Bearer ${TOKEN}` };

test('GET /api/runs requires the token', async () => {
  expect((await fetch(`${base}/api/runs`)).status).toBe(401);
});

test('GET /api/runs lists the run', async () => {
  const res = await fetch(`${base}/api/runs`, { headers: auth });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { id: string }[]; total: number };
  expect(body.items.map((i) => i.id)).toContain('run-1');
});

test('GET /api/runs/:id returns the RunDTO', async () => {
  const res = await fetch(`${base}/api/runs/run-1`, { headers: auth });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { id: string }).id).toBe('run-1');
});

test('GET /api/runs/:id/stream opens an event-stream (not the detail JSON)', async () => {
  const res = await fetch(`${base}/api/runs/run-1/stream`, { headers: auth });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  await res.body?.cancel();
});

test('GET /api/runs/missing → 404', async () => {
  expect((await fetch(`${base}/api/runs/missing`, { headers: auth })).status).toBe(404);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-routes.test.ts` → FAIL (routes not wired).

- [ ] **Step 3: Minimal impl** — in `src/server/app.ts` `handleApi`, add imports and the matches (place BEFORE the existing `respondMatch` block or after `/api/feedback` — but the stream/detail/list GET matches must be ordered stream→detail, and none collide with the POST respond match):

```ts
import { handleRunDetail } from './runs/detail.ts';
import { handleRunList } from './runs/list.ts';
import { handleRunStream } from './runs/stream.ts';

// ... inside handleApi, after the /api/health block and before the 404:
if (req.method === 'GET' && url.pathname === '/api/runs') {
  rec.status(200);
  return handleRunList(url.searchParams, deps);
}
const streamMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
if (req.method === 'GET' && streamMatch?.[1]) {
  rec.status(200);
  return handleRunStream(streamMatch[1], deps, {
    lastEventId: req.headers.get('Last-Event-ID') ?? undefined,
    signal: req.signal,
  });
}
const detailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
if (req.method === 'GET' && detailMatch?.[1]) {
  const res = await handleRunDetail(detailMatch[1], deps);
  rec.status(res.status);
  return res;
}
```

(Note: `handleRunDetail` may 404, so set `rec.status` from the actual response, not a hardcoded 200.)

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-routes.test.ts tests/server/app.test.ts` → PASS (existing perimeter/token/404 tests still green).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/server/app.ts" "tests/server/runs-routes.test.ts"
git add src/server/app.ts tests/server/runs-routes.test.ts
git commit -m "feat(server): wire GET /api/runs, /api/runs/:id, /api/runs/:id/stream into handleApi"
```

---

## Layer ④ — Web feature

### Task 12: @visx deps + `--color-danger` token

**Files:**
- Modify: `web/package.json` (add @visx deps), `web/src/shared/design/tokens.css` (add `--color-danger` light+dark)
- Test: `web/src/shared/design/tokens.test.ts` (asserts the token exists in both theme scopes)

**Interfaces:**
- Produces: `@visx/scale`, `@visx/shape`, `@visx/axis`, `@visx/group`, `@visx/tooltip` in `web` dependencies (NOT `@xyflow` — D1). A `--color-danger` CSS var under both `:root` (dark) and `:root:where(.light)` (light), following the file's existing split (literal in `:root`, not `@theme`).

- [ ] **Step 1: Install deps** — `cd web && bun add @visx/scale @visx/shape @visx/axis @visx/group @visx/tooltip` (bun resolves the current @visx majors; commit the resulting `web/package.json` + lockfile).

- [ ] **Step 2: Write the failing test** — `web/src/shared/design/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, './tokens.css'), 'utf8');

describe('design tokens', () => {
  it('defines --color-danger in both the dark and light scopes', () => {
    const dark = css.slice(css.indexOf(':root {'), css.indexOf(':root:where(.light)'));
    const light = css.slice(css.indexOf(':root:where(.light)'));
    expect(dark).toContain('--color-danger');
    expect(light).toContain('--color-danger');
  });
});
```

- [ ] **Step 3: Run to fail** — `cd web && bun run test src/shared/design/tokens.test.ts` → FAIL.

- [ ] **Step 4: Minimal impl** — add to `web/src/shared/design/tokens.css`, in the `:root {` block add `--color-danger: #F0616D;` and in `:root:where(.light) {` add `--color-danger: #D22B3A;` (blueprint-consistent reds; dark slightly lighter for contrast on the dark bg).

- [ ] **Step 5: Run to pass + build sanity** — `cd web && bun run test src/shared/design/tokens.test.ts` → PASS; `cd web && bun run typecheck` clean; `cd web && bun run build` succeeds (proves the new deps resolve).

- [ ] **Step 6: Gate + commit**

```bash
cd web && bun run typecheck
git add web/package.json web/bun.lock web/src/shared/design/tokens.css web/src/shared/design/tokens.test.ts
git commit -m "chore(web): add @visx (scale/shape/axis/group/tooltip) + --color-danger token"
```

---

### Task 13: Parameterize the SSE transport frame-payload schema

**Files:**
- Modify: `web/src/shared/transport/types.ts`, `web/src/shared/transport/sse-adapter.ts`
- Test: `web/src/shared/transport/sse-adapter.test.ts` (extend — add a SpanDTO-payload case)

**Interfaces:**
- Produces: `ChatTransport.stream` becomes generic — `stream<T = StatusEvent>(runId?: string, fromCursor?: string | null, schema?: ZodType<T>): AsyncIterable<T & { eventId: string }>`. Default schema = `StatusEventSchema`, so the existing chat-fallback path is byte-for-byte unchanged. The private `readSseStream`/`parseSseFrame` reader is reused verbatim; only the payload schema at the yield site is parameterized.

- [ ] **Step 1: Write the failing test** — add to `web/src/shared/transport/sse-adapter.test.ts`:

```ts
import { SpanDtoSchema } from '@contracts';
import { describe, expect, it, vi } from 'vitest';
import { createSseTransport } from './sse-adapter.ts';

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('createSseTransport stream() payload schema', () => {
  it('parses SpanDTO frames when a SpanDtoSchema is supplied', async () => {
    const spanFrame = {
      spanId: 's1', parentSpanId: null, name: 'agent.run', offsetMs: 0,
      durationMs: 5, depth: 0, status: 'ok', degraded: false, attributes: {}, events: [],
    };
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([`id: s1\ndata: ${JSON.stringify(spanFrame)}\n\n`])));
    const out = [];
    for await (const ev of createSseTransport().stream('r1', null, SpanDtoSchema)) out.push(ev);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ spanId: 's1', eventId: 's1' });
    vi.unstubAllGlobals();
  });
});
```

(The existing default-`StatusEventSchema` test in this file must still pass unchanged — that is the regression guard for the byte-for-byte chat path.)

- [ ] **Step 2: Run to fail** — `cd web && bun run test src/shared/transport/sse-adapter.test.ts` → FAIL (`stream` takes no schema arg / parses only StatusEvent).

- [ ] **Step 3: Minimal impl** —
  - `types.ts`: add `import type { ZodType } from 'zod';` and change the `stream` signature to the generic form above (keep `TransportEvent` + `respond` unchanged).
  - `sse-adapter.ts`: change the `stream` generator:

```ts
import type { ZodType } from 'zod';
// ...
    async *stream<T = StatusEvent>(
      runId?: string,
      fromCursor?: string | null,
      schema?: ZodType<T>,
    ): AsyncIterable<T & { eventId: string }> {
      const payloadSchema = (schema ?? StatusEventSchema) as ZodType<T>;
      const path = runId ? `/api/runs/${runId}/stream` : '/api/chat';
      const res = await fetch(path, {
        headers: {
          Authorization: `Bearer ${sessionToken()}`,
          Accept: 'text/event-stream',
          ...(fromCursor ? { 'Last-Event-ID': fromCursor } : {}),
        },
      });
      if (!res.ok || !res.body) {
        throw new ApiError(`stream request to ${path} failed`, res.status);
      }
      for await (const frame of readSseStream(res.body)) {
        const parsed = payloadSchema.parse(JSON.parse(frame.data));
        const eventId = frame.id ?? '';
        yield { ...(parsed as object), eventId } as T & { eventId: string };
      }
    },
```

  (`StatusEvent` must be imported as a type from `@contracts` at the top — it already is via `StatusEventSchema`; add `import type { StatusEvent } from '@contracts'` if tsc flags the default type param.)

- [ ] **Step 4: Run to pass** — `cd web && bun run test src/shared/transport/sse-adapter.test.ts` → PASS (both the default StatusEvent case and the new SpanDTO case).

- [ ] **Step 5: Gate + commit**

```bash
cd web && bun run typecheck
git add web/src/shared/transport/types.ts web/src/shared/transport/sse-adapter.ts web/src/shared/transport/sse-adapter.test.ts
git commit -m "feat(web): parameterize SSE transport frame-payload schema (default StatusEvent; SpanDTO for runs)"
```

---

### Task 14: `use-run-trace` — pure `foldSpan` + `useRunTrace` hook

**Files:**
- Create: `web/src/features/runs/use-run-trace.ts`
- Test: `web/src/features/runs/use-run-trace.test.ts`

**Interfaces:**
- Consumes: `SpanDTO` from `@contracts`.
- Produces: `type RunTraceState = { spans: SpanDTO[]; cursor: string | null }`; pure `foldSpan(state: RunTraceState, span: SpanDTO, eventId?: string): RunTraceState` (de-dupe by `spanId` — replace in place if present, else append; keep sorted by `offsetMs`; set `cursor = eventId ?? state.cursor`); `useRunTrace(initial: SpanDTO[])` → `{ spans, cursor, ingest(span, eventId?) }` (mirror `use-status-events.ts`: `useState` + `useCallback`; `ingest` calls `setState((prev) => foldSpan(prev, span, eventId))`).

- [ ] **Step 1: Write the failing test** — `web/src/features/runs/use-run-trace.test.ts`:

```ts
import type { SpanDTO } from '@contracts';
import { describe, expect, it } from 'vitest';
import { foldSpan, type RunTraceState } from './use-run-trace.ts';

function span(id: string, offsetMs: number): SpanDTO {
  return {
    spanId: id, parentSpanId: null, name: id, offsetMs, durationMs: 1, depth: 0,
    status: 'ok' as SpanDTO['status'], degraded: false, attributes: {}, events: [],
  };
}

describe('foldSpan', () => {
  const empty: RunTraceState = { spans: [], cursor: null };

  it('appends new spans sorted by offsetMs and tracks the cursor', () => {
    const s1 = foldSpan(empty, span('b', 20), 'b');
    const s2 = foldSpan(s1, span('a', 10), 'a');
    expect(s2.spans.map((s) => s.spanId)).toEqual(['a', 'b']);
    expect(s2.cursor).toBe('a');
  });

  it('de-dupes by spanId (replace, not duplicate)', () => {
    const s1 = foldSpan(empty, span('a', 10));
    const s2 = foldSpan(s1, { ...span('a', 10), durationMs: 99 });
    expect(s2.spans).toHaveLength(1);
    expect(s2.spans[0]?.durationMs).toBe(99);
  });
});
```

- [ ] **Step 2: Run to fail** — `cd web && bun run test src/features/runs/use-run-trace.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `web/src/features/runs/use-run-trace.ts`:

```ts
import type { SpanDTO } from '@contracts';
import { useCallback, useState } from 'react';

export type RunTraceState = { spans: SpanDTO[]; cursor: string | null };

/** Merge one SpanDTO into the trace view: de-dupe by spanId, keep offset-sorted,
 *  advance the resume cursor. Pure — unit-tested like `foldEvent`. */
export function foldSpan(
  state: RunTraceState,
  span: SpanDTO,
  eventId?: string,
): RunTraceState {
  const next = state.spans.filter((s) => s.spanId !== span.spanId);
  next.push(span);
  next.sort((a, b) => a.offsetMs - b.offsetMs);
  return { spans: next, cursor: eventId ?? state.cursor };
}

export function useRunTrace(initial: SpanDTO[]) {
  const [state, setState] = useState<RunTraceState>(() =>
    initial.reduce<RunTraceState>((s, span) => foldSpan(s, span), {
      spans: [],
      cursor: null,
    }),
  );
  const ingest = useCallback((span: SpanDTO, eventId?: string) => {
    setState((prev) => foldSpan(prev, span, eventId));
  }, []);
  return { spans: state.spans, cursor: state.cursor, ingest };
}
```

- [ ] **Step 4: Run to pass** — `cd web && bun run test src/features/runs/use-run-trace.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
cd web && bun run typecheck
git add web/src/features/runs/use-run-trace.ts web/src/features/runs/use-run-trace.test.ts
git commit -m "feat(web): use-run-trace — pure foldSpan reducer + useRunTrace hook (snapshot+stream merge)"
```

---

### Task 15: `waterfall.tsx` — @visx Gantt + span-detail side panel

**Files:**
- Create: `web/src/features/runs/waterfall.tsx`
- Test: `web/src/features/runs/waterfall.test.tsx`

**Interfaces:**
- Consumes: `SpanDTO` from `@contracts`; `scaleLinear` from `@visx/scale`; `Group` from `@visx/group`; `Bar` from `@visx/shape`. React `useState` for the selected span.
- Produces: `Waterfall({ spans }: { spans: SpanDTO[] })` — a Gantt SVG: `scaleLinear({ domain: [0, maxOffset+maxDuration], range: [0, width] })`; one row per span (`y = index * rowHeight`); bar `x = scale(offsetMs)`, `width = max(2, scale(offsetMs+durationMs) - scale(offsetMs))`; fill = `var(--color-danger)` when `status==='error'`, else `var(--color-signal)` when `degraded`, else `var(--color-accent)`. Each bar `data-testid={`bar-${spanId}`}` and `onClick` → sets the selected span → a side panel (`data-testid="span-detail"`) showing name/agent/model/tokens/attributes.

- [ ] **Step 1: Write the failing test** — `web/src/features/runs/waterfall.test.tsx`:

```ts
import type { SpanDTO } from '@contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Waterfall } from './waterfall.tsx';

function span(p: Partial<SpanDTO> & { spanId: string }): SpanDTO {
  return {
    parentSpanId: null, name: p.spanId, offsetMs: 0, durationMs: 10, depth: 0,
    status: 'ok' as SpanDTO['status'], degraded: false, attributes: {}, events: [], ...p,
  };
}

describe('Waterfall', () => {
  it('renders one bar per span, positioned by offset/duration', () => {
    render(<Waterfall spans={[span({ spanId: 'a', offsetMs: 0, durationMs: 10 }), span({ spanId: 'b', offsetMs: 10, durationMs: 10 })]} />);
    const a = screen.getByTestId('bar-a');
    const b = screen.getByTestId('bar-b');
    expect(Number(b.getAttribute('x'))).toBeGreaterThan(Number(a.getAttribute('x')));
  });

  it('colours error spans with the danger token', () => {
    render(<Waterfall spans={[span({ spanId: 'e', status: 'error' as SpanDTO['status'] })]} />);
    expect(screen.getByTestId('bar-e').getAttribute('fill')).toContain('--color-danger');
  });

  it('opens the span-detail panel on bar click', () => {
    render(<Waterfall spans={[span({ spanId: 'a', name: 'agent.run' })]} />);
    expect(screen.queryByTestId('span-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('bar-a'));
    expect(screen.getByTestId('span-detail')).toHaveTextContent('agent.run');
  });
});
```

- [ ] **Step 2: Run to fail** — `cd web && bun run test src/features/runs/waterfall.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `web/src/features/runs/waterfall.tsx`:

```tsx
import type { SpanDTO } from '@contracts';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';
import { useState } from 'react';

const WIDTH = 720;
const ROW_H = 22;
const BAR_H = 14;

function barFill(span: SpanDTO): string {
  if (span.status === 'error') return 'var(--color-danger)';
  if (span.degraded) return 'var(--color-signal)';
  return 'var(--color-accent)';
}

export function Waterfall({ spans }: { spans: SpanDTO[] }) {
  const [selected, setSelected] = useState<SpanDTO | undefined>(undefined);
  const maxEnd = Math.max(1, ...spans.map((s) => s.offsetMs + s.durationMs));
  const scale = scaleLinear({ domain: [0, maxEnd], range: [0, WIDTH] });
  const height = Math.max(ROW_H, spans.length * ROW_H);

  return (
    <div className="flex gap-4">
      <svg width={WIDTH} height={height} role="img" aria-label="run trace waterfall">
        <Group>
          {spans.map((span, i) => {
            const x = scale(span.offsetMs);
            const w = Math.max(2, scale(span.offsetMs + span.durationMs) - x);
            return (
              <Bar
                key={span.spanId}
                data-testid={`bar-${span.spanId}`}
                x={x}
                y={i * ROW_H + (ROW_H - BAR_H) / 2}
                width={w}
                height={BAR_H}
                rx={3}
                fill={barFill(span)}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(span)}
              />
            );
          })}
        </Group>
      </svg>
      {selected && (
        <aside
          data-testid="span-detail"
          className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
        >
          <div className="text-sm">{selected.name}</div>
          {selected.agent && <div className="text-[var(--color-muted)]">agent: {selected.agent}</div>}
          {selected.model && <div className="text-[var(--color-muted)]">model: {selected.model.id}</div>}
          {selected.tokens && (
            <div className="text-[var(--color-muted)]">
              tokens: in {selected.tokens.input ?? 0} / out {selected.tokens.output ?? 0}
            </div>
          )}
          <div className="text-[var(--color-muted)]">
            {selected.offsetMs.toFixed(1)}ms + {selected.durationMs.toFixed(1)}ms
          </div>
        </aside>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to pass** — `cd web && bun run test src/features/runs/waterfall.test.tsx` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
cd web && bun run typecheck
git add web/src/features/runs/waterfall.tsx web/src/features/runs/waterfall.test.tsx
git commit -m "feat(web): @visx trace waterfall + span-detail side panel"
```

---

### Task 16: `RunsArea` — rich searchable/faceted/paginated list

**Files:**
- Rewrite: `web/src/features/runs/index.tsx` (replace the Phase-1b stub)
- Test: `web/src/features/runs/index.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `../../shared/contract/client.ts`; `RunListResponseSchema` from `@contracts`; `Link` from `@tanstack/react-router`; `RegionErrorBoundary`. Fetches `apiFetch('/runs?<query>', { schema: RunListResponseSchema })` (query string baked into the path since `apiFetch` prepends `/api`).
- Produces: `RunsArea()` — a search box (`data-testid="runs-search"`), `outcome`/`degraded` facet controls, a paginated list of rows (each a `Link to="/runs/$runId" params={{ runId: item.id }}` showing id/outcome/lifecycle/models/tokens), a Next button when `nextCursor` is present. Keeps `data-testid="area-runs"`. Wrapped in `RegionErrorBoundary region="Runs"`. Design via `var(--color-*)`.

- [ ] **Step 1: Write the failing test** — `web/src/features/runs/index.test.tsx`:

```ts
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const page = {
  items: [
    { id: 'run-1', startMs: 1000, durationMs: 42, outcome: 'answer', lifecycle: 'done', origin: 'manual', models: ['qwen'], degraded: false, spanCount: 3 },
  ],
  total: 1,
};

describe('RunsArea', () => {
  it('lists runs fetched from /api/runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page)));
    renderAt('/runs');
    await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());
    expect(screen.getByTestId('area-runs')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to fail** — `cd web && bun run test src/features/runs/index.test.tsx` → FAIL (stub renders no rows).

- [ ] **Step 3: Minimal impl** — rewrite `web/src/features/runs/index.tsx` with `useState`/`useEffect` fetching via `apiFetch`, a search input + facet selects (debounced or on-submit; a plain controlled input re-fetching on change is fine), rows as `<Link>`s, and a Next-page button gated on `nextCursor`. Query string assembled from state (`new URLSearchParams`). Wrap in `RegionErrorBoundary region="Runs"`. (Show the real component: search/facets/pagination state, `apiFetch('/runs?' + qs, { schema: RunListResponseSchema })` in `useEffect` keyed on the query, error → in-region message; empty → "No runs yet".)

- [ ] **Step 4: Run to pass** — `cd web && bun run test src/features/runs/index.test.tsx` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
cd web && bun run typecheck
git add web/src/features/runs/index.tsx web/src/features/runs/index.test.tsx
git commit -m "feat(web): RunsArea — searchable/faceted/paginated runs history list"
```

---

### Task 17: `RunDetail` — snapshot fetch + live-tail waterfall

**Files:**
- Rewrite: `web/src/features/runs/run-detail.tsx` (replace the Phase-1b stub)
- Test: `web/src/features/runs/run-detail.test.tsx`

**Interfaces:**
- Consumes: `useParams({ from: '/runs/$runId' })`; `apiFetch` + `RunDtoSchema` from `@contracts` (snapshot); `createSseTransport().stream(runId, cursor, SpanDtoSchema)` (live-tail, Task 13); `useRunTrace` (Task 14); `Waterfall` (Task 15); `RegionErrorBoundary`.
- Produces: `RunDetail()` — fetch `GET /api/runs/:id` for the snapshot; seed `useRunTrace(snapshot.spans)`; open the run-stream and `ingest(span, eventId)` each streamed `SpanDTO`; render `<Waterfall spans={spans} />`; show a busy indicator (`data-testid="run-busy"`) while `snapshot.lifecycle === 'running'`. Keeps `data-testid="run-detail"`. The stream loop runs in a `useEffect` with an `AbortController`/cancelled flag on cleanup so navigation away stops tailing.

- [ ] **Step 1: Write the failing test** — `web/src/features/runs/run-detail.test.tsx`:

```ts
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function emptyStream(): Response {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const dto = {
  id: 'run-1', owner: 'local', origin: 'manual', lifecycle: 'done', startMs: 0, durationMs: 10,
  outcome: 'answer', models: ['qwen'], degraded: false, degrades: [], malformedSpans: 0, spanCount: 1,
  roots: ['a'], artifacts: [],
  spans: [{ spanId: 'a', parentSpanId: null, name: 'agent.run', offsetMs: 0, durationMs: 10, depth: 0, status: 'ok', degraded: false, attributes: {}, events: [] }],
};

describe('RunDetail', () => {
  it('renders the snapshot waterfall for a run', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) =>
      String(input).includes('/stream') ? emptyStream() : jsonResponse(dto),
    ));
    renderAt('/runs/run-1');
    await waitFor(() => expect(screen.getByTestId('bar-a')).toBeInTheDocument());
    expect(screen.getByTestId('run-detail')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to fail** — `cd web && bun run test src/features/runs/run-detail.test.tsx` → FAIL (stub still shows the Phase-3 placeholder).

- [ ] **Step 3: Minimal impl** — rewrite `web/src/features/runs/run-detail.tsx`: `useEffect` (a) fetches the snapshot via `apiFetch('/runs/' + runId, { schema: RunDtoSchema })` into state; `useRunTrace(snapshot?.spans ?? [])`; a second `useEffect` opens `createSseTransport().stream(runId, cursor, SpanDtoSchema)` and `for await` ingests each frame, with a `cancelled` flag set in cleanup to stop the loop on unmount/navigation. Render `<Waterfall spans={spans} />` + a `run-busy` indicator when `snapshot?.lifecycle === RunLifecycle.Running`. Wrap in `RegionErrorBoundary region="Run"`. (Guard the stream effect so it only starts after the snapshot resolves; feed the snapshot's spans as the initial `useRunTrace` seed.)

- [ ] **Step 4: Run to pass** — `cd web && bun run test src/features/runs/run-detail.test.tsx` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
cd web && bun run typecheck
git add web/src/features/runs/run-detail.tsx web/src/features/runs/run-detail.test.tsx
git commit -m "feat(web): RunDetail — snapshot fetch + live-tailing waterfall (first transport-port consumer)"
```

---

### Task 18: Jump-to-run ⌘K command

**Files:**
- Modify: `web/src/app/commands.ts`
- Test: `web/src/app/commands.test.ts` (extend if present; else create)

**Interfaces:**
- Produces: a `jump-to-run` navigation `Command` (`{ id: 'jump-to-run', label: 'Jump to Runs', run: (n) => n({ to: '/runs' }) }`) appended to `navCommands`. (Phase 8 finishes ⌘K completeness incl. recent-run entries; Phase 3 adds only jump-to-run, as scoped.)

- [ ] **Step 1: Write the failing test** — `web/src/app/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { navCommands } from './commands.ts';

describe('navCommands', () => {
  it('includes a jump-to-run command targeting /runs', () => {
    const cmd = navCommands.find((c) => c.id === 'jump-to-run');
    expect(cmd?.label).toMatch(/run/i);
  });
});
```

- [ ] **Step 2: Run to fail** — `cd web && bun run test src/app/commands.test.ts` → FAIL.

- [ ] **Step 3: Minimal impl** — append to the `navCommands` array in `web/src/app/commands.ts`:

```ts
  { id: 'jump-to-run', label: 'Jump to Runs', run: (n) => n({ to: '/runs' }) },
```

(Remove the now-stale "jump-to-run … land with their features" line from the comment, or update it to note jump-to-run is now wired.)

- [ ] **Step 4: Run to pass** — `cd web && bun run test src/app/commands.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
cd web && bun run typecheck
git add web/src/app/commands.ts web/src/app/commands.test.ts
git commit -m "feat(web): jump-to-run ⌘K command"
```

---

## Layer ⑤ — Docs (all four living surfaces + phase close)

### Task 19: Docs — architecture / README / ROADMAP / SDD ledger

**Files:**
- Modify: `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`
- Reminder (not a repo file): regenerate the docs-snapshot **Artifact** (4th surface) at slice completion — the controller does it.

**What each surface must say (audited for TRUTH against the diff, not mere presence):**

- [ ] **Step 1: `docs/architecture.md`**
  - **Server node** — deepen with the three new GET endpoints (`/api/runs` list, `/api/runs/:id` detail, `/api/runs/:id/stream` SSE), the `runsRoot` dep, `confineToDir` reuse for `:id`, and the `runs.stream` span (mirrors `ui.stream`). Update the Mermaid module map + data-flow diagram edges (browser → `/api/runs*` → `src/run` mapper → disk).
  - **New §"Runs (web UI — Slice 30b Phase 3)"** — the rich list + @visx waterfall + live-tail flow; note it is the **first real consumer of the resumable transport port** (`stream(runId, cursor, schema)`) and the **first emitter of `RunDTO`/`SpanDTO`**.
  - **`src/run` mapper** — document `run-dto.ts` (`mapRunToDto`, `summarizeRunListItem`) + `artifacts.ts` (`readRunArtifacts`) + the **mtime-keyed summary cache** (keyed on `spans.jsonl` mtime) with the "a real persisted index is Phase 6" note.
  - **Contracts §** — `RunListItemDTO` + `RunListQuery`/`RunListResponse` + the extended `ArtifactKind` members; note the telemetry-gap closures (tokens projection, lifecycle synthesis, artifact classification) and the still-reserved `node`/`origin`/`principal`.

- [ ] **Step 2: `README.md`** — update the **Status line**; add the **slice-status table** row for **Slice 30b Phase 3** (✅ Done) — but the **slice-30b capability stays NOT flipped** (Phases 4–8 remain); add/adjust the Web-UI feature paragraph + the "Next" line so the product surface reads current.

- [ ] **Step 3: `docs/ROADMAP.md`** — add/flip the **Phase-3 entry** in the gap table + phase table + recommended sequence to reflect Runs history + trace waterfall shipped (Slice 30b Phase 3); the umbrella slice-30b marker stays partial.

- [ ] **Step 4: `.superpowers/sdd/progress.md`** — append the per-task / review / fix / landing ledger entries for Phase 3 (the pre-push slice-landing gate blocks landing on `main` unless README + ROADMAP + this ledger update in the same push).

- [ ] **Step 5: `bun run docs:check`** → PASS (no living doc missing/orphaned; no undocumented `src/**` subsystem — `src/server/runs/` + the extended `src/run` must be reflected).

- [ ] **Step 6: Commit**

```bash
bun run docs:check
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(30b-phase3): architecture/README/ROADMAP/ledger — Runs history + live trace waterfall"
```

---

## Final gate & live-verify (not a task — the landing checklist)

1. **Full gate green.** `bun run check` (docs:check · typecheck · lint · root tests via `bun test --path-ignore-patterns 'web/**'`) exit 0; `cd web && bun run typecheck && bun run test` green. No `console.log`, no skipped tests.

2. **Live-verify against real Ollama (the D4 headline check).**
   - `bun run web`; open the served origin; confirm `crossOriginIsolated === true`, zero console errors.
   - Send a real chat turn (Phase-2 path) so a fresh `runs/<id>/` is written.
   - Open `/runs` → confirm the run is **listed** with the correct `outcome` / `lifecycle` / `models` / token roll-up; exercise the **search box** + **outcome/degraded facets** + **pagination**.
   - Open the run detail → confirm the **waterfall matches `bun run runs <id>`** (same span tree, offsets, durations, error/degraded colouring) and the **span-detail panel** shows attributes/model/tokens on click.
   - Start a fresh turn and open its detail **while it is still running** → confirm the waterfall **live-tails** new spans to completion (busy indicator clears when lifecycle → Done), and a mid-stream reconnect resumes via `Last-Event-ID` without duplicated bars.
   - Capture evidence (screenshots + notes) in the SDD ledger.

3. **Whole-branch fan-out review** (3 parallel reviewers over the full branch diff):
   - **correctness** — offset/depth math, lifecycle synthesis (Running/Done/Failed), token summing, cursor pagination boundaries, the stream stop condition + resume de-dupe, cache mtime invalidation on append;
   - **security** — `confineToDir` on `:id` for BOTH detail and stream (traversal/symlink → 404, no leak); token + Host/Origin perimeter still enforced on all three routes; no path/attribute leakage in error bodies;
   - **docs-accuracy** — every `architecture.md` claim matches the shipped code (the review audits truth, not presence — this is what caught 6 wrong edges in Slice 9).
   Apply verified findings; re-review if non-trivial.

4. **Land (partial-slice).** `git merge --no-ff` into `main`, then push. The **pre-push slice-landing gate** requires `README.md` + `docs/ROADMAP.md` + `.superpowers/sdd/progress.md` in the **same push** (all updated in Task 19). README/ROADMAP mark **Slice 30b Phase 3 landed**; the slice-30b capability is **NOT** flipped to ✅ shipped (Phases 4–8 remain). Regenerate the docs-snapshot **Artifact** (new Runs subsystem node/edges; updated footer slice + test counts).

## Deferred to later phases (explicit — not Phase-3 debt)

- **`SessionStore` + run persistence + a real run index + rename/delete/export** → **Phase 6** (Phase 3 is stateless per request; the mapper re-reads disk, fronted only by the mtime summary cache).
- **`@xyflow` node-graph** (D1 — waterfall only; a trace's natural shape is a timeline).
- **`SpanDTO.node`, `RunDTO.origin` (constant `manual`), `server.principal` (constant `local`)** stay **reserved** for Slices 24/25/33/35/38.
- **`runs/` retention GC** (registered Slice 30a as a Tier-2 ROADMAP slice — not built here).
- **Accessibility polish + ⌘K completeness (recent-run entries)** → Phase 8 (Phase 3 adds only jump-to-run).
- **Voice** → Phase 7.
