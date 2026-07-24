# Task 16 report (Slice 32) — wire the real Eval turn end-to-end

**Status:** DONE_WITH_CONCERNS
**Commit:** 521e8f4 — feat(self-improve): wire the real Eval turn (eval.reeval run root) into the daemon + standalone server

## What was wired (the 4 sites)

### 1. `src/server/launch-turns.ts` — `createRealRunEvalTurn` unstubbed
Replaced `throw new Error('runEval not wired until Task 16')`. The factory returns a **thin closure**; ALL heavy construction happens per-run inside the closure (never at factory time), so boot only allocates a function.

Per eval run:
- Opens the run scope with **`withRunTelemetry`** (NOT `withMcpRun`): a re-eval replays the persisted golden set, and the build-time baseline it diffs against was captured by a golden eval that runs the agent **MCP-free** (D4). Replaying with MCP mounted would grade against a different tool surface; skipping `withMcpRun` also avoids the `mcp.mount` precursor root that `deriveRunKind` classifies (as `RunKind.Mcp`) *ahead* of `eval.reeval`.
- Builds `RunEvalDeps`: `registryDirs:['agents','crews','workflows']`, `runsRoot`, `history = createEvalHistoryStore({path: queuePath})`, `jobStore = createJobStore({path: queuePath})`, `upsertEntry`, `loadGolden`, plus the `ReevalDeps` seams. `queuePath = String(loadConfig().values.AGENT_QUEUE_PATH)` — the **directory** both stores join `jobs.db` onto, so the eval-history table lives in the SAME `jobs.db` the daemon's pool + trigger store use. No new DB/path.
- Root span: `Artifact` mode → `runArtifact` opens its own `eval.reeval` root (`withEvalReevalSpan`), so the turn does NOT wrap (avoids double-nesting). `Sweep`/`AffectedByPull` (enqueue-only, no span) → turn wraps `runEval` in `inSpan('eval.reeval', …)` so those runs still classify `RunKind.Eval`.
- `finally`: `history.close()`, `jobStore.close()`, `await manager.unloadAll()`.

### 2 & 3. `src/cli/daemon.ts` (`buildRealDaemon`) + `src/server/main.ts`
Both `createJobDispatch({…})` sites now pass `runEvalTurn: createRealRunEvalTurn(runsRoot)`. Confirmed via codegraph these are the ONLY two call sites (`buildRealDaemon` + `startWebServer`).

### 4. `src/run/run-trace.ts`
Added `'eval.reeval'` to **`RUN_ROOT_NAMES`** and **`TERMINAL_RUN_ROOTS`** (an eval run is a terminal root like `chat.run`, not an ephemeral precursor). `deriveRunKind` already mapped `eval.reeval → RunKind.Eval` (Task 5). Now `summarizeRun` / CLI `--follow` classify + terminate on it.

### Supporting: `src/agent-builder/deps.ts`
Exported the previously-private `toJudgeCandidate` so the eval turn builds `judgeCandidates` from the SAME construction the builders use — one judge ladder, not a divergent copy.

## Reusing the builders' resolve/runCase/judge (no divergent resolver)
ONE `createModelManager` + ONE lazily-memoized `buildRegistry`:
- **resolve(need)** → `resolveModel({role:need||'agent builder', requires:[Capability.Tools], prefer:LargestThatFits, allowUncensored: uncensoredEnabled()}, registry, {ensureReady: manager.ensureReady, listLoaded: listLoadedModels})` — the EXACT requirement `makeRealBuilderDeps` resolves against to capture `verifiedWith`, so drift detection compares like with like.
- **runCase(ref,_model,input)** → `AGENTS[ref]({})` (empty toolset = MCP-free, matches build-time golden eval) run through `runGuardedAgent(agent, input, selectHook, signal)` where `selectHook = createSelectHook({…})` — the canonical resolve+warm+degrade path the CLI/builders use. A guarded failure returns its `error` string (judge then fails the case), never throws.
- **judge(judgeModelId,prompt)** → `judgeModelFor` resolves the id to a LanguageModel via the SAME manager (degrade to `JudgeUnavailableError`, never self-grade), then `generateText({temperature:0, abortSignal: AbortSignal.timeout(dryRunMs())})` → `startsWith('yes')`. Identical to the builder gate's judge; only arg order differs.
- **judgeCandidates()** → `(engine?.registry ?? []).map(toJudgeCandidate)`.

The engine is lazily built (`ensureEngine`) on first real use, so a no-op pass (switch off / empty sweep) never calls `buildRegistry` or touches a model.

## Boot-safety reasoning (Slice-31 lesson)
- `createRealRunEvalTurn(runsRoot)` returns a closure only — no DB, registry, or manager at factory time. Both dispatch sites call it exactly like the sibling `createReal*Turn` factories (all construct lazily per-run). Boot cannot crash on it (unit test asserts construction no longer throws).
- History + queue store open the SAME `jobs.db` — verified both derive `join(config.path ?? 'jobs', 'jobs.db')` from `AGENT_QUEUE_PATH` (default dir `jobs`). WAL + busy_timeout make the extra per-run connections safe. No new required env/path.
- Typecheck + lint clean; both dispatch sites typecheck with the new dep.

## TDD RED → GREEN
RED — rewrote `tests/self-improve/eval-turn.test.ts` (construction no-throw + offline disabled-Sweep → `{kind:'answer', text:'reeval disabled'}`) and extended `tests/run/run-trace.test.ts` (eval.reeval terminal + summarizeRun eval-rooted):
```
tests/self-improve/eval-turn.test.ts  → 2 fail ("runEval not wired until Task 16")
tests/run/run-trace.test.ts           → 2 fail (durationMs 0 vs 271; eval.reeval not terminal)
```
GREEN after implementation:
```
eval-turn.test.ts 2 pass · run-trace.test.ts 17 pass · run-kind.test.ts 5 pass
regression sweep (eval-turn+executor+run-trace+run-kind+dispatch+dispatch-origin): 52 pass / 0 fail
```

## Per-task gate
- `bun run typecheck` → clean
- `bun run lint:file -- <7 files>` → clean (after biome import-order autofix)
- `bun run docs:check` → pass (pre-commit; no new subsystem)

## Files changed
`src/server/launch-turns.ts`, `src/cli/daemon.ts`, `src/server/main.ts`, `src/run/run-trace.ts`, `src/agent-builder/deps.ts`, `tests/self-improve/eval-turn.test.ts`, `tests/run/run-trace.test.ts`.

## Concerns
1. **runCase is agent-scoped.** `registryDirs` scans agents/crews/workflows for drift (per brief) but `runCase` reconstructs only agent refs (`AGENTS`). A crew/workflow whose model drifts enqueues an Artifact eval job whose `runCase` throws `unknown agent for re-eval` → a terminal Failed job (surfaced, not a crash; sweep's per-artifact try/catch contains it). Crew/workflow golden-replay is a natural live-verify follow-on — flag in case the controller wants `registryDirs` narrowed to `['agents']` for now.
2. **Composition covered by live-verify, not full unit invocation.** Like the sibling real turns, resolve/runCase/judge over live models + a drifted-artifact demote-to-Unverified can only run with Ollama. Unit test covers construction + the offline disabled path; the executor's demote + `regressed:true` behavior is covered by `executor.test.ts` with fakes. Recommend a live-verify pass (build agent → swap model → sweep → confirm demote + regressed `eval_history` row) before slice landing.
3. **runCase ignores the passed `model` decl** (`_model`) — runs on what `createSelectHook` resolves for the agent's own `modelReq` ("the model that would run today"), while `resolve` (drift) uses the builder requirement. Both are current-model resolutions; for Ollama largest-that-fits they coincide. Documented inline.
