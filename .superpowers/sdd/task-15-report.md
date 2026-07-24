# Task 15 report — `src/self-improve/executor.ts` `runEval` (integration keystone)

**Status: DONE.** Commit `7662d98`. Gate green: typecheck + lint (2 files) + 12/12 tests.

## Per-mode behavior as built

**Master switch.** `if (!reevalEnabled() && mode !== Artifact) return {kind:'answer', text:'reeval disabled'}`. Manual single-artifact eval still runs when disabled.

**Sweep.** `collectEntries(registryDirs)` (readManifest per dir) → `orderHotFirst` by `aggregateUsage(runsRoot)` (lastUsedMs desc, then useCount desc). Per entry, inside a per-artifact try/catch:
- `verifiedWith === undefined` → **R5 SEED inline** (`seedInline`): reevalArtifact, on evaluated `recordSeed` (baseline row `regressed:false`, upsert `verifiedWith` + `lastEvalPass`, KEEP `verifiedLevel`). Never a regression.
- else `resolved.decl.model !== verifiedWith.model` → **drifted** → enqueue per-artifact `Eval` job `{mode:Artifact, ref, reason:'sweep'}` subject to R4 de-dup.
- else skip. Returns `sweep: N enqueued, M seeded`.

**AffectedByPull.** ONE `collectEntries` pass, per-entry re-resolve; no-baseline entries skipped (seeding is the sweep's job), drifted → per-artifact enqueue with `reason = input.reason ?? 'pull'`, R4 de-dup. Never calls runSweep (no fan-out). Returns `affected-by-pull: N enqueued`.

**Artifact.** `findEntry` → NoGolden fast-exit (`skipped: no golden`, no resolve). Then a **memoized resolve** so `withEvalReevalSpan` opens with the real current model without a second resolve, then `reevalArtifact(entry, ref, {...deps, resolve})`:
- skipped(JudgeUnavailable) → inconclusive row (`belowBar:true`), no demote, answer `inconclusive: judge unavailable`.
- evaluated → seed if no baseline; else `decideRegression({baseline, fresh, hysteresis, rerunCases, rerun})` → `applyRegressionOutcome(...)`. Answer = the verdict string. `rec.golden/judge/outcome` recorded on the span.

The `rerun` closure (`buildRerun`) re-runs ONLY the given case ids `count` times each, one `evalCases([c], evalDeps)` pass per re-run, on the SAME `resolved.decl` (`deps.runCase(ref, decl, input)`) + SAME judge (`deps.judge(result.judgeModel, prompt)`), mirroring the unanimous-Yes rule.

## Finding #2 guard (stale-golden baseline)
`sameCaseIds(baselineRow.perCase, result.perCase)` compares the baseline's case-id universe to the fresh golden's. If it differs (or no baseline), the path is a **re-SEED** (record fresh baseline row, upsert verifiedWith, keep level) — never `decideRegression` — so a stale/larger baseline can't dilute `drop = confirmed/baseline.total` and mask a real regression. Test `Finding #2: divergent baseline case-set re-seeds…` proves a fresh-failing c0 against a stale {c0,c1,c2} baseline does NOT demote.

## Finding #4 guard (failed-demote visibility)
`recordSeed`'s `upsertEntry` and Artifact-mode `applyRegressionOutcome` are each wrapped so a persist throw logs a **distinct** WARN (`manifest persist failed …` / `applyRegressionOutcome persist failed`) naming the artifact — not swallowed into the generic per-artifact catch. In sweep, seed-persist failure is logged then swallowed so the sweep continues; in Artifact mode the demote failure is logged then rethrown (job fails, retryable, still visible). Test `Finding #4: a persistent persist failure is logged distinctly and sweep continues` proves both the distinct WARN and that a later drifted artifact is still enqueued.

## §7.2 isolation
Every per-artifact op in Sweep/AffectedByPull is inside try/catch → WARN + continue; a `resolve` throw / missing golden / JudgeUnavailable skips only that artifact. Manifest writes stay atomic via injected `upsertEntry`; executor is single-threaded per job so writes serialize. Test `§7.2 isolation: one artifact whose resolve throws…` proves the middle throw doesn't abort the other two.

## R4 de-dup
`hasPendingEval` pages `listJobs({status: Queued|Running})` and matches `kind===Eval && payload.ref===ref`. Keyed on ref AND pending status. Test proves a pending Queued Eval suppresses the enqueue.

## TDD RED → GREEN
- RED: `bun run test:file -- "tests/self-improve/executor.test.ts"` → `Cannot find module '../../src/self-improve/executor.ts'` (1 fail).
- GREEN: same command → `12 pass, 0 fail, 40 expect()`.
- Gate: `tsc --noEmit` clean; `biome check` clean (after `--write` format); tests green.

## Files changed
- `src/self-improve/executor.ts` (new)
- `tests/self-improve/executor.test.ts` (new, 12 tests)

## Signature drift vs brief (noted, not forced)
- **`JobStore.list` → `listJobs`.** The brief said `Pick<JobStore,'enqueue'|'list'>`; the live store exposes `listJobs({status?,cursor?,limit})→{items,nextCursor,total}`. Used the real name so Task 16 wires the real store unchanged. `hasPendingEval` pages Queued+Running.
- Baseline source = `history.latestPassing(ref)` (the brief's primary option); the "manifest commit-time result" alternative was not needed.

## Self-review / concerns
- The `withEvalReevalSpan` currentModel is now accurate (memoized resolve up front) — no double resolve, NoGolden stays cheap (exits before resolve).
- Spans are OTel no-ops in tests (no tracer registered), so span-attribute correctness isn't unit-asserted here — consistent with `action.ts`/`spans.ts` tests; Task 16 live-wiring exercises them.
- Artifact-mode `resolve` throw propagates (fails the single job) rather than degrading — deliberate: a targeted manual eval failing to resolve is honest job failure, not a silent skip. Sweep/pull degrade per §7.2.
- AffectedByPull skips no-baseline entries (can't diff drift without a baseline); the daily sweep seeds them. Intentional division of labor.
