# Slice 32 — Self-Improvement Loop (continuous re-eval on model swap)

**Status:** design · 2026-07-23 · branch `slice-32-self-improvement` (off `main`)
**Predecessor:** Slice 20 shipped the verified-build gate (`verifyAndCommit`/`runGate`, 4 stages struct→dry-run→golden→reuse, `src/verified-build/gate.ts:50`) that proves a generated agent/crew/workflow **Behaves** — but ONCE, at creation. Slice 24 shipped the durable SQLite job queue + worker pool (`JobStore`, `createWorkerPool`, `src/queue/`); Slice 25 shipped triggers (Cron/Webhook/File/JobChain, one `fire.ts` convergence, `handleJobSettled`, `src/triggers/`); Slice 25b/30b shipped the Ops console (`web/src/features/ops/`, `apiFetch(path,{schema})` hooks); Slice 31 shipped A2A interop (RunKind now carries `Mcp`/`Memory`; `src/a2a/` exists; the `Eval` JobKind precedent for "add-a-kind" is the same recipe A2A did not need but Pull/Build did).
**Unblocks:** closes the "changes that happen **to** you" gap — an agent binds a *requirement*, not a pinned model (`agents/*.ts modelReq` → `ModelRequirement`, `src/core/types.ts:42`), so a `model.pull` / provision / catalog-drift can silently swap the concrete model a "Behaves"-verified artifact resolves to, and nothing re-checks it. This slice adds the continuous re-eval loop and finally **consumes** the `chat.feedback` telemetry seam left dangling since Slice 30b (`src/telemetry/spans.ts:422` — the comment reads "Slice 31 will query these spans to close the eval loop"; Slice 31 did not, so Slice 32 does — see §8).

**Visual:** `docs/diagrams/slice-32-self-improvement/self-improvement-loop.png` (layered swimlane: detection → enqueue → re-eval → noise-band → demote → record → surface).

---

## 1. Summary

Slice 32 re-evaluates a generated artifact's **persisted golden set** whenever the model underneath it changes, catching silent behavioral regressions the one-shot creation gate cannot. Three mechanisms, driven by a new `Eval` JobKind:

- **Baseline (D1):** persist the *actual resolved model identity* (`verifiedWith`) onto each `ManifestEntry` at commit time, captured from `resolveModel`'s real pick. Today no model identity is stored on an eval (`ManifestEntry`, `src/verified-build/types.ts:73` — `need/signature/vector/verifiedLevel/goldenPath/…/lastEvalPass`, **no model id**), so a swap is undetectable from disk. This is the prerequisite the whole loop stands on.
- **Detection (D2, BOTH):** (a) a **Cron-triggered sweep** re-resolves every generated artifact's requirement, diffs the freshly-resolved model against its `verifiedWith`, and enqueues an `Eval` job for each drifted artifact; (b) a **JobChain observer** on `model.pull` / `agent.model.provision` terminal completion enqueues an `Eval` job that re-resolves + diffs the affected artifacts. Both ride the **existing** trigger substrate — no new `TriggerType`.
- **Re-eval (D3):** factor the golden-eval closure OUT of the build gate into a standalone **`src/self-improve/reeval.ts`** — `loadGolden(goldenPath)` → `evalCases(cases, deps)` bound to the newly-resolved model + a fresh `selectJudge` pick. **No regeneration** of the artifact.
- **Noise-robust decision (D4):** never demote on one run. A below-bar result triggers a **bounded re-run of the failing cases**; a regression is real only if the per-case drop **persists** and the aggregate drop **exceeds a configurable hysteresis margin**. Store **per-case** verdicts (item-level regressions hide under an aggregate pass-rate). The LLM judge is documented-flaky; this is the mitigation.
- **Action (D5, auto-demote):** a confirmed regression → (1) append to `eval_history`, (2) **auto-demote** `verifiedLevel` Behaves→Unverified so the reuse gate + UI stop trusting the artifact, (3) `recordDegrade(DegradeKind.ModelDegraded)`, (4) surface in the Ops console. **No auto-repair.**
- **Store (D6):** a new **append-only** SQLite table `eval_history` in `jobs.db` — the manifest's latest-only `lastEvalPass: boolean` is the wrong shape for history/trend.
- **Surfaces (D7):** an Ops "Evals/Health" tab (per agent×model: baseline vs current, regressions highlighted, re-eval-now button), a `bun run reeval [--all | --agent <name>]` CLI, and `eval.reeval` / `eval.regression` telemetry spans. Consumes the `chat.feedback` spans as a health signal.

## 2. Scope

**In:** re-eval-on-model-change only — the D1–D7 loop above, for generated agents / crews / workflows that carry a persisted golden sidecar (`<name>.golden.json`).

**Out (explicitly deferred — NOT debt, named per the no-deferrals rule):**
- **Standing / multi-day goals** (an agent that keeps pursuing an objective across sessions). A separate slice.
- **Cost-aware local↔cloud routing** (re-routing to a cheaper/better model on regression). This slice only *detects + demotes*; it never re-routes.
- **Auto-repair on regression** (regenerate/repair the artifact to recover Behaves). D5 stops at demote+surface; repair is operator-initiated (rebuild) or a future slice.
- **Auto-golden-from-production-failure** (mining `chat.feedback`👎 or failed runs into new golden cases). This slice *reads* `chat.feedback` as a health signal only; it does not synthesize golden cases from it.
- **A `ModelChange` trigger type.** The sweep rides Cron; the pull-hook rides JobChain. No new `TriggerType` enum member.

## 3. Decisions (D1..D7)

### D1 — Baseline: persist `verifiedWith` on `ManifestEntry` (prerequisite)

**What.** Add a new optional field `verifiedWith?: VerifiedWith` to `ManifestEntry` (`src/verified-build/types.ts:73`), captured from `resolveModel`'s **actual pick** at commit time and written by `commit` (the gate's `GateDeps.commit`, `gate.ts:25`; it already writes the entry via `upsertEntry`, `manifest.ts:47`).

**Where / how captured.** `resolveModel(req, registry, deps)` returns `{ decl: ModelDeclaration; numCtx: number }` (`src/resource/selector.ts:67`). Every field of `verifiedWith` is available from that return + the declaration (`ModelDeclaration`, `src/core/types.ts:63`):

```ts
// src/verified-build/types.ts — NEW
export type VerifiedWith = {
  runtime: RuntimeKind;      // decl.runtime
  model: string;             // decl.model  (the concrete resolved id/tag)
  paramsBillions: number;    // decl.footprint.approxParamsBillions
  numCtx: number;            // the numCtx resolveModel returned
  quant?: string;            // best-effort (see risk R2): parsed from the model tag,
                             //   undefined when not derivable — NOT AGENT_KV_CACHE_TYPE
  capturedAtMs: number;      // Date.now() at commit
};

export type ManifestEntry = {
  need: string;
  signature: CapabilitySignature;
  vector: number[];
  verifiedLevel: VerifiedLevel;
  goldenPath: string;
  createdAtMs: number;
  lastUsedMs: number;
  useCount: number;
  lastEvalPass: boolean;
  verifiedWith?: VerifiedWith; // NEW — undefined = no baseline (pre-Slice-32 entry)
};
```

**Why a NEW field, not the dead `CapabilitySignature.modelTier=''` slot.** `modelTier` is semantically the model *size-tier hint* consumed by the reuse signature (`CapabilitySignature`, `types.ts:25`; `rebuildFromArtifacts` writes `modelTier: ''`, `manifest.ts:98`). Overloading it with a concrete resolved model id would corrupt reuse's semantics. A dedicated `verifiedWith` is cleaner and keeps `modelTier` free for its intended use. (This corrects the design note's "fill the dead slot OR add a field" to the add-a-field option — verified cleaner.)

**Manifest version bump.** Bump `MANIFEST_VERSION` (`manifest.ts:8`) 1→2. `readManifest` (`manifest.ts:20`) already tolerates missing fields (it casts, never validates per-field), so a v1 entry with no `verifiedWith` reads as `undefined` = "no baseline → cannot detect drift → sweep skips or force-evals once to seed it" (§7, degrade-never-crash). `rebuildFromArtifacts` (`manifest.ts:80`) leaves `verifiedWith` undefined (a live resolve is not available offline) — consistent with how it already leaves `vector: []` / `verifiedLevel: Unverified`.

**Telemetry.** The commit already records `agent.model.select` via `recordModelSelect(ModelSelectInfo)` (`spans.ts:470`) during the gate's dry-run/eval — `ModelSelectInfo{modelId, provider, numCtx, paramsBillions, runtime, degraded}` (`spans.ts:213`) is the same identity we persist; `verifiedWith` is its durable on-disk twin.

### D2 — Detection: Cron sweep + `model.pull`/provision JobChain (BOTH)

Both paths converge on **enqueuing an `Eval` job**; the drift diff itself runs inside the `Eval` executor (D3), not at trigger time, because the trigger's static `TriggerTarget.payload` cannot know which artifacts drifted.

**(a) Cron sweep.** A repo-registered Cron trigger (`TriggerType.Cron`, `src/triggers/types.ts:3`) whose `target = { kind: JobKind.Eval, payload: { mode: EvalMode.Sweep } }` (`TriggerTarget`, `types.ts:54`). It fires through the single `fire.ts` convergence on the scheduler's poll tick (`createScheduler`, wired in `createTriggersEngine`, `src/triggers/engine.ts:131`). Cadence is config-driven (`AGENT_REEVAL_SWEEP_CRON`, §11) — never hardcoded. The `Eval` executor for `mode: Sweep`:
1. lists every generated artifact (registry dirs' `.generated.json` via `readManifest`, `manifest.ts:20`), ordered **hot-first** by `aggregateUsage(runsRoot)` (`src/verified-build/usage.ts:38` → `{lastUsedMs, useCount}` keyed by artifact name) so the most-used artifacts are re-checked first under any wall-clock bound;
2. for each entry with a `verifiedWith` baseline, re-resolves its requirement (`resolveModel`) and diffs the fresh `decl.model` against `verifiedWith.model`;
3. for each **drifted** artifact, runs the D3 re-eval (either inline within the same job, or by enqueuing one `Eval` job per drifted artifact with `mode: EvalMode.Artifact, ref: <name>` for isolation/retry granularity — the plan picks; per-artifact enqueue is preferred so one artifact's judge-unavailable failure never aborts the sweep).

**(b) Pull/provision JobChain.** A repo-registered JobChain trigger (`TriggerType.JobChain`) with `config: { onKind: JobKind.Pull, onStatus: JobStatus.Done }` (`JobChainConfig`, `types.ts:42`) and `target = { kind: JobKind.Eval, payload: { mode: EvalMode.AffectedByPull } }`. The chain observer (`createChainObserver.handleJobSettled`, `src/triggers/chain.ts:68`) already fires matching triggers on a job's terminal settle through the same `fire.ts`; it passes `vars: { 'chain.jobId', 'chain.runId' }`. The `Eval` executor for `mode: AffectedByPull` re-resolves every artifact and re-evals those whose fresh resolve now differs from `verifiedWith` (a pull can change *which* model wins `selectCandidates`, `selector.ts:24` — the pulled model may now be the largest-that-fits). Because a pull is the durable swap-event stream (`model.pull` / `agent.model.provision` persist as `RunKind.Pull` runs), this is the low-latency complement to the periodic sweep.

**No new trigger type.** `TriggerType` stays `{Cron, Webhook, File, JobChain}` (`types.ts:3`) — verified: no `ModelChange` member, and the design explicitly rides the existing two sources. The only new repo trigger *definitions* live in the trigger registry (`src/triggers/index.ts` `TRIGGERS`), synced by `syncRepoTriggers` at engine start (`engine.ts:149`).

### D3 — Re-eval engine: new `Eval` JobKind + `src/self-improve/reeval.ts`

**Add-a-kind recipe (verified against the Pull/Build precedent).** Adding `Eval` touches exactly these seams:
1. `src/queue/types.ts:23` — `enum JobKind { …, Eval = 'eval' }`.
2. `src/contracts/enums.ts:120` — `enum RunKind { …, Eval = 'eval' }` (JobKind ⊆ RunKind invariant, guarded by `tests/contracts/job-kind-parity.test.ts`).
3. `src/contracts/enums.ts:237` — `enum JobKindWire { …, Eval = 'eval' }` (JobKind == JobKindWire, same parity test).
4. `src/run/run-dto.ts` `deriveRunKind` — map the eval run's root span name (`eval.reeval`, §8) → `RunKind.Eval`, so a re-eval run classifies correctly in the runs list/waterfall.
5. `src/server/jobs/dispatch.ts` — a new `EvalJobPayloadSchema` (Zod) + a dispatch case building the `Eval` executor; add the turn dep to `JobDispatchDeps` (`dispatch.ts:43`).
6. Wire the real turn in `src/server/launch-turns.ts` and `src/cli/daemon.ts` (`DaemonCliDeps`, `daemon.ts:55`) — the same two places Pull/Build/Chat turns are wired.
7. `web/src/features/ops/` — `JobKindWire.Eval` becomes a jobs-tab facet automatically (client-side filter, `use-jobs.ts:6`).

**Payload:**
```ts
// src/server/jobs/dispatch.ts — NEW
export enum EvalMode { Sweep = 'sweep', AffectedByPull = 'affected-by-pull', Artifact = 'artifact' }
const EvalJobPayloadSchema = z.object({
  mode: z.nativeEnum(EvalMode),
  ref: z.string().min(1).optional(),   // required iff mode === Artifact (the artifact name)
  reason: z.string().optional(),       // 'sweep' | 'pull:<modelRef>' | 'manual' — provenance for eval_history/telemetry
});
```

**`src/self-improve/reeval.ts` (new module, small + loosely-coupled per code style).** Factors the gate's golden-eval closure into a standalone, generation-free primitive:

```ts
export type ReevalDeps = {
  resolve: (need: string) => Promise<{ decl: ModelDeclaration; numCtx: number }>; // resolveModel-bound
  runCase: (ref: string, model: ModelDeclaration, input: string) => Promise<string>; // artifact bound to the RESOLVED model
  judgeCandidates: () => JudgeCandidate[];   // feeds selectJudge (judge.ts:29)
  judge: (model: string, prompt: string) => Promise<boolean>; // boolean judge seam (eval.ts EvalDeps)
  loadGolden: (goldenPath: string) => GoldenSet | null;       // golden.ts:52
};

export async function reevalArtifact(entry: ManifestEntry, name: string, deps: ReevalDeps): Promise<ReevalOutcome>;
```
- Loads the persisted golden (`loadGolden(entry.goldenPath)`, `golden.ts:52`; null → skip, cannot re-eval an artifact with no sidecar — degrade, never crash).
- Re-resolves the requirement (`resolve`) → the freshly-resolved `decl`.
- Picks a **fresh judge** via `selectJudge({ candidates, generatorFamily: decl.family })` (`judge.ts:29` → `{ model, belowBar }`); a `belowBar`/null judge means the run is inconclusive (**never** a demote — §7).
- Builds `EvalDeps { runCase: (input)=>deps.runCase(ref, decl, input), judge: (p)=>deps.judge(judgePick.model, p), judgeModel: judgePick.model, belowBar }` and calls `evalCases(golden.cases, evalDeps)` (`src/verified-build/eval.ts:50`) → `EvalResult { passed, total, passedCount, perCase, judgeModel, belowBar }` (`types.ts:58`).
- **No `verifyAndCommit`, no `stage`/`structural`/`dryRun`/`makeGolden` — the artifact file is never regenerated.** Only the persisted golden is replayed against the new model.

**Correction (codegraph-verified during planning):** the `selectJudge`→`evalCases` binding is NOT in `gate.ts` — the gate only receives `goldenEval` as an injected `GateDeps.goldenEval` dep (`gate.ts:24`) and calls it. The binding is actually constructed (duplicated) in the two builders — `src/agent-builder/builder.ts` and `src/crew-builder/builder.ts` (the 5 callers of `evalCases`/`selectJudge`). So Slice 32 extracts a shared `runGoldenEval` helper into `verified-build/eval.ts` and refactors BOTH builders to use it, and `reeval.ts` reuses the same helper — **one** eval-binding path, not three that can drift (matches the "one golden set per gate pass" discipline, `gate.ts:123`). The plan (Task 6) targets the builders, not `gate.ts`.

### D4 — Regression decision: re-run + hysteresis (noise-robust)

The LLM judge is flaky (a single below-bar run is inside the noise band). The algorithm, all thresholds config-driven (§11):

```
INPUT: baseline EvalResult (from eval_history latest PASS for this artifact×prior-model, or the manifest's
        commit-time result), fresh EvalResult from reevalArtifact.
K   = AGENT_REEVAL_RERUN_CASES   (bounded re-runs of failing cases; proposed default 2)
H   = AGENT_REEVAL_HYSTERESIS    (aggregate pass-rate drop margin; proposed default 0.15)

1. Compute per-case verdicts (perCase[]). Identify REGRESSED cases:
     case c regressed  ⇔  baseline.perCase[c].passed === true  AND  fresh.perCase[c].passed === false
   (item-level — an aggregate pass-rate can stay flat while a case silently flips; per-case catches it.)
2. If no regressed cases → PASS. Record a passing eval_history row. Done (no demote).
3. Else RE-RUN only the regressed cases, K additional times each, on the SAME freshly-resolved model +
   the SAME judge pick (evalCases with runs=K over just those cases). A case is CONFIRMED-regressed only if
   it fails on EVERY re-run (unanimous fail — the mirror of evalCases' unanimous-Yes-to-pass, eval.ts:59).
   A case that recovers on any re-run is treated as noise and dropped from the regressed set.
4. Recompute the aggregate drop over CONFIRMED-regressed cases:
     drop = baseline.passedCount/baseline.total  −  (baseline.passedCount − confirmedRegressed)/baseline.total
5. REGRESSION is real  ⇔  confirmedRegressed ≥ 1  AND  drop > H.
     - real     → D5 action sequence (demote + record + degrade + surface).
     - not real → record a NON-regression eval_history row (perCase preserved) + surface as "flaky/within-noise",
                  NO demote.
6. A judge that is belowBar/unavailable at any point → INCONCLUSIVE: record an inconclusive row, NO demote,
   surface a "judge unavailable" health note (degrade, never crash — mirrors gate's JudgeUnavailableError path, judge.ts:10).
```

Rationale sources are web-validated (multi-run consensus + hysteresis + per-case tracking against judge flakiness — memory `slice-32-self-improvement-design`). The two knobs (`K`, `H`) plus the reused `AGENT_EVAL_RUNS` (unanimous-Yes per case, default 3) give three independent noise dampers.

### D5 — Action: auto-demote (no auto-repair)

On a **confirmed** regression (D4 step 5 = real), in order:
1. **Record** — append a regression row to `eval_history` (D6) with full `perCase` JSON + both model ids + judge model.
2. **Auto-demote** — flip the artifact's `verifiedLevel` `Behaves → Unverified` via a read-modify-write on the manifest (`upsertEntry(dir, name, { ...entry, verifiedLevel: VerifiedLevel.Unverified, lastEvalPass: false })`, `manifest.ts:47`; atomic via `atomicWrite`). The reuse gate (`reuseDecision`, `reuse.ts` — cosine + level-aware) and the web `VerifiedLevel` badge (contracts mirror `enums.ts:134`) then stop presenting the artifact as trusted. Demotion is **idempotent** (already-Unverified → no-op write).
3. **Degrade ledger** — `recordDegrade({ kind: DegradeKind.ModelDegraded, subject: <artifact>, reason: 'golden re-eval regression on model swap', from: verifiedWith.model, to: fresh.model })` (`spans.ts:536`; `DegradeKind.ModelDegraded`, `reliability/ledger.ts:2`). NOTE the ledger is in-run/in-memory today; the eval run's `recordDegrade` writes to that run's `degradation.jsonl` (the standard run-artifact path `readDegrades` reads, `run-dto.ts:154`), so the demotion shows on the eval run's own detail view.
4. **Surface** — the Ops "Evals/Health" tab reads `eval_history` (D7) and highlights the regression; the `eval.regression` span (§8) is emitted.

**No auto-repair, no re-route, no re-generation.** Recovery is an operator action (rebuild the artifact, which re-runs the full gate and re-seeds `verifiedWith` at the new model).

### D6 — Store: append-only `eval_history` in `jobs.db`

The manifest's `lastEvalPass: boolean` is latest-only — wrong for history/trend. New append-only table (SQLite via `bun:sqlite`, mirroring the `createSessionStore` shape, `src/session/store.ts:111`: WAL/`busy_timeout`/`foreign_keys` pragma trio + `migrate(db, MIGRATIONS)` from `src/db/migrate.ts`, snake_case columns ↔ camelCase rows):

```sql
CREATE TABLE IF NOT EXISTS eval_history (
  id           TEXT PRIMARY KEY,           -- ulid/uuid
  artifact_id  TEXT NOT NULL,              -- ManifestEntry key (artifact name)
  model        TEXT NOT NULL,              -- freshly-resolved model id evaluated against
  baseline_model TEXT,                     -- verifiedWith.model at the time (null if no baseline)
  ts           INTEGER NOT NULL,           -- epoch-ms
  passed       INTEGER NOT NULL,           -- 1/0 aggregate pass
  passed_count INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  regressed    INTEGER NOT NULL,           -- 1/0 confirmed regression (D4 step 5)
  per_case     TEXT NOT NULL,              -- JSON EvalCaseResult[]
  judge_model  TEXT NOT NULL,
  below_bar    INTEGER NOT NULL,           -- 1/0 judge below bar / inconclusive
  reason       TEXT                        -- 'sweep' | 'pull:<ref>' | 'manual'
);
CREATE INDEX IF NOT EXISTS idx_eval_history_artifact_ts ON eval_history (artifact_id, ts DESC);
```

**Row type:**
```ts
export type EvalHistoryRow = {
  id: string; artifactId: string; model: string; baselineModel?: string;
  ts: number; passed: boolean; passedCount: number; total: number;
  regressed: boolean; perCase: EvalCaseResult[]; judgeModel: string; belowBar: boolean; reason?: string;
};
```

**Location — RESOLVED (see R3).** Table lives in `jobs.db` (`<AGENT_QUEUE_PATH>/jobs.db`, default dir `jobs`, `config/schema.ts:174`), sharing the DB the queue + triggers already use. **It MUST follow the established `JOBS_DB_MIGRATIONS` superset pattern, NOT open `jobs.db` with an independent migration list.** Verified via codegraph: `migrate(db, migrations)` (`src/db/migrate.ts:6`) tracks progress with a **single `PRAGMA user_version` per DATABASE**, not a per-migration-name bookkeeping table — so two independent lists over one file collide silently (the later opener reads a `user_version` already ≥ its own list length and creates NO tables). This is exactly why `JOBS_DB_MIGRATIONS = [...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS]` exists (`src/triggers/migrations.ts:85`, with a long explanatory comment): every store opening `jobs.db` runs the authoritative ordered **superset**, so `migrate` only ever applies the not-yet-applied tail regardless of open order. Slice 32 extends it: `EVAL_HISTORY_MIGRATIONS` appended → the combined list becomes `[...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS, ...EVAL_HISTORY_MIGRATIONS]`, and `src/self-improve/history.ts createEvalHistoryStore` opens `jobs.db` running that full superset (JOB_MIGRATIONS stays the authoritative strict prefix; `createJobStore` is unchanged). **Append + read only** (insert, `listByArtifact`, `latestPassing`); no update/delete surface. No dedicated `evals.db` needed — sharing is safe via this proven pattern.

### D7 — Surfaces: Ops "Evals/Health" tab + `reeval` CLI + spans

- **API (server-side, backing the tab):** `GET /api/evals` (per-artifact latest + baseline vs current, regressions flagged, from `eval_history` joined with the manifest's `verifiedWith`); `GET /api/evals/:artifact` (full history for the trend view); `POST /api/evals/reeval` (enqueue an `Eval` job — `{ mode: 'artifact', ref }` or `{ mode: 'all' }` — the "re-eval now" button). Mutating routes sit behind `requireTrustedLocal` (the Slice-24/25b privileged-config posture reused by A2A).
- **Console (primary):** new `web/src/features/ops/evals-tab.tsx` + `use-evals.ts` hook (plain `apiFetch(path,{schema})`, no query lib — matches `use-jobs.ts:22`), registered in the Ops tab bar beside Overview / Jobs / Triggers / Devices / Federation; `data-testid="ops-evals"`. Per agent×model: baseline `verifiedWith` vs current result, per-case grid with regressed cells highlighted, a re-eval-now button, and a small trend from `eval_history`. Surfaces `chat.feedback`👎 counts per artifact as a secondary health signal (read from `chat.feedback` spans; see §8).
- **CLI (thin):** `bun run reeval [--all | --agent <name>]` → `src/cli/reeval.ts` enqueues the `Eval` job(s) through the same `JobStore.enqueue` path (injected-deps shape mirroring the daemon CLI). Add the `reeval` script to `package.json`.

## 4. Backend-delta table

| Capability | Reachable today? | Module / seam to ADD or CHANGE | Notes |
|---|---|---|---|
| Baseline model identity on eval | ✗ (`ManifestEntry` has no model id) | `VerifiedWith` type + field (`verified-build/types.ts`); captured in gate `commit` | D1; MANIFEST_VERSION 1→2 |
| `Eval` JobKind | ✗ | `JobKind.Eval` (`queue/types.ts`) + `RunKind.Eval` + `JobKindWire.Eval` (`contracts/enums.ts`) + parity test | D3 add-a-kind |
| Re-eval primitive (no regen) | ✗ (eval is generation-coupled in the gate) | `src/self-improve/reeval.ts` (`reevalArtifact`) + extract `evalCases`-binding out of `gate.ts` | D3 |
| Eval dispatch | ✗ | `EvalJobPayloadSchema` + dispatch case (`server/jobs/dispatch.ts`); turn wired in `launch-turns.ts` + `cli/daemon.ts` | D3 |
| Cron sweep trigger | reuse | repo Cron trigger def → `{kind: JobKind.Eval, payload:{mode:sweep}}` (`triggers/index.ts`) | D2a; no new TriggerType |
| Pull/provision hook | reuse | repo JobChain trigger def `{onKind: Pull, onStatus: Done}` → Eval (`triggers/index.ts`); rides `handleJobSettled` (`chain.ts:68`) | D2b |
| Drift diff | ✗ | inside the `Eval` executor: `resolveModel` fresh vs `verifiedWith.model` | D2/D3 |
| Noise-band decision | ✗ | `src/self-improve/regression.ts` (D4 algorithm; per-case + re-run + hysteresis) | D4 |
| Auto-demote | reuse | `upsertEntry` verifiedLevel Behaves→Unverified (`manifest.ts:47`) | D5 |
| Degrade record | reuse | `recordDegrade(DegradeKind.ModelDegraded)` (`spans.ts:536`) | D5 |
| `eval_history` store | ✗ | `src/self-improve/history.ts` `createEvalHistoryStore` (SQLite in jobs.db) | D6 |
| Evals API | ✗ | `GET /api/evals`, `GET /api/evals/:artifact`, `POST /api/evals/reeval` (trusted-local on mutate) | D7 |
| Evals/Health tab | ✗ | `web/src/features/ops/evals-tab.tsx` + `use-evals.ts` | D7 |
| `chat.feedback` consumption | ✗ (seam exists, no consumer, `spans.ts:422`) | read 👎 counts per artifact into the health tab | D7/§8 |
| CLI | ✗ | `src/cli/reeval.ts` + `reeval` script | D7 |
| Telemetry spans | ✗ | `eval.reeval`, `eval.regression` + `ATTR` keys (`spans.ts`) | §8 |

## 5. Increment breakdown (SUGGESTION — the plan skill finalizes)

1. **D1 baseline** — `VerifiedWith` type + `ManifestEntry` field + capture in gate `commit` + MANIFEST_VERSION bump + read tolerance test.
2. **D3 kind + engine** — `JobKind.Eval`/`RunKind.Eval`/`JobKindWire.Eval` + parity test + `deriveRunKind` mapping; extract `evalCases`-binding out of `gate.ts`; `src/self-improve/reeval.ts`; `EvalJobPayloadSchema` + dispatch case + turn wiring.
3. **D6 store** — `src/self-improve/history.ts` (`eval_history` migration + insert/list/latestPassing).
4. **D4 decision** — `src/self-improve/regression.ts` (per-case diff + bounded re-run + hysteresis); unit-tested in isolation.
5. **D5 action** — wire reeval→regression→demote+recordDegrade+history into the `Eval` executor.
6. **D2 detection** — repo Cron sweep trigger + JobChain pull/provision trigger defs; the executor's `mode` branches (sweep hot-first, affected-by-pull, single-artifact).
7. **D7 surfaces** — evals API routes; `evals-tab.tsx` + `use-evals.ts`; `chat.feedback` health read; `src/cli/reeval.ts` + `reeval` script; `eval.*` spans.
8. **Docs (4 surfaces) + SDD ledger + live-verify + land** (§8/§9/§10).

## 6. Web IA wiring (exact touch-points)

- `web/src/features/ops/` — new `evals-tab.tsx` (per-artifact baseline-vs-current, per-case grid, re-eval-now, trend), `use-evals.ts` (`apiFetch('/evals',{schema})` + `apiFetch('/evals/:artifact',{schema})`), and a `useReeval()` action hook posting to `/api/evals/reeval` (optimistic, mirroring `use-job-actions`). `data-testid="ops-evals"`.
- Register the tab in the Ops console tab bar beside Overview/Jobs/Triggers/Devices/Federation.
- A re-eval run is watchable in the **existing Runs waterfall** (`RunKind.Eval` classified via `deriveRunKind`) — no new viewer.
- New isomorphic contracts in `src/contracts/` (an `EvalHistoryDTO` / `EvalHealthDTO` + Zod schema) consumed by `apiFetch(path,{schema})`; the device session Bearer is automatic. `JobKindWire.Eval` becomes a jobs-tab facet automatically.

## 7. Hard parts (adversarial / ultracode / Fable verification)

- **7.1 Noise-band correctness (D4).** The per-case regression predicate, the bounded unanimous-fail re-run, and the hysteresis comparison must be exhaustively unit-tested against synthetic judge-flakiness: a case that flips-then-recovers must NOT demote; a case that stays failed across all K re-runs AND clears the hysteresis margin MUST demote; an aggregate-flat-but-one-case-flipped set must be caught by the per-case predicate. A `belowBar`/unavailable judge at any step is INCONCLUSIVE (never a demote). No path may demote on a single below-bar run.
- **7.2 Sweep must degrade-never-crash and never corrupt the manifest.** One artifact's `resolveModel` throw (`ResourceError`/`ProviderError`), missing golden sidecar, or `JudgeUnavailableError` must be caught per-artifact and skip that artifact — never abort the whole sweep, never leave a half-written manifest. All manifest writes are atomic (`atomicWrite`, `manifest.ts:43`) read-modify-write; a demote of A must not race a commit of B (the manifest is per-registry-dir; serialize writes within the `Eval` executor).
- **7.3 Baseline provenance for the diff.** The "baseline" for D4 is the last **passing** `eval_history` row for the artifact at its `verifiedWith` model (or, absent any history, the manifest's commit-time `verifiedWith` + `lastEvalPass`). A pre-Slice-32 entry with no `verifiedWith` cannot be drift-diffed — the sweep force-seeds it (one eval at the current model, recorded as baseline, NOT a regression) rather than skipping forever.
- **7.4 Append-only integrity + concurrency.** `eval_history` is insert-only; no code path updates/deletes rows. If it shares `jobs.db` with the queue, the two `bun:sqlite` handles must both use WAL (they do — the pragma trio) and the two migration lists must not collide (R3). A re-eval job and a normal chat job running concurrently must not lock each other out (WAL + `busy_timeout=5000` is the established mitigation).
- **7.5 Detection duplication / storms.** The Cron sweep and a pull JobChain can both enqueue an `Eval` for the same artifact within seconds of a pull. De-dup at enqueue (skip if an `Eval` job for the same `ref` is already Queued/Running) or make re-eval idempotent (a second identical eval just appends another history row — acceptable but wasteful). A mass pull (many models) must not fan out to N× full sweeps — coalesce `AffectedByPull` to a single re-resolve pass.

## 8. Standing notes (per the CLAUDE.md hard line)

**Architecture-doc update (`docs/architecture.md`).** Add a new subsystem section **"§ `src/self-improve/` — continuous re-eval loop"** (baseline capture → detection (Cron sweep + pull JobChain) → `reeval.ts` → `regression.ts` noise band → demote + `eval_history` → Ops surface; the data-flow lane matching the diagram). Update **§ verified-build** to document `ManifestEntry.verifiedWith` + the extracted `evalCases`-binding shared with `reeval.ts`. Update **§24/§ queue** for the new `Eval` JobKind + dispatch case + `deriveRunKind` mapping. Update **§25/§ triggers** to note the repo Cron sweep + pull JobChain trigger defs (no new `TriggerType`). Update **§ telemetry** for the new `eval.*` spans + `chat.feedback` now having a consumer. Update the **Ops Console** section for the new Evals/Health tab, and the **module map / doc-map / README pointer** if a living doc is added. Regenerate the interactive architecture-snapshot **Artifact** (new `self-improve` node + edges to verified-build/Queue/Triggers/Telemetry/Ops-console; updated footer slice count "32" + real test count). `bun run docs:check` + the pre-push slice-landing gate hard-fail until `README.md`, `docs/ROADMAP.md`, and `.superpowers/sdd/progress.md` are all updated in the same push.

**Telemetry to emit.** New spans via the existing `inSpan`/`ATTR` conventions (`src/telemetry/spans.ts` — no parallel emission path, no-op without a tracer; nest under the eval run's root):
- **`eval.reeval`** (root span for one re-eval run; `deriveRunKind` → `RunKind.Eval`): attrs `EVAL_ARTIFACT`, `EVAL_MODE` (sweep/affected-by-pull/artifact), `EVAL_BASELINE_MODEL`, `EVAL_CURRENT_MODEL`, `MODEL_ID`/`MODEL_PARAMS_B` (reuse existing keys, `spans.ts:22,24`), `VERIFY_JUDGE_MODEL`/`VERIFY_JUDGE_BELOW_BAR` (reuse `spans.ts:101,102`), `VERIFY_GOLDEN_PASSED`/`VERIFY_GOLDEN_TOTAL` (reuse `spans.ts:103,104`), `EVAL_OUTCOME` (pass/regression/inconclusive).
- **`eval.regression`** (event or child span on a confirmed regression): attrs `EVAL_ARTIFACT`, `EVAL_REGRESSED_COUNT`, `EVAL_DROP` (aggregate drop), `RELIABILITY_DEGRADE_FROM`/`RELIABILITY_DEGRADE_TO` (reuse, the from/to model), plus the standard `reliability.degrade` event via `recordDegrade`.
- New `ATTR` keys to add to the `ATTR` map (`spans.ts:16`): `EVAL_ARTIFACT: 'eval.artifact'`, `EVAL_MODE: 'eval.mode'`, `EVAL_BASELINE_MODEL: 'eval.baseline_model'`, `EVAL_CURRENT_MODEL: 'eval.current_model'`, `EVAL_OUTCOME: 'eval.outcome'`, `EVAL_REGRESSED_COUNT: 'eval.regressed_count'`, `EVAL_DROP: 'eval.drop'`.
- **`chat.feedback` consumption:** the Evals/Health tab (and optionally the regression prioritization) reads the existing `chat.feedback` spans (`FEEDBACK_MESSAGE_ID`/`FEEDBACK_RATING`, `spans.ts:175,176`; emitted by `recordChatFeedback`, `spans.ts:425`) as a per-artifact 👎-rate health signal. This finally gives the seam a consumer — update the stale comments at `spans.ts:422` ("Slice 31 will query these spans") and `contracts/enums.ts:69` / `spans.ts:174` ("Slice 31 consumes it") to say **Slice 32**. **No secret/PII values** in any eval span (no golden case text beyond ids, no raw model output).

## 9. Testing strategy

- **Unit — noise band (D4, `regression.ts`).** per-case regression predicate; flip-then-recover = noise (no demote); unanimous-fail-across-K + drop>H = regression; aggregate-flat-but-case-flipped caught; belowBar = inconclusive (no demote); hysteresis boundary (drop == H is NOT a regression; drop just over H is).
- **Unit — baseline capture (D1).** `commit` writes `verifiedWith` from a fake `resolveModel` pick; `readManifest` of a v1 entry (no `verifiedWith`) yields undefined without throwing; `rebuildFromArtifacts` leaves it undefined.
- **Unit — JobKind parity (D3).** extend `tests/contracts/job-kind-parity.test.ts` for `Eval` (JobKind ⊆ RunKind; JobKind == JobKindWire); `deriveRunKind('eval.reeval') === RunKind.Eval`.
- **Unit — `reeval.ts` (mock model+judge).** loads golden, re-resolves, binds `evalCases` to the resolved model + fresh judge, returns `EvalResult`; missing golden → skip; judge belowBar → inconclusive; never calls `stage`/`makeGolden` (no regen).
- **Unit — `eval_history` store (D6).** insert + `listByArtifact` (ts DESC) + `latestPassing`; append-only (no update/delete method exists); malformed/absent DB tolerated.
- **Integration — detect→enqueue→demote.** a fake registry with one Behaves artifact whose `resolveModel` now returns a different model + a golden the new model fails on all re-runs → the `Eval` executor demotes it Behaves→Unverified, appends a regression row, records a `ModelDegraded` degrade, emits `eval.regression`. The Cron trigger def enqueues an `Eval` job on tick; the pull JobChain enqueues on a Pull job's Done settle (drive with fake time + `handleJobSettled`).
- **Integration — degrade-never-crash (§7.2).** a sweep over N artifacts where one throws in `resolveModel` / has no golden / hits `JudgeUnavailableError` → the other N-1 still evaluate; the manifest is never half-written.
- **Live-verify.** §10.

## 10. Live-verify gate (mandatory before merge — per the standing rule)

Real model swap → real regression demotion on this box (Mac Mini M4 Pro, real Ollama; no second machine needed — this is single-box):
1. **Seed** — build a small agent through the real gate at model A (a smaller local model) so it commits **Behaves** with a persisted golden + `verifiedWith.model = A`.
2. **Swap** — pull/select a different model B such that the agent's requirement now resolves to B (verify via the drift diff / `agent.model.select` span that the resolved model actually changed A→B), where B genuinely underperforms on the golden.
3. **Sweep** — trigger the Cron sweep (or `bun run reeval --agent <name>`) → observe: `Eval` run in the Runs waterfall (classified `RunKind.Eval`), per-case verdicts, bounded re-runs of the failing cases, and — if the drop clears the hysteresis margin — an auto-demote to Unverified visible in the Evals/Health tab + a `ModelDegraded` degrade on the eval run.
4. **Pull hook** — run a `model.pull`; confirm the JobChain fires an `Eval` job on the pull job's Done settle and re-evals the affected artifact.
5. **No-op path** — a swap to an equally-good model (no per-case regression) records a passing/within-noise row and does NOT demote.
6. **Recovery** — rebuild the artifact (full gate) → `verifiedLevel` back to Behaves, `verifiedWith` re-seeded at the new model.
   Throughout: `eval.*` spans present and secret-free; `eval_history` rows append-only; the manifest never left half-written.

## 11. New deps & env knobs

**Deps:** none — all substrate (SQLite via `bun:sqlite`, triggers, queue, gate, telemetry) already exists.

**Env (all via `src/config/schema.ts` `CONFIG_SPEC`, `AGENT_*`, defaults computed/conventional — never hardcoded; all marked **PROPOSED**, human to confirm):**
| Env | kind | proposed default | doc |
|---|---|---|---|
| `AGENT_REEVAL_ENABLED` | boolean | `true` | Master switch for the self-improvement loop (sweep + pull hook + auto-demote). `0` disables all detection + demotion; the CLI/`POST /api/evals/reeval` still work manually. |
| `AGENT_REEVAL_SWEEP_CRON` | string | `0 4 * * *` (daily 04:00 local) | Cron schedule for the periodic drift sweep (the repo Cron trigger's `config.schedule`). Low-traffic hour by default. |
| `AGENT_REEVAL_HYSTERESIS` | number | `0.15` | Aggregate pass-rate drop margin a confirmed regression must exceed before auto-demote (D4). Guards against judge noise. |
| `AGENT_REEVAL_RERUN_CASES` | number | `2` | Bounded extra re-runs of each failing case; a case is confirmed-regressed only on unanimous fail across all re-runs (D4). |

**Reused knobs (no change):** `AGENT_EVAL_RUNS` (3, unanimous-Yes per case, `schema.ts:256`), `AGENT_JUDGE_MIN_PARAMS` (24e9, `schema.ts:244`), `AGENT_QUEUE_PATH` (`jobs`, jobs.db dir — where `eval_history` lives, `schema.ts:174`), `AGENT_RUNS_ROOT` (`runs`, for `aggregateUsage` hot-first ordering, `schema.ts:336`).

---

## Open questions / risks (flag for human review)

- **R1 — `verifiedWith` field vs `modelTier` slot (D1).** The design allowed either. This spec chose a **new `verifiedWith` field** (not overloading `CapabilitySignature.modelTier`) because `modelTier` is the reuse signature's size-tier hint and overloading it corrupts reuse semantics. Confirm this is acceptable (it adds a manifest field + version bump rather than reusing a dead-ish slot).
- **R2 — `quant` is not first-class anywhere.** `ModelDeclaration` (`core/types.ts:63`) and `ModelSelectInfo` (`spans.ts:213`) carry runtime/model/params/numCtx but **no weight-quant field** (`AGENT_KV_CACHE_TYPE` is KV-cache quant, a different thing). `verifiedWith.quant` is therefore **best-effort** (parsed from the model tag when present, else undefined). A quant-only swap (same model id, different quant of the same tag) may be invisible to the drift diff. Options: (a) accept best-effort (current spec); (b) add a real `quant` to `ModelDeclaration` (larger blast radius — 95 callers). Recommend (a) for this slice, flag (b) as future.
- **R3 — RESOLVED (controller, codegraph-verified).** `migrate()` (`src/db/migrate.ts:6`) tracks progress with a **single `PRAGMA user_version` per DB** (NOT per-migration-name), so independent lists over one file collide silently. The codebase already solved this for `jobs.db` via the `JOBS_DB_MIGRATIONS` superset (`src/triggers/migrations.ts:85`). Resolution: `eval_history` shares `jobs.db` by **extending that superset** (`[...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS, ...EVAL_HISTORY_MIGRATIONS]`); the eval store opens `jobs.db` running the full superset. No dedicated `evals.db`. See D6 (updated). No human decision needed — this is now a fixed implementation constraint for the plan.
- **R4 — sweep vs pull-hook duplicate enqueues (§7.5).** Need a de-dup rule (skip enqueue if an `Eval` for the same `ref` is already Queued/Running) or accept idempotent-but-wasteful double evals. Recommend de-dup at enqueue; confirm.
- **R5 — RESOLVED (user, 2026-07-23): SEED, don't demote.** First-ever sweep of a pre-Slice-32 artifact (no `verifiedWith`, no history) force-seeds a baseline — one eval at the current model, recorded as the baseline, **never a regression**; the artifact keeps its existing `verifiedLevel`. Un-baselined artifacts are thus pulled INTO the loop on first sight (not skipped indefinitely). §7.3's "force-seed" behavior is the confirmed spec.
- **R6 — Ops tab-bar registration file.** The exact tab-bar shell file in `web/src/features/ops/` was not pinned in this pass (Slice 31 added a Federation tab there); the plan should confirm the precise registration point and mirror the Federation/Jobs tab wiring.
