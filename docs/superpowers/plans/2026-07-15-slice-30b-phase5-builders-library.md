# Slice 30b Phase 5 — Builders + Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web UI a seam onto the last four unexposed engines — the agent-builder, the crew/workflow-builder, the provisioning downloader, and (in the second half of this plan) the MCP mount registry and the memory/RAG store. Nothing new is built at the engine layer: every capability already has a CLI or programmatic entry point; this phase gives each one a thin BFF + web surface. Builders get a streaming guided wizard with mid-flow consent; Models get a live pull progress bar bridged through the existing Runs/spans machinery.

**Architecture:** Contracts (isomorphic DTOs/enums/requests) → server BFF routes (thin adapters reusing existing engine deps-factories) → web features (guided wizard, Library tabs). Two transport shapes: chat-style SSE + the Phase-2 consent channel for interactive flows (builders); fire-and-watch (mint a runId, detach, watch via the existing `/api/runs/:id/stream`) for consent-resolved-upfront flows (model pull).

**Tech Stack:** Bun + TypeScript (root, `bun:test`); Zod v4; React 19 + Vite + TanStack Router + Tailwind v4 + `@xyflow/react` (web, `vitest`).

**Spec:** `docs/superpowers/specs/2026-07-15-slice-30b-phase5-builders-library-design.md`. **Diagram:** `docs/diagrams/slice-30b-phase5-builders-library/phase5-builders-library.excalidraw`.

## Global Constraints

- **Package manager:** `bun`, never `npm`. **Root tests use `bun:test`** (`import { test, expect } from 'bun:test'`) — run with `bun test <path>`. **Web tests use vitest** (`import { describe, expect, it, vi } from 'vitest'`) — run with `cd web && bun run test`. Never put `from 'vitest'` in a root test or `from 'bun:test'` in a web test.
- **Per-task gate before commit:** `bun run typecheck` (clean) + `bun run lint:file -- <files>` (0 errors) + the task's focused tests. `bun test` does NOT typecheck and the pre-commit hook is docs:check only — run all three. Web tasks additionally run `cd web && bun run typecheck && bun run test`.
- **Code style:** `type` over `interface`; **`enum` over string-literal unions** for finite named sets (string enums only); discriminated unions stay `type`; early returns; small focused files; descriptive names. No `console.log` left behind.
- **Contracts are isomorphic:** `src/contracts/**` imports only `zod` (enums.ts imports nothing — not even other engine modules). Zod v4 idiom is `z.enum(SomeTsEnum)` (NOT `z.nativeEnum`). No `.strict()`. Every schema pairs `export const XSchema = z.object({...})` with `export type X = z.infer<typeof XSchema>`. A wire mirror of an engine enum (e.g. `VerifiedLevel`, `ReuseKind`, `RuntimeKind`, `McpTransportKind`, `McpAuthKind`) MUST ship with a parity test (`tests/contracts/<name>-parity.test.ts`, mirroring `tests/contracts/step-kind-parity.test.ts`/`degrade-kind-parity.test.ts` exactly) — a contract-owned enum with no engine analog (e.g. `BuilderKind`) does not need one.
- **Imports use explicit `.ts`/`.tsx` extensions** (e.g. `from './enums.ts'`). Web imports contracts via the `@contracts` alias.
- **Never hardcode model choices/budgets/limits** — compute live; env vars are fallback-only.
- **Docs hard line:** the final docs increment (6, not part of this file) updates all four surfaces (architecture.md, README, ROADMAP, ledger) + regenerates the Artifact. Do not `DOCS_OK=1` bypass mid-phase.
- **Model tiering:** Sonnet floor for all mechanical/foundation tasks (Increment 1). **Opus / ultracode-Workflow (adversarial-verify)** for Task 11 (the builder streaming+confirm round-trip, spec §7.1) and Task 15 (the pull→spans bridge, spec §7.2) — both are explicitly flagged "the hard part" by the design. Fable reserved for the whole-branch final review (Increment 6, not part of this file).
- **Branch:** `slice-30b-phase5-builders-library` (cut off `main` @ `e209efa`). Commit per task, conventional subject `type(scope): summary`.
- **Do not commit as the plan author** — task commits below are written as instructions for the executing agent/session, not run by the planning pass.

---

## Task 1: Contract enums — VerifiedLevel/ReuseKind mirrors + RunKind gains Build/Pull

**Files:**
- Modify: `src/contracts/enums.ts` (append two mirrored enums; extend `RunKind`)
- Test: `tests/contracts/verified-level-parity.test.ts` (create), `tests/contracts/reuse-kind-parity.test.ts` (create), `tests/contracts/run-kind-build-pull.test.ts` (create)

**Interfaces:**
- Consumes: engine enums `VerifiedLevel`, `ReuseKind` (`src/verified-build/types.ts:1-11`).
- Produces: `VerifiedLevel`, `ReuseKind` exported from `src/contracts/enums.ts` (re-exported via the `index.ts` wildcard barrel); `RunKind.Build = 'build'`, `RunKind.Pull = 'pull'` added to the existing `RunKind` enum.

- [ ] **Step 1: Write the failing tests**

`tests/contracts/verified-level-parity.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { VerifiedLevel as ContractVerifiedLevel } from '../../src/contracts/enums.ts';
import { VerifiedLevel as EngineVerifiedLevel } from '../../src/verified-build/types.ts';

test('contract VerifiedLevel values stay isomorphic with verified-build', () => {
  expect(Object.values(ContractVerifiedLevel).sort()).toEqual(
    Object.values(EngineVerifiedLevel).sort(),
  );
});
```

`tests/contracts/reuse-kind-parity.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { ReuseKind as ContractReuseKind } from '../../src/contracts/enums.ts';
import { ReuseKind as EngineReuseKind } from '../../src/verified-build/types.ts';

test('contract ReuseKind values stay isomorphic with verified-build', () => {
  expect(Object.values(ContractReuseKind).sort()).toEqual(
    Object.values(EngineReuseKind).sort(),
  );
});
```

`tests/contracts/run-kind-build-pull.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';

test('RunKind gains Build/Pull members (Slice 30b Phase 5)', () => {
  expect(RunKind.Build).toBe('build');
  expect(RunKind.Pull).toBe('pull');
  expect(Object.values(RunKind).sort()).toEqual(
    ['agent', 'build', 'chat', 'crew', 'pull', 'workflow'].sort(),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/contracts/verified-level-parity.test.ts tests/contracts/reuse-kind-parity.test.ts tests/contracts/run-kind-build-pull.test.ts`
Expected: FAIL — `VerifiedLevel`/`ReuseKind` not exported from contracts; `RunKind.Build`/`RunKind.Pull` undefined.

- [ ] **Step 3: Append the enums to `src/contracts/enums.ts`**

Append after the existing `RunKind` enum (which currently ends `Workflow = 'workflow',\n}`):
```typescript
/** Wire mirror of `src/verified-build/types.ts` VerifiedLevel (isomorphic
 *  rule — no engine import). `tests/contracts/verified-level-parity.test.ts`
 *  guards value parity. Slice 30b Phase 5. */
export enum VerifiedLevel {
  Behaves = 'behaves',
  Runs = 'runs',
  Unverified = 'unverified',
}

/** Wire mirror of `src/verified-build/types.ts` ReuseKind (isomorphic rule).
 *  Also doubles as the `data-confirm` event's `kind` value for a reuse-offer
 *  ask (D4). `tests/contracts/reuse-kind-parity.test.ts` guards value parity.
 *  Slice 30b Phase 5. */
export enum ReuseKind {
  Reuse = 'reuse',
  Offer = 'offer',
  Generate = 'generate',
}
```
Then edit the existing `RunKind` enum in place to add two members:
```typescript
/** What a run IS (chat/agent/crew/workflow/build/pull), derived by the mapper
 *  from the run's root span name. Distinct from RunOrigin (HOW a run was
 *  triggered). Build/Pull added Slice 30b Phase 5 — contract-owned, no engine
 *  mirror needed (see `deriveRunKind`, Task 2). */
export enum RunKind {
  Chat = 'chat',
  Agent = 'agent',
  Crew = 'crew',
  Workflow = 'workflow',
  Build = 'build',
  Pull = 'pull',
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/contracts/verified-level-parity.test.ts tests/contracts/reuse-kind-parity.test.ts tests/contracts/run-kind-build-pull.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/enums.ts tests/contracts/verified-level-parity.test.ts tests/contracts/reuse-kind-parity.test.ts tests/contracts/run-kind-build-pull.test.ts
git add src/contracts/enums.ts tests/contracts/verified-level-parity.test.ts tests/contracts/reuse-kind-parity.test.ts tests/contracts/run-kind-build-pull.test.ts
git commit -m "feat(contracts): mirror VerifiedLevel/ReuseKind + RunKind.Build/Pull (Phase 5)"
```

---

## Task 2: Run-kind derivation — RUN_ROOT_NAMES/deriveRunKind gain Build/Pull

**Files:**
- Modify: `src/run/run-dto.ts` (extend `RUN_ROOT_NAMES`; extend `deriveRunKind`)
- Modify: `tests/run/run-kind.test.ts` (add build/pull cases to the Phase-4 file)

**Interfaces:**
- Consumes: `RunKind.Build`/`RunKind.Pull` (Task 1).
- Produces: `deriveRunKind` recognizes `'agent.build'`/`'crew.build'` → `RunKind.Build`, `'model.pull'` → `RunKind.Pull`; `RUN_ROOT_NAMES` recognizes all three as run anchors (required so `runRootSummary` — and thus `lifecycle`/`durationMs`/`outcome` — resolves correctly for a build/pull run instead of reading perpetually `Running`, per spec D9/§7.2).

- [ ] **Step 1: Write the failing test additions**

Modify `tests/run/run-kind.test.ts` to its full new content:
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

test('deriveRunKind maps build/pull roots to RunKind.Build/RunKind.Pull (Phase 5)', () => {
  expect(deriveRunKind(['agent.build'])).toBe(RunKind.Build);
  expect(deriveRunKind(['crew.build'])).toBe(RunKind.Build);
  expect(deriveRunKind(['model.pull'])).toBe(RunKind.Pull);
});
```

- [ ] **Step 2: Run test to verify the new case fails**

Run: `bun test tests/run/run-kind.test.ts`
Expected: FAIL on the new test — `deriveRunKind(['agent.build'])` still returns `RunKind.Chat`.

- [ ] **Step 3: Extend `RUN_ROOT_NAMES` and `deriveRunKind` in `src/run/run-dto.ts`**

Read the file first (it already has both). Replace the `RUN_ROOT_NAMES` set and `deriveRunKind` function with:
```typescript
/** Root span names that anchor a run: an agent/crew/workflow run, an
 *  agent/crew build (Phase 5), or a model pull (Phase 5). Recognizing all
 *  six is what keeps a finished build/pull from reading as perpetually
 *  in-flight (spec §7.2). */
const RUN_ROOT_NAMES: ReadonlySet<string> = new Set([
  'agent.run',
  'crew.run',
  'workflow.run',
  'agent.build',
  'crew.build',
  'model.pull',
]);

/** Derive what a run IS from the names of its root spans. A crew/workflow
 *  root wins over an agent root (a crew nests agent runs); a build/pull root
 *  is checked next (these never co-occur with a run root in the same
 *  process); everything else (chat's ui.stream, or no recognized root) is
 *  Chat. */
export function deriveRunKind(rootSpanNames: string[]): RunKind {
  if (rootSpanNames.includes('crew.run')) return RunKind.Crew;
  if (rootSpanNames.includes('workflow.run')) return RunKind.Workflow;
  if (rootSpanNames.includes('agent.run')) return RunKind.Agent;
  if (rootSpanNames.includes('crew.build')) return RunKind.Build;
  if (rootSpanNames.includes('agent.build')) return RunKind.Build;
  if (rootSpanNames.includes('model.pull')) return RunKind.Pull;
  return RunKind.Chat;
}
```

- [ ] **Step 4: Run the new test + the existing run-dto/server-runs suite**

Run: `bun test tests/run/run-kind.test.ts && bun test tests/run tests/server/runs-list.test.ts tests/server/runs-detail.test.ts tests/server/runs-kind-filter.test.ts`
Expected: all PASS — widening the recognized-root set only adds cases, it cannot change behavior for any existing `agent.run`/`crew.run`/`workflow.run`/no-root fixture.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/run/run-dto.ts tests/run/run-kind.test.ts
git add src/run/run-dto.ts tests/run/run-kind.test.ts
git commit -m "feat(run): derive RunKind.Build/Pull from agent.build/crew.build/model.pull roots (Phase 5)"
```

---

## Task 3: Proposal + BuildResult DTOs (AgentProposalDTO/CrewProposalDTO/WorkflowProposalDTO/BuildResultDTO)

**Files:**
- Modify: `src/contracts/dto.ts` (append; extend the `./enums.ts` import with `VerifiedLevel`)
- Test: `tests/contracts/proposal-dto.test.ts` (create)

**Interfaces:**
- Consumes: `StepKind`, `CrewProcess`, `VerifiedLevel` (contracts enums).
- Produces: `SuggestedServerDtoSchema`/`SuggestedServerDTO`, `ModelReqDtoSchema`/`ModelReqDTO`, `AgentProposalDtoSchema`/`AgentProposalDTO`, `CrewProposalMemberDtoSchema`/`CrewProposalMemberDTO`, `CrewProposalTaskDtoSchema`/`CrewProposalTaskDTO`, `CrewProposalDtoSchema`/`CrewProposalDTO`, `WorkflowProposalStepDtoSchema`/`WorkflowProposalStepDTO`, `WorkflowProposalDtoSchema`/`WorkflowProposalDTO`, `BuildResultDtoSchema`/`BuildResultDTO`.

**Design note (near-identity, D5):** `AgentProposal` (`src/agent-builder/types.ts:11-18`) is re-declared field-for-field (contracts cannot import `src/agent-builder`). `CrewProposalDTO`/`WorkflowProposalDTO` mirror `CrewIR`/`WorkflowIR` (`src/crew-builder/ir.ts`) but drop the `InputDescriptor`/`PredicateDescriptor` execution-only closures-as-data (not needed for display — the same simplification `StepDtoSchema` already makes for the committed `WorkflowDef`, Phase 4). `dependsOn` is kept explicit on `WorkflowProposalStepDTO` (unlike the committed `StepDTO`, which derives edges via `effectiveDeps` server-side) because a proposal has no compiled `effectiveDeps` yet — it IS the IR's own `dependsOn`.

- [ ] **Step 1: Write the failing test**

`tests/contracts/proposal-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { CrewProcess, StepKind } from '../../src/contracts/enums.ts';
import {
  AgentProposalDtoSchema,
  BuildResultDtoSchema,
  CrewProposalDtoSchema,
  WorkflowProposalDtoSchema,
} from '../../src/contracts/dto.ts';

test('BuildResultDtoSchema accepts a written agent result carrying its full proposal', () => {
  const r = BuildResultDtoSchema.parse({
    kind: 'written',
    name: 'stock_quotes',
    files: ['agents/stock_quotes.ts'],
    proposal: {
      name: 'stock_quotes',
      description: 'Fetches live stock quotes',
      systemPrompt: 'You fetch quotes.',
      modelReq: { role: 'quote fetcher', requires: ['tools'], prefer: 'largest-that-fits' },
      suggestedServers: [{ packName: 'finance', scopeToAgent: 'stock_quotes' }],
      rationale: 'Needed for the finance workflow.',
    },
  });
  expect(r.proposal && 'suggestedServers' in r.proposal ? r.proposal.suggestedServers : []).toHaveLength(1);
});

test('BuildResultDtoSchema accepts every other kind with no `proposal` field', () => {
  expect(BuildResultDtoSchema.parse({ kind: 'declined' }).proposal).toBeUndefined();
});

test('AgentProposalDtoSchema accepts a full proposal', () => {
  const p = AgentProposalDtoSchema.parse({
    name: 'stock_quotes',
    description: 'Fetches live stock quotes',
    systemPrompt: 'You fetch quotes.',
    modelReq: { role: 'quote fetcher', requires: ['tools'], prefer: 'largest-that-fits' },
    suggestedServers: [{ packName: 'finance', scopeToAgent: 'stock_quotes' }],
    rationale: 'Needed for the finance workflow.',
  });
  expect(p.name).toBe('stock_quotes');
  expect(p.suggestedServers[0]?.packName).toBe('finance');
});

test('CrewProposalDtoSchema accepts members + tasks with no tools/ZodType', () => {
  const p = CrewProposalDtoSchema.parse({
    id: 'research-crew',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'researcher',
        role: 'Analyst',
        goal: 'gather',
        backstory: 'meticulous',
        requires: ['tools'],
      },
    ],
    tasks: [
      {
        id: 'gather',
        description: 'research',
        expectedOutput: 'facts',
        member: 'researcher',
      },
    ],
  });
  expect(p.members[0]?.name).toBe('researcher');
});

test('WorkflowProposalDtoSchema carries steps with explicit dependsOn', () => {
  const p = WorkflowProposalDtoSchema.parse({
    id: 'fetch-then-summarize',
    steps: [
      { id: 'fetch', kind: StepKind.Tool, tool: 'fetch' },
      { id: 'summarize', kind: StepKind.Agent, agent: 'web_fetch', dependsOn: ['fetch'] },
    ],
  });
  expect(p.steps[1]?.dependsOn).toEqual(['fetch']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/proposal-dto.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Append the DTOs to `src/contracts/dto.ts`**

Add `VerifiedLevel` to the existing `./enums.ts` import (it already imports `StepKind`/`CrewProcess`), then append:
```typescript
/** A curated-pack MCP server a proposed agent needs, scoped to that agent.
 *  Mirrors `SuggestedServer` (`src/agent-builder/types.ts:8`). */
export const SuggestedServerDtoSchema = z.object({
  packName: z.string(),
  scopeToAgent: z.string(),
});
export type SuggestedServerDTO = z.infer<typeof SuggestedServerDtoSchema>;

/** Mirrors `ModelRequirement` (`src/core/types.ts:42-49`) — `requires`/
 *  `prefer` kept as plain strings on the wire (Capability/PreferPolicy
 *  values; the browser only displays them), matching `CrewMemberDtoSchema`'s
 *  precedent (Phase 4). */
export const ModelReqDtoSchema = z.object({
  role: z.string(),
  requires: z.array(z.string()),
  prefer: z.string(),
  allowUncensored: z.boolean().optional(),
});
export type ModelReqDTO = z.infer<typeof ModelReqDtoSchema>;

/** Near-identity re-export of `AgentProposal` (`src/agent-builder/types.ts:11-18`,
 *  D5) — no closures, no ToolSet, no ZodType in the engine type either. */
export const AgentProposalDtoSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  modelReq: ModelReqDtoSchema,
  suggestedServers: z.array(SuggestedServerDtoSchema),
  rationale: z.string(),
});
export type AgentProposalDTO = z.infer<typeof AgentProposalDtoSchema>;

/** Mirrors `CrewMemberIR` (`src/crew-builder/ir.ts:86-95`) — the PROPOSAL
 *  shape (pre-build), distinct from `CrewMemberDtoSchema` (Phase 4, which
 *  projects the already-COMMITTED CrewDef member and has no `prefer` field
 *  pre-build). */
export const CrewProposalMemberDtoSchema = z.object({
  name: z.string(),
  agentRef: z.string().optional(),
  role: z.string(),
  goal: z.string(),
  backstory: z.string(),
  requires: z.array(z.string()),
  tools: z.array(z.string()).optional(),
});
export type CrewProposalMemberDTO = z.infer<typeof CrewProposalMemberDtoSchema>;

/** Mirrors `CrewTaskIR` (`src/crew-builder/ir.ts:97-105`). */
export const CrewProposalTaskDtoSchema = z.object({
  id: z.string(),
  description: z.string(),
  expectedOutput: z.string(),
  member: z.string(),
  dependsOn: z.array(z.string()).optional(),
  verify: z.boolean().optional(),
});
export type CrewProposalTaskDTO = z.infer<typeof CrewProposalTaskDtoSchema>;

/** Mirrors `CrewIR` (`src/crew-builder/ir.ts:107-114`, D5) — a staged,
 *  not-yet-committed crew proposal. */
export const CrewProposalDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  process: z.enum(CrewProcess),
  members: z.array(CrewProposalMemberDtoSchema),
  tasks: z.array(CrewProposalTaskDtoSchema),
});
export type CrewProposalDTO = z.infer<typeof CrewProposalDtoSchema>;

/** Mirrors `WorkflowStepIR` (`src/crew-builder/ir.ts:28-77`) — drops the
 *  `input`/`predicate`/`over.ref`-as-closure-descriptor detail (execution-only,
 *  not needed for display; `over` keeps just the mapOver source-step ref as a
 *  plain string for a map step's sublabel). `dependsOn` is explicit (see the
 *  task-level design note above). */
export const WorkflowProposalStepDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(StepKind),
  agent: z.string().optional(),
  tool: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  verify: z.boolean().optional(),
  branch: z.object({ whenTrue: z.string(), whenFalse: z.string() }).optional(),
  over: z.string().optional(),
});
export type WorkflowProposalStepDTO = z.infer<typeof WorkflowProposalStepDtoSchema>;

/** Mirrors `WorkflowIR` (`src/crew-builder/ir.ts:79-84`, D5). */
export const WorkflowProposalDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  steps: z.array(WorkflowProposalStepDtoSchema),
});
export type WorkflowProposalDTO = z.infer<typeof WorkflowProposalDtoSchema>;

/** A flattened tagged union mirroring `BuildResult`/`CrewBuildResult`
 *  (`src/agent-builder/types.ts:22-38`, `src/crew-builder/types.ts:13-31`) —
 *  `kind` discriminates; fields irrelevant to a given `kind` are simply
 *  absent (not a discriminated union on the wire, since both source types
 *  already agree on `kind`'s string values and this keeps the schema a
 *  single flat object the terminal SSE text part can `JSON.stringify`/parse
 *  without a second discriminated layer). */
export const BuildResultDtoSchema = z.object({
  kind: z.enum([
    'written',
    'declined',
    'invalid',
    'abandoned',
    'reused',
    'failed-verification',
  ]),
  name: z.string().optional(),
  files: z.array(z.string()).optional(),
  level: z.enum(VerifiedLevel).optional(),
  issues: z
    .array(z.object({ field: z.string(), problem: z.string() }))
    .optional(),
  reason: z.string().optional(),
  similarity: z.number().optional(),
  stage: z.string().optional(),
  detail: z.string().optional(),
  /** Present only for a `written` AGENT build (`BuildResult.written` carries
   *  the full `AgentProposal` back to the caller — `src/agent-builder/types.ts:22-28`;
   *  `CrewBuildResult.written` does NOT carry the IR, an existing engine-side
   *  gap, so this stays absent for a written crew/workflow — see Task 10's
   *  `toCrewBuildResultDto`). Lets the wizard (Task 14) render the D6
   *  post-write proposal DagView without a second round-trip. */
  proposal: z
    .union([AgentProposalDtoSchema, CrewProposalDtoSchema, WorkflowProposalDtoSchema])
    .optional(),
});
export type BuildResultDTO = z.infer<typeof BuildResultDtoSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/proposal-dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts tests/contracts/proposal-dto.test.ts
git add src/contracts/dto.ts tests/contracts/proposal-dto.test.ts
git commit -m "feat(contracts): AgentProposalDTO/CrewProposalDTO/WorkflowProposalDTO + BuildResultDTO (Phase 5)"
```

---

## Task 4: Library enum mirrors — RuntimeKind/McpTransportKind/McpAuthKind + parity tests

**Files:**
- Modify: `src/contracts/enums.ts` (append three mirrored enums)
- Test: `tests/contracts/runtime-kind-parity.test.ts`, `tests/contracts/mcp-transport-kind-parity.test.ts`, `tests/contracts/mcp-auth-kind-parity.test.ts` (create)

**Interfaces:**
- Consumes: engine enums `RuntimeKind` (`src/core/types.ts:10-15`), `McpTransportKind`/`McpAuthKind` (`src/mcp/types.ts:3-18`).
- Produces: `RuntimeKind`, `McpTransportKind`, `McpAuthKind` exported from `src/contracts/enums.ts`. Needed by `ModelInventoryDTO`/`McpServerDTO` (Task 5) — neither DTO can otherwise express these fields without breaking the isomorphic rule.

- [ ] **Step 1: Write the failing parity tests**

`tests/contracts/runtime-kind-parity.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { RuntimeKind as ContractRuntimeKind } from '../../src/contracts/enums.ts';
import { RuntimeKind as CoreRuntimeKind } from '../../src/core/types.ts';

test('contract RuntimeKind values stay isomorphic with core', () => {
  expect(Object.values(ContractRuntimeKind).sort()).toEqual(
    Object.values(CoreRuntimeKind).sort(),
  );
});
```

`tests/contracts/mcp-transport-kind-parity.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { McpTransportKind as ContractMcpTransportKind } from '../../src/contracts/enums.ts';
import { McpTransportKind as EngineMcpTransportKind } from '../../src/mcp/types.ts';

test('contract McpTransportKind values stay isomorphic with the mcp engine', () => {
  expect(Object.values(ContractMcpTransportKind).sort()).toEqual(
    Object.values(EngineMcpTransportKind).sort(),
  );
});
```

`tests/contracts/mcp-auth-kind-parity.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { McpAuthKind as ContractMcpAuthKind } from '../../src/contracts/enums.ts';
import { McpAuthKind as EngineMcpAuthKind } from '../../src/mcp/types.ts';

test('contract McpAuthKind values stay isomorphic with the mcp engine', () => {
  expect(Object.values(ContractMcpAuthKind).sort()).toEqual(
    Object.values(EngineMcpAuthKind).sort(),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/contracts/runtime-kind-parity.test.ts tests/contracts/mcp-transport-kind-parity.test.ts tests/contracts/mcp-auth-kind-parity.test.ts`
Expected: FAIL — none of the three enums are exported from contracts yet.

- [ ] **Step 3: Append the three enums to `src/contracts/enums.ts`**

```typescript
/** Wire mirror of `src/core/types.ts` RuntimeKind (isomorphic rule — no core
 *  import). `tests/contracts/runtime-kind-parity.test.ts` guards value
 *  parity. Slice 30b Phase 5 (Models tab / ModelInventoryDTO). */
export enum RuntimeKind {
  Ollama = 'Ollama',
  MlxServer = 'MlxServer',
  LmStudio = 'LmStudio',
  LlamaCpp = 'LlamaCpp',
}

/** Wire mirror of `src/mcp/types.ts` McpTransportKind (isomorphic rule).
 *  `tests/contracts/mcp-transport-kind-parity.test.ts` guards value parity.
 *  Slice 30b Phase 5 (McpServerDTO). */
export enum McpTransportKind {
  Stdio = 'stdio',
  Http = 'http',
}

/** Wire mirror of `src/mcp/types.ts` McpAuthKind (isomorphic rule).
 *  `tests/contracts/mcp-auth-kind-parity.test.ts` guards value parity.
 *  Slice 30b Phase 5 (McpServerDTO). */
export enum McpAuthKind {
  Static = 'static',
  OAuth = 'oauth',
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/contracts/runtime-kind-parity.test.ts tests/contracts/mcp-transport-kind-parity.test.ts tests/contracts/mcp-auth-kind-parity.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/enums.ts tests/contracts/runtime-kind-parity.test.ts tests/contracts/mcp-transport-kind-parity.test.ts tests/contracts/mcp-auth-kind-parity.test.ts
git add src/contracts/enums.ts tests/contracts/runtime-kind-parity.test.ts tests/contracts/mcp-transport-kind-parity.test.ts tests/contracts/mcp-auth-kind-parity.test.ts
git commit -m "feat(contracts): mirror RuntimeKind/McpTransportKind/McpAuthKind (Phase 5)"
```

---

## Task 5: Library DTOs — ModelInventoryDTO/MemorySpaceDTO/RetrievalResultDTO/McpServerDTO

**Files:**
- Modify: `src/contracts/dto.ts` (append; extend the `./enums.ts` import with `RuntimeKind`, `McpTransportKind`, `McpAuthKind`)
- Test: `tests/contracts/library-dto.test.ts` (create)

**Interfaces:**
- Consumes: `RuntimeKind`, `McpTransportKind`, `McpAuthKind` (Task 4).
- Produces: `ModelInventoryDtoSchema`/`ModelInventoryDTO`, `MemorySpaceDtoSchema`/`MemorySpaceDTO`, `RetrievalResultDtoSchema`/`RetrievalResultDTO`, `McpServerDtoSchema`/`McpServerDTO`.

- [ ] **Step 1: Write the failing test**

`tests/contracts/library-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { McpAuthKind, McpTransportKind, RuntimeKind } from '../../src/contracts/enums.ts';
import {
  McpServerDtoSchema,
  MemorySpaceDtoSchema,
  ModelInventoryDtoSchema,
  RetrievalResultDtoSchema,
} from '../../src/contracts/dto.ts';

test('ModelInventoryDtoSchema accepts an installed and a pullable row', () => {
  const installed = ModelInventoryDtoSchema.parse({
    runtime: RuntimeKind.Ollama,
    model: 'qwen3.5:9b',
    installed: true,
    fits: true,
  });
  expect(installed.installed).toBe(true);
  const pullable = ModelInventoryDtoSchema.parse({
    runtime: RuntimeKind.MlxServer,
    model: 'mlx-community/Qwen3.5-30B',
    installed: false,
    fits: false,
    sizeBytes: 20_000_000_000,
    shortfallBytes: 4_000_000_000,
  });
  expect(pullable.fits).toBe(false);
});

test('MemorySpaceDtoSchema + RetrievalResultDtoSchema accept minimal shapes', () => {
  expect(MemorySpaceDtoSchema.parse({ name: 'default', chunkCount: 12 }).chunkCount).toBe(12);
  const r = RetrievalResultDtoSchema.parse({
    id: 'doc.md#3',
    source: 'doc.md',
    text: 'chunk text',
    score: 0.82,
  });
  expect(r.score).toBeCloseTo(0.82);
});

test('McpServerDtoSchema accepts a mounted stdio server', () => {
  const s = McpServerDtoSchema.parse({
    name: 'filesystem',
    kind: McpTransportKind.Stdio,
    authKind: McpAuthKind.Static,
    status: 'mounted',
  });
  expect(s.status).toBe('mounted');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/library-dto.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Append the DTOs to `src/contracts/dto.ts`**

Add `RuntimeKind`, `McpTransportKind`, `McpAuthKind` to the existing `./enums.ts` import, then append:
```typescript
/** Projected model-catalog row — installed (from `buildRegistry()`) or
 *  pullable (from the cached discovery catalog, fit-ranked). No `provider`
 *  field: which `DownloadProvider` fetches a pullable model's weights is a
 *  server-internal resolution detail (`src/server/models/pull.ts`, Task 17),
 *  never sent to the client. */
export const ModelInventoryDtoSchema = z.object({
  runtime: z.enum(RuntimeKind),
  model: z.string(),
  installed: z.boolean(),
  fits: z.boolean(),
  sizeBytes: z.number().optional(),
  shortfallBytes: z.number().optional(),
});
export type ModelInventoryDTO = z.infer<typeof ModelInventoryDtoSchema>;

/** Projected memory space, from `MemoryStore.stats(): Record<string, number>`
 *  (`src/memory/store.ts:178-183`). */
export const MemorySpaceDtoSchema = z.object({
  name: z.string(),
  chunkCount: z.number(),
});
export type MemorySpaceDTO = z.infer<typeof MemorySpaceDtoSchema>;

/** Projected recall hit. Mirrors `RetrievalResult` (`src/memory/types.ts:29-35`)
 *  minus `namespace` — deliberately dropped: the Memory tab's recall box is
 *  space-scoped already (the request's `space` param), so per-hit namespace
 *  is redundant detail the wire doesn't need. */
export const RetrievalResultDtoSchema = z.object({
  id: z.string(),
  source: z.string(),
  text: z.string(),
  score: z.number(),
});
export type RetrievalResultDTO = z.infer<typeof RetrievalResultDtoSchema>;

/** Projected MCP server entry, joining `McpConfig.entries`
 *  (`src/mcp/types.ts:72-76`) with the server-side mount-status snapshot
 *  (`src/server/mcp/`, a later increment). `status: 'dormant'` mirrors
 *  `McpConfig.dormant` (missing required env vars — never attempted). */
export const McpServerDtoSchema = z.object({
  name: z.string(),
  kind: z.enum(McpTransportKind),
  agents: z.array(z.string()).optional(),
  authKind: z.enum(McpAuthKind),
  status: z.enum(['mounted', 'skipped', 'dormant']),
  reason: z.string().optional(),
});
export type McpServerDTO = z.infer<typeof McpServerDtoSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/library-dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts tests/contracts/library-dto.test.ts
git add src/contracts/dto.ts tests/contracts/library-dto.test.ts
git commit -m "feat(contracts): ModelInventoryDTO/MemorySpaceDTO/RetrievalResultDTO/McpServerDTO (Phase 5)"
```

---

## Task 6: Request + response schemas — builders/models/memory/mcp

**Files:**
- Modify: `src/contracts/requests.ts` (append; extend imports from `./dto.ts`/`./enums.ts`)
- Modify: `src/contracts/enums.ts` (append `BuilderKind` — contract-owned, no engine mirror)
- Test: `tests/contracts/phase5-requests.test.ts` (create)

**Interfaces:**
- Consumes: `AgentProposalDtoSchema`... (not referenced directly — these requests carry primitives only), `ModelInventoryDtoSchema`, `MemorySpaceDtoSchema`, `RetrievalResultDtoSchema`, `McpServerDtoSchema` (Task 5), `RuntimeKind` (Task 4).
- Produces: `BuilderKind` enum; `BuilderBuildRequestSchema`/`BuilderBuildRequest`, `ModelPullRequestSchema`/`ModelPullRequest`, `MemoryRecallRequestSchema`/`MemoryRecallRequest`, `McpAddRequestSchema`/`McpAddRequest`; response wrappers `ModelListResponseSchema`/`ModelListResponse`, `MemorySpaceListResponseSchema`/`MemorySpaceListResponse`, `RetrievalResponseSchema`/`RetrievalResponse`, `McpListResponseSchema`/`McpListResponse`, `BuilderRegistryListResponseSchema`/`BuilderRegistryListResponse` (shared by `GET /api/builders/agents` and `GET /api/builders/crews`, both a bare `{ items: string[] }`).

- [ ] **Step 1: Write the failing test**

`tests/contracts/phase5-requests.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { BuilderKind, RuntimeKind } from '../../src/contracts/enums.ts';
import {
  BuilderBuildRequestSchema,
  BuilderRegistryListResponseSchema,
  McpAddRequestSchema,
  MemoryRecallRequestSchema,
  ModelListResponseSchema,
  ModelPullRequestSchema,
} from '../../src/contracts/requests.ts';

test('BuilderBuildRequestSchema requires kind + need', () => {
  const r = BuilderBuildRequestSchema.parse({ kind: BuilderKind.Agent, need: 'fetch stock quotes' });
  expect(r.kind).toBe('agent');
  expect(() => BuilderBuildRequestSchema.parse({ need: 'x' })).toThrow();
});

test('ModelPullRequestSchema requires runtime + modelRef', () => {
  const r = ModelPullRequestSchema.parse({ runtime: RuntimeKind.Ollama, modelRef: 'qwen3.5:9b' });
  expect(r.modelRef).toBe('qwen3.5:9b');
});

test('MemoryRecallRequestSchema requires a query', () => {
  expect(MemoryRecallRequestSchema.parse({ query: 'what is the plan' }).query).toBe(
    'what is the plan',
  );
  expect(() => MemoryRecallRequestSchema.parse({})).toThrow();
});

test('McpAddRequestSchema accepts a raw server value', () => {
  const r = McpAddRequestSchema.parse({
    name: 'filesystem',
    server: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
  });
  expect(r.name).toBe('filesystem');
});

test('ModelListResponseSchema + BuilderRegistryListResponseSchema wrap items', () => {
  expect(
    ModelListResponseSchema.parse({ items: [] }).items,
  ).toEqual([]);
  expect(
    BuilderRegistryListResponseSchema.parse({ items: ['file_qa'] }).items,
  ).toEqual(['file_qa']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/phase5-requests.test.ts`
Expected: FAIL — `BuilderKind` and the new schemas are not exported.

- [ ] **Step 3: Add `BuilderKind` to `src/contracts/enums.ts`**

```typescript
/** Which builder flow a build request targets. Contract-owned — no engine
 *  mirror needed (`src/crew-builder`'s `Shape` type covers only
 *  'crew'|'workflow'; 'agent' is the agent-builder's separate flow). Slice
 *  30b Phase 5. */
export enum BuilderKind {
  Agent = 'agent',
  Crew = 'crew',
  Workflow = 'workflow',
}
```

- [ ] **Step 4: Append the request/response schemas to `src/contracts/requests.ts`**

Add `McpServerDtoSchema`, `MemorySpaceDtoSchema`, `ModelInventoryDtoSchema`, `RetrievalResultDtoSchema` to the existing `./dto.ts` import and `BuilderKind`, `RuntimeKind` to the existing `./enums.ts` import, then append:
```typescript
/** `POST /api/builders/build` body (spec §4.2.1). `need.max(20_000)` bounds
 *  the perimeter the same way `CrewRunRequestSchema` bounds `input` (Phase 4). */
export const BuilderBuildRequestSchema = z.object({
  kind: z.enum(BuilderKind),
  need: z.string().max(20_000),
  autoYes: z.boolean().optional(),
  force: z.boolean().optional(),
});
export type BuilderBuildRequest = z.infer<typeof BuilderBuildRequestSchema>;

/** `POST /api/models/pull` body (spec §4.2.4). No `provider` field — the
 *  server resolves which `DownloadProvider` to use from its own catalog
 *  lookup (never trusts the client to pick the download mechanism). */
export const ModelPullRequestSchema = z.object({
  runtime: z.enum(RuntimeKind),
  modelRef: z.string().min(1),
});
export type ModelPullRequest = z.infer<typeof ModelPullRequestSchema>;

/** `POST /api/memory/:space/recall` body (spec §4.2.5). `space` is a path
 *  param on the real route, not this body — kept here too (optional) so the
 *  schema is reusable if a future caller posts a bare query without a path
 *  param (e.g. an internal test harness). */
export const MemoryRecallRequestSchema = z.object({
  query: z.string().min(1),
  space: z.string().optional(),
  topK: z.number().int().positive().optional(),
});
export type MemoryRecallRequest = z.infer<typeof MemoryRecallRequestSchema>;

/** `POST /api/mcp/add` body (spec §4.2.6) — the raw `mcpServers.<name>` value,
 *  mirroring `PackEntry.server` (`src/mcp/types.ts:84`). */
export const McpAddRequestSchema = z.object({
  name: z.string().min(1),
  server: z.record(z.string(), z.unknown()),
});
export type McpAddRequest = z.infer<typeof McpAddRequestSchema>;

/** Browse/list responses — plain arrays (small in-memory/on-disk sets, no
 *  cursor), mirroring `CrewListResponseSchema`/`WorkflowListResponseSchema`
 *  (Phase 4). */
export const ModelListResponseSchema = z.object({
  items: z.array(ModelInventoryDtoSchema),
});
export type ModelListResponse = z.infer<typeof ModelListResponseSchema>;

export const MemorySpaceListResponseSchema = z.object({
  items: z.array(MemorySpaceDtoSchema),
});
export type MemorySpaceListResponse = z.infer<typeof MemorySpaceListResponseSchema>;

export const RetrievalResponseSchema = z.object({
  items: z.array(RetrievalResultDtoSchema),
});
export type RetrievalResponse = z.infer<typeof RetrievalResponseSchema>;

export const McpListResponseSchema = z.object({
  items: z.array(McpServerDtoSchema),
});
export type McpListResponse = z.infer<typeof McpListResponseSchema>;

/** Shared by `GET /api/builders/agents` and `GET /api/builders/crews` — both
 *  are a bare list of registry names (existing-agent awareness for the
 *  wizard), not a projected DTO array. */
export const BuilderRegistryListResponseSchema = z.object({
  items: z.array(z.string()),
});
export type BuilderRegistryListResponse = z.infer<
  typeof BuilderRegistryListResponseSchema
>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/contracts/phase5-requests.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/enums.ts src/contracts/requests.ts tests/contracts/phase5-requests.test.ts
git add src/contracts/enums.ts src/contracts/requests.ts tests/contracts/phase5-requests.test.ts
git commit -m "feat(contracts): builder/model/memory/mcp request + list-response schemas (Phase 5)"
```

---

## Task 7: `DagStatus.Proposed` + web Library 3-tab shell scaffold

**Files:**
- Modify: `web/src/shared/dag/types.ts` (add `DagStatus.Proposed`)
- Modify: `web/src/features/library/index.tsx` (replace the Phase-1b/4 stub with a 3-tab shell)
- Test: `web/src/shared/dag/types.test.ts` (create), `web/src/features/library/index.test.tsx` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DagStatus.Proposed` (D6 — an unstaged/not-yet-committed proposal node renders visually distinct from a live/committed one); `LibraryArea` renders a Models/Memory/MCP tab switcher with a stub panel per tab (each real panel lands in Increments 3/5/4 respectively, replacing its stub `<p>` only).

- [ ] **Step 1: Write the failing DagStatus test**

`web/src/shared/dag/types.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { DagStatus } from './types.ts';

describe('DagStatus', () => {
  it('has a Proposed member for a staged, not-yet-committed node (Phase 5 D6)', () => {
    expect(DagStatus.Proposed).toBe('proposed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- types.test.ts`
Expected: FAIL — `DagStatus.Proposed` is `undefined`.

- [ ] **Step 3: Add `Proposed` to `DagStatus` in `web/src/shared/dag/types.ts`**

Read the file first (it currently has `Pending`/`Running`/`Done`/`Error`/`Skipped`). Add one member:
```typescript
/** Live overlay status for a node (run-detail's D8 join); undefined/omitted
 *  renders as the neutral/default (pending) look. `Proposed` (Phase 5, D6) is
 *  distinct from `Pending`: a proposed node is a staged, not-yet-committed
 *  builder proposal, not a step waiting its turn in an active run. */
export enum DagStatus {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
  Skipped = 'skipped',
  Proposed = 'proposed',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- types.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing Library shell test**

`web/src/features/library/index.test.tsx`:
```typescript
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('LibraryArea', () => {
  it('defaults to the Models tab and switches to Memory/MCP on click', () => {
    renderAt('/library');
    expect(screen.getByTestId('area-library')).toBeInTheDocument();
    expect(screen.getByTestId('library-panel-models')).toBeInTheDocument();
    expect(screen.getByTestId('library-tab-models')).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByTestId('library-tab-memory'));
    expect(screen.getByTestId('library-panel-memory')).toBeInTheDocument();
    expect(screen.queryByTestId('library-panel-models')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('library-tab-mcp'));
    expect(screen.getByTestId('library-panel-mcp')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && bun run test -- library/index.test.tsx`
Expected: FAIL — `LibraryArea` still renders the Phase-1b stub (no `library-tab-*`/`library-panel-*` testids).

- [ ] **Step 7: Replace `web/src/features/library/index.tsx`**

```tsx
import { useState } from 'react';

type LibraryTab = 'models' | 'memory' | 'mcp';

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'models', label: 'Models' },
  { id: 'memory', label: 'Memory' },
  { id: 'mcp', label: 'MCP' },
];

/** The Library area: one shell, three tabs (Models · Memory · MCP). Each
 *  panel is a stub in this increment — Increment 3 (Models), Increment 5
 *  (Memory), and Increment 4 (MCP) replace their stub `<p>` with the real
 *  list/table + actions, without touching this shell (D11: one engine seam
 *  per increment). Duplicated a third time rather than prematurely
 *  abstracted into a shared facet component (matches the crews/workflows
 *  list precedent, Phase 4). */
export function LibraryArea() {
  const [tab, setTab] = useState<LibraryTab>('models');

  return (
    <section data-testid="area-library" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Library</h1>
      <div
        role="tablist"
        className="mt-4 flex gap-2 border-b border-[var(--color-border)]"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`library-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 font-mono text-sm ${
              tab === t.id
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]'
                : 'text-[var(--color-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {tab === 'models' && (
          <p
            data-testid="library-panel-models"
            className="text-sm text-[var(--color-muted)]"
          >
            Models land in Increment 3.
          </p>
        )}
        {tab === 'memory' && (
          <p
            data-testid="library-panel-memory"
            className="text-sm text-[var(--color-muted)]"
          >
            Memory lands in Increment 5.
          </p>
        )}
        {tab === 'mcp' && (
          <p
            data-testid="library-panel-mcp"
            className="text-sm text-[var(--color-muted)]"
          >
            MCP lands in Increment 4.
          </p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && bun run test -- library/index.test.tsx types.test.ts`
Expected: both PASS.

- [ ] **Step 9: Gate + commit**

```bash
cd web && bun run typecheck && bun run test
git add web/src/shared/dag/types.ts web/src/shared/dag/types.test.ts web/src/features/library/index.tsx web/src/features/library/index.test.tsx
git commit -m "feat(web): DagStatus.Proposed + Library 3-tab shell (Phase 5)"
```

---

## Task 8: web Builders route scaffold (stub SSE echo)

**Files:**
- Modify: `web/src/features/builders/index.tsx` (replace the Phase-1b/4 stub)
- Create: `web/src/features/builders/echo-stub.ts` (pure, unit-tested)
- Test: `web/src/features/builders/echo-stub.test.ts` (create), `web/src/features/builders/index.test.tsx` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `echoBuilderStub(need: string): AsyncGenerator<string>` (a pure local echo — no network call yet, since `POST /api/builders/build` doesn't exist until Increment 2); `BuildersArea` renders a need-textarea + submit that streams the stub's lines into a narration list. Increment 2 (Task 13/14) REPLACES this component's body wholesale with the real `use-build-events.ts`-backed wizard — this scaffold exists so the route/shell/layout is reviewable and visually real before the SSE route lands, not so its logic survives.

- [ ] **Step 1: Write the failing stub test**

`web/src/features/builders/echo-stub.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { echoBuilderStub } from './echo-stub.ts';

describe('echoBuilderStub', () => {
  it('yields an echo line then a stub-notice line', async () => {
    const lines: string[] = [];
    for await (const line of echoBuilderStub('fetch stock quotes')) {
      lines.push(line);
    }
    expect(lines).toEqual([
      'Received: "fetch stock quotes"',
      'Stub: real builder streaming lands in Increment 2.',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- echo-stub.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/features/builders/echo-stub.ts`**

```typescript
/** Pure, local stand-in for the real builder SSE stream (Increment 2 —
 *  `POST /api/builders/build` + `use-build-events.ts`). No network call: this
 *  scaffold only proves the wizard shell (textarea → narration list) renders
 *  and updates correctly before the real route exists. */
export async function* echoBuilderStub(need: string): AsyncGenerator<string> {
  yield `Received: "${need}"`;
  yield 'Stub: real builder streaming lands in Increment 2.';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- echo-stub.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing BuildersArea test**

`web/src/features/builders/index.test.tsx`:
```typescript
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('BuildersArea', () => {
  it('streams the local echo stub into a narration list on submit', async () => {
    renderAt('/builders');
    fireEvent.change(screen.getByTestId('builders-need'), {
      target: { value: 'fetch stock quotes' },
    });
    fireEvent.click(screen.getByTestId('builders-submit'));
    await waitFor(() =>
      expect(screen.getByText('Received: "fetch stock quotes"')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Stub: real builder streaming lands in Increment 2.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && bun run test -- builders/index.test.tsx`
Expected: FAIL — `BuildersArea` still renders the Phase-1b stub (no `builders-need`/`builders-submit` testids).

- [ ] **Step 7: Replace `web/src/features/builders/index.tsx`**

```tsx
import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { echoBuilderStub } from './echo-stub.ts';

/** Builders area scaffold (Increment 1). The need-textarea + narration-list
 *  shell is real; the stream behind it is the local `echoBuilderStub` until
 *  Increment 2 wires `POST /api/builders/build` + `use-build-events.ts` and
 *  replaces this component's body with the guided wizard. */
export function BuildersArea() {
  const [need, setNeed] = useState('');
  const [narration, setNarration] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setNarration([]);
    setBusy(true);
    try {
      for await (const line of echoBuilderStub(need)) {
        setNarration((prev) => [...prev, line]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="area-builders" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Builders</h1>
      <textarea
        data-testid="builders-need"
        placeholder="Describe the capability you need…"
        value={need}
        onChange={(e) => setNeed(e.target.value)}
        className="mt-4 h-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-sm text-[var(--color-fg)]"
      />
      <div className="mt-2">
        <Button
          data-testid="builders-submit"
          disabled={busy || need.trim().length === 0}
          onClick={handleSubmit}
        >
          Build
        </Button>
      </div>
      <ul className="mt-4 flex flex-col gap-1 font-mono text-sm text-[var(--color-muted)]">
        {narration.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only local narration log, never reordered/removed mid-stream
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && bun run test -- builders/index.test.tsx echo-stub.test.ts`
Expected: both PASS.

- [ ] **Step 9: Gate + commit**

```bash
cd web && bun run typecheck && bun run test
git add web/src/features/builders/index.tsx web/src/features/builders/echo-stub.ts web/src/features/builders/echo-stub.test.ts web/src/features/builders/index.test.tsx
git commit -m "feat(web): Builders area scaffold with a local echo stub (Phase 5, Increment 1)"
```

---

## Task 9: Builder confirm/log adapter (pure, unit-tested)

**Files:**
- Create: `src/server/builders/adapter.ts`
- Test: `tests/server/builders-adapter.test.ts` (create)

**Interfaces:**
- Consumes: `ConfirmPort` (`src/server/consent/registry.ts:10-13`), `EventSink` (`src/core/events.ts`).
- Produces: `confirmViaPort(port: ConfirmPort, events: EventSink, kind: string): (question: string) => Promise<boolean>`, `confirmReuseViaPort(port: ConfirmPort, events: EventSink): (kind: string, question: string) => Promise<boolean>`, `TextPartWriter` type + `logToTextDelta(write: TextPartWriter): (m: string) => void`.

**Design note (D4):** these three functions are the ENTIRE bridge between `BuilderDeps`/`CrewBuilderVerifyDeps` (frozen public shapes from Slices 17/20 — `confirm: (text: string) => Promise<boolean>`, `confirmReuse?: (kind: ReuseKind, text: string) => Promise<boolean>`, `log?: (m: string) => void`) and the server's SSE writer + `ConsentRegistry`. Nothing engine-side changes; only these adapters are new.

- [ ] **Step 1: Write the failing test**

`tests/server/builders-adapter.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { ConfirmPort } from '../../src/server/consent/registry.ts';
import {
  confirmReuseViaPort,
  confirmViaPort,
  logToTextDelta,
} from '../../src/server/builders/adapter.ts';

test('confirmViaPort mints a fixed-kind ask through the port and resolves its answer', async () => {
  const asks: unknown[] = [];
  const port: ConfirmPort = async (ask, emit) => {
    asks.push(ask);
    emit({ type: 'data-confirm' as never, promptId: 'p1', kind: ask.kind, question: ask.question } as never);
    return true;
  };
  const emitted: unknown[] = [];
  const confirm = confirmViaPort(port, (e) => emitted.push(e), 'build');
  const granted = await confirm('Create this agent?');
  expect(granted).toBe(true);
  expect(asks).toEqual([{ kind: 'build', question: 'Create this agent?' }]);
  expect(emitted).toHaveLength(1);
});

test('confirmViaPort coerces a non-boolean port answer to a boolean', async () => {
  const port: ConfirmPort = async () => undefined;
  const confirm = confirmViaPort(port, () => {}, 'build');
  expect(await confirm('x')).toBe(false);
});

test('confirmReuseViaPort threads the CALLER-supplied kind (varies per call, unlike confirmViaPort)', async () => {
  const seenKinds: string[] = [];
  const port: ConfirmPort = async (ask) => {
    seenKinds.push(ask.kind);
    return ask.kind === 'reuse';
  };
  const confirmReuse = confirmReuseViaPort(port, () => {});
  expect(await confirmReuse('reuse', 'Reuse it?')).toBe(true);
  expect(await confirmReuse('offer', 'Close match — reuse?')).toBe(false);
  expect(seenKinds).toEqual(['reuse', 'offer']);
});

test('logToTextDelta writes one start/delta/end triple per call, with distinct ids', () => {
  const parts: { type: string; id?: string; delta?: string }[] = [];
  const log = logToTextDelta((p) => parts.push(p));
  log('first line');
  log('second line');
  expect(parts).toEqual([
    { type: 'text-start', id: 'narration-0' },
    { type: 'text-delta', id: 'narration-0', delta: 'first line' },
    { type: 'text-end', id: 'narration-0' },
    { type: 'text-start', id: 'narration-1' },
    { type: 'text-delta', id: 'narration-1', delta: 'second line' },
    { type: 'text-end', id: 'narration-1' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/builders-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/builders/adapter.ts`**

```typescript
import type { EventSink } from '../../core/events.ts';
import type { ConfirmPort } from '../consent/registry.ts';

/** Bridges a builder's plain-boolean `confirm` ask to the server's
 *  `ConfirmPort` (D4) — mints a `data-confirm` prompt on the SAME event sink
 *  the build's narration also writes to (§7.1: one connection, not two), and
 *  resolves when `POST /api/runs/:id/respond` answers it. `kind` is fixed per
 *  call site (e.g. `'build'`), unlike `confirmReuseViaPort` below. */
export function confirmViaPort(
  port: ConfirmPort,
  events: EventSink,
  kind: string,
): (question: string) => Promise<boolean> {
  return async (question) => Boolean(await port({ kind, question }, events));
}

/** Same bridge as `confirmViaPort`, but `kind` is supplied PER CALL (the
 *  `ReuseKind` value — `'reuse'`/`'offer'` — the builder passes to
 *  `confirmReuse`), since a single build may ask a reuse question with
 *  either kind depending on the similarity band. */
export function confirmReuseViaPort(
  port: ConfirmPort,
  events: EventSink,
): (kind: string, question: string) => Promise<boolean> {
  return async (kind, question) =>
    Boolean(await port({ kind, question }, events));
}

/** Structurally narrower than the real AI-SDK `UIMessageStreamWriter['write']`
 *  (which accepts many more chunk shapes) — `writer.write` is assignable here
 *  by ordinary function-parameter contravariance, so `logToTextDelta(writer.write)`
 *  type-checks without this module importing `ai`. */
export type TextPartWriter = (
  part:
    | { type: 'text-start'; id: string }
    | { type: 'text-delta'; id: string; delta: string }
    | { type: 'text-end'; id: string },
) => void;

/** Bridges a builder's `log?: (m: string) => void` narration hook to a
 *  `text-delta` part on the SAME writer the confirm ask and terminal result
 *  also use (§7.1) — this is what makes build progress LIVE-visible; the
 *  build's own `agent.build`/`crew.build` spans only flush to `spans.jsonl`
 *  when they close, i.e. at the very end (D7). Each call is its own
 *  start/delta/end text block (a fresh, incrementing id) so the browser
 *  renders one narration line per call instead of one run-on paragraph. */
export function logToTextDelta(write: TextPartWriter): (m: string) => void {
  let n = 0;
  return (m) => {
    const id = `narration-${n++}`;
    write({ type: 'text-start', id });
    write({ type: 'text-delta', id, delta: m });
    write({ type: 'text-end', id });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/builders-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/builders/adapter.ts tests/server/builders-adapter.test.ts
git add src/server/builders/adapter.ts tests/server/builders-adapter.test.ts
git commit -m "feat(server): builder confirm/confirmReuse/log adapters onto ConfirmPort + SSE writer (Phase 5)"
```

---

## Task 10: Result mapper — `toBuildResultDto`/`toCrewBuildResultDto`

**Files:**
- Create: `src/server/builders/map-result.ts`
- Test: `tests/server/builders-map-result.test.ts` (create)

**Interfaces:**
- Consumes: `BuildResult` (`src/agent-builder/types.ts:22-38`), `CrewBuildResult` (`src/crew-builder/types.ts:13-31`), `BuildResultDTO` (Task 3).
- Produces: `toBuildResultDto(result: BuildResult): BuildResultDTO`, `toCrewBuildResultDto(result: CrewBuildResult): BuildResultDTO`.

- [ ] **Step 1: Write the failing test**

`tests/server/builders-map-result.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { AgentProposal, BuildResult } from '../../src/agent-builder/types.ts';
import type { CrewBuildResult } from '../../src/crew-builder/types.ts';
import { toBuildResultDto, toCrewBuildResultDto } from '../../src/server/builders/map-result.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';

const proposal: AgentProposal = {
  name: 'stock_quotes',
  description: 'fetch quotes',
  systemPrompt: 'x',
  modelReq: { role: 'r', requires: [], prefer: 'largest-that-fits' as never },
  suggestedServers: [],
  rationale: 'why',
};

test('toBuildResultDto flattens every BuildResult variant, carrying the FULL proposal on `written`', () => {
  expect(
    toBuildResultDto({ kind: 'written', proposal, files: ['a.ts'], level: VerifiedLevel.Runs }),
  ).toEqual({
    kind: 'written',
    name: 'stock_quotes',
    files: ['a.ts'],
    level: VerifiedLevel.Runs,
    proposal,
  });
  expect(toBuildResultDto({ kind: 'declined' })).toEqual({ kind: 'declined' });
  expect(
    toBuildResultDto({ kind: 'invalid', issues: [{ field: 'name', problem: 'taken' }] }),
  ).toEqual({ kind: 'invalid', issues: [{ field: 'name', problem: 'taken' }] });
  expect(toBuildResultDto({ kind: 'abandoned', reason: 'timeout' })).toEqual({
    kind: 'abandoned',
    reason: 'timeout',
  });
  expect(toBuildResultDto({ kind: 'reused', name: 'existing', similarity: 0.9 })).toEqual({
    kind: 'reused',
    name: 'existing',
    similarity: 0.9,
  });
  expect(
    toBuildResultDto({ kind: 'failed-verification', stage: 'dry-run', detail: 'boom' }),
  ).toEqual({ kind: 'failed-verification', stage: 'dry-run', detail: 'boom' });
});

const crewResult: CrewBuildResult = {
  kind: 'written',
  shape: 'crew',
  name: 'research-crew',
  files: ['crews/research-crew.ts'],
  builtAgents: ['researcher'],
  level: VerifiedLevel.Behaves,
};

test('toCrewBuildResultDto flattens a written crew result (no IR carried — engine gap, see plan notes)', () => {
  expect(toCrewBuildResultDto(crewResult)).toEqual({
    kind: 'written',
    name: 'research-crew',
    files: ['crews/research-crew.ts'],
    level: VerifiedLevel.Behaves,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/builders-map-result.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/builders/map-result.ts`**

```typescript
import type { BuildResult } from '../../agent-builder/types.ts';
import type { BuildResultDTO } from '../../contracts/dto.ts';
import type { CrewBuildResult } from '../../crew-builder/types.ts';

/** Flattens `BuildResult` (`src/agent-builder/types.ts:22-38`) onto the wire
 *  shape (Task 3). `written`'s full `AgentProposal` is JSON-safe (D5) and
 *  structurally satisfies `AgentProposalDtoSchema` field-for-field, so it
 *  rides straight onto `BuildResultDTO.proposal` — this is what lets the
 *  wizard (Task 14) render the D6 post-write proposal DagView without a
 *  second round-trip. */
export function toBuildResultDto(result: BuildResult): BuildResultDTO {
  switch (result.kind) {
    case 'written':
      return {
        kind: 'written',
        name: result.proposal.name,
        files: result.files,
        level: result.level,
        proposal: result.proposal,
      };
    case 'declined':
      return { kind: 'declined' };
    case 'invalid':
      return { kind: 'invalid', issues: result.issues };
    case 'abandoned':
      return { kind: 'abandoned', reason: result.reason };
    case 'reused':
      return { kind: 'reused', name: result.name, similarity: result.similarity };
    case 'failed-verification':
      return {
        kind: 'failed-verification',
        stage: result.stage,
        detail: result.detail,
      };
  }
}

/** Flattens `CrewBuildResult` (`src/crew-builder/types.ts:13-31`) onto the
 *  same wire shape. Unlike the agent builder, `CrewBuildResult.written` does
 *  NOT carry the committed `CrewIR`/`WorkflowIR` back to the caller (only
 *  `name`/`files`/`builtAgents`) — an existing engine-side gap, not
 *  introduced here. This is why the crew/workflow wizard (Task 14) shows a
 *  plain result card, not a post-write DagView, for `written`: there is no IR
 *  to derive one from without a source change to `crew-builder/types.ts`. */
export function toCrewBuildResultDto(result: CrewBuildResult): BuildResultDTO {
  switch (result.kind) {
    case 'written':
      return {
        kind: 'written',
        name: result.name,
        files: result.files,
        level: result.level,
      };
    case 'declined':
      return { kind: 'declined' };
    case 'invalid':
      return { kind: 'invalid', issues: result.issues };
    case 'abandoned':
      return { kind: 'abandoned', reason: result.reason };
    case 'reused':
      return { kind: 'reused', name: result.name, similarity: result.similarity };
    case 'failed-verification':
      return {
        kind: 'failed-verification',
        stage: result.stage,
        detail: result.detail,
      };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/builders-map-result.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/builders/map-result.ts tests/server/builders-map-result.test.ts
git add src/server/builders/map-result.ts tests/server/builders-map-result.test.ts
git commit -m "feat(server): BuildResult/CrewBuildResult → BuildResultDTO mapper (Phase 5)"
```

---

## Task 11: `POST /api/builders/build` SSE route [HARD — ultracode adversarial-verify]

**Controller note:** dispatch this task as an **ultracode Workflow** (deterministic fan-out + adversarial-verify), Opus-powered. This is spec §7.1, explicitly flagged the reasoning-heavy piece of the whole phase. The reviewer's checklist is the four bullets under "Requirements the review must adversarially verify" in §7.1 — restated as the four test groups below. Do not soften or skip any of the four.

**Files:**
- Create: `src/server/builders/config.ts`, `src/server/builders/build.ts`
- Test: `tests/server/builders-build.test.ts` (create)

**Interfaces:**
- Consumes: `BuilderBuildRequestSchema` (Task 6), `BuildResultDTO` (Task 3), `confirmViaPort`/`confirmReuseViaPort`/`logToTextDelta` (Task 9), `ConsentRegistry`/`ConfirmPort` (`src/server/consent/registry.ts`), `withWallClock` (`src/reliability/timeout.ts`), `newRunId` (`src/run/run-id.ts`), `StatusEventType` (`src/contracts/enums.ts`).
- Produces: `confirmWaitMs(): number`; `RunBuilderTurn` type; `BuilderBuildDeps = { runsRoot: string; consent: ConsentRegistry; runBuilderTurn: RunBuilderTurn }`; `handleBuilderBuild(req: Request, deps: BuilderBuildDeps): Promise<Response>`.

- [ ] **Step 1: Write the failing tests (all four requirement groups)**

`tests/server/builders-build.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { BuilderKind, StatusEventType } from '../../src/contracts/enums.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import { handleBuilderBuild } from '../../src/server/builders/build.ts';

function builderRequest(body: unknown): Request {
  return new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('rejects a malformed body with 400 before any stream opens', async () => {
  const res = await handleBuilderBuild(builderRequest({ need: 'x' }), {
    runsRoot: '/tmp/unused',
    consent: createConsentRegistry(),
    runBuilderTurn: (async () => ({ kind: 'declined' })) as RunBuilderTurn,
  });
  expect(res.status).toBe(400);
});

test('happy path: data-run-start, narration, and the terminal result all stream, exactly once', async () => {
  const turn: RunBuilderTurn = async ({ log, runId }) => {
    log(`building for run ${runId}`);
    return { kind: 'written', name: 'stock_quotes', files: ['agents/stock_quotes.ts'] };
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'fetch stock quotes' }),
    { runsRoot: '/tmp/unused', consent: createConsentRegistry(), runBuilderTurn: turn },
  );
  const body = await res.text();
  expect(body).toContain('data-run-start');
  expect(body.match(/"kind":"written"/g)).toHaveLength(1); // terminal result written EXACTLY once
  expect(body).toContain('building for run run-');
  expect(body).toContain('data-run-end');
  expect(body).toContain('"outcome":"written"');
});

test('a throwing runBuilderTurn still produces exactly one terminal result (never crashes the route)', async () => {
  const turn: RunBuilderTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'x' }),
    { runsRoot: '/tmp/unused', consent: createConsentRegistry(), runBuilderTurn: turn },
  );
  const body = await res.text();
  expect(body.match(/"kind":"failed-verification"/g)).toHaveLength(1);
  expect(body).toContain('"detail":"boom"');
});

test('requirement (a): confirm() genuinely suspends the build until POST /api/runs/:id/respond answers it', async () => {
  const registry = createConsentRegistry();
  const turn: RunBuilderTurn = async ({ confirm, log }) => {
    log('before-confirm');
    const granted = await confirm('proceed?');
    log(`after-confirm:${granted}`);
    return { kind: granted ? 'written' : 'declined', name: 'x', files: [] };
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'x' }),
    { runsRoot: '/tmp/unused', consent: registry, runBuilderTurn: turn },
  );
  const reader = res.body?.getReader();
  if (!reader) throw new Error('expected a streaming body');
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('before-confirm') || !text.includes('data-confirm')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream ended before the confirm ask was ever sent');
    text += decoder.decode(value);
  }
  // The ask genuinely suspended execute: nothing past it has arrived yet.
  expect(text).not.toContain('after-confirm');
  const promptId = /"promptId":"([^"]+)"/.exec(text)?.[1];
  expect(promptId).toBeDefined();
  expect(registry.resolve(promptId as string, true)).toBe(true);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  expect(text).toContain('after-confirm:true');
  expect(text.match(/"kind":"written"/g)).toHaveLength(1);
});

test('requirement (b): a client abort during a pending confirm does not crash, and never resolves against a later, unrelated answer', async () => {
  const registry = createConsentRegistry();
  const controller = new AbortController();
  const turn: RunBuilderTurn = async ({ confirm }) => {
    const granted = await confirm('proceed?');
    return { kind: granted ? 'written' : 'declined', name: 'x', files: [] };
  };
  const req = new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: BuilderKind.Agent, need: 'x' }),
    signal: controller.signal,
  });
  const res = await handleBuilderBuild(req, {
    runsRoot: '/tmp/unused',
    consent: registry,
    runBuilderTurn: turn,
  });
  controller.abort(); // client navigates away mid-consent
  // The registry entry is still pending — unaffected by the client abort
  // (promptId unguessability already prevents cross-talk; abort just means
  // nobody is reading the stream anymore, which must not throw here).
  expect(registry.pending().length).toBe(1);
  // A stale/late answer must not throw even though nobody reads the response.
  const [promptId] = registry.pending();
  expect(() => registry.resolve(promptId as string, true)).not.toThrow();
});

test('req.signal aborting does NOT stop the build from running to completion (the build is not detached from the connection, but is also not cancelled by it — requirement (d) at the route level)', async () => {
  const controller = new AbortController();
  let completed = false;
  const turn: RunBuilderTurn = async () => {
    await new Promise((r) => setTimeout(r, 5));
    completed = true;
    return { kind: 'declined' };
  };
  const req = new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: BuilderKind.Agent, need: 'x' }),
    signal: controller.signal,
  });
  const res = await handleBuilderBuild(req, {
    runsRoot: '/tmp/unused',
    consent: createConsentRegistry(),
    runBuilderTurn: turn,
  });
  controller.abort();
  await res.text(); // still drains to completion server-side
  expect(completed).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/builders-build.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/server/builders/config.ts`**

```typescript
const DEFAULT_CONFIRM_WAIT_MS = 15 * 60_000; // 15 minutes — a HUMAN decision window

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name]) || fallback;
}

/** Wall-clock cap around a builder's confirm/confirmReuse await (§7.1): an
 *  abandoned wizard (the human never answers — closes the tab mid-consent)
 *  must not suspend `execute`, and thus the terminal result, forever.
 *  Deliberately its OWN, much longer budget than `dryRunMs()`
 *  (`src/verified-build/config.ts`, a MODEL-call timeout) — this bounds how
 *  long the server waits for a HUMAN click, not a generateText call. */
export function confirmWaitMs(): number {
  return envNumber('AGENT_BUILDER_CONFIRM_WAIT_MS', DEFAULT_CONFIRM_WAIT_MS);
}
```

- [ ] **Step 4: Create `src/server/builders/build.ts`**

```typescript
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { BuilderKind, StatusEventType } from '../../contracts/enums.ts';
import type { BuildResultDTO } from '../../contracts/dto.ts';
import { BuilderBuildRequestSchema } from '../../contracts/requests.ts';
import type { EventSink } from '../../core/events.ts';
import { withWallClock } from '../../reliability/timeout.ts';
import { newRunId } from '../../run/run-id.ts';
import { confirmReuseViaPort, confirmViaPort, logToTextDelta } from './adapter.ts';
import { confirmWaitMs } from './config.ts';
import type { ConsentRegistry } from '../consent/registry.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** What one builder run needs to do the actual generate/consent/verify/commit
 *  work (Task 12's `createRealRunBuilderTurn` composes `buildAgent`/
 *  `buildCrewOrWorkflow` under `withRunTelemetry`). Kept UNIT-TESTABLE here —
 *  the real turn is covered by live-verify, not unit tests, same policy as
 *  `RunCrewTurn`/`RunChatTurn` (Phase 4/2). */
export type RunBuilderTurn = (input: {
  kind: BuilderKind;
  need: string;
  autoYes?: boolean;
  force?: boolean;
  runId: string;
  confirm: (question: string) => Promise<boolean>;
  confirmReuse: (kind: string, question: string) => Promise<boolean>;
  log: (m: string) => void;
}) => Promise<BuildResultDTO>;

export type BuilderBuildDeps = {
  runsRoot: string;
  consent: ConsentRegistry;
  runBuilderTurn: RunBuilderTurn;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Wraps a boolean ask with `confirmWaitMs()`'s wall-clock cap (§7.1
 *  requirement (b)): a timeout is treated as a DECLINE — fail-closed, never
 *  an auto-approve. The registry's own `pendingResolvers` entry for this
 *  promptId is not proactively evicted on timeout (accepted for this phase —
 *  a late answer simply lands on nobody listening; a registry-level expiry
 *  is a natural future hardening item, not required here). */
function withConfirmTimeout(ask: () => Promise<boolean>): Promise<boolean> {
  return withWallClock(confirmWaitMs(), ask).catch(() => false);
}

/**
 * `POST /api/builders/build` (spec §4.2.1/§7.1) — streams the guided-build
 * flow as an AI-SDK SSE UI-message stream, exactly `handleChat`'s shape.
 * Mints a runId, emits `data-run-start`/`data-run-end`, and dispatches to
 * `deps.runBuilderTurn` with `confirm`/`confirmReuse`/`log` bridged onto the
 * SAME connection's event sink + text-delta parts (Task 9's adapters, D4).
 *
 * `execute` is NOT detached (unlike the fire-and-watch model-pull route,
 * Task 17): the whole build runs to completion inside it, so a client abort
 * (`req.signal`) never tears the build down mid-stage — requirement (d). The
 * terminal `BuildResultDTO` is written EXACTLY ONCE, as a one-shot text part,
 * whether `runBuilderTurn` resolves OR throws (requirement (c)) — mirroring
 * `handleChat`'s one-shot-outcome discipline for a non-'answer' result.
 */
export async function handleBuilderBuild(
  req: Request,
  deps: BuilderBuildDeps,
): Promise<Response> {
  let body: ReturnType<typeof BuilderBuildRequestSchema.parse>;
  try {
    body = BuilderBuildRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid builder request' }, 400);
  }

  const runId = newRunId();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const events: EventSink = (e) =>
        writer.write({ type: e.type, data: e, transient: true });
      const log = logToTextDelta(writer.write);
      const confirmRaw = confirmViaPort(deps.consent.port, events, 'build');
      const confirm = (question: string) =>
        withConfirmTimeout(() => confirmRaw(question));
      const confirmReuseRaw = confirmReuseViaPort(deps.consent.port, events);
      const confirmReuse = (kind: string, question: string) =>
        withConfirmTimeout(() => confirmReuseRaw(kind, question));

      events({ type: StatusEventType.RunStart, runId, task: body.need });

      let result: BuildResultDTO;
      try {
        result = await deps.runBuilderTurn({
          kind: body.kind,
          need: body.need,
          autoYes: body.autoYes,
          force: body.force,
          runId,
          confirm,
          confirmReuse,
          log,
        });
      } catch (err) {
        result = {
          kind: 'failed-verification',
          stage: 'error',
          detail: err instanceof Error ? err.message : String(err),
        };
      }

      const id = 'build-result';
      writer.write({ type: 'text-start', id });
      writer.write({ type: 'text-delta', id, delta: JSON.stringify(result) });
      writer.write({ type: 'text-end', id });

      events({ type: StatusEventType.RunEnd, runId, outcome: result.kind });
    },
    onError: (err) =>
      `stream error: ${err instanceof Error ? err.message : String(err)}`,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { ...ISOLATION_HEADERS, 'cache-control': 'no-store' },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/server/builders-build.test.ts`
Expected: all PASS, including the two progressive-read requirement tests (they exercise the real suspend/resume behavior end-to-end, not a mock).

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/builders/config.ts src/server/builders/build.ts tests/server/builders-build.test.ts
git add src/server/builders/config.ts src/server/builders/build.ts tests/server/builders-build.test.ts
git commit -m "feat(server): POST /api/builders/build — streaming guided-build + mid-flow consent (Phase 5, §7.1)"
```

> **Controller note (ultracode):** before merging this task's commit, run the ultracode adversarial-verify pass explicitly against spec §7.1's four bullets (confirm-suspends-execute, abort-cleanup, one-shot terminal result, span-closes-on-disconnect — the last one is only fully exercisable once Task 12 wires the real `withRunTelemetry`-backed turn; flag it as a cross-task dependency for that reviewer to re-check once Task 12 lands, not something Task 11 alone can prove end-to-end).

---

## Task 12: Builder registry lists + `runBuilderTurn` wiring (`ServerDeps`, `app.ts`, `main.ts`)

**Files:**
- Create: `src/server/builders/list.ts`
- Modify: `src/server/launch-turns.ts` (add `createRealRunBuilderTurn`)
- Modify: `src/server/app.ts` (extend `ServerDeps` with `runBuilderTurn`; wire three routes: `GET /api/builders/agents`, `GET /api/builders/crews`, `POST /api/builders/build`)
- Modify: `src/server/main.ts` (build the real turn; add to the `deps` object)
- Modify (fixture ripple — `ServerDeps` gained a required field): `tests/server/app.test.ts` (four `ServerDeps` literals, lines ~32/99/140/235), `tests/server/runs-routes.test.ts` (one literal), `tests/server/phase4-routes.test.ts` (the shared `deps()` helper)
- Test: `tests/server/builders-list.test.ts` (create), `tests/server/builders-turn.test.ts` (create — the requirement-(d) span-closes-on-disconnect proof deferred out of Task 11)

**Interfaces:**
- Consumes: `RunBuilderTurn` (Task 11), `agentNames` (`agents/index.ts`), `CREWS` (`crews/index.ts`), `WORKFLOWS` (`workflows/index.ts`), `BuilderRegistryListResponseSchema` (Task 6), `makeRealBuilderDeps` (`src/agent-builder/deps.ts`), `makeRealCrewBuilderDeps` (`src/crew-builder/deps.ts`), `withRunTelemetry` (`src/cli/with-run.ts`), `toBuildResultDto`/`toCrewBuildResultDto` (Task 10), `buildAgent`/`buildCrewOrWorkflow`.
- Produces: `handleBuilderAgentList(): Response`, `handleBuilderCrewList(): Response`, `createRealRunBuilderTurn(runsRoot: string): RunBuilderTurn`, `ServerDeps.runBuilderTurn: RunBuilderTurn`.

- [ ] **Step 1: Write the failing list-handler test**

`tests/server/builders-list.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import type { BuilderRegistryListResponse } from '../../src/contracts/index.ts';
import { handleBuilderAgentList, handleBuilderCrewList } from '../../src/server/builders/list.ts';

test('GET /api/builders/agents lists the agent registry', async () => {
  const res = handleBuilderAgentList();
  expect(res.status).toBe(200);
  const body = (await res.json()) as BuilderRegistryListResponse;
  expect(body.items.some((n) => n === 'file_qa')).toBe(true);
});

test('GET /api/builders/crews lists BOTH the crew and workflow registries', async () => {
  const res = handleBuilderCrewList();
  const body = (await res.json()) as BuilderRegistryListResponse;
  expect(body.items).toContain('research-crew');
  expect(body.items).toContain('fetch-then-summarize');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/builders-list.test.ts`
Expected: FAIL — module not found. (If `file_qa`/`research-crew`/`fetch-then-summarize` are not the real registry names in this checkout, read `agents/index.ts`/`crews/index.ts`/`workflows/index.ts` first and substitute the actual ones — this mirrors Phase 4's Task 8/9 fixtures, which already assert against these same names.)

- [ ] **Step 3: Create `src/server/builders/list.ts`**

```typescript
import { agentNames } from '../../../agents/index.ts';
import { CREWS } from '../../../crews/index.ts';
import { WORKFLOWS } from '../../../workflows/index.ts';
import { BuilderRegistryListResponseSchema } from '../../contracts/index.ts';
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

/** `GET /api/builders/agents` — existing agent names, for the wizard's
 *  reuse/name-collision awareness (spec §4.2 item 2). */
export function handleBuilderAgentList(): Response {
  return json(
    BuilderRegistryListResponseSchema.parse({ items: agentNames() }),
    200,
  );
}

/** `GET /api/builders/crews` — existing crew AND workflow names (the
 *  crew-builder classifies a need into either shape, so the wizard needs
 *  awareness of both registries from one call). */
export function handleBuilderCrewList(): Response {
  const items = [...Object.keys(CREWS), ...Object.keys(WORKFLOWS)];
  return json(BuilderRegistryListResponseSchema.parse({ items }), 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/builders-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing real-turn + span-lifecycle test**

`tests/server/builders-turn.test.ts` — this is requirement (d) from spec §7.1, deferred out of Task 11: proves that a build's `agent.build` span (opened by `buildAgent` via `withAgentBuildSpan`, nested inside `withRunTelemetry`) closes normally even though the route that will eventually call this turn is stream-based and the client may disconnect — `createRealRunBuilderTurn` itself has no dependency on the HTTP request/response lifecycle at all, which IS the fix (the build is never given `req.signal`, so nothing about the connection can tear it down mid-stage):
```typescript
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuilderKind } from '../../src/contracts/enums.ts';
import { createRealRunBuilderTurn } from '../../src/server/launch-turns.ts';

test('createRealRunBuilderTurn runs a real agent build to completion and its agent.build span closes (spans.jsonl is non-empty after settling)', async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), 'builder-turn-'));
  try {
    const turn = createRealRunBuilderTurn(runsRoot);
    const result = await turn({
      kind: BuilderKind.Agent,
      need: 'a trivial capability the builder will decline',
      runId: 'run-test-decline',
      confirm: async () => false, // decline immediately — no live model call needed to prove span closure
      confirmReuse: async () => false,
      log: () => {},
    });
    expect(result.kind).toBe('declined');
    const spansPath = join(runsRoot, 'run-test-decline', 'spans.jsonl');
    const raw = await readFile(spansPath, 'utf8');
    expect(raw).toContain('"name":"agent.build"');
  } finally {
    await rm(runsRoot, { recursive: true, force: true });
  }
});
```
**Note for the implementer:** this test still resolves a real `LanguageModel` via `makeRealBuilderDeps` (model manager + registry), so it needs a reachable Ollama daemon — same live-dependency class as the CLI's own `agent-builder.ts` `main()`. If no local model is reachable in CI, mark this test `test.skip` behind an env guard (e.g. `process.env.OLLAMA_HOST ? test : test.skip`) mirroring how other live-model tests in this repo degrade, and rely on the live-verify pass (Increment 6) to exercise it for real. Do not delete the test — skip it explicitly and note why.

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/server/builders-turn.test.ts`
Expected: FAIL — `createRealRunBuilderTurn` not exported from `launch-turns.ts`.

- [ ] **Step 7: Add `createRealRunBuilderTurn` to `src/server/launch-turns.ts`**

Read the file first (it currently exports `createRealRunCrewTurn`/`createRealRunWorkflowTurn`). Add:
```typescript
import type { BuilderDeps } from '../agent-builder/types.ts';
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';
import { withRunTelemetry } from '../cli/with-run.ts';
import { BuilderKind } from '../contracts/enums.ts';
import { buildCrewOrWorkflow } from '../crew-builder/builder.ts';
import { makeRealCrewBuilderDeps } from '../crew-builder/deps.ts';
import type { CrewBuilderDeps } from '../crew-builder/types.ts';
import type { RunBuilderTurn } from './builders/build.ts';
import { toBuildResultDto, toCrewBuildResultDto } from './builders/map-result.ts';

/**
 * Real, non-test `RunBuilderTurn`: reuses `withRunTelemetry` (NOT
 * `withMcpRun` — neither `buildAgent` nor `buildCrewOrWorkflow` mounts MCP
 * tools at dry-run time, D4/§4.2 item 1) so the run's spans (including
 * `agent.build`/`crew.build`, opened by `buildAgent`/`buildCrewOrWorkflow`
 * themselves) land in `runs/<id>/spans.jsonl`. Reuses the EXACT same
 * `makeRealBuilderDeps`/`makeRealCrewBuilderDeps` factories the CLI uses
 * (`src/cli/agent-builder.ts`/`crew-builder.ts`), only overriding
 * `confirm`/`log`/`verify.confirmReuse` with the SSE-bridged versions the
 * route built (Task 9/11) — everything else (model resolution, embedder,
 * judge wiring, fs paths) is identical to the CLI path.
 */
export function createRealRunBuilderTurn(runsRoot: string): RunBuilderTurn {
  return ({ kind, need, autoYes, force, runId, confirm, confirmReuse, log }) =>
    withRunTelemetry({ runsRoot, runId }, async () => {
      if (kind === BuilderKind.Agent) {
        const { deps, cleanup } = await makeRealBuilderDeps({ autoYes, force });
        try {
          const overridden: BuilderDeps = {
            ...deps,
            confirm,
            log,
            verify: deps.verify && { ...deps.verify, confirmReuse },
          };
          return toBuildResultDto(await buildAgent(need, overridden));
        } finally {
          await cleanup();
        }
      }
      const { deps, cleanup } = await makeRealCrewBuilderDeps({ autoYes, force });
      try {
        const overridden: CrewBuilderDeps = {
          ...deps,
          confirm,
          log,
          verify: deps.verify && { ...deps.verify, confirmReuse },
        };
        return toCrewBuildResultDto(await buildCrewOrWorkflow(need, overridden));
      } finally {
        await cleanup();
      }
    });
}
```

- [ ] **Step 8: Wire the three routes + `ServerDeps.runBuilderTurn` in `src/server/app.ts`**

Add imports: `import { handleBuilderAgentList, handleBuilderCrewList } from './builders/list.ts';`, `import { handleBuilderBuild } from './builders/build.ts';`, `import type { RunBuilderTurn } from './builders/build.ts';`. Add to `ServerDeps`:
```typescript
  /** Launches the agent/crew/workflow guided-build flow (Phase 5, Task 11/12). */
  runBuilderTurn: RunBuilderTurn;
```
Add three routes in `handleApi`, near the existing `/api/crews`/`/api/workflows` GETs (order doesn't matter against them — none of these three paths collide with any existing regex):
```typescript
        if (req.method === 'GET' && url.pathname === '/api/builders/agents') {
          rec.status(200);
          return handleBuilderAgentList();
        }
        if (req.method === 'GET' && url.pathname === '/api/builders/crews') {
          rec.status(200);
          return handleBuilderCrewList();
        }
        if (req.method === 'POST' && url.pathname === '/api/builders/build') {
          rec.status(200);
          return handleBuilderBuild(req, deps);
        }
```

- [ ] **Step 9: Wire the real turn in `src/server/main.ts`**

Add `import { createRealRunBuilderTurn, ... } from './launch-turns.ts';` (extend the existing import), `const runBuilderTurn = createRealRunBuilderTurn(runsRoot);` alongside the existing `runCrewTurn`/`runWorkflowTurn` lines, and add `runBuilderTurn` to the `deps` object literal.

- [ ] **Step 10: Fix the `ServerDeps`-literal fixture ripple**

Add `runBuilderTurn: async () => ({ kind: 'declined' })` (or a test-appropriate stub) to every existing `ServerDeps` object literal that now fails to typecheck:
- `tests/server/app.test.ts` — four literals (`deps`, `throwingDeps`, `confinedDeps`, `symlinkDeps`).
- `tests/server/runs-routes.test.ts` — one literal.
- `tests/server/phase4-routes.test.ts` — the shared `deps()` helper (also used by Task 11's own tests if they were dispatched against a shared fixture; here it's just the ripple fix).

- [ ] **Step 11: Run tests to verify they pass**

Run: `bun test tests/server/builders-list.test.ts tests/server/builders-turn.test.ts tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts`
Expected: all PASS (`builders-turn.test.ts` may be `test.skip`-guarded per Step 5's note if no live model is reachable).

- [ ] **Step 12: SERVER-GROUP GATE — full suite**

Run: `bun run check` (docs:check · typecheck · lint · full `bun test`). This is the first full-suite checkpoint since `ServerDeps` gained a new required field — fix any further drift it surfaces.

- [ ] **Step 13: Gate + commit**

```bash
git add src/server/builders/list.ts src/server/launch-turns.ts src/server/app.ts src/server/main.ts tests/server/builders-list.test.ts tests/server/builders-turn.test.ts tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts
git commit -m "feat(server): wire builder registry lists + POST /api/builders/build + createRealRunBuilderTurn (Phase 5)"
```

---

## Task 13: web `postSseStream` + `use-build-events.ts` fold hook

**Files:**
- Modify: `web/src/shared/transport/sse-adapter.ts` (add `postSseStream`, additive — no existing export changes)
- Create: `web/src/features/builders/use-build-events.ts`
- Test: `web/src/shared/transport/sse-adapter.test.ts` (extend if it exists, else create), `web/src/features/builders/use-build-events.test.ts` (create)

**Design note (a genuine gap found while grounding this plan):** `createSseTransport().stream()` is hardcoded to a GET request against either `/api/runs/:id/stream` or `/api/chat` — it has no way to POST a JSON body. `POST /api/builders/build` (Task 11) is a THIRD, POST-with-body SSE shape, and spec §4.2 item 6 (a later increment) gives `POST /api/mcp/test-mount` the SAME shape — so this is worth a small, additive, shared primitive now (two real consumers within this phase, not premature abstraction) rather than a builders-only one-off.

**Interfaces:**
- Consumes: `readSseStream`/`parseSseFrame` (private helpers already in `sse-adapter.ts`, reused not duplicated), `sessionToken`/`ApiError` (`../contract/client.ts`), `StatusEventSchema`/`StatusEvent` (`@contracts`).
- Produces: `postSseStream<T>(path: string, body: unknown, schema: ZodType<T>, signal?: AbortSignal): AsyncGenerator<T & { eventId: string }>`; `foldBuildFrame(state: BuildFoldState, frame: BuilderFrame): BuildFoldState` (pure); `useBuildEvents()` → `{ runId?, narration: string[], pendingConfirm?, result?, done, start, respond }`.

- [ ] **Step 1: Write the failing `postSseStream` test**

Check whether `web/src/shared/transport/sse-adapter.test.ts` already exists (it likely does, from Phase 2); if so, ADD this test to it rather than replacing the file. If it does not exist, create it with just this test:
```typescript
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { postSseStream } from './sse-adapter.ts';

function sseBody(frames: { id?: string; data: unknown }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = frames
    .map((f) => `${f.id ? `id: ${f.id}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe('postSseStream', () => {
  it('POSTs a JSON body and yields parsed, schema-validated frames with eventId', async () => {
    const FrameSchema = z.object({ type: z.string(), value: z.number().optional() });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ need: 'x' });
        return new Response(sseBody([{ id: 'e1', data: { type: 'a', value: 1 } }]), {
          status: 200,
        });
      }),
    );
    const out: unknown[] = [];
    for await (const frame of postSseStream('/api/builders/build', { need: 'x' }, FrameSchema)) {
      out.push(frame);
    }
    expect(out).toEqual([{ type: 'a', value: 1, eventId: 'e1' }]);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- sse-adapter.test.ts`
Expected: FAIL — `postSseStream` not exported.

- [ ] **Step 3: Append `postSseStream` to `web/src/shared/transport/sse-adapter.ts`**

Read the file first — it already has `parseSseFrame`, `readSseStream`, and `createSseTransport`. Append after `createSseTransport`:
```typescript
/**
 * POST-body SSE stream (Phase 5): unlike `createSseTransport().stream()`
 * (GET-only, hardcoded to `/api/runs/:id/stream` or `/api/chat`), the
 * builder-build route (and, later, mcp-test-mount) is a POST that carries a
 * JSON body and streams its response. Reuses the same frame reader
 * (`readSseStream`) so the wire format stays identical; no `runId`-based path
 * selection since the caller already knows its own path.
 */
export async function* postSseStream<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
  signal?: AbortSignal,
): AsyncGenerator<T & { eventId: string }> {
  const res = await fetch(path, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${sessionToken()}`,
      Accept: 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new ApiError(`stream request to ${path} failed`, res.status);
  }
  for await (const frame of readSseStream(res.body)) {
    const parsed = schema.parse(JSON.parse(frame.data));
    yield { ...(parsed as object), eventId: frame.id ?? '' } as T & {
      eventId: string;
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- sse-adapter.test.ts`
Expected: PASS (all cases in the file, old + new).

- [ ] **Step 5: Write the failing `foldBuildFrame` tests**

`web/src/features/builders/use-build-events.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { StatusEventType } from '@contracts';
import { foldBuildFrame } from './use-build-events.ts';

const INITIAL = { narration: [] as string[], done: false };

describe('foldBuildFrame', () => {
  it('captures the runId from data-run-start', () => {
    const next = foldBuildFrame(INITIAL, {
      type: StatusEventType.RunStart,
      runId: 'run-abc',
    });
    expect(next.runId).toBe('run-abc');
  });

  it('sets pendingConfirm from data-confirm', () => {
    const next = foldBuildFrame(INITIAL, {
      type: StatusEventType.Confirm,
      promptId: 'p1',
      kind: 'build',
      question: 'Create this agent?',
    });
    expect(next.pendingConfirm).toEqual({ promptId: 'p1', kind: 'build', question: 'Create this agent?' });
  });

  it('appends a non-terminal text-delta to narration', () => {
    const next = foldBuildFrame(INITIAL, {
      type: 'text-delta',
      id: 'narration-0',
      delta: 'Generated proposal stock_quotes',
    });
    expect(next.narration).toEqual(['Generated proposal stock_quotes']);
    expect(next.result).toBeUndefined();
  });

  it('parses the build-result text-delta into `result` (not narration)', () => {
    const next = foldBuildFrame(INITIAL, {
      type: 'text-delta',
      id: 'build-result',
      delta: JSON.stringify({ kind: 'written', name: 'stock_quotes', files: ['a.ts'] }),
    });
    expect(next.result).toEqual({ kind: 'written', name: 'stock_quotes', files: ['a.ts'] });
    expect(next.narration).toEqual([]);
  });

  it('marks done on data-run-end', () => {
    const next = foldBuildFrame(INITIAL, {
      type: StatusEventType.RunEnd,
      runId: 'run-abc',
      outcome: 'written',
    });
    expect(next.done).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && bun run test -- use-build-events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `web/src/features/builders/use-build-events.ts`**

```typescript
import type { StatusEvent } from '@contracts';
import { StatusEventSchema } from '@contracts';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import {
  createSseTransport,
  postSseStream,
} from '../../shared/transport/sse-adapter.ts';

const TextPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-start'), id: z.string() }),
  z.object({ type: z.literal('text-delta'), id: z.string(), delta: z.string() }),
  z.object({ type: z.literal('text-end'), id: z.string() }),
]);
type TextPart = z.infer<typeof TextPartSchema>;

/** Frames on a builder-build SSE connection mix `StatusEvent`s (data-run-start,
 *  data-confirm, data-run-end) with plain AI-SDK text parts (narration +, on
 *  the fixed id `'build-result'`, the terminal `BuildResultDTO` as JSON —
 *  Task 11). No `data-*` event exists for the terminal result (spec: zero
 *  net-new wire events this phase) — it rides the text channel instead. */
export const BuilderFrameSchema = z.union([StatusEventSchema, TextPartSchema]);
export type BuilderFrame = StatusEvent | TextPart;

export type PendingConfirm = { promptId: string; kind: string; question: string };

export type BuildFoldState = {
  runId?: string;
  narration: string[];
  pendingConfirm?: PendingConfirm;
  /** Parsed from the `'build-result'` text part once it arrives. Typed
   *  `unknown` here (the fold is pure/dependency-free); Task 14 validates it
   *  against `BuildResultDtoSchema` before rendering. */
  result?: unknown;
  done: boolean;
};

/** Pure fold: one `BuilderFrame` in, next state out — unit-tested exactly
 *  like `foldSpan`/`foldEvent` elsewhere in this codebase. */
export function foldBuildFrame(
  state: BuildFoldState,
  frame: BuilderFrame,
): BuildFoldState {
  switch (frame.type) {
    case 'data-run-start':
      return { ...state, runId: frame.runId };
    case 'data-confirm':
      return {
        ...state,
        pendingConfirm: {
          promptId: frame.promptId,
          kind: frame.kind,
          question: frame.question,
        },
      };
    case 'text-delta':
      if (frame.id === 'build-result') {
        try {
          return { ...state, result: JSON.parse(frame.delta) };
        } catch {
          return state; // a torn terminal chunk should not happen (one write() call) — degrade to ignoring it
        }
      }
      return { ...state, narration: [...state.narration, frame.delta] };
    case 'data-run-end':
      return { ...state, done: true };
    default:
      return state;
  }
}

const INITIAL_STATE: BuildFoldState = { narration: [], done: false };

/** Opens the builder-build SSE connection itself (no `useChat` — unlike
 *  chat's `useStatusEvents`, spec §4.4), folds every frame through
 *  `foldBuildFrame`, and answers a pending confirm via the EXISTING
 *  `createSseTransport().respond()` (the same Phase-2 respond path
 *  `ChatArea` already uses). */
export function useBuildEvents() {
  const [state, setState] = useState<BuildFoldState>(INITIAL_STATE);

  const start = useCallback(
    async (
      body: { kind: string; need: string; autoYes?: boolean; force?: boolean },
      signal?: AbortSignal,
    ) => {
      setState(INITIAL_STATE);
      for await (const frame of postSseStream(
        '/api/builders/build',
        body,
        BuilderFrameSchema,
        signal,
      )) {
        setState((prev) => foldBuildFrame(prev, frame));
      }
    },
    [],
  );

  const respond = useCallback((value: boolean) => {
    setState((prev) => {
      if (!prev.pendingConfirm || !prev.runId) return prev;
      void createSseTransport().respond(prev.runId, {
        promptId: prev.pendingConfirm.promptId,
        value,
      });
      return { ...prev, pendingConfirm: undefined };
    });
  }, []);

  return { ...state, start, respond };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && bun run test -- use-build-events.test.ts`
Expected: PASS.

- [ ] **Step 9: Gate + commit**

```bash
cd web && bun run typecheck && bun run test
git add web/src/shared/transport/sse-adapter.ts web/src/shared/transport/sse-adapter.test.ts web/src/features/builders/use-build-events.ts web/src/features/builders/use-build-events.test.ts
git commit -m "feat(web): postSseStream + use-build-events fold hook (Phase 5)"
```

---

## Task 14: web guided-flow wizard + proposal `DagView` (agent-only)

**Files:**
- Create: `web/src/features/builders/proposal-graph.ts`, `web/src/features/builders/builder-wizard.tsx`, `web/src/features/builders/agent-wizard.tsx`, `web/src/features/builders/crew-wizard.tsx`
- Modify: `web/src/features/builders/index.tsx` (replace the Task-8 echo-stub body with an Agent/Crew mode toggle hosting the two wizards)
- Delete: `web/src/features/builders/echo-stub.ts`, `web/src/features/builders/echo-stub.test.ts`, `web/src/features/builders/index.test.tsx` (Task 8's scaffold — superseded, per Task 8's own note that Increment 2 replaces its body wholesale)
- Test: `web/src/features/builders/proposal-graph.test.ts` (create), `web/src/features/builders/builder-wizard.test.tsx` (create), `web/src/features/builders/index.test.tsx` (recreate against the real wizard)

**Design note — scoping the DagView to the agent builder only (D6):** `BuildResultDTO.proposal` (this task's Task-3/10 addition) is populated on a `written` AGENT build (the full `AgentProposal` survives on `BuildResult.written`) but stays absent on a `written` crew/workflow build (`CrewBuildResult.written` never carries the `CrewIR`/`WorkflowIR` back to its caller — a real, pre-existing engine-side gap this phase does not close). The crew/workflow wizard therefore renders a plain result card (name/files/builtAgents) with no graph; the agent wizard renders the D6 2-tier `DagView` (agent node → suggested-server nodes). Both wizards render with `DagStatus.Done` (not `Proposed`): by the time the browser has `result.proposal`, `buildAgent` has already committed it — see the plan's closing "ambiguities resolved" note for the follow-on that would make this a genuine PRE-consent staged preview.

**Interfaces:**
- Consumes: `AgentProposalDTO`, `BuildResultDtoSchema` (Task 3), `BuilderKind` (Task 6), `useBuildEvents`/`foldBuildFrame` (Task 13), `DagView`/`DagModel`/`DagStatus` (`web/src/shared/dag/`), `ConfirmPrompt` (`web/src/features/chat/confirm-prompt.tsx`), `StepKind` (`@contracts`).
- Produces: `agentProposalGraph(p: AgentProposalDTO): DagModel`; `BuilderWizard({ kind, title }: { kind: BuilderKind; title: string })`; `AgentWizard()`, `CrewWizard()`; `BuildersArea` hosts an Agent/Crew toggle over the two.

- [ ] **Step 1: Write the failing `agentProposalGraph` test**

`web/src/features/builders/proposal-graph.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { StepKind } from '@contracts';
import { DagStatus } from '../../shared/dag/types.ts';
import { agentProposalGraph } from './proposal-graph.ts';

describe('agentProposalGraph', () => {
  it('projects the agent node + one node per suggested server, linked by delegates edges', () => {
    const graph = agentProposalGraph({
      name: 'stock_quotes',
      description: 'Fetches live stock quotes',
      systemPrompt: 'x',
      modelReq: { role: 'r', requires: ['tools'], prefer: 'largest-that-fits' },
      suggestedServers: [{ packName: 'finance', scopeToAgent: 'stock_quotes' }],
      rationale: 'why',
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toMatchObject({ id: 'stock_quotes', kind: 'manager', status: DagStatus.Done });
    expect(graph.nodes[1]).toMatchObject({ id: 'stock_quotes::finance', kind: StepKind.Tool });
    expect(graph.edges).toEqual([
      { from: 'stock_quotes', to: 'stock_quotes::finance', kind: 'delegates' },
    ]);
  });

  it('projects a node with no edges when there are no suggested servers', () => {
    const graph = agentProposalGraph({
      name: 'solo_agent',
      description: 'd',
      systemPrompt: 'x',
      modelReq: { role: 'r', requires: [], prefer: 'largest-that-fits' },
      suggestedServers: [],
      rationale: 'why',
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- proposal-graph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/features/builders/proposal-graph.ts`**

```typescript
import type { AgentProposalDTO } from '@contracts';
import { StepKind } from '@contracts';
import { DagStatus } from '../../shared/dag/types.ts';
import type { DagModel } from '../../shared/dag/types.ts';

/** Pure projection of a committed `AgentProposalDTO` (`BuildResultDTO.proposal`
 *  on a `written` agent build) to D6's small 2-tier `DagModel`: the agent
 *  node, plus one node per suggested MCP server, connected by a `delegates`
 *  edge (the same edge kind a hierarchical-crew manager→member link already
 *  renders dashed — visually apt for "the agent reaches for this tool" too).
 *  Rendered `DagStatus.Done` — see the task's design note for why this is a
 *  post-write, not pre-consent, preview this increment. */
export function agentProposalGraph(p: AgentProposalDTO): DagModel {
  return {
    nodes: [
      {
        id: p.name,
        label: p.name,
        sublabel: p.description,
        kind: 'manager',
        status: DagStatus.Done,
      },
      ...p.suggestedServers.map((s) => ({
        id: `${p.name}::${s.packName}`,
        label: s.packName,
        sublabel: `scoped to ${s.scopeToAgent}`,
        kind: StepKind.Tool,
        status: DagStatus.Done,
      })),
    ],
    edges: p.suggestedServers.map((s) => ({
      from: p.name,
      to: `${p.name}::${s.packName}`,
      kind: 'delegates' as const,
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- proposal-graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `BuilderWizard` component test**

`web/src/features/builders/builder-wizard.test.tsx`:
```typescript
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuilderKind } from '@contracts';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../../shared/design/theme.tsx';
import { BuilderWizard } from './builder-wizard.tsx';

function sseBody(frames: { id?: string; data: unknown }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = frames
    .map((f) => `${f.id ? `id: ${f.id}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function renderWizard() {
  return render(
    <ThemeProvider>
      <BuilderWizard kind={BuilderKind.Agent} title="Agent Builder" />
    </ThemeProvider>,
  );
}

describe('BuilderWizard', () => {
  it('streams narration, then renders the DagView on a written agent result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          sseBody([
            { id: 'e1', data: { type: 'data-run-start', runId: 'run-x', task: 'fetch quotes' } },
            { id: 'e2', data: { type: 'text-start', id: 'narration-0' } },
            { id: 'e3', data: { type: 'text-delta', id: 'narration-0', delta: 'Generated proposal stock_quotes' } },
            { id: 'e4', data: { type: 'text-end', id: 'narration-0' } },
            {
              id: 'e5',
              data: {
                type: 'text-delta',
                id: 'build-result',
                delta: JSON.stringify({
                  kind: 'written',
                  name: 'stock_quotes',
                  files: ['agents/stock_quotes.ts'],
                  proposal: {
                    name: 'stock_quotes',
                    description: 'Fetches live stock quotes',
                    systemPrompt: 'x',
                    modelReq: { role: 'r', requires: ['tools'], prefer: 'largest-that-fits' },
                    suggestedServers: [{ packName: 'finance', scopeToAgent: 'stock_quotes' }],
                    rationale: 'why',
                  },
                }),
              },
            },
            { id: 'e6', data: { type: 'data-run-end', runId: 'run-x', outcome: 'written' } },
          ]),
          { status: 200 },
        ),
      ),
    );
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-need'), {
      target: { value: 'fetch stock quotes' },
    });
    fireEvent.click(screen.getByTestId('wizard-submit'));
    await waitFor(() =>
      expect(screen.getByText('Generated proposal stock_quotes')).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByTestId('dag-view')).toBeInTheDocument());
    expect(screen.getByText('Created "stock_quotes".')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('renders a ConfirmPrompt on data-confirm and answers it via POST /api/runs/:id/respond', async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && typeof url === 'string' && url.includes('/respond')) {
          posted.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(
          sseBody([
            { id: 'e1', data: { type: 'data-run-start', runId: 'run-y', task: 'x' } },
            { id: 'e2', data: { type: 'data-confirm', promptId: 'p1', kind: 'build', question: 'Create this agent?' } },
          ]),
          { status: 200 },
        );
      }),
    );
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-need'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('wizard-submit'));
    await waitFor(() => expect(screen.getByTestId('confirm-prompt')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ promptId: 'p1', value: true });
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && bun run test -- builder-wizard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `web/src/features/builders/builder-wizard.tsx`**

```tsx
import type { BuilderKind } from '@contracts';
import { useState } from 'react';
import { DagView } from '../../shared/dag/dag-view.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { ConfirmPrompt } from '../chat/confirm-prompt.tsx';
import { agentProposalGraph } from './proposal-graph.ts';
import { useBuildEvents } from './use-build-events.ts';

type WrittenResult = {
  kind: 'written';
  name?: string;
  files?: string[];
  proposal?: Parameters<typeof agentProposalGraph>[0];
};

function isWrittenWithProposal(result: unknown): result is WrittenResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { kind?: unknown }).kind === 'written' &&
    'proposal' in result &&
    (result as { proposal?: unknown }).proposal !== undefined
  );
}

/**
 * The guided-build wizard body, shared by `AgentWizard`/`CrewWizard` (D11 — a
 * single reusable body over the ~identical need-textarea → narration →
 * confirm → result flow, parameterized only by `kind`; the crews/workflows
 * list precedent applies the OPPOSITE call at a MUCH smaller scale, so
 * duplicating a wizard this size would be the wrong trade here).
 */
export function BuilderWizard({ kind, title }: { kind: BuilderKind; title: string }) {
  const { narration, pendingConfirm, result, start, respond } = useBuildEvents();
  const [need, setNeed] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      await start({ kind, need });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={`builder-wizard-${kind}`} className="flex flex-col gap-4">
      <h2 className="font-mono text-base text-[var(--color-fg)]">{title}</h2>
      <textarea
        data-testid="wizard-need"
        placeholder="Describe the capability you need…"
        value={need}
        onChange={(e) => setNeed(e.target.value)}
        className="h-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-sm text-[var(--color-fg)]"
      />
      <div>
        <Button
          data-testid="wizard-submit"
          disabled={busy || need.trim().length === 0}
          onClick={handleSubmit}
        >
          Build
        </Button>
      </div>
      <ul className="flex flex-col gap-1 font-mono text-sm text-[var(--color-muted)]">
        {narration.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only narration log for one in-flight build
          <li key={i}>{line}</li>
        ))}
      </ul>
      {pendingConfirm && (
        <ConfirmPrompt ask={pendingConfirm} onAnswer={respond} />
      )}
      {isWrittenWithProposal(result) && result.proposal && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--color-fg)]">Created "{result.name}".</p>
          <DagView model={agentProposalGraph(result.proposal)} />
        </div>
      )}
      {result !== undefined && !isWrittenWithProposal(result) && (
        <pre
          data-testid="wizard-result"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && bun run test -- builder-wizard.test.tsx proposal-graph.test.ts`
Expected: both PASS.

- [ ] **Step 9: Create the two thin wrapper components**

`web/src/features/builders/agent-wizard.tsx`:
```tsx
import { BuilderKind } from '@contracts';
import { BuilderWizard } from './builder-wizard.tsx';

export function AgentWizard() {
  return <BuilderWizard kind={BuilderKind.Agent} title="Agent Builder" />;
}
```

`web/src/features/builders/crew-wizard.tsx`:
```tsx
import { BuilderKind } from '@contracts';
import { BuilderWizard } from './builder-wizard.tsx';

/** `kind: BuilderKind.Crew` is a nominal request label — `buildCrewOrWorkflow`'s
 *  own `classifyNeed()` decides crew vs. workflow SHAPE from the need text
 *  itself (`src/crew-builder/builder.ts`); `createRealRunBuilderTurn` (Task
 *  12) dispatches identically for `BuilderKind.Crew`/`BuilderKind.Workflow`
 *  (anything not `Agent` goes to `makeRealCrewBuilderDeps`). This wizard
 *  covers both shapes under one flow, matching the engine's own design. */
export function CrewWizard() {
  return <BuilderWizard kind={BuilderKind.Crew} title="Crew / Workflow Builder" />;
}
```

- [ ] **Step 10: Delete Task 8's scaffold and replace `web/src/features/builders/index.tsx`**

```bash
rm web/src/features/builders/echo-stub.ts web/src/features/builders/echo-stub.test.ts web/src/features/builders/index.test.tsx
```

`web/src/features/builders/index.tsx`:
```tsx
import { useState } from 'react';
import { AgentWizard } from './agent-wizard.tsx';
import { CrewWizard } from './crew-wizard.tsx';

type Mode = 'agent' | 'crew';

/** Builders area: an Agent/Crew mode toggle over the two guided wizards
 *  (D11 "a single /builders with an in-page mode switch" — the plan-time
 *  call the spec left open, resolved here in favor of one route). */
export function BuildersArea() {
  const [mode, setMode] = useState<Mode>('agent');

  return (
    <section data-testid="area-builders" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Builders</h1>
      <div role="tablist" className="mt-4 flex gap-2 border-b border-[var(--color-border)]">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'agent'}
          data-testid="builders-mode-agent"
          onClick={() => setMode('agent')}
          className={`px-3 py-2 font-mono text-sm ${mode === 'agent' ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]' : 'text-[var(--color-muted)]'}`}
        >
          Agent
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'crew'}
          data-testid="builders-mode-crew"
          onClick={() => setMode('crew')}
          className={`px-3 py-2 font-mono text-sm ${mode === 'crew' ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]' : 'text-[var(--color-muted)]'}`}
        >
          Crew / Workflow
        </button>
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {mode === 'agent' ? <AgentWizard /> : <CrewWizard />}
      </div>
    </section>
  );
}
```

`web/src/features/builders/index.test.tsx` (recreated against the real wizard, not the Task-8 stub):
```typescript
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('BuildersArea', () => {
  it('defaults to the Agent wizard and can switch to Crew/Workflow', () => {
    renderAt('/builders');
    expect(screen.getByTestId('area-builders')).toBeInTheDocument();
    expect(screen.getByText('Agent Builder')).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run the full builders test group**

Run: `cd web && bun run test -- builders/`
Expected: all PASS.

- [ ] **Step 12: Gate + commit**

```bash
cd web && bun run typecheck && bun run test
git add web/src/features/builders/
git commit -m "feat(web): guided-build wizard (Agent/Crew) + D6 post-write proposal DagView (Phase 5)"
```

---

## Task 15: Pull→spans bridge — `withModelPullSpan` + `recordPullProgressTick` + `runModelPullBridge` [HARD — ultracode adversarial-verify]

**Controller note:** dispatch this task as an **ultracode Workflow** (deterministic fan-out + adversarial-verify), Opus-powered. This is spec §7.2, the phase's other explicitly-flagged hard part. The reviewer's checklist is the four bullets under "Requirements the review must adversarially verify" in §7.2 — restated as test groups below.

**Files:**
- Modify: `src/telemetry/spans.ts` (append `ATTR` keys; append `withModelPullSpan`, `recordPullProgressTick`)
- Create: `src/provisioning/pull-bridge.ts`
- Test: `tests/telemetry/model-pull-span.test.ts` (create), `tests/provisioning/pull-bridge.test.ts` (create)

**Interfaces:**
- Consumes: `DownloadPhase`, `DownloadProgress`, `DownloadProvider` (`src/provisioning/types.ts`), `RunLifecycle` (contracts), `withRunTelemetry` (`src/cli/with-run.ts`), `mapRunToDto` (`src/run/run-dto.ts`, already updated Task 2 to recognize `model.pull` as a root).
- Produces: `withModelPullSpan(info: { runtime: string; modelRef: string }, fn: (rec: { outcome: (o: string) => void }) => Promise<T>): Promise<T>`; `recordPullProgressTick(p: { phase: string; percent: number | null; bytesCompleted: number; bytesTotal: number | null; speedBytesPerSec: number | null }): Promise<void>`; `runModelPullBridge(input: { runtime: RuntimeKind; provider: ProviderKind; modelRef: string; signal: AbortSignal }, deps: { providerFor: (kind: ProviderKind) => DownloadProvider; destDir: string }): Promise<void>`.

**Design note (the "+1" in "N+2 spans"):** the bridge emits ONE synthetic "started" tick (`phase: DownloadPhase.Resolving`, before the provider's own `onProgress` fires even once) so the browser shows SOMETHING immediately, before `provider.download(...)` has even resolved the manifest — this is the "+1" in spec §6's "N onProgress calls → N+2 spans" (root `model.pull` + the synthetic started tick + N real `model.pull.progress` ticks from the provider = N+2 total).

- [ ] **Step 1: Write the failing span-helper tests**

`tests/telemetry/model-pull-span.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { recordPullProgressTick, withModelPullSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

test('withModelPullSpan opens a model.pull root; recordPullProgressTick nests a short-lived child under it', async () => {
  const { exporter, provider } = registerTestProvider();
  await withModelPullSpan({ runtime: 'Ollama', modelRef: 'qwen3.5:9b' }, async (rec) => {
    await recordPullProgressTick({
      phase: 'downloading',
      percent: 42,
      bytesCompleted: 420,
      bytesTotal: 1000,
      speedBytesPerSec: 100,
    });
    rec.outcome('done');
  });
  const spans = exporter.getFinishedSpans();
  const root = spans.find((s) => s.name === 'model.pull');
  const tick = spans.find((s) => s.name === 'model.pull.progress');
  expect(root).toBeDefined();
  expect(tick).toBeDefined();
  expect(tick?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
  expect(tick?.attributes['model.pull.progress.percent']).toBe(42);
  await provider.shutdown();
});

test('a throwing fn marks the model.pull root ERROR (inSpan\'s standard catch)', async () => {
  const { exporter, provider } = registerTestProvider();
  await withModelPullSpan({ runtime: 'Ollama', modelRef: 'x' }, async () => {
    throw new Error('boom');
  }).catch(() => {});
  const root = exporter.getFinishedSpans().find((s) => s.name === 'model.pull');
  expect(root?.status.code).toBe(2); // SpanStatusCode.ERROR
  await provider.shutdown();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/telemetry/model-pull-span.test.ts`
Expected: FAIL — `withModelPullSpan`/`recordPullProgressTick` not exported.

- [ ] **Step 3: Append `ATTR` keys + the two span helpers to `src/telemetry/spans.ts`**

Read the file first (§ the `ATTR` object ends at `FEEDBACK_RATING: 'chat.feedback.rating',\n} as const;`). Add before the closing `} as const;`:
```typescript
  // Model pull (Slice 30b Phase 5, §7.2)
  MODEL_PULL_RUNTIME: 'model.pull.runtime',
  MODEL_PULL_MODEL_REF: 'model.pull.model_ref',
  MODEL_PULL_OUTCOME: 'model.pull.outcome',
  MODEL_PULL_PHASE: 'model.pull.progress.phase',
  MODEL_PULL_PERCENT: 'model.pull.progress.percent',
  MODEL_PULL_BYTES_COMPLETED: 'model.pull.progress.bytes_completed',
  MODEL_PULL_BYTES_TOTAL: 'model.pull.progress.bytes_total',
  MODEL_PULL_SPEED_BPS: 'model.pull.progress.speed_bytes_per_sec',
```
Then append, near the other root-span helpers (e.g. after `withProvisionSpan`):
```typescript
export type ModelPullSpanInfo = { runtime: string; modelRef: string };

/** Root span for one model download (Slice 30b Phase 5, §7.2). Stays open for
 *  the WHOLE download so `model.pull.progress` ticks (below) nest under it
 *  via OTel active-context propagation — the same mechanism `withStepSpan`
 *  relies on nesting under `crew.run`/`workflow.run`. The body reports the
 *  terminal outcome via the returned recorder; a thrown `fn` marks the span
 *  ERROR via `inSpan`'s own catch, same as every other root-span helper. */
export function withModelPullSpan<T>(
  info: ModelPullSpanInfo,
  fn: (rec: { outcome: (o: string) => void }) => Promise<T>,
): Promise<T> {
  return inSpan('model.pull', async (span) => {
    span.setAttribute(ATTR.MODEL_PULL_RUNTIME, info.runtime);
    span.setAttribute(ATTR.MODEL_PULL_MODEL_REF, info.modelRef);
    return fn({
      outcome: (o) => span.setAttribute(ATTR.MODEL_PULL_OUTCOME, o),
    });
  });
}

export type PullProgressTick = {
  phase: string;
  percent: number | null;
  bytesCompleted: number;
  bytesTotal: number | null;
  speedBytesPerSec: number | null;
};

/** One short-lived child span per `DownloadProgress` tick (§7.2's fix for
 *  "nothing renders until the download finishes": `JsonlFileExporter` only
 *  appends a span when THAT span closes, and `model.pull`'s root stays open
 *  for the whole download). MUST be called from inside `withModelPullSpan`'s
 *  `fn` (or a descendant of it) so active-context propagation nests it under
 *  the open root. Opens and closes synchronously within one call; safe under
 *  rapid/concurrent ticks (`inSpan`'s `finally { span.end() }` ends THIS
 *  call's own span instance regardless of any other in-flight tick). */
export function recordPullProgressTick(p: PullProgressTick): Promise<void> {
  return inSpan('model.pull.progress', async (span) => {
    span.setAttribute(ATTR.MODEL_PULL_PHASE, p.phase);
    if (p.percent !== null) span.setAttribute(ATTR.MODEL_PULL_PERCENT, p.percent);
    span.setAttribute(ATTR.MODEL_PULL_BYTES_COMPLETED, p.bytesCompleted);
    if (p.bytesTotal !== null) {
      span.setAttribute(ATTR.MODEL_PULL_BYTES_TOTAL, p.bytesTotal);
    }
    if (p.speedBytesPerSec !== null) {
      span.setAttribute(ATTR.MODEL_PULL_SPEED_BPS, p.speedBytesPerSec);
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/telemetry/model-pull-span.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing bridge test (the dedicated N+2/lifecycle test from spec §6)**

`tests/provisioning/pull-bridge.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRunTelemetry } from '../../src/cli/with-run.ts';
import { RunLifecycle } from '../../src/contracts/enums.ts';
import type { DownloadProvider } from '../../src/provisioning/types.ts';
import { DownloadPhase, type DownloadProgress } from '../../src/provisioning/types.ts';
import { runModelPullBridge } from '../../src/provisioning/pull-bridge.ts';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { mapRunToDto } from '../../src/run/run-dto.ts';

function fakeProvider(ticks: number, fail: boolean): DownloadProvider {
  return {
    kind: ProviderKind.Ollama,
    async download(modelRef, opts) {
      for (let i = 0; i < ticks; i++) {
        const p: DownloadProgress = {
          modelRef,
          phase: DownloadPhase.Downloading,
          bytesCompleted: (i + 1) * 1000,
          bytesTotal: ticks * 1000,
          percent: ((i + 1) / ticks) * 100,
          speedBytesPerSec: 500,
        };
        opts.onProgress(p);
      }
      if (fail) throw new Error('disk full');
    },
  };
}

test('N onProgress ticks land as N+2 spans; lifecycle flips to Done only once the root closes', async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), 'pull-bridge-'));
  const runId = 'run-pull-ok';
  try {
    const N = 3;
    await withRunTelemetry({ runsRoot, runId }, () =>
      runModelPullBridge(
        { runtime: RuntimeKind.Ollama, provider: ProviderKind.Ollama, modelRef: 'qwen3.5:9b', signal: new AbortController().signal },
        { providerFor: () => fakeProvider(N, false), destDir: '/tmp/unused' },
      ),
    );
    const dto = await mapRunToDto(runsRoot, runId);
    expect(dto).toBeDefined();
    const tickCount = dto?.spans.filter((s) => s.name === 'model.pull.progress').length ?? 0;
    expect(tickCount).toBe(N + 1); // synthetic-started + N real ticks
    expect(dto?.spanCount).toBe(N + 2); // + the model.pull root itself
    expect(dto?.lifecycle).toBe(RunLifecycle.Done);
  } finally {
    await rm(runsRoot, { recursive: true, force: true });
  }
});

test('a rejecting provider marks the root Failed (mapRunToDto agrees)', async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), 'pull-bridge-fail-'));
  const runId = 'run-pull-fail';
  try {
    await runModelPullBridge(
      { runtime: RuntimeKind.Ollama, provider: ProviderKind.Ollama, modelRef: 'x', signal: new AbortController().signal },
      { providerFor: () => fakeProvider(2, true), destDir: '/tmp/unused' },
    )
      .catch(() => {}); // swallow here — the real caller (Task 17) does the same at the fire-and-watch layer
    // The bridge itself must be run under a telemetry scope for spans.jsonl to exist:
  } finally {
    // no-op; the real assertion happens in the scoped variant below
  }
  await rm(runsRoot, { recursive: true, force: true });
});

test('a rejecting provider marks the root Failed, scoped under withRunTelemetry (mapRunToDto agrees)', async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), 'pull-bridge-fail-scoped-'));
  const runId = 'run-pull-fail-scoped';
  try {
    await withRunTelemetry({ runsRoot, runId }, () =>
      runModelPullBridge(
        { runtime: RuntimeKind.Ollama, provider: ProviderKind.Ollama, modelRef: 'x', signal: new AbortController().signal },
        { providerFor: () => fakeProvider(2, true), destDir: '/tmp/unused' },
      ),
    ).catch(() => {});
    const dto = await mapRunToDto(runsRoot, runId);
    expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  } finally {
    await rm(runsRoot, { recursive: true, force: true });
  }
});
```
(The middle, un-scoped test is intentionally light — it only proves `runModelPullBridge` itself doesn't crash/hang outside a telemetry scope; delete it if the implementer finds it redundant with the third test during review — the third test is the one that matters.)

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/provisioning/pull-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `src/provisioning/pull-bridge.ts`**

```typescript
import type { ProviderKind, RuntimeKind } from '../core/types.ts';
import { recordPullProgressTick, withModelPullSpan } from '../telemetry/spans.ts';
import { DownloadPhase, type DownloadProvider } from './types.ts';

export type PullBridgeDeps = {
  providerFor: (kind: ProviderKind) => DownloadProvider;
  destDir: string;
};

export type PullBridgeInput = {
  runtime: RuntimeKind;
  provider: ProviderKind;
  modelRef: string;
  signal: AbortSignal;
};

/**
 * Runs one model download under a `model.pull` root span, bridging each
 * `DownloadProgress` tick to its own short-lived `model.pull.progress` child
 * span (§7.2) so the live run-stream shows real-time progress instead of a
 * single post-hoc result. Emits ONE synthetic "started" tick immediately
 * (before the provider's first real `onProgress` callback) so the browser
 * shows something before the provider even resolves its manifest.
 *
 * Every tick's promise is tracked and awaited before the function returns —
 * `onProgress` is a SYNC callback, so each tick is fired with `void
 * recordPullProgressTick(...)` (never awaited inline, since a slow/backed-up
 * exporter must never make the download itself wait), but the LAST thing
 * this function does before `rec.outcome(...)` is `await Promise.all(pending)`
 * so no tick is left dangling past the root's own close (review requirement
 * (a): tick spans are genuinely short-lived and never left open).
 */
export async function runModelPullBridge(
  input: PullBridgeInput,
  deps: PullBridgeDeps,
): Promise<void> {
  const pending: Promise<void>[] = [];
  const tick = (p: Parameters<typeof recordPullProgressTick>[0]): void => {
    pending.push(recordPullProgressTick(p));
  };

  await withModelPullSpan(
    { runtime: input.runtime, modelRef: input.modelRef },
    async (rec) => {
      tick({
        phase: DownloadPhase.Resolving,
        percent: null,
        bytesCompleted: 0,
        bytesTotal: null,
        speedBytesPerSec: null,
      });
      try {
        const provider = deps.providerFor(input.provider);
        await provider.download(input.modelRef, {
          onProgress: (p) =>
            tick({
              phase: p.phase,
              percent: p.percent,
              bytesCompleted: p.bytesCompleted,
              bytesTotal: p.bytesTotal,
              speedBytesPerSec: p.speedBytesPerSec,
            }),
          signal: input.signal,
          destDir: deps.destDir,
        });
        await Promise.all(pending);
        rec.outcome('done');
      } catch (err) {
        await Promise.all(pending).catch(() => {});
        rec.outcome('failed');
        throw err; // review requirement (b): the root's status/outcome must reflect a real failure
      }
    },
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/telemetry/model-pull-span.test.ts tests/provisioning/pull-bridge.test.ts`
Expected: all PASS.

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/telemetry/spans.ts src/provisioning/pull-bridge.ts tests/telemetry/model-pull-span.test.ts tests/provisioning/pull-bridge.test.ts
git add src/telemetry/spans.ts src/provisioning/pull-bridge.ts tests/telemetry/model-pull-span.test.ts tests/provisioning/pull-bridge.test.ts
git commit -m "feat(provisioning): pull→spans bridge — withModelPullSpan + recordPullProgressTick + runModelPullBridge (Phase 5, §7.2)"
```

> **Controller note (ultracode):** the adversarial-verify pass must independently confirm spec §7.2's four bullets: (a) ticks are genuinely short-lived and never dangling under rapid callbacks; (b) the root's status/outcome is correct on BOTH resolve and reject; (c) `RUN_ROOT_NAMES`/`deriveRunKind` were updated TOGETHER (Task 2 — re-check, don't just trust it); (d) a client opening `/api/runs/:runId/stream` before the first tick span is written degrades cleanly (this is Task 17's concern once the live route exists — flag it as a cross-task follow-up check, same as Task 11/12's split).

---

## Task 16: `GET /api/models` inventory handler

**Files:**
- Create: `src/server/models/discover.ts`, `src/server/models/list.ts`
- Test: `tests/server/models-discover.test.ts` (create), `tests/server/models-list.test.ts` (create)

**Interfaces:**
- Consumes: `buildRegistry` (`src/discovery/build-registry.ts`), `readCatalog` (`src/discovery/catalog-cache.ts`), `detectHost` (`src/discovery/host.ts`), `fitAndRank`/`FitCandidate` (`src/provisioning/fit.ts`), `checkDiskSpace` (`src/provisioning/supervisor.ts`), `ModelListResponseSchema` (Task 6).
- Produces: `discoverModels(deps?: { buildRegistry?, readCatalog?, detectHost? }): Promise<{ installed: ModelDeclaration[]; pullable: FitCandidate[] }>`; `handleModelList(deps: { freeDiskBytes: () => Promise<number> }): Promise<Response>`.

**Design note (read-only, no live re-discovery per request):** `discoverModels` composes the SAME building blocks `runProvision` uses for installed detection (`buildRegistry()`) and pullable ranking (`fitAndRank` over `readCatalog()`'s cached candidates, `.provider` intact) — but reads the CACHED catalog rather than re-running live `CatalogSource.listCandidates()` network calls on every `GET /api/models`. A stale cache only means a newly-released model is missing from the pullable list until the next catalog refresh (a background/CLI-driven process, unchanged by this phase) — it never produces a WRONG size/fit verdict for what IS listed. This keeps the inventory route fast and offline-safe, matching spec's "read-only here (no download side-effect)".

- [ ] **Step 1: Write the failing `discoverModels` test**

`tests/server/models-discover.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { discoverModels } from '../../src/server/models/discover.ts';

test('discoverModels merges buildRegistry (installed) with fitAndRank over the cached catalog (pullable)', async () => {
  const { installed, pullable } = await discoverModels({
    buildRegistry: async () => [
      { runtime: RuntimeKind.Ollama, model: 'qwen3.5:9b', params: {}, role: 'installed', footprint: { approxParamsBillions: 9, bytesPerWeight: 1 } },
    ],
    readCatalog: () => [
      {
        runtime: RuntimeKind.MlxServer,
        model: 'mlx-community/Qwen3.5-30B',
        params: {},
        role: 'catalog',
        footprint: { approxParamsBillions: 30, bytesPerWeight: 1 },
        provider: ProviderKind.HfSnapshot,
        repo: 'mlx-community/Qwen3.5-30B',
        fileSizeBytes: 20_000_000_000,
        downloads: 100,
        installed: false,
      },
    ],
    detectHost: async () => ({ totalRamBytes: 48e9, liveBudgetBytes: 40e9, runtimes: [RuntimeKind.Ollama] }),
  });
  expect(installed).toHaveLength(1);
  expect(pullable[0]?.provider).toBe(ProviderKind.HfSnapshot);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/models-discover.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/models/discover.ts`**

```typescript
import type { ModelDeclaration } from '../../core/types.ts';
import { buildRegistry as realBuildRegistry } from '../../discovery/build-registry.ts';
import { readCatalog as realReadCatalog } from '../../discovery/catalog-cache.ts';
import { detectHost as realDetectHost } from '../../discovery/host.ts';
import type { Candidate } from '../../discovery/catalog-source.ts';
import { fitAndRank, type FitCandidate } from '../../provisioning/fit.ts';

export type ModelDiscoveryDeps = {
  buildRegistry?: () => Promise<ModelDeclaration[]>;
  readCatalog?: () => Candidate[] | undefined;
  detectHost?: () => Promise<{ liveBudgetBytes: number }>;
};

export type ModelDiscovery = {
  installed: ModelDeclaration[];
  pullable: FitCandidate[];
};

/** Composes the same building blocks `runProvision` uses (see plan Task 16's
 *  design note) — read-only, no download side-effect, no live network
 *  re-discovery on every call. */
export async function discoverModels(
  deps: ModelDiscoveryDeps = {},
): Promise<ModelDiscovery> {
  const installed = await (deps.buildRegistry ?? realBuildRegistry)();
  const host = await (deps.detectHost ?? realDetectHost)();
  const catalog = (deps.readCatalog ?? realReadCatalog)() ?? [];
  const pullable = fitAndRank(catalog, host.liveBudgetBytes);
  return { installed, pullable };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/models-discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `handleModelList` test**

`tests/server/models-list.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import type { ModelListResponse } from '../../src/contracts/index.ts';
import { handleModelList } from '../../src/server/models/list.ts';

const deps = {
  freeDiskBytes: async () => 10_000_000_000,
  discovery: {
    buildRegistry: async () => [
      { runtime: RuntimeKind.Ollama, model: 'qwen3.5:9b', params: {}, role: 'installed', footprint: { approxParamsBillions: 9, bytesPerWeight: 1 } },
    ],
    readCatalog: () => [
      {
        runtime: RuntimeKind.MlxServer,
        model: 'mlx-community/Qwen3.5-30B',
        params: {},
        role: 'catalog',
        footprint: { approxParamsBillions: 30, bytesPerWeight: 1 },
        provider: ProviderKind.HfSnapshot,
        repo: 'mlx-community/Qwen3.5-30B',
        fileSizeBytes: 20_000_000_000,
        downloads: 100,
        installed: false,
      },
    ],
    detectHost: async () => ({ liveBudgetBytes: 40e9 }),
  },
};

test('GET /api/models lists installed + pullable rows, flagging a disk shortfall', async () => {
  const res = await handleModelList(deps);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ModelListResponse;
  const installedRow = body.items.find((i) => i.model === 'qwen3.5:9b');
  expect(installedRow?.installed).toBe(true);
  const pullableRow = body.items.find((i) => i.model === 'mlx-community/Qwen3.5-30B');
  expect(pullableRow?.installed).toBe(false);
  expect(pullableRow?.shortfallBytes).toBeGreaterThan(0); // 20GB needed, 10GB free
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/server/models-list.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `src/server/models/list.ts`**

```typescript
import { ModelListResponseSchema } from '../../contracts/index.ts';
import { checkDiskSpace } from '../../provisioning/supervisor.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { discoverModels, type ModelDiscoveryDeps } from './discover.ts';

export type ModelListDeps = {
  freeDiskBytes: () => Promise<number>;
  discovery?: ModelDiscoveryDeps;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/models` (spec §4.2.3) — installed rows (always `fits: true`,
 *  they're already running) plus pullable rows deduped against the installed
 *  set, each flagged with a disk-shortfall estimate against the live free
 *  space. No `provider` field on the wire (Task 5's design note) — which
 *  `DownloadProvider` would fetch a pullable row's weights is resolved
 *  server-side only, at pull time (Task 17). */
export async function handleModelList(deps: ModelListDeps): Promise<Response> {
  const { installed, pullable } = await discoverModels(deps.discovery);
  const free = await deps.freeDiskBytes();
  const installedKeys = new Set(installed.map((d) => `${d.runtime}::${d.model}`));

  const installedItems = installed.map((d) => ({
    runtime: d.runtime,
    model: d.model,
    installed: true,
    fits: true,
  }));

  const pullableItems = pullable
    .filter((c) => !installedKeys.has(`${c.runtime}::${c.model}`))
    .map((c) => {
      const sizeBytes = c.fileSizeBytes > 0 ? c.fileSizeBytes : c.estimatedBytes;
      const preflight = checkDiskSpace({ requiredBytes: sizeBytes, freeBytes: free });
      return {
        runtime: c.runtime,
        model: c.model,
        installed: false,
        fits: c.fits,
        sizeBytes,
        shortfallBytes: preflight.ok ? undefined : preflight.shortfallBytes,
      };
    });

  return json(
    ModelListResponseSchema.parse({ items: [...installedItems, ...pullableItems] }),
    200,
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/server/models-list.test.ts`
Expected: PASS.

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/models/discover.ts src/server/models/list.ts tests/server/models-discover.test.ts tests/server/models-list.test.ts
git add src/server/models/discover.ts src/server/models/list.ts tests/server/models-discover.test.ts tests/server/models-list.test.ts
git commit -m "feat(server): GET /api/models — installed + pullable inventory (Phase 5)"
```

---

## Task 17: `POST /api/models/pull` fire-and-watch + `ServerDeps.runModelPull` wiring

**Files:**
- Create: `src/server/models/pull.ts`
- Modify: `src/server/launch-turns.ts` (add `createRealRunModelPull`)
- Modify: `src/server/app.ts` (extend `ServerDeps` with `runModelPull`; wire `GET /api/models` + `POST /api/models/pull`)
- Modify: `src/server/main.ts` (build the real turn; add to `deps`)
- Modify (fixture ripple, same as Task 12): `tests/server/app.test.ts` (four literals), `tests/server/runs-routes.test.ts` (one literal), `tests/server/phase4-routes.test.ts` (`deps()` helper)
- Test: `tests/server/models-pull.test.ts` (create)

**Interfaces:**
- Consumes: `ModelPullRequestSchema`/`RunLaunchResponseSchema` (Task 6), `newRunId`/`createRun`/`writeArtifact` (`src/run/run-id.ts`/`src/run/run-store.ts`), `explain` (`src/errors/boundary.ts`), `runModelPullBridge` (Task 15), `providerFor`/`resolveDestDir` (`src/provisioning/registry.ts`/`dest-dir.ts`), `withRunTelemetry`.
- Produces: `RunModelPullTurn = (input: { runtime: RuntimeKind; provider: ProviderKind; modelRef: string; runId: string }) => Promise<void>`; `ModelPullDeps = { runsRoot: string; runModelPull: RunModelPullTurn }`; `handleModelPull(req: Request, deps: ModelPullDeps): Promise<Response>`; `createRealRunModelPull(runsRoot: string): RunModelPullTurn`.

**The concurrency contract (mirrors `handleCrewRun`'s four points, Phase 4 Task 11):**
1. The handler pre-creates the run dir (`await createRun(runsRoot, runId)`) BEFORE returning, so the browser's immediate `GET /api/runs/:runId/stream` never 404s.
2. The turn is started **detached** (`void deps.runModelPull(...).catch(...)`) — the handler returns `{ runId }` without awaiting the pull.
3. A throw in the detached turn is caught and persisted to `runs/<runId>/error.json` — never an unhandled rejection.
4. An unknown `(runtime, modelRef)` pair (no matching catalog entry — nothing to resolve a `ProviderKind` from) → 404, BEFORE any run dir is created.

- [ ] **Step 1: Write the failing test**

`tests/server/models-pull.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import type { RunModelPullTurn } from '../../src/server/models/pull.ts';
import { handleModelPull } from '../../src/server/models/pull.ts';

let root: string;
async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'modelpull-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function pullReq(body: unknown): Request {
  return new Request('http://localhost/api/models/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('200 + {runId}, pre-creates dir, invokes the turn detached with the resolved ProviderKind', async () => {
  await withRoot(async (runsRoot) => {
    const seen: { runtime: RuntimeKind; provider: ProviderKind; modelRef: string }[] = [];
    const turn: RunModelPullTurn = async ({ runtime, provider, modelRef }) => {
      seen.push({ runtime, provider, modelRef });
    };
    const res = await handleModelPull(
      pullReq({ runtime: RuntimeKind.MlxServer, modelRef: 'mlx-community/Qwen3.5-30B' }),
      {
        runsRoot,
        runModelPull: turn,
        resolveProvider: () => ProviderKind.HfSnapshot,
      },
    );
    expect(res.status).toBe(200);
    const { runId } = (await res.json()) as { runId: string };
    expect(runId.startsWith('run-')).toBe(true);
    expect(existsSync(join(runsRoot, runId))).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([
      { runtime: RuntimeKind.MlxServer, provider: ProviderKind.HfSnapshot, modelRef: 'mlx-community/Qwen3.5-30B' },
    ]);
  });
});

test('unresolvable (runtime, modelRef) → 404, no dir created', async () => {
  await withRoot(async (runsRoot) => {
    const res = await handleModelPull(
      pullReq({ runtime: RuntimeKind.Ollama, modelRef: 'no-such-model' }),
      { runsRoot, runModelPull: async () => {}, resolveProvider: () => undefined },
    );
    expect(res.status).toBe(404);
  });
});

test('malformed body → 400', async () => {
  await withRoot(async (runsRoot) => {
    const res = await handleModelPull(pullReq({ wrong: 1 }), {
      runsRoot,
      runModelPull: async () => {},
      resolveProvider: () => ProviderKind.Ollama,
    });
    expect(res.status).toBe(400);
  });
});

test('a throwing turn persists error.json (no unhandled rejection)', async () => {
  await withRoot(async (runsRoot) => {
    const turn: RunModelPullTurn = async () => {
      throw new Error('disk full');
    };
    const res = await handleModelPull(
      pullReq({ runtime: RuntimeKind.Ollama, modelRef: 'qwen3.5:9b' }),
      { runsRoot, runModelPull: turn, resolveProvider: () => ProviderKind.Ollama },
    );
    const { runId } = (await res.json()) as { runId: string };
    await new Promise((r) => setTimeout(r, 10));
    expect(existsSync(join(runsRoot, runId, 'error.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/models-pull.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/models/pull.ts`**

```typescript
import type { ProviderKind, RuntimeKind } from '../../core/types.ts';
import { ModelPullRequestSchema, RunLaunchResponseSchema } from '../../contracts/index.ts';
import { readCatalog } from '../../discovery/catalog-cache.ts';
import { explain } from '../../errors/boundary.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun, writeArtifact } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type RunModelPullTurn = (input: {
  runtime: RuntimeKind;
  provider: ProviderKind;
  modelRef: string;
  runId: string;
}) => Promise<void>;

export type ModelPullDeps = {
  runsRoot: string;
  runModelPull: RunModelPullTurn;
  /** Injectable for tests; the real server wires the cached-catalog lookup
   *  below. Never trusts a client-supplied provider (D2/§4.2 item 4). */
  resolveProvider?: (runtime: RuntimeKind, modelRef: string) => ProviderKind | undefined;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Resolves which `DownloadProvider` fetches `(runtime, modelRef)`'s weights
 *  by re-checking the SAME cached catalog `GET /api/models` (Task 16) ranked
 *  its pullable rows from — never trusts a client-supplied provider. */
function defaultResolveProvider(
  runtime: RuntimeKind,
  modelRef: string,
): ProviderKind | undefined {
  return (readCatalog() ?? []).find(
    (c) => c.runtime === runtime && c.model === modelRef,
  )?.provider;
}

/**
 * `POST /api/models/pull` (spec §4.2.4) — fire-and-watch (D2), the exact
 * shape `handleCrewRun` established (Phase 4): validate, resolve the
 * `ProviderKind` server-side, mint a runId, PRE-CREATE the run dir, start the
 * pull DETACHED, return `{ runId }` at once. A throw in the detached pull is
 * caught + written to error.json. The browser opens the EXISTING
 * `/api/runs/:runId/stream` — no new stream code (D2).
 */
export async function handleModelPull(
  req: Request,
  deps: ModelPullDeps,
): Promise<Response> {
  let body: ReturnType<typeof ModelPullRequestSchema.parse>;
  try {
    body = ModelPullRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid pull request' }, 400);
  }
  const resolveProvider = deps.resolveProvider ?? defaultResolveProvider;
  const provider = resolveProvider(body.runtime, body.modelRef);
  if (!provider) return json({ error: 'unknown model' }, 404);

  const runId = newRunId();
  const run = await createRun(deps.runsRoot, runId);
  void deps
    .runModelPull({ runtime: body.runtime, provider, modelRef: body.modelRef, runId })
    .catch(async (err: unknown) => {
      try {
        await writeArtifact(
          run,
          'error.json',
          JSON.stringify({ error: explain(err).title }),
        );
      } catch {
        // best-effort: the run dir may already be gone; nothing else to do.
      }
    });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/models-pull.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `createRealRunModelPull` to `src/server/launch-turns.ts`**

```typescript
import { runModelPullBridge } from '../provisioning/pull-bridge.ts';
import { providerFor } from '../provisioning/registry.ts';
import { resolveDestDir } from '../provisioning/dest-dir.ts';
import type { RunModelPullTurn } from './models/pull.ts';

/**
 * Real, non-test `RunModelPullTurn`: `withRunTelemetry` (no MCP mount — a
 * pull mounts nothing) scopes `runModelPullBridge` (Task 15) with the REAL
 * `providerFor` (`src/provisioning/registry.ts`, the exact function
 * `runProvision`'s CLI path uses) and `resolveDestDir()`. No external cancel
 * this phase — an internally-owned `AbortController` is created per pull
 * (wiring a user-triggered cancel is a natural follow-on, not required here).
 */
export function createRealRunModelPull(runsRoot: string): RunModelPullTurn {
  return ({ runtime, provider, modelRef, runId }) =>
    withRunTelemetry({ runsRoot, runId }, () =>
      runModelPullBridge(
        { runtime, provider, modelRef, signal: new AbortController().signal },
        { providerFor, destDir: resolveDestDir() },
      ),
    );
}
```

- [ ] **Step 6: Wire the routes + `ServerDeps.runModelPull` in `src/server/app.ts`**

Add imports: `import { handleModelList } from './models/list.ts';`, `import { handleModelPull } from './models/pull.ts';`, `import type { RunModelPullTurn } from './models/pull.ts';`. Add to `ServerDeps`:
```typescript
  /** Launches a model download to completion (Phase 5, Task 17). */
  runModelPull: RunModelPullTurn;
  /** Free-disk-space probe for the Models inventory route (Task 16). */
  freeDiskBytes: () => Promise<number>;
```
Add two routes in `handleApi` (either position — neither collides with any existing regex):
```typescript
        if (req.method === 'GET' && url.pathname === '/api/models') {
          rec.status(200);
          return handleModelList({ freeDiskBytes: deps.freeDiskBytes });
        }
        if (req.method === 'POST' && url.pathname === '/api/models/pull') {
          rec.status(200);
          return handleModelPull(req, { runsRoot: deps.runsRoot, runModelPull: deps.runModelPull });
        }
```

- [ ] **Step 7: Wire the real turn + `freeDiskBytes` in `src/server/main.ts`**

Add `import { createRealRunModelPull, ... } from './launch-turns.ts';` (extend the existing import) and `import { freeDiskBytes } from '../provisioning/cli-deps.ts';`. Add `const runModelPull = createRealRunModelPull(runsRoot);` alongside the existing turn constants, and add both `runModelPull` and `freeDiskBytes` to the `deps` object literal.

- [ ] **Step 8: Fix the `ServerDeps`-literal fixture ripple (same three files as Task 12)**

Add `runModelPull: async () => {}` and `freeDiskBytes: async () => Number.MAX_SAFE_INTEGER` to every `ServerDeps` literal in `tests/server/app.test.ts` (four literals), `tests/server/runs-routes.test.ts` (one literal), and `tests/server/phase4-routes.test.ts`'s `deps()` helper.

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun test tests/server/models-pull.test.ts tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts`
Expected: all PASS.

- [ ] **Step 10: SERVER-GROUP GATE — full suite**

Run: `bun run check`. Fix any further `ServerDeps` drift it surfaces.

- [ ] **Step 11: Gate + commit**

```bash
git add src/server/models/pull.ts src/server/launch-turns.ts src/server/app.ts src/server/main.ts tests/server/models-pull.test.ts tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts
git commit -m "feat(server): POST /api/models/pull fire-and-watch + createRealRunModelPull (Phase 5)"
```

---

## Task 18: web Models tab — inventory table + per-row Pull + live progress bar

**Files:**
- Create: `web/src/features/library/models-tab.tsx`
- Modify: `web/src/features/library/index.tsx` (replace the `models` stub panel with `<ModelsTab />`)
- Test: `web/src/features/library/models-tab.test.tsx` (create)

**Interfaces:**
- Consumes: `ModelListResponseSchema`, `ModelPullRequestSchema`, `RunLaunchResponseSchema`, `SpanDtoSchema` (`@contracts`), `apiFetch` (`web/src/shared/contract/client.ts`), `createSseTransport` (`web/src/shared/transport/sse-adapter.ts`), `useRunTrace` (`web/src/features/runs/use-run-trace.ts`).
- Produces: `ModelsTab()` — no new pure/exported helpers beyond the component itself (the progress derivation is a small in-component function, unit-covered via the component test's assertions rather than split out, since it has no reuse beyond this one tab).

**Design note (reading the pull's progress off `SpanDTO.attributes`):** the tick spans' attribute KEYS (`'model.pull.progress.percent'`, `.phase`, `.bytes_completed`, `.bytes_total`, `.speed_bytes_per_sec`) are the exact string values of `ATTR.MODEL_PULL_PERCENT` etc. (Task 15, `src/telemetry/spans.ts`) — the web layer doesn't import the server-only `ATTR` map, so these are duplicated as literal string constants here with a comment pointing back at the source of truth, the same way other `SpanDTO.attributes` consumers in `web/src/features/runs/` already read specific attribute keys by their literal wire names.

- [ ] **Step 1: Write the failing test**

`web/src/features/library/models-tab.test.tsx`:
```typescript
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../shared/design/theme.tsx';
import { ModelsTab } from './models-tab.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sseBody(frames: { id?: string; data: unknown }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = frames
    .map((f) => `${f.id ? `id: ${f.id}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function renderTab() {
  return render(
    <ThemeProvider>
      <ModelsTab />
    </ThemeProvider>,
  );
}

describe('ModelsTab', () => {
  it('lists inventory rows and shows a live progress bar after clicking Pull', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/api/models')) {
          return jsonResponse({
            items: [
              { runtime: 'MlxServer', model: 'mlx-community/Qwen3.5-30B', installed: false, fits: true, sizeBytes: 20_000_000_000 },
            ],
          });
        }
        if (u.endsWith('/api/models/pull') && init?.method === 'POST') {
          return jsonResponse({ runId: 'run-pull-x' });
        }
        if (u.includes('/api/runs/run-pull-x/stream')) {
          return new Response(
            sseBody([
              {
                id: 'e1',
                data: {
                  spanId: 's1',
                  parentSpanId: null,
                  name: 'model.pull.progress',
                  offsetMs: 0,
                  durationMs: 1,
                  depth: 1,
                  status: 'ok',
                  degraded: false,
                  attributes: { 'model.pull.progress.percent': 55 },
                  events: [],
                },
              },
            ]),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('mlx-community/Qwen3.5-30B')).toBeInTheDocument(),
    );
    screen.getByTestId('models-pull-mlx-community/Qwen3.5-30B').click();
    await waitFor(() =>
      expect(screen.getByTestId('models-progress-mlx-community/Qwen3.5-30B')).toHaveTextContent('55%'),
    );
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- models-tab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/features/library/models-tab.tsx`**

```tsx
import type { ModelInventoryDTO, ModelListResponse } from '@contracts';
import {
  ModelListResponseSchema,
  RunLaunchResponseSchema,
  SpanDtoSchema,
} from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { createSseTransport } from '../../shared/transport/sse-adapter.ts';
import { Button } from '../../shared/ui/button.tsx';

/** Mirrors `ATTR.MODEL_PULL_PERCENT` (`src/telemetry/spans.ts`, Task 15) —
 *  the web layer has no server-only `ATTR` import, so the wire key is
 *  duplicated here as a literal string. */
const PULL_PERCENT_ATTR = 'model.pull.progress.percent';

type PullState = { percent?: number; done: boolean };

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  const gb = bytes / 1e9;
  return `${gb.toFixed(1)} GB`;
}

/** Watches ONE model's pull run: opens the existing `/api/runs/:runId/stream`
 *  (D2 — no new stream code) and derives a percent from the latest
 *  `model.pull.progress` tick span's attributes. */
function usePullWatch(runId: string | undefined): PullState {
  const [state, setState] = useState<PullState>({ done: false });

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        for await (const span of createSseTransport().stream(
          runId,
          null,
          SpanDtoSchema,
          controller.signal,
        )) {
          if (cancelled) return;
          if (span.name === 'model.pull.progress') {
            const percent = span.attributes[PULL_PERCENT_ATTR];
            if (typeof percent === 'number') {
              setState((prev) => ({ ...prev, percent }));
            }
          }
        }
        if (!cancelled) setState((prev) => ({ ...prev, done: true }));
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, done: true }));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId]);

  return state;
}

function ModelRow({ item }: { item: ModelInventoryDTO }) {
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const pull = usePullWatch(runId);

  async function handlePull() {
    const res = await apiFetch('/models/pull', {
      method: 'POST',
      body: { runtime: item.runtime, modelRef: item.model },
      schema: RunLaunchResponseSchema,
    });
    setRunId(res.runId);
  }

  return (
    <tr>
      <td className="p-2 font-mono text-sm text-[var(--color-fg)]">{item.model}</td>
      <td className="p-2 font-mono text-sm text-[var(--color-muted)]">{item.runtime}</td>
      <td className="p-2 font-mono text-sm text-[var(--color-muted)]">
        {formatSize(item.sizeBytes)}
      </td>
      <td className="p-2">
        {item.installed ? (
          <span className="font-mono text-sm text-[var(--color-signal)]">Installed</span>
        ) : runId ? (
          <span
            data-testid={`models-progress-${item.model}`}
            className="font-mono text-sm text-[var(--color-muted)]"
          >
            {pull.done ? 'Done' : `${pull.percent ?? 0}%`}
          </span>
        ) : (
          <Button
            data-testid={`models-pull-${item.model}`}
            disabled={!item.fits}
            onClick={handlePull}
          >
            Pull
          </Button>
        )}
      </td>
    </tr>
  );
}

/** The Library area's Models tab (spec §4.4) — inventory table + a per-row
 *  Pull action that fires `POST /api/models/pull` then opens the EXISTING
 *  `/api/runs/:runId/stream` for live progress (D2 — no new web transport
 *  code). */
export function ModelsTab() {
  const [page, setPage] = useState<ModelListResponse | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/models', { schema: ModelListResponseSchema }).then((result) => {
      if (!cancelled) setPage(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <table className="w-full">
      <thead>
        <tr className="text-left font-mono text-xs uppercase text-[var(--color-muted)]">
          <th className="p-2">Model</th>
          <th className="p-2">Runtime</th>
          <th className="p-2">Size</th>
          <th className="p-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {(page?.items ?? []).map((item) => (
          <ModelRow key={`${item.runtime}::${item.model}`} item={item} />
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- models-tab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `<ModelsTab>` into the Library shell**

In `web/src/features/library/index.tsx`, replace the `models` stub `<p>` with `<ModelsTab />` (add `import { ModelsTab } from './models-tab.tsx';`):
```tsx
        {tab === 'models' && <ModelsTab />}
```
Update `web/src/features/library/index.test.tsx`'s Models-tab assertion accordingly (it currently checks for `library-panel-models`; either keep a wrapping `data-testid="library-panel-models"` div around `<ModelsTab />` in `index.tsx` so the existing shell test keeps passing unchanged, or update the test to assert on the inventory table instead — prefer the wrapping-div route, it's the smaller diff and keeps Task 7's shell test green without modification).

- [ ] **Step 6: Run the full web suite**

Run: `cd web && bun run typecheck && bun run test`
Expected: all PASS.

- [ ] **Step 7: Gate + commit**

```bash
git add web/src/features/library/models-tab.tsx web/src/features/library/models-tab.test.tsx web/src/features/library/index.tsx
git commit -m "feat(web): Models tab — inventory table + live pull progress (Phase 5)"
```

---


---

## Task 19: MCP config — retain transport kind on dormant entries

**Files:**
- Modify: `src/mcp/types.ts` (`McpConfig.dormant` gains `kind`)
- Modify: `src/mcp/config.ts` (`loadMcpConfig` — push `kind` when demoting an entry to dormant)
- Modify: `tests/mcp/config.test.ts` (existing dormant-shape assertion — widen it)

**Interfaces:**
- Consumes: `McpTransportKind` (`src/mcp/types.ts`, engine-side enum, unchanged).
- Produces: `McpConfig['dormant'][number].kind: McpTransportKind` — consumed by `mapMcpDormantToDto` (Task 20). Without this, a dormant server's `McpServerDTO` (contract, Increment 1) has no way to fill its *required* `kind` field, since `McpConfig.dormant` today only carries `{name, missingVars}`.

- [ ] **Step 1: Widen the existing failing assertion** (the schema-validated entry already knows its `kind` before the missing-env-var check runs — `toEntry(...)` builds the full entry first; only the fact that it's incomplete gets recorded)

In `tests/mcp/config.test.ts`, replace the `'marks entries with unset env vars dormant, not failed'` test:
```typescript
  it('marks entries with unset env vars dormant, not failed — and keeps the transport kind', () => {
    const path = writeConfig({
      mcpServers: {
        gh: {
          type: 'http',
          url: 'https://x.test',
          headers: { A: `${'$'}{MISSING_KEY}` },
        },
      },
    });
    const cfg = loadMcpConfig(path, {});
    expect(cfg.entries).toHaveLength(0);
    expect(cfg.dormant).toEqual([
      { name: 'gh', kind: McpTransportKind.Http, missingVars: ['MISSING_KEY'] },
    ]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp/config.test.ts`
Expected: FAIL — actual dormant record is `{ name: 'gh', missingVars: [...] }` (no `kind`), so `toEqual` mismatches.

- [ ] **Step 3: Widen the type + implementation**

In `src/mcp/types.ts`, change:
```typescript
export type McpConfig = {
  entries: McpServerEntry[];
  dormant: { name: string; missingVars: string[] }[];
  warnings: string[];
};
```
to:
```typescript
export type McpConfig = {
  entries: McpServerEntry[];
  /** `kind` is captured from the ALREADY-VALIDATED entry (schema parse runs
   *  before the missing-env-var check in `loadMcpConfig`), so a dormant
   *  server's transport is known without waiting for it to activate —
   *  needed by `McpServerDTO` (Slice 30b Phase 5), which requires `kind`
   *  even for a dormant row. */
  dormant: { name: string; kind: McpTransportKind; missingVars: string[] }[];
  warnings: string[];
};
```

In `src/mcp/config.ts`, in `loadMcpConfig`, change:
```typescript
    if (missing.length > 0) {
      cfg.dormant.push({ name, missingVars: [...new Set(missing)] });
      continue;
    }
```
to:
```typescript
    if (missing.length > 0) {
      cfg.dormant.push({
        name,
        kind: entry.kind,
        missingVars: [...new Set(missing)],
      });
      continue;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp/config.test.ts`
Expected: PASS (all cases, including the widened one).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/mcp/types.ts src/mcp/config.ts tests/mcp/config.test.ts
git add src/mcp/types.ts src/mcp/config.ts tests/mcp/config.test.ts
git commit -m "feat(mcp): retain transport kind on dormant config entries (Phase 5)"
```

---

## Task 20: MCP mapper + addressable mount-status snapshot

**Files:**
- Create: `src/mcp/mcp-dto.ts`
- Create: `src/server/mcp/mount-status.ts`
- Test: `tests/mcp/mcp-dto.test.ts` (create), `tests/server/mcp-mount-status.test.ts` (create)

**Interfaces:**
- Consumes: `McpServerEntry`, `McpConfig['dormant']` (`src/mcp/types.ts`, Task 19), `McpServerDTO`/`McpTransportKind`/`McpAuthKind` (`src/contracts/index.ts`, Increment 1 — parity-tested mirrors of the engine enums of the same name).
- Produces: `McpMountStatusEntry = { status: 'mounted' | 'skipped'; reason?: string }`, `mapMcpEntryToDto(entry, mounted?): McpServerDTO`, `mapMcpDormantToDto(d): McpServerDTO` (`src/mcp/mcp-dto.ts`); `createMcpMountStatus(): McpMountStatus` with `{ record(name, status, reason?), get(name) }` (`src/server/mcp/mount-status.ts`).

- [ ] **Step 1: Write the failing mapper test**

`tests/mcp/mcp-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { McpAuthKind, McpTransportKind } from '../../src/contracts/index.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../src/mcp/mcp-dto.ts';
import {
  McpAuthKind as EngineAuthKind,
  McpTransportKind as EngineKind,
} from '../../src/mcp/types.ts';

test('mapMcpEntryToDto: a never-mounted static stdio entry reads "skipped" with a hint', () => {
  const entry = {
    kind: EngineKind.Stdio,
    name: 'read_file',
    command: 'bun',
    args: ['run', 'src/mcp/server.ts'],
    env: {},
    raw: { command: 'bun' },
  };
  expect(mapMcpEntryToDto(entry, undefined)).toEqual({
    name: 'read_file',
    kind: McpTransportKind.Stdio,
    authKind: McpAuthKind.Static,
    status: 'skipped',
    reason: 'not mounted this session — use Test Mount',
  });
});

test('mapMcpEntryToDto: reflects a recorded mount-status snapshot + OAuth authKind', () => {
  const entry = {
    kind: EngineKind.Http,
    name: 'gh',
    url: 'https://x.test',
    headers: {},
    auth: { kind: EngineAuthKind.OAuth as const },
    raw: { type: 'http', url: 'https://x.test' },
  };
  expect(mapMcpEntryToDto(entry, { status: 'mounted' })).toEqual({
    name: 'gh',
    kind: McpTransportKind.Http,
    authKind: McpAuthKind.OAuth,
    status: 'mounted',
  });
});

test('mapMcpEntryToDto: carries the agents scope when present', () => {
  const entry = {
    kind: EngineKind.Stdio,
    name: 'scoped',
    command: 'bun',
    args: [],
    env: {},
    agents: ['file_qa'],
    raw: { command: 'bun' },
  };
  expect(mapMcpEntryToDto(entry, undefined).agents).toEqual(['file_qa']);
});

test('mapMcpDormantToDto: surfaces the missing-vars reason with the retained kind', () => {
  expect(
    mapMcpDormantToDto({ name: 'gh', kind: EngineKind.Http, missingVars: ['GH_TOKEN'] }),
  ).toEqual({
    name: 'gh',
    kind: McpTransportKind.Http,
    authKind: McpAuthKind.Static,
    status: 'dormant',
    reason: 'set GH_TOKEN to activate',
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp/mcp-dto.test.ts`
Expected: FAIL — `src/mcp/mcp-dto.ts` doesn't exist yet.

- [ ] **Step 3: Create `src/mcp/mcp-dto.ts`**

```typescript
import type { McpServerDTO } from '../contracts/index.ts';
import { McpAuthKind as ContractAuthKind, McpTransportKind as ContractTransportKind } from '../contracts/index.ts';
import { McpAuthKind, McpTransportKind, type McpConfig, type McpServerEntry } from './types.ts';

/** What the addressable mount-status snapshot (`src/server/mcp/mount-status.ts`)
 *  records for one server name after a mount attempt — today only
 *  `POST /api/mcp/test-mount` (Task 23) ever calls `.record(...)`: a real
 *  agent/crew/workflow run mounts under its OWN per-run `MountedRegistry`
 *  (`withMcpRun`) and never touches this snapshot. */
export type McpMountStatusEntry = { status: 'mounted' | 'skipped'; reason?: string };

const NEVER_MOUNTED_REASON = 'not mounted this session — use Test Mount';

/**
 * Projects one validated `McpServerEntry` (`src/mcp/types.ts`) to the wire
 * `McpServerDTO`, joined with its mount-status snapshot record (or the
 * "never attempted" default). Engine enum comparisons (`entry.kind ===
 * McpTransportKind.Http`) use the ENGINE enum so TS narrows `entry` to
 * `HttpServerEntry` and its `.auth` field is reachable; the OUTPUT dto
 * fields use the CONTRACT enum (parity-tested equal values, Increment 1) —
 * contracts stay isomorphic (never import `src/mcp`), so the two enums are
 * deliberately kept as separate imports, not one shared identifier.
 */
export function mapMcpEntryToDto(
  entry: McpServerEntry,
  mounted: McpMountStatusEntry | undefined,
): McpServerDTO {
  const authKind =
    entry.kind === McpTransportKind.Http && entry.auth?.kind === McpAuthKind.OAuth
      ? ContractAuthKind.OAuth
      : ContractAuthKind.Static;
  return {
    name: entry.name,
    kind: entry.kind as unknown as ContractTransportKind,
    ...(entry.agents ? { agents: entry.agents } : {}),
    authKind,
    status: mounted?.status ?? 'skipped',
    ...(mounted
      ? mounted.reason !== undefined
        ? { reason: mounted.reason }
        : {}
      : { reason: NEVER_MOUNTED_REASON }),
  };
}

/** A dormant entry never reached `ensureConsent`/`mount` (env vars unset), so
 *  it's always `authKind: Static` here — an OAuth dormant entry would need
 *  its raw `auth` field, which `McpConfig.dormant` doesn't retain (only
 *  `kind`, Task 19); this is a documented, harmless simplification since a
 *  dormant row's Test-Mount action is disabled in the web UI anyway. */
export function mapMcpDormantToDto(d: McpConfig['dormant'][number]): McpServerDTO {
  return {
    name: d.name,
    kind: d.kind as unknown as ContractTransportKind,
    authKind: ContractAuthKind.Static,
    status: 'dormant',
    reason: `set ${d.missingVars.join(', ')} to activate`,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp/mcp-dto.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Write the failing mount-status test**

`tests/server/mcp-mount-status.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';

test('records and retrieves a mount outcome by server name; unrecorded names are undefined', () => {
  const status = createMcpMountStatus();
  expect(status.get('gh')).toBeUndefined();
  status.record('gh', 'mounted');
  expect(status.get('gh')).toEqual({ status: 'mounted' });
  status.record('gh', 'skipped', 'consent not granted');
  expect(status.get('gh')).toEqual({ status: 'skipped', reason: 'consent not granted' });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test tests/server/mcp-mount-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `src/server/mcp/mount-status.ts`**

```typescript
import type { McpMountStatusEntry } from '../../mcp/mcp-dto.ts';

export type McpMountStatus = {
  record(name: string, status: 'mounted' | 'skipped', reason?: string): void;
  get(name: string): McpMountStatusEntry | undefined;
};

/**
 * Addressable, in-memory mount-attempt snapshot, keyed by server name — today
 * `mountAll`'s `mounted`/`skipped` result (`src/mcp/mount.ts`) is per-run-only,
 * never persisted or queryable outside the process that mounted it (spec
 * §4.2 item 6). Refreshed on every `POST /api/mcp/test-mount` attempt; one
 * instance lives on `ServerDeps` for the process lifetime — analogous to the
 * Phase-3 mtime summary cache, but keyed by name, not mtime.
 */
export function createMcpMountStatus(): McpMountStatus {
  const snapshot = new Map<string, McpMountStatusEntry>();
  return {
    record(name, status, reason) {
      snapshot.set(name, reason !== undefined ? { status, reason } : { status });
    },
    get(name) {
      return snapshot.get(name);
    },
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test tests/mcp/mcp-dto.test.ts tests/server/mcp-mount-status.test.ts`
Expected: PASS (all).

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/mcp/mcp-dto.ts src/server/mcp/mount-status.ts tests/mcp/mcp-dto.test.ts tests/server/mcp-mount-status.test.ts
git add src/mcp/mcp-dto.ts src/server/mcp/mount-status.ts tests/mcp/mcp-dto.test.ts tests/server/mcp-mount-status.test.ts
git commit -m "feat(mcp): McpServerDTO mapper + addressable mount-status snapshot (Phase 5)"
```

---

## Task 21: Server — `GET /api/mcp` (list + status)

**Files:**
- Create: `src/server/mcp/list.ts`
- Test: `tests/server/mcp-list.test.ts` (create)

**Interfaces:**
- Consumes: `loadMcpConfig` (`src/mcp/config.ts`), `mapMcpEntryToDto`/`mapMcpDormantToDto` (Task 20), `McpMountStatus` (Task 20), `ISOLATION_HEADERS`.
- Produces: `handleMcpList(deps: { mcpConfigPath: string; mcpMountStatus: McpMountStatus }): Response`.

- [ ] **Step 1: Write the failing test**

`tests/server/mcp-list.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServerDTO } from '../../src/contracts/index.ts';
import { handleMcpList } from '../../src/server/mcp/list.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-list-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
}

test('GET /api/mcp joins entries + dormant with the mount-status snapshot', async () => {
  const path = writeConfig({
    mcpServers: {
      active: { command: 'bun', args: ['run', 's.ts'] },
      dormant_one: { type: 'http', url: 'https://x.test', headers: { A: '${MISSING}' } },
    },
  });
  const status = createMcpMountStatus();
  status.record('active', 'mounted');

  const res = handleMcpList({ mcpConfigPath: path, mcpMountStatus: status });
  expect(res.status).toBe(200);
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');

  const body = (await res.json()) as McpServerDTO[];
  expect(body.find((s) => s.name === 'active')?.status).toBe('mounted');
  expect(body.find((s) => s.name === 'dormant_one')?.status).toBe('dormant');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/server/mcp-list.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/mcp/list.ts`**

```typescript
import { loadMcpConfig } from '../../mcp/config.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../mcp/mcp-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { McpMountStatus } from './mount-status.ts';

export type McpListDeps = { mcpConfigPath: string; mcpMountStatus: McpMountStatus };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `GET /api/mcp` — every configured server (active + dormant), joined with
 * the addressable mount-status snapshot (Task 20). No engine state is
 * touched (a file read + an in-memory map lookup), so per D8 this route does
 * NOT mint an ephemeral run — there's no span to place.
 */
export function handleMcpList(deps: McpListDeps): Response {
  const cfg = loadMcpConfig(deps.mcpConfigPath);
  const active = cfg.entries.map((e) => mapMcpEntryToDto(e, deps.mcpMountStatus.get(e.name)));
  const dormant = cfg.dormant.map(mapMcpDormantToDto);
  return json([...active, ...dormant], 200);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/server/mcp-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/mcp/list.ts tests/server/mcp-list.test.ts
git add src/server/mcp/list.ts tests/server/mcp-list.test.ts
git commit -m "feat(server): GET /api/mcp — list + status handler (Phase 5)"
```

---

## Task 22: Server — `POST /api/mcp/add`

**Files:**
- Create: `src/mcp/write.ts`, `src/server/mcp/add.ts`
- Test: `tests/mcp/write.test.ts` (create), `tests/server/mcp-add.test.ts` (create)

**Interfaces:**
- Consumes: `McpAddRequestSchema` (`src/contracts/index.ts`, Increment 1), `loadMcpConfig` (`src/mcp/config.ts`), `mapMcpEntryToDto`/`mapMcpDormantToDto` (Task 20), `McpMountStatus` (Task 20).
- Produces: `writeMcpEntry(name, server, configPath): Promise<{ok:boolean; message:string}>` (`src/mcp/write.ts`); `handleMcpAdd(req, deps: {mcpConfigPath, mcpMountStatus}): Promise<Response>` (`src/server/mcp/add.ts`).

- [ ] **Step 1: Write the failing `write.ts` test**

`tests/mcp/write.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeMcpEntry } from '../../src/mcp/write.ts';

test('writes a new entry atomically and rejects a duplicate name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-write-'));
  const path = join(dir, 'mcp.json');

  const first = await writeMcpEntry('gh', { command: 'bun', args: ['run', 's.ts'] }, path);
  expect(first.ok).toBe(true);
  expect(existsSync(path)).toBe(true);
  const written = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> };
  expect(written.mcpServers.gh).toEqual({ command: 'bun', args: ['run', 's.ts'] });

  const dup = await writeMcpEntry('gh', { command: 'bun' }, path);
  expect(dup.ok).toBe(false);
  expect(dup.message).toContain('already exists');
});

test('concurrent adds to the same file are serialized (no lost update)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-write-'));
  const path = join(dir, 'mcp.json');
  const [a, b] = await Promise.all([
    writeMcpEntry('a', { command: 'bun' }, path),
    writeMcpEntry('b', { command: 'bun' }, path),
  ]);
  expect(a.ok && b.ok).toBe(true);
  const written = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> };
  expect(Object.keys(written.mcpServers).sort()).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp/write.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/write.ts`**

```typescript
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

type WriteResult = { ok: boolean; message: string };
type ConfigRoot = { mcpServers?: Record<string, unknown> };

/** Per-config-path queue — mirrors `src/cli/mcp.ts`'s `withFileLock`: two
 *  concurrent adds against the SAME config file must not interleave a stale
 *  read with another's write. Settled (never-rejecting) so one failed add
 *  can't wedge the queue for the path. A fresh, file-scoped instance here
 *  (not imported from `cli/mcp.ts`, which is private/CLI-shaped and keys its
 *  writes by a STARTER_PACK lookup, not a raw server value). */
const fileLocks = new Map<string, Promise<unknown>>();

function withFileLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  const tail = fileLocks.get(path) ?? Promise.resolve();
  const next = tail.then(fn, fn);
  fileLocks.set(
    path,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function readRoot(
  configPath: string,
): Promise<{ ok: true; root: ConfigRoot } | { ok: false; message: string }> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, root: {} };
    return { ok: false, message: `cannot read mcp.json: ${(cause as Error).message}` };
  }
  try {
    return { ok: true, root: JSON.parse(raw) as ConfigRoot };
  } catch (cause) {
    return { ok: false, message: `mcp.json is not valid JSON: ${(cause as Error).message}` };
  }
}

async function doWrite(
  name: string,
  server: Record<string, unknown>,
  configPath: string,
): Promise<WriteResult> {
  const loaded = await readRoot(configPath);
  if (!loaded.ok) return loaded;
  const { root } = loaded;
  const servers = root.mcpServers ?? {};
  if (servers[name]) {
    return { ok: false, message: `"${name}" already exists in ${configPath}` };
  }
  servers[name] = server;
  const tmp = `${configPath}.tmp-${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify({ ...root, mcpServers: servers }, null, 2)}\n`);
  await rename(tmp, configPath);
  return { ok: true, message: `added "${name}" to ${configPath}` };
}

/**
 * Writes one raw `mcpServers.<name>` entry into `mcp.json`
 * (`POST /api/mcp/add`, Slice 30b Phase 5) — the same atomic
 * read-modify-write + per-path file-lock discipline as `src/cli/mcp.ts`'s
 * starter-pack `addPackEntry`, generalized to accept the ALREADY-VALIDATED
 * raw server value directly (the web add-server form) rather than looking
 * one up by name in `STARTER_PACK`. Never overwrites an existing key — the
 * caller edits `mcp.json` directly for that (removal/edit is a forward-item).
 */
export function writeMcpEntry(
  name: string,
  server: Record<string, unknown>,
  configPath: string,
): Promise<WriteResult> {
  return withFileLock(configPath, () => doWrite(name, server, configPath));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp/write.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `add.ts` handler test**

`tests/server/mcp-add.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMcpAdd } from '../../src/server/mcp/add.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';

function addReq(body: unknown): Request {
  return new Request('http://localhost/api/mcp/add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('adds a new stdio server and returns its projected DTO', async () => {
  const mcpConfigPath = join(mkdtempSync(join(tmpdir(), 'mcp-add-')), 'mcp.json');
  const res = await handleMcpAdd(
    addReq({ name: 'gh', server: { command: 'bun', args: ['run', 's.ts'] } }),
    { mcpConfigPath, mcpMountStatus: createMcpMountStatus() },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { name: string; status: string };
  expect(body.name).toBe('gh');
  expect(body.status).toBe('skipped'); // never mounted yet this session
});

test('a dormant add (missing env var) reports status "dormant"', async () => {
  const mcpConfigPath = join(mkdtempSync(join(tmpdir(), 'mcp-add-')), 'mcp.json');
  const res = await handleMcpAdd(
    addReq({
      name: 'gh',
      server: { type: 'http', url: 'https://x.test', headers: { A: '${GH_TOKEN}' } },
    }),
    { mcpConfigPath, mcpMountStatus: createMcpMountStatus() },
  );
  const body = (await res.json()) as { status: string };
  expect(body.status).toBe('dormant');
});

test('duplicate name → 409', async () => {
  const mcpConfigPath = join(mkdtempSync(join(tmpdir(), 'mcp-add-')), 'mcp.json');
  const deps = { mcpConfigPath, mcpMountStatus: createMcpMountStatus() };
  await handleMcpAdd(addReq({ name: 'gh', server: { command: 'bun' } }), deps);
  const res = await handleMcpAdd(addReq({ name: 'gh', server: { command: 'bun' } }), deps);
  expect(res.status).toBe(409);
});

test('malformed body → 400', async () => {
  const res = await handleMcpAdd(addReq({ nope: true }), {
    mcpConfigPath: '/tmp/never-read-mcp.json',
    mcpMountStatus: createMcpMountStatus(),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test tests/server/mcp-add.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `src/server/mcp/add.ts`**

```typescript
import { McpAddRequestSchema, type McpServerDTO } from '../../contracts/index.ts';
import { loadMcpConfig } from '../../mcp/config.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../mcp/mcp-dto.ts';
import { writeMcpEntry } from '../../mcp/write.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { McpMountStatus } from './mount-status.ts';

export type McpAddDeps = { mcpConfigPath: string; mcpMountStatus: McpMountStatus };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `POST /api/mcp/add` — validates the raw server value, writes it into
 * `mcp.json` (`writeMcpEntry`), then RE-LOADS the config so the response
 * reflects the actual parsed/expanded entry (dormant-if-missing-env,
 * transport kind, etc.) instead of echoing the raw input back. No engine
 * state beyond a file write is touched — D8's ephemeral-run rule is for
 * routes that call INTO the memory/MCP-mount engines, not config edits.
 */
export async function handleMcpAdd(req: Request, deps: McpAddDeps): Promise<Response> {
  let body: ReturnType<typeof McpAddRequestSchema.parse>;
  try {
    body = McpAddRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid mcp add request' }, 400);
  }

  const result = await writeMcpEntry(body.name, body.server, deps.mcpConfigPath);
  if (!result.ok) return json({ error: result.message }, 409);

  const cfg = loadMcpConfig(deps.mcpConfigPath);
  const entry = cfg.entries.find((e) => e.name === body.name);
  const dormant = cfg.dormant.find((d) => d.name === body.name);
  const dto: McpServerDTO | undefined = entry
    ? mapMcpEntryToDto(entry, deps.mcpMountStatus.get(entry.name))
    : dormant
      ? mapMcpDormantToDto(dormant)
      : undefined;
  if (!dto) return json({ error: 'entry written but could not be re-read' }, 500);
  return json(dto, 200);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test tests/mcp/write.test.ts tests/server/mcp-add.test.ts`
Expected: PASS (all).

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/mcp/write.ts src/server/mcp/add.ts tests/mcp/write.test.ts tests/server/mcp-add.test.ts
git add src/mcp/write.ts src/server/mcp/add.ts tests/mcp/write.test.ts tests/server/mcp-add.test.ts
git commit -m "feat(server): POST /api/mcp/add — write + re-read + project (Phase 5)"
```

---

## Task 23: Server — `POST /api/mcp/test-mount` (SSE, closes the D10 consent gap) [HARD — Opus / ultracode-verify]

> **Controller reconciliation note (added on plan merge):** emit **flat frames** matching Task 11's builder-build wire shape (a top-level `type` field — e.g. `{ type: 'data-run-start', runId }`, `{ type: 'data-mcp-mount', server, outcome }`, `{ type: 'data-confirm', promptId, kind, question }`, terminal `{ type: 'data-mcp-server', ...McpServerDTO }`), NOT a `{type, data}` envelope. This lets the web client (Task 25) reuse `postSseStream` (Task 13) instead of a bespoke reader — one wire contract shared by both interactive POST-SSE flows. Mirror `handleChat`/Task 11's `createUIMessageStream` + `writer.write(...)` emit exactly.

**Files:**
- Modify: `src/cli/with-mcp-run.ts` (export `buildAuthProviders`, previously module-private)
- Modify: `tests/cli/with-mcp-run.test.ts` (a small test proving the export)
- Create: `src/server/mcp/mount-one.ts` (the real, injectable single-entry mount — live-verified, not unit-tested, mirroring Phase 4's `launch-turns.ts` discipline)
- Create: `src/server/mcp/test-mount.ts`
- Test: `tests/server/mcp-test-mount.test.ts` (create)

**Interfaces:**
- Consumes: `ConsentRegistry`/`ConfirmPort` (`src/server/consent/registry.ts`), `McpMountStatus` (Task 20), `mapMcpEntryToDto`/`mapMcpDormantToDto` (Task 20), `loadMcpConfig` (`src/mcp/config.ts`), `mountAll` (`src/mcp/mount.ts`), `withMcpMountSpan` (`src/telemetry/spans.ts`), `withRunTelemetry` (`src/cli/with-run.ts`), `newRunId` (`src/run/run-id.ts`), `buildAuthProviders` (`src/cli/with-mcp-run.ts`, newly exported), the existing `McpMountEventSchema` (`data-mcp-mount`, `src/contracts/events.ts` — its FIRST real emitter; it has had zero callers anywhere in `src` until this task).
- Produces:
  - `McpTestMountRequestSchema = { name: string }` (new contract request, `src/contracts/requests.ts` — not pre-defined by Increment 1's fixed contract list, added here since this handler needs it).
  - `McpMountOneResult = { outcome: 'mounted' | 'skipped'; reason?: string; toolCount?: number }`, `McpMountOne = (entry, opts: {ask, warn}) => Promise<McpMountOneResult>`, `createRealMcpMountOne(): McpMountOne` (`src/server/mcp/mount-one.ts`).
  - `handleMcpTestMount(req, deps: { runsRoot, mcpConfigPath, mcpMountStatus, consent: ConsentRegistry, mountOne: McpMountOne }): Promise<Response>` (`src/server/mcp/test-mount.ts`).

**The D10 gap this closes:** `mountAll`'s default `ConsentDeps.ask` (`src/mcp/mount.ts:98-114`) is gated by `isTTY: interactiveTTY()` — on the server (never a TTY) an unapproved entry is silently skipped, `reason: 'consent not granted'`, with NOTHING for a human to answer. `createRealMcpMountOne` forces `isTTY: true` and routes `ask` through the `ConfirmPort` instead — the human answers via the browser's `<ConfirmPrompt>`, exactly as D4 intends. **`src/mcp/mount.ts` itself is NOT modified** — the CLI's own `mountAll(config)` call (no explicit `consent` override) keeps its existing `isTTY: interactiveTTY()` wiring untouched; the review must confirm this file has zero diff.

- [ ] **Step 1: Add the request contract**

Append to `src/contracts/requests.ts`:
```typescript
/** `POST /api/mcp/test-mount` body — the config-entry name to verify. */
export const McpTestMountRequestSchema = z.object({ name: z.string() });
export type McpTestMountRequest = z.infer<typeof McpTestMountRequestSchema>;
```

- [ ] **Step 2: Export `buildAuthProviders` from `src/cli/with-mcp-run.ts`**

Change:
```typescript
function buildAuthProviders(
```
to:
```typescript
/** Exported (Slice 30b Phase 5) so `src/server/mcp/mount-one.ts` can build a
 *  live OAuth provider for a single test-mount entry, reusing the exact
 *  Slice-26 loopback-pop mechanism `withMcpRun` already uses for real runs —
 *  no new OAuth code, no change to this file's own CLI behavior. */
export function buildAuthProviders(
```

Add a small regression test to `tests/cli/with-mcp-run.test.ts`:
```typescript
test('buildAuthProviders is exported for reuse by the server test-mount seam (Phase 5)', () => {
  const config: McpConfig = {
    entries: [
      {
        kind: McpTransportKind.Http,
        name: 'oauth-server',
        url: 'https://example.test/mcp',
        headers: {},
        auth: { kind: McpAuthKind.OAuth },
        raw: { type: 'http', url: 'https://example.test/mcp' },
      },
    ],
    dormant: [],
    warnings: [],
  };
  const providers = buildAuthProviders(config);
  expect(providers['oauth-server']).toBeDefined();
});
```
(Add the matching `import { buildAuthProviders } from '../../src/cli/with-mcp-run.ts';` plus whatever `McpConfig`/`McpTransportKind`/`McpAuthKind` imports the file doesn't already have — check the file's existing imports first and extend, don't duplicate.)

- [ ] **Step 3: Run to verify it fails**

Run: `bun test tests/cli/with-mcp-run.test.ts`
Expected: FAIL — `buildAuthProviders` is not exported yet.

- [ ] **Step 4: Apply Step 2's export + rerun**

Run: `bun test tests/cli/with-mcp-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/server/mcp/mount-one.ts`** (the real seam — live-verified against a real MCP server in Task 31, not unit-tested here, mirroring `launch-turns.ts`'s `createRealRunCrewTurn`)

```typescript
import { buildAuthProviders } from '../../cli/with-mcp-run.ts';
import { approvalsPath } from '../../mcp/consent.ts';
import { mountAll } from '../../mcp/mount.ts';
import type { McpConfig, McpServerEntry } from '../../mcp/types.ts';
import { withMcpMountSpan } from '../../telemetry/spans.ts';

export type McpMountOneResult = {
  outcome: 'mounted' | 'skipped';
  reason?: string;
  toolCount?: number;
};

export type McpMountOneOpts = {
  ask: (question: string) => Promise<boolean>;
  warn: (msg: string) => void;
};

export type McpMountOne = (
  entry: McpServerEntry,
  opts: McpMountOneOpts,
) => Promise<McpMountOneResult>;

/**
 * Mounts ONE config entry to verify it works, then closes it — this is a
 * one-off connectivity + consent check, not a long-lived mount (a real
 * agent/crew/workflow run mounts its OWN registry per `withMcpRun`; nothing
 * here is shared with that path). Forces `isTTY: true` so `ensureConsent`
 * (`src/mcp/consent.ts`) actually calls `opts.ask` instead of silently
 * skipping (the D10 gap this whole seam exists to close). An OAuth entry
 * gets a live provider via the SAME `buildAuthProviders` helper `withMcpRun`
 * uses for real runs (Slice 26 loopback-pop, unchanged).
 */
export function createRealMcpMountOne(): McpMountOne {
  return async (entry, opts) => {
    const config: McpConfig = { entries: [entry], dormant: [], warnings: [] };
    const authProviders = buildAuthProviders(config);
    return withMcpMountSpan(async (record) => {
      const reg = await mountAll(config, {
        consent: { ask: opts.ask, isTTY: true, autoYes: false, warn: opts.warn },
        authProviders,
        approvalsFile: approvalsPath(),
      });
      try {
        const mounted = reg.mounted.find((m) => m.name === entry.name);
        if (mounted) {
          record(mounted.name, 'mounted', mounted.toolCount, mounted.kind);
          return { outcome: 'mounted' as const, toolCount: mounted.toolCount };
        }
        const skipped = reg.skipped.find((s) => s.name === entry.name);
        record(entry.name, skipped?.reason ?? 'unknown', undefined, entry.kind);
        return { outcome: 'skipped' as const, reason: skipped?.reason ?? 'unknown' };
      } finally {
        await reg.close();
      }
    });
  };
}
```

- [ ] **Step 6: Write the failing `test-mount.ts` handler test** (the marquee case proves the consent await genuinely suspends `execute` until `POST /api/runs/:id/respond`'s real mechanism — `consent.resolve` — answers it)

`tests/server/mcp-test-mount.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { McpMountOne } from '../../src/server/mcp/mount-one.ts';
import { handleMcpTestMount } from '../../src/server/mcp/test-mount.ts';

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-testmount-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
}

function req(body: unknown): Request {
  return new Request('http://localhost/api/mcp/test-mount', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function tmpRunsRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-testmount-runs-'));
}

test('mounts an entry: streams mounting→mounted progress + the terminal DTO', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: { gh: { command: 'bun' } } });
  const mountOne: McpMountOne = async () => ({ outcome: 'mounted', toolCount: 3 });

  const res = await handleMcpTestMount(req({ name: 'gh' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne,
  });

  const text = await res.text();
  expect(text).toContain('"outcome":"mounting"');
  expect(text).toContain('"outcome":"mounted"');
  expect(text).toContain('data-mcp-server');
  expect(text).toContain('"status":"mounted"');
});

test('a declined/failed mount reports "skipped" with a reason, never a 500', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: { gh: { command: 'bun' } } });
  const mountOne: McpMountOne = async () => ({ outcome: 'skipped', reason: 'consent not granted' });

  const res = await handleMcpTestMount(req({ name: 'gh' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne,
  });

  const text = await res.text();
  expect(res.status).toBe(200);
  expect(text).toContain('"outcome":"skipped"');
  expect(text).toContain('"reason":"consent not granted"');
});

test('an unknown server name → 404, before any run is minted', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: {} });
  const res = await handleMcpTestMount(req({ name: 'nope' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne: async () => ({ outcome: 'mounted' }),
  });
  expect(res.status).toBe(404);
});

test('malformed body → 400', async () => {
  const res = await handleMcpTestMount(req({ wrong: 1 }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath: writeConfig({ mcpServers: {} }),
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne: async () => ({ outcome: 'mounted' }),
  });
  expect(res.status).toBe(400);
});

test('[ADVERSARIAL] the consent bridge genuinely suspends execute() until resolve() answers it', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: { gh: { command: 'bun' } } });
  const consent = createConsentRegistry();
  let askedOutcome: 'approved' | 'declined' | undefined;
  const mountOne: McpMountOne = async (_entry, opts) => {
    const ok = await opts.ask('Mount "gh"?');
    askedOutcome = ok ? 'approved' : 'declined';
    return ok
      ? { outcome: 'mounted', toolCount: 1 }
      : { outcome: 'skipped', reason: 'declined' };
  };

  const res = await handleMcpTestMount(req({ name: 'gh' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent,
    mountOne,
  });

  // Read the stream until the data-confirm frame carrying the promptId
  // lands, then answer it via the registry's resolve() — the SAME mechanism
  // `POST /api/runs/:id/respond` (`handleRespond` → `consent.resolve`) uses.
  const reader = res.body?.getReader();
  if (!reader) throw new Error('expected a streamed body');
  const decoder = new TextDecoder();
  let buffer = '';
  let promptId: string | undefined;
  while (!promptId) {
    const { done, value } = await reader.read();
    if (done) throw new Error('stream ended before a data-confirm frame arrived');
    buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/"promptId":"([a-f0-9]+)"/);
    if (match) promptId = match[1];
  }
  expect(consent.pending()).toContain(promptId);
  expect(askedOutcome).toBeUndefined(); // NOT yet settled — proves the suspend
  consent.resolve(promptId as string, true);

  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  expect(askedOutcome).toBe('approved');
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `bun test tests/server/mcp-test-mount.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Create `src/server/mcp/test-mount.ts`**

```typescript
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { withRunTelemetry } from '../../cli/with-run.ts';
import { StatusEventType } from '../../contracts/enums.ts';
import { McpTestMountRequestSchema } from '../../contracts/index.ts';
import type { EventSink } from '../../core/events.ts';
import { loadMcpConfig } from '../../mcp/config.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../mcp/mcp-dto.ts';
import { newRunId } from '../../run/run-id.ts';
import type { ConsentRegistry } from '../consent/registry.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { McpMountOne } from './mount-one.ts';
import type { McpMountStatus } from './mount-status.ts';

export type McpTestMountDeps = {
  runsRoot: string;
  mcpConfigPath: string;
  mcpMountStatus: McpMountStatus;
  consent: ConsentRegistry;
  mountOne: McpMountOne;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `POST /api/mcp/test-mount` — the D1 interactive shape, identical to
 * `handleChat`'s: a `createUIMessageStream`/`writer.merge`/
 * `createUIMessageStreamResponse` SSE response whose `execute` callback does
 * NOT return until the whole mount attempt (including any awaited consent)
 * is done. Mints its own ephemeral run (D8) via `withRunTelemetry` (no MCP
 * mount of its OWN — `deps.mountOne` opens/closes its own scoped registry)
 * so the `mcp.mount` span it wraps lands in `runs/<id>/spans.jsonl`.
 */
export async function handleMcpTestMount(
  req: Request,
  deps: McpTestMountDeps,
): Promise<Response> {
  let body: ReturnType<typeof McpTestMountRequestSchema.parse>;
  try {
    body = McpTestMountRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid test-mount request' }, 400);
  }

  const cfg = loadMcpConfig(deps.mcpConfigPath);
  const entry = cfg.entries.find((e) => e.name === body.name);
  const dormant = cfg.dormant.find((d) => d.name === body.name);
  if (!entry && !dormant) return json({ error: 'not found' }, 404);

  const runId = newRunId();
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const events: EventSink = (e) => writer.write({ type: e.type, data: e, transient: true });
      events({ type: StatusEventType.RunStart, runId });

      await withRunTelemetry({ runsRoot: deps.runsRoot, runId }, async () => {
        if (!entry) {
          // Only reachable when `dormant` matched above (the 404 guard rules
          // out "neither"), so this access is provably safe.
          events({ type: StatusEventType.McpMount, server: body.name, outcome: 'dormant' });
          writer.write({
            type: 'data-mcp-server',
            data: mapMcpDormantToDto(dormant!),
            transient: true,
          });
          return;
        }
        events({ type: StatusEventType.McpMount, server: entry.name, outcome: 'mounting' });
        const ask = async (question: string): Promise<boolean> =>
          Boolean(await deps.consent.port({ kind: 'mcp-mount', question }, events));
        const warn = (msg: string): void =>
          events({ type: StatusEventType.McpMount, server: entry.name, outcome: `warn: ${msg}` });

        const result = await deps.mountOne(entry, { ask, warn });
        deps.mcpMountStatus.record(entry.name, result.outcome, result.reason);
        events({ type: StatusEventType.McpMount, server: entry.name, outcome: result.outcome });
        writer.write({
          type: 'data-mcp-server',
          data: mapMcpEntryToDto(entry, deps.mcpMountStatus.get(entry.name)),
          transient: true,
        });
      });

      events({ type: StatusEventType.RunEnd, runId, outcome: 'done' });
    },
    onError: (err) => `stream error: ${err instanceof Error ? err.message : String(err)}`,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { ...ISOLATION_HEADERS, 'cache-control': 'no-store' },
  });
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `bun test tests/server/mcp-test-mount.test.ts`
Expected: PASS (all five, including the adversarial suspend/resume case).

- [ ] **Step 10: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/cli/with-mcp-run.ts src/server/mcp/mount-one.ts src/server/mcp/test-mount.ts src/contracts/requests.ts tests/cli/with-mcp-run.test.ts tests/server/mcp-test-mount.test.ts
git add src/cli/with-mcp-run.ts src/server/mcp/mount-one.ts src/server/mcp/test-mount.ts src/contracts/requests.ts tests/cli/with-mcp-run.test.ts tests/server/mcp-test-mount.test.ts
git commit -m "feat(server): POST /api/mcp/test-mount — closes the D10 silent-skip consent gap (Phase 5)"
```

> **Controller note (ultracode / Opus):** run Task 23 via an ultracode Workflow (adversarial-verify). Verifiers must confirm: (a) `src/mcp/mount.ts` has ZERO diff — the CLI's own `mountAll(config)` call path (`bun run mcp status`, `withMcpRun`'s real-run path) is provably unaffected by `createRealMcpMountOne`'s `isTTY: true` override, which lives entirely in the NEW `mount-one.ts` file; (b) the consent await genuinely suspends `execute` (Step 6's adversarial test) without an event-loop stall or a premature HTTP timeout; (c) a client disconnect mid-await does not corrupt `ConsentRegistry`'s `pendingResolvers` map for a LATER, unrelated test-mount (the unguessable `promptId` already prevents cross-talk; note in the review whether a wall-clock cap around the `ask` await is warranted here too, mirroring §7.1's builder finding — if so, file it as a fast-follow, since it's a 2-line addition around `deps.mountOne(...)` and not central to the D10 gap-closure itself); (d) the terminal `data-mcp-server` part is written exactly once per attempt.

---

## Task 24: Wire MCP routes + `ServerDeps` into `app.ts`/`main.ts`

**Files:**
- Modify: `src/server/app.ts` (import the three MCP handlers; extend `ServerDeps` with `mcpConfigPath`, `mcpMountStatus`, `mcpMountOne`; add the three routes)
- Modify: `src/server/main.ts` (build `mcpConfigPath`/`mcpMountStatus`/`mcpMountOne`; add to the `deps` object)
- Test: `tests/server/phase5-mcp-routes.test.ts` (create — mirrors `tests/server/phase4-routes.test.ts`'s `buildFetch(deps())` harness)

**Interfaces:**
- Consumes: `handleMcpList` (Task 21), `handleMcpAdd` (Task 22), `handleMcpTestMount` (Task 23), `McpMountStatus`/`createMcpMountStatus` (Task 20), `McpMountOne`/`createRealMcpMountOne` (Task 23), `defaultConfigPath` (`src/mcp/config.ts`).

- [ ] **Step 1: Write the failing routing test**

`tests/server/phase5-mcp-routes.test.ts` (copy the exact `deps()`/`authGet`/`authPost` helpers from `tests/server/phase4-routes.test.ts` verbatim — same `TOKEN`, `uploadsDir`, `runsRoot`, `unusedRunChatTurn`/`runCrewTurn`/`runWorkflowTurn` stubs — then extend the returned `ServerDeps` literal with the three new fields below. **Also merge in whatever additional `ServerDeps` fields Increments 1–3 (contracts/builders/models) have added by the time this task executes** — the real `src/server/app.ts` at that point is the source of truth for what a complete `ServerDeps` needs, not this snapshot):

```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';

const TOKEN = 'a'.repeat(64);
const uploadsDir = mkdtempSync(join(tmpdir(), 'phase5-mcp-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'phase5-mcp-runs-'));
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('runChatTurn should not be invoked by these tests');
};
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('runCrewTurn should not be invoked by these tests');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('runWorkflowTurn should not be invoked by these tests');
};

function mcpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'phase5-mcp-config-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: {} }));
  return path;
}

function deps(): ServerDeps {
  return {
    token: TOKEN,
    policy: { port: 0, allowedOrigins: [] as string[] },
    recordIo: false,
    indexHtml: '<!doctype html><title>t</title>',
    runChatTurn: unusedRunChatTurn,
    consent: createConsentRegistry(),
    uploadsDir,
    runsRoot,
    runCrewTurn: unusedRunCrewTurn,
    runWorkflowTurn: unusedRunWorkflowTurn,
    mcpConfigPath: mcpConfigPath(),
    mcpMountStatus: createMcpMountStatus(),
    mcpMountOne: async () => ({ outcome: 'mounted' }),
  };
}

function authGet(path: string): Request {
  return new Request(`http://localhost:0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
  });
}

function authPost(path: string, body: unknown): Request {
  return new Request(`http://localhost:0${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Host: 'localhost:0',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('GET /api/mcp, POST /api/mcp/add, POST /api/mcp/test-mount are wired', async () => {
  const fetch = buildFetch(deps());
  expect((await fetch(authGet('/api/mcp'))).status).toBe(200);
  const add = await fetch(authPost('/api/mcp/add', { name: 'gh', server: { command: 'bun' } }));
  expect(add.status).toBe(200);
  const testMount = await fetch(authPost('/api/mcp/test-mount', { name: 'gh' }));
  expect(testMount.status).toBe(200);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/server/phase5-mcp-routes.test.ts`
Expected: FAIL — 404s (routes not wired) and/or a `ServerDeps` type error (new fields missing).

- [ ] **Step 3a: Extend `ServerDeps`** in `src/server/app.ts`

```typescript
import { handleMcpAdd } from './mcp/add.ts';
import { handleMcpList } from './mcp/list.ts';
import type { McpMountOne } from './mcp/mount-one.ts';
import type { McpMountStatus } from './mcp/mount-status.ts';
import { handleMcpTestMount } from './mcp/test-mount.ts';
```
Add fields to `ServerDeps`:
```typescript
  /** `mcp.json` path this process reads/writes (Phase 5). */
  mcpConfigPath: string;
  /** Addressable, in-memory mount-attempt snapshot, keyed by server name (Phase 5). */
  mcpMountStatus: McpMountStatus;
  /** Mounts ONE MCP server to verify it works (Phase 5's D10 gap-closure seam). */
  mcpMountOne: McpMountOne;
```

- [ ] **Step 3b: Add the three routes in `handleApi`** — before the final `rec.status(404)` fallthrough:

```typescript
        if (req.method === 'GET' && url.pathname === '/api/mcp') {
          rec.status(200);
          return handleMcpList(deps);
        }
        if (req.method === 'POST' && url.pathname === '/api/mcp/add') {
          const res = await handleMcpAdd(req, deps);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'POST' && url.pathname === '/api/mcp/test-mount') {
          const res = await handleMcpTestMount(req, deps);
          rec.status(res.status);
          return res;
        }
```
(No `:name`/bare-path ordering hazard here — `/api/mcp` has no bare-`:name` GET variant this phase, only the two POST sub-paths above.)

- [ ] **Step 3c: Build the real deps in `src/server/main.ts`**

```typescript
import { defaultConfigPath } from '../mcp/config.ts';
import { createMcpMountStatus } from './mcp/mount-status.ts';
import { createRealMcpMountOne } from './mcp/mount-one.ts';
```
Inside `startWebServer`, after the crew/workflow turns:
```typescript
  const mcpConfigPath = defaultConfigPath();
  const mcpMountStatus = createMcpMountStatus();
  const mcpMountOne = createRealMcpMountOne();
```
Add to the `deps` object literal:
```typescript
    mcpConfigPath,
    mcpMountStatus,
    mcpMountOne,
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun test tests/server/phase5-mcp-routes.test.ts && bun run typecheck`
Expected: PASS + clean (fix any `ServerDeps` construction site the typecheck flags — e.g. `tests/server/app.test.ts` needs the same three fields added to its `deps` literal too).

- [ ] **Step 5: SERVER-GROUP GATE — full suite**

Run: `bun run check` (docs:check · typecheck · lint · full `bun test`). Fix any drift in existing `ServerDeps`-constructing tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts src/server/main.ts tests/server/phase5-mcp-routes.test.ts tests/server/app.test.ts
git commit -m "feat(server): wire MCP list/add/test-mount routes + ServerDeps (Phase 5)"
```

---

## Task 25: Web — MCP tab (server list + status, Add-server form, Test-mount)

> **Controller reconciliation note (wire-contract consistency — added on plan merge):** the `useMcpTestMount` code below hand-rolls a `fetch().getReader()` reader with a `{type, data}` frame envelope — that DIVERGES from the builder path. At implementation, REUSE `postSseStream` (Task 13) exactly as `useBuildEvents` does: `postSseStream('/api/mcp/test-mount', { name }, McpTestMountFrameSchema, signal)` in a `for await` loop, folding each **flat** frame via `foldMcpTestMountFrame(state, frame)` (signature `(state, frame)` like `foldBuildFrame`, NOT `(state, type, data)`). This requires Task 23's server route to emit the SAME flat-frame shape the builder-build route (Task 11) emits (a top-level `type` field, not a `{type,data}` envelope) — see Task 23's matching note. One POST-SSE reader (`postSseStream`), one wire contract, shared by both interactive flows; do NOT ship a second bespoke reader. Verify the exact frame shape against Task 11's committed server emit before writing this task's tests.

**Files:**
- Create: `web/src/features/library/use-mcp-test-mount.ts`
- Create: `web/src/features/library/mcp-tab.tsx`
- Modify: `web/src/features/library/index.tsx` (swap the MCP tab's placeholder body for `<McpTab />` — the 3-tab shell + tab-switcher + Models tab already exist per Increments 1/3)
- Test: `web/src/features/library/mcp-tab.test.tsx` (create)

**Interfaces:**
- Consumes: `McpServerDTO`/`McpServerDtoSchema`/`McpAddRequestSchema` (`@contracts`, Increment 1), `apiFetch`/`sessionToken` (`web/src/shared/contract/client.ts`), `<ConfirmPrompt>` (`web/src/features/chat/confirm-prompt.tsx`), `<Button>`/`<RegionErrorBoundary>`.
- Produces: `useMcpTestMount()` hook (`{ state, start, respond }`), `<McpTab />`.

- [ ] **Step 1: Write the failing hook test** (the pure fold, unit-testable without a real fetch)

`web/src/features/library/use-mcp-test-mount.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { foldMcpTestMountFrame } from './use-mcp-test-mount.ts';

describe('foldMcpTestMountFrame', () => {
  it('folds a data-mcp-mount progress frame into narration', () => {
    const next = foldMcpTestMountFrame(
      { narration: [] },
      'data-mcp-mount',
      { server: 'gh', outcome: 'mounting' },
    );
    expect(next.narration).toEqual(['gh: mounting']);
  });

  it('folds a data-confirm frame into pendingConfirm', () => {
    const next = foldMcpTestMountFrame(
      { narration: [] },
      'data-confirm',
      { promptId: 'p1', kind: 'mcp-mount', question: 'Mount "gh"?' },
    );
    expect(next.pendingConfirm).toEqual({ promptId: 'p1', kind: 'mcp-mount', question: 'Mount "gh"?' });
  });

  it('folds the terminal data-mcp-server frame into result and clears pendingConfirm', () => {
    const withConfirm = { narration: [], pendingConfirm: { promptId: 'p1', kind: 'mcp-mount', question: 'x' } };
    const dto = { name: 'gh', kind: 'stdio', authKind: 'static', status: 'mounted' };
    const next = foldMcpTestMountFrame(withConfirm, 'data-mcp-server', dto);
    expect(next.result).toEqual(dto);
    expect(next.pendingConfirm).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- use-mcp-test-mount`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/features/library/use-mcp-test-mount.ts`**

```typescript
import type { McpServerDTO } from '@contracts';
import { useCallback, useState } from 'react';
import { sessionToken } from '../../shared/contract/client.ts';

export type PendingConfirm = { promptId: string; kind: string; question: string };

export type McpTestMountState = {
  narration: string[];
  pendingConfirm?: PendingConfirm;
  result?: McpServerDTO;
  runId?: string;
  error?: string;
};

/**
 * Pure fold for one parsed SSE frame from `POST /api/mcp/test-mount`. This
 * stream mixes narration (`data-mcp-mount`), a mid-flow consent ask
 * (`data-confirm`, the SAME `ConfirmPort` mechanism chat/builders use), and
 * a terminal custom data part (`data-mcp-server`, the resulting
 * `McpServerDTO` — not a `StatusEvent` member, an arbitrary AI-SDK `data-*`
 * part per D1, exactly how the builder wizard carries its terminal
 * `BuildResultDTO`). Self-contained (not `createSseTransport().stream()`,
 * which only GETs `/api/runs/:id/stream` or `/api/chat`) because this route
 * is POST-initiated with its own body.
 */
export function foldMcpTestMountFrame(
  state: McpTestMountState,
  type: string,
  data: unknown,
): McpTestMountState {
  if (type === 'data-run-start') {
    return { ...state, runId: (data as { runId: string }).runId };
  }
  if (type === 'data-mcp-mount') {
    const d = data as { server: string; outcome: string };
    return { ...state, narration: [...state.narration, `${d.server}: ${d.outcome}`] };
  }
  if (type === 'data-confirm') {
    return { ...state, pendingConfirm: data as PendingConfirm };
  }
  if (type === 'data-mcp-server') {
    return { ...state, result: data as McpServerDTO, pendingConfirm: undefined };
  }
  return state;
}

export function useMcpTestMount() {
  const [state, setState] = useState<McpTestMountState>({ narration: [] });

  const start = useCallback(async (name: string) => {
    setState({ narration: [] });
    const res = await fetch('/api/mcp/test-mount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    if (!res.ok || !res.body) {
      setState((s) => ({ ...s, error: `test-mount request failed (${res.status})` }));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) {
          const payload = JSON.parse(dataLine.slice(5).trim()) as { type: string; data?: unknown };
          setState((s) => foldMcpTestMountFrame(s, payload.type, payload.data ?? payload));
        }
        sep = buffer.indexOf('\n\n');
      }
    }
  }, []);

  const respond = useCallback(
    async (value: boolean) => {
      const promptId = state.pendingConfirm?.promptId;
      if (!promptId || !state.runId) return;
      await fetch(`/api/runs/${state.runId}/respond`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ promptId, value }),
      });
    },
    [state.pendingConfirm, state.runId],
  );

  return { state, start, respond };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && bun run test -- use-mcp-test-mount`
Expected: PASS.

- [ ] **Step 5: Write the failing tab test**

`web/src/features/library/mcp-tab.test.tsx`:
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

const servers = [
  {
    name: 'read_file',
    kind: 'stdio',
    authKind: 'static',
    status: 'skipped',
    reason: 'not mounted this session — use Test Mount',
  },
];

describe('McpTab', () => {
  it('lists configured servers with status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/mcp')) return jsonResponse(servers);
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(screen.getByTestId('library-tab-mcp'));
    await waitFor(() => expect(screen.getByText('read_file')).toBeInTheDocument());
    expect(screen.getByText('skipped')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('submits the Add-server form to POST /api/mcp/add', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/api/mcp/add')) {
          return jsonResponse({
            name: 'gh',
            kind: 'stdio',
            authKind: 'static',
            status: 'skipped',
            reason: 'not mounted this session — use Test Mount',
          });
        }
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(screen.getByTestId('library-tab-mcp'));
    fireEvent.change(await screen.findByTestId('mcp-add-name'), { target: { value: 'gh' } });
    fireEvent.click(screen.getByText('Add server'));
    await waitFor(() => expect(calls.some((u) => u.endsWith('/api/mcp/add'))).toBe(true));
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd web && bun run test -- mcp-tab`
Expected: FAIL — `<McpTab>`/`library-tab-mcp` don't exist yet.

- [ ] **Step 7: Create `web/src/features/library/mcp-tab.tsx`**

```tsx
import type { McpServerDTO } from '@contracts';
import { McpAddRequestSchema, McpServerDtoSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { ConfirmPrompt } from '../chat/confirm-prompt.tsx';
import { useMcpTestMount } from './use-mcp-test-mount.ts';

const McpServerListSchema = z.array(McpServerDtoSchema);

export function McpTab() {
  const [servers, setServers] = useState<McpServerDTO[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [serverJson, setServerJson] = useState(
    '{"command":"bun","args":["run","src/mcp/server.ts"]}',
  );
  const { state, start, respond } = useMcpTestMount();

  function refresh() {
    apiFetch('/mcp', { schema: McpServerListSchema })
      .then(setServers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'failed to load'));
  }

  useEffect(refresh, []);
  useEffect(() => {
    if (state.result) refresh();
  }, [state.result]);

  async function onAdd() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serverJson);
    } catch {
      setError('server JSON is not valid');
      return;
    }
    const body = McpAddRequestSchema.parse({ name, server: parsed as Record<string, unknown> });
    await apiFetch('/mcp/add', { method: 'POST', body, schema: McpServerDtoSchema });
    setName('');
    refresh();
  }

  return (
    <RegionErrorBoundary region="MCP">
      <div data-testid="library-mcp-tab" className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-[var(--color-muted)]">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {servers.map((s) => (
            <li
              key={s.name}
              className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3 font-mono text-sm"
            >
              <span>{s.name}</span>
              <span className="text-[var(--color-muted)]">{s.kind}</span>
              <span className="text-[var(--color-muted)]">{s.status}</span>
              {s.reason && <span className="text-[var(--color-muted)]">{s.reason}</span>}
              <Button onClick={() => start(s.name)}>Test mount</Button>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
          <input
            data-testid="mcp-add-name"
            placeholder="server name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <textarea
            data-testid="mcp-add-server"
            value={serverJson}
            onChange={(e) => setServerJson(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <Button variant="accent" onClick={onAdd}>
            Add server
          </Button>
        </div>

        {state.narration.length > 0 && (
          <ul className="font-mono text-xs text-[var(--color-muted)]">
            {state.narration.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {state.pendingConfirm && <ConfirmPrompt ask={state.pendingConfirm} onAnswer={respond} />}
      </div>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 8: Wire the tab body in `web/src/features/library/index.tsx`**

Replace the MCP placeholder body (left by Increment 1's stub, alongside the `models`/`memory` placeholders):
old:
```tsx
{tab === 'mcp' && (
  <p className="text-sm text-[var(--color-muted)]">MCP lands in a later increment.</p>
)}
```
new:
```tsx
{tab === 'mcp' && <McpTab />}
```
Add the import: `import { McpTab } from './mcp-tab.tsx';`

- [ ] **Step 9: Run to verify it passes**

Run: `cd web && bun run test -- mcp-tab use-mcp-test-mount`
Expected: PASS (all).

- [ ] **Step 10: Gate + commit**

```bash
cd web && bun run typecheck && bun run lint:file -- src/features/library/use-mcp-test-mount.ts src/features/library/mcp-tab.tsx src/features/library/index.tsx src/features/library/mcp-tab.test.tsx src/features/library/use-mcp-test-mount.test.ts
git add web/src/features/library/use-mcp-test-mount.ts web/src/features/library/mcp-tab.tsx web/src/features/library/index.tsx web/src/features/library/mcp-tab.test.tsx web/src/features/library/use-mcp-test-mount.test.ts
git commit -m "feat(web): Library MCP tab — list/status, add-server form, test-mount (Phase 5)"
```

---

## Task 26: Server — `GET /api/memory/spaces` + `POST /api/memory/:space/recall`

**Files:**
- Create: `src/server/memory/spaces.ts`, `src/server/memory/recall.ts`
- Test: `tests/server/memory-spaces.test.ts` (create), `tests/server/memory-recall.test.ts` (create)

**Interfaces:**
- Consumes: `MemoryStore` (`src/memory/store.ts` — `.stats()`/`.recall()`), `MemoryRecallRequestSchema` (`@contracts`, Increment 1), `withRunTelemetry` (`src/cli/with-run.ts`), `newRunId` (`src/run/run-id.ts`).
- Produces: `handleMemorySpaces(deps: {memoryStore: MemoryStore}): Promise<Response>`; `handleMemoryRecall(req, deps: {memoryStore, runsRoot}, space: string): Promise<Response>`.

**Finding worth noting up front:** `store.recall` already routes through `retrieve()` (`src/memory/retrieve.ts:55`), which ALREADY wraps every call in `withMemoryRecallSpan` (`src/telemetry/spans.ts:571`) — the `memory.recall` span is **not new engineering work**; it already exists and is already wired. The spec's telemetry note ("add a `memory.recall` span, mirroring `withMemoryIngestSpan`'s shape") is stale on this one point — verified by reading `src/memory/retrieve.ts` and `src/telemetry/spans.ts` directly. This task's only job for that span is to mint a run for it to land IN (D8) — no new span code.

- [ ] **Step 1: Write the failing `spaces.ts` test**

`tests/server/memory-spaces.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { handleMemorySpaces } from '../../src/server/memory/spaces.ts';
import type { MemoryStore } from '../../src/memory/store.ts';

test('projects store.stats() to MemorySpaceDTO[]', async () => {
  const fakeStore = { stats: async () => ({ default: 12, research: 3 }) } as unknown as MemoryStore;
  const res = await handleMemorySpaces({ memoryStore: fakeStore });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    { name: 'default', chunkCount: 12 },
    { name: 'research', chunkCount: 3 },
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/server/memory-spaces.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/memory/spaces.ts`**

```typescript
import type { MemoryStore } from '../../memory/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type MemorySpacesDeps = { memoryStore: MemoryStore };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `GET /api/memory/spaces` — `store.stats()` projected to `MemorySpaceDTO`.
 * Per D8, a metadata read (space list + row counts) does NOT mint an
 * ephemeral run — there's no recall/ingest span here worth placing.
 */
export async function handleMemorySpaces(deps: MemorySpacesDeps): Promise<Response> {
  const stats = await deps.memoryStore.stats();
  const spaces = Object.entries(stats).map(([name, chunkCount]) => ({ name, chunkCount }));
  return json(spaces, 200);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/server/memory-spaces.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `recall.ts` test**

`tests/server/memory-recall.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMemoryRecall } from '../../src/server/memory/recall.ts';
import type { MemoryStore } from '../../src/memory/store.ts';

function recallReq(body: unknown): Request {
  return new Request('http://localhost/api/memory/default/recall', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('recalls against the path space and returns RetrievalResultDTO[]', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  let seenSpace: string | undefined;
  const fakeStore = {
    recall: async (_q: string, opts: { space?: string }) => {
      seenSpace = opts.space;
      return [{ id: 'doc#0', source: 'doc.md', text: 'hello', score: 0.9, namespace: '' }];
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryRecall(
    recallReq({ query: 'hello' }),
    { memoryStore: fakeStore, runsRoot },
    'default',
  );

  expect(res.status).toBe(200);
  expect(seenSpace).toBe('default');
  const results = (await res.json()) as { id: string }[];
  expect(results[0]?.id).toBe('doc#0');
});

test('malformed body → 400', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  const res = await handleMemoryRecall(
    recallReq({}),
    { memoryStore: { recall: async () => [] } as unknown as MemoryStore, runsRoot },
    'default',
  );
  expect(res.status).toBe(400);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test tests/server/memory-recall.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `src/server/memory/recall.ts`**

```typescript
import { withRunTelemetry } from '../../cli/with-run.ts';
import { MemoryRecallRequestSchema } from '../../contracts/index.ts';
import type { MemoryStore } from '../../memory/store.ts';
import { newRunId } from '../../run/run-id.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type MemoryRecallDeps = { memoryStore: MemoryStore; runsRoot: string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `POST /api/memory/:space/recall` — validates the body, mints an ephemeral
 * run (D8) so the ALREADY-WIRED `memory.recall` span (`store.recall` →
 * `retrieve()` → `withMemoryRecallSpan`, `src/memory/retrieve.ts:55` — no new
 * telemetry code here) lands under `runs/<id>/spans.jsonl`, then returns the
 * ranked `RetrievalResultDTO[]`. The URL's `:space` segment is authoritative
 * over the request body's optional `space` field (a REST-path convention);
 * the body field exists on `MemoryRecallRequestSchema` for other potential
 * callers of the same schema shape, not this route.
 */
export async function handleMemoryRecall(
  req: Request,
  deps: MemoryRecallDeps,
  space: string,
): Promise<Response> {
  let body: ReturnType<typeof MemoryRecallRequestSchema.parse>;
  try {
    body = MemoryRecallRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid recall request' }, 400);
  }
  const runId = newRunId();
  const results = await withRunTelemetry({ runsRoot: deps.runsRoot, runId }, () =>
    deps.memoryStore.recall(body.query, {
      space,
      ...(body.topK !== undefined ? { topK: body.topK } : {}),
    }),
  );
  return json(results, 200);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test tests/server/memory-recall.test.ts`
Expected: PASS.

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/memory/spaces.ts src/server/memory/recall.ts tests/server/memory-spaces.test.ts tests/server/memory-recall.test.ts
git add src/server/memory/spaces.ts src/server/memory/recall.ts tests/server/memory-spaces.test.ts tests/server/memory-recall.test.ts
git commit -m "feat(server): GET /api/memory/spaces + POST /api/memory/:space/recall (Phase 5)"
```

---

## Task 27: Contracts + Server — `POST /api/memory/:space/ingest` (+ document upload types)

**Files:**
- Modify: `src/contracts/requests.ts` (add `MemoryIngestRequestSchema` — not in Increment 1's fixed list, added here since this handler needs it)
- Modify: `src/server/upload.ts` (extend `EXT_BY_MEDIA_TYPE` for `text/plain`/`text/markdown` — memory documents, not just images)
- Modify: `tests/server/upload.test.ts` (extend with a document-upload case)
- Create: `src/server/memory/ingest.ts`
- Test: `tests/contracts/memory-ingest-request.test.ts` (create), `tests/server/memory-ingest.test.ts` (create)

**Interfaces:**
- Consumes: `confineToDir`/`MediaPathError` (`src/server/security/media-path.ts`), `MemoryStore.ingest` (`src/memory/store.ts`), `withRunTelemetry` (`src/cli/with-run.ts`), `newRunId` (`src/run/run-id.ts`).
- Produces: `MemoryIngestRequestSchema = { fileId: string }` (`src/contracts/requests.ts`); `handleMemoryIngest(req, deps: {memoryStore, runsRoot, uploadsDir}, space: string): Promise<Response>` (`src/server/memory/ingest.ts`).

**Finding worth noting up front:** the Phase-2 `/api/upload` endpoint (`src/server/upload.ts`) only allow-lists IMAGE media types (`png`/`jpeg`/`webp`/`gif`) — the spec's locked "reuse the confined `/api/upload` + `uploadsDir` pattern from Phase 2" for memory ingest does not work out of the box for the plain-text/markdown documents `store.ingest`'s `readFileSync(path, 'utf8')` expects. This task extends the allow-list rather than inventing a second upload endpoint.

- [ ] **Step 1: Write the failing contract test**

`tests/contracts/memory-ingest-request.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { MemoryIngestRequestSchema } from '../../src/contracts/requests.ts';

test('MemoryIngestRequestSchema requires a fileId string', () => {
  expect(MemoryIngestRequestSchema.parse({ fileId: 'abc123.md' }).fileId).toBe('abc123.md');
  expect(() => MemoryIngestRequestSchema.parse({})).toThrow();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/contracts/memory-ingest-request.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Append to `src/contracts/requests.ts`**

```typescript
/** `POST /api/memory/:space/ingest` body — the ALREADY-UPLOADED file's opaque
 *  id (the Phase-2 `/api/upload` id pattern), never a raw filesystem path. */
export const MemoryIngestRequestSchema = z.object({ fileId: z.string() });
export type MemoryIngestRequest = z.infer<typeof MemoryIngestRequestSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/contracts/memory-ingest-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing upload-doc-type test**

Append to `tests/server/upload.test.ts`:
```typescript
test('a valid markdown-document upload (memory ingest) writes into the confined dir with a .md extension', async () => {
  const file = new File(['# Notes\n\nhello'], 'notes.md', { type: 'text/markdown' });
  const res = await handleUpload(uploadRequest(file), { uploadsDir });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { uploadId: string };
  expect(body.uploadId).toMatch(/^[0-9a-f]{32}\.md$/);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test tests/server/upload.test.ts`
Expected: FAIL — `text/markdown` is rejected (`unsupported media type`).

- [ ] **Step 7: Extend `EXT_BY_MEDIA_TYPE` in `src/server/upload.ts`**

```typescript
const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  // Memory-ingest documents (Slice 30b Phase 5) — plain text/markdown only;
  // `store.ingest` reads utf8 text (`src/memory/store.ts:121`), no PDF/office
  // parsing exists yet.
  'text/plain': 'txt',
  'text/markdown': 'md',
};
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test tests/server/upload.test.ts`
Expected: PASS (all, including the new case).

- [ ] **Step 9: Write the failing `ingest.ts` handler test**

`tests/server/memory-ingest.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMemoryIngest } from '../../src/server/memory/ingest.ts';
import type { MemoryStore } from '../../src/memory/store.ts';

function ingestReq(body: unknown): Request {
  return new Request('http://localhost/api/memory/default/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('resolves an uploaded fileId and calls store.ingest with the confined path', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'memory-ingest-uploads-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-ingest-runs-'));
  writeFileSync(join(uploadsDir, 'abc123.md'), '# hi');
  let seenPath: string | undefined;
  let seenSpace: string | undefined;
  const fakeStore = {
    ingest: async (path: string, opts: { space: string }) => {
      seenPath = path;
      seenSpace = opts.space;
      return { chunks: 1, skipped: false };
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryIngest(
    ingestReq({ fileId: 'abc123.md' }),
    { memoryStore: fakeStore, runsRoot, uploadsDir },
    'default',
  );

  expect(res.status).toBe(200);
  expect(seenSpace).toBe('default');
  expect(seenPath?.endsWith('abc123.md')).toBe(true);
  expect(await res.json()).toEqual({ chunks: 1, skipped: false });
});

test('an unknown/escaping fileId 400s before any engine work (confineToDir guard)', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'memory-ingest-uploads-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-ingest-runs-'));
  let called = false;
  const fakeStore = {
    ingest: async () => {
      called = true;
      return { chunks: 0, skipped: false };
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryIngest(
    ingestReq({ fileId: '../../etc/passwd' }),
    { memoryStore: fakeStore, runsRoot, uploadsDir },
    'default',
  );

  expect(res.status).toBe(400);
  expect(called).toBe(false);
});

test('malformed body → 400', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'memory-ingest-uploads-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-ingest-runs-'));
  const res = await handleMemoryIngest(
    ingestReq({}),
    {
      memoryStore: { ingest: async () => ({ chunks: 0, skipped: false }) } as unknown as MemoryStore,
      runsRoot,
      uploadsDir,
    },
    'default',
  );
  expect(res.status).toBe(400);
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `bun test tests/server/memory-ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Create `src/server/memory/ingest.ts`**

```typescript
import { withRunTelemetry } from '../../cli/with-run.ts';
import { MemoryIngestRequestSchema } from '../../contracts/index.ts';
import type { MemoryStore } from '../../memory/store.ts';
import { newRunId } from '../../run/run-id.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';

export type MemoryIngestDeps = { memoryStore: MemoryStore; runsRoot: string; uploadsDir: string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `POST /api/memory/:space/ingest` — resolves the ALREADY-UPLOADED file id
 * through `confineToDir` (the exact Phase-2 read-side pattern `handleChat`
 * uses for image uploads, `src/server/chat/handler.ts:61-74`), mints an
 * ephemeral run (D8) so `memory.ingest`'s ALREADY-WIRED span
 * (`withMemoryIngestSpan`, `src/memory/store.ts:124`) lands somewhere, then
 * calls `store.ingest`. A bad/escaping fileId 400s before any engine work.
 */
export async function handleMemoryIngest(
  req: Request,
  deps: MemoryIngestDeps,
  space: string,
): Promise<Response> {
  let body: ReturnType<typeof MemoryIngestRequestSchema.parse>;
  try {
    body = MemoryIngestRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid ingest request' }, 400);
  }

  let path: string;
  try {
    path = confineToDir(body.fileId, deps.uploadsDir);
  } catch (err) {
    if (err instanceof MediaPathError) {
      return json({ error: 'invalid ingest request: unknown fileId' }, 400);
    }
    throw err;
  }

  const runId = newRunId();
  const result = await withRunTelemetry({ runsRoot: deps.runsRoot, runId }, () =>
    deps.memoryStore.ingest(path, { space, at: Date.now() }),
  );
  return json(result, 200);
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `bun test tests/server/memory-ingest.test.ts`
Expected: PASS.

- [ ] **Step 13: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/requests.ts src/server/upload.ts src/server/memory/ingest.ts tests/contracts/memory-ingest-request.test.ts tests/server/upload.test.ts tests/server/memory-ingest.test.ts
git add src/contracts/requests.ts src/server/upload.ts src/server/memory/ingest.ts tests/contracts/memory-ingest-request.test.ts tests/server/upload.test.ts tests/server/memory-ingest.test.ts
git commit -m "feat(server): POST /api/memory/:space/ingest + document upload types (Phase 5)"
```

---

## Task 28: Wire memory routes + `ServerDeps.memoryStore` into `app.ts`/`main.ts`

**Files:**
- Modify: `src/server/app.ts` (import the three memory handlers; extend `ServerDeps` with `memoryStore`; add the three routes)
- Modify: `src/server/main.ts` (build the real `MemoryStore`, mirroring `src/cli/memory.ts`'s `makeRealStore`; add to `deps`)
- Test: `tests/server/phase5-memory-routes.test.ts` (create)

**Interfaces:**
- Consumes: `handleMemorySpaces`/`handleMemoryRecall`/`handleMemoryIngest` (Tasks 30–31), `createMemoryStore` (`src/memory/store.ts`), `makeEmbedder`/`probeEmbedder` (`src/memory/embed.ts`), `makeCrossEncoderReranker` (`src/memory/reranker.ts`), `createModelManager` (`src/resource/model-manager.ts`), `runtimeFor`/`RuntimeKind.Ollama` (`src/runtime/registry.ts`, `src/core/types.ts`).

- [ ] **Step 1: Write the failing routing test**

`tests/server/phase5-memory-routes.test.ts` (same harness pattern as Task 24's `phase5-mcp-routes.test.ts` — copy `deps()`/`authGet`/`authPost`, extend with `memoryStore`):

```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import type { MemoryStore } from '../../src/memory/store.ts';

const TOKEN = 'a'.repeat(64);
const uploadsDir = mkdtempSync(join(tmpdir(), 'phase5-memory-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'phase5-memory-runs-'));
writeFileSync(join(uploadsDir, 'abc.md'), '# hi');
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('runChatTurn should not be invoked by these tests');
};
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('runCrewTurn should not be invoked by these tests');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('runWorkflowTurn should not be invoked by these tests');
};
const fakeMemoryStore = {
  stats: async () => ({ default: 1 }),
  recall: async () => [{ id: 'd#0', source: 'd.md', text: 'hi', score: 1, namespace: '' }],
  ingest: async () => ({ chunks: 1, skipped: false }),
} as unknown as MemoryStore;

function mcpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'phase5-memory-mcp-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: {} }));
  return path;
}

function deps(): ServerDeps {
  return {
    token: TOKEN,
    policy: { port: 0, allowedOrigins: [] as string[] },
    recordIo: false,
    indexHtml: '<!doctype html><title>t</title>',
    runChatTurn: unusedRunChatTurn,
    consent: createConsentRegistry(),
    uploadsDir,
    runsRoot,
    runCrewTurn: unusedRunCrewTurn,
    runWorkflowTurn: unusedRunWorkflowTurn,
    mcpConfigPath: mcpConfigPath(),
    mcpMountStatus: createMcpMountStatus(),
    mcpMountOne: async () => ({ outcome: 'mounted' }),
    memoryStore: fakeMemoryStore,
  };
}

function authGet(path: string): Request {
  return new Request(`http://localhost:0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
  });
}
function authPost(path: string, body: unknown): Request {
  return new Request(`http://localhost:0${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Host: 'localhost:0',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('GET /api/memory/spaces, POST recall + ingest are wired', async () => {
  const fetch = buildFetch(deps());
  expect((await fetch(authGet('/api/memory/spaces'))).status).toBe(200);
  expect(
    (await fetch(authPost('/api/memory/default/recall', { query: 'hi' }))).status,
  ).toBe(200);
  expect(
    (await fetch(authPost('/api/memory/default/ingest', { fileId: 'abc.md' }))).status,
  ).toBe(200);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/server/phase5-memory-routes.test.ts`
Expected: FAIL — 404s + a `ServerDeps` type error (`memoryStore` missing).

- [ ] **Step 3a: Extend `ServerDeps`** in `src/server/app.ts`

```typescript
import { handleMemoryIngest } from './memory/ingest.ts';
import { handleMemoryRecall } from './memory/recall.ts';
import { handleMemorySpaces } from './memory/spaces.ts';
import type { MemoryStore } from '../memory/store.ts';
```
Add field:
```typescript
  /** The memory/RAG store engine-touching routes call into (Phase 5). */
  memoryStore: MemoryStore;
```

- [ ] **Step 3b: Add the three routes in `handleApi`**

```typescript
        if (req.method === 'GET' && url.pathname === '/api/memory/spaces') {
          rec.status(200);
          return handleMemorySpaces(deps);
        }
        const memRecall = url.pathname.match(/^\/api\/memory\/([^/]+)\/recall$/);
        if (req.method === 'POST' && memRecall?.[1]) {
          const res = await handleMemoryRecall(req, deps, memRecall[1]);
          rec.status(res.status);
          return res;
        }
        const memIngest = url.pathname.match(/^\/api\/memory\/([^/]+)\/ingest$/);
        if (req.method === 'POST' && memIngest?.[1]) {
          const res = await handleMemoryIngest(req, deps, memIngest[1]);
          rec.status(res.status);
          return res;
        }
```
(`/api/memory/spaces` is checked as an exact match before the `:space` regexes, so a literal space named "spaces" is unreachable via `/recall`/`/ingest` sub-paths only — never a collision here since "spaces" has no further sub-path.)

- [ ] **Step 3c: Build the real store in `src/server/main.ts`**

```typescript
import { RuntimeKind } from '../core/types.ts';
import { makeEmbedder, probeEmbedder } from '../memory/embed.ts';
import { makeCrossEncoderReranker } from '../memory/reranker.ts';
import { createMemoryStore } from '../memory/store.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { runtimeFor } from '../runtime/registry.ts';
```
Inside `startWebServer`, after the MCP deps:
```typescript
  // Mirrors src/cli/memory.ts's makeRealStore — one embedder instance shared
  // by embedTexts/embedQuery, the Ollama-backed model manager for
  // ensureReady, cross-encoder rerank on by default (defaultRerank() in
  // retrieve.ts still gates actual use behind AGENT_MEMORY_RERANK).
  const memoryEmbedModel = process.env.AGENT_MEMORY_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
  const memoryManager = createModelManager();
  const memoryEmbedder = makeEmbedder({
    ensureReady: (decl) => memoryManager.ensureReady(decl),
    control: runtimeFor(RuntimeKind.Ollama).control,
    model: memoryEmbedModel,
  });
  const memoryStore = createMemoryStore(
    { embedModel: memoryEmbedModel },
    {
      embedTexts: memoryEmbedder.embed,
      embedQuery: async (text) => (await memoryEmbedder.embed([text]))[0] as number[],
      probe: probeEmbedder,
      reranker: makeCrossEncoderReranker(),
    },
  );
```
Add `memoryStore,` to the `deps` object literal.

- [ ] **Step 4: Run test + typecheck**

Run: `bun test tests/server/phase5-memory-routes.test.ts && bun run typecheck`
Expected: PASS + clean (fix `tests/server/app.test.ts` and any other `ServerDeps`-constructing test to add `memoryStore`).

- [ ] **Step 5: SERVER-GROUP GATE — full suite**

Run: `bun run check`. Fix any drift.

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts src/server/main.ts tests/server/phase5-memory-routes.test.ts tests/server/app.test.ts
git commit -m "feat(server): wire memory spaces/recall/ingest routes + real MemoryStore (Phase 5)"
```

---

## Task 29: Web — Memory tab (spaces + stats, upload+ingest, recall search)

**Files:**
- Create: `web/src/features/library/memory-tab.tsx`
- Modify: `web/src/features/library/index.tsx` (swap the Memory tab's placeholder body for `<MemoryTab />`)
- Test: `web/src/features/library/memory-tab.test.tsx` (create)

**Interfaces:**
- Consumes: `MemorySpaceDtoSchema`/`RetrievalResultDtoSchema`/`RetrievalResultDTO` (`@contracts`, Increment 1), `apiFetch`/`sessionToken` (`web/src/shared/contract/client.ts`), `<Button>`/`<RegionErrorBoundary>`.
- Produces: `<MemoryTab />`.

- [ ] **Step 1: Write the failing tab test**

`web/src/features/library/memory-tab.test.tsx`:
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

const spaces = [{ name: 'default', chunkCount: 12 }];
const recallResults = [{ id: 'doc#0', source: 'notes.md', text: 'hello world', score: 0.87 }];

describe('MemoryTab', () => {
  it('lists spaces with chunk counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/memory/spaces')) return jsonResponse(spaces);
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(screen.getByTestId('library-tab-memory'));
    await waitFor(() => expect(screen.getByText('default')).toBeInTheDocument());
    expect(screen.getByText('12 chunks')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('runs a recall search and renders RetrievalResultDTO[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/recall')) return jsonResponse(recallResults);
        if (url.endsWith('/api/memory/spaces')) return jsonResponse(spaces);
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(screen.getByTestId('library-tab-memory'));
    fireEvent.change(await screen.findByTestId('memory-recall-query'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByText('Recall'));
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun run test -- memory-tab`
Expected: FAIL — `<MemoryTab>`/`library-tab-memory` don't exist yet.

- [ ] **Step 3: Create `web/src/features/library/memory-tab.tsx`**

```tsx
import type { RetrievalResultDTO } from '@contracts';
import { MemorySpaceDtoSchema, RetrievalResultDtoSchema } from '@contracts';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiFetch, sessionToken } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

const IngestResultSchema = z.object({ chunks: z.number(), skipped: z.boolean() });

async function uploadDocument(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const { uploadId } = (await res.json()) as { uploadId: string };
  return uploadId;
}

export function MemoryTab() {
  const [spaces, setSpaces] = useState<{ name: string; chunkCount: number }[]>([]);
  const [space, setSpace] = useState('default');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievalResultDTO>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  function refreshSpaces() {
    apiFetch('/memory/spaces', { schema: MemorySpaceDtoSchema })
      .then(setSpaces)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'failed to load'));
  }

  useEffect(refreshSpaces, []);

  async function onIngest() {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    try {
      const fileId = await uploadDocument(file);
      await apiFetch(`/memory/${space}/ingest`, {
        method: 'POST',
        body: { fileId },
        schema: IngestResultSchema,
      });
      refreshSpaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ingest failed');
    }
  }

  async function onRecall() {
    try {
      const r = await apiFetch(`/memory/${space}/recall`, {
        method: 'POST',
        body: { query, space },
        schema: RetrievalResultDtoSchema,
      });
      setResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'recall failed');
    }
  }

  return (
    <RegionErrorBoundary region="Memory">
      <div data-testid="library-memory-tab" className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-[var(--color-muted)]">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {spaces.map((s) => (
            <li
              key={s.name}
              className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3 font-mono text-sm"
            >
              <span>{s.name}</span>
              <span className="text-[var(--color-muted)]">{s.chunkCount} chunks</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
          <input
            data-testid="memory-space-input"
            value={space}
            onChange={(e) => setSpace(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <input data-testid="memory-file-input" type="file" accept=".md,.txt" ref={fileInput} />
          <Button onClick={onIngest}>Ingest into space</Button>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
          <input
            data-testid="memory-recall-query"
            placeholder="Search this space…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <Button variant="accent" onClick={onRecall}>
            Recall
          </Button>
          <ul className="flex flex-col gap-2">
            {results.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-[var(--color-border)] p-2 font-mono text-xs"
              >
                <div className="text-[var(--color-muted)]">
                  {r.source} · {r.score.toFixed(2)}
                </div>
                <div>{r.text}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 4: Wire the tab body in `web/src/features/library/index.tsx`**

Replace the Memory placeholder body:
old:
```tsx
{tab === 'memory' && (
  <p className="text-sm text-[var(--color-muted)]">Memory lands in a later increment.</p>
)}
```
new:
```tsx
{tab === 'memory' && <MemoryTab />}
```
Add the import: `import { MemoryTab } from './memory-tab.tsx';`

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && bun run test -- memory-tab`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

```bash
cd web && bun run typecheck && bun run lint:file -- src/features/library/memory-tab.tsx src/features/library/index.tsx src/features/library/memory-tab.test.tsx
git add web/src/features/library/memory-tab.tsx web/src/features/library/index.tsx web/src/features/library/memory-tab.test.tsx
git commit -m "feat(web): Library Memory tab — spaces/stats, upload+ingest, recall search (Phase 5)"
```

---

## Task 30: Docs — all four surfaces (the hard-line task)

No TDD here — the "test" is `bun run docs:check` and `bun run check` passing green. This is the task the pre-push slice-landing gate checks for. Scoped to the WHOLE Phase-5 milestone (Increments 1–6), not just Increments 4–6.

**Files:**
- Modify: `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`

- [ ] **Step 1: `docs/architecture.md`**
  - Add a new **§3f** sequence diagram alongside §3a–3e ("Builders + Library — web flows (browser SSE/REST, Slice 30b Phase 5)"): the builder streaming+confirm round-trip (§7.1 mechanism, Increment 2); the pull→spans bridge (§7.2 mechanism, Increment 3); `GET /api/mcp` → `loadMcpConfig` + the addressable mount-status snapshot → `McpServerDTO[]`; `POST /api/mcp/add` → `writeMcpEntry` → re-read+project; `POST /api/mcp/test-mount` → mint run → `mountOne` (`ConsentDeps.ask` bridged to `ConfirmPort`, closing D10) → `data-mcp-mount`/`data-confirm`/`data-mcp-server` over one SSE connection; `GET /api/memory/spaces` → `store.stats()`; `POST /api/memory/:space/recall` → mint run → `store.recall` (already-wired `memory.recall` span); `POST /api/memory/:space/ingest` → `confineToDir` → mint run → `store.ingest` (already-wired `memory.ingest` span).
  - Under §7 (Observability): add `RunKind.Build`/`RunKind.Pull` (D9, Increment 1/3) and note the pull→spans bridge's per-tick child-span mechanism (§7.2) as the per-run routing section's second incremental-progress case (after Phase 4's step spans).
  - Under §13 (Provisioning): a "Web pull (Slice 30b Phase 5)" note pointing at the `model.pull`/`model.pull.progress` bridge and `runModelPull`'s direct `provider.download(...)` call (bypassing full `runProvision` orchestration, since selection/shortfall consent are pre-resolved).
  - Under §14 (MCP mount registry): note the addressable mount-status snapshot (`src/server/mcp/mount-status.ts`) and the `ConsentRegistry`'s first real caller closing the D10 silent-skip gap (`src/server/mcp/mount-one.ts`'s forced `isTTY: true` + `ConfirmPort` bridge) — explicitly state `src/mcp/mount.ts` itself has zero diff, the CLI path is unaffected; also note `src/mcp/write.ts` (atomic `mcp.json` writer) and the dormant-entries-now-retain-`kind` fix (Task 19).
  - Under §11 (Memory/RAG): note the web surface (`GET /api/memory/spaces`, recall, upload-then-ingest) and correct any stale "no web consumer" framing — also note `memory.recall`'s span was ALREADY wired (`retrieve.ts`) before this phase; Phase 5 only gives it somewhere to land (an ephemeral run per D8).
  - Under §18/§19 (Agent-builder / Crew-builder): a short "Web builder (Slice 30b Phase 5)" note per section (Increment 2 territory) pointing at the SSE build route + `ConsentRegistry`/narration bridge + the `DagView` proposal preview.
  - Update the module-map (§2) with `src/server/builders/`, `src/server/models/`, `src/server/memory/`, `src/server/mcp/` (incl. `mount-status.ts`, `mount-one.ts`, `add.ts`, `list.ts`, `test-mount.ts`), `src/mcp/mcp-dto.ts`, `src/mcp/write.ts`; new contracts (`AgentProposalDTO`/`CrewProposalDTO`/`WorkflowProposalDTO`, `BuildResultDTO`, `ModelInventoryDTO`, `MemorySpaceDTO`/`RetrievalResultDTO`, `McpServerDTO`, `VerifiedLevel`/`ReuseKind` mirrors, `RunKind.Build`/`RunKind.Pull`, `MemoryIngestRequestSchema`, `McpTestMountRequestSchema`).
  - Add a "**Builders + Library (web UI — Slice 30b Phase 5)**" section (mirroring the existing "Crews & Workflows (web UI — Slice 30b Phase 4)" section) covering: the three-transport split (D1–D3); the `ConsentRegistry`'s first real callers (build/reuse-confirm, MCP mount); the pull→spans bridge; the Library 3-tab shell; deferred items (OAuth-callback route, media-gen management, ANN index, chat-recall wiring, MCP edit/remove, a finer `RunKind` for test-mount/ingest/recall).
  - Bump test-count mentions at landing time (not now).

- [ ] **Step 2: Root `README.md`**
  - Status blockquote: extend the Slice 30b line to state Phase 5 (builders + library — agent/crew/workflow builder wizards, Models/Memory/MCP) has landed, alongside Phases 1/1b/2/3/4; Phases 6–8 remain.
  - Slice-status table: add the Slice 30b Phase 5 row (✅ Done) with a one-line capability summary + `docs/architecture.md` anchor, appended to the existing Phase 1–4 row's running prose (matching the row-editing pattern already used for Phases 2/3/4).
  - Feature paragraph: add a "Builders + Library (web UI — Slice 30b Phase 5)" paragraph (mirroring the Phase-4 paragraph) — guided agent/crew/workflow build wizards with live narration + mid-flow consent; a Models tab with live-progress pulls; an MCP tab that can now actually mount a never-before-approved server from the browser (the D10 gap-closure, stated plainly); a Memory tab with upload-then-ingest and recall search. State the honest caveats: media-gen model management stays read-only-at-most; no ANN index; recall isn't wired into chat yet; MCP entries can be added/tested but not edited/removed.
  - "Next" line: move the pointer from "Slice 30b Phase 5" to "Slice 30b Phase 6" (persistence — capability still NOT flipped, Phases 6–8 remain).

- [ ] **Step 3: `docs/ROADMAP.md`**
  - Gap table (the `TUI / local web UI` row): extend the "in progress" prose to include "+ 5 (Builders + Library: agent/crew/workflow build wizards, Models/Memory/MCP)"; note the builders/library screens are no longer "not yet functional."
  - Slice table (`30b` row): append the Phase-5 summary sentence to the existing multi-phase cell (same pattern as the Phase-4 append), keep the status marker as `🚧 In progress — Phases 1, 1b, 2, 3, 4 & 5 landed`.
  - "Next (product line)" row: update to point at Phase 6 onward (persistence, voice) now that builders/library are done.
  - Register two new forward-item rows if not already tracked: **`/api/mcp/oauth/callback`** (stable BFF OAuth-callback route, fork-2 follow-on) and **full media-gen model management** (parallel catalog, read-only-at-most this phase) — both per spec §9.

- [ ] **Step 4: `.superpowers/sdd/progress.md`**
  - Append a new `## SLICE 30b — PHASE 5 (Builders + Library: Models · Memory · MCP)` section header, with links to the spec (`docs/superpowers/specs/2026-07-15-slice-30b-phase5-builders-library-design.md`) and this plan file, mirroring the existing `## SLICE 30b — PHASE 4` header format.
  - Per-task `- [ ]`/`- ✅` commit-reference lines are filled in DURING execution (one per task across all 6 increments), not written now.

- [ ] **Step 5: Verify + commit**

```bash
bun run docs:check
bun run check
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(sdd): Slice 30b Phase 5 — architecture.md + README + ROADMAP + ledger (all four surfaces)"
```

> Reminder (not part of this commit): the docs-snapshot **Artifact** is the 4th living surface and is NOT a repo file — regenerate it at slice closeout per `reference-artifact-regen-mechanics` (new Builders/Models/Memory/MCP web+server nodes, the pull→spans bridge edge, the MCP mount-one/ConsentRegistry edge, updated footer slice/test counts).

---

## Task 31: Live-verify checklist (real Ollama, whole Phase-5 milestone)

No TDD — a manual checklist run against `bun run web` with a real Ollama installation, per the standing Live-verify-before-merge gate. Covers all 6 increments since mocks/unit tests/reviews miss real integration bugs (per the repo's own history — 4 caught live in Slice 13, more in Phase 2).

- [ ] **Step 1: Boot the real server** — `bun run web`, open the browser at the printed URL + token.

- [ ] **Step 2: Builders (Increment 2)** — open `/builders`, run the agent wizard end-to-end for a real need (e.g. "summarize a webpage"): confirm live narration streams, a mid-flow consent prompt (`data-confirm`) appears and blocks until answered, the proposal `DagView` preview renders, and the terminal `BuildResultDTO` reflects a real `written`/`reused` outcome. Cross-check the resulting run appears in the Runs browser (Phase 3) with `RunKind.Build`.

- [ ] **Step 3: Models (Increment 3)** — open the Library → Models tab, pull an installed-but-not-yet-installed model, and confirm the progress bar advances LIVE (not a single jump at the end) by watching `/api/runs/:id/stream` — this is the pull→spans bridge's whole reason to exist. Confirm the run resolves to `Done`/`Failed` correctly (not stuck `Running`) and shows `RunKind.Pull`.

- [ ] **Step 4: MCP (Increment 4 — this file's centerpiece)** — open the Library → MCP tab. Confirm the server list shows real `mcp.json` entries with accurate status (mounted/skipped/dormant). Add a new server via the Add-server form and confirm it appears with status `dormant` or `skipped` as appropriate. Run **Test mount** against a server that has NEVER been approved this session and confirm: (a) a `data-confirm` prompt actually appears in the browser (the D10 gap — this used to silently skip with zero human-visible signal); (b) approving it causes a REAL mount (tool list populated, `data-mcp-mount` progress visible); (c) declining it reports `skipped` cleanly, no crash. Cross-check `bun run mcp status` (CLI) still works unchanged — confirms the D10 fix didn't regress the CLI path.

- [ ] **Step 5: Memory (Increment 5)** — open the Library → Memory tab. Upload a real `.md` file and ingest it into a space; confirm the space's chunk count increases. Run a recall query and confirm real, relevant `RetrievalResultDTO[]` come back (source/text/score). Cross-check the run appears in the Runs browser and that `bun run memory ingest`/`recall` (CLI) still work unchanged against the same on-disk store.

- [ ] **Step 6: Record findings** — note any live-only defects found (integration bugs mocks/unit tests can't catch) for the fix wave in the whole-branch review below; do not silently work around them.

---

## Final gate & landing

1. **Whole-branch fan-out review** — 2–3 reviewers in parallel (Opus/Fable per the model-tiering rule), each over the full `main...HEAD` diff spanning all 6 increments: **correctness** (the builder streaming+confirm round-trip §7.1, the pull→spans bridge §7.2, the MCP test-mount consent-suspend contract from Task 23, `confineToDir` guards on every new file-id-taking route); **security** (every new `/api/builders/*`, `/api/models/*`, `/api/memory/*`, `/api/mcp/*` route rides the existing perimeter/token guard — confirm no route bypasses it; `src/mcp/mount.ts` has zero diff — confirm the D10 fix is genuinely additive, not a modification of the CLI's default consent path; the extended `EXT_BY_MEDIA_TYPE` document types don't reopen any path-confinement gap); **docs accuracy** (Task 30's four surfaces against the real diff, the same bar the Phase-2/3/4 reviews applied — this is exactly the kind of audit that caught 6 wrong edges in Slice 9). Consolidate findings into one fix wave.
2. **Live-verify** (Task 31, already run) — fold any findings into the fix wave above; re-run the affected checklist steps after fixes land.
3. **Partial-slice land** — merge `slice-30b-phase5-builders-library` `--no-ff` into `main` + push, with `README.md` + `docs/ROADMAP.md` + `.superpowers/sdd/progress.md` all in the same push (the pre-push slice-landing gate requires it alongside the `docs/architecture.md` change). Capability is **NOT** flipped — Phases 6–8 (persistence, accessibility, voice) remain.
4. **Regenerate the docs-snapshot Artifact** (4th surface) — new Builders/Models/Memory/MCP web+server nodes, the pull→spans bridge edge, the MCP mount-one/`ConsentRegistry` edge, updated footer slice + test counts; validate with `node --check` + referential integrity per the established mechanics.
5. Refresh `resume-here.md` and delete the work branch once landed.
