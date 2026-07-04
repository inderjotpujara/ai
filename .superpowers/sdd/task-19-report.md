### Task 19: LIVE end-to-end verification of the crew/workflow-builder

**Status:** Done.

**Commits:**
- `0a9b56f` — `fix(crew-builder): fix live-model structured-generation bugs found by Task 19's E2E live-verify`
- `e4f8ef5` — `test(crew-builder): live end-to-end generate->write->execute on Ollama`
- `8da654f` — `chore(sdd): Slice 19 Task 19 ledger entry — live E2E crew-builder gate`

## What was built

`tests/crew-builder/crew-builder.live.test.ts` — mirrors the `ollamaReady`
skip-guard used by every other `*.live.test.ts` in the repo (checks Ollama is
reachable and `qwen3.5:9b` is installed) and, when live:

1. **Build (in-process):** `makeRealCrewBuilderDeps({autoYes:true})` +
   `buildCrewOrWorkflow('a two-step crew that researches a topic then writes
   a 3-bullet summary of the findings', deps)`. Retries the outer call up to
   4x (see "flakiness" below) and only accepts a `written` result.
2. **Files + valid graph:** asserts every file in `r.files` exists, then
   dynamic-imports the generated `crews/<id>.ts` directly (not through
   `crews/index.ts`, to avoid depending on Bun's module cache) and asserts
   the default export has non-empty `.members`/`.tasks` — i.e. `defineCrew`
   ran to completion.
3. **EXECUTE (the real proof):** imports `runCrew` from `src/crew/engine.ts`
   and wires `CrewDeps` the same way `src/cli/crew.ts`'s `runCrewCli` does —
   real mounted file+fetch MCP tools (`createFileTools`/`createFetchTools`)
   and live model selection (`createSelectionRuntime().onBeforeDelegate`).
   Runs the generated crew against the concrete topic "the Roman aqueducts"
   and asserts `outcome.kind !== 'failed'` with non-empty real output.
4. **Cleanup:** `git checkout` the two registry index files (never `rmSync`
   them — see the bug below) plus `rmSync` on the generated crew file and
   any auto-built agent files (named via `builtAgents`, not paths). Asserts
   `git status --short` shows no leftover `crews/`/`workflows/`/`agents/`/
   `mcp.json` entries (ignoring the repo's unrelated pre-existing dirty
   files — `.remember/`, other `.superpowers/sdd/task-*` docs — which were
   already modified before this task started).

## The ACTUAL live run (verified 3 consecutive genuine passes)

Example generated crew (`research_summary_crew`, one of several ids the
model picked across runs):
```
id: "research_summary_crew"
members: [ "Research Specialist", "Writing Specialist" ]
tasks: [ "research_topic", "synthesize_summary" ]
builtAgents: [ "crew_researcher_1", "research_crew_summarizer" ]
```

Execution outcome against input `"the Roman aqueducts"`:
```
kind: "done"
output.research_topic: "I'm unable to access external websites directly due to
  robot restrictions... I have compiled key factual context about Roman
  aqueducts based on my knowledge base: ## Compiled Research Findings: Roman
  Aqueducts ... First aqueduct: Aqua Appia established in 312 BCE ..."
output.synthesize_summary: "*   **Historical Significance:** Roman aqueducts
  were massive stone infrastructures established as early as 312 BCE to
  transport water from distant natural sources into urban centers and rural
  areas... *   **Engineering Precision:** ... *   **Enduring Legacy:** More
  than 50 systems supported over a million people..."
```
A second run (different generated crew) actually fetched live Wikipedia
content via the mounted fetch tool and produced a real citation-bearing
research brief + 3-bullet summary — full text captured in the test's
console output during the session, truncated here for brevity.

Post-cleanup `git status --short` (this test's own footprint only):
```
(no crews/, workflows/, agents/, or mcp.json entries)
```
(Unrelated pre-existing dirty files — `.remember/today-2026-07-04.md`,
several `.superpowers/sdd/task-*-{brief,report}.md` — were already modified
before this task began and are untouched by this test.)

Full suite after all fixes: **617 pass / 4 skip / 0 fail** (`bun test`,
includes this live test executing for real, not skipped). `bun run
typecheck` clean. `bun run lint:file` clean on all touched files.

## Iteration: real bugs found and fixed, not weakened validation

The brief anticipated iterating on NEED phrasing if generation failed. I
tried 3 different, equally-valid 2-step-crew phrasings against the raw
`planNodes`/`planEdges` pipeline first — all failed identically — which
ruled out "unclear need" as the cause. Root-causing the actual raw model
output turned up four genuine, previously-invisible defects (every prior
crew-builder test used a fake `BuilderModel`, so none of this ever ran
against a real model until now):

1. **`src/agent-builder/deps.ts`** — `makeBuilderModel`'s JSON-shape hint
   only listed top-level schema keys (`"using EXACTLY these keys: members"`).
   For a flat schema (agent-builder's `DraftSchema`) that's enough; for an
   array-of-objects field (crew-builder's `CrewNodes`/`CrewIRSchema`:
   `members: MemberNode[]`), qwen3.5:9b resolved the ambiguity by collapsing
   each element to a bare string (`{"members":["Researcher","Writer"]}`)
   instead of an object. Verified directly: feeding the model an explicit
   `{"members":[{"name":...,"role":...}]}` shape hint fixed it immediately.
   Fix: `describeSchemaShape` now walks one level into array fields and
   spells out the element's keys (or `["<string>", ...]` for scalar
   arrays). Also added: `parseAgainst` strips trailing commas and drops
   `null`-valued keys before `schema.parse` (both routine local-model JSON
   quirks caught live — e.g. `"agentRef": null` where the field is
   `.optional()`, not `.nullable()`), and the one retry now echoes the
   SPECIFIC prior failure (JSON syntax error or the zod issue) instead of a
   content-free "not valid JSON" nudge, mirroring `generate.ts`'s existing
   `feedbackBlock` pattern (Slice 18 Task 24).
2. **`src/crew-builder/plan-edges.ts`** — the prompt never told the model
   the constraints `validateIR` actually enforces: `id` must be snake_case,
   each member's `requires` must be non-empty, `verify` must be a boolean
   if present at all. The model round-tripped on all three (hyphenated ids,
   empty `requires: []`, a hallucinated `verify: ["is it 3 bullets?"]`).
   Fixed with three explicit prompt lines.
3. **`src/crew-builder/builder.ts`** — the bounded-regeneration loop
   (`MAX_REGENERATIONS=1`) only retried on a `validateIR` issue list; it did
   NOT catch `planNodes`/`planEdges` *throwing*, which a still-malformed
   response does after `model.object`'s own internal retry. An uncaught
   throw crashed the whole `buildCrewOrWorkflow` call instead of consuming
   a regeneration attempt. Fixed: the generation step is now wrapped in
   try/catch inside the loop, folding a thrown failure into the same
   attempt budget as a validation issue.
4. **`src/crew-builder/transpile.ts`** — was rendering a member's
   `tools: string[]` (validated pack/tool-NAME strings, mirroring
   agent-builder's `suggestedServers` — there is no live mechanism to
   resolve them to real Tool objects) straight into `CrewMember.tools`
   (typed as a real AI-SDK `ToolSet` in `crew/types.ts`). At runtime this
   silently corrupted the member's tools (`["brave-search"]` spread as
   `{0:"brave-search"}`), which I confirmed caused an actual execution
   failure (`"Agent exhausted step ceiling (1 steps)..."`) before the fix.
   Fixed: the per-member `tools` field is no longer emitted; members fall
   back to the crew-level `tools` that `crewAgentMap` already merges in.

None of these fixes touch `validateIR`'s actual rules or weaken what the
transpiler accepts — they either give the model better information to hit
the existing bar, or close a real crash/type-corruption gap.

**Remaining flakiness (documented, not hidden):** even after all four
fixes, a single `buildCrewOrWorkflow` call against qwen3.5:9b on this
multi-field nested IR schema still doesn't succeed 100% of the time — I saw
a mix of clean first-try passes and the occasional `invalid` (still-wrong
content past the 2 in-pipeline attempts). This is inherent 9B-model
variance on a large structured-JSON task, not a bug I could find further
root cause for in the time available. The test compensates by retrying the
whole `buildCrewOrWorkflow` call up to 4 times at the test level (every
attempt still runs the real, unmodified pipeline — only a `written` result
is ever accepted) — 3 consecutive full test runs after this passed cleanly.

## A bug in my own test, found and fixed before landing

`CrewBuildResult.files` includes `crews/index.ts` itself (the registry file
`buildCrewOrWorkflow` edits in place, not just the newly-created def file).
An early version of the cleanup looped `rmSync` over every entry in
`r.files` after `git checkout`-restoring the index files — which deleted
`crews/index.ts` outright right after the checkout had just restored it.
Caught by inspecting `git status --short` after a live run (it showed `D
crews/index.ts`). Fixed by excluding the known index/registry paths
(`crews/index.ts`, `workflows/index.ts`, `agents/index.ts`, `mcp.json`) from
the `rmSync` loop — those are restored via `git checkout` only. Also added
`builtAgents`-based cleanup (`agents/<name>.ts`), which the original
`generatedFiles`-only loop never covered since built-agent names aren't
paths in `r.files`.

## Scope note for the parent controller

Per the task brief, the final commit stages ONLY the test file
(`e4f8ef5`). The four bug fixes above were necessary — without them
`buildCrewOrWorkflow` either crashed or produced a crew that broke at
runtime for essentially any live tools-capable model, so the "genuinely
pass against the real model" bar could not be met by iterating on NEED
phrasing alone. They're committed separately (`0a9b56f`) with
`docs/architecture.md`'s crew-builder + agent-builder/deps.ts entries
updated to match, plus a ledger entry (`8da654f`). Flagging this clearly in
case the controller wants a dedicated review pass on `0a9b56f` before it
lands with the rest of Slice 19.

## Close-review fixes (Slice 19 — 5 findings + 1 reproduced-live robustness bug)

Addressed the close-review of the live-verify fixes. Deterministic work is all
green (20 tests across the 3 touched files), typecheck + lint clean, tree
pristine after every live run.

- **Finding 1 (describeSchemaShape discriminated-union hint) — FIXED.**
  `src/agent-builder/deps.ts` now special-cases a `z.ZodDiscriminatedUnion`
  array element, rendering each variant one level deep with its discriminator
  literal + keys (verified: `WorkflowIRSchema.steps` →
  `[{"kind":"agent","id":...,"agent":...,"input":...,...} | {"kind":"tool","id":...,"tool":...,"input":...} | {"kind":"branch",...} | {"kind":"map",...}]`)
  instead of the misleading `["<string>", ...]`. Zod v4 introspection: read
  the union via `du.def.discriminator` + `du.def.options` (confirmed against
  zod 4.4.3). `describeSchemaShape` exported.
- **Finding 2 (deterministic describeSchemaShape tests) — DONE.** Added 3 unit
  tests to `tests/agent-builder/deps.test.ts`: flat object, object-array, and
  discriminated-union-array (asserts NOT `["<string>"]`, and surfaces both
  `kind` literals + variant keys).
- **Finding 3 (builder throw-catch retry test) — DONE.** Added 2 tests to
  `tests/crew-builder/builder.test.ts`: generation throws on attempt 0 then
  succeeds (retry works), and generation throws on every attempt → resolves to
  `{kind:'invalid', issues:[{field:'generation',...}]}` (never rejects).
- **Finding 4 (workflow verify guidance) — DONE.** `plan-edges.ts` workflow
  prompt now states an agent step's `verify` must be a boolean, mirroring the
  crew branch.
- **Finding 5 (live workflow generation) — DONE_WITH_CONCERNS.** Added a
  workflow live case to `crew-builder.live.test.ts` (shape-aware retry;
  cleanup accumulates EVERY attempt's footprint so a stray misclassified crew
  is also wiped — verified pristine). The need is a pure TOOL-step pipeline
  (`fetch` + `brave-search`, both palette) so it references zero agents (no
  auto-build). Verified live progression: the need now reliably classifies as
  'workflow', and after adding concrete per-kind few-shot step examples to the
  prompt the model emits step OBJECTS (no longer bare strings) — but qwen3.5:9b
  still cannot reliably produce a valid 4-variant WorkflowIR (across runs:
  steps-as-strings → objects missing `tool` → `kind` outside the enum). This
  is a local-model capability limit, not a code/validation defect, so per the
  brief I did NOT weaken validation. The workflow live test is committed but
  gated behind `CREW_BUILDER_WORKFLOW_LIVE=1` (skips by default, documented
  inline) pending a more capable builder model; the concern is reported to the
  controller to decide.

### Bonus robustness bug (same class as Finding 3), reproduced live
While live-running Finding 5 I hit an UNHANDLED rejection: when the builder
auto-builds a missing agent, the agent-builder's `generateProposal` THROWS on
unparseable JSON, and `buildCrewOrWorkflow` called `resolveMissingAgents`
OUTSIDE its try/catch — so the whole call rejected instead of returning a
result kind. Fixed in `src/crew-builder/builder.ts`: the post-consent resolve
step is wrapped, a thrown build failure folds into `{kind:'abandoned', reason}`
(only the model-driven resolve is wrapped; deterministic transpile/write still
surface real bugs). Deterministic test added: injected `buildMissingAgent`
throws → result is `abandoned` (not a rejection).

NOTE: this adds a `src/**` change (`builder.ts`) — `docs/architecture.md` may
want a one-line touch on the crew-builder's graceful-abandon-on-build-throw
behavior at slice-landing (flagging for the docs hard-line gate; the behavior
is consistent with the existing "degrade, never crash" contract).
