# Task 7 report — shared live-selection runtime + crew CLI + registry + flow.ts upgrade

(Note: this filename previously held a stale report from an unrelated earlier task
that happened to reuse the same path. This report replaces it and documents Slice 11
Task 7 only.)

Branch: `slice-11-crews` (session's actual current branch — the task prompt referenced
`slice-10-workflow-engine`, but the live git state at task start was `slice-11-crews`,
clean, with Tasks 1-6 of Slice 11 already committed. Stayed on it per "stay on it, do
not create a new branch.")

## Files created

- `/Users/inderjotsingh/ai/src/cli/select-runtime.ts` — `createSelectionRuntime(opts?)`
- `/Users/inderjotsingh/ai/crews/research-crew.ts` — sequential researcher→writer example crew
- `/Users/inderjotsingh/ai/crews/index.ts` — `CREWS` registry + `getCrew`
- `/Users/inderjotsingh/ai/src/cli/crew.ts` — `runCrewCli` + `main()`
- `/Users/inderjotsingh/ai/tests/cli/select-runtime.test.ts`
- `/Users/inderjotsingh/ai/tests/cli/crew.test.ts`
- `/Users/inderjotsingh/ai/tests/integration/crew.live.test.ts`

## Files modified

- `/Users/inderjotsingh/ai/src/cli/flow.ts` — added `onBeforeDelegate?: BeforeDelegate` to
  `FlowDeps`, threaded it into `defaultRunAgentStep(deps.agents, deps.onBeforeDelegate)`,
  and wrapped `main()`'s existing file/fetch-server nesting with a
  `createSelectionRuntime()` (built after the fetch server mounts, closed in `finally`,
  mirroring `crew.ts`'s nesting), passing `onBeforeDelegate: selection.onBeforeDelegate`
  into `runFlow(...)`.
- `/Users/inderjotsingh/ai/package.json` — added `"crew": "bun run src/cli/crew.ts"` right
  after the `"flow"` script line.
- `/Users/inderjotsingh/ai/docs/architecture.md` — see "Docs changes" below.

## Deviations from the brief (as instructed, corrected against real source)

1. **`select-runtime.ts`**: dropped the brief's `import qwenRouter from '../../models/qwen-router.ts';`
   — unused in this file's body (chat.ts uses it for its own router-pinning; this
   module takes `pinned` as a parameter instead). Confirmed via lint (`biome check`
   clean) and typecheck.
2. **`tests/cli/crew.test.ts`**: dropped the brief's `MockLanguageModelV3`/`mockModel`
   import — the test uses `runAgentStep` injection instead and never references the
   mock, so keeping the import would fail lint. The brief's own Step-3 note anticipated
   this ("if unused in the final wiring, drop the import to keep lint clean").
3. **`tests/integration/crew.live.test.ts`**: used the *real* guard, not the brief's
   placeholder (`'../helpers/ollama-ready.ts'` + `it.skip` ternary — that path/API
   doesn't exist). Used the actual `tests/integration/ollama-available.ts` export
   `ollamaReady(model: string): Promise<boolean>` and the `describe.skipIf(!ready)(...)`
   + `test(...)` pattern exactly as `workflow.live.test.ts` does. See "Live-skip guard"
   section below for the exact code and reasoning on omitting `unloadModel`.
4. Both `crew.ts`'s import (`{ type CrewDeps, runCrew }`) and the two new test files
   needed a `biome check --write` pass to satisfy the project's import-sort rule
   (`assist/source/organizeImports`) — the brief's code blocks weren't in that exact
   sorted order. No semantic changes, only import ordering/formatting.

No other API name mismatches: `createSelectHook`'s args (`registry`, `ensureReady`,
`listLoaded`, `pinned`, `capture`, `notify`) matched `src/cli/select-hook.ts`'s
`SelectHookDeps` exactly, as did `CrewDeps` (`runAgentStep?`, `tools`, `maxParallel?`,
`onBeforeDelegate?`) in `src/crew/engine.ts`, and `defaultRunAgentStep(agents, onBeforeDelegate?)`
in `src/workflow/run-step.ts`.

## How chat.ts's wiring was mirrored into select-runtime.ts / crew.ts

`select-runtime.ts` extracts `chat.ts` lines 30-82 verbatim in structure: same
`createModelManager()`, same `ResourceCapture` + `announced` Set, the same `notify`
closure (installed/budget/arch via `Promise.all`, `f16KvBytesPerToken`/
`effectiveKvBytesPerToken`, `formatSelectionNotice`), the same `buildRegistry()` +
`createSelectHook({registry, ensureReady, listLoaded, pinned, capture, notify})` call.
The only structural difference: `pinned` comes from an `opts.pinned` parameter instead
of being hardcoded to `[qwenRouter.model]`, since neither `flow.ts` nor `crew.ts` has
a router model to pin. `close()` wraps `manager.unloadAll()` — the same cleanup
`chat.ts`'s `main()` does in its own `finally`.

`crew.ts`'s `main()` mirrors `flow.ts`'s (post-Task-7) mount/close lifecycle exactly:
mount `fileServer` → mount `fetchServer` → build `selection = await createSelectionRuntime()`
→ run → close `selection` → close `fetchServer` → close `fileServer`, each step in its
own `try/finally`, same nesting order `chat.ts` uses for its own file/fetch servers
(with the selection runtime added as the new innermost layer, matching `flow.ts`).

## createSelectHook args used (confirmed match, no deviation)

```typescript
const registry = await buildRegistry();
const onBeforeDelegate = createSelectHook({
  registry,
  ensureReady: (decl, o) => manager.ensureReady(decl, o),
  listLoaded: () => listLoadedModels(),
  pinned: opts?.pinned ?? [],
  capture,
  notify,
});
```

Matches `SelectHookDeps` in `src/cli/select-hook.ts` field-for-field:
`registry: ModelDeclaration[]`, `ensureReady: (d, o?) => Promise<number>`,
`listLoaded?: () => Promise<LoadedModel[]>`, `pinned: string[]`, `capture: ResourceCapture`,
`notify?: (decl, numCtx) => void | Promise<void>`.

## Live-skip guard used in crew.live.test.ts (confirmed match to workflow.live.test.ts)

```typescript
import qwenFast from '../../models/qwen-fast.ts';
import { runCrewCli } from '../../src/cli/crew.ts';
import { createFetchTools, createFileTools } from '../../src/mcp/client.ts';
import { getCrew } from '../../crews/index.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenFast.model);

describe.skipIf(!ready)('crew.live', () => {
  test('runs the sequential research crew end-to-end against real Ollama', async () => {
    ...
  }, 180_000);
});
```

This is the identical predicate/skip mechanism `workflow.live.test.ts` uses
(`ollamaReady(model)` from `tests/integration/ollama-available.ts`, `describe.skipIf(!ready)`,
`test(...)` not `it`). One deliberate difference from `workflow.live.test.ts`: I used
`qwenFast.model` purely as the *readiness probe* (same "is Ollama up and does at least
one project model exist" check `workflow.live` does), not as a pinned model for the
crew run — `research-crew`'s two members (`researcher`, `writer`) both declare
`prefer: PreferPolicy.LargestThatFits` with no fixed `ModelDeclaration`, so there's no
single deterministic model the crew resolves to ahead of time (unlike
`fetch-then-summarize`, whose `web_fetch` agent is built with a fixed model, which is
why `workflow.live.test.ts` explicitly `unloadModel(qwenFast.model)`s in its `finally`).
Given that, I deliberately **omitted** an explicit `unloadModel` call in
`crew.live.test.ts`'s `finally` — whichever model(s) the live selector actually picks
for `researcher`/`writer` depend on live RAM budget and aren't knowable statically, so
there's no single symbol to unload without either (a) guessing wrong, or (b) querying
`listLoadedModels()` post-hoc and unloading everything found, which felt like scope
creep beyond what this test needs (this test never runs in CI/sandbox — it's
Ollama-gated). This is a self-review flag for a follow-up (see below) rather than a
hidden decision.

Confirmed this test SKIPS in the current sandbox (no Ollama):
```
bun test v1.3.11 (af24e281)

 0 pass
 1 skip
 0 fail
Ran 1 test across 1 file. [103.00ms]
```

## flow.test.ts regression evidence

```
bun test v1.3.11 (af24e281)

 2 pass
 0 fail
 6 expect() calls
Ran 2 tests across 1 file. [126.00ms]
```
Both existing `runFlow` tests (success path + failed-step path) still pass unmodified —
`onBeforeDelegate` is optional on `FlowDeps` and the test never supplies it.

## TDD RED/GREEN evidence for crew.test.ts

RED (before `src/cli/crew.ts` existed):
```
bun test v1.3.11 (af24e281)

tests/cli/crew.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../../src/cli/crew.ts' from '/Users/inderjotsingh/ai/tests/cli/crew.test.ts'
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [15.00ms]
```

GREEN (after writing `src/cli/crew.ts`):
```
bun test v1.3.11 (af24e281)

 1 pass
 0 fail
 3 expect() calls
Ran 1 test across 1 file. [111.00ms]
```

## Full verification gate results

1. `bun test tests/cli/select-runtime.test.ts tests/cli/crew.test.ts tests/cli/flow.test.ts`
   → **4 pass, 0 fail, 11 expect() calls**
2. `bun run typecheck` → clean (`tsc --noEmit`, no output/errors)
3. `bun run lint:file -- "src/cli/select-runtime.ts" "src/cli/crew.ts" "src/cli/flow.ts" "crews/research-crew.ts" "crews/index.ts"`
   → **Checked 5 files in 36ms. No fixes applied.** (clean; one biome import-sort
   issue in `src/cli/crew.ts` was fixed during the pass, see deviation #4 above)
4. `bun test tests/integration/crew.live.test.ts` → **0 pass, 1 skip, 0 fail** (confirmed SKIP)
5. `bun test` (full suite) → **218 pass, 16 skip, 0 fail, 432 expect() calls, across 77 files**
6. `bun run docs:check` → **✔ docs-check: living docs present + linked; every src
   subsystem documented.**

Also ran `bun run check` (the full pre-PR gate: docs-check + typecheck + lint + test)
for completeness. It reports lint errors, but **all of them are pre-existing, in files
Task 7 never touched**: `tests/crew/define.test.ts`, `tests/crew/member-agent.test.ts`,
`tests/telemetry/crew-spans.test.ts` — all landed in earlier Slice-11 commits (Tasks
1-6, `git log` shows `f20351f`/`b8e21e1`/`81eb124`/`6cff656` predating this session).
`git status --short` at the time of this check showed only the seven Task-7 files as
modified/new; none of the three lint-flagged files appear in that list. I left these
alone since fixing unrelated pre-existing lint debt was out of scope and risks
conflating this task's diff with unrelated changes — flagging as a follow-up.

## docs/architecture.md changes and why

Per the hard project rule (every slice/task updates architecture.md to reflect new
modules/edges), added:

1. **Mermaid system map** (`## 2. System map`): added `selrt["select-runtime.ts ·
   createSelectionRuntime"]` and `crewcli["crew.ts · bun run crew"]` nodes to the
   `CLI` subgraph; added `crews["crews/* · CREWS"]` to the `DECL` subgraph; added edges
   `flow --> selrt`, `crewcli --> crewengine`, `crewcli --> runstore`,
   `crewcli -. mounts .-> mcpclient`, `crewcli --> crews`, `crewcli --> selrt`,
   `selrt --> selhook`, `selrt --> buildreg`, `selrt --> mgr` — consistent with how
   `flow.ts`'s existing edges (`flow --> wfengine`, `flow --> runstore`, etc.) were
   represented.
2. **Layer table**: updated the **CLI** row to mention `crew.ts` and
   `select-runtime.ts` (and its extraction-from-`chat.ts` provenance); updated
   **Declarations** to add `crews/` (`CREWS`/`getCrew`, mirrors `workflows/index.ts`);
   updated **Crew / Roles** to document the new `src/cli/crew.ts` CLI entry (lifecycle
   parity with `runFlow`) and its dependency on `cli/select-runtime.ts`.
3. **§9 Workflows / DAG engine narrative**: extended the existing `flow.ts` CLI-entry
   paragraph to mention the selection runtime; added two new paragraphs — "Shared
   live-selection runtime" (describing `createSelectionRuntime`, its extraction from
   `chat.ts`, and that both `flow.ts` and `crew.ts` now use it) and "Crew CLI entry"
   (describing `runCrewCli`'s lifecycle parity with `runFlow`, the `runAgentStep` test
   seam, and `main()`'s wiring).
4. **§11 Testing strategy**: added `crew` to the list of `*.live.test.ts` suites.

Ran `bun run docs:check` after each substantive edit; it passed throughout (the
checker enforces presence/subsystem-linkage, not per-task historical accuracy — the
review-for-truth obligation was carried out manually here by cross-referencing the
diff against the new prose, per the project's stated audit process).

## Self-review: concerns, edge cases, follow-ups

- **`crew.live.test.ts`'s missing `unloadModel`**: documented above. If this becomes a
  real concern (e.g., a follow-up hardens live-test hygiene), the fix would be to call
  `listLoadedModels()` after the run and unload whatever surfaces, rather than a
  hardcoded model name — this test never runs outside a live-Ollama environment so the
  blast radius today is zero, but flagging it so it isn't silently forgotten.
- **`chat.ts` dedup**: per the brief, `chat.ts` is intentionally left with its original
  inline selection wiring (not refactored to call `createSelectionRuntime`) — this is
  explicitly called out as an optional follow-up in the brief's Produces section, not a
  Task 7 requirement. Confirmed I did not touch `chat.ts`.
- **Pre-existing lint debt** in `tests/crew/*.test.ts` and `tests/telemetry/crew-spans.test.ts`
  (from Tasks 1-6, before this session) surfaces under `bun run check`/`bun run lint`
  but not under the task's scoped `lint:file` gate. Left untouched — out of scope, and
  the task's own verification gate list (which I followed exactly) only calls
  `lint:file` on Task 7's own files, which is clean.
- **Branch note**: the task prompt said "Current branch: slice-10-workflow-engine (stay
  on it)" but the actual repo state at session start was branch `slice-11-crews`, clean,
  already containing Slice 11 Tasks 1-6. I stayed on the actual current branch
  (`slice-11-crews`) rather than switching, consistent with "stay on it, do not create
  a new branch" — switching branches would have been a bigger deviation than noting the
  discrepancy.
- No `console.log` was added outside `crew.ts`'s/`flow.ts`'s intentional CLI-facing
  `main()` output, per the constraint.
