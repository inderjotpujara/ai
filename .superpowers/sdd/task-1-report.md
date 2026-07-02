# Task 1 Report: `agents/index.ts` registry + behavior-preserving rewiring (Slice 17)

## Status
DONE

## Commit
`refactor(agents): agents/index.ts registry; super/chat/flow build agent set from it (Slice 17 Task 1)`

## What changed

- **Created `agents/index.ts`** — exactly as specified in the brief: `AgentFactory` type,
  `AGENTS: Record<string, AgentFactory>` (insertion order `file_qa`, `web_fetch`),
  `agentNames()`, and the two literal marker comments
  `// AGENT-BUILDER:IMPORTS ...` and `// AGENT-BUILDER:ENTRIES ...` for a later task to
  splice generated agents into.
- **Rewrote `agents/super.ts`** — `createSuperAgent` signature changed from
  `(fileQaTools: ToolSet, fetchTools: ToolSet, onBeforeDelegate?)` to
  `(toolsFor: (name: string) => ToolSet, onBeforeDelegate?)`. It now builds the agent
  list by mapping `agentNames()` through `AGENTS[name](toolsFor(name))` instead of
  hand-wiring the two specialists.
- **`src/cli/chat.ts`** (~line 110) — updated the one caller to
  `createSuperAgent((name) => reg.forAgent(name), onBeforeDelegate)`.
- **`src/cli/flow.ts`** (~line 130) — replaced the hand-built two-line agent map with a
  loop over `agentNames()` pulling factories from `AGENTS`; removed the now-unused
  `createFileQaAgent` / `createWebFetchAgent` imports, added
  `import { AGENTS, agentNames } from '../../agents/index.ts';`. `warnUnknownAgents` call
  is unchanged. `crew.ts` was not touched (uses `reg.merged`, not per-agent — per brief).
- **New test `tests/agents/registry.test.ts`** — written first (brief's exact content),
  confirmed RED, then GREEN after implementation.

## Deviation from the brief's literal code (typecheck-driven)

This repo's `tsconfig.json` has `noUncheckedIndexedAccess: true`. Under that flag, **both**
bracket access (`AGENTS[name]`) **and dot access** (`AGENTS.file_qa`) on a
`Record<string, AgentFactory>` type resolve through the index signature and are typed
`AgentFactory | undefined`, so the brief's verbatim `AGENTS[name](toolsFor(name))` /
`AGENTS.file_qa(empty)` calls fail `tsc --noEmit` with "Cannot invoke an object which is
possibly 'undefined'." Fixed minimally, invariants unchanged:
- `agents/super.ts` and `src/cli/flow.ts`: look up the factory into a local `const`,
  `if (!factory) throw new Error(...)` (early-return style, no `!` non-null assertions —
  none exist elsewhere in the codebase), then call it. The throw is unreachable in
  practice since `name` always comes from `Object.keys(AGENTS)`.
- `tests/agents/registry.test.ts`: changed `AGENTS.file_qa(empty)` /
  `AGENTS.web_fetch(empty)` to `AGENTS.file_qa?.(empty)` / `AGENTS.web_fetch?.(empty)` —
  same runtime assertion, satisfies strict TS.

All other test/interface content matches the brief verbatim.

## Additional fixes required to keep the build green (not listed in the brief but necessary)

The `createSuperAgent` signature change breaks every other caller using the old two-ToolSet
positional form. Fixed to preserve identical behavior:
- `tests/agents/super.test.ts` — updated both tests to call
  `createSuperAgent(() => ({ read_file: {...} }))` (a `toolsFor` closure) instead of two
  positional ToolSets.
- `tests/integration/orchestrator.live.test.ts` (2 call sites),
  `tests/integration/orchestrator-web.live.test.ts`,
  `tests/integration/run-viewer.live.test.ts` — these `.live.test.ts` files (real-Ollama
  integration tests, `describe.skipIf`) called `createSuperAgent(tools, {})` /
  `createSuperAgent(fileServer.tools, fetchServer.tools)`. Rewrote each as a `toolsFor`
  closure routing by agent name (`(name) => (name === 'file_qa' ? tools : {})`, etc.) —
  identical tool assignment to before, just expressed as a function. These are skipped
  without a live Ollama, but they must still typecheck (they're in scope of
  `bun run typecheck`), and this preserves their intended live-verify coverage.
- `tests/integration/workflow.live.test.ts` was **not** touched — it calls
  `createFileQaAgent`/`createWebFetchAgent` directly (unaffected signatures).

## RED → GREEN evidence

RED (before `agents/index.ts` existed):
```
$ bun test tests/agents/registry.test.ts
error: Cannot find module '../../agents/index.ts' from '/Users/inderjotsingh/ai/tests/agents/registry.test.ts'
 0 pass
 1 fail
 1 error
```

GREEN (after implementation):
```
$ bun test tests/agents/registry.test.ts tests/cli/flow.test.ts
 7 pass
 0 fail
 18 expect() calls
Ran 7 tests across 2 files. [306.00ms]
```

Including `tests/agents/super.test.ts` (also touched):
```
$ bun test tests/agents/registry.test.ts tests/cli/flow.test.ts tests/agents/super.test.ts
 9 pass
 0 fail
 23 expect() calls
Ran 9 tests across 3 files. [250.00ms]
```

## Full-suite behavior-preservation check

```
$ bun test
 431 pass
 2 skip
 0 fail
 932 expect() calls
Ran 433 tests across 130 files. [244.50s]
```
(The 2 skips are pre-existing `describe.skipIf(!ready)` live-Ollama gates, unrelated to
this change — no Ollama server running in this environment.)

## Gates

- `bun run typecheck` — clean, no errors.
- `bun run lint:file -- "agents/index.ts" "agents/super.ts" "src/cli/chat.ts" "src/cli/flow.ts" "tests/agents/registry.test.ts" "tests/agents/super.test.ts" "tests/integration/orchestrator.live.test.ts" "tests/integration/orchestrator-web.live.test.ts" "tests/integration/run-viewer.live.test.ts"` — `Checked 9 files in 37ms. No fixes applied.`
- Confirmed `createFileQaAgent` / `createWebFetchAgent` imports removed from
  `src/cli/flow.ts` (grep + lint pass with no unused-import complaints).

## Concerns

None blocking. Two intentional, documented deviations from the brief's literal code
(both forced by `noUncheckedIndexedAccess: true`, not by choice), and four extra files
fixed beyond the brief's file list — all strictly required for the signature change to
compile/behave identically, none change intended behavior. No `docs/architecture.md` /
README / ROADMAP / SDD-ledger updates included in this task's commit — this is one task
of a multi-task slice; the brief's Step 8 commit scope covers code + tests only, and the
slice-level docs updates belong at the slice's final review per the project's
documentation hard-line.
