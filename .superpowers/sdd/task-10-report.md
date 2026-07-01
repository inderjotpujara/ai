# Task 10 Report: `--verify` CLI flag + real `VerifyDeps` wiring + `unverified.txt`

(Note: this filename previously held a stale report for an earlier, differently-numbered
"Task 10" — memory recall tool, commit `80bab2d`. That work is real and already landed;
this report replaces it with the actual Slice-13 Task 10 per the current task numbering.)

## What was built

### 1. `src/verification/deps.ts` — the real `VerifyDeps` factory

`makeVerifyDeps({ manager, control, generalModel, store, space }): VerifyDeps`:

- **`generate(model, prompt)`**: builds a chat `ModelDeclaration` for `model`
  (`chatDecl`, mirroring the shape of `models/qwen-router.ts`/`qwen-fast.ts`:
  `ProviderKind.Ollama`, `params: {temperature:0.1, numCtx:8192}`, a
  `footprint` sizing hint), calls `manager.ensureReady(decl)`, then
  `generateText({ model: createOllamaModel(decl), prompt })` from `ai`,
  returning `.text`. This mirrors `src/core/agent.ts`'s `runAgent` (same
  `generateText` call) and `src/crew/member-agent.ts`/`src/crew/compile.ts`'s
  `createOllamaModel(decl)` pattern — no new decl shape invented.
- **`getByIds(space, ids)`**: delegates straight to `store.getByIds(space, ids)`
  (`MemoryStore`'s real method, confirmed in `src/memory/store.ts` /
  `src/memory/types.ts`'s `RetrievalResult`).
- **`ensureJudge(model)`**: if `control.isInstalled(model)` → `{model,
  fallback:false}`. Else, per `autoPullPolicy()`:
  - `'always'` → `control.pull(model)` → `{model, fallback:false}`.
  - `'prompt'` + `process.stdin.isTTY` → Node `readline` `y/N` prompt; yes →
    pull + `{model, fallback:false}`; anything else falls through to the
    fallback branch below.
  - `'never'`, or `'prompt'` on a non-TTY (e.g. under `bun test`) → logs a
    one-line `console.error` fallback notice and returns `{model:
    generalModel, fallback:true}`.

Kept the real Ollama-backed `generate`/`ensureReady` calls behind this single
factory so no test imports Ollama directly; tests inject a fake
`RuntimeControl`/manager/store and exercise `ensureJudge`/`getByIds` for real
(only `generate`'s literal network path is untested — that's the seam
`makeVerifyDeps` exists to isolate).

`src/cli/verify-runtime.ts` (new, shared by both CLIs) — `makeRealVerifyDeps()`:
builds the real Model Manager, resolves the Ollama `RuntimeControl` via
`runtimeFor(ProviderKind.Ollama)`, builds the real memory store exactly like
`makeRealStore` in `src/cli/memory.ts` (same embedder/cross-encoder-reranker
wiring), and wraps it all in `makeVerifyDeps(...)` with `generalModel:
qwenRouter.model` (the project's existing router/general-model constant, used
the same way in `src/crew/compile.ts`'s hierarchical orchestrator and
`src/cli/chat.ts`). Returns `{ verifyDeps, store, manager }` so the CLI can
close the store and unload the manager's models on shutdown (mirrors
`memory.ts`'s `storeAndManager` cleanup).

### 2. CLI wiring — `src/cli/crew.ts` and `src/cli/flow.ts`

Both files gained:
- A `parseArgs`/flag-split helper that pulls `--verify` out of the positional
  argv (crew.ts and flow.ts had **no prior flag parsing at all** — `memory.ts`
  was the only precedent, so I mirrored its "positional vs. flags" split,
  simplified to a single boolean since `--verify` takes no value).
- `main()`: when `--verify` is present, calls `makeRealVerifyDeps()` once,
  threads `verifyRuntime.verifyDeps` into `runCrewCli`/`runFlow`, and in a
  `finally` closes the store + unloads the manager (only when verify was
  requested — a plain run pays zero extra cost).

**Crew path** (`CrewCliDeps.verifyDeps?: VerifyDeps`, new field):
`runCrewCli` now does `const def = deps.verifyDeps ? {...deps.def, verify:
true} : deps.def` before calling `runCrew(def, input, {..., verifyDeps})`.
This was necessary because `CrewDeps.verifyDeps` presence alone does **not**
force verification — `taskVerifies()` in `src/crew/compile.ts` is `task.verify
?? crew.verify ?? false`, and neither fixture crew (`crews/research-crew.ts`)
sets either flag. Forcing `crew.verify = true` when `verifyDeps` is supplied
is the crew-wide equivalent of the per-task opt-in, and is the only lever the
CLI has (it doesn't rewrite individual crew defs). `runCrewCli`'s pre-existing
`unverified.txt`/`result.txt`/`failed.txt` branching (from Task 8) and
`main()`'s `unverified` exit-code branch (`process.exitCode = 1`) were
**already present** before this task — I did not need to add them, only to
make sure `verifyDeps` actually reaches `runCrew` and that verification
actually activates for a real crew def.

**Workflow path** (`FlowDeps.verifyDeps?: VerifyDeps`, new field): unlike
crews, `runWorkflow` takes a **compiled** `WorkflowDef` — the verify sub-graph
must already be spliced in via `defineWorkflow(def, verifyOpts)` before
`runWorkflow` ever runs (confirmed by reading `src/workflow/engine.ts`:
`runWorkflow` has no `verifyDeps` parameter at all; expansion is a
*compile-time* step, done by `crew/compile.ts` for crews and by
`workflow/define.ts`'s `defineWorkflow` for raw workflows). So `runFlow` now:
1. `withVerifyFlags(def)` — sets `verify: true` on every `AgentStep` (workflow
   steps have no crew-def-style top-level default, and the CLI has no
   per-step opt-in surface, so "every agent step" is the equivalent
   workflow-wide default).
2. `defineWorkflow(withVerifyFlags(def), { verifyDeps })` when `verifyDeps` is
   present, else `deps.def` unchanged (byte-identical old path).
3. Runs `runWorkflow` against this compiled def.

**Correctness fix caught while wiring `flow.ts`**: `lastStepOutputText` reads
`def.steps.at(-1)`'s context value to render `result.txt`. If I ran it against
the *verify-expanded* def, the "last step" becomes a spliced-in `pass`/`abstain`
step (`{accepted:true}` or an `UnverifiedMarker`), not the actual answer text
— that would have silently corrupted `result.txt` for every verified,
successful workflow run. Fixed by having `runFlow`/`main()` always compute
`lastStepOutputText` against the **original**, pre-expansion `deps.def`/`def`:
the answer step's id is preserved unchanged by `expandVerification` (it only
appends steps after it, per `src/verification/expand.ts`), so indexing the
original def's last step id into the (possibly expanded) run's output context
still resolves to the real answer. Added a dedicated test asserting this
(`flow.test.ts`: "result.txt still resolves the ORIGINAL answer step").

### 3. `recordVerdict` wiring in `src/verification/verify.ts`

`verify()`'s `withVerificationSpan({}, ...)` callback now calls
`recordVerdict(verdict.unsupportedClaims.length)` right after
`verifyFaithfulness` resolves, before returning the verdict — this is exactly
the deferred piece Task 7's report flagged ("span called
`withVerificationSpan({})` not annotated via `recordVerdict` (wire in T10)").

I initially over-built this (also directly setting `VERIFICATION_SUPPORTED`/
`FAITHFULNESS`/`FALLBACK` attributes via `trace.getActiveSpan()` inside
`verify.ts`), then pulled back: `recordVerdict` in `src/telemetry/spans.ts`
is documented and implemented to set **only** `ATTR.VERIFICATION_UNSUPPORTED`
(mirrors `recordRerankOutcome`'s single-concern pattern), and that's exactly
what `src/verification/expand.ts`'s existing call site already does
(`recordVerdict(verdict.unsupportedClaims.length)` in `verifyStep`'s `run`).
Matching that convention exactly (rather than inventing a second, richer
annotation helper) keeps `verify.ts`'s span-closing behavior consistent with
the one other call site of `recordVerdict` in the codebase. The `supported`/
`faithfulness`/`crag`/`retries`/`fallback` attributes are set at span-*open*
time by `withVerificationSpan(info, ...)`'s `info` argument where the caller
already knows them in advance (e.g. `expand.ts`'s corrective step passes
`{crag:'incorrect'}` up front) — `verify()` itself opens the span with `{}`
because it doesn't know the verdict until after the judge runs, which is
exactly why `recordVerdict` (a post-hoc annotator) exists.

## TDD RED/GREEN evidence

**RED** — ran before any implementation:
```
bun test tests/verification/deps.test.ts tests/verification/verify.test.ts
```
Result:
- `tests/verification/deps.test.ts`: `Cannot find module
  '../../src/verification/deps.ts'` (module didn't exist yet) — all 5 tests
  errored at collection.
- `tests/verification/verify.test.ts`: 3 pre-existing tests passed; the new
  "annotates the verification.check span..." test failed with
  `Expected: false / Received: undefined` on
  `s?.attributes[ATTR.VERIFICATION_SUPPORTED]` (span existed — from the
  already-wrapped `withVerificationSpan({})` — but carried no verdict
  attributes, confirming the exact gap the brief described).
  (This was against my first, over-built version of the test; after scoping
  the fix down to match `recordVerdict`'s real single-attribute contract, I
  re-ran and reconfirmed RED against the simplified assertion before
  implementing — same failure mode: attribute `undefined` pre-fix.)

**GREEN** — after implementing `src/verification/deps.ts` and the
`recordVerdict` call in `src/verification/verify.ts`:
```
bun test tests/verification/deps.test.ts tests/verification/verify.test.ts tests/verification/spans.test.ts
# 11 pass / 0 fail / 27 expect() calls
```

CLI-level wiring tests (`tests/cli/crew.test.ts`, `tests/cli/flow.test.ts`)
were added test-first for the new `verifyDeps` field/behavior (fixtures have
no pre-existing `verify:true` anywhere, so a naive pass-through would be
inert) and went green together with the implementation in one pass since the
CLI plumbing and the tests were written in the same edit session; I
re-verified by temporarily checking that removing the `def.verify = true`
override in `crew.ts` made the new "still verifies" crew test fail (outcome
`'done'` instead of `'unverified'`), confirming the test isn't vacuous, then
restored the override.

## Full file list touched

New:
- `/Users/inderjotsingh/ai/src/verification/deps.ts`
- `/Users/inderjotsingh/ai/src/cli/verify-runtime.ts`
- `/Users/inderjotsingh/ai/tests/verification/deps.test.ts`

Modified:
- `/Users/inderjotsingh/ai/src/verification/verify.ts` (recordVerdict wiring)
- `/Users/inderjotsingh/ai/src/cli/crew.ts` (`--verify` flag, `verifyDeps`
  threading, `def.verify` override, real-deps lifecycle)
- `/Users/inderjotsingh/ai/src/cli/flow.ts` (`--verify` flag, `verifyDeps`
  threading, `withVerifyFlags` + `defineWorkflow` compile step, the
  original-def `lastStepOutputText` fix, real-deps lifecycle)
- `/Users/inderjotsingh/ai/tests/verification/verify.test.ts` (+1 test)
- `/Users/inderjotsingh/ai/tests/cli/crew.test.ts` (+2 tests)
- `/Users/inderjotsingh/ai/tests/cli/flow.test.ts` (+2 tests)

## Verification run

- `bun test tests/verification/ tests/cli/ tests/crew/ tests/workflow/ tests/telemetry/`
  → 103 pass / 0 fail / 243 expect() calls.
- `bun run typecheck` → clean.
- `bun run lint:file` on all touched files → clean (one auto-fixable import-order
  issue in `deps.ts`, fixed via `biome check --write`).
- `bun run lint` (full repo) → `Checked 174 files... No fixes applied.`
- `bun run test` (full suite) → **290 pass / 18 skip / 0 fail** (598
  expect() calls, 308 tests across 101 files).

## Deviations from the brief / judgment calls

1. **Test file location**: put the new test at `tests/verification/deps.test.ts`
   instead of the brief's literal `tests/cli/verify-deps.test.ts`, because
   `tests/verification/` already exists and exactly mirrors `src/verification/`
   (where `deps.ts` actually lives), matching the repo's established
   src↔test mirroring convention (every other `src/verification/*.ts` has its
   test under `tests/verification/`). Per the task's own instruction ("if
   existing test directory structure clearly organizes by source module
   location... put it there instead and note the deviation") — noting it here.
2. **Shared `src/cli/verify-runtime.ts`** (not explicitly named in the brief):
   factored the manager/control/store/`makeVerifyDeps` construction shared
   identically by `crew.ts` and `flow.ts` into one small file rather than
   duplicating ~25 lines in both CLIs, per the project's "small loosely-coupled
   files" code-style memory. This is additive infrastructure, not a deviation
   in behavior.
3. **`crew.verify = true` / `withVerifyFlags` (every agent step) override**:
   the brief says `--verify` should "set the crew/workflow `verify` flag" —
   since neither shipped fixture def (`crews/research-crew.ts`,
   `workflows/fetch-then-summarize.ts`) has any task/step opted in, and the
   CLI has no surface for picking *which* task/step to verify, I applied the
   flag at the broadest existing level (`CrewDef.verify` crew-wide default;
   every `AgentStep` for workflows, since there's no `WorkflowDef`-level
   default). This is the only way `--verify` has any observable effect
   end-to-end; flagging as a judgment call since the brief didn't specify
   "which tasks" when none are pre-annotated.
4. **`lastStepOutputText` original-def fix**: not explicitly requested by the
   brief, but required for correctness once workflow verify-expansion was
   wired in (see above) — without it, a successful verified flow run would
   have written `{"accepted":true}` (or worse, a raw `UnverifiedMarker` object)
   to `result.txt` instead of the real answer. Covered by a new test.
5. **`recordVerdict` scope**: kept to exactly `ATTR.VERIFICATION_UNSUPPORTED`
   (matching the existing `expand.ts` call site and `recordVerdict`'s own
   doc comment/implementation) rather than also duplicating
   supported/faithfulness/fallback attribute-setting inside `verify.ts` — see
   "Task 3" section above for the reasoning. No new telemetry ATTR constants
   or span-annotation helpers were added.

## Docs hard line

Per the task instructions, I did **not** touch `docs/architecture.md`,
`README.md`, or `docs/ROADMAP.md` — that's explicitly out of scope for this
task (handled by the slice-level docs pass). Have not yet attempted the
commit at the time of writing this report; if the pre-commit `docs:check`
hook blocks on the new `src/verification/deps.ts` / `src/cli/verify-runtime.ts`
files, that is expected and will be reported rather than bypassed, unless it
is a trivial one-line architecture.md mention gap (per the task's own
"use your judgment" carve-out).

## Concerns for the slice's final review

- **`chatDecl`'s footprint/params are a guess-but-reasonable default**
  (`temperature:0.1, numCtx:8192, approxParamsBillions:4, bytesPerWeight:0.56`
  — the same numbers as `models/qwen-router.ts`). `verify()`'s `generate` is
  called for claim decomposition, CRAG grading, and claim-checking — all
  short prompts — so 8192 ctx should be comfortable, but this wasn't
  spec'd anywhere and could warrant a dedicated `models/qwen-verify.ts` (or
  similar) declaration in a later slice if the judge model's real
  characteristics (e.g. `bespoke-minicheck`'s actual size) diverge
  meaningfully from this placeholder.
- **Workflow-wide `verify: true` blanket** (point 3 above) verifies *every*
  agent step in a `--verify` flow run, which may be more than intended for
  multi-step workflows (e.g. `fetch-then-summarize`'s `fetch` step is a Tool
  step so it's unaffected, but a workflow with multiple agent steps would get
  every one gated). No per-step CLI opt-in exists yet; this is the CLI's
  only lever until/unless a future slice adds one (e.g. `--verify-step <id>`).
- **No test exercises `makeVerifyDeps`'s real `generate` function** (by
  design — it requires live Ollama). This mirrors the same gap already
  accepted for the rest of the verification stack's Ollama-backed paths.
