# Slice 30b Phase 4 — Crews & Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Crews and Workflows web areas real — browse the registries, launch a run from the browser, and watch the workflow/crew step-DAG light up live as it executes.

**Architecture:** Five layers (contracts → pure mappers → server BFF → web features → Runs-browser closure). Registries (`CREWS`/`WORKFLOWS`) are the source of truth, projected to JSON-safe DTOs. "Watch" reuses Phase 3's `/api/runs/:id/stream` verbatim (crew/workflow runs already emit `crew.run`/`workflow.run` roots into `runs/<id>/spans.jsonl`). New: browse endpoints, a fire-and-watch launch seam, and one reusable `@xyflow` `DagView`.

**Tech Stack:** Bun + TypeScript (root, `bun:test`); Zod v4; React 19 + Vite + TanStack Router + Tailwind v4 + `@visx` + new `@xyflow/react` (web, `vitest`).

**Spec:** `docs/superpowers/specs/2026-07-15-slice-30b-phase4-crews-workflows-design.md`. **Diagram:** `docs/diagrams/slice-30b-phase4-crews-workflows/phase4-crews-workflows.png`.

## Global Constraints

- **Package manager:** `bun`, never `npm`. Root tests: `bun test <path>` (imports from `'bun:test'`). Web tests: `cd web && bun run test` (vitest; imports from `'vitest'`). **Never** put `from 'vitest'` in a root test or `from 'bun:test'` in a web test.
- **Per-task gate before commit:** `bun run typecheck` (clean) + `bun run lint:file -- <files>` (0 errors) + the task's focused tests. `bun test` does NOT typecheck and the pre-commit hook is docs:check only — run all three.
- **Code style:** `type` over `interface`; **`enum` over string-literal unions** for finite named sets (string enums only); discriminated unions stay `type`; early returns; small focused files; descriptive names. No `console.log` left behind.
- **Contracts are isomorphic:** `src/contracts/**` imports only `zod` (enums.ts imports nothing). Zod v4 idiom is `z.enum(SomeTsEnum)` (NOT `z.nativeEnum`). No `.strict()`. Every schema pairs `export const XSchema = z.object({...})` with `export type X = z.infer<typeof XSchema>`.
- **Imports use explicit `.ts` extensions** (e.g. `from './enums.ts'`). Web imports contracts via the `@contracts` alias.
- **Never hardcode model choices/budgets/limits** — compute live; env vars are fallback-only.
- **Docs hard line:** the final docs task updates all four surfaces (architecture.md, README, ROADMAP, ledger) + regenerates the Artifact. Do not `DOCS_OK=1` bypass.
- **Model tiering:** Sonnet floor for all mechanical tasks; **Opus / ultracode-Workflow** for Task 6 (workflow-dto edge derivation) and Task 11 (fire-and-watch launch concurrency); Fable reserved for the whole-branch final review.
- **Branch:** `slice-30b-phase4-crews-workflows` (already cut off `main` @ `69b7994`). Commit per task, conventional subject `type(scope): summary`.

---

## Task 1: Contract enums — StepKind + CrewProcess mirrors, RunKind, parity tests

**Files:**
- Modify: `src/contracts/enums.ts` (append three enums)
- Test: `tests/contracts/step-kind-parity.test.ts` (create), `tests/contracts/crew-process-parity.test.ts` (create)

**Interfaces:**
- Consumes: engine enums `StepKind` (`src/workflow/types.ts:5`), `CrewProcess` (`src/crew/types.ts:41`).
- Produces: `StepKind`, `CrewProcess`, `RunKind` exported from `src/contracts/enums.ts` (re-exported via the `index.ts` wildcard barrel).

- [ ] **Step 1: Write the failing parity tests** (mirror `tests/contracts/degrade-kind-parity.test.ts`)

`tests/contracts/step-kind-parity.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { StepKind as ContractStepKind } from '../../src/contracts/enums.ts';
import { StepKind as EngineStepKind } from '../../src/workflow/types.ts';

test('contract StepKind values stay isomorphic with the workflow engine', () => {
  expect(Object.values(ContractStepKind).sort()).toEqual(
    Object.values(EngineStepKind).sort(),
  );
});
```

`tests/contracts/crew-process-parity.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { CrewProcess as ContractCrewProcess } from '../../src/contracts/enums.ts';
import { CrewProcess as EngineCrewProcess } from '../../src/crew/types.ts';

test('contract CrewProcess values stay isomorphic with the crew engine', () => {
  expect(Object.values(ContractCrewProcess).sort()).toEqual(
    Object.values(EngineCrewProcess).sort(),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/contracts/step-kind-parity.test.ts tests/contracts/crew-process-parity.test.ts`
Expected: FAIL — `ContractStepKind`/`ContractCrewProcess` are not exported yet.

- [ ] **Step 3: Append the three enums to `src/contracts/enums.ts`**

```typescript
/** Wire mirror of `src/workflow/types.ts` StepKind (isomorphic rule — no engine
 *  import). `tests/contracts/step-kind-parity.test.ts` guards value parity. */
export enum StepKind {
  Agent = 'agent',
  Tool = 'tool',
  Branch = 'branch',
  Map = 'map',
  Verify = 'verify',
}

/** Wire mirror of `src/crew/types.ts` CrewProcess (isomorphic rule).
 *  `tests/contracts/crew-process-parity.test.ts` guards value parity. */
export enum CrewProcess {
  Sequential = 'sequential',
  Hierarchical = 'hierarchical',
}

/** What a run IS (chat/agent/crew/workflow), derived by the mapper from the run's
 *  root span name. Distinct from RunOrigin (HOW a run was triggered). Slice 30b Phase 4. */
export enum RunKind {
  Chat = 'chat',
  Agent = 'agent',
  Crew = 'crew',
  Workflow = 'workflow',
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/contracts/step-kind-parity.test.ts tests/contracts/crew-process-parity.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/enums.ts tests/contracts/step-kind-parity.test.ts tests/contracts/crew-process-parity.test.ts
git add src/contracts/enums.ts tests/contracts/step-kind-parity.test.ts tests/contracts/crew-process-parity.test.ts
git commit -m "feat(contracts): mirror StepKind/CrewProcess + add RunKind enum (Phase 4)"
```

---

## Task 2: Crew DTOs

**Files:**
- Modify: `src/contracts/dto.ts` (append crew DTOs; add `CrewProcess` to the enums import from `./enums.ts`)
- Test: `tests/contracts/crew-dto.test.ts` (create)

**Interfaces:**
- Consumes: `CrewProcess` (Task 1).
- Produces: `CrewMemberDtoSchema`/`CrewMemberDTO`, `CrewTaskDtoSchema`/`CrewTaskDTO`, `CrewListItemDtoSchema`/`CrewListItemDTO`, `CrewDetailDtoSchema`/`CrewDetailDTO`.

- [ ] **Step 1: Write the failing test**

`tests/contracts/crew-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { CrewProcess } from '../../src/contracts/enums.ts';
import {
  CrewDetailDtoSchema,
  CrewListItemDtoSchema,
} from '../../src/contracts/dto.ts';

test('CrewListItemDtoSchema accepts a minimal summary', () => {
  const item = CrewListItemDtoSchema.parse({
    name: 'research-crew',
    description: 'Research a topic',
    process: CrewProcess.Sequential,
    memberCount: 2,
    taskCount: 2,
  });
  expect(item.name).toBe('research-crew');
});

test('CrewDetailDtoSchema projects members + tasks (no tools/Zod)', () => {
  const detail = CrewDetailDtoSchema.parse({
    name: 'research-crew',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'researcher',
        role: 'Analyst',
        goal: 'gather',
        backstory: 'meticulous',
        requires: ['tools'],
        prefer: 'largest-that-fits',
      },
    ],
    tasks: [
      {
        id: 'gather',
        description: 'research',
        expectedOutput: 'facts',
        member: 'researcher',
        dependsOn: [],
      },
    ],
  });
  expect(detail.members[0]?.name).toBe('researcher');
  expect(detail.tasks[0]?.dependsOn).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/crew-dto.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Append crew DTOs to `src/contracts/dto.ts`**

Add `CrewProcess` to the existing top import from `./enums.ts`, then append:
```typescript
/** Projected crew member — prompt scaffolding + selection policy only. The
 *  engine's `tools: ToolSet` is dropped (not JSON-serializable). `requires`/
 *  `prefer` are the raw capability/policy strings (Capability/PreferPolicy
 *  values); kept as strings on the wire — the browser only displays them. */
export const CrewMemberDtoSchema = z.object({
  name: z.string(),
  role: z.string(),
  goal: z.string(),
  backstory: z.string(),
  requires: z.array(z.string()),
  prefer: z.string(),
  agentRef: z.string().optional(),
});
export type CrewMemberDTO = z.infer<typeof CrewMemberDtoSchema>;

/** Projected crew task — the `output: z.ZodType` schema is dropped (not
 *  serializable); `verify` surfaces the grounded-verification opt-in. */
export const CrewTaskDtoSchema = z.object({
  id: z.string(),
  description: z.string(),
  expectedOutput: z.string(),
  member: z.string(),
  dependsOn: z.array(z.string()),
  verify: z.boolean().optional(),
});
export type CrewTaskDTO = z.infer<typeof CrewTaskDtoSchema>;

export const CrewListItemDtoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  process: z.enum(CrewProcess),
  memberCount: z.number(),
  taskCount: z.number(),
});
export type CrewListItemDTO = z.infer<typeof CrewListItemDtoSchema>;

export const CrewDetailDtoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  process: z.enum(CrewProcess),
  members: z.array(CrewMemberDtoSchema),
  tasks: z.array(CrewTaskDtoSchema),
});
export type CrewDetailDTO = z.infer<typeof CrewDetailDtoSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/crew-dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts tests/contracts/crew-dto.test.ts
git add src/contracts/dto.ts tests/contracts/crew-dto.test.ts
git commit -m "feat(contracts): CrewListItemDTO + CrewDetailDTO projections (Phase 4)"
```

---

## Task 3: Workflow DTOs (Step + Edge + list/detail)

**Files:**
- Modify: `src/contracts/dto.ts` (append workflow DTOs; add `StepKind` to the `./enums.ts` import)
- Test: `tests/contracts/workflow-dto.test.ts` (create)

**Interfaces:**
- Consumes: `StepKind` (Task 1).
- Produces: `StepDtoSchema`/`StepDTO`, `EdgeDtoSchema`/`EdgeDTO`, `WorkflowListItemDtoSchema`/`WorkflowListItemDTO`, `WorkflowDetailDtoSchema`/`WorkflowDetailDTO`. `EdgeKind` string values are `'depends' | 'branch-true' | 'branch-false'`.

- [ ] **Step 1: Write the failing test**

`tests/contracts/workflow-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { StepKind } from '../../src/contracts/enums.ts';
import {
  WorkflowDetailDtoSchema,
  WorkflowListItemDtoSchema,
} from '../../src/contracts/dto.ts';

test('WorkflowListItemDtoSchema accepts a summary', () => {
  const item = WorkflowListItemDtoSchema.parse({
    id: 'fetch-then-summarize',
    description: 'Fetch then summarize',
    stepCount: 2,
  });
  expect(item.stepCount).toBe(2);
});

test('WorkflowDetailDtoSchema carries steps + typed edges', () => {
  const detail = WorkflowDetailDtoSchema.parse({
    id: 'fetch-then-summarize',
    steps: [
      { id: 'fetch', kind: StepKind.Tool, tool: 'fetch' },
      { id: 'summarize', kind: StepKind.Agent, agent: 'web_fetch' },
    ],
    edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
  });
  expect(detail.edges[0]?.kind).toBe('depends');
  expect(detail.steps[1]?.agent).toBe('web_fetch');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/workflow-dto.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Append workflow DTOs to `src/contracts/dto.ts`**

Add `StepKind` to the `./enums.ts` import, then append:
```typescript
/** A projected workflow step — closures (`input`/`predicate`/`over`/`run`) and
 *  the `output: z.ZodType` are dropped; only display + structure remain. Branch
 *  targets and the map sub-step kind are surfaced so the DAG can render control
 *  flow. */
export const StepDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(StepKind),
  agent: z.string().optional(),
  tool: z.string().optional(),
  onError: z.string().optional(),
  retry: z.boolean().optional(),
  verify: z.boolean().optional(),
  branch: z.object({ whenTrue: z.string(), whenFalse: z.string() }).optional(),
  map: z.object({ subKind: z.enum(StepKind) }).optional(),
});
export type StepDTO = z.infer<typeof StepDtoSchema>;

/** A DAG edge. `depends` edges come from `effectiveDeps`; `branch-*` edges from
 *  a BranchStep's whenTrue/whenFalse (rendered distinctly / dashed). */
export const EdgeDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['depends', 'branch-true', 'branch-false']),
});
export type EdgeDTO = z.infer<typeof EdgeDtoSchema>;

export const WorkflowListItemDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  stepCount: z.number(),
});
export type WorkflowListItemDTO = z.infer<typeof WorkflowListItemDtoSchema>;

export const WorkflowDetailDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  steps: z.array(StepDtoSchema),
  edges: z.array(EdgeDtoSchema),
});
export type WorkflowDetailDTO = z.infer<typeof WorkflowDetailDtoSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/workflow-dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts tests/contracts/workflow-dto.test.ts
git add src/contracts/dto.ts tests/contracts/workflow-dto.test.ts
git commit -m "feat(contracts): StepDTO/EdgeDTO + Workflow list/detail DTOs (Phase 4)"
```

---

## Task 4: RunKind on Run DTOs + request/response schemas + kind facet

**Files:**
- Modify: `src/contracts/dto.ts` (add `kind: z.enum(RunKind)` to `RunDtoSchema` and `RunListItemDtoSchema`; add `RunKind` to the `./enums.ts` import)
- Modify: `src/contracts/requests.ts` (append run/list request+response schemas; add `kind` to `RunListQuerySchema`)
- Test: `tests/contracts/phase4-requests.test.ts` (create)

**Interfaces:**
- Consumes: `RunKind` (Task 1), `CrewListItemDtoSchema`/`WorkflowListItemDtoSchema` (Tasks 2/3).
- Produces: `RunDTO.kind`, `RunListItemDTO.kind`; `CrewRunRequestSchema`/`CrewRunRequest`, `WorkflowRunRequestSchema`/`WorkflowRunRequest`, `CrewListResponseSchema`/`CrewListResponse`, `WorkflowListResponseSchema`/`WorkflowListResponse`, `RunLaunchResponseSchema`/`RunLaunchResponse`; `RunListQuery.kind?`.

- [ ] **Step 1: Write the failing test**

`tests/contracts/phase4-requests.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';
import {
  CrewRunRequestSchema,
  RunLaunchResponseSchema,
  RunListQuerySchema,
  WorkflowListResponseSchema,
} from '../../src/contracts/requests.ts';

test('CrewRunRequestSchema requires an input string', () => {
  expect(CrewRunRequestSchema.parse({ input: 'AI' }).input).toBe('AI');
  expect(() => CrewRunRequestSchema.parse({})).toThrow();
});

test('RunLaunchResponseSchema carries the minted runId', () => {
  expect(RunLaunchResponseSchema.parse({ runId: 'flow-x' }).runId).toBe('flow-x');
});

test('RunListQuery accepts an optional kind facet', () => {
  expect(RunListQuerySchema.parse({ kind: RunKind.Crew }).kind).toBe('crew');
  expect(RunListQuerySchema.parse({}).kind).toBeUndefined();
});

test('WorkflowListResponseSchema wraps items', () => {
  const r = WorkflowListResponseSchema.parse({
    items: [{ id: 'w', stepCount: 1 }],
  });
  expect(r.items).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/phase4-requests.test.ts`
Expected: FAIL — schemas not exported / `kind` unknown.

- [ ] **Step 3a: Add `kind` to the Run DTOs in `src/contracts/dto.ts`**

Add `RunKind` to the `./enums.ts` import. In `RunDtoSchema` add after `origin`:
```typescript
  kind: z.enum(RunKind),
```
In `RunListItemDtoSchema` add after `origin`:
```typescript
  kind: z.enum(RunKind),
```

- [ ] **Step 3b: Append to `src/contracts/requests.ts`**

Add to the top imports: `import { ChatRole, FeedbackRating, RunKind } from './enums.ts';` (extend the existing enums import) and `WorkflowListItemDtoSchema, CrewListItemDtoSchema` to the `./dto.ts` import. Add `kind` to `RunListQuerySchema` (after `outcome`):
```typescript
  kind: z.enum(RunKind).optional(),
```
Then append:
```typescript
/** `POST /api/crews/:name/run` and `POST /api/workflows/:id/run` body. */
export const CrewRunRequestSchema = z.object({ input: z.string() });
export type CrewRunRequest = z.infer<typeof CrewRunRequestSchema>;
export const WorkflowRunRequestSchema = z.object({ input: z.string() });
export type WorkflowRunRequest = z.infer<typeof WorkflowRunRequestSchema>;

/** Launch response — the minted runId the browser opens the watch stream for. */
export const RunLaunchResponseSchema = z.object({ runId: z.string() });
export type RunLaunchResponse = z.infer<typeof RunLaunchResponseSchema>;

/** Browse list responses — plain arrays (small in-memory registries, no cursor). */
export const CrewListResponseSchema = z.object({
  items: z.array(CrewListItemDtoSchema),
});
export type CrewListResponse = z.infer<typeof CrewListResponseSchema>;
export const WorkflowListResponseSchema = z.object({
  items: z.array(WorkflowListItemDtoSchema),
});
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>;
```

- [ ] **Step 4: Run test + the existing run-dto tests to verify green**

Run: `bun test tests/contracts/phase4-requests.test.ts`
Expected: PASS. (Note: adding required `kind` to the Run DTOs will break Task-7-dependent mapper output only after Task 7 is done; the contract tests here construct via schema and pass.)

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts tests/contracts/phase4-requests.test.ts
git add src/contracts/dto.ts src/contracts/requests.ts tests/contracts/phase4-requests.test.ts
git commit -m "feat(contracts): RunKind on run DTOs + crew/workflow run+list requests (Phase 4)"
```

> **Controller note:** adding required `kind` to `RunDtoSchema`/`RunListItemDtoSchema` means `mapRunToDto`/`summarizeRunListItem` (Task 7) MUST set it, and their existing tests will fail until Task 7 lands. Run Tasks 4 and 7 back-to-back; the server-group gate (after Task 12) is the first full-suite checkpoint.

---

## Task 5: Crew mapper — `mapCrewToListItem` / `mapCrewToDetail`

**Files:**
- Create: `src/crew/crew-dto.ts`
- Test: `tests/crew/crew-dto.test.ts` (create)

**Interfaces:**
- Consumes: `CrewDef`/`CrewMember`/`Task` (`src/crew/types.ts`), `CrewListItemDTO`/`CrewDetailDTO`/`CrewMemberDTO`/`CrewTaskDTO` (Task 2).
- Produces: `mapCrewToListItem(def: CrewDef): CrewListItemDTO`, `mapCrewToDetail(def: CrewDef): CrewDetailDTO`.

- [ ] **Step 1: Write the failing test** (uses the real `research-crew` fixture)

`tests/crew/crew-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import researchCrew from '../../crews/research-crew.ts';
import { mapCrewToDetail, mapCrewToListItem } from '../../src/crew/crew-dto.ts';

test('mapCrewToListItem summarizes counts', () => {
  const item = mapCrewToListItem(researchCrew);
  expect(item.name).toBe('research-crew');
  expect(item.memberCount).toBe(2);
  expect(item.taskCount).toBe(2);
});

test('mapCrewToDetail projects members + tasks, drops tools/Zod, defaults dependsOn to []', () => {
  const detail = mapCrewToDetail(researchCrew);
  expect(detail.members.map((m) => m.name)).toEqual(['researcher', 'writer']);
  // researcher has no agentRef; requires/prefer are stringified enum values
  expect(detail.members[0]?.requires).toEqual(['tools']);
  const gather = detail.tasks.find((t) => t.id === 'gather');
  expect(gather?.dependsOn).toEqual([]); // undefined dependsOn → []
  expect(detail.tasks.find((t) => t.id === 'brief')?.dependsOn).toEqual([
    'gather',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew/crew-dto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/crew/crew-dto.ts`**

```typescript
import type {
  CrewDetailDTO,
  CrewListItemDTO,
  CrewMemberDTO,
  CrewTaskDTO,
} from '../contracts/index.ts';
import { CrewProcess } from '../contracts/index.ts';
import type { CrewDef, CrewMember, Task } from './types.ts';

function mapMember(m: CrewMember): CrewMemberDTO {
  return {
    name: m.name,
    role: m.role,
    goal: m.goal,
    backstory: m.backstory,
    // Capability[]/PreferPolicy are string enums — their VALUES are the wire form.
    requires: m.requires.map((c) => String(c)),
    prefer: String(m.prefer),
    ...(m.agentRef !== undefined ? { agentRef: m.agentRef } : {}),
  };
}

function mapTask(t: Task): CrewTaskDTO {
  return {
    id: t.id,
    description: t.description,
    expectedOutput: t.expectedOutput,
    member: t.member,
    dependsOn: t.dependsOn ?? [],
    ...(t.verify !== undefined ? { verify: t.verify } : {}),
  };
}

/** Contract enum values equal engine enum values (parity-tested), so a direct
 *  cast is safe; keep it explicit rather than importing the engine enum. */
export function mapCrewToListItem(def: CrewDef): CrewListItemDTO {
  return {
    name: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    process: def.process as unknown as CrewProcess,
    memberCount: def.members.length,
    taskCount: def.tasks.length,
  };
}

export function mapCrewToDetail(def: CrewDef): CrewDetailDTO {
  return {
    name: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    process: def.process as unknown as CrewProcess,
    members: def.members.map(mapMember),
    tasks: def.tasks.map(mapTask),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/crew/crew-dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/crew/crew-dto.ts tests/crew/crew-dto.test.ts
git add src/crew/crew-dto.ts tests/crew/crew-dto.test.ts
git commit -m "feat(crew): crew-dto mapper — list-item + detail projections (Phase 4)"
```

---

## Task 6: Workflow mapper — `mapWorkflowToDetail` (edge derivation) [HARD — Opus / ultracode-verify]

**Files:**
- Create: `src/workflow/workflow-dto.ts`
- Test: `tests/workflow/workflow-dto.test.ts` (create)

**Interfaces:**
- Consumes: `WorkflowDef`/`Step`/`StepKind`/`effectiveDeps` (`src/workflow/types.ts`), `WorkflowListItemDTO`/`WorkflowDetailDTO`/`StepDTO`/`EdgeDTO` (Task 3).
- Produces: `mapWorkflowToListItem(def): WorkflowListItemDTO`, `mapWorkflowToDetail(def): WorkflowDetailDTO`.

**Derivation rules (the hard part — must be provably faithful to the engine):**
- Nodes = `def.steps`, projected to `StepDTO` (drop closures + `output` Zod). For `AgentStep` set `agent`, `verify`; `ToolStep` set `tool`; `BranchStep` set `branch: {whenTrue, whenFalse}`; `MapStep` set `map: {subKind}` where `subKind` = the sub-step's `kind`; `onError` stringified (`'fail'`/`'continue'`/`'fallback'` when object); `retry` copied.
- **depends edges:** for each step at index `i`, `effectiveDeps(step, i, def.steps)` → one `{from: dep, to: step.id, kind: 'depends'}` per dep (reuse `effectiveDeps` VERBATIM — never re-derive).
- **branch edges:** for each `BranchStep`, add `{from: id, to: whenTrue, kind: 'branch-true'}` and `{from: id, to: whenFalse, kind: 'branch-false'}`.

- [ ] **Step 1: Write the failing tests** (real fixture + a synthetic branch fixture)

`tests/workflow/workflow-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { z } from 'zod';
import fetchThenSummarize from '../../workflows/fetch-then-summarize.ts';
import {
  mapWorkflowToDetail,
  mapWorkflowToListItem,
} from '../../src/workflow/workflow-dto.ts';
import { StepKind, type WorkflowDef } from '../../src/workflow/types.ts';

test('mapWorkflowToListItem counts steps', () => {
  expect(mapWorkflowToListItem(fetchThenSummarize).stepCount).toBe(2);
});

test('mapWorkflowToDetail derives depends edges via effectiveDeps', () => {
  const detail = mapWorkflowToDetail(fetchThenSummarize);
  expect(detail.steps.map((s) => s.id)).toEqual(['fetch', 'summarize']);
  expect(detail.steps.find((s) => s.id === 'summarize')?.agent).toBe('web_fetch');
  expect(detail.edges).toEqual([
    { from: 'fetch', to: 'summarize', kind: 'depends' },
  ]);
});

test('implicit-linear deps: a step with no dependsOn links to the previous step', () => {
  const def: WorkflowDef = {
    id: 'lin',
    steps: [
      { id: 'a', kind: StepKind.Tool, dependsOn: [], tool: 't', input: () => ({}), output: z.unknown() },
      { id: 'b', kind: StepKind.Agent, agent: 'x', input: () => 'y', output: z.string() },
    ],
  };
  expect(mapWorkflowToDetail(def).edges).toEqual([
    { from: 'a', to: 'b', kind: 'depends' },
  ]);
});

test('branch steps emit branch-true / branch-false edges', () => {
  const def: WorkflowDef = {
    id: 'br',
    steps: [
      { id: 'gate', kind: StepKind.Branch, dependsOn: [], predicate: () => true, whenTrue: 'yes', whenFalse: 'no', output: z.unknown() },
      { id: 'yes', kind: StepKind.Agent, dependsOn: ['gate'], agent: 'a', input: () => '', output: z.string() },
      { id: 'no', kind: StepKind.Agent, dependsOn: ['gate'], agent: 'b', input: () => '', output: z.string() },
    ],
  };
  const edges = mapWorkflowToDetail(def).edges;
  expect(edges).toContainEqual({ from: 'gate', to: 'yes', kind: 'branch-true' });
  expect(edges).toContainEqual({ from: 'gate', to: 'no', kind: 'branch-false' });
  const gate = mapWorkflowToDetail(def).steps.find((s) => s.id === 'gate');
  expect(gate?.branch).toEqual({ whenTrue: 'yes', whenFalse: 'no' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workflow/workflow-dto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/workflow/workflow-dto.ts`**

```typescript
import type {
  EdgeDTO,
  StepDTO,
  WorkflowDetailDTO,
  WorkflowListItemDTO,
} from '../contracts/index.ts';
import { StepKind } from '../contracts/index.ts';
import {
  type BranchStep,
  effectiveDeps,
  type MapStep,
  type Step,
  StepKind as EngineStepKind,
  type WorkflowDef,
} from './types.ts';

function onErrorLabel(step: Step): string | undefined {
  const oe = step.onError;
  if (oe === undefined) return undefined;
  return typeof oe === 'string' ? oe : 'fallback';
}

function mapStep(step: Step): StepDTO {
  const base: StepDTO = {
    id: step.id,
    kind: step.kind as unknown as StepKind,
    ...(onErrorLabel(step) !== undefined ? { onError: onErrorLabel(step) } : {}),
    ...(step.retry !== undefined ? { retry: step.retry } : {}),
  };
  if (step.kind === EngineStepKind.Agent) {
    base.agent = step.agent;
    if (step.verify !== undefined) base.verify = step.verify;
  } else if (step.kind === EngineStepKind.Tool) {
    base.tool = step.tool;
  } else if (step.kind === EngineStepKind.Branch) {
    const b = step as BranchStep;
    base.branch = { whenTrue: b.whenTrue, whenFalse: b.whenFalse };
  } else if (step.kind === EngineStepKind.Map) {
    const m = step as MapStep;
    base.map = { subKind: m.step.kind as unknown as StepKind };
  }
  return base;
}

function deriveEdges(steps: Step[]): EdgeDTO[] {
  const edges: EdgeDTO[] = [];
  steps.forEach((step, i) => {
    for (const dep of effectiveDeps(step, i, steps)) {
      edges.push({ from: dep, to: step.id, kind: 'depends' });
    }
    if (step.kind === EngineStepKind.Branch) {
      const b = step as BranchStep;
      edges.push({ from: b.id, to: b.whenTrue, kind: 'branch-true' });
      edges.push({ from: b.id, to: b.whenFalse, kind: 'branch-false' });
    }
  });
  return edges;
}

export function mapWorkflowToListItem(def: WorkflowDef): WorkflowListItemDTO {
  return {
    id: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    stepCount: def.steps.length,
  };
}

export function mapWorkflowToDetail(def: WorkflowDef): WorkflowDetailDTO {
  return {
    id: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    steps: def.steps.map(mapStep),
    edges: deriveEdges(def.steps),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/workflow/workflow-dto.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/workflow/workflow-dto.ts tests/workflow/workflow-dto.test.ts
git add src/workflow/workflow-dto.ts tests/workflow/workflow-dto.test.ts
git commit -m "feat(workflow): workflow-dto mapper — steps + effectiveDeps/branch edges (Phase 4)"
```

> **Controller note (ultracode):** run Task 6 via an ultracode Workflow (adversarial-verify) — the edge derivation must match the engine's scheduler exactly. Verifiers should check: implicit-linear vs explicit `dependsOn` vs `dependsOn: []` root; branch edges are additive to depends edges (not replacing them); map sub-kind; verify-expansion is NOT the mapper's concern (the DTO is the unexpanded definition graph — the live graph on run-detail comes from real spans).

---

## Task 7: Run-kind derivation in `run-dto.ts`

**Files:**
- Modify: `src/run/run-dto.ts` (add `deriveRunKind` + set `kind` in both `mapRunToDto` and `summarizeRunListItem`)
- Test: `tests/run/run-kind.test.ts` (create); update any existing run-dto tests/fixtures that construct a `RunDTO`/`RunListItemDTO` to expect `kind`.

**Interfaces:**
- Consumes: `RunKind` (Task 1); the run's root span name(s) (`RunDTO.roots` / the recognized `RUN_ROOT_NAMES` already in `run-dto.ts`).
- Produces: `deriveRunKind(rootSpanNames: string[]): RunKind` (exported); `RunDTO.kind` + `RunListItemDTO.kind` populated.

- [ ] **Step 1: Write the failing test**

`tests/run/run-kind.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';
import { deriveRunKind } from '../../src/run/run-dto.ts';

test('deriveRunKind maps root span names to a RunKind', () => {
  expect(deriveRunKind(['crew.run'])).toBe(RunKind.Crew);
  expect(deriveRunKind(['workflow.run'])).toBe(RunKind.Workflow);
  expect(deriveRunKind(['agent.run'])).toBe(RunKind.Agent);
  expect(deriveRunKind([])).toBe(RunKind.Chat); // ui.stream / no recognized root
  expect(deriveRunKind(['ui.stream'])).toBe(RunKind.Chat);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run/run-kind.test.ts`
Expected: FAIL — `deriveRunKind` not exported.

- [ ] **Step 3: Add `deriveRunKind` to `src/run/run-dto.ts` and set `kind`**

Read `src/run/run-dto.ts` first. Add the import `import { RunKind } from '../contracts/index.ts';` (extend the existing contracts import). Add the helper (place near the existing `RUN_ROOT_NAMES`/root handling):
```typescript
/** Derive what a run IS from the names of its root spans. A crew/workflow root
 *  wins over an agent root (a crew nests agent runs); everything else (chat's
 *  ui.stream, or no recognized root) is Chat. */
export function deriveRunKind(rootSpanNames: string[]): RunKind {
  if (rootSpanNames.includes('crew.run')) return RunKind.Crew;
  if (rootSpanNames.includes('workflow.run')) return RunKind.Workflow;
  if (rootSpanNames.includes('agent.run')) return RunKind.Agent;
  return RunKind.Chat;
}
```
In `mapRunToDto`, when building the `RunDTO`, set `kind: deriveRunKind(<root span names>)` — the function already computes the root span set (the `roots`/root-name list it uses for `RunDtoSchema.roots`); pass those NAMES (not ids) to `deriveRunKind`. In `summarizeRunListItem`, set `kind` the same way from the summary's root span name(s).

- [ ] **Step 4: Run the new test + the existing run-dto suite**

Run: `bun test tests/run/run-kind.test.ts && bun test tests/run tests/server/runs-list.test.ts tests/server/runs-detail.test.ts`
Expected: `run-kind` PASS. Fix any existing run-dto/server-runs test that now fails because the emitted DTO gained `kind` (they assert on the DTO shape) — update those expectations to include `kind`.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/run/run-dto.ts tests/run/run-kind.test.ts
git add src/run/run-dto.ts tests/run/run-kind.test.ts
git commit -m "feat(run): derive RunKind from root span name on run DTOs (Phase 4)"
```

---

## Task 8: Server — crew browse handlers (list + detail)

**Files:**
- Create: `src/server/crews/list.ts`, `src/server/crews/detail.ts`
- Test: `tests/server/crews-browse.test.ts` (create)

**Interfaces:**
- Consumes: `CREWS`/`getCrew` (`crews/index.ts`), `mapCrewToListItem`/`mapCrewToDetail` (Task 5), `CrewListResponseSchema`/`CrewDetailDtoSchema` (Tasks 2/4), `ISOLATION_HEADERS`.
- Produces: `handleCrewList(): Response`, `handleCrewDetail(name: string): Response`. No deps arg needed (the registry is a static import) — keep signatures argument-free for list, `(name)` for detail.

- [ ] **Step 1: Write the failing test**

`tests/server/crews-browse.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { CrewListResponse } from '../../src/contracts/index.ts';
import { handleCrewDetail } from '../../src/server/crews/detail.ts';
import { handleCrewList } from '../../src/server/crews/list.ts';

test('GET /api/crews lists the registry with COOP header', async () => {
  const res = handleCrewList();
  expect(res.status).toBe(200);
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  const body = (await res.json()) as CrewListResponse;
  expect(body.items.some((i) => i.name === 'research-crew')).toBe(true);
});

test('GET /api/crews/:name returns detail or 404', async () => {
  const ok = handleCrewDetail('research-crew');
  expect(ok.status).toBe(200);
  const missing = handleCrewDetail('no-such-crew');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not found' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/crews-browse.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the handlers**

`src/server/crews/detail.ts`:
```typescript
import { getCrew } from '../../../crews/index.ts';
import { mapCrewToDetail } from '../../crew/crew-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/crews/:name` — the crew's projected detail, or 404. The name is a
 *  registry-map key (not a filesystem path), so a plain map lookup is the guard;
 *  no confineToDir is needed (nothing touches disk). */
export function handleCrewDetail(name: string): Response {
  const def = getCrew(name);
  if (!def) return json({ error: 'not found' }, 404);
  return json(mapCrewToDetail(def), 200);
}
```

`src/server/crews/list.ts`:
```typescript
import { CREWS } from '../../../crews/index.ts';
import { CrewListResponseSchema } from '../../contracts/index.ts';
import { mapCrewToListItem } from '../../crew/crew-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/crews` — every crew in the registry, projected to summaries. */
export function handleCrewList(): Response {
  const items = Object.values(CREWS).map(mapCrewToListItem);
  return json(CrewListResponseSchema.parse({ items }), 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/crews-browse.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/crews/list.ts src/server/crews/detail.ts tests/server/crews-browse.test.ts
git add src/server/crews/list.ts src/server/crews/detail.ts tests/server/crews-browse.test.ts
git commit -m "feat(server): crew browse handlers — GET /api/crews[/:name] (Phase 4)"
```

---

## Task 9: Server — workflow browse handlers (list + detail)

**Files:**
- Create: `src/server/workflows/list.ts`, `src/server/workflows/detail.ts`
- Test: `tests/server/workflows-browse.test.ts` (create)

**Interfaces:**
- Consumes: `WORKFLOWS`/`getWorkflow` (`workflows/index.ts`), `mapWorkflowToListItem`/`mapWorkflowToDetail` (Task 6), `WorkflowListResponseSchema` (Task 4), `ISOLATION_HEADERS`.
- Produces: `handleWorkflowList(): Response`, `handleWorkflowDetail(id: string): Response`.

- [ ] **Step 1: Write the failing test**

`tests/server/workflows-browse.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { WorkflowListResponse } from '../../src/contracts/index.ts';
import { handleWorkflowDetail } from '../../src/server/workflows/detail.ts';
import { handleWorkflowList } from '../../src/server/workflows/list.ts';

test('GET /api/workflows lists the registry', async () => {
  const res = handleWorkflowList();
  expect(res.status).toBe(200);
  const body = (await res.json()) as WorkflowListResponse;
  expect(body.items.some((i) => i.id === 'fetch-then-summarize')).toBe(true);
});

test('GET /api/workflows/:id returns detail with edges, or 404', async () => {
  const ok = handleWorkflowDetail('fetch-then-summarize');
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as { edges: unknown[] };
  expect(body.edges.length).toBeGreaterThan(0);
  expect(handleWorkflowDetail('nope').status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/workflows-browse.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the handlers** (mirror Task 8, swapping crew→workflow, `getWorkflow`/`WORKFLOWS`, `mapWorkflowToDetail`/`mapWorkflowToListItem`, `WorkflowListResponseSchema`; `handleWorkflowDetail(id)` looks up `getWorkflow(id)`).

`src/server/workflows/detail.ts`:
```typescript
import { getWorkflow } from '../../../workflows/index.ts';
import { mapWorkflowToDetail } from '../../workflow/workflow-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/workflows/:id` — the workflow's projected detail (steps + edges), or 404. */
export function handleWorkflowDetail(id: string): Response {
  const def = getWorkflow(id);
  if (!def) return json({ error: 'not found' }, 404);
  return json(mapWorkflowToDetail(def), 200);
}
```

`src/server/workflows/list.ts`:
```typescript
import { WORKFLOWS } from '../../../workflows/index.ts';
import { WorkflowListResponseSchema } from '../../contracts/index.ts';
import { mapWorkflowToListItem } from '../../workflow/workflow-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/workflows` — every workflow in the registry, projected to summaries. */
export function handleWorkflowList(): Response {
  const items = Object.values(WORKFLOWS).map(mapWorkflowToListItem);
  return json(WorkflowListResponseSchema.parse({ items }), 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/workflows-browse.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/workflows/list.ts src/server/workflows/detail.ts tests/server/workflows-browse.test.ts
git add src/server/workflows/list.ts src/server/workflows/detail.ts tests/server/workflows-browse.test.ts
git commit -m "feat(server): workflow browse handlers — GET /api/workflows[/:id] (Phase 4)"
```

---

## Task 10: Wire browse routes into `app.ts`

**Files:**
- Modify: `src/server/app.ts` (import the four browse handlers; add four GET routes in `handleApi`)
- Test: `tests/server/phase4-routes.test.ts` (create — full-`Request` routing via `buildFetch`)

**Interfaces:**
- Consumes: `handleCrewList`/`handleCrewDetail` (Task 8), `handleWorkflowList`/`handleWorkflowDetail` (Task 9). Detail is synchronous and can 404 → reflect `res.status` in `rec.status(...)` like the runs-detail branch.

- [ ] **Step 1: Write the failing routing test** (build a `ServerDeps` + `buildFetch`; reuse the app-test harness — see `tests/server/app.test.ts` / `tests/server/runs-routes.test.ts` for how deps are stubbed and an authorized `Request` is built with the bearer token + a loopback Host).

`tests/server/phase4-routes.test.ts` (skeleton — fill deps per the existing app-test harness):
```typescript
import { expect, test } from 'bun:test';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';

const TOKEN = 'test-token';
function deps(): ServerDeps {
  // Mirror tests/server/app.test.ts: a minimal ServerDeps with a stub
  // runChatTurn, empty consent, tmp uploadsDir/runsRoot, policy {port, allowedOrigins:[]}.
  // (Copy that file's helper verbatim; only TOKEN + policy.port matter here.)
  return /* … from app.test.ts helper … */ ({}) as ServerDeps;
}
function authGet(path: string): Request {
  return new Request(`http://localhost:PORT${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:PORT' },
  });
}

test('GET /api/crews and /api/workflows route to their handlers', async () => {
  const fetch = buildFetch(deps());
  expect((await fetch(authGet('/api/crews'))).status).toBe(200);
  expect((await fetch(authGet('/api/workflows'))).status).toBe(200);
  expect((await fetch(authGet('/api/crews/research-crew'))).status).toBe(200);
  expect((await fetch(authGet('/api/workflows/fetch-then-summarize'))).status).toBe(200);
  expect((await fetch(authGet('/api/crews/nope'))).status).toBe(404);
});
```

> Copy the exact `deps()`/authorized-`Request` helper from `tests/server/app.test.ts` (it already constructs a valid `ServerDeps` + token + loopback Host). This task's tests must use that real harness, not the `{}` placeholder above.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/phase4-routes.test.ts`
Expected: FAIL — routes 404 (not wired).

- [ ] **Step 3: Wire the routes in `src/server/app.ts`**

Add imports:
```typescript
import { handleCrewDetail } from './crews/detail.ts';
import { handleCrewList } from './crews/list.ts';
import { handleWorkflowDetail } from './workflows/detail.ts';
import { handleWorkflowList } from './workflows/list.ts';
```
In `handleApi`, add BEFORE the final `rec.status(404)` fallthrough (order: list exact-match before the `:id` regex; detail regex; the `/run` POST routes come in Task 12 and MUST precede the bare `:name` detail regex):
```typescript
        if (req.method === 'GET' && url.pathname === '/api/crews') {
          rec.status(200);
          return handleCrewList();
        }
        if (req.method === 'GET' && url.pathname === '/api/workflows') {
          rec.status(200);
          return handleWorkflowList();
        }
        const crewDetail = url.pathname.match(/^\/api\/crews\/([^/]+)$/);
        if (req.method === 'GET' && crewDetail?.[1]) {
          const res = handleCrewDetail(crewDetail[1]);
          rec.status(res.status);
          return res;
        }
        const wfDetail = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);
        if (req.method === 'GET' && wfDetail?.[1]) {
          const res = handleWorkflowDetail(wfDetail[1]);
          rec.status(res.status);
          return res;
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/phase4-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/app.ts tests/server/phase4-routes.test.ts
git add src/server/app.ts tests/server/phase4-routes.test.ts
git commit -m "feat(server): wire crew/workflow browse routes into the BFF (Phase 4)"
```

---

## Task 11: Fire-and-watch launch handlers + real run-turns [HARD — ultracode-verify]

**Files:**
- Create: `src/server/crews/run.ts`, `src/server/workflows/run.ts` (handlers + turn types — UNIT-TESTED)
- Create: `src/server/launch-turns.ts` (real `createRealRunCrewTurn`/`createRealRunWorkflowTurn` — live-verified, NOT unit-tested, same policy as `createRealRunChatTurn`)
- Test: `tests/server/crews-run.test.ts`, `tests/server/workflows-run.test.ts` (create)

**Interfaces:**
- Consumes: `getCrew`/`getWorkflow`, `CrewRunRequestSchema`/`WorkflowRunRequestSchema`/`RunLaunchResponseSchema` (Task 4), `newRunId` (`src/run/run-id.ts`), `createRun`/`writeArtifact` (`src/run/run-store.ts`), `explain` (`src/errors/boundary.ts`), `CrewDef`/`WorkflowDef`.
- Produces:
  - `RunCrewTurn = (i: { def: CrewDef; input: string; runId: string }) => Promise<unknown>`
  - `RunWorkflowTurn = (i: { def: WorkflowDef; input: string; runId: string }) => Promise<unknown>`
  - `CrewRunDeps = { runsRoot: string; runCrewTurn: RunCrewTurn }`, `WorkflowRunDeps = { runsRoot: string; runWorkflowTurn: RunWorkflowTurn }`
  - `handleCrewRun(req, deps: CrewRunDeps, name): Promise<Response>`, `handleWorkflowRun(req, deps: WorkflowRunDeps, id): Promise<Response>`
  - `createRealRunCrewTurn(runsRoot: string): RunCrewTurn`, `createRealRunWorkflowTurn(runsRoot: string): RunWorkflowTurn`

**The concurrency contract (adversarial-verify targets):**
1. The handler pre-creates the run dir (`await createRun(runsRoot, runId)`) BEFORE returning, so the browser's immediate `GET /api/runs/:runId/stream` never 404s on a missing dir.
2. The turn is started **detached** (`void turn(...).catch(...)`) — the handler returns `{ runId }` without awaiting the run.
3. A throw in the detached turn is caught and persisted to `runs/<runId>/error.json` — never an unhandled rejection.
4. Malformed body / bad JSON → 400; unknown name → 404 (before any run dir is created).

- [ ] **Step 1: Write the failing crew-run test**

`tests/server/crews-run.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { handleCrewRun } from '../../src/server/crews/run.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'crewrun-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function runReq(name: string, body: unknown): Request {
  return new Request(`http://localhost/api/crews/${name}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('200 + {runId}, pre-creates dir, invokes the turn detached', async () => {
  const seen: string[] = [];
  const turn: RunCrewTurn = async ({ runId }) => {
    seen.push(runId);
  };
  const res = await handleCrewRun(runReq('research-crew', { input: 'AI' }), {
    runsRoot: root,
    runCrewTurn: turn,
  }, 'research-crew');
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
  expect(existsSync(join(root, runId))).toBe(true); // dir exists before we streamed
  await new Promise((r) => setTimeout(r, 5)); // let the detached turn run
  expect(seen).toEqual([runId]);
});

test('unknown crew → 404 (no dir created)', async () => {
  const res = await handleCrewRun(runReq('nope', { input: 'x' }), {
    runsRoot: root,
    runCrewTurn: async () => {},
  }, 'nope');
  expect(res.status).toBe(404);
});

test('malformed body → 400', async () => {
  const res = await handleCrewRun(runReq('research-crew', { wrong: 1 }), {
    runsRoot: root,
    runCrewTurn: async () => {},
  }, 'research-crew');
  expect(res.status).toBe(400);
});

test('a throwing turn persists error.json (no unhandled rejection)', async () => {
  const turn: RunCrewTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleCrewRun(runReq('research-crew', { input: 'AI' }), {
    runsRoot: root,
    runCrewTurn: turn,
  }, 'research-crew');
  const { runId } = (await res.json()) as { runId: string };
  await new Promise((r) => setTimeout(r, 10)); // let the .catch write
  expect(existsSync(join(root, runId, 'error.json'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/crews-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/crews/run.ts`**

```typescript
import { getCrew } from '../../../crews/index.ts';
import { CrewRunRequestSchema, RunLaunchResponseSchema } from '../../contracts/index.ts';
import type { CrewDef } from '../../crew/types.ts';
import { explain } from '../../errors/boundary.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun, writeArtifact } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** Starts a crew run to completion under its own `withMcpRun` scope. Detached by
 *  the handler; may reject (its rejection is caught + persisted to error.json). */
export type RunCrewTurn = (input: {
  def: CrewDef;
  input: string;
  runId: string;
}) => Promise<unknown>;

export type CrewRunDeps = { runsRoot: string; runCrewTurn: RunCrewTurn };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `POST /api/crews/:name/run` — fire-and-watch. Validates the body, looks up the
 * crew, mints a runId, PRE-CREATES the run dir (so the browser's immediate
 * `/api/runs/:id/stream` never 404s), starts the run DETACHED, and returns the
 * runId at once. A throw in the detached run is caught + written to error.json.
 */
export async function handleCrewRun(
  req: Request,
  deps: CrewRunDeps,
  name: string,
): Promise<Response> {
  const def = getCrew(name);
  if (!def) return json({ error: 'not found' }, 404);
  let input: string;
  try {
    input = CrewRunRequestSchema.parse(await req.json()).input;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const runId = newRunId();
  const run = await createRun(deps.runsRoot, runId);
  void deps.runCrewTurn({ def, input, runId }).catch(async (err: unknown) => {
    try {
      await writeArtifact(run, 'error.json', JSON.stringify({ error: explain(err).title }));
    } catch {
      // best-effort: the run dir may already be gone; nothing else to do.
    }
  });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
```

- [ ] **Step 4: Create `src/server/workflows/run.ts`** (mirror; swap `getWorkflow`, `WorkflowRunRequestSchema`, `WorkflowDef`, `RunWorkflowTurn`, `WorkflowRunDeps`, `handleWorkflowRun(req, deps, id)`).

```typescript
import { getWorkflow } from '../../../workflows/index.ts';
import { RunLaunchResponseSchema, WorkflowRunRequestSchema } from '../../contracts/index.ts';
import { explain } from '../../errors/boundary.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun, writeArtifact } from '../../run/run-store.ts';
import type { WorkflowDef } from '../../workflow/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type RunWorkflowTurn = (input: {
  def: WorkflowDef;
  input: string;
  runId: string;
}) => Promise<unknown>;

export type WorkflowRunDeps = { runsRoot: string; runWorkflowTurn: RunWorkflowTurn };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `POST /api/workflows/:id/run` — fire-and-watch (see handleCrewRun for the contract). */
export async function handleWorkflowRun(
  req: Request,
  deps: WorkflowRunDeps,
  id: string,
): Promise<Response> {
  const def = getWorkflow(id);
  if (!def) return json({ error: 'not found' }, 404);
  let input: string;
  try {
    input = WorkflowRunRequestSchema.parse(await req.json()).input;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const runId = newRunId();
  const run = await createRun(deps.runsRoot, runId);
  void deps.runWorkflowTurn({ def, input, runId }).catch(async (err: unknown) => {
    try {
      await writeArtifact(run, 'error.json', JSON.stringify({ error: explain(err).title }));
    } catch {
      // best-effort
    }
  });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
```

Add the analogous `tests/server/workflows-run.test.ts` (copy the crew test, swapping `handleWorkflowRun`, `fetch-then-summarize`, `/api/workflows/:id/run`, `runWorkflowTurn`).

- [ ] **Step 5: Create the real turns `src/server/launch-turns.ts`** (live-verified, not unit-tested)

Mirror the CLI recipe EXACTLY. **Copy the imports + selection/agent-map setup verbatim from `src/cli/crew.ts` `main()` (lines 87–133) and `src/cli/flow.ts` `main()` (lines 130–181)** — `withMcpRun`, `createSelectionRuntime`, `AGENTS`, `agentNames`, `runCrewCli`, `runFlow`. This seam composes real MCP mount + engine wiring; like `createRealRunChatTurn` it is covered by live-verify, not unit tests.

```typescript
// NOTE: fix these import paths to match src/cli/crew.ts + src/cli/flow.ts exactly.
import { runCrewCli } from '../cli/crew.ts';
import { runFlow } from '../cli/flow.ts';
import { withMcpRun } from '../cli/with-mcp-run.ts';
// createSelectionRuntime, AGENTS, agentNames: copy the exact import lines from crew.ts/flow.ts
import type { RunCrewTurn } from './crews/run.ts';
import type { RunWorkflowTurn } from './workflows/run.ts';

export function createRealRunCrewTurn(runsRoot: string): RunCrewTurn {
  return async ({ def, input, runId }) =>
    withMcpRun({ runsRoot, runId }, async ({ run, reg, ledger }) => {
      const selection = await createSelectionRuntime({ ledger });
      try {
        await runCrewCli({
          def,
          input,
          run,
          tools: reg.merged,
          onBeforeDelegate: selection.onBeforeDelegate,
          ledger,
        });
      } finally {
        await selection.close();
      }
    });
}

export function createRealRunWorkflowTurn(runsRoot: string): RunWorkflowTurn {
  return async ({ def, input, runId }) =>
    withMcpRun({ runsRoot, runId }, async ({ run, reg, ledger }) => {
      const selection = await createSelectionRuntime({ ledger });
      try {
        const agents: Record<string, ReturnType<(typeof AGENTS)[string]>> = {};
        for (const name of agentNames()) {
          const factory = AGENTS[name];
          if (factory) agents[name] = factory(reg.forAgent(name));
        }
        await runFlow({
          def,
          input,
          run,
          agents,
          tools: reg.merged,
          onBeforeDelegate: selection.onBeforeDelegate,
          ledger,
        });
      } finally {
        await selection.close();
      }
    });
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test tests/server/crews-run.test.ts tests/server/workflows-run.test.ts`
Expected: PASS. Then `bun run typecheck` clean (resolve the real-turn import paths against the CLI files).

- [ ] **Step 7: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/crews/run.ts src/server/workflows/run.ts src/server/launch-turns.ts tests/server/crews-run.test.ts tests/server/workflows-run.test.ts
git add src/server/crews/run.ts src/server/workflows/run.ts src/server/launch-turns.ts tests/server/crews-run.test.ts tests/server/workflows-run.test.ts
git commit -m "feat(server): fire-and-watch crew/workflow launch handlers + real turns (Phase 4)"
```

> **Controller note (ultracode):** run Task 11 via an ultracode Workflow (adversarial-verify). Verifiers must confirm the four contract points — especially (3) a `void promise.catch()` (a bare `void promise` is a defect) and (1) the dir exists before the response resolves (`await createRun` precedes the `return`).

---

## Task 12: Wire launch routes + `main.ts` deps

**Files:**
- Modify: `src/server/app.ts` (import `handleCrewRun`/`handleWorkflowRun` + the turn types; add the two POST `/run` routes BEFORE the bare `:name`/`:id` GET detail regexes from Task 10; extend `ServerDeps` with `runCrewTurn`/`runWorkflowTurn`)
- Modify: `src/server/main.ts` (build the real turns; add to the `deps` object)
- Test: extend `tests/server/phase4-routes.test.ts` (add POST /run cases; extend the `deps()` helper with stub turns)

- [ ] **Step 1: Add failing POST-route assertions** to `tests/server/phase4-routes.test.ts` (`runId` returned for both `POST /api/crews/research-crew/run` and `POST /api/workflows/fetch-then-summarize/run`; extend `deps()` with `runCrewTurn: async () => {}`, `runWorkflowTurn: async () => {}`).

- [ ] **Step 2: Run to verify it fails** — `bun test tests/server/phase4-routes.test.ts` → FAIL (404 + missing deps fields).

- [ ] **Step 3a: Extend `ServerDeps`** in `src/server/app.ts` — add top-level `import type { RunCrewTurn } from './crews/run.ts';` + `import type { RunWorkflowTurn } from './workflows/run.ts';`, then fields `runCrewTurn: RunCrewTurn;` `runWorkflowTurn: RunWorkflowTurn;`.

- [ ] **Step 3b: Add the POST routes in `handleApi`** — BEFORE the bare `:name`/`:id` GET detail regexes (Task 10). The `/run` sub-path must be tested before the detail match (the runs `/stream`-before-`/:id` ordering lesson):
```typescript
        const crewRun = url.pathname.match(/^\/api\/crews\/([^/]+)\/run$/);
        if (req.method === 'POST' && crewRun?.[1]) {
          const res = await handleCrewRun(req, deps, crewRun[1]);
          rec.status(res.status);
          return res;
        }
        const wfRun = url.pathname.match(/^\/api\/workflows\/([^/]+)\/run$/);
        if (req.method === 'POST' && wfRun?.[1]) {
          const res = await handleWorkflowRun(req, deps, wfRun[1]);
          rec.status(res.status);
          return res;
        }
```
plus `import { handleCrewRun } from './crews/run.ts';` and `import { handleWorkflowRun } from './workflows/run.ts';`.

- [ ] **Step 3c: Build the turns in `src/server/main.ts`** — `import { createRealRunCrewTurn, createRealRunWorkflowTurn } from './launch-turns.ts';`; after `runChatTurn`: `const runCrewTurn = createRealRunCrewTurn(runsRoot);` `const runWorkflowTurn = createRealRunWorkflowTurn(runsRoot);`; add both to the `deps` object literal.

- [ ] **Step 4: Run test + typecheck** — `bun test tests/server/phase4-routes.test.ts && bun run typecheck` → PASS + clean.

- [ ] **Step 5: SERVER-GROUP GATE — full suite** — `bun run check` (docs:check · typecheck · lint · full `bun test`). First full-suite checkpoint after the Task-4 `kind` change + Task-7 mapper. Fix any drift.

- [ ] **Step 6: Commit**
```bash
git add src/server/app.ts src/server/main.ts tests/server/phase4-routes.test.ts
git commit -m "feat(server): wire crew/workflow launch routes + main.ts turns (Phase 4)"
```

---

## Task 13: Add `@xyflow/react` + generic `DagView`

**Files:**
- Modify: `web/package.json` (add `@xyflow/react`), `web/src/test/setup.ts` (ResizeObserver stub)
- Create: `web/src/shared/dag/types.ts`, `web/src/shared/dag/layout.ts`, `web/src/shared/dag/workflow-graph.ts`, `web/src/shared/dag/dag-view.tsx`
- Test: `web/src/shared/dag/workflow-graph.test.ts`, `web/src/shared/dag/dag-view.test.tsx`

**Interfaces:**
- Consumes: `StepDTO`/`WorkflowDetailDTO`/`StepKind` (`@contracts`, Task 3/1).
- Produces: `DagModel`/`DagNode`/`DagEdge`/`DagStatus` (`shared/dag/types.ts`); `layeredPositions(model): Map<string,{x,y}>` (`layout.ts`); `workflowGraph(detail): DagModel` (`workflow-graph.ts`); `DagView({ model, statusById?, onNodeClick? })` (`dag-view.tsx`) — the `onNodeClick` prop exists from this task on so Task 17's step-detail panel needs no later change to this file.

- [ ] **Step 1: Add the dependency**

```bash
cd web && bun add @xyflow/react
```
This adds `"@xyflow/react": "^12.x"` (bun resolves the exact minor) to `web/package.json` `dependencies`.

- [ ] **Step 2: ResizeObserver polyfill for happy-dom** — `@xyflow/react` measures node/viewport dimensions via `ResizeObserver` on mount; happy-dom has no implementation, so every `DagView` render throws `ReferenceError: ResizeObserver is not defined` without this. Add to `web/src/test/setup.ts` (same `beforeEach`/`vi.stubGlobal` pattern already used there for `matchMedia`/`localStorage`):

```typescript
// @xyflow/react observes node/viewport size via ResizeObserver on mount;
// happy-dom has no implementation. A no-op stub is enough for DagView's smoke
// tests (they assert on rendered nodes/edges, not measured pixel layout).
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
```

- [ ] **Step 3: Write the failing `workflow-graph` test**

`web/src/shared/dag/workflow-graph.test.ts`:
```typescript
import type { WorkflowDetailDTO } from '@contracts';
import { StepKind } from '@contracts';
import { describe, expect, it } from 'vitest';
import { workflowGraph } from './workflow-graph.ts';

const fixture: WorkflowDetailDTO = {
  id: 'fetch-then-summarize',
  steps: [
    { id: 'fetch', kind: StepKind.Tool, tool: 'fetch' },
    { id: 'summarize', kind: StepKind.Agent, agent: 'web_fetch' },
  ],
  edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
};

describe('workflowGraph', () => {
  it('projects steps to nodes (label = id, sublabel = agent/tool) and edges verbatim', () => {
    const model = workflowGraph(fixture);
    expect(model.nodes).toEqual([
      { id: 'fetch', label: 'fetch', sublabel: 'fetch', kind: StepKind.Tool },
      {
        id: 'summarize',
        label: 'summarize',
        sublabel: 'web_fetch',
        kind: StepKind.Agent,
      },
    ]);
    expect(model.edges).toEqual([
      { from: 'fetch', to: 'summarize', kind: 'depends' },
    ]);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd web && bun run test -- src/shared/dag/workflow-graph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Create `web/src/shared/dag/types.ts`**

```typescript
import type { StepKind } from '@contracts';

/** A DagView node's kind — every StepKind value plus 'manager' (D7a's
 *  hierarchical-crew hub node, which has no StepKind analog). */
export type DagNodeKind = StepKind | 'manager';

/** Live overlay status for a node (run-detail's D8 join); undefined/omitted
 *  renders as the neutral/default (pending) look. */
export enum DagStatus {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
  Skipped = 'skipped',
}

export type DagNode = {
  id: string;
  label: string;
  sublabel?: string;
  kind: DagNodeKind;
  status?: DagStatus;
};

/** 'delegates' is the D7a hierarchical-crew manager→member edge; the other
 *  three kinds mirror `EdgeDTO['kind']` verbatim. */
export type DagEdgeKind = 'depends' | 'branch-true' | 'branch-false' | 'delegates';

export type DagEdge = {
  from: string;
  to: string;
  kind: DagEdgeKind;
};

/** The normalized graph every DagView producer (workflow-graph, crew-graph,
 *  the run-detail live overlay) builds — D7's "one generic DagView". */
export type DagModel = {
  nodes: DagNode[];
  edges: DagEdge[];
};
```

- [ ] **Step 6: Create `web/src/shared/dag/layout.ts`** (pure — no dagre dependency, per the plan)

```typescript
import type { DagModel } from './types.ts';

const RANK_SPACING_X = 220;
const NODE_SPACING_Y = 90;

/**
 * Deterministic layered layout: each node's rank = the length of the longest
 * path from any root (a node with no incoming edge) to it, found by relaxing
 * `rank[to] = max(rank[to], rank[from] + 1)` over every edge, repeated once
 * per node (a safe upper bound for a DAG with `nodes.length` nodes and no
 * cycles — the deepest possible chain is `nodes.length - 1` hops). Nodes
 * within a rank are laid out in model order. `x = rank * spacing`,
 * `y = indexWithinRank * spacing`. Unreachable/disconnected nodes rank 0.
 */
export function layeredPositions(
  model: DagModel,
): Map<string, { x: number; y: number }> {
  const ranks = new Map<string, number>();
  for (const node of model.nodes) ranks.set(node.id, 0);

  for (let i = 0; i < model.nodes.length; i++) {
    for (const edge of model.edges) {
      const fromRank = ranks.get(edge.from);
      const toRank = ranks.get(edge.to);
      if (fromRank === undefined || toRank === undefined) continue;
      if (fromRank + 1 > toRank) ranks.set(edge.to, fromRank + 1);
    }
  }

  const byRank = new Map<number, string[]>();
  for (const node of model.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const bucket = byRank.get(rank) ?? [];
    bucket.push(node.id);
    byRank.set(rank, bucket);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [rank, ids] of byRank) {
    ids.forEach((id, index) => {
      positions.set(id, {
        x: rank * RANK_SPACING_X,
        y: index * NODE_SPACING_Y,
      });
    });
  }
  return positions;
}
```

- [ ] **Step 7: Create `web/src/shared/dag/workflow-graph.ts`**

```typescript
import type { WorkflowDetailDTO } from '@contracts';
import type { DagModel } from './types.ts';

/** Pure projection of a workflow definition to the generic DAG model: nodes
 *  = steps (label = step id, sublabel = the step's agent/tool, kind = the
 *  step's own StepKind — honest, no relabeling); edges = `detail.edges`
 *  verbatim (already `depends`/`branch-true`/`branch-false`, derived
 *  server-side by `workflow-dto.ts`'s `effectiveDeps` — never re-derived here). */
export function workflowGraph(detail: WorkflowDetailDTO): DagModel {
  return {
    nodes: detail.steps.map((step) => ({
      id: step.id,
      label: step.id,
      sublabel: step.agent ?? step.tool ?? undefined,
      kind: step.kind,
    })),
    edges: detail.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
    })),
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd web && bun run test -- src/shared/dag/workflow-graph.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing `DagView` tests**

`web/src/shared/dag/dag-view.test.tsx`:
```tsx
import { StepKind } from '@contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DagView } from './dag-view.tsx';
import { DagStatus, type DagModel } from './types.ts';

const model: DagModel = {
  nodes: [
    { id: 'a', label: 'a', kind: StepKind.Tool },
    { id: 'b', label: 'b', kind: StepKind.Agent },
  ],
  edges: [{ from: 'a', to: 'b', kind: 'depends' }],
};

describe('DagView', () => {
  it('renders a node per graph node', () => {
    render(<DagView model={model} />);
    expect(screen.getByTestId('dag-view')).toBeInTheDocument();
    expect(screen.getByTestId('dag-node-a')).toBeInTheDocument();
    expect(screen.getByTestId('dag-node-b')).toBeInTheDocument();
  });

  it('overlays statusById onto the matching node (border reflects status)', () => {
    render(<DagView model={model} statusById={{ a: DagStatus.Error }} />);
    expect(screen.getByTestId('dag-node-a')).toHaveStyle({
      borderColor: 'var(--color-danger)',
    });
  });

  it('calls onNodeClick with the clicked node id', () => {
    const onNodeClick = vi.fn();
    render(<DagView model={model} onNodeClick={onNodeClick} />);
    fireEvent.click(screen.getByTestId('dag-node-a'));
    expect(onNodeClick).toHaveBeenCalledWith('a');
  });

  it('shows an empty state for a graph with no nodes', () => {
    render(<DagView model={{ nodes: [], edges: [] }} />);
    expect(screen.getByTestId('dag-empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `cd web && bun run test -- src/shared/dag/dag-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 11: Create `web/src/shared/dag/dag-view.tsx`**

```tsx
import {
  Background,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
// `base.css` (not `style.css`) — the minimal reset only; DagView's colors/
// borders are all our own inline styles via design tokens, not xyflow's
// default theme.
import '@xyflow/react/dist/base.css';
import { useMemo } from 'react';
import { layeredPositions } from './layout.ts';
import { DagStatus, type DagModel, type DagNodeKind } from './types.ts';

function statusColor(status: DagStatus | undefined): string | undefined {
  switch (status) {
    case DagStatus.Running:
      return 'var(--color-accent)';
    case DagStatus.Done:
      return 'var(--color-signal)';
    case DagStatus.Error:
      return 'var(--color-danger)';
    case DagStatus.Skipped:
      return 'var(--color-muted)';
    default:
      return undefined;
  }
}

function kindColor(kind: DagNodeKind): string {
  return kind === 'manager' ? 'var(--color-accent)' : 'var(--color-border)';
}

type DagNodeData = {
  label: string;
  sublabel?: string;
  kind: DagNodeKind;
  status?: DagStatus;
};

// NOTE: `NodeProps<Node<DagNodeData>>` matches @xyflow/react v12's custom-node
// typing; if a later ^12 minor shifts this generic shape, adjust to match —
// the runtime contract (a `data` prop shaped like `DagNodeData`) won't change.
function DagNodeCard({ data }: NodeProps<Node<DagNodeData>>) {
  const border = statusColor(data.status) ?? kindColor(data.kind);
  return (
    <div
      data-testid={`dag-node-${data.label}`}
      className="rounded-md border-2 bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-fg)]"
      style={{ borderColor: border }}
    >
      <Handle type="target" position={Position.Left} />
      <div>{data.label}</div>
      {data.sublabel && (
        <div className="text-[var(--color-muted)]">{data.sublabel}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { dag: DagNodeCard };

/**
 * D7's one generic step/task-graph canvas. Takes the normalized `DagModel`
 * (built by `workflowGraph`/`crewGraph`/the run-detail live overlay), lays it
 * out via `layeredPositions` (no dagre dependency), and renders it as an
 * interactive `@xyflow/react` canvas. `statusById` overlays a live status per
 * node id (D8); `onNodeClick` surfaces node selection (Task 17's step-detail
 * panel). Branch/delegate edges render dashed + labeled; depends edges
 * animate. Empty graphs render a plain empty state instead of a blank canvas.
 */
export function DagView({
  model,
  statusById,
  onNodeClick,
}: {
  model: DagModel;
  statusById?: Record<string, DagStatus>;
  onNodeClick?: (nodeId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const positions = layeredPositions(model);
    const rfNodes: Node<DagNodeData>[] = model.nodes.map((n) => ({
      id: n.id,
      type: 'dag',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        label: n.label,
        sublabel: n.sublabel,
        kind: n.kind,
        status: statusById?.[n.id] ?? n.status,
      },
    }));
    const rfEdges: Edge[] = model.edges.map((e) => ({
      id: `${e.from}-${e.to}-${e.kind}`,
      source: e.from,
      target: e.to,
      animated: e.kind === 'depends',
      style:
        e.kind === 'branch-true' ||
        e.kind === 'branch-false' ||
        e.kind === 'delegates'
          ? { strokeDasharray: '4 4' }
          : undefined,
      label:
        e.kind === 'branch-true'
          ? 'true'
          : e.kind === 'branch-false'
            ? 'false'
            : undefined,
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [model, statusById]);

  if (model.nodes.length === 0) {
    return (
      <div
        data-testid="dag-empty"
        role="status"
        className="p-4 font-mono text-sm text-[var(--color-muted)]"
      >
        No graph to show.
      </div>
    );
  }

  return (
    <div
      data-testid="dag-view"
      aria-label="step graph"
      style={{ width: '100%', height: 480 }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={
          onNodeClick ? (_event, node) => onNodeClick(node.id) : undefined
        }
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `cd web && bun run test -- src/shared/dag`
Expected: PASS (all of `workflow-graph.test.ts` + `dag-view.test.tsx`).

- [ ] **Step 13: Gate + commit**

```bash
cd web && bun run typecheck && bun run test -- src/shared/dag
cd .. && bun run lint:file -- web/package.json web/src/test/setup.ts web/src/shared/dag/types.ts web/src/shared/dag/layout.ts web/src/shared/dag/workflow-graph.ts web/src/shared/dag/workflow-graph.test.ts web/src/shared/dag/dag-view.tsx web/src/shared/dag/dag-view.test.tsx
git add web/package.json web/bun.lock web/src/test/setup.ts web/src/shared/dag/
git commit -m "feat(web): add @xyflow/react + generic DagView (Phase 4)"
```

---

## Task 14: Crews list (`CrewsArea`)

**Files:**
- Modify: `web/src/features/crews/index.tsx` (replace the Phase-1b stub)
- Test: `web/src/features/crews/index.test.tsx` (create)

**Interfaces:**
- Consumes: `CrewListResponseSchema`/`CrewListResponse` (Task 4/2), `apiFetch`, `RegionErrorBoundary`.
- Produces: `CrewsArea()` — mirrors `RunsArea` (Phase 3) minus cursor pagination (D9: registries are small, no server facets this phase) plus a client-side search filter.

> **Controller note (pairs with Task 15):** this component's rows link to `/crews/$crewName`, a route Task 15 registers in `router.tsx`. Until Task 15 lands, `tsc` will flag the `Link to="/crews/$crewName"` target as unknown to the router's generated route-path union. Run Tasks 14 and 15 back-to-back and gate typecheck after both — the same pattern Task 4/7 already uses for a cross-task type dependency.

- [ ] **Step 1: Write the failing test**

`web/src/features/crews/index.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const page = {
  items: [
    {
      name: 'research-crew',
      description: 'Research a topic and produce a short brief.',
      process: 'sequential',
      memberCount: 2,
      taskCount: 2,
    },
  ],
};

describe('CrewsArea', () => {
  it('lists crews fetched from /api/crews', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page)));
    renderAt('/crews');
    await waitFor(() =>
      expect(screen.getByText('research-crew')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('area-crews')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No crews found" when the registry is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })));
    renderAt('/crews');
    await waitFor(() =>
      expect(screen.getByText('No crews found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('filters client-side by search text (name or description)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page)));
    renderAt('/crews');
    await waitFor(() =>
      expect(screen.getByText('research-crew')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('crews-search'), {
      target: { value: 'nope' },
    });
    await waitFor(() =>
      expect(screen.getByText('No crews found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows an in-region error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    renderAt('/crews');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- src/features/crews`
Expected: FAIL — the stub renders no search box / no list.

- [ ] **Step 3: Replace `web/src/features/crews/index.tsx`**

```tsx
import type { CrewListResponse } from '@contracts';
import { CrewListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** Crews browse (D9: a small in-memory registry — no cursor, no server
 *  facets; search is client-side over name/description). Rows link into
 *  `/crews/$crewName` (Task 15). */
export function CrewsArea() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<CrewListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch('/crews', { schema: CrewListResponseSchema })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(err instanceof Error ? err.message : 'failed to load crews');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = search.trim().toLowerCase();
  const items = (page?.items ?? []).filter(
    (item) =>
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
  );

  return (
    <RegionErrorBoundary region="Crews">
      <section data-testid="area-crews" className="flex h-full flex-col p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">Crews</h1>

        <input
          data-testid="crews-search"
          type="search"
          placeholder="Search crews…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
        />

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Crews</strong> failed
            to load. {error}
          </div>
        )}

        {!error && page && items.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-muted)]">
            No crews found
          </p>
        )}

        {!error && page && items.length > 0 && (
          <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
            {items.map((item) => (
              <li key={item.name}>
                <Link
                  to="/crews/$crewName"
                  params={{ crewName: item.name }}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)] hover:border-[var(--color-accent)]"
                >
                  <span className="text-[var(--color-fg)]">{item.name}</span>
                  <span className="text-[var(--color-muted)]">
                    {item.process}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {item.memberCount} members
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {item.taskCount} tasks
                  </span>
                  {item.description && (
                    <span className="text-[var(--color-muted)]">
                      {item.description}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (after Task 15 also lands — see the Controller note)

Run: `cd web && bun run test -- src/features/crews`
Expected: PASS.

- [ ] **Step 5: Gate + commit** (deferred to Task 15's combined gate — see below)

```bash
git add web/src/features/crews/index.tsx web/src/features/crews/index.test.tsx
git commit -m "feat(web): CrewsArea list — browse the crew registry (Phase 4)"
```

---

## Task 15: Crew detail — process-aware DAG (D7a) + Run

**Files:**
- Create: `web/src/features/crews/crew-graph.ts`, `web/src/features/crews/crew-detail.tsx`
- Test: `web/src/features/crews/crew-graph.test.ts`, `web/src/features/crews/crew-detail.test.tsx`
- Modify: `web/src/app/router.tsx` (add `route('/crews/$crewName', CrewDetail)` — this is what makes Task 14's `Link` typecheck)

**Interfaces:**
- Consumes: `CrewDetailDTO`/`CrewProcess` (`@contracts`), `DagView`/`DagModel` (Task 13), `RunLaunchResponseSchema` (Task 4).
- Produces: `crewGraph(detail: CrewDetailDTO): DagModel` — process-aware per D7a: **sequential** → task-dependency DAG (nodes = tasks, edges from `dependsOn` else the previous task in declaration order — the crew analog of `effectiveDeps`); **hierarchical** → a `manager` hub node with `delegates` edges to each member (no static task DAG — the manager delegates at runtime). `CrewDetail()` route component.

- [ ] **Step 1: Write the failing `crew-graph` test**

`web/src/features/crews/crew-graph.test.ts`:
```typescript
import type { CrewDetailDTO } from '@contracts';
import { CrewProcess } from '@contracts';
import { describe, expect, it } from 'vitest';
import { crewGraph } from './crew-graph.ts';

const sequential: CrewDetailDTO = {
  name: 'research-crew',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'researcher',
      role: 'Research Analyst',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'largest-that-fits',
    },
    {
      name: 'writer',
      role: 'Technical Writer',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'largest-that-fits',
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'd',
      expectedOutput: 'o',
      member: 'researcher',
      dependsOn: [],
    },
    {
      id: 'brief',
      description: 'd',
      expectedOutput: 'o',
      member: 'writer',
      dependsOn: ['gather'],
    },
  ],
};

const hierarchical: CrewDetailDTO = {
  name: 'manager-crew',
  process: CrewProcess.Hierarchical,
  members: [
    {
      name: 'researcher',
      role: 'Research Analyst',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'largest-that-fits',
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'd',
      expectedOutput: 'o',
      member: 'researcher',
      dependsOn: [],
    },
  ],
};

describe('crewGraph', () => {
  it('sequential: tasks become nodes; deps from dependsOn else the previous task', () => {
    const model = crewGraph(sequential);
    expect(model.nodes.map((n) => n.id)).toEqual(['gather', 'brief']);
    expect(model.nodes[1]?.sublabel).toBe('writer');
    expect(model.edges).toEqual([
      { from: 'gather', to: 'brief', kind: 'depends' },
    ]);
  });

  it('hierarchical: a manager hub delegates to each member; no task DAG', () => {
    const model = crewGraph(hierarchical);
    expect(model.nodes.map((n) => n.id)).toEqual(['__manager__', 'researcher']);
    expect(model.nodes[0]?.kind).toBe('manager');
    expect(model.edges).toEqual([
      { from: '__manager__', to: 'researcher', kind: 'delegates' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- src/features/crews/crew-graph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/features/crews/crew-graph.ts`**

```typescript
import type { CrewDetailDTO } from '@contracts';
import { CrewProcess, StepKind } from '@contracts';
import type { DagModel } from '../../shared/dag/types.ts';

const MANAGER_NODE_ID = '__manager__';

/** D7a — process-aware crew→DagModel projection (pure; lives web-side so the
 *  server DTO stays a faithful, process-agnostic projection). Sequential
 *  crews compile to agent steps, so `kind: StepKind.Agent` is honest for
 *  every task node. Hierarchical crews have no static task DAG (the manager
 *  delegates at runtime) — they get a manager hub + delegation star instead;
 *  the crew-detail page shows the task list in a side panel, not the graph. */
export function crewGraph(detail: CrewDetailDTO): DagModel {
  if (detail.process === CrewProcess.Hierarchical) {
    return {
      nodes: [
        { id: MANAGER_NODE_ID, label: 'Manager', kind: 'manager' },
        ...detail.members.map((m) => ({
          id: m.name,
          label: m.name,
          sublabel: m.role,
          kind: StepKind.Agent,
        })),
      ],
      edges: detail.members.map((m) => ({
        from: MANAGER_NODE_ID,
        to: m.name,
        kind: 'delegates' as const,
      })),
    };
  }

  return {
    nodes: detail.tasks.map((task) => ({
      id: task.id,
      label: task.id,
      sublabel: task.member,
      kind: StepKind.Agent,
    })),
    edges: detail.tasks.flatMap((task, index) => {
      if (task.dependsOn.length > 0) {
        return task.dependsOn.map((dep) => ({
          from: dep,
          to: task.id,
          kind: 'depends' as const,
        }));
      }
      const prev = index > 0 ? detail.tasks[index - 1] : undefined;
      return prev
        ? [{ from: prev.id, to: task.id, kind: 'depends' as const }]
        : [];
    }),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && bun run test -- src/features/crews/crew-graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `crew-detail` test**

`web/src/features/crews/crew-detail.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const detail = {
  name: 'research-crew',
  process: 'sequential',
  members: [
    {
      name: 'researcher',
      role: 'Analyst',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'x',
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'd',
      expectedOutput: 'o',
      member: 'researcher',
      dependsOn: [],
    },
  ],
};

describe('CrewDetail', () => {
  it('renders members + the task graph', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(detail)));
    renderAt('/crews/research-crew');
    await waitFor(() =>
      expect(screen.getByTestId('crew-detail')).toBeInTheDocument(),
    );
    expect(screen.getByText(/researcher — Analyst/)).toBeInTheDocument();
    expect(screen.getByTestId('dag-view')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('launches a run and navigates to /runs/$runId', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/run')
        ? jsonResponse({ runId: 'run-abc' })
        : jsonResponse(detail),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/crews/research-crew');
    await waitFor(() =>
      expect(screen.getByTestId('crew-run-button')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('crew-run-input'), {
      target: { value: 'AI' },
    });
    fireEvent.click(screen.getByTestId('crew-run-button'));
    await waitFor(() =>
      expect(screen.getByTestId('run-detail')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd web && bun run test -- src/features/crews/crew-detail.test.tsx`
Expected: FAIL — module not found + no `/crews/$crewName` route.

- [ ] **Step 7: Create `web/src/features/crews/crew-detail.tsx`**

```tsx
import type { CrewDetailDTO } from '@contracts';
import {
  CrewDetailDtoSchema,
  CrewProcess,
  RunLaunchResponseSchema,
} from '@contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { DagView } from '../../shared/dag/dag-view.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { crewGraph } from './crew-graph.ts';

/** Route entry: mounts a fresh view per crew via `key`, mirroring RunDetail's
 *  remount-on-nav pattern (Phase 3). */
export function CrewDetail() {
  const { crewName } = useParams({ from: '/crews/$crewName' });
  return <CrewDetailView key={crewName} crewName={crewName} />;
}

function CrewDetailView({ crewName }: { crewName: string }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CrewDetailDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    apiFetch(`/crews/${crewName}`, { schema: CrewDetailDtoSchema })
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load crew');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [crewName]);

  async function handleRun() {
    setLaunching(true);
    try {
      const { runId } = await apiFetch(`/crews/${crewName}/run`, {
        method: 'POST',
        body: { input },
        schema: RunLaunchResponseSchema,
      });
      navigate({ to: '/runs/$runId', params: { runId } });
    } catch (err: unknown) {
      setLaunching(false);
      setError(err instanceof Error ? err.message : 'failed to launch run');
    }
  }

  return (
    <RegionErrorBoundary region="Crew">
      <section data-testid="crew-detail" className="flex h-full flex-col p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Crew {crewName}
        </h1>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Crew</strong> failed.{' '}
            {error}
          </div>
        )}

        {detail && (
          <>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {detail.process} · {detail.members.length} members ·{' '}
              {detail.tasks.length} tasks
            </p>

            <ul
              data-testid="crew-members"
              className="mt-4 flex flex-wrap gap-2"
            >
              {detail.members.map((m) => (
                <li
                  key={m.name}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs text-[var(--color-fg)]"
                >
                  {m.name} — {m.role}
                </li>
              ))}
            </ul>

            {detail.process === CrewProcess.Hierarchical && (
              <ul
                data-testid="crew-tasks"
                className="mt-2 flex flex-wrap gap-2"
              >
                {detail.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs text-[var(--color-muted)]"
                  >
                    {t.id}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex-1">
              <DagView model={crewGraph(detail)} />
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                data-testid="crew-run-input"
                type="text"
                placeholder="Input…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
              />
              <Button
                data-testid="crew-run-button"
                variant="accent"
                disabled={launching || !input.trim()}
                onClick={handleRun}
              >
                {launching ? 'Launching…' : 'Run'}
              </Button>
            </div>
          </>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 8: Add the route to `web/src/app/router.tsx`**

Add the import `import { CrewDetail } from '../features/crews/crew-detail.tsx';` and, in `routeTree`'s children, add `route('/crews/$crewName', CrewDetail),` directly after `route('/crews', CrewsArea),`.

- [ ] **Step 9: Run to verify it passes (Task 14 + 15 combined)**

Run: `cd web && bun run test -- src/features/crews`
Expected: PASS (all of `index.test.tsx`, `crew-graph.test.ts`, `crew-detail.test.tsx`).

- [ ] **Step 10: Combined Task 14/15 gate + commit**

```bash
cd web && bun run typecheck && bun run test -- src/features/crews
cd .. && bun run lint:file -- web/src/features/crews/index.tsx web/src/features/crews/index.test.tsx web/src/features/crews/crew-graph.ts web/src/features/crews/crew-graph.test.ts web/src/features/crews/crew-detail.tsx web/src/features/crews/crew-detail.test.tsx web/src/app/router.tsx
git add web/src/features/crews/ web/src/app/router.tsx
git commit -m "feat(web): crew detail — process-aware task/delegation DAG + Run (Phase 4, D7a)"
```

---

## Task 16: Workflows list (`WorkflowsArea`)

**Files:**
- Modify: `web/src/features/workflows/index.tsx` (replace the Phase-1b stub)
- Test: `web/src/features/workflows/index.test.tsx` (create)

**Interfaces:**
- Consumes: `WorkflowListResponseSchema`/`WorkflowListResponse` (Task 4/3).
- Produces: `WorkflowsArea()` — mirrors Task 14 exactly, swapping `crew`→`workflow`, `name`→`id`, `memberCount`/`taskCount`→`stepCount`.

> **Controller note (pairs with Task 17):** rows link to `/workflows/$workflowId`, registered by Task 17. Same cross-task typecheck dependency as Task 14/15 — run 16 and 17 back-to-back, gate after both.

- [ ] **Step 1: Write the failing test**

`web/src/features/workflows/index.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const page = {
  items: [
    {
      id: 'fetch-then-summarize',
      description: 'Fetch a URL with the fetch tool, then summarize via an agent.',
      stepCount: 2,
    },
  ],
};

describe('WorkflowsArea', () => {
  it('lists workflows fetched from /api/workflows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page)));
    renderAt('/workflows');
    await waitFor(() =>
      expect(screen.getByText('fetch-then-summarize')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('area-workflows')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No workflows found" when the registry is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })));
    renderAt('/workflows');
    await waitFor(() =>
      expect(screen.getByText('No workflows found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('filters client-side by search text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page)));
    renderAt('/workflows');
    await waitFor(() =>
      expect(screen.getByText('fetch-then-summarize')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('workflows-search'), {
      target: { value: 'nope' },
    });
    await waitFor(() =>
      expect(screen.getByText('No workflows found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows an in-region error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    renderAt('/workflows');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- src/features/workflows`
Expected: FAIL.

- [ ] **Step 3: Replace `web/src/features/workflows/index.tsx`**

```tsx
import type { WorkflowListResponse } from '@contracts';
import { WorkflowListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** Workflows browse — mirrors CrewsArea (D9: small registry, no cursor,
 *  client-side search). Rows link into `/workflows/$workflowId` (Task 17). */
export function WorkflowsArea() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<WorkflowListResponse | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch('/workflows', { schema: WorkflowListResponseSchema })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(
            err instanceof Error ? err.message : 'failed to load workflows',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = search.trim().toLowerCase();
  const items = (page?.items ?? []).filter(
    (item) =>
      !q ||
      item.id.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
  );

  return (
    <RegionErrorBoundary region="Workflows">
      <section
        data-testid="area-workflows"
        className="flex h-full flex-col p-8"
      >
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Workflows
        </h1>

        <input
          data-testid="workflows-search"
          type="search"
          placeholder="Search workflows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
        />

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Workflows</strong>{' '}
            failed to load. {error}
          </div>
        )}

        {!error && page && items.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-muted)]">
            No workflows found
          </p>
        )}

        {!error && page && items.length > 0 && (
          <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: item.id }}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)] hover:border-[var(--color-accent)]"
                >
                  <span className="text-[var(--color-fg)]">{item.id}</span>
                  <span className="text-[var(--color-muted)]">
                    {item.stepCount} steps
                  </span>
                  {item.description && (
                    <span className="text-[var(--color-muted)]">
                      {item.description}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 4: Run to verify it passes (after Task 17 also lands)**

Run: `cd web && bun run test -- src/features/workflows`
Expected: PASS.

- [ ] **Step 5: Commit** (gate deferred to Task 17's combined gate)

```bash
git add web/src/features/workflows/index.tsx web/src/features/workflows/index.test.tsx
git commit -m "feat(web): WorkflowsArea list — browse the workflow registry (Phase 4)"
```

---

## Task 17: Workflow detail — step DAG + step panel + Run

**Files:**
- Create: `web/src/features/workflows/workflow-detail.tsx`
- Test: `web/src/features/workflows/workflow-detail.test.tsx`
- Modify: `web/src/app/router.tsx` (add `route('/workflows/$workflowId', WorkflowDetail)`)

**Interfaces:**
- Consumes: `WorkflowDetailDTO`/`StepDTO` (`@contracts`), `DagView`/`workflowGraph` (Task 13).
- Produces: `WorkflowDetail()` route component with a click-to-inspect step side panel and a Run launcher.

- [ ] **Step 1: Write the failing test**

`web/src/features/workflows/workflow-detail.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const detail = {
  id: 'fetch-then-summarize',
  steps: [
    { id: 'fetch', kind: 'tool', tool: 'fetch' },
    { id: 'summarize', kind: 'agent', agent: 'web_fetch' },
  ],
  edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
};

describe('WorkflowDetail', () => {
  it('renders the step DAG', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(detail)));
    renderAt('/workflows/fetch-then-summarize');
    await waitFor(() =>
      expect(screen.getByTestId('workflow-detail')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('dag-view')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows a step-detail panel when a node is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(detail)));
    renderAt('/workflows/fetch-then-summarize');
    fireEvent.click(await screen.findByTestId('dag-node-fetch'));
    await waitFor(() =>
      expect(screen.getByTestId('step-detail')).toBeInTheDocument(),
    );
    expect(screen.getByText(/tool: fetch/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('launches a run and navigates to /runs/$runId', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/run')
        ? jsonResponse({ runId: 'run-xyz' })
        : jsonResponse(detail),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/workflows/fetch-then-summarize');
    await waitFor(() =>
      expect(screen.getByTestId('workflow-run-button')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('workflow-run-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByTestId('workflow-run-button'));
    await waitFor(() =>
      expect(screen.getByTestId('run-detail')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- src/features/workflows/workflow-detail.test.tsx`
Expected: FAIL — module not found + no route.

- [ ] **Step 3: Create `web/src/features/workflows/workflow-detail.tsx`**

```tsx
import type { StepDTO, WorkflowDetailDTO } from '@contracts';
import { RunLaunchResponseSchema, WorkflowDetailDtoSchema } from '@contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { DagView } from '../../shared/dag/dag-view.tsx';
import { workflowGraph } from '../../shared/dag/workflow-graph.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

export function WorkflowDetail() {
  const { workflowId } = useParams({ from: '/workflows/$workflowId' });
  return <WorkflowDetailView key={workflowId} workflowId={workflowId} />;
}

function WorkflowDetailView({ workflowId }: { workflowId: string }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<WorkflowDetailDTO | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [launching, setLaunching] = useState(false);
  const [selectedStep, setSelectedStep] = useState<StepDTO | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    setSelectedStep(undefined);
    apiFetch(`/workflows/${workflowId}`, { schema: WorkflowDetailDtoSchema })
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'failed to load workflow',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  async function handleRun() {
    setLaunching(true);
    try {
      const { runId } = await apiFetch(`/workflows/${workflowId}/run`, {
        method: 'POST',
        body: { input },
        schema: RunLaunchResponseSchema,
      });
      navigate({ to: '/runs/$runId', params: { runId } });
    } catch (err: unknown) {
      setLaunching(false);
      setError(err instanceof Error ? err.message : 'failed to launch run');
    }
  }

  function handleNodeClick(nodeId: string) {
    setSelectedStep(detail?.steps.find((s) => s.id === nodeId));
  }

  return (
    <RegionErrorBoundary region="Workflow">
      <section
        data-testid="workflow-detail"
        className="flex h-full flex-col p-8"
      >
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Workflow {workflowId}
        </h1>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Workflow</strong>{' '}
            failed. {error}
          </div>
        )}

        {detail && (
          <>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {detail.steps.length} steps
            </p>

            <div className="mt-4 flex flex-1 gap-4">
              <div className="flex-1">
                <DagView
                  model={workflowGraph(detail)}
                  onNodeClick={handleNodeClick}
                />
              </div>
              {selectedStep && (
                <aside
                  data-testid="step-detail"
                  className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
                >
                  <div className="text-sm">{selectedStep.id}</div>
                  <div className="text-[var(--color-muted)]">
                    kind: {selectedStep.kind}
                  </div>
                  {selectedStep.agent && (
                    <div className="text-[var(--color-muted)]">
                      agent: {selectedStep.agent}
                    </div>
                  )}
                  {selectedStep.tool && (
                    <div className="text-[var(--color-muted)]">
                      tool: {selectedStep.tool}
                    </div>
                  )}
                </aside>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                data-testid="workflow-run-input"
                type="text"
                placeholder="Input…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
              />
              <Button
                data-testid="workflow-run-button"
                variant="accent"
                disabled={launching || !input.trim()}
                onClick={handleRun}
              >
                {launching ? 'Launching…' : 'Run'}
              </Button>
            </div>
          </>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 4: Add the route to `web/src/app/router.tsx`**

Add the import `import { WorkflowDetail } from '../features/workflows/workflow-detail.tsx';` and, in `routeTree`'s children, add `route('/workflows/$workflowId', WorkflowDetail),` directly after `route('/workflows', WorkflowsArea),`.

- [ ] **Step 5: Run to verify it passes (Task 16 + 17 combined)**

Run: `cd web && bun run test -- src/features/workflows`
Expected: PASS.

- [ ] **Step 6: Combined Task 16/17 gate + commit**

```bash
cd web && bun run typecheck && bun run test -- src/features/workflows
cd .. && bun run lint:file -- web/src/features/workflows/index.tsx web/src/features/workflows/index.test.tsx web/src/features/workflows/workflow-detail.tsx web/src/features/workflows/workflow-detail.test.tsx web/src/app/router.tsx
git add web/src/features/workflows/ web/src/app/router.tsx
git commit -m "feat(web): workflow detail — step DAG + step panel + Run (Phase 4)"
```

---

## Task 18: Run-detail live DAG overlay + Runs kind facet

**Files:**
- Create: `web/src/features/runs/run-dag.ts`, `web/src/features/runs/run-dag.test.ts`
- Modify: `web/src/features/runs/run-detail.tsx` (live overlay + Graph/Waterfall toggle), `web/src/features/runs/run-detail.test.tsx` (add `kind` to existing fixtures + new overlay tests)
- Modify: `web/src/features/runs/index.tsx` (kind facet), `web/src/features/runs/index.test.tsx` (facet test)
- Modify: `src/server/runs/list.ts` (the `kind` query param Task 4 added to the schema was never wired into the actual filter — without this the facet UI would send `?kind=crew` into a void)
- Test: `tests/server/runs-kind-filter.test.ts` (create — `bun:test`)

**Interfaces:**
- Consumes: `SpanDTO`/`SpanStatus` (`@contracts`), `DagView`/`workflowGraph` (Task 13), `crewGraph` (Task 15).
- Produces: `findRunGraphSource(spans): {kind:'workflow'|'crew'; id:string} | undefined`, `stepStatusOverlay(spans): Record<string, DagStatus>` (`run-dag.ts`); the Graph/Waterfall toggle on `RunDetail`; a `runs-kind-filter` facet on `RunsArea`; `handleRunList` honoring `query.kind`.

**Scope note (read before implementing — two discovered gaps, not just the one flagged in the brief):**
1. **The reliable per-step join is `workflow.step.id`.** Sequential crews compile to a workflow (`crew/compile.ts`), so their nested spans ARE `workflow.step` spans tagged with `workflow.step.id` — the join works. **Hierarchical crews have no such spans** (the manager delegates via `agent.delegation`, not `workflow.step`) — `stepStatusOverlay` will simply find no matches for them, which is a silent, correct degrade (every node stays at its default/pending look) rather than a crash. Flag for live-verify: confirm a hierarchical crew run shows an un-lit delegation star, not an error.
2. **The definition id is only knowable once the run's root span closes — which is LAST, not first.** `telemetry/spans.ts`'s `inSpan` calls `span.end()` in a `finally` after `fn()` resolves, and a `workflow.run`/`crew.run` root's `fn` awaits every nested step — so the root (and its `workflow.id`/`crew.id` attribute) is only written to `spans.jsonl`, and therefore only visible to `run-dto.ts`'s `runRootSummary`/`RunKind` derivation, after the *entire* run finishes. (This is the same mechanism already logged as Phase-3's F3 forward-item: an in-flight crew/workflow run's root is an "orphan" until it closes.) Gating the DAG overlay on `snapshot.kind === RunKind.Workflow` per a literal reading of D8 would therefore show **no graph at all until the run is already done** — the opposite of "watch it light up live". **Implementation choice made here:** derive the definition source by scanning the live-tailed `spans` array directly for a recognized root (`findRunGraphSource`, below) rather than gating on `snapshot.kind`. This resolves at the earliest possible instant (the moment the root closes, via the same SSE tail `useRunTrace` already ingests) and degrades identically to the literal approach when the root hasn't arrived yet (no graph, waterfall only). Per-step status still lights up progressively as `workflow.step` spans close, same as before. **Live-verify must confirm:** for a short-lived crew/workflow run, whether the Graph view becomes available at all before the run finishes, or only after.

**Amendment A (controller, post-review — makes live-watch ACTUALLY live; no-deferrals rule):** the telemetry-scan alone means the DAG appears only AFTER the run finishes (the root closes last) — even for long runs, because `findRunGraphSource` needs the root's `workflow.id`/`crew.id`, which lands last. That guts the headline feature. Fix with a **URL-param handoff** (zero server/telemetry change — the launch flow already holds the def):
  - **Router (`web/src/app/router.tsx`):** give the `/runs/$runId` route a typed `validateSearch` accepting optional `graphKind?: 'crew' | 'workflow'` + `graphId?: string`.
  - **Task 15 (crew) + Task 17 (workflow) Run buttons:** on launch success, navigate with those search params — e.g. `navigate({ to: '/runs/$runId', params: { runId }, search: { graphKind: 'crew', graphId: crewName } })`.
  - **This task (`RunDetailView`):** read `useSearch({ from: '/runs/$runId' })` FIRST — if `graphKind`/`graphId` are present, load that definition immediately (graph structure visible from t=0; per-step status still lights up progressively as `workflow.step` spans land). Fall back to `findRunGraphSource(spans)` only when the params are absent (a run opened cold from the Runs list). Add a `run-detail` test for the search-param path (stub the def fetch; assert `dag-view` renders without any root span present in the snapshot).
  - The `findRunGraphSource` telemetry scan stays as the cold-open fallback (and the real forward-fix — persisting def id as run metadata at launch — remains a documented Forward-item, now lower-priority since the primary launch→watch flow is covered).

- [ ] **Step 1: Write the failing `run-dag` tests**

`web/src/features/runs/run-dag.test.ts`:
```typescript
import type { SpanDTO } from '@contracts';
import { describe, expect, it } from 'vitest';
import { DagStatus } from '../../shared/dag/types.ts';
import { findRunGraphSource, stepStatusOverlay } from './run-dag.ts';

function span(p: Partial<SpanDTO> & { spanId: string; name: string }): SpanDTO {
  return {
    parentSpanId: null,
    offsetMs: 0,
    durationMs: 1,
    depth: 0,
    status: 'ok',
    degraded: false,
    attributes: {},
    events: [],
    ...p,
  };
}

describe('findRunGraphSource', () => {
  it('returns undefined when no recognized root span has closed yet', () => {
    expect(
      findRunGraphSource([span({ spanId: 'a', name: 'workflow.step' })]),
    ).toBeUndefined();
  });

  it('reads workflow.id off a closed workflow.run root', () => {
    const spans = [
      span({
        spanId: 'root',
        name: 'workflow.run',
        attributes: { 'workflow.id': 'fetch-then-summarize' },
      }),
    ];
    expect(findRunGraphSource(spans)).toEqual({
      kind: 'workflow',
      id: 'fetch-then-summarize',
    });
  });

  it('reads crew.id off a closed crew.run root', () => {
    const spans = [
      span({
        spanId: 'root',
        name: 'crew.run',
        attributes: { 'crew.id': 'research-crew' },
      }),
    ];
    expect(findRunGraphSource(spans)).toEqual({
      kind: 'crew',
      id: 'research-crew',
    });
  });
});

describe('stepStatusOverlay', () => {
  it('maps closed step spans to Done/Error by workflow.step.id; unstarted steps are omitted', () => {
    const spans = [
      span({
        spanId: 's1',
        name: 'workflow.step',
        status: 'ok',
        attributes: { 'workflow.step.id': 'fetch' },
      }),
      span({
        spanId: 's2',
        name: 'workflow.step',
        status: 'error',
        attributes: { 'workflow.step.id': 'summarize' },
      }),
    ];
    expect(stepStatusOverlay(spans)).toEqual({
      fetch: DagStatus.Done,
      summarize: DagStatus.Error,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- src/features/runs/run-dag.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/features/runs/run-dag.ts`**

```typescript
import type { SpanDTO } from '@contracts';
import { SpanStatus } from '@contracts';
import { DagStatus } from '../../shared/dag/types.ts';

const RUN_GRAPH_ROOTS: ReadonlySet<string> = new Set([
  'workflow.run',
  'crew.run',
]);

export type RunGraphSource = { kind: 'workflow' | 'crew'; id: string };

/**
 * Finds the workflow/crew definition a run's DAG overlay should render, by
 * scanning the live span trace for a recognized root and reading its
 * `workflow.id`/`crew.id` attribute. Scans `spans` directly (rather than
 * gating on `RunDTO.kind`) because the root span — and therefore `kind` — is
 * only written to disk once `span.end()` fires (`telemetry/spans.ts`
 * `inSpan`), and a `workflow.run`/`crew.run` root's wrapped function awaits
 * every nested step, so the root closes LAST. Scanning the live tail resolves
 * at the earliest possible moment: the instant the root closes.
 */
export function findRunGraphSource(
  spans: SpanDTO[],
): RunGraphSource | undefined {
  const root = spans.find((s) => RUN_GRAPH_ROOTS.has(s.name));
  if (!root) return undefined;
  const workflowId = root.attributes['workflow.id'];
  if (typeof workflowId === 'string') {
    return { kind: 'workflow', id: workflowId };
  }
  const crewId = root.attributes['crew.id'];
  if (typeof crewId === 'string') return { kind: 'crew', id: crewId };
  return undefined;
}

/**
 * Overlays live per-step status: a step whose `workflow.step.id`-tagged span
 * has closed is Done (ok) or Error. Spans are only recorded on completion, so
 * a step currently executing has no span yet — there is no reliable
 * "running" signal in this data (see the Task-18 scope note); nodes light up
 * progressively as their spans land rather than showing a synthetic
 * in-progress state. Hierarchical crews have no `workflow.step` spans at all
 * (delegation, not the DAG engine), so this returns `{}` for them — a silent,
 * correct degrade to the DagView default look, not an error.
 */
export function stepStatusOverlay(spans: SpanDTO[]): Record<string, DagStatus> {
  const byId: Record<string, DagStatus> = {};
  for (const span of spans) {
    const stepId = span.attributes['workflow.step.id'];
    if (typeof stepId !== 'string') continue;
    byId[stepId] =
      span.status === SpanStatus.Error ? DagStatus.Error : DagStatus.Done;
  }
  return byId;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && bun run test -- src/features/runs/run-dag.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `web/src/features/runs/run-detail.tsx`**

```tsx
import type { CrewDetailDTO, RunDTO, WorkflowDetailDTO } from '@contracts';
import {
  CrewDetailDtoSchema,
  RunDtoSchema,
  RunLifecycle,
  SpanDtoSchema,
  WorkflowDetailDtoSchema,
} from '@contracts';
import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { crewGraph } from '../crews/crew-graph.ts';
import { apiFetch } from '../../shared/contract/client.ts';
import { DagView } from '../../shared/dag/dag-view.tsx';
import type { DagModel } from '../../shared/dag/types.ts';
import { workflowGraph } from '../../shared/dag/workflow-graph.ts';
import { createSseTransport } from '../../shared/transport/sse-adapter.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { findRunGraphSource, stepStatusOverlay } from './run-dag.ts';
import { useRunTrace } from './use-run-trace.ts';
import { Waterfall } from './waterfall.tsx';

export function RunDetail() {
  const { runId } = useParams({ from: '/runs/$runId' });
  return <RunDetailView key={runId} runId={runId} />;
}

function RunDetailView({ runId }: { runId: string }) {
  const [snapshot, setSnapshot] = useState<RunDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [streamEnded, setStreamEnded] = useState(false);
  const [dagModel, setDagModel] = useState<DagModel | undefined>(undefined);
  const [view, setView] = useState<'waterfall' | 'graph'>('waterfall');
  const { spans, cursor, ingest } = useRunTrace(snapshot?.spans ?? []);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);
    setError(undefined);
    setStreamEnded(false);
    setDagModel(undefined);
    setView('waterfall');
    apiFetch(`/runs/${runId}`, { schema: RunDtoSchema })
      .then((result) => {
        if (!cancelled) setSnapshot(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load run');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!snapshot) return;
    for (const span of snapshot.spans) ingest(span);
  }, [snapshot, ingest]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cursor is read only as the stream's initial resume position (Phase 3); ingest is a stable useCallback ref
  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    const controller = new AbortController();

    async function tail() {
      const stream = createSseTransport().stream(
        runId,
        cursor,
        SpanDtoSchema,
        controller.signal,
      );
      try {
        for await (const span of stream) {
          if (cancelled) return;
          ingest(span, span.eventId);
        }
        if (!cancelled) setStreamEnded(true);
      } catch (err: unknown) {
        if (
          cancelled ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return;
        }
        setStreamEnded(true);
        console.error('[run-detail] live-tail stream failed', err);
      }
    }

    void tail();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId, snapshot]);

  // The DAG only becomes drawable once the run's root span (workflow.run /
  // crew.run — carrying workflow.id / crew.id) has closed and appears in the
  // live `spans` trace; see run-dag.ts's `findRunGraphSource` doc comment
  // for why this can't be gated on `snapshot.kind` instead. Re-runs on every
  // grown `spans` array (each live-tailed frame) so it resolves the instant
  // it can.
  useEffect(() => {
    const source = findRunGraphSource(spans);
    if (!source) {
      setDagModel(undefined);
      return;
    }
    let cancelled = false;
    const load =
      source.kind === 'workflow'
        ? apiFetch<WorkflowDetailDTO>(`/workflows/${source.id}`, {
            schema: WorkflowDetailDtoSchema,
          }).then(workflowGraph)
        : apiFetch<CrewDetailDTO>(`/crews/${source.id}`, {
            schema: CrewDetailDtoSchema,
          }).then(crewGraph);
    load
      .then((model) => {
        if (!cancelled) setDagModel(model);
      })
      .catch(() => {
        if (!cancelled) setDagModel(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [spans]);

  return (
    <RegionErrorBoundary region="Run">
      <section data-testid="run-detail" className="p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Run {runId}
        </h1>
        {snapshot?.lifecycle === RunLifecycle.Running && !streamEnded && (
          <p
            data-testid="run-busy"
            className="mt-1 text-xs text-[var(--color-accent)]"
          >
            Run in progress…
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Run</strong> failed to
            load. {error}
          </div>
        )}
        {!error && snapshot && (
          <div className="mt-4">
            {dagModel && (
              <div className="mb-2 flex gap-2">
                <Button
                  data-testid="view-toggle-waterfall"
                  variant={view === 'waterfall' ? 'accent' : 'default'}
                  onClick={() => setView('waterfall')}
                >
                  Waterfall
                </Button>
                <Button
                  data-testid="view-toggle-graph"
                  variant={view === 'graph' ? 'accent' : 'default'}
                  onClick={() => setView('graph')}
                >
                  Graph
                </Button>
              </div>
            )}
            {dagModel && view === 'graph' ? (
              <DagView
                model={dagModel}
                statusById={stepStatusOverlay(spans)}
              />
            ) : (
              <Waterfall spans={spans} />
            )}
          </div>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 6: Update `web/src/features/runs/run-detail.test.tsx`**

Add `kind: 'chat'` to the existing `dto` fixture object (required now that `RunDtoSchema.kind` is non-optional per Task 4 — every existing test that parses this fixture through `apiFetch` would otherwise fail schema validation). Then add `fireEvent` to the `@testing-library/react` import and append:

```tsx
const workflowDto = {
  ...dto,
  kind: 'workflow',
  roots: ['root'],
  spans: [
    {
      spanId: 'root',
      parentSpanId: null,
      name: 'workflow.run',
      offsetMs: 0,
      durationMs: 20,
      depth: 0,
      status: 'ok',
      degraded: false,
      attributes: { 'workflow.id': 'fetch-then-summarize' },
      events: [],
    },
    {
      spanId: 'step-fetch',
      parentSpanId: 'root',
      name: 'workflow.step',
      offsetMs: 1,
      durationMs: 5,
      depth: 1,
      status: 'ok',
      degraded: false,
      attributes: { 'workflow.step.id': 'fetch' },
      events: [],
    },
  ],
};

const workflowDef = {
  id: 'fetch-then-summarize',
  steps: [
    { id: 'fetch', kind: 'tool', tool: 'fetch' },
    { id: 'summarize', kind: 'agent', agent: 'web_fetch' },
  ],
  edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
};

it('offers a Graph/Waterfall toggle for a workflow run and overlays live step status', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/stream')) return emptyStream();
      if (url.includes('/workflows/')) return jsonResponse(workflowDef);
      return jsonResponse(workflowDto);
    }),
  );
  renderAt('/runs/run-1');
  await waitFor(() =>
    expect(screen.getByTestId('view-toggle-graph')).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByTestId('view-toggle-graph'));
  await waitFor(() => expect(screen.getByTestId('dag-view')).toBeInTheDocument());
  expect(screen.getByTestId('dag-node-fetch')).toBeInTheDocument();
  vi.unstubAllGlobals();
});

it('shows no Graph toggle for a plain chat run (no recognized crew/workflow root)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      String(input).includes('/stream') ? emptyStream() : jsonResponse(dto),
    ),
  );
  renderAt('/runs/run-1');
  await waitFor(() => expect(screen.getByTestId('bar-a')).toBeInTheDocument());
  expect(screen.queryByTestId('view-toggle-graph')).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 7: Run to verify the run-detail suite passes**

Run: `cd web && bun run test -- src/features/runs/run-detail.test.tsx`
Expected: PASS (all prior Phase-3 tests still pass with `kind` added to the fixture, plus the two new tests).

- [ ] **Step 8: Add the kind facet to `web/src/features/runs/index.tsx`**

Add `import { RunKind } from '@contracts';` to the top imports. Add above `OUTCOME_OPTIONS`:
```typescript
const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: RunKind.Chat, label: 'chat' },
  { value: RunKind.Crew, label: 'crew' },
  { value: RunKind.Workflow, label: 'workflow' },
  { value: RunKind.Agent, label: 'agent' },
];
```
Change `type Query` and `emptyQuery` to add `kind`:
```typescript
type Query = { search: string; outcome: string; degraded: string; kind: string };
const emptyQuery: Query = { search: '', outcome: '', degraded: '', kind: '' };
```
Add to `toQueryString` (after the `degraded` line):
```typescript
  if (query.kind) params.set('kind', query.kind);
```
Add a fourth `<select>` right after the `runs-degraded-filter` select, same styling:
```tsx
          <select
            data-testid="runs-kind-filter"
            value={query.kind}
            onChange={(e) => updateQuery({ kind: e.target.value })}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
```

- [ ] **Step 9: Update `web/src/features/runs/index.test.tsx`**

Add `kind: 'chat'` to the `page.items[0]` fixture (required now that `RunListItemDTO.kind` is non-optional). Append:
```tsx
it('re-fetches with a kind query string when the kind facet changes', async () => {
  const fetchMock = vi.fn(async () => jsonResponse(page));
  vi.stubGlobal('fetch', fetchMock);
  renderAt('/runs');
  await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());
  fireEvent.change(screen.getByTestId('runs-kind-filter'), {
    target: { value: 'crew' },
  });
  await waitFor(() => {
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(String(lastCall?.[0])).toContain('kind=crew');
  });
  vi.unstubAllGlobals();
});
```

- [ ] **Step 10: Run the web runs-feature suite**

Run: `cd web && bun run test -- src/features/runs`
Expected: PASS.

- [ ] **Step 11: Write the failing server-side kind-filter test**

`tests/server/runs-kind-filter.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunListResponse } from '../../src/contracts/requests.ts';
import { handleRunList } from '../../src/server/runs/list.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return {
    kind: 0,
    traceId: 't',
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
  root = await mkdtemp(join(tmpdir(), 'kindfilter-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, rootSpanName: string, startNano: number) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const spans = [
    span({
      name: rootSpanName,
      spanId: `${id}-a`,
      startUnixNano: startNano,
      attributes: { 'agent.outcome': 'answer' },
    }),
  ];
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

async function list(qs: string): Promise<RunListResponse> {
  const res = await handleRunList(new URLSearchParams(qs), { runsRoot: root });
  expect(res.status).toBe(200);
  return (await res.json()) as RunListResponse;
}

test('kind facet filters run summaries by their derived RunKind', async () => {
  await writeRun('crew-run', 'crew.run', 1_000_000_000);
  await writeRun('flow-run', 'workflow.run', 2_000_000_000);
  await writeRun('agent-run', 'agent.run', 3_000_000_000);

  expect((await list('kind=crew')).items.map((i) => i.id)).toEqual(['crew-run']);
  expect((await list('kind=workflow')).items.map((i) => i.id)).toEqual(['flow-run']);
  expect((await list('kind=agent')).items.map((i) => i.id)).toEqual(['agent-run']);
  expect((await list('')).total).toBe(3);
});

test('an unrecognized kind value is rejected with 400 (bad request), not 500', async () => {
  const res = await handleRunList(new URLSearchParams('kind=nonsense'), {
    runsRoot: root,
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 12: Run to verify it fails**

Run: `bun test tests/server/runs-kind-filter.test.ts`
Expected: FAIL — `kind` param is silently dropped by `RunListQuerySchema.parse` not being passed it, so no filtering happens (`kind=crew` returns all 3, not 1).

- [ ] **Step 13: Wire `kind` into `src/server/runs/list.ts`**

In the `query = RunListQuerySchema.parse({...})` call, add a line after `degraded`:
```typescript
      kind: params.get('kind') ?? undefined,
```
In the `filtered` chain, add a filter after the `degraded` one:
```typescript
    .filter((s) => (query.kind ? s.kind === query.kind : true))
```

- [ ] **Step 14: Run to verify it passes**

Run: `bun test tests/server/runs-kind-filter.test.ts tests/server/runs-list.test.ts`
Expected: PASS (both — the new facet plus the pre-existing filters unaffected).

- [ ] **Step 15: Full Task-18 gate + commit**

```bash
cd web && bun run typecheck && bun run test -- src/features/runs
cd .. && bun run typecheck && bun run lint:file -- web/src/features/runs/run-dag.ts web/src/features/runs/run-dag.test.ts web/src/features/runs/run-detail.tsx web/src/features/runs/run-detail.test.tsx web/src/features/runs/index.tsx web/src/features/runs/index.test.tsx src/server/runs/list.ts tests/server/runs-kind-filter.test.ts
bun test tests/server/
git add web/src/features/runs/ src/server/runs/list.ts tests/server/runs-kind-filter.test.ts
git commit -m "feat: run-detail live DAG overlay (D8) + Runs kind facet, wired end to end (Phase 4)"
```

---

## Task 19: ⌘K jump-to-crew / jump-to-workflow

**Files:**
- Modify: `web/src/app/commands.ts`, `web/src/app/commands.test.ts`

**Interfaces:**
- Produces: two new entries in `navCommands`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/app/commands.test.ts`:
```typescript
it('includes a jump-to-crew command targeting /crews', () => {
  const cmd = navCommands.find((c) => c.id === 'jump-to-crew');
  expect(cmd?.label).toMatch(/crew/i);
});

it('includes a jump-to-workflow command targeting /workflows', () => {
  const cmd = navCommands.find((c) => c.id === 'jump-to-workflow');
  expect(cmd?.label).toMatch(/workflow/i);
});
```
(Wrap these inside the existing `describe('navCommands', () => { ... })` block alongside the current `jump-to-run` test.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- src/app/commands.test.ts`
Expected: FAIL — `cmd` is `undefined` for both new ids.

- [ ] **Step 3: Add the two commands to `web/src/app/commands.ts`**

Append to the `navCommands` array, after the existing `jump-to-run` entry:
```typescript
  {
    id: 'jump-to-crew',
    label: 'Jump to Crews',
    run: (n) => n({ to: '/crews' }),
  },
  {
    id: 'jump-to-workflow',
    label: 'Jump to Workflows',
    run: (n) => n({ to: '/workflows' }),
  },
```
Update the file's leading comment (`// jump-to-run is wired below...`) to also note the two new jump commands, since it's now stale.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && bun run test -- src/app/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
cd web && bun run typecheck && bun run test -- src/app/commands.test.ts
cd .. && bun run lint:file -- web/src/app/commands.ts web/src/app/commands.test.ts
git add web/src/app/commands.ts web/src/app/commands.test.ts
git commit -m "feat(web): ⌘K jump-to-crew / jump-to-workflow commands (Phase 4)"
```

---

## Task 20: Docs — all four surfaces (the hard-line task)

No TDD here — the "test" is `bun run docs:check` and `bun run check` passing green. This is the task the pre-push slice-landing gate checks for.

**Files:**
- Modify: `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`

- [ ] **Step 1: `docs/architecture.md`**
  - Add a **§3e** sequence diagram alongside §3c/§3d ("Crews & Workflows — browse/run/watch, browser REST + fire-and-watch launch + reused SSE, Slice 30b Phase 4"): `GET /api/crews[/:name]` / `GET /api/workflows[/:id]` → list/detail handlers → `mapCrewToListItem`/`mapCrewToDetail`/`mapWorkflowToListItem`/`mapWorkflowToDetail`; `POST .../:id/run` → `handleCrewRun`/`handleWorkflowRun` → `createRun` (pre-created dir) → detached `runCrewTurn`/`runWorkflowTurn` (`launch-turns.ts`) → `{runId}` returned immediately → browser opens `GET /api/runs/:runId/stream` (Phase 3, reused verbatim) → live DAG overlay via `findRunGraphSource`/`stepStatusOverlay`.
  - Under §9 (Workflows/DAG) and §10 (Crews): add a short "Web browse/run (Slice 30b Phase 4)" note per section pointing at `crew-dto.ts`/`workflow-dto.ts` and the new `src/server/crews/`/`src/server/workflows/` handlers; note the D7a process-aware DAG lives web-side (`crew-graph.ts`), not in the DTO.
  - Under §7 (Observability): note `RunKind` (chat/agent/crew/workflow), `deriveRunKind` in `run-dto.ts`, and the Runs kind facet.
  - Add/extend a **"Crews & Workflows (web UI — Slice 30b Phase 4)"** section (mirroring the existing "Runs (web UI — Slice 30b Phase 3)" section) covering: the five layers (contracts → mappers → server BFF → web features → Runs-browser closure); the `@xyflow/react` `DagView` + `layeredPositions` (no dagre); `workflowGraph`/`crewGraph` (D7a process split); the fire-and-watch launch contract (pre-create dir, detached turn, `error.json` on throw); the run-detail live overlay and its two documented limitations (hierarchical crews have no `workflow.step` spans; the graph is only drawable once the root span closes — link to the Phase-3 F3 forward-item as the same underlying mechanism); deferred items (in-UI cancel, concurrent-launch cap, `setRunOutcome` for crew/workflow still `unknown`-fallback).
  - Update the module-map Mermaid (§2) with the new `src/server/crews/`, `src/server/workflows/`, `crew-dto.ts`, `workflow-dto.ts` nodes/edges, following the existing convention (check whether §2's top graph already omits web/server nodes per the Phase-3 audit finding — if so, stay consistent and cover Crews/Workflows only in prose + the new §3e diagram, not the top Mermaid).
  - Bump any test-count mentions once the real post-merge count is known (fill in at landing, not now).

- [ ] **Step 2: Root `README.md`**
  - Status blockquote: extend the Slice 30b line to state Phase 4 (crews/workflows browse+run+watch) has landed, alongside Phases 1/1b/2/3; keep Phases 5–8 as remaining.
  - Slice-status table: add/confirm the Slice 30b Phase 4 row (✅ Done) with a one-line capability summary + `docs/architecture.md` anchor.
  - Feature paragraph: add a short "Crews & Workflows (web UI — Slice 30b Phase 4)" paragraph (mirroring the existing Phase-3 Runs paragraph) — browse the registries, launch a run, watch the step/task DAG light up (with the hierarchical-crew and root-timing caveats stated honestly, not oversold).
  - "Next" line: move the pointer from "Slice 30b Phase 4" to "Slice 30b Phase 5" (Builders/Library — capability NOT flipped, Phases 5–8 remain).

- [ ] **Step 3: `docs/ROADMAP.md`**
  - Flip the Crews/Workflows browse+run+watch marker (previously 🟡/❌) to ✅ shipped, Slice 30b Phase 4, in the gap table, the phase table, and the recommended-sequence bullet — matching exactly how the Phase-3 Runs-browser marker was flipped (same tables, same row-editing pattern).

- [ ] **Step 4: `.superpowers/sdd/progress.md`**
  - Append a new `## SLICE 30b — PHASE 4 (Crews & Workflows: browse · run · watch · step-DAG)` section header, with links to this plan file and the spec/diagram, mirroring the existing `## SLICE 30b — PHASE 3` header format.
  - Per-task `- [ ]`/`- ✅` commit-reference lines are filled in DURING execution (one per task, controller-owned), not written now.

- [ ] **Step 5: Verify + commit**

```bash
bun run docs:check
bun run check
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(sdd): Slice 30b Phase 4 — architecture.md + README + ROADMAP + ledger (all four surfaces)"
```

> Reminder (not part of this commit): the docs-snapshot **Artifact** is the 4th living surface and is NOT a repo file — regenerate it at slice closeout per `reference-artifact-regen-mechanics` (deepen the web/server nodes for Crews/Workflows, add the DagView + launch-seam edges, bump the footer slice/test counts).

---

## Final gate & landing

1. **Whole-branch fan-out review** — 2–3 reviewers in parallel (Opus/Fable per the model-tiering rule), each over the full `main...HEAD` diff: **correctness** (fire-and-watch concurrency contract from Task 11, D7a graph derivation, the Task-18 root-timing/hierarchical-crew degrades), **security** (the new `/api/crews`, `/api/workflows` routes ride the existing perimeter/token guard — confirm no route bypasses it; `handleCrewDetail`/`handleWorkflowDetail` take registry-map keys, not filesystem paths — confirm no path ever reaches disk unconfined), **docs accuracy** (Task 20's four surfaces against the real diff, the same bar the Phase-3 Fable docs review applied). Consolidate findings into one fix wave.
2. **Live-verify vs real Ollama** (`bun run web`): browse both registries in the browser; launch `research-crew` and `fetch-then-summarize`; confirm the Graph toggle appears and step/task nodes light up as spans land (and confirm/refute the Task-18 root-timing gap in practice — does the graph appear before or only after the run finishes for a short crew/workflow?); confirm a hierarchical crew's delegation star renders but never lights up (documented degrade, not a bug); cross-check the spans against `bun run crew`/`bun run flow` CLI output for the same defs, per the Live-verify-before-merge standing gate.
3. **Partial-slice land** — merge `slice-30b-phase4-crews-workflows` `--no-ff` into `main` + push, with `README.md` + `docs/ROADMAP.md` + `.superpowers/sdd/progress.md` all in the same push (the pre-push slice-landing gate requires it alongside the `docs/architecture.md` change). Capability is **NOT** flipped — Phases 5–8 (Builders/Library, Sessions/persistence, voice) remain.
4. **Regenerate the docs-snapshot Artifact** (4th surface) — deepen the web/server nodes for Crews/Workflows, add the `DagView`/launch-seam edges, bump the footer's slice + test counts; validate with `node --check` + referential integrity per the established mechanics.
5. Refresh `resume-here.md` and delete the work branch once landed.

