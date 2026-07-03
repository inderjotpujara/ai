# Slice 17 — Agent-builder (Phase D) — design

**Date:** 2026-07-02
**Status:** Design (awaiting user review)
**Phase:** D — "Grow it" (self-extension, the ⭐ differentiator)
**Branch:** `slice-17-agent-builder`

## 1. Why this slice

Phase D's headline: *"describe a need → the system grows the capability."* Today a
capability gap is a **terminal outcome** — the orchestrator calls
`report_capability_gap {missingCapability}`, `runChat` surfaces
`{kind:'gap', message}`, and `chat.ts` prints it and stops. `capability-gap.ts:12`
already marks this as the hook: *"The FUTURE agent-builder hooks in here."*

This slice turns that dead-end into a growth point: on a gap (or an explicit
request), an LLM drafts a **new specialist agent definition** + picks a **minimal,
scoped MCP server** from the curated pack, validates it structurally, presents a
**proposal**, and — only on **consent** — writes it to disk so it is live on the
next run.

**North-star (recorded, not all in this slice):** the end state is a user
chatting and getting *any agent or crew that works out of the box*. This slice
delivers the **agent** case; a **crew/workflow builder** is the next slice
(a crew/workflow is composed *from* agents, so agent-generation is its
foundation). The "works out of the box" guarantee is **progressive**: v1
guarantees *structural* validity + consent; a later slice adds execution
dry-run + golden-task eval to make it a *verified* guarantee.

Scope (user-confirmed): **agent-only**; **propose + consent, activate next run**;
**both triggers** (auto-offer on a TTY gap + explicit `bun run agent-builder`).

## 2. Design validated against 2026 practice

(Full research + citations in the session record; key points that shape v1.)
- **Generated-agent contract** = `description` + system `prompt` + an **explicit,
  scoped tool subset** + model. (Claude Agent SDK `AgentDefinition` shape.)
- **Review-before-activate is the hard gate** — never auto-activate a generated
  agent or auto-mount an untrusted server. This slice extends the existing
  consent-gated MCP mounting (Slice 15) to *activating a generated agent*.
- **Scoped tool subsets are dual-purpose** — least-privilege safety *and*
  small-local-model tool-choice accuracy (small models pick badly from large
  tool menus). The generated agent gets only a minimal palette subset.
- **Defer the frontier** — no unbounded self-modification, no same-run retry,
  no generating brand-new tool *code*; instrument the whole loop with telemetry.

## 3. Enabling refactor — `agents/index.ts` registry

Today specialists are **hand-wired in three places** (`agents/super.ts` hardcodes
`[fileQa, webFetch]`; `src/cli/chat.ts` passes `reg.forAgent('file_qa')` +
`reg.forAgent('web_fetch')`; `src/cli/flow.ts` builds the same map). There is **no
`agents/index.ts`** — unlike `workflows/index.ts` and `crews/index.ts`, which are
`Record<id, def>` registries. A generated agent cannot become first-class without
editing those three call sites by hand.

**Change:** introduce `agents/index.ts` — a registry of **agent factories** keyed
by agent name:

```ts
// agents/index.ts
export type AgentFactory = (tools: ToolSet) => Agent;
export const AGENTS: Record<string, AgentFactory> = {
  file_qa: createFileQaAgent,
  web_fetch: createWebFetchAgent,
};
export function agentNames(): string[] { return Object.keys(AGENTS); }
```

`super.ts`/`chat.ts`/`flow.ts` build their agent set by iterating the registry ×
`reg.forAgent(name)` instead of hardcoding two names. This retires the
hand-wiring smell **and** makes a generated agent live the moment its factory is
registered. This is a behavior-preserving refactor (same two agents wired the
same way) done first, so the builder has a registration target.

## 4. New subsystem — `src/agent-builder/` (small focused units)

- **`types.ts`** — the proposal + result shapes:
  ```ts
  export type SuggestedServer = { packName: string; scopeToAgent: string };
  export type AgentProposal = {
    name: string;              // snake_case, unique
    description: string;       // orchestrator routes on this
    systemPrompt: string;
    modelReq: ModelRequirement;// { role, requires:[Capability.Tools], prefer:LargestThatFits }
    suggestedServers: SuggestedServer[]; // from the curated pack only
    rationale: string;         // why this agent + these tools (shown to the user)
  };
  export type ValidationIssue = { field: string; problem: string };
  export type BuildResult =
    | { kind: 'written'; proposal: AgentProposal; files: string[] }
    | { kind: 'declined' }
    | { kind: 'invalid'; issues: ValidationIssue[] }
    | { kind: 'abandoned'; reason: string };
  ```
- **`generate.ts`** — `generateProposal(need, deps)`: a structured-output call
  (`generateObject` + a zod schema mirroring `AgentProposal` minus `suggestedServers`)
  on a live-selected tools-capable model. **The failing-task / need text is passed
  as data inside a delimited block, never as instructions** (prompt-injection
  guard). Returns the draft name/description/systemPrompt/modelReq/rationale.
- **`suggest-tools.ts`** — `suggestServers(need, draft, deps)`: builds the
  candidate set from the pack — `packByCapability(tag)` for any inferred tags,
  else the full 12-entry palette — and has the model pick the **minimal** server
  subset that satisfies the need, returning `SuggestedServer[]` scoped to the new
  agent's name. Never invents a server not in the pack.
- **`validate.ts`** — `validateProposal(proposal, existingNames, packNames)`:
  structural gate returning `ValidationIssue[]`. Rejects: non-snake_case or
  duplicate `name` (vs `agentNames()` + reserved `super`/`orchestrator`); empty
  `description`/`systemPrompt`; any `suggestedServers[].packName` not in the pack
  (**least-privilege: palette-only**); `scopeToAgent !== proposal.name`.
- **`write.ts`** — `writeAgent(proposal, deps)`: (1) render `agents/<name>.ts`
  from a fixed template (guaranteed well-formed `create<Name>Agent(tools):Agent`
  factory with the proposal's description/systemPrompt/modelReq); (2) insert the
  import + registry line into `agents/index.ts`; (3) for each suggested server,
  add its pack entry to `mcp.json` scoped to the agent (reuse `addPackEntry`, then
  inject `agents:[name]`; already-present servers are left as-is + just re-scoped).
  All writes atomic (temp+rename, mirroring `addPackEntry`). Returns the file list.
- **`builder.ts`** — `buildAgent({ need, deps })`: orchestrates
  generate → suggest → validate → (if invalid, return `invalid`) → **consent**
  (proposal rendered to the user; `askYesNo` via Slice 16 `interactiveTTY`) →
  on `y` `write` and return `written`; on `n` return `declined`. Consent is
  **mandatory** and has no auto-yes in the gap path (a `--yes` flag exists only on
  the explicit CLI for tests/automation, mirroring `AGENT_MCP_AUTO_APPROVE`).

Dependencies are injected (`deps`: model runner, consent fn, fs paths, pack
accessors) so every unit is unit-testable without a live model or real writes.

## 5. Data flow

```
gap {missingCapability} + task     (chat, TTY)      OR   bun run agent-builder "<need>"
        │                                                     │
        └──────────────► buildAgent({ need }) ◄───────────────┘
              generate  → AgentProposal draft (task text as DATA)
              suggest   → + suggestedServers (minimal, pack-only, scoped)
              validate  → structural gate (unique name · palette-only tools)
              consent   → render proposal + exact files-to-write · [y/N]
                 └─ y → write: agents/<name>.ts + agents/index.ts + scoped mcp.json  → BuildResult{written}
                 └─ n → BuildResult{declined}   (nothing written)
        │
   next run: agents/index.ts now includes <name>; its MCP server is
   consent-gated + hash-pinned on first mount (Slice 15, automatic).
```

**Chat integration:** at the gap point in `chat.ts`, only when interactive
(`interactiveTTY()`), offer: *"No agent handles ‘<missingCapability>’ yet —
propose one? [y/N]"*. On `y`, call `buildAgent({ need: missingCapability + task })`.
Non-TTY/headless: unchanged — the gap stays terminal (prints the message). The
`{kind:'gap'}` outcome and its telemetry are untouched; the builder is an
additive branch after the gap is surfaced.

## 6. Safety

- **Consent required to write anything** (review-before-activate). No same-run
  activation — files land for the *next* run.
- **Tools only from the curated pack** — the builder can never grant an arbitrary
  or generated tool; palette-only is enforced in `validate.ts`.
- **Prompt-injection guard** — the need/task text is inserted as delimited data
  in the generation prompt, never as instructions.
- **New servers inherit Slice 15 protections** — consent-on-first-mount +
  tool-definition hash-pinning happen automatically when the next run mounts the
  added `mcp.json` entry; keyed servers stay dormant until their env var is set.
- **No OAuth servers, no tool-code generation** (deferred; see §9).

## 7. Telemetry (observable by default)

A new `withAgentBuildSpan` (span `agent.build`) wrapping `buildAgent`, with
attributes/events for each stage: `agent.build.need` (the missing capability),
a `generated` event (proposed name), a `validated` event (ok / issue count), a
`suggested` event (server names), a `consent` event (granted/declined), and a
`written` event (files + server count). New `ATTR` keys under the existing
convention (`agent.build.*`). Emitted into the run trace like every other
subsystem.

## 8. Testing

- **Registry refactor:** `agents/index.ts` lists both existing agents; `chat`/
  `flow` build the same agent set as before (behavior-preserving) — assert the
  orchestrator still exposes `delegate_to_file_qa` / `delegate_to_web_fetch`.
- **generate:** with a stubbed model returning a fixed object, `generateProposal`
  returns a well-formed draft; the need text appears in the prompt as data.
- **validate:** rejects duplicate name, non-snake_case, empty prompt/description,
  off-palette server, mis-scoped server; accepts a clean proposal.
- **suggest-tools:** given a stub model + the real pack, returns only pack names,
  scoped to the agent; never a non-pack name.
- **write:** produces a parseable `agents/<name>.ts` (import + factory), a correct
  `agents/index.ts` insertion, and a scoped `mcp.json` entry; atomic; idempotent
  re-scope of an already-present server; **declined path writes nothing**.
- **builder:** end-to-end with stubs — generate→suggest→validate→consent(y)→write
  returns `written`; consent(n) returns `declined` with no writes; invalid draft
  returns `invalid`.
- **CLI:** `bun run agent-builder "<need>" --yes` writes a proposal into a temp
  workspace and reports the files.
- **Live (Ollama, opt-in):** run a real gap through chat, accept the offer, and
  confirm a usable agent file + scoped `mcp.json` entry are written and the agent
  is registered.

## 9. Explicitly out of scope (deferred, logged)

- **Crew/workflow generation** — the next Phase-D slice; composes existing +
  freshly-built agents (a crew/workflow is built *from* agents).
- **Execution dry-run + golden-task eval before activation** — makes "works out
  of the box" a *verified* guarantee; needs an eval harness. v1 is structural.
- **Reuse-vs-generate + versioned archive** (AgentFactory pattern) — pays off
  only after generated agents accumulate.
- **Same-run auto-retry** of the failed task (the rejected "activate in same run"
  option).
- **Generating brand-new tool/MCP-server code** — the dangerous frontier;
  palette-only.
- **OAuth servers** — static-key only, consistent with Slice 15.

## 10. Standing notes

**Architecture-doc update.** New §18 "Agent-builder (Slice 17)" in
`docs/architecture.md`: the `agents/index.ts` registry, the `src/agent-builder/`
units + data flow, the consent/palette-only safety model, and the `agent.build`
span. Add `src/agent-builder/` and `agents/index.ts` to the module map; note the
gap seam is no longer strictly terminal (additive TTY branch). Update README
(status + slice-17 row + a feature paragraph), ROADMAP (flip Agent-builder
🟡/❌ → ✅ shipped Slice 17 in the gap/phase/sequence tables; add the crew-builder
follow-on + the north-star), and the SDD ledger. Regenerate the snapshot Artifact
(new Agent-builder node + edges cli→builder, builder→pack, builder→agents-registry,
builder→telemetry; footer slice/test counts).

**Telemetry to emit.** `agent.build` span + stage events (generated / validated /
suggested / consent / written); `agent.build.*` attributes. No change to the
existing `agent.gap.missing_capability` attribute.

## 11. Files (estimate)

- **New:** `agents/index.ts`; `src/agent-builder/{types,generate,suggest-tools,validate,write,builder}.ts`; `src/cli/agent-builder.ts`; tests under `tests/agent-builder/` + `tests/agents/index.test.ts`.
- **Changed:** `agents/super.ts`, `src/cli/chat.ts`, `src/cli/flow.ts` (registry-driven agent set; chat gap-branch), `src/telemetry/spans.ts` (`withAgentBuildSpan` + `ATTR`), `package.json` (`agent-builder` script). Docs: architecture.md, README.md, ROADMAP.md, ledger.
