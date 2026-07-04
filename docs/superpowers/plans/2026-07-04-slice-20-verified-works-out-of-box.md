# Verified "works out of the box" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-07-04-slice-20-verified-works-out-of-box-design.md`.

**Goal:** Turn agent/crew/workflow generation into a stage→verify→commit gate — reuse-check before generating, then structural + bounded dry-run(+repair) + behavioral golden-eval — so nothing broken lands in the registry; plus usage-telemetry-driven archive of stale near-duplicates.

**Architecture:** New `src/verified-build/` subsystem with a single `gate.verifyAndCommit` entry both builders call. A per-registry `.generated.json` manifest sidecar persists the original need + capability-signature vector + verified level + usage. Cheapest-first pipeline; degrades (never blocks) when no capable judge model is installed.

**Tech Stack:** TypeScript (bun), AI SDK v6, Zod, Ollama (local models), existing Slice-12 embedder/LanceDB, Slice-13 `checkClaim` judge, Slice-8 OTel spans.

## Global Constraints (verbatim from spec + repo rules)

- `bun`, not npm. Imports use explicit `.ts` extensions. `type` over `interface`; **`enum` for finite named sets** (string enums only).
- **No hardcoded models/budgets/limits** — compute live; env vars are fallback-only (`config.ts`).
- **Zero new npm deps.** Reuse existing subsystems.
- Atomic writes (tmp + rename); assert index markers before writing; never mutate `STARTER_PACK`.
- Gate returns discriminated results — **never throws** for a verification failure.
- Telemetry preserves `gen_ai.*` conventions; every new attr keyed in `ATTR` (`src/telemetry/spans.ts`).
- Docs hard line: all 4 surfaces + ledger updated in-slice.
- Implementers: run FOCUSED tests + `bun run typecheck` + `bun run lint:file` inline, then commit. Controller runs full `bun test` between task groups.

---

## Phase 0 — Foundations (T1–T4 independent, dispatch in parallel)

### Task 1: Shared types + config
**Files:** Create `src/verified-build/types.ts`, `src/verified-build/config.ts`; Test `tests/verified-build/config.test.ts`

**Produces:**
```ts
// types.ts
export enum VerifiedLevel { Behaves = 'behaves', Runs = 'runs', Unverified = 'unverified' }
export enum ReuseKind { Reuse = 'reuse', Offer = 'offer', Generate = 'generate' }
export enum GoldenKind { TaskSuccess = 'task-success', Grounded = 'grounded', Routing = 'routing' }
export enum ArtifactKind { Agent = 'agent', Crew = 'crew', Workflow = 'workflow' }
export type CapabilitySignature = { purpose: string; tools: string[]; modelTier: string; io: string; roles: string[] };
export type GoldenCase = { id: string; input: string; assert: string; kind: GoldenKind };
export type GoldenSet = { need: string; cases: GoldenCase[] };
export type DryRunResult = { ran: boolean; output?: string; error?: string; repairs: number };
export type EvalCaseResult = { id: string; passed: boolean; detail: string };
export type EvalResult = { passed: boolean; total: number; passedCount: number; perCase: EvalCaseResult[]; judgeModel: string; belowBar: boolean };
export type ReuseDecision = { kind: ReuseKind; match?: string; similarity: number };
export type ManifestEntry = { need: string; signature: CapabilitySignature; vector: number[]; verifiedLevel: VerifiedLevel; goldenPath: string; createdAtMs: number; lastUsedMs: number; useCount: number; lastEvalPass: boolean };
export type Manifest = { version: number; entries: Record<string, ManifestEntry> };
export type VerificationResult =
  | { kind: 'committed'; name: string; level: VerifiedLevel; dryRun: DryRunResult; eval?: EvalResult }
  | { kind: 'reused'; name: string; similarity: number }
  | { kind: 'failed'; stage: 'structural' | 'dry-run' | 'golden-eval'; detail: string };
```
```ts
// config.ts — live-computed, env-overridable (NO hardcodes as primary)
export function dryRunMs(): number      // env AGENT_DRY_RUN_MS ?? computed (default 45_000)
export function maxRepairs(): number    // env AGENT_BUILD_MAX_REPAIRS ?? 2  (research cap 2–3)
export function reuseBands(): { reuse: number; offer: number } // env AGENT_REUSE_* ?? {0.85,0.75}
export function judgeMinParams(): number // env AGENT_JUDGE_MIN_PARAMS ?? 24e9 (~24B behavioral bar)
export function archiveIdleDays(): number // env AGENT_ARCHIVE_IDLE_DAYS ?? 30
export function evalRuns(): number       // env AGENT_EVAL_RUNS ?? 3 (unanimous)
```

- [ ] Step 1 — Write `tests/verified-build/config.test.ts`: assert defaults (`maxRepairs()===2`, `reuseBands().reuse===0.85`), and that env overrides win (`process.env.AGENT_REUSE_REUSE='0.9'` → `0.9`).
- [ ] Step 2 — Run `bun test tests/verified-build/config.test.ts` → FAIL.
- [ ] Step 3 — Implement `types.ts` + `config.ts` (each getter: `Number(process.env.X) || default`; guard NaN).
- [ ] Step 4 — Run test → PASS; `bun run typecheck`; `bun run lint:file -- src/verified-build/*.ts`.
- [ ] Step 5 — Commit `feat(verified-build): shared types + live config thresholds`.

### Task 2: Embedding convenience (`embedOne` + export `cosine`)
**Files:** Modify `src/memory/chunk.ts` (export `cosine`); Create `src/memory/embed-one.ts`; Test `tests/memory/embed-one.test.ts`

**Consumes:** existing `makeEmbedder(deps).embed(texts)`, private `cosine(a,b)` in `chunk.ts:13`.
**Produces:**
```ts
export { cosine } from './chunk.ts';                // re-export or `export function cosine` in chunk.ts
export async function embedOne(text: string, embed: (t: string[]) => Promise<number[][]>): Promise<number[]>
```
- [ ] Step 1 — Test: with a fake `embed` returning `[[1,0,0]]`, `embedOne('x', fake)` resolves `[1,0,0]`; `cosine([1,0],[1,0])===1`, `cosine([1,0],[0,1])===0`.
- [ ] Step 2 — Run → FAIL.
- [ ] Step 3 — Change `cosine` in `chunk.ts` to `export function cosine`; add `embed-one.ts` (`return (await embed([text]))[0]`).
- [ ] Step 4 — Test PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(memory): export cosine + embedOne convenience`.

### Task 3: Wall-clock abort through `runAgent`
**Files:** Modify `src/core/agent.ts` (`RunAgentInput` + `generateText` call); Test `tests/core/agent-abort.test.ts`

**Produces:** `RunAgentInput` gains `abortSignal?: AbortSignal`, passed to `generateText({ ..., abortSignal })`.
- [ ] Step 1 — Test: an already-aborted signal (`AbortSignal.abort()`) passed to a `runAgent` call whose model is a fake that checks `opts.abortSignal?.aborted` → the fake throws/aborts; assert `runAgent` rejects. (Keep hermetic — fake `LanguageModel` that inspects the passed signal.)
- [ ] Step 2 — Run → FAIL (field not plumbed).
- [ ] Step 3 — Add optional `abortSignal` to `RunAgentInput`; forward into `generateText`.
- [ ] Step 4 — Test PASS; typecheck; lint. Confirm existing `agent.test.ts` still green.
- [ ] Step 5 — Commit `feat(core): thread abortSignal through runAgent`.

### Task 4: Telemetry — build.verify + build.archive spans
**Files:** Modify `src/telemetry/spans.ts` (ATTR keys + two `withXSpan` helpers); Test `tests/telemetry/build-verify-span.test.ts`

**Produces:**
```ts
// ATTR additions:
VERIFY_REUSE_DECISION='verify.reuse.decision', VERIFY_REUSE_SIMILARITY='verify.reuse.similarity',
VERIFY_DRYRUN_RAN='verify.dry_run.ran', VERIFY_DRYRUN_REPAIRS='verify.dry_run.repairs',
VERIFY_JUDGE_MODEL='verify.judge.model', VERIFY_JUDGE_BELOW_BAR='verify.judge.below_bar',
VERIFY_GOLDEN_PASSED='verify.golden.passed', VERIFY_GOLDEN_TOTAL='verify.golden.total',
VERIFY_LEVEL='verify.level', ARCHIVE_CANDIDATES='archive.candidates', ARCHIVE_PRUNED='archive.pruned'
// span 'build.verify' (child of active build span):
export function withBuildVerifySpan<T>(kind: ArtifactKind, fn: (rec: {
  event(name: string, attrs?: Record<string, unknown>): void;
  result(level: VerifiedLevel, attrs?: Record<string, unknown>): void;
}) => Promise<T>): Promise<T>
// span 'build.archive':
export function withBuildArchiveSpan<T>(fn: (rec: { done(candidates: number, pruned: number): void }) => Promise<T>): Promise<T>
```
Mirror existing `withCrewBuildSpan` (spans.ts:508) exactly.
- [ ] Step 1 — Test: run `withBuildVerifySpan(ArtifactKind.Crew, async rec => { rec.event('dry_run',{ran:true}); rec.result(VerifiedLevel.Behaves); })` under a test tracer/in-memory exporter; assert a `build.verify` span with the event + `verify.level='behaves'`. (Follow the pattern in existing span tests.)
- [ ] Step 2 — Run → FAIL.
- [ ] Step 3 — Add ATTR keys + both helpers (wrap `inSpan`).
- [ ] Step 4 — Test PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(telemetry): build.verify + build.archive spans`.

---

## Phase 1 — Reuse stack (T5–T7; T5,T6 parallel, then T7)

### Task 5: Capability signature
**Files:** Create `src/verified-build/signature.ts`; Test `tests/verified-build/signature.test.ts`
**Consumes:** `AgentProposal` (`src/agent-builder/types.ts`), `CrewIR`/`WorkflowIR` (`src/crew-builder/ir.ts`), `BuilderModel` (`.object`/`.text`), `CapabilitySignature` (T1).
**Produces:**
```ts
export function signatureFromProposal(p: AgentProposal): CapabilitySignature
export function signatureFromIR(ir: CrewIR | WorkflowIR, shape: Shape): CapabilitySignature
export async function signatureFromNeed(need: string, model: BuilderModel): Promise<CapabilitySignature> // purpose=cleaned need; tools=best-effort []
export function signatureText(s: CapabilitySignature): string  // PURPOSE-FORWARD: `${purpose}\ntools: ${tools.join(',')}\nio: ${io}\nroles: ${roles.join(',')}`
```
- [ ] Step 1 — Tests (pure fns, no model): `signatureFromProposal({name,description,systemPrompt,tools:['read_file']})` → `{purpose: description, tools:['read_file'], ...}`; `signatureText` puts purpose first line. For `signatureFromNeed`, inject a fake `BuilderModel` whose `.object` returns `{purpose:'summarize urls', tools:[]}`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement. `signatureFromNeed` uses `model.object({schema, prompt})` with a small Zod schema `{purpose, tools?}`; `modelTier`/`io`/`roles` default sensibly.
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): capability signature`.

### Task 6: Manifest sidecar
**Files:** Create `src/verified-build/manifest.ts`; Test `tests/verified-build/manifest.test.ts`
**Consumes:** `Manifest`,`ManifestEntry` (T1); `atomicWrite` (existing util).
**Produces:**
```ts
export function manifestPath(dir: string): string           // `${dir}/.generated.json`
export function readManifest(dir: string): Manifest          // {version:1,entries:{}} if absent
export function upsertEntry(dir: string, name: string, entry: ManifestEntry): void  // atomic
export function removeEntry(dir: string, name: string): void
```
- [ ] Step 1 — Tests in a tmp dir: read-absent → empty manifest; upsert then read back equal; upsert same name twice → overwrites; removeEntry drops it. File is valid JSON.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement with `atomicWrite` + `JSON.parse`/`stringify`. Tolerate malformed file (return empty + warn).
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): per-registry manifest sidecar`.

### Task 7: Reuse decision
**Files:** Create `src/verified-build/reuse.ts`; Test `tests/verified-build/reuse.test.ts`
**Consumes:** `signatureText` (T5), `embedOne`+`cosine` (T2), `readManifest` (T6), `reuseBands` (T1 config), `ReuseDecision` (T1).
**Produces:**
```ts
export type ReuseDeps = { embed: (t: string[]) => Promise<number[][]>; dir: string };
export async function reuseDecision(sig: CapabilitySignature, deps: ReuseDeps): Promise<ReuseDecision>
```
Algorithm: embed `signatureText(sig)`; for each manifest entry cosine vs stored `vector`; take max. `≥bands.reuse → Reuse`; `≥bands.offer → Offer`; else `Generate`. Tie-break equal-similarity by higher `useCount` then `lastEvalPass`. Empty manifest → `Generate, similarity 0`.
- [ ] Step 1 — Tests with a fake `embed` mapping known strings→vectors and a seeded manifest (write via T6): identical signature → `Reuse` (sim≈1, match=name); mid-similarity vector → `Offer`; orthogonal → `Generate`; empty dir → `Generate`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement.
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): reuse decision (cosine bands)`.

---

## Phase 2 — Execution stack (T8–T9, parallel after Phase 0)

### Task 8: Bounded dry-run
**Files:** Create `src/verified-build/dry-run.ts`; Test `tests/verified-build/dry-run.test.ts`
**Consumes:** `runGuardedAgent` (`src/core/delegate.ts`), `runCrew` (`src/crew/engine.ts`), `runWorkflow` (`src/workflow/engine.ts`), `dryRunMs` (T1), `ArtifactKind`,`DryRunResult` (T1).
**Produces:**
```ts
export function withWallClock<T>(ms: number, fn: () => Promise<T>): Promise<T>  // Promise.race; on timeout reject Error('dry-run timeout')
export function representativeTask(need: string, sig: CapabilitySignature): string  // benign/read-only phrasing derived from need
export type DryRunDeps = { runAgent: (task:string)=>Promise<{text:string}|{error:string}>; runCrew:(input:unknown)=>Promise<CrewOutcome>; runWorkflow:(input:unknown)=>Promise<WorkflowOutcome> };
export async function dryRun(kind: ArtifactKind, task: string, deps: DryRunDeps): Promise<DryRunResult>
```
`dryRun` calls the matching runner inside `withWallClock(dryRunMs(), …)`; maps `{error}`/`{kind:'failed'|'unverified'}` → `{ran:false,error}`, success → `{ran:true,output}`. `repairs` set by caller (T13); default 0. Catches timeout/throw → `{ran:false,error}`.
- [ ] Step 1 — Tests: `withWallClock(10, ()=>never)` rejects 'dry-run timeout'; `dryRun(Agent, 't', {runAgent: async()=>({text:'ok'}), …})` → `{ran:true, output:'ok'}`; runAgent returning `{error:'boom'}` → `{ran:false, error:'boom'}`; crew returning `{kind:'failed',message:'x'}` → `{ran:false}`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement.
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): bounded dry-run + wall-clock`.

### Task 9: Repair loop
**Files:** Create `src/verified-build/repair.ts`; Test `tests/verified-build/repair.test.ts`
**Consumes:** `maxRepairs` (T1), `DryRunResult` (T1).
**Produces:**
```ts
// attempt(feedback?: string) re-stages+re-runs, returning DryRunResult. Loops while !ran and attempts<maxRepairs().
export async function repairLoop(attempt: (feedback?: string) => Promise<DryRunResult>): Promise<DryRunResult>
```
First call `attempt()`; while `!res.ran && n < maxRepairs()`: `res = attempt(res.error)`, `n++`. Return final with `repairs: n`.
- [ ] Step 1 — Tests: attempt that fails-then-succeeds (closure counter) → `{ran:true, repairs:1}`; always-fails → `{ran:false, repairs: maxRepairs()}`; first-try-success → `{repairs:0}`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement.
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): bounded self-repair loop`.

---

## Phase 3 — Eval stack (T10–T12; T10,T11 parallel then T12)

### Task 10: Judge selection + degrade
**Files:** Create `src/verified-build/judge.ts`; Test `tests/verified-build/judge.test.ts`
**Consumes:** `judgeMinParams` (T1), model-manager/selector (inject a candidate list — do NOT hardcode), `VerifiedLevel` (T1).
**Produces:**
```ts
export type JudgeDeps = { candidates: () => { model: string; params: number; family: string }[]; generatorFamily?: string };
export type JudgePick = { model: string | null; belowBar: boolean };
export function selectJudge(deps: JudgeDeps): JudgePick  // largest params ≥ judgeMinParams(), prefer family≠generatorFamily; null+belowBar if none clears bar
```
- [ ] Step 1 — Tests: candidates with a 26B qwen + 9B gemma, generatorFamily 'qwen' → picks the 26B if it clears bar even if same family, but PREFERS a ≥bar different-family when available (add a 30B llama → picks llama). Only-9B present → `{model:null, belowBar:true}`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement (filter ≥bar; sort by different-family-first then params desc; head or null).
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): judge selection + degrade`.

### Task 11: Golden-set generation + store
**Files:** Create `src/verified-build/golden.ts`; Test `tests/verified-build/golden.test.ts`
**Consumes:** `BuilderModel` (`.object`), `GoldenSet`,`GoldenCase`,`GoldenKind` (T1), `atomicWrite`.
**Produces:**
```ts
export async function generateGolden(need: string, sig: CapabilitySignature, model: BuilderModel): Promise<GoldenSet> // 3–7 cases, decomposed from need
export function goldenPathFor(dir: string, name: string): string  // `${dir}/${name}.golden.json`
export function loadGolden(path: string): GoldenSet | null
export function appendGolden(path: string, c: GoldenCase): void    // living dataset
```
- [ ] Step 1 — Tests: fake `BuilderModel.object` returns `{cases:[{id,input,assert,kind}]}` → `generateGolden` returns it clamped to 3–7 (pad/trim rule: if <3, keep as-is but never throw; if >7, slice). `loadGolden` round-trips a written file; `appendGolden` adds a case.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement with a Zod schema for the model call; deterministic id fallback `c${i}`.
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): golden-set generation + store`.

### Task 12: Behavioral eval (judge protocol)
**Files:** Create `src/verified-build/eval.ts`; Test `tests/verified-build/eval.test.ts`
**Consumes:** `dryRun`-style runner to produce the artifact's output per case, a judge `generate(model,prompt)` fn, `checkClaim` (`src/verification/judge.ts`) for grounded cases, `evalRuns` (T1), `EvalResult`,`EvalCaseResult`,`GoldenCase`,`GoldenKind` (T1).
**Produces:**
```ts
export type EvalDeps = { runCase: (input: string) => Promise<string>; judge: (prompt: string) => Promise<boolean>; judgeModel: string; belowBar: boolean };
export async function evalCases(cases: GoldenCase[], deps: EvalDeps): Promise<EvalResult>
```
Per case: run the artifact (`runCase(input)`) once → output; ask `judge` a **binary rubric** prompt (`Does this output satisfy: "${assert}"? Answer Yes/No.\nOutput:\n${output}`) `evalRuns()` times; case passes only if **unanimous** true. `EvalResult.passed = all cases pass`. `belowBar` passed through.
- [ ] Step 1 — Tests: judge always-true + 2 cases → `passed:true, passedCount:2`; judge true-twice-false-once (counter) with evalRuns=3 → case FAILS (not unanimous); one case fails → `passed:false`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement (loop cases × evalRuns; short-circuit a case on first false).
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): behavioral golden-eval (unanimous judge protocol)`.

---

## Phase 4 — Orchestration (T13–T15)

### Task 13: The gate (`verifyAndCommit`)
**Files:** Create `src/verified-build/gate.ts`; Test `tests/verified-build/gate.test.ts`
**Consumes:** T5–T12 + T4 telemetry + T1 types/config.
**Produces:**
```ts
export type GateDeps = {
  kind: ArtifactKind; name: string; need: string; signature: CapabilitySignature;
  stage: (feedback?: string) => Promise<{ def: unknown }>;     // render to a tmp def, feedback drives repair regen
  structural: (def: unknown) => Promise<string[]>;             // returns issues; [] = ok
  dryRunOnce: (def: unknown) => Promise<DryRunResult>;
  goldenEval: (def: unknown) => Promise<EvalResult | null>;    // null => judge below bar / skipped
  commit: (def: unknown, level: VerifiedLevel, golden: GoldenSet | null, vector: number[]) => Promise<void>; // splice index + write golden + manifest
  makeGolden: () => Promise<GoldenSet>;
  vector: number[];
  force: boolean;
};
export async function verifyAndCommit(deps: GateDeps): Promise<VerificationResult>
```
Control flow (inside `withBuildVerifySpan`):
```ts
let def = (await deps.stage()).def;
const issues = await deps.structural(def);
if (issues.length && !deps.force) return { kind:'failed', stage:'structural', detail: issues.join('; ') };
// dry-run with repair
const dr = await repairLoop(async (fb) => { if (fb!==undefined){ def = (await deps.stage(fb)).def; } return deps.dryRunOnce(def); });
if (!dr.ran && !deps.force) return { kind:'failed', stage:'dry-run', detail: dr.error ?? 'did not run' };
// golden-eval
const golden = await deps.makeGolden();
const ev = await deps.goldenEval(def);          // may be null (below bar)
let level = VerifiedLevel.Runs;
if (ev) { if (!ev.passed && !deps.force) return { kind:'failed', stage:'golden-eval', detail:`${ev.passedCount}/${ev.total}` }; level = ev.passed ? VerifiedLevel.Behaves : VerifiedLevel.Unverified; }
if (deps.force && (issues.length || !dr.ran || (ev&&!ev.passed))) level = VerifiedLevel.Unverified;
await deps.commit(def, level, golden, deps.vector);
return { kind:'committed', name: deps.name, level, dryRun: dr, eval: ev ?? undefined };
```
- [ ] Step 1 — Tests with all-fake deps: happy path → `committed`, level `behaves`, commit called once; structural issue (force=false) → `failed/structural`, commit NOT called; dry-run fails twice then repairs → `committed`; dry-run always fails (force=false) → `failed/dry-run`; eval below bar (`goldenEval→null`) → `committed` level `runs`; eval fails (force=false) → `failed/golden-eval`; force=true on a failing case → `committed` level `unverified`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement per control flow above; wire telemetry events (`reuse` handled by caller; here emit `structural`/`dry_run`/`golden_eval` + `result(level)`).
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): stage→verify→commit gate`.

### Task 14: Usage aggregation from spans
**Files:** Create `src/verified-build/usage.ts`; Test `tests/verified-build/usage.test.ts`
**Consumes:** `readSpans` (`src/run/run-trace.ts`), `ATTR` (`crew.id`, `agent.delegation.target`, `workflow.id`), span timestamps.
**Produces:**
```ts
export type UsageStat = { lastUsedMs: number; useCount: number };
export function aggregateUsage(runsRoot: string): Record<string, UsageStat>  // name -> stat across all runs/*/spans.jsonl
```
- [ ] Step 1 — Tests: point at a tmp runsRoot with 2 fake run dirs each holding a `spans.jsonl` referencing `crew.id='c1'` etc.; assert `aggregateUsage` returns `c1: {useCount:2, lastUsedMs: max endNano/1e6}`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement (walk dirs, read spans, tally by the three id attrs).
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): usage aggregation from spans`.

### Task 15: Archive decision + reversible move
**Files:** Create `src/verified-build/archive.ts`; Test `tests/verified-build/archive.test.ts`
**Consumes:** `readManifest`+`removeEntry` (T6), `aggregateUsage` (T14), `archiveIdleDays` (T1), `reuseDecision`/cosine for near-duplicate check (T2/T7), `withBuildArchiveSpan` (T4).
**Produces:**
```ts
export type ArchiveCandidate = { name: string; reason: string };
export function archiveDecision(manifest: Manifest, usage: Record<string, UsageStat>, nowMs: number): ArchiveCandidate[] // idle > N days AND a more-used near-dup (cosine≥reuse band) exists
export function archiveArtifact(dir: string, name: string): void  // move file to `${dir}/archive/`, removeEntry, unregister from index (reverse of registerInIndex)
```
- [ ] Step 1 — Tests: manifest with A (idle 40d, useCount 0) near-dup of B (used, recent) → A is a candidate; A not idle → no candidate; A with no near-dup → no candidate (preserve). `archiveArtifact` in a tmp dir moves the file + drops the index entry.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement. `nowMs` injected (no `Date.now()` in pure logic — pass in).
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(verified-build): archive decision + reversible move`.

---

## Phase 5 — Builder integration (T16–T17)

### Task 16: agent-builder integration
**Files:** Modify `src/agent-builder/write.ts` (split render/register), `src/agent-builder/builder.ts` (reuse + gate), `src/agent-builder/types.ts` (BuildResult variants), `src/agent-builder/deps.ts` (wire gate deps); Test `tests/agent-builder/gate-integration.test.ts`
**Consumes:** `verifyAndCommit` (T13), `reuseDecision` (T7), `signatureFromNeed`/`signatureFromProposal` (T5), manifest/golden writers.
**Produces:** `BuildResult` gains `{ kind:'reused'; name; similarity }` and `{ kind:'failed-verification'; stage; detail }`; `written` gains `level: VerifiedLevel`. `writeAgent` split into `renderAgentFile(p)` (pure string, exists) + `registerAgent(p, files, paths)`.
- [ ] Step 1 — Test (fake model + fake gate deps): a need matching a seeded manifest entry → `buildAgent` returns `{kind:'reused'}` and does NOT generate; a fresh need with passing fake gate → `{kind:'written', level:'behaves'}`; failing gate → `{kind:'failed-verification'}`; `--force` path commits `unverified`.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement: reuse-check right after entry (before `draftAndValidate`); after consent, build `GateDeps` (stage=render-to-tmp, structural=`validateProposal`, dryRunOnce via `runGuardedAgent` on the staged agent, goldenEval, commit=`registerAgent`+manifest+golden) and call `verifyAndCommit`.
- [ ] Step 4 — PASS; typecheck; lint; confirm existing agent-builder tests green.
- [ ] Step 5 — Commit `feat(agent-builder): reuse + stage→verify→commit gate`.

### Task 17: crew-builder integration
**Files:** Modify `src/crew-builder/write.ts` (split render/register), `src/crew-builder/builder.ts` (reuse + gate), `src/crew-builder/types.ts` (variants), `src/crew-builder/deps.ts`; Test `tests/crew-builder/gate-integration.test.ts`
**Consumes:** same as T16 + `signatureFromIR`, `runCrew`/`runWorkflow`, `existingCrews()`/`existingWorkflows()` deps (already present, currently unused).
**Produces:** `CrewBuildResult` gains `{kind:'reused';name;similarity}` + `{kind:'failed-verification';stage;detail}`; `written` gains `level`. `writeCrewOrWorkflow` split into `renderRegister` → `render(source)` + `register(...)`.
- [ ] Step 1 — Test (fake): reuse hit → `{kind:'reused'}`, no generation; fresh crew with passing fake gate → `{kind:'written', level}`; failing → `{kind:'failed-verification'}`. Verify the staged file is discarded on failure (index/tmp untouched).
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement: reuse-check after `classify`; after transpile, GateDeps (stage=transpile-to-tmp, structural=`validateIR` structural subset, dryRunOnce via `runCrew`/`runWorkflow` on staged def, commit=register+manifest+golden).
- [ ] Step 4 — PASS; typecheck; lint; existing crew-builder tests green.
- [ ] Step 5 — Commit `feat(crew-builder): reuse + stage→verify→commit gate`.

---

## Phase 6 — Surfaces, calibration eval, docs (T18–T20)

### Task 18: `bun run archive` CLI + chat reuse hint
**Files:** Create `src/cli/archive.ts`; Modify `package.json` (script `"archive":"bun run src/cli/archive.ts"`), `src/cli/chat.ts` (reuse hint before build offer); Test `tests/cli/archive.test.ts`
**Consumes:** `archiveDecision`/`archiveArtifact` (T15), `aggregateUsage` (T14), `readManifest` (T6).
- [ ] Step 1 — Test: seeded manifest+usage → `archive.ts` report lists the candidate; `--prune` (with autoyes) moves it. Chat hint: fake reuse `Offer` → chat prints the hint string.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — Implement (dep-free terminal output; confirm via existing `askYesNo`).
- [ ] Step 4 — PASS; typecheck; lint.
- [ ] Step 5 — Commit `feat(cli): archive command + chat reuse hint`.

### Task 19: In-repo reuse calibration eval
**Files:** Create `tests/verified-build/reuse.eval.test.ts` (+ inline labeled pairs, mirror `tests/provisioning/eval.test.ts`)
- [ ] Step 1 — Write labeled pairs (duplicate/related/distinct signature texts) with a small deterministic fake embedder (or a fixed vector table) → assert bands separate reuse (≥0.85) vs generate (<0.75) correctly; document that live recalibration needs the real Ollama embedder.
- [ ] Step 2 — Run → adjust band defaults in `config.ts` only if the labeled set demands (record rationale).
- [ ] Step 3 — Commit `test(verified-build): reuse threshold calibration eval`.

### Task 20: Docs — all 4 surfaces + ledger
**Files:** Modify `docs/architecture.md` (new §20 + Mermaid node/edges + doc map if needed), `README.md` (status line + slice table row + feature paragraph), `docs/ROADMAP.md` (flip the 3 "works out of the box" rows + Phase-D-complete + recommended sequence), `.superpowers/sdd/progress.md` (Slice 20 ledger). Artifact regeneration is a controller step (noted, not a repo file).
- [ ] Step 1 — Update architecture.md §20 (module map, data-flow, mechanism) + add `verified-build` node/edges to both Mermaid diagrams.
- [ ] Step 2 — README + ROADMAP flips.
- [ ] Step 3 — `bun run docs:check` → PASS.
- [ ] Step 4 — Commit `docs(slice-20): all 4 living surfaces + ledger`.

---

## Controller responsibilities (not Fable tasks)
- Run full `bun test` + `bun run typecheck` + `bun run lint` between phases.
- **Live-verify on Ollama** (merge gate): (a) good need → generate→dry-run→eval→commit `behaves`; (b) broken generation → repair or reject (staged file discarded); (c) near-duplicate need → reuse fires; (d) force small judge → degrade to `runs`. Fix any live defects as current bugs.
- Regenerate the snapshot Artifact (§20 node/edges, footer counts).
- Whole-branch final review (fan-out) → fixes → merge `--no-ff` (ask user y/N) → push (slice-landing gate).

## Self-review notes
- Spec coverage: reuse(T5-7,16,17,19) · structural(reuses existing validators, invoked in gate T13) · dry-run+repair(T3,T8,T9,T13) · golden-eval+judge+degrade(T10,T11,T12,T13) · manifest/need-persistence(T6,16,17) · usage/archive(T14,T15,T18) · wall-clock(T3,T8) · embed convenience(T2) · telemetry(T4, used in T13/T15) · CLI/chat(T18) · docs(T20). All spec sections mapped.
- Types consistent across tasks (T1 is the single source; later tasks import from it).
- No placeholders: each task has signatures + concrete test cases + algorithm; full control-flow code given for the one integration-critical task (T13).
