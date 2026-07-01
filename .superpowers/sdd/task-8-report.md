# Task 8 report — Crews & roles documentation (architecture.md)

## Starting state (important deviation from the brief)

The brief (written before Tasks 1-7 landed) asked for a **new §13** "Crews &
roles" section plus §2 module-map additions, on the assumption `architecture.md`
was untouched by crew work. In reality, Tasks 1-7 had **already incrementally
updated** `architecture.md`:

- §2's Mermaid graph already had the full `CREW["Crew · src/crew"]` subgraph
  (types/define/member-agent/compile/engine), the `crewcli`/`selrt` CLI nodes,
  the `crews/* · CREWS` declarations node, and every edge the brief asked for:
  `crewcli --> crewengine`, `crewengine --> wfengine`, `crewengine --> orch`,
  `crewengine --> spans`, `crewcli --> selrt`, `flow --> selrt`, `selrt -->
  selhook/buildreg/mgr`, `crewcompile --> crewmember/wfdefine`, `crewdefine -->
  crewtypes`, `crewtypes --> wftypes`.
- §2's dependency table already had a "Crew / Roles" row covering
  `src/crew/`, `src/cli/crew.ts`, `crews/` → `workflow/engine.ts` +
  `core/orchestrator.ts` + `core/delegate.ts` + `resource/selector.ts` +
  `cli/select-runtime.ts`.
- §9 ("Workflows / DAG engine (Slice 10)") had grown two Slice-11 paragraphs
  bolted onto the end: "Shared live-selection runtime" and "Crew CLI entry" —
  accurate in content but mis-homed (Slice 11 content living inside a
  Slice-10-titled section), and with no standalone narrative of crew
  mechanics (types, validation, compile, dispatch semantics).
- There was **no §13**; the doc had 12 numbered sections ending at Glossary.

So my job was audit-and-finalize, not greenfield authorship. The module map
was already complete and accurate — I verified every edge against the real
files and found zero wrong edges there.

## What I did

1. **Read every file the brief named** to verify claims:
   `src/crew/{types,define,member-agent,compile,engine}.ts`,
   `src/cli/{crew,select-runtime}.ts`, `crews/index.ts`,
   `src/telemetry/spans.ts` (`CREW_ID`/`CREW_PROCESS`/`CREW_TASK_MEMBER`,
   `withCrewSpan`), `src/workflow/run-step.ts` (`defaultRunAgentStep`'s
   `onBeforeDelegate` param), `src/cli/flow.ts` (selection wiring), and
   `src/core/orchestrator.ts` (`runOrchestrator`'s throw behavior).

2. **Found and fixed the key inaccuracy the brief flagged**: `runCrew`'s own
   docstring in `src/crew/engine.ts` line 35 says *"never throws into the
   caller"* — unconditionally. That's true for the **sequential** path
   (`runWorkflow` genuinely never throws — confirmed in §9's existing prose)
   but **false** for the **hierarchical** path: `runOrchestrator`
   (`src/core/orchestrator.ts` line 100) does `throw err` for any failure that
   is neither a captured resource error nor a `MaxStepsError` carrying a
   capability gap. The old `architecture.md` made **no claim at all** about
   `runCrew`'s throw behavior (a silent gap, not a wrong statement already in
   the doc), so this was new-but-corrective content. New §10 spells out both
   paths precisely: sequential is provably throw-free (delegates to §9's
   engine); hierarchical "inherits `runOrchestrator`'s throw-on-unhandled-
   failure behavior" and the section explicitly states `runCrew` "as a whole
   is not unconditionally throw-free."

3. **Confirmed live-model-selection-now-wired is accurate** — both
   `src/cli/crew.ts` and `src/cli/flow.ts` build `createSelectionRuntime()`
   and thread `onBeforeDelegate` into `runCrewCli`/`defaultRunAgentStep`
   respectively; this matches what §9's pre-existing "Shared live-selection
   runtime" paragraph already said, so no correction needed there — just
   referenced from the new section instead of duplicated.

4. **Added new `## 10. Crews & roles (Slice 11)`** (~55 lines), inserted
   after §9's "Shared live-selection runtime" paragraph, moving the
   mis-homed "Crew CLI entry" paragraph out of §9 into it. Content:
   - Framing: thin composition over the workflow engine (§9) + orchestrator
     (§13 Glossary), not a new engine.
   - `CrewMember`/`Task`/`CrewProcess`/`CrewDef`/`CrewOutcome` shapes (exact
     field names verified against `src/crew/types.ts`).
   - `defineCrew` validation specifics (unique names/ids, member/dep resolve,
     `effectiveTaskDeps` semantics, acyclic Kahn) → `CrewError`.
   - `buildCrewAgent`: systemPrompt composition, placeholder model
     (`qwenFast`) vs. live-resolved model via `modelReq`.
   - `compile.ts`: sequential `compileToWorkflow` (task→AgentStep mapping,
     `composeTaskInput` context threading, `output ?? z.string()`) and
     hierarchical `buildHierarchicalOrchestrator` (manager prompt, router
     default, "manager delegates autonomously" v1 simplification).
   - `engine.ts` dispatch + the throw-behavior nuance (above).
   - Telemetry: `withCrewSpan` → `crew.run` span with `CREW_ID`/`CREW_PROCESS`,
     `CREW_TASK_MEMBER` tagging, nesting under `workflow.step` or
     `agent.delegation`.
   - CLI entry `crew.ts` lifecycle (mirrors `flow.ts`), `crews/` registry.
   - Feeds Slice 12/13; out-of-scope list (memory, Flows, planning/HITL).
   - Renumbered old §§10-12 → §§11-13 (On-disk stores, Testing strategy,
     Glossary) and fixed the one internal cross-reference that pointed at
     the old Glossary number (§12 → §13).

5. **Module map (§2)**: audited every edge/node against the code — found it
   **already complete and correct**; no changes made (adding redundant edges
   would violate the "match the exact Mermaid/table style, don't invent a new
   format" constraint and add noise for no accuracy gain).

## Verification

- `bun run docs:check` → `✔ docs-check: living docs present + linked; every
  src subsystem documented.` PASS.
- `bun run typecheck` → clean (docs-only change, as expected).
- `bun run lint` → `Checked 152 files in 46ms. No fixes applied.` clean.
- `bun test` → `218 pass, 16 skip, 0 fail` (skips are the `*.live.test.ts`
  suite, expected without a running Ollama).
- `git status` confirmed only `docs/architecture.md` was modified — no
  `src/**` touched.

## Commit

`4f60d10` — `docs(slice-11): document crews & roles in architecture.md`
(1 file changed, 89 insertions, 4 deletions) on branch `slice-11-crews`.

## Concerns / follow-ups (non-blocking)

- The brief's literal instruction ("§13") is stale wording once earlier tasks
  folded content into §2/§9 first — I resolved this by making the new
  section the *next available number* (§10) and renumbering downstream
  sections, which keeps the doc's existing "one topic per numbered section,
  sequential" convention intact rather than shoehorning crews in as a final
  §13 out of chronological order. Section numbers aren't pinned anywhere
  externally except README's one link to §9 (Workflow/DAG engine), which is
  unaffected.
- `src/crew/engine.ts`'s own code comment ("never throws into the caller")
  is technically inaccurate per the code (confirmed via `runOrchestrator`'s
  `throw err`). Brief was docs-only/no `src/**` changes, so I did not touch
  the comment — flagging as a candidate one-line source fix for a future
  cleanup pass.
- Did not touch `README.md`; it has no Slice-11/crew content yet and the
  brief didn't ask for it. Its one architecture.md section link (§9,
  Workflow/DAG engine) is unaffected by the renumbering.
