# Slice 30b · Phase 4 — Crews & Workflows (browse · run · watch · step-DAG)

**Status:** design · 2026-07-15 · branch `slice-30b-phase4-crews-workflows` (off `main` @ `69b7994`)
**Diagram:** [`docs/diagrams/slice-30b-phase4-crews-workflows/phase4-crews-workflows.png`](../../diagrams/slice-30b-phase4-crews-workflows/phase4-crews-workflows.excalidraw)
**Predecessor:** Phase 3 (Runs) landed @ `6a7ebda`. This phase reuses its Runs detail/stream/waterfall verbatim.
**Parent spec:** [`2026-07-08-slice-30-local-web-ui-design.md`](2026-07-08-slice-30-local-web-ui-design.md) — build-order item **4** ("Crews + Workflows — browse/run/watch both; the workflow step DAG").

---

## 1. Thesis

Phase 4 makes the **Crews** and **Workflows** areas real: browse the registries, launch a run from the browser, and **watch the step-graph light up live**. The pivotal insight from the seam audit: **watching is inherited free from Phase 3.** A crew run emits a `crew.run` root span and a workflow run emits a `workflow.run` root span into the *same* `runs/<id>/spans.jsonl` the Runs browser already reads, and `run-dto.ts` already treats both as first-class run roots. So the entire "watch" half needs **no new server stream code**.

The genuinely new build is three things:
1. **Browse** — project the in-memory TS registries (`CREWS`, `WORKFLOWS`) to JSON-safe DTOs and expose `GET` list/detail endpoints.
2. **A fire-and-watch launch seam** — `POST …/:id/run` mints a `runId`, starts the run *detached*, and returns `{ runId }` immediately so the browser can open the live stream while the run proceeds.
3. **One reusable `@xyflow` DAG component** — renders workflow step-graphs and crew task-graphs, and (the payoff) **overlays live node status on the run-detail page** as the run executes.

## 2. Scope (locked with the user 2026-07-15)

| Decision | Choice |
|---|---|
| Step-DAG visualization | **`@xyflow/react`** interactive canvas (pan/zoom, custom node per step-kind, animated live status). `@visx` stays for the waterfall. |
| Depth | **Full browse + run + watch** for **both** crews and workflows. |
| Crew detail | **Reuse the DAG** for the crew **task-graph** (one generic graph component). |
| Telemetry closure | **Fold in the run-kind closure** — derive `RunKind` (chat/agent/crew/workflow) and add a kind facet to the Runs browser. |
| Live DAG | **On run-detail, overlay live status** — the run-detail page fetches the definition and lights the DAG up from the span stream. The waterfall remains available. |

**Explicitly out of scope (deferred, none blocking):** in-UI run cancellation (watch is read-only; cancel is a Slice-24/remote concern); concurrent-launch cap (single-process — Slice 24); Sessions/persistence (Phase 6); Builders/Library (Phase 5); voice (Phase 7).

## 3. Design decisions (D-series)

- **D1 — Registries are the source of truth, projected not persisted.** `CrewDef`/`WorkflowDef` carry closures (`input`/`predicate`), Zod types, and AI-SDK `ToolSet`s — none JSON-serializable. DTOs are **projections** that drop those. No JSON files on disk; browse reads `CREWS`/`WORKFLOWS` directly.
- **D2 — The DAG is derived, never stored.** Workflow edges come from `effectiveDeps(step, i, steps)` (reused verbatim — the same function the engine and validator use): explicit `dependsOn`, else previous-step-in-order, else root. Branch `whenTrue`/`whenFalse` become distinct control-flow edges (`kind: 'branch-true' | 'branch-false'`). Map sub-steps render as nested/child nodes. Verify-expansion changes the graph when `--verify` is set — the DTO reflects the *definition* graph (unexpanded); the *live* graph on run-detail is driven by the actual spans, so an expanded run shows its real nodes.
- **D3 — Contract enums mirror engine enums with a parity test.** `StepKind` and `CrewProcess` are mirrored into `src/contracts/enums.ts` (same string values) with a parity test against the engine enum — the established `DegradeKind` precedent. `RunKind` is new (contract-owned).
- **D4 — Fire-and-watch launch.** `POST …/:id/run` validates the body (400), looks up the def (404), mints `runId = newRunId()`, starts the run **detached** (does *not* await completion), and returns `{ runId }` (HTTP 200). The detached run **must** catch any throw and persist `error.json` — never an unhandled rejection, never a lost run. This is the one hard concurrency surface (see §7).
- **D5 — Watch reuses Phase 3 unchanged.** No new stream handler. The browser opens `GET /api/runs/:runId/stream` (the Phase-3 resumable SSE). `run-dto.ts` already recognizes `crew.run`/`workflow.run` roots, so list/detail/stream all already work for launched runs.
- **D6 — Lazy engine preserved.** `runCrewTurn`/`runWorkflowTurn` are built from the *same* `createLazyEngine(runsRoot)` as Phase-2 chat — nothing (registry build, model manager, MCP mount) runs at boot; only on the first launch request. Startup/health/perimeter tests stay Ollama-free.
- **D7 — One generic `DagView`.** The React component takes a normalized model `{ nodes: {id,label,sublabel?,kind,status}[], edges: {from,to,kind}[] }`. Workflow-detail, crew-detail, and run-detail each produce that model from their own DTO (workflow steps, crew tasks, or live spans-over-definition). The component is unit-tested in isolation with a fixture graph.
- **D7a — Crew node semantics are process-aware (user decision 2026-07-15).** Crews have two shapes and the DagView renders each truthfully from `CrewDetailDTO.process`: **Sequential** → a task-dependency DAG (nodes = tasks; `label` = task id, `sublabel` = `member` + role; `kind` = `agent`, honest because sequential tasks compile to agent steps; edges from `dependsOn`, else previous-task-in-order — the crew analog of `effectiveDeps`). **Hierarchical** → a **manager → members delegation star** (a `manager` hub node + one node per member; edges = delegation; the task list shown in a side panel), because a hierarchical crew has NO static task DAG (the manager orchestrates delegation at runtime). Node `kind` gains a `manager` value beyond the `StepKind` set for the hub. The derivation lives on the web side (crew-detail) so the DTO stays a faithful projection.
- **D8 — Live status by span join.** On run-detail for a workflow/crew run, fetch the definition (`GET /api/workflows/:id` — the `workflow.id` from the run's root span), render its DAG, and overlay status by matching `SpanDTO.attributes['workflow.step.id'] === node.id` from the live span tail (reusing `useRunTrace`/`foldSpan`).
- **D9 — Browse is simpler than Runs.** Registries are small and in-memory; list endpoints return a plain `{ items }` (no cursor pagination). Crew/workflow list may offer a client-side search filter but no server facets in this phase.

## 4. Architecture (five layers — see diagram)

### Layer 1 — Contracts (`src/contracts/`, isomorphic, zod-only)
- **enums.ts:** mirror `StepKind` (agent/tool/branch/map/verify) and `CrewProcess` (sequential/hierarchical); add `RunKind` (chat/agent/crew/workflow). Parity tests for the two mirrored enums.
- **dto.ts:**
  - `CrewListItemDTO` `{ name, description?, process, memberCount, taskCount }`
  - `CrewDetailDTO` `{ name, description?, process, members: CrewMemberDTO[], tasks: CrewTaskDTO[] }` — members projected `{ name, role, goal, backstory, requires, prefer, agentRef? }`; tasks projected `{ id, description, expectedOutput, member, dependsOn, verify }` (drop `tools`, Zod `output`).
  - `WorkflowListItemDTO` `{ id, description?, stepCount }`
  - `WorkflowDetailDTO` `{ id, description?, steps: StepDTO[], edges: EdgeDTO[] }`
  - `StepDTO` `{ id, kind, agent?, tool?, onError?, retry?, verify?, branch?: {whenTrue, whenFalse}, map?: {subKind} }`
  - `EdgeDTO` `{ from, to, kind: 'depends' | 'branch-true' | 'branch-false' }`
  - Add `kind: RunKind` to `RunDtoSchema` **and** `RunListItemDtoSchema`.
- **requests.ts:** `CrewRunRequest` / `WorkflowRunRequest` `{ input: string }`; `CrewListResponse` / `WorkflowListResponse` `{ items }`; `RunLaunchResponse` `{ runId }`; add optional `kind` facet to `RunListQuery`.
- Re-export everything from `index.ts`.

### Layer 2 — Pure mappers (each in its subsystem, unit-tested)
- `src/crew/crew-dto.ts` — `mapCrewToListItem(def)`, `mapCrewToDetail(def)`.
- `src/workflow/workflow-dto.ts` — `mapWorkflowToListItem(def)`, `mapWorkflowToDetail(def)` (builds `steps` + `edges` via `effectiveDeps` + branch/map handling).
- `src/run/run-dto.ts` — derive `kind` from the root span name (`crew.run`→crew, `workflow.run`→workflow, `agent.run`→agent, else chat) in both `mapRunToDto` and `summarizeRunListItem`.

### Layer 3 — Server BFF (`src/server/crews/` + `src/server/workflows/`, mirror `src/server/runs/`)
- `list.ts` — iterate the registry → project → `{ items }` (200).
- `detail.ts` — `getCrew(name)`/`getWorkflow(id)` → 200 / 404. **Validate the name against the registry map — no filesystem touch, so no `confineToDir`.**
- `run.ts` — zod-parse body (400 on `ZodError`, generic message, no echo) → registry lookup (404) → `newRunId()` → `deps.runCrewTurn(def, input, runId)` / `runWorkflowTurn(...)` detached → return `{ runId }` (200).
- **watch:** none — reuse `GET /api/runs/:id/stream`.
- **Routing** (`app.ts`): `GET /api/crews`, `GET /api/crews/:name`, `POST /api/crews/:name/run` (+ workflow trio). Sub-routes (`/run`) matched **before** the bare `:name` detail regex (the Phase-3 ordering lesson). New routes are automatically token+Origin gated by the perimeter.
- **`main.ts`:** build `runCrewTurn`/`runWorkflowTurn` from the same `createLazyEngine(runsRoot)`; add to `ServerDeps`.

### Layer 4 — Web (`web/`, mirror the Phase-3 Runs feature)
- Add `@xyflow/react` to `web/package.json`.
- `web/src/shared/dag/` — generic `DagView` (cross-feature shared primitive) + a topological/layered layout helper + custom node components per kind. Unit-tested.
- `crews/index.tsx` — `CrewsArea` list (copy `RunsArea`; client-side search; `<Link to="/crews/$name">`).
- `crews/crew-detail.tsx` — members panel + task-graph `DagView` + **▶ Run** button → `apiFetch` POST launch → `navigate({ to: '/runs/$runId' })`.
- `workflows/index.tsx` + `workflows/workflow-detail.tsx` — step-DAG `DagView` + step-detail panel + **▶ Run**.
- `runs/run-detail.tsx` — when `kind ∈ {workflow, crew}`, fetch the definition and render the live `DagView` overlay (status from the existing span tail); waterfall stays available (tab/toggle).
- `router.tsx` — add `/crews/$name`, `/workflows/$id`. `commands.ts` — add `jump-to-crew` / `jump-to-workflow`.

### Layer 5 — Runs browser closure
- Runs list gains a **kind facet** (chat/crew/workflow/agent) so launched runs are findable; `RunListQuery.kind` filters server-side.

## 5. Build order (ships complete; reviewed in increments)

1. **Contracts** — enums (+ parity tests), DTOs, requests. (Sonnet)
2. **Mappers** — crew-dto, workflow-dto (DAG derivation), run-dto kind. `workflow-dto` DAG derivation is reasoning-heavy → **Opus / ultracode-verify**.
3. **Server browse** — crews/workflows list + detail handlers + routes. (Sonnet)
4. **Server launch** — `run.ts` + `runCrewTurn`/`runWorkflowTurn` + `main.ts` wiring. Fire-and-watch concurrency → **ultracode Workflow (adversarial-verify)**.
5. **Web DagView** — generic component + layout + node kinds + tests. (Sonnet; layout correctness Opus if needed)
6. **Web crews** — list + detail + Run. (Sonnet)
7. **Web workflows** — list + detail + Run. (Sonnet)
8. **Web run-detail live DAG overlay** + Runs kind facet + ⌘K. (Sonnet)
9. **Docs + phase close** — architecture.md, README, ROADMAP, ledger; regenerate Artifact. (Sonnet)

Then: whole-branch fan-out review (correctness/security/docs, Opus/Fable) → live-verify vs real Ollama (browse, launch a real crew + workflow, watch the DAG light up, verify spans match `bun run crew`/`bun run flow`) → **partial-slice land** (merge --no-ff + push; README+ROADMAP+ledger in the same push for the slice-landing gate; capability **not** flipped — Phases 5–8 remain) → regenerate the Artifact (4th surface).

## 6. Testing

- Contract parity tests (StepKind, CrewProcess). Pure-mapper unit tests (crew-dto, workflow-dto edge cases: implicit-linear, explicit dependsOn, branch edges, map nesting; run-dto kind derivation for each root span name). Server handler tests (list/detail 200/404, run 200/400/404, launch returns runId). Web vitest: list/detail render, DagView with a fixture graph (nodes/edges/status), run-detail live-overlay fold.
- Root tests use `bun:test`; web tests use `vitest` via `cd web && bun run test`.

## 7. The hard part — fire-and-watch launch concurrency

`POST …/:id/run` must start the run and return `{ runId }` **without awaiting** completion, so the browser opens the live stream while the run proceeds. Requirements the review must adversarially verify:
- The detached run keeps executing after the HTTP response returns (the `withMcpRun` scope outlives the request).
- Any throw in the detached run is **caught** and persisted to `runs/<id>/error.json` (mirroring the Phase-2 chat top-level catch) — never an unhandled promise rejection.
- The run is not lost: the `runId` returned always corresponds to a run dir that will exist by the time the browser's first stream poll lands (or the stream degrades gracefully to "still starting").
- No boot-time network (lazy engine invariant preserved).

Built via an **ultracode Workflow** (fan-out + adversarial-verify) per the model-tiering rule.

## 8. Standing notes (per the CLAUDE.md hard line)

**Architecture-doc update:** `docs/architecture.md` gains — a **Crews/Workflows web** subsection under "Web frontend"; new `src/server/crews/` + `src/server/workflows/` under the Server section; the `crew-dto`/`workflow-dto` mappers under the run/crew/workflow subsystems; the new contracts (Crew/Workflow DTOs, StepDTO/EdgeDTO, RunKind, StepKind/CrewProcess mirrors); the run-kind derivation in run-dto. README (status line + slice table row + feature paragraph) and ROADMAP (Crews/Workflows browse+run+watch capability marker) updated. Artifact regenerated (new/deepened web + server nodes, DagView, launch-seam edge; footer slice + test counts).

**Telemetry to emit:** the new browse/launch routes are automatically wrapped by `withServerRequestSpan` (`server.request`, route+method+status). The launched run emits the existing `crew.run`/`workflow.run` + `withStepSpan` per step (unchanged). No new span kinds needed; `RunKind` is a derived DTO field, not a new span attribute. (Optional forward-item: a `crew.launch`/`workflow.launch` marker span if launch latency ever needs isolating from run latency — not built this phase.)

## 9. Forward-items (deferred, tracked)

- Crew/workflow engines don't emit `setRunOutcome` yet (outcome falls back to `unknown`; lifecycle/duration correct) — carried from Phase 3.
- In-UI run cancellation (Slice 24 / remote).
- Concurrent-launch cap (single-process; Slice 24).
- `runs/` GC/retention (Tier-2).
- Verify-expanded definition preview on workflow-detail (definition graph is unexpanded; live graph is real).
