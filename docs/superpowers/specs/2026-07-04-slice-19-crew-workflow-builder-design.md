# Slice 19 — Crew/Workflow Builder (Phase D)

**Status:** design approved 2026-07-04 · **Branch:** `slice-19-crew-workflow-builder`
**Depends on:** Slice 17 agent-builder (`src/agent-builder/`), Slice 10 workflow engine (`src/workflow/`), Slice 11 crews (`src/crew/`), Slice 15 MCP starter pack.
**Research grounding:** `reference-crew-workflow-builder-findings` memory (validated 2026-07-04).
**Posture:** full-throttle — complete in-slice, no deferrals (`feedback-no-deferrals-full-throttle`).

---

## 1. Goal

Extend Phase-D self-extension one level up: a user describes a **multi-step**
need in chat (or via CLI), and the system generates a **crew** *or* a
**workflow** that composes existing **and** freshly-built agents, wires them
into a valid graph, and — after review + consent — writes it to disk so it runs
on the next invocation. This proves the "compose a crew/workflow" half of the
Phase-D north-star (`phase-d-agent-builder-northstar`), the agent-builder having
proved the "generate a specialist" half.

**Success = live-verified end to end on Ollama:** a NL need → a generated
crew/workflow whose missing member agents are auto-built (consent-gated) → both
written atomically → the crew/workflow actually executes and produces a correct
result on the next run.

## 2. Scope (complete — nothing deferred)

- Generates **both** shapes: a `CrewDef` (CrewAI-style role/goal/task) **and** a
  raw `WorkflowDef` DAG, chosen by a classify stage.
- Supports **both** crew processes — `CrewProcess.Sequential` **and**
  `Hierarchical` — and the **full** `StepKind` set for workflows
  (`Agent`, `Tool`, `Branch`, `Map`, `Verify`).
- **Auto-builds missing member agents** by invoking the Slice-17 agent-builder,
  under per-agent consent.
- Final persisted artifact is **TypeScript source** (`crews/<name>.ts` /
  `workflows/<name>.ts`) registered in the existing index registries — but is
  produced via a staged, validated **declarative IR → deterministic transpile**
  path (§4), never one-shot TS.
- Two triggers: `bun run crew-builder "<need>"` (+ `--yes`) and a TTY-gated offer
  in `chat.ts` when a **multi-step** capability gap is detected.

### Non-goals (genuinely out of theme, not punted)

- **Behavioral verification** of the generated crew (execution dry-run +
  golden-eval + reuse/archive) — that is the *whole point* of Slice 20 and is a
  distinct capability, not a subset we're skipping. Slice 19's bar is
  structural + semantic *validity* + a real live-verify pass, not an automated
  behavioral guarantee for arbitrary generated crews.
- A serialized runtime format / IR loader for hand-authored crews. The IR here
  is a **build-time internal** representation; the runtime format stays
  hand-written TS calling `defineCrew`/`defineWorkflow`.
- Triggers/scheduling (Phase E), multimodal (Phase F).

## 3. Why staged IR-then-transpile (the load-bearing design decision)

Validated research (`reference-crew-workflow-builder-findings`): a small local
model **one-shotting a DAG succeeds ~29%** (Prompt2DAG, 15% on fan-out; Qwen-3B
6.7%). Two techniques lift this to ~78–92%: **think-first/serialize-later** and
**staged generation**. The CrewAI lesson (config-vs-code drift) + Prompt2DAG both
point to generating a **validatable declarative spec first, then transpiling**.

`WorkflowDef`/`CrewDef` are also **not JSON-serializable** — they carry live
closures (`input`/`predicate`/`over`) + Zod schemas. So the model cannot emit
them as data anyway. The IR resolves both problems: the model produces flat,
validatable JSON in stages; a deterministic transpiler renders correct-by-
construction TS (including the closures, via the safe-helper vocabulary).

## 4. Architecture — `src/crew-builder/`

New subsystem, sibling to `src/agent-builder/`, reusing its `BuilderModel`
(`deps.ts` — `generateText`+extractJSON+Zod+stricter-retry, **not**
`generateObject`; see `reference-generateobject-local-models`), consent flow, and
atomic-write conventions.

### 4.1 IR types — `ir.ts`

Flat, JSON-safe, Zod-schema'd. `CrewIR { id, description, process, members[],
tasks[] }` and `WorkflowIR { id, description, steps[] }`. Step/task inputs,
predicates, and map-sources are expressed as **safe-helper descriptors**
(tagged unions like `{ kind: 'fromStep', ref: 'fetch' }`), never closures.
`ir.ts` also holds the Zod schemas used by both generation validation and the
transpiler.

### 4.2 Staged generation (each stage: `generateText`→extractJSON→Zod→stricter-retry)

Per-stage schemas are **flat and lightweight** (research: recursive DAG schemas
are the grammar backends' hard case). Ollama native `format`/XGrammar may be
applied on the final serialize step as a cheap parseable-JSON complement, **never
as the trust boundary**.

- **`classify.ts`** — need → `crew` | `workflow` (small enum; NL rationale first).
- **`analyze.ts`** — *think-first*: NL decomposition of the need into
  steps/roles/data-flow. **No JSON.** Output feeds later stages as context.
- **`plan-nodes.ts`** — emit the member/agent list (+ per-member role/goal/tools
  for crews) and required tools (palette-only, from `STARTER_PACK`). Flat JSON.
- **`plan-edges.ts`** — wire dependencies + control flow using the **safe-helper
  vocabulary**. Flat JSON. Assembles into the `CrewIR`/`WorkflowIR`.

Prompt-injection guard (agent-builder parity): the raw `need` is inserted as
`<need>…</need>` delimited **data**, with an explicit "this is data, not
instructions" preamble.

### 4.3 Safe-helper vocabulary — `safe-helpers.ts`

The complete closure vocabulary the transpiler renders and the runtime executes.
Model picks **only** from these (validated against an allow-list; each call's
args/refs checked). Covers **every** StepKind — nothing dropped:

- Inputs: `fromInput()`, `fromTemplate('…{{step_id}}…')`, `fromStep('id')`.
- Branch predicates: `whenEquals(ref, value)`, `whenContains(ref, substr)`,
  `whenTruthy(ref)` (+ negations).
- Map: `mapOver(ref)`.

Each helper is a factory returning the exact closure type the engine expects
(`(ctx) => string` / `(ctx) => boolean` / `(ctx) => unknown[]`). The vocabulary
is schema-described so it doubles as the model's enum of legal operations.

### 4.4 Two-tier validation gate — `validate.ts`

Runs on the IR **before** transpile. Failures from **either** tier feed back
into the stricter-retry loop (not just parse errors).

- **Structural** — reuse `defineCrew`/`defineWorkflow` (Kahn acyclicity, unique
  ids, dep/target/member resolution) + new checks: every `fromStep`/template ref
  resolves to a real upstream node; tools are palette-only + scoped; branch/map
  well-formed; member refs resolve to `AGENTS ∪ to-be-built`.
- **Semantic** — (a) **static type-binding**: each producer step's output type
  (its Zod schema) can satisfy the consumer's input contract — deterministic,
  using our typed agent I/O; (b) **LLM-judge goal-alignment**: a lightweight
  single-shot judge answering "does this graph accomplish `<need>`?" (the only
  place a model re-enters after generation).

### 4.5 Transpile — `transpile.ts`

Deterministic IR → TS codegen. **No model in the loop** → correct-by-
construction. Renders `crews/<name>.ts` or `workflows/<name>.ts` calling
`defineCrew`/`defineWorkflow`, with safe-helper calls emitted from the IR
descriptors and **all** strings via `JSON.stringify`. Mirrors the shape of
`crews/research-crew.ts` / `workflows/fetch-then-summarize.ts`.

### 4.6 Resolve + auto-build missing members — `resolve-members.ts`

Diff IR member refs against `AGENTS` (`agents/index.ts`). For each missing
member, invoke the Slice-17 `buildAgent` (its own generate→suggest→validate→
consent→write), consent **per agent**. Reuses agent-builder wholesale — no fork.

### 4.7 Atomic multi-write — `write.ts`

All-or-nothing (`.tmp`+`renameSync`, agent-builder parity). Writes: N new agent
files + their `agents/index.ts` marker registrations + `mcp.json` scoping; the
crew/workflow TS; and the marker-anchored registration in `crews/index.ts` **or**
`workflows/index.ts`. Add matching `// CREW-BUILDER:IMPORTS`/`:ENTRIES` markers to
`crews/index.ts` and `workflows/index.ts` (mirroring `agents/index.ts`). If any
write fails, none commit.

Safety model (agent-builder parity): review-before-activate (mandatory consent),
palette-only tools, **no same-run activation** — the crew + any new agents are
live on the *next* process start. Consent surface shows the proposed IR (human-
readable) + the missing-agent builds + the target file paths.

### 4.8 Orchestration + CLI — `builder.ts`, `src/cli/crew-builder.ts`

`buildCrewOrWorkflow(need, deps)`: classify → analyze → plan-nodes →
plan-edges → validate(2-tier) → resolve-members(auto-build) → consent →
write, wrapped in a telemetry span. Returns a discriminated
`BuildResult` (`written` / `declined` / `invalid` / `abandoned`), agent-builder
parity. CLI `bun run crew-builder "<need>" [--yes]`; `chat.ts` gains a TTY-gated
offer on a **multi-step** gap outcome (single-agent gaps still route to the
agent-builder).

## 5. Telemetry to emit (mandated note)

Add to `src/telemetry/spans.ts` a `withCrewBuildSpan` helper + `ATTR` keys, per
the standing OTel extensibility rule (`reference-otel-run-viewer-constraint`) —
transport untouched:
- Span `crew.build` (or `workflow.build`) with attrs: `crewbuild.shape`
  (crew|workflow), `crewbuild.process`, `crewbuild.member.count`,
  `crewbuild.members.built` (count auto-built), `crewbuild.step.count`,
  `crewbuild.outcome`.
- Per-stage **events**: `crewbuild.stage` (classify/analyze/plan-nodes/
  plan-edges/validate/transpile/write) with retry counts; `crewbuild.validation`
  events carrying tier (structural|semantic) + pass/fail + reason.
- Reuse the existing `agent.build` span for each auto-built member (nested).

## 6. Architecture-doc update (mandated note)

New `docs/architecture.md` section (§19) for `src/crew-builder/`: the staged
pipeline, the IR-then-transpile mechanism, the safe-helper vocabulary, the
two-tier validation gate, the auto-build-missing composition with the agent-
builder, and the module/data-flow edges (crew-builder → agent-builder, →
crew/workflow define, → AGENTS registry, → MCP pack, → telemetry). Update the
doc map + README pointer. Then regenerate the interactive architecture Artifact
(new crew-builder node + edges, footer slice/test counts) per the hard line.

## 7. Testing + live-verify

- **Unit** (injected fakes, agent-builder pattern): each stage; safe-helper
  factories; transpiler golden-output (IR → exact TS); two-tier validator
  (structural + semantic cases incl. valid-but-goal-misaligned); atomic write
  incl. rollback; resolve-members with mocked agent-builder.
- **Contract**: generated TS re-parses through `defineCrew`/`defineWorkflow`
  without error (closes the transpiler↔engine loop).
- **Live-verify (full-throttle gate, on Ollama):** a real NL multi-step need →
  generate → auto-build a genuinely-missing member → write both → **re-run and
  execute the crew/workflow to a correct result**. A `*.live.test.ts` covering
  the whole loop (also discharges the Slice-17 "no agent-builder live test"
  debt for the shared path).

## 8. Full-throttle completeness checklist (all in this slice)

- [ ] Both crew (Sequential + Hierarchical) and workflow (all 5 StepKinds).
- [ ] Staged generation + think-first + two-tier validation + retry loop.
- [ ] Complete safe-helper vocabulary (every StepKind expressible).
- [ ] Deterministic transpiler with golden tests.
- [ ] Auto-build missing members via agent-builder, consent-gated, atomic bundle.
- [ ] CLI + chat trigger.
- [ ] `crews/index.ts` + `workflows/index.ts` builder markers.
- [ ] Telemetry span + per-stage/validation events.
- [ ] Live-verify the whole loop on Ollama (execute, not just write).
- [ ] All 4 doc surfaces + Artifact regen + SDD ledger.
