## Task 8: Architecture doc — Crews & roles section (docs hard line)

**Files:**
- Modify: `docs/architecture.md` (add §13 + §2 module-map `src/crew/` node/edges)

**Interfaces:** none (docs). REQUIRED for `bun run docs:check` (the pre-commit gate blocks a new `src/<subsystem>` that isn't documented).

- [ ] **Step 1: Add a "§13 Crews & roles" section to `docs/architecture.md`**

Insert after the Workflow section, in the file's existing voice. Content must match the shipped code:

```markdown
## 13. Crews & roles (Slice 11)

A CrewAI-style **role/task/process** layer — a thin composition over the workflow
engine (§9/§12) and the orchestrator (Glossary), NOT a new engine.

- **Types** (`src/crew/types.ts`): `CrewMember` (`role`/`goal`/`backstory` +
  `requires`/`prefer` for **live** model selection + optional `tools`), `Task`
  (`description` + `expectedOutput` prompt + `member` + `dependsOn` context edges
  + optional zod `output`), `enum CrewProcess { Sequential, Hierarchical }`,
  `CrewDef`, `CrewOutcome`.
- **Member → agent** (`src/crew/member-agent.ts`): `buildCrewAgent` composes
  role/goal/backstory into an `Agent.systemPrompt`, sets `description` (routing)
  and `modelReq` (the model is chosen live by the selector — no hardcoded model).
  This is the only genuinely new mechanism.
- **Validation** (`src/crew/define.ts`): `defineCrew` — unique member names + task
  ids, every `member`/`dependsOn` resolves, acyclic (Kahn) — throws `CrewError`.
- **Compile** (`src/crew/compile.ts`): **sequential** `compileToWorkflow` maps each
  task to an `AgentStep` (member = agent, `dependsOn` = context edges, output
  `?? z.string()`) → a `WorkflowDef` run by the **existing** engine; **hierarchical**
  `buildHierarchicalOrchestrator` reuses `createOrchestrator` + an auto manager
  (model defaults to the router).
- **Engine** (`src/crew/engine.ts`): `runCrew(def, input, deps)` dispatches by
  process under a `crew.run` span; reuses `runGuardedAgent` (Slice-9 guardrails)
  and the live selector. Never throws into the caller.
- **Entry** (`src/cli/crew.ts`): `bun run crew <name> [input...]` over the `crews/`
  registry; writes `runs/<id>/{spans.jsonl, result.txt|failed.txt}`; rendered by
  `bun run runs`.
- **Live model selection** (`src/cli/select-runtime.ts`): the crew CLI (and now the
  workflow CLI) build a shared `createSelectionRuntime` — model manager + offline
  registry + `createSelectHook` — so each member/role is resolved to the
  largest-model-that-fits at delegation (threaded via `defaultRunAgentStep`'s
  `onBeforeDelegate` for sequential, `createOrchestrator` for hierarchical).
- **Telemetry** (`src/telemetry/spans.ts`): `crew.run` root span
  (`ATTR.CREW_ID`, `CREW_PROCESS`) → nested `workflow.step` (sequential) or
  `agent.delegation` (hierarchical).

Feeds Slice 12 (Memory/RAG — members read from it) and Slice 13 (verification — a
verifier is just another member/task). Out of scope (v1): memory, CrewAI "Flows"
(our DAG already is that), planning / batch kickoff / human-in-the-loop tasks.
```

- [ ] **Step 2: Update the §2 module map + dependency table**

Add a `CREW["Crews · src/crew"]` subgraph (types/define/member-agent/compile/engine) and edges: `crewcli(crew.ts) → crewengine`; `crewengine → wfengine` (sequential) and `crewengine → orch` (hierarchical); `crewengine → spans`; `crew → members build agents`; add a `crews/* · CREWS` node to the Declarations subgraph; a `Crews / roles` dependency-table row (`src/crew/` → `workflow/engine.ts` + `core/orchestrator.ts` + `core/delegate.ts (runGuardedAgent)` + `telemetry/spans.ts` + Zod). Also add a `select-runtime.ts` node under CLI with edges `crew.ts → select-runtime` and `flow.ts → select-runtime` (live model selection now shared by both CLIs), and note it depends on `resource/model-manager` + `discovery/build-registry` + `select-hook`. Match the existing Mermaid/table style exactly (read §2 first).

- [ ] **Step 3: Run docs-check + full gate**

Run: `bun run docs:check && bun run typecheck && bun run lint && bun test`
Expected: docs-check PASS; typecheck + lint clean; full suite green (live tests skip if Ollama down).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(slice-11): document crews & roles in architecture.md"
```

---

## Final verification (before PR)

- [ ] `bun run check` (docs-check · typecheck · lint · test) GREEN.
- [ ] `bun run serve` then `bun run crew research-crew "the example.com domain"` runs end-to-end; writes `runs/<id>/spans.jsonl` + `result.txt`.
- [ ] `bun run runs <id>` shows `crew.run → workflow.step → agent.delegation`.
- [ ] Existing workflow + orchestrator + delegate tests still pass (crews only *use* them; no engine change).
- [ ] Refresh `resume-here.md` with the merge state.

---

## Self-review notes (plan author)

**Spec coverage:** §2.1 types → Task 1; §2.2 member-agent → Task 2; §2.3 define → Task 3; §2.7 telemetry → Task 4; §2.4 compile → Task 5; §2.5 engine → Task 6; §2.8 CLI + registry → Task 7; §8 docs → Task 8. §5 testing across Tasks 1-7 (unit) + Task 7 (live). §4 determinism = sequential-via-DAG + acyclic defineCrew + hierarchical-bounded-by-depth-guard. §7 acceptance = Final verification.

**Latest-internet validation (standing rule [[prefers-latest-methodology]]):** the 2026 CrewAI model was validated during brainstorming — crews = role/goal/backstory (prompt scaffolding) + tasks-with-context + sequential|hierarchical process; we already own both processes + a stronger zod I/O, so the plan builds ONLY the thin role/task layer and reuses the engine/orchestrator. No Flows, no parallel structured-output system, no memory (Slice 12).

**Type consistency:** `buildCrewAgent(member, tools?)` signature identical in Task 2 (def) and Tasks 5/6 (consumers). `effectiveTaskDeps` defined Task 3, used Task 5. `compileToWorkflow`/`buildHierarchicalOrchestrator` defined Task 5, used Task 6. `withCrewSpan`/`ATTR.CREW_*` defined Task 4, used Task 6. `runCrew`/`CrewDeps` defined Task 6, used Task 7. `CrewOutcome` (`{done,output}` | `{failed,failedTask?,message}`) consistent across Tasks 1/6/7.

**Known v1 simplifications (documented):** hierarchical crew passes a composite task string to the orchestrator (manager delegates autonomously) rather than enforcing task order — matches CrewAI hierarchical semantics; sequential is the deterministic path. The CLI test injects `runAgentStep` to avoid a real model (mirrors the flow test seam).

**Live model selection (wired in this slice — user-requested):** members carry `modelReq`, and the CLI now wires a real select-hook via `createSelectionRuntime` (Task 7), so each member/role is resolved to the largest-that-fits model at delegation. Threading: sequential path → `defaultRunAgentStep(agents, onBeforeDelegate)` → `runGuardedAgent(agent, task, onBeforeDelegate)` (Task 6 run-step change); hierarchical path → `onBeforeDelegate` passed to `createOrchestrator`. **Also upgrades the workflow CLI** (`flow.ts`) via the same shared helper. Unit tests bypass real models by injecting `runAgentStep`. `chat.ts` keeps its own inline setup (deduping it into `createSelectionRuntime` is an optional follow-up, out of scope here to avoid regressing the chat path).

**Type consistency (selection):** `defaultRunAgentStep(agents, onBeforeDelegate?)` (Task 6) — `onBeforeDelegate` optional so existing callers (Slice-10 tests, current flow test) stay valid. `CrewDeps.onBeforeDelegate` (Task 6) → `CrewCliDeps.onBeforeDelegate` (Task 7) → `createSelectionRuntime().onBeforeDelegate` (Task 7), all typed `BeforeDelegate` from `src/core/delegate.ts`.
