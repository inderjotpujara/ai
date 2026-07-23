# Slice 32 — Self-Improvement Loop (continuous re-eval on model swap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-evaluate a generated artifact's persisted golden set whenever the model underneath it changes, catching silent behavioral regressions the one-shot creation gate cannot — via a new `Eval` JobKind driven by a Cron sweep + a `model.pull` JobChain, a noise-robust regression decision, and an auto-demote (Behaves→Unverified) surfaced in the Ops console.

**Architecture:** A new `src/self-improve/` subsystem of small, loosely-coupled modules: `verified-with` baseline capture (D1, in `src/verified-build/`), `spans.ts` + `config.ts` (telemetry + knobs), `reeval.ts` (D3 generation-free golden replay against the freshly-resolved model), `regression.ts` (D4 per-case + bounded-rerun + hysteresis decision), `history.ts` (D6 append-only `eval_history` in `jobs.db`), `action.ts` (D5 demote + record + degrade + span), and `executor.ts` (D2 sweep/pull/artifact orchestration, degrade-never-crash). Detection rides the EXISTING trigger substrate (a repo Cron def + a repo JobChain def — no new `TriggerType`). Surfaces: an Ops "Evals/Health" tab, a `reeval` CLI, and `eval.*` spans; the loop finally consumes the `chat.feedback` telemetry seam.

**Tech Stack:** Bun + TypeScript, Zod v4 contracts, `bun:sqlite` (reuses the Slice-24 `jobs.db` via the `JOBS_DB_MIGRATIONS` superset), OpenTelemetry spans, React 19 web console (`apiFetch`, no query lib, `@tanstack/react-router`). **New deps: NONE** — all substrate (SQLite, triggers, queue, gate, telemetry) already exists.

**Model tiering (for the SDD controller):** **Sonnet** is the floor for the type spine, config/telemetry keys, the store, contracts, API routes, the web tab, the CLI, and docs. **Opus** for the noise-band logic (`regression.ts`), the re-eval engine (`reeval.ts`), the `Eval` executor (concurrency/degrade/de-dup), and their reviews. **Opus/ultracode ADVERSARIAL-VERIFY** for the two §7 hard parts flagged inline (7.1 noise-band correctness, 7.2 sweep degrade-never-crash + manifest integrity). **Fable** whole-branch capstone before land (weekly-Fable headroom permitting; else Opus ultracode). Re-run `ccusage blocks --active` at every increment boundary gate and throttle per the budget-tiering rule.

## Global Constraints

*(Copied verbatim from the spec's §11 / Global rules — every task's requirements implicitly include this section.)*

- **bun only, never npm.** Per-task gate = `bun run typecheck` AND `bun run lint:file -- <files>` AND focused `bun run test -- -t "<name>"` — all three (bun test type-checks nothing; pre-commit is docs:check only). Web tasks gate = `cd web && bun run typecheck && bun run test`.
- **Full `bun run check`** (docs-check · typecheck · lint · check:web · test) at each increment boundary-gate task. Don't merge red.
- **TDD every task:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. Implementers run FOCUSED tests inline + commit per task (conventional `type(scope): summary`, ending with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer). The controller runs the full suite between tasks.
- **Repo style:** prefer `type` over `interface`; **string enums over literal unions** for finite named sets (`enum Foo { A = 'A' }`) — `EvalMode`, `RegressionVerdict`, `ReevalSkip` are string enums; discriminated object unions (`ReevalOutcome`) stay `type` with an enum/`z.literal` discriminant; early returns over nested conditionals; small focused files; **no `console.log`** (use `src/log/logger.ts` or an injected `print`).
- **Never hardcode model choices / budgets / limits.** New tunables go through `src/config/schema.ts` (`CONFIG_SPEC`, appended after the Slice-31 `AGENT_A2A_*` block); defaults are computed or conventional; env vars are fallback-only. The sweep cadence, hysteresis margin, and re-run count are ALL config-driven (`AGENT_REEVAL_*`).
- **Provider/runtime-agnostic:** every model resolve goes through `resolveModel` (`src/resource/selector.ts:67`); no per-runtime branching. A failed resolve / missing golden / unavailable judge is ONE uniform degrade (skip that artifact), never a per-provider branch and never a crash.
- **Degrade-never-crash (§7.2):** one artifact's `resolveModel` throw, missing golden sidecar, or below-bar/unavailable judge must be caught per-artifact and skip that artifact — never abort the whole sweep, never leave a half-written manifest. All manifest writes are atomic read-modify-write (`upsertEntry` → `atomicWrite`); serialize writes within the `Eval` executor.
- **Never demote on a single below-bar run (§7.1):** a regression is real only if the per-case drop PERSISTS across bounded re-runs AND the aggregate drop exceeds the configurable hysteresis margin. A below-bar/unavailable judge is INCONCLUSIVE — never a demote.
- **Append-only integrity (§7.4):** `eval_history` is insert + read only; no code path updates/deletes rows.
- **No secrets/PII in any span or DTO:** no golden case text beyond ids, no raw model output, in any `eval.*` span.
- **Docs hard line (all four surfaces, same push, or the pre-push slice-landing gate blocks):** `docs/architecture.md`, root `README.md` (Status line + slice table row + feature paragraph), `docs/ROADMAP.md` (flip the markers to ✅ Slice 32), and the SDD ledger `.superpowers/sdd/progress.md`. Regenerate the interactive architecture-snapshot Artifact (tooling can only remind).

## Standing notes (carried by every task; audited by the final review against the diff)

**Architecture-doc update (`docs/architecture.md`).** Add a new subsystem section **"§ `src/self-improve/` — continuous re-eval loop"** (baseline capture → detection (Cron sweep + pull JobChain) → `reeval.ts` → `regression.ts` noise band → demote + `eval_history` → Ops surface; the data-flow lane matching `docs/diagrams/slice-32-self-improvement/self-improvement-loop.png`). Update **§ verified-build** for `ManifestEntry.verifiedWith` + the extracted eval-binding helper shared with `reeval.ts`. Update **§24/§ queue** for the new `Eval` JobKind + dispatch case + `deriveRunKind` mapping. Update **§25/§ triggers** for the repo Cron sweep + pull JobChain trigger defs (no new `TriggerType`). Update **§ telemetry** for the new `eval.*` spans + `chat.feedback` now having a consumer. Update the **Ops Console** section for the new Evals/Health tab. `scripts/docs-check.ts` hard-fails on any undocumented top-level `src/<subsystem>`, and `.githooks/pre-commit` runs it with NO bypass — so the VERY FIRST `src/self-improve/` file (Task 3) would block its own commit. To avoid that, **Task 3 lands a minimal `src/self-improve/` STUB section in `docs/architecture.md` in the same commit**; Task 24 EXPANDS it into the full subsystem writeup.

**Telemetry to emit.** New spans via the existing `inSpan`/`ATTR` conventions (`src/telemetry/spans.ts`; no-op without a tracer): `eval.reeval` (root span for one re-eval run → `deriveRunKind` → `RunKind.Eval`) and `eval.regression` (child span/event on a confirmed regression), plus the standard `reliability.degrade` event via `recordDegrade`. New `ATTR` keys `EVAL_ARTIFACT`, `EVAL_MODE`, `EVAL_BASELINE_MODEL`, `EVAL_CURRENT_MODEL`, `EVAL_OUTCOME`, `EVAL_REGRESSED_COUNT`, `EVAL_DROP`; reuse `MODEL_ID`/`MODEL_PARAMS_B`/`VERIFY_JUDGE_MODEL`/`VERIFY_JUDGE_BELOW_BAR`/`VERIFY_GOLDEN_PASSED`/`VERIFY_GOLDEN_TOTAL`/`RELIABILITY_DEGRADE_FROM`/`RELIABILITY_DEGRADE_TO`. **No secret values.** Update the stale `chat.feedback` comments (`spans.ts:174`, `spans.ts:422`, `src/contracts/enums.ts:69` — all read "Slice 31") to say **Slice 32**, and read 👎 counts per artifact into the health tab.

---

## File Structure (decomposition lock-in)

**New engine modules (`src/self-improve/`):**
- `spans.ts` — `withEvalReevalSpan` / `recordEvalRegression` (mirrors `src/daemon/spans.ts`; no-op without a tracer).
- `config.ts` — `reevalEnabled()` / `reevalHysteresis()` / `reevalRerunCases()` / `reevalSweepCron()` readers (mirrors `src/verified-build/config.ts`'s `envNumber` idiom).
- `reeval.ts` — `reevalArtifact` (D3: golden replay against a resolved model; no regeneration).
- `regression.ts` — `decideRegression` (D4: per-case predicate + bounded unanimous-fail re-run + hysteresis).
- `history.ts` — `createEvalHistoryStore` + `EVAL_HISTORY_MIGRATIONS` (D6: append-only `eval_history` in `jobs.db`).
- `action.ts` — `applyRegressionOutcome` (D5: demote + eval_history row + `recordDegrade` + `eval.regression`).
- `executor.ts` — `runEval` (D2: sweep hot-first / affected-by-pull / single-artifact orchestration, drift diff, R4 de-dup, R5 seed, degrade-never-crash isolation).

**New / modified in `src/verified-build/`:**
- `verified-with.ts` (new) — the `verifiedWithFrom(resolved)` + `parseQuant(model)` helpers.
- `types.ts` — `VerifiedWith` type + `ManifestEntry.verifiedWith?` field.
- `manifest.ts` — `MANIFEST_VERSION` 1→2.
- `eval.ts` — extract the shared `runGoldenEval` binding helper (used by both builders + `reeval.ts`).

**Modified elsewhere:**
- `src/queue/types.ts` — `JobKind.Eval`. `src/contracts/enums.ts` — `RunKind.Eval` + `JobKindWire.Eval` + `chat.feedback` comment. `src/run/run-dto.ts` — `deriveRunKind('eval.reeval')`.
- `src/server/jobs/dispatch.ts` — `EvalMode` enum + `EvalJobPayloadSchema` + `case JobKind.Eval` + `RunEvalTurn` on `JobDispatchDeps`.
- `src/server/launch-turns.ts` — `createRealRunEvalTurn`. `src/cli/daemon.ts` (`buildRealDaemon`) + `src/server/main.ts` — wire the eval turn into `createJobDispatch`.
- `src/agent-builder/{types.ts,deps.ts,builder.ts}` + `src/crew-builder/{deps.ts,builder.ts}` — capture `verifiedWith` at commit.
- `src/config/schema.ts` — four `AGENT_REEVAL_*` knobs. `src/telemetry/spans.ts` — seven `EVAL_*` `ATTR` keys + comment fixes.
- `triggers/index.ts` (**repo-root**, not `src/triggers/`) — the repo Cron sweep + JobChain pull trigger defs.
- `src/contracts/dto.ts` (or a new `src/contracts/evals.ts` re-exported by `index.ts`) — `EvalHealthDTO` / `EvalHistoryDTO` + Zod.
- `src/server/app.ts` — `GET /api/evals`, `GET /api/evals/:artifact`, `POST /api/evals/reeval` routes.
- `src/cli/reeval.ts` (new) + `package.json` `reeval` script.
- `web/src/features/ops/{evals-tab.tsx,use-evals.ts}` (new) + `index.tsx` (`OpsTab`/`TABS`/panel) + `web/src/app/router.tsx` (`OpsSearch`).

---

## Increment 1 — D1 baseline + config/telemetry foundation

Persists the actual resolved model identity onto each `ManifestEntry` (the prerequisite the whole loop stands on), and lands the config knobs, telemetry keys, and the `src/self-improve/` docs stub.

### Task 1: `VerifiedWith` type + `ManifestEntry.verifiedWith?` field + version bump

**Files:**
- Modify: `src/verified-build/types.ts:73` (`ManifestEntry`), `src/verified-build/manifest.ts:8` (`MANIFEST_VERSION`)
- Create: `src/verified-build/verified-with.ts`
- Test: `tests/verified-build/verified-with.test.ts`, extend `tests/verified-build/manifest.test.ts`

**Interfaces:**
- Consumes: `RuntimeKind`, `ModelDeclaration` from `../core/types.ts`.
- Produces (exported from `src/verified-build/types.ts`):
  ```ts
  export type VerifiedWith = {
    runtime: RuntimeKind;   // decl.runtime
    model: string;          // decl.model — the concrete resolved id/tag
    paramsBillions: number; // decl.footprint.approxParamsBillions
    numCtx: number;         // the numCtx resolveModel returned
    quant?: string;         // best-effort, parsed from the model tag (R2); undefined when not derivable
    capturedAtMs: number;   // Date.now() at commit
  };
  ```
  `ManifestEntry` gains `verifiedWith?: VerifiedWith;` as its LAST field (undefined = no baseline / pre-Slice-32 entry).
- Produces (exported from `src/verified-build/verified-with.ts`):
  ```ts
  export function parseQuant(model: string): string | undefined;
  export function verifiedWithFrom(
    resolved: { decl: ModelDeclaration; numCtx: number },
    now?: number,
  ): VerifiedWith;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/verified-build/verified-with.test.ts
import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { parseQuant, verifiedWithFrom } from '../../src/verified-build/verified-with.ts';

test('parseQuant extracts a quant suffix from a model tag, else undefined', () => {
  expect(parseQuant('qwen2.5:7b-instruct-q4_K_M')).toBe('q4_K_M');
  expect(parseQuant('llama3.1-8b-q4_0')).toBe('q4_0');
  expect(parseQuant('qwen2.5:7b')).toBeUndefined();
});

test('verifiedWithFrom maps a resolved decl+numCtx onto a VerifiedWith', () => {
  const vw = verifiedWithFrom(
    {
      decl: {
        runtime: RuntimeKind.Ollama,
        model: 'qwen2.5:7b-instruct-q4_K_M',
        params: {},
        role: 'r',
        footprint: { approxParamsBillions: 7, bytesPerWeight: 0.5 },
      },
      numCtx: 8192,
    },
    1000,
  );
  expect(vw).toEqual({
    runtime: RuntimeKind.Ollama,
    model: 'qwen2.5:7b-instruct-q4_K_M',
    paramsBillions: 7,
    numCtx: 8192,
    quant: 'q4_K_M',
    capturedAtMs: 1000,
  });
});
```

```ts
// tests/verified-build/manifest.test.ts — ADD these two tests
import { MANIFEST_VERSION_FOR_TEST } from '../../src/verified-build/manifest.ts'; // if not exported, assert via readManifest of a fresh dir
// (a) a v1 manifest entry with NO verifiedWith reads back as undefined, never throws:
test('readManifest tolerates a v1 entry with no verifiedWith (undefined, no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vb-'));
  writeFileSync(
    join(dir, '.generated.json'),
    JSON.stringify({
      version: 1,
      entries: {
        a: {
          need: 'n', signature: { purpose: 'n', tools: [], modelTier: '', io: '', roles: [] },
          vector: [], verifiedLevel: 'behaves', goldenPath: `${dir}/a.golden.json`,
          createdAtMs: 1, lastUsedMs: 0, useCount: 0, lastEvalPass: true,
        },
      },
    }),
  );
  const m = readManifest(dir);
  expect(m.entries.a?.verifiedWith).toBeUndefined();
});
// (b) rebuildFromArtifacts leaves verifiedWith undefined (no live resolve offline):
test('rebuildFromArtifacts leaves verifiedWith undefined', () => {
  // seed a <name>.ts + <name>.golden.json in a temp dir with NO manifest, rebuild, assert entry.verifiedWith === undefined
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun run test:file -- "tests/verified-build/verified-with.test.ts"` → FAIL (module not found).
- [ ] **Step 3: Write minimal implementation** — add `VerifiedWith` + the field to `types.ts`; bump `const MANIFEST_VERSION = 2;` (`manifest.ts:8`); create `verified-with.ts`:

```ts
import type { ModelDeclaration } from '../core/types.ts';
import type { VerifiedWith } from './types.ts';

/** Best-effort quant parse from a model tag (R2): matches a trailing/embedded
 *  `qN...` group like `q4_K_M` / `q4_0` / `q8_0`. Undefined when not present —
 *  a quant-only swap may then be invisible to the drift diff (accepted this slice). */
export function parseQuant(model: string): string | undefined {
  const m = model.match(/(q\d+(?:_[0-9a-z]+)*)/i);
  return m ? m[1] : undefined;
}

export function verifiedWithFrom(
  resolved: { decl: ModelDeclaration; numCtx: number },
  now: number = Date.now(),
): VerifiedWith {
  return {
    runtime: resolved.decl.runtime,
    model: resolved.decl.model,
    paramsBillions: resolved.decl.footprint.approxParamsBillions,
    numCtx: resolved.numCtx,
    quant: parseQuant(resolved.decl.model),
    capturedAtMs: now,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/verified-build/verified-with.test.ts" "tests/verified-build/manifest.test.ts"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/verified-build/types.ts src/verified-build/manifest.ts src/verified-build/verified-with.ts tests/verified-build/verified-with.test.ts tests/verified-build/manifest.test.ts`.

```bash
git add src/verified-build/types.ts src/verified-build/manifest.ts src/verified-build/verified-with.ts tests/verified-build/verified-with.test.ts tests/verified-build/manifest.test.ts
git commit -m "feat(verified-build): VerifiedWith model-identity type + ManifestEntry.verifiedWith field + MANIFEST_VERSION 1->2"
```

*Model: Sonnet (pure type + helper + tolerance test).*

### Task 2: Capture `verifiedWith` at commit (agent + crew builders)

**Files:**
- Modify: `src/agent-builder/types.ts` (the builder `verify` deps type — add `verifiedWith`), `src/agent-builder/deps.ts:264` (compute from the resolved `{decl, numCtx}`), `src/agent-builder/builder.ts:267` (`commit` closure → pass into `upsertEntry`)
- Modify: `src/crew-builder/deps.ts` + `src/crew-builder/builder.ts` (symmetric)
- Test: `tests/agent-builder/gate-integration.test.ts` (or `tests/verified-build/commit-verifiedwith.test.ts`)

**Interfaces:**
- Consumes: `verifiedWithFrom` (Task 1); the resolved `{ decl, numCtx }` already computed at `src/agent-builder/deps.ts:264` (`const { decl, numCtx } = await resolveModel(...)`).
- Produces: the `verify` deps object (typed in `src/agent-builder/types.ts`) gains `verifiedWith: VerifiedWith`; both `commit` closures write it into the manifest entry via `upsertEntry(dir, name, { ...entry, verifiedWith })`.

- [ ] **Step 1: Write the failing test** — a fake builder-deps commit path asserts the persisted entry carries `verifiedWith.model`:

```ts
// Drive verifyAndCommit with a fake GateDeps whose commit is the REAL builder commit
// closure bound to a fake verify.verifiedWith; assert readManifest(dir).entries[name].verifiedWith
test('commit persists verifiedWith from the resolved model pick', async () => {
  // build a fake deps where verify.verifiedWith = { runtime: Ollama, model: 'A:7b', paramsBillions: 7, numCtx: 8192, capturedAtMs: 1 }
  // run the commit path at level=Behaves; expect readManifest(dir).entries[name]?.verifiedWith?.model === 'A:7b'
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test -- -t "commit persists verifiedWith"` → FAIL (`verifiedWith` undefined on the entry).
- [ ] **Step 3: Write minimal implementation** — in `src/agent-builder/deps.ts`, immediately after the resolve at line 264 build `const verifiedWith = verifiedWithFrom({ decl, numCtx });` and expose it on the returned `verify` object (line ~331-347 block, beside `judgeCandidates`/`generatorFamily`). In `src/agent-builder/builder.ts:267` `commit`, change the `upsertEntry(verify.dir, p.name, { … })` object to include `verifiedWith: verify.verifiedWith`. Repeat symmetrically in the crew-builder deps/builder. Add `verifiedWith: VerifiedWith` to the builder verify-deps type in `src/agent-builder/types.ts` (and the crew-builder equivalent).
- [ ] **Step 4: Run test to verify it passes** — `bun run test -- -t "commit persists verifiedWith"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/agent-builder/types.ts src/agent-builder/deps.ts src/agent-builder/builder.ts src/crew-builder/deps.ts src/crew-builder/builder.ts <test>`.

```bash
git add src/agent-builder/types.ts src/agent-builder/deps.ts src/agent-builder/builder.ts src/crew-builder/deps.ts src/crew-builder/builder.ts tests/…
git commit -m "feat(verified-build): capture verifiedWith from the resolved model pick at gate commit"
```

*Model: Opus (touches the live resolve seam in two builder deps files; the capture must read the ACTUAL resolved decl, not the generator/BuilderModel).*

### Task 3: `AGENT_REEVAL_*` config knobs + `EVAL_*` ATTR keys + `src/self-improve/{spans,config}.ts` (+ docs stub)

**Files:**
- Modify: `src/config/schema.ts` (append an "Self-improvement / re-eval (Slice 32)" group after the `AGENT_A2A_*` block), `src/telemetry/spans.ts` (`ATTR` map before the closing `} as const` at line 211; fix the `chat.feedback` "Slice 31" comments at `spans.ts:174` + `spans.ts:422` and `src/contracts/enums.ts:69`), `docs/architecture.md` (the stub — see Standing notes)
- Create: `src/self-improve/spans.ts`, `src/self-improve/config.ts`
- Test: `tests/config/reeval-knobs.test.ts`, `tests/self-improve/spans.test.ts`

**Interfaces:**
- Consumes: `ATTR`, `inSpan` from `../telemetry/spans.ts`; `EvalMode` will not exist until Task 8 — so `withEvalReevalSpan` takes `mode: string` for now (Task 8/16 pass `EvalMode` values, which are strings).
- Produces:
  - `CONFIG_SPEC` entries (shape `{ env, kind, def, doc }` per `schema.ts:43`; each `doc` names its read site):
    - `AGENT_REEVAL_ENABLED` (boolean, def `true`) — "Master switch for the self-improvement loop (sweep + pull hook + auto-demote), read by `src/self-improve/config.ts` `reevalEnabled()`. `0` disables all detection + demotion; the CLI / `POST /api/evals/reeval` still work manually."
    - `AGENT_REEVAL_SWEEP_CRON` (string, def `'0 4 * * *'`) — "Cron schedule for the periodic drift sweep (the repo Cron trigger's `config.schedule`, `triggers/index.ts`), read by `reevalSweepCron()`. Low-traffic hour by default."
    - `AGENT_REEVAL_HYSTERESIS` (number, def `0.15`) — "Aggregate pass-rate drop margin a confirmed regression must EXCEED before auto-demote (D4, `regression.ts`), read by `reevalHysteresis()`. Guards against judge noise."
    - `AGENT_REEVAL_RERUN_CASES` (number, def `2`) — "Bounded extra re-runs of each failing case; a case is confirmed-regressed only on unanimous fail across all re-runs (D4, `regression.ts`), read by `reevalRerunCases()`."
  - `ATTR` keys: `EVAL_ARTIFACT: 'eval.artifact'`, `EVAL_MODE: 'eval.mode'`, `EVAL_BASELINE_MODEL: 'eval.baseline_model'`, `EVAL_CURRENT_MODEL: 'eval.current_model'`, `EVAL_OUTCOME: 'eval.outcome'`, `EVAL_REGRESSED_COUNT: 'eval.regressed_count'`, `EVAL_DROP: 'eval.drop'`.
  - `src/self-improve/config.ts`: `reevalEnabled(): boolean`, `reevalHysteresis(): number`, `reevalRerunCases(): number`, `reevalSweepCron(): string` (mirror `src/verified-build/config.ts`'s `envNumber`; add an `envBool`/`envStr` sibling).
  - `src/self-improve/spans.ts`:
    ```ts
    export function withEvalReevalSpan<T>(
      info: { artifact: string; mode: string; baselineModel?: string; currentModel: string },
      fn: (rec: {
        golden: (passed: number, total: number) => void;
        judge: (model: string, belowBar: boolean) => void;
        outcome: (o: string) => void;
      }) => Promise<T>,
    ): Promise<T>;
    export function recordEvalRegression(info: {
      artifact: string; regressedCount: number; drop: number; from: string; to: string;
    }): void;
    ```
    `withEvalReevalSpan` opens the `eval.reeval` root span via `inSpan` (so `deriveRunKind` sees it), sets `EVAL_ARTIFACT`/`EVAL_MODE`/`EVAL_BASELINE_MODEL`/`EVAL_CURRENT_MODEL` + `MODEL_ID`=currentModel; `rec.golden` sets `VERIFY_GOLDEN_PASSED`/`VERIFY_GOLDEN_TOTAL`, `rec.judge` sets `VERIFY_JUDGE_MODEL`/`VERIFY_JUDGE_BELOW_BAR`, `rec.outcome` sets `EVAL_OUTCOME`. `recordEvalRegression` adds an `eval.regression` event on the active span with `EVAL_REGRESSED_COUNT`/`EVAL_DROP`/`RELIABILITY_DEGRADE_FROM`/`RELIABILITY_DEGRADE_TO`. Both no-op without a tracer.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/config/reeval-knobs.test.ts
import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';
test('reeval knobs carry conventional defaults', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_REEVAL_ENABLED).toBe(true);
  expect(values.AGENT_REEVAL_SWEEP_CRON).toBe('0 4 * * *');
  expect(values.AGENT_REEVAL_HYSTERESIS).toBe(0.15);
  expect(values.AGENT_REEVAL_RERUN_CASES).toBe(2);
});
```

```ts
// tests/self-improve/spans.test.ts
import { expect, test } from 'bun:test';
import { recordEvalRegression, withEvalReevalSpan } from '../../src/self-improve/spans.ts';
test('eval span helpers are a no-op without a tracer', async () => {
  const out = await withEvalReevalSpan(
    { artifact: 'a', mode: 'sweep', currentModel: 'B:7b' },
    async (rec) => { rec.golden(2, 3); rec.judge('J:32b', false); rec.outcome('regression'); return 9; },
  );
  expect(out).toBe(9);
  recordEvalRegression({ artifact: 'a', regressedCount: 1, drop: 0.33, from: 'A:7b', to: 'B:7b' }); // must not throw
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun run test -- -t "reeval knobs"` → FAIL.
- [ ] **Step 3: Write minimal implementation** — append the four `CONFIG_SPEC` entries; add the seven `ATTR` keys before `} as const`; fix the three "Slice 31"→"Slice 32" comments; write `src/self-improve/config.ts` + `src/self-improve/spans.ts`. **Land the `src/self-improve/` docs stub** in `docs/architecture.md` (near the § verified-build section):

```markdown
### `src/self-improve/` — continuous re-eval loop (Slice 32, stub)

Re-evaluates a generated artifact's persisted golden set whenever the model
underneath it changes. Baseline capture (`ManifestEntry.verifiedWith`) →
detection (a repo Cron sweep + a `model.pull` JobChain, both riding the existing
trigger substrate) → `reeval.ts` (generation-free golden replay) →
`regression.ts` (per-case + bounded re-run + hysteresis) → auto-demote
Behaves→Unverified + append-only `eval_history` in `jobs.db` → Ops "Evals/Health"
tab. A new `Eval` JobKind carries the work through the Slice-24 queue.

> Stub — expanded into the full subsystem writeup (module map, data-flow edges,
> the `Eval` dispatch case) in this slice's docs task (Task 24).
```

- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/config/schema.ts src/telemetry/spans.ts src/contracts/enums.ts src/self-improve/spans.ts src/self-improve/config.ts tests/config/reeval-knobs.test.ts tests/self-improve/spans.test.ts && bun run docs:check` (docs-check PASSES via the stub).

```bash
git add src/config/schema.ts src/telemetry/spans.ts src/contracts/enums.ts src/self-improve/spans.ts src/self-improve/config.ts docs/architecture.md tests/config/reeval-knobs.test.ts tests/self-improve/spans.test.ts
git commit -m "feat(self-improve): AGENT_REEVAL_* knobs + eval.* ATTR keys + spans (+ src/self-improve docs stub); chat.feedback consumer=Slice 32"
```

*Model: Sonnet.*

### Task 4: Increment 1 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (the Task-3 stub satisfies the subsystem-documented check; no exemption needed at any gate this slice).
- [ ] **Step 2: Record the increment in the SDD ledger** (`.superpowers/sdd/progress.md`) with per-task commit refs.

*Model: controller (no code).*

---

## Increment 2 — D3 kind + re-eval engine

Adds the `Eval` JobKind, factors the golden-eval binding into ONE shared helper, builds the generation-free `reevalArtifact`, and wires the dispatch case + turn.

### Task 5: `JobKind.Eval` / `RunKind.Eval` / `JobKindWire.Eval` + parity + `deriveRunKind`

**Files:**
- Modify: `src/queue/types.ts:23` (`JobKind`), `src/contracts/enums.ts:120` (`RunKind`), `src/contracts/enums.ts:237` (`JobKindWire`), `src/run/run-dto.ts:46` (`deriveRunKind`)
- Test: extend `tests/contracts/job-kind-parity.test.ts` + `tests/contracts/run-kind-build-pull.test.ts`; add a `deriveRunKind` test (e.g. in `tests/run/run-dto.test.ts` if present, else a new `tests/run/derive-run-kind.test.ts`)

**Interfaces:**
- Produces: `JobKind.Eval = 'eval'`, `RunKind.Eval = 'eval'`, `JobKindWire.Eval = 'eval'`. `deriveRunKind(['eval.reeval']) === RunKind.Eval`.
- The JobKind ⊆ RunKind invariant holds (both add `'eval'`); the `JobKindWire == JobKind` parity test (`job-kind-parity.test.ts`) already compares the full value sets, so adding `Eval` to only one side would break it.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/contracts/job-kind-parity.test.ts — the EXISTING
// "contract JobKind values stay isomorphic with queue" test now must include 'eval'
// on BOTH sides; add an explicit assertion that JobKind.Eval exists:
test('JobKind gains Eval (Slice 32)', () => {
  expect(JobKind.Eval as string).toBe('eval');
  expect(JobKindWire.Eval as string).toBe('eval');
});
```

```ts
// tests/contracts/run-kind-build-pull.test.ts — extend the full-set assertion
test('RunKind gains Eval (Slice 32)', () => {
  expect(RunKind.Eval as string).toBe('eval');
  expect((Object.values(RunKind) as string[]).sort()).toEqual(
    ['agent', 'build', 'chat', 'crew', 'eval', 'mcp', 'memory', 'pull', 'workflow'].sort(),
  );
});
```

```ts
// deriveRunKind test
import { deriveRunKind } from '../../src/run/run-dto.ts';
import { RunKind } from '../../src/contracts/enums.ts';
test("deriveRunKind maps the eval.reeval root span to RunKind.Eval", () => {
  expect(deriveRunKind(['eval.reeval'])).toBe(RunKind.Eval);
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun run test -- -t "JobKind gains Eval"` → FAIL.
- [ ] **Step 3: Write minimal implementation** — add `Eval = 'eval', // RunKind.Eval` to `JobKind`; add `Eval = 'eval',` to `RunKind` and `JobKindWire`; add `if (rootSpanNames.includes('eval.reeval')) return RunKind.Eval;` to `deriveRunKind` (before the `chat.run` fallback).
- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/contracts/job-kind-parity.test.ts" "tests/contracts/run-kind-build-pull.test.ts"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/queue/types.ts src/contracts/enums.ts src/run/run-dto.ts <tests>`.

```bash
git add src/queue/types.ts src/contracts/enums.ts src/run/run-dto.ts tests/contracts/job-kind-parity.test.ts tests/contracts/run-kind-build-pull.test.ts tests/run/derive-run-kind.test.ts
git commit -m "feat(queue,contracts): Eval JobKind + RunKind.Eval/JobKindWire.Eval + deriveRunKind(eval.reeval)"
```

*Model: Sonnet (mechanical add-a-kind; the parity tests are the guard).*

### Task 6: Extract the shared `runGoldenEval` binding helper

**Files:**
- Modify: `src/verified-build/eval.ts` (add `runGoldenEval`), `src/agent-builder/builder.ts:206-246` (`goldenEval` closure → call the helper), `src/crew-builder/builder.ts:244-273` (symmetric)
- Test: extend `tests/verified-build/eval.test.ts`

**Interfaces:**
- Consumes: `evalCases`, `EvalDeps` (this file); `selectJudge`, `JudgeCandidate`, `JudgeUnavailableError` from `./judge.ts`; `GoldenCase`, `EvalResult` from `./types.ts`.
- Produces:
  ```ts
  export type GoldenEvalBinding = {
    cases: GoldenCase[];
    judgeCandidates: () => JudgeCandidate[];
    generatorFamily?: string;
    runCase: (input: string) => Promise<string>;
    judge: (model: string, prompt: string) => Promise<boolean>;
  };
  /** ONE eval-binding path shared by both builders' goldenEval closures AND
   *  reeval.ts: select the judge (below-bar → null), bind EvalDeps, run
   *  evalCases; a JudgeUnavailableError degrades to null (skip behavioral eval),
   *  matching the gate's never-crash policy (builder.ts:238). */
  export async function runGoldenEval(b: GoldenEvalBinding): Promise<EvalResult | null>;
  ```

- [ ] **Step 1: Write the failing test** — the helper selects a judge, binds, and returns an `EvalResult`; a below-bar judge (no qualifying candidate) → null; a `JudgeUnavailableError` from `judge` → null:

```ts
test('runGoldenEval returns an EvalResult for a qualifying judge', async () => {
  const res = await runGoldenEval({
    cases: [{ id: 'c0', input: 'x', assert: 'ok', kind: GoldenKind.TaskSuccess }],
    judgeCandidates: () => [{ model: 'J:32b', params: 32e9, family: 'jf' }],
    generatorFamily: 'gf',
    runCase: async () => 'answer',
    judge: async () => true,
  });
  expect(res?.passed).toBe(true);
  expect(res?.judgeModel).toBe('J:32b');
});
test('runGoldenEval returns null when no judge clears the bar (below bar)', async () => {
  const res = await runGoldenEval({
    cases: [{ id: 'c0', input: 'x', assert: 'ok', kind: GoldenKind.TaskSuccess }],
    judgeCandidates: () => [{ model: 'small', params: 1e9, family: 'jf' }],
    runCase: async () => 'answer',
    judge: async () => true,
  });
  expect(res).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (not exported).
- [ ] **Step 3: Write minimal implementation** — move the `selectJudge(...) → if model null return null → try { evalCases(...) } catch JudgeUnavailableError → null` shape from `builder.ts:208-245` into `runGoldenEval`; then rewrite BOTH builders' `goldenEval` closures to delegate:

```ts
// src/verified-build/eval.ts — NEW
export async function runGoldenEval(b: GoldenEvalBinding): Promise<EvalResult | null> {
  const judgePick = selectJudge({ candidates: b.judgeCandidates, generatorFamily: b.generatorFamily });
  if (judgePick.model === null) return null;
  const judgeModelId = judgePick.model;
  try {
    return await evalCases(b.cases, {
      runCase: b.runCase,
      judge: (prompt) => b.judge(judgeModelId, prompt),
      judgeModel: judgeModelId,
      belowBar: judgePick.belowBar,
    });
  } catch (err) {
    if (err instanceof JudgeUnavailableError) return null;
    throw err;
  }
}
```

```ts
// src/agent-builder/builder.ts:206 — goldenEval now delegates
goldenEval: async (def, golden) => {
  const { agent } = def as StagedAgent;
  return runGoldenEval({
    cases: golden.cases,
    judgeCandidates: verify.judgeCandidates,
    generatorFamily: verify.generatorFamily,
    runCase: async (input) => {
      try {
        const r = await withWallClock(dryRunMs(), () =>
          verify.runAgent(agent, input, AbortSignal.timeout(dryRunMs())),
        );
        return 'text' in r ? r.text : `error: ${r.error}`;
      } catch (err) {
        return `error: ${String(err)}`;
      }
    },
    judge: (model, prompt) => verify.judge(prompt, model),
  });
},
```

(The crew-builder `goldenEval` at `crew-builder/builder.ts:244` gets the identical treatment with its own `runCrew`/`runAgent` seam.)

- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/verified-build/eval.test.ts" "tests/agent-builder/gate-integration.test.ts" "tests/crew-builder/gate-integration.test.ts"` → PASS (the refactor is behavior-preserving; the gate integration tests are the regression net).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/verified-build/eval.ts src/agent-builder/builder.ts src/crew-builder/builder.ts tests/verified-build/eval.test.ts`.

```bash
git add src/verified-build/eval.ts src/agent-builder/builder.ts src/crew-builder/builder.ts tests/verified-build/eval.test.ts
git commit -m "refactor(verified-build): extract shared runGoldenEval binding (one eval path for both builders + reeval)"
```

*Model: Opus (behavior-preserving refactor across two live builder files; the gate integration tests must stay green).*

### Task 7: `src/self-improve/reeval.ts` — `reevalArtifact` (generation-free)

**Files:**
- Create: `src/self-improve/reeval.ts`
- Test: `tests/self-improve/reeval.test.ts`

**Interfaces:**
- Consumes: `runGoldenEval`, `GoldenCase`, `EvalResult` from `../verified-build/eval.ts`; `loadGolden` from `../verified-build/golden.ts`; `JudgeCandidate` from `../verified-build/judge.ts`; `ManifestEntry` from `../verified-build/types.ts`; `ModelDeclaration` from `../core/types.ts`.
- Produces:
  ```ts
  export enum ReevalSkip { NoGolden = 'no-golden', JudgeUnavailable = 'judge-unavailable' }
  export type ReevalOutcome =
    | { kind: 'evaluated'; result: EvalResult; resolved: { decl: ModelDeclaration; numCtx: number } }
    | { kind: 'skipped'; reason: ReevalSkip };
  export type ReevalDeps = {
    resolve: (need: string) => Promise<{ decl: ModelDeclaration; numCtx: number }>;
    runCase: (ref: string, model: ModelDeclaration, input: string) => Promise<string>;
    judgeCandidates: () => JudgeCandidate[];
    judge: (model: string, prompt: string) => Promise<boolean>;
    loadGolden: (goldenPath: string) => GoldenSet | null;
  };
  /** Replay the PERSISTED golden against the freshly-resolved model. NEVER
   *  regenerates the artifact (no stage/structural/dryRun/makeGolden). */
  export async function reevalArtifact(entry: ManifestEntry, name: string, deps: ReevalDeps): Promise<ReevalOutcome>;
  ```
  Flow: `const golden = deps.loadGolden(entry.goldenPath); if (!golden) return { kind:'skipped', reason: NoGolden };` → `const resolved = await deps.resolve(entry.need);` → `const result = await runGoldenEval({ cases: golden.cases, judgeCandidates: deps.judgeCandidates, generatorFamily: modelFamily(resolved.decl.model), runCase: (input)=>deps.runCase(name, resolved.decl, input), judge: deps.judge });` → `if (result === null) return { kind:'skipped', reason: JudgeUnavailable };` → `return { kind:'evaluated', result, resolved };`.

- [ ] **Step 1: Write the failing tests** (all mocked — no real model):

```ts
import { expect, test } from 'bun:test';
import { reevalArtifact, ReevalSkip } from '../../src/self-improve/reeval.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import { GoldenKind } from '../../src/verified-build/types.ts';

const decl = { runtime: RuntimeKind.Ollama, model: 'B:7b', params: {}, role: 'r', footprint: { approxParamsBillions: 7, bytesPerWeight: 0.5 } };
const entry = { need: 'n', signature: { purpose: 'n', tools: [], modelTier: '', io: '', roles: [] }, vector: [], verifiedLevel: 'behaves', goldenPath: '/tmp/x.golden.json', createdAtMs: 1, lastUsedMs: 0, useCount: 0, lastEvalPass: true } as const;

test('missing golden → skipped(no-golden), never resolves or evaluates', async () => {
  let resolved = false;
  const out = await reevalArtifact(entry as never, 'x', {
    resolve: async () => { resolved = true; return { decl, numCtx: 8192 }; },
    runCase: async () => 'a', judgeCandidates: () => [], judge: async () => true,
    loadGolden: () => null,
  });
  expect(out).toEqual({ kind: 'skipped', reason: ReevalSkip.NoGolden });
  expect(resolved).toBe(false);
});
test('below-bar judge → skipped(judge-unavailable), no demote path taken here', async () => {
  const out = await reevalArtifact(entry as never, 'x', {
    resolve: async () => ({ decl, numCtx: 8192 }),
    runCase: async () => 'a',
    judgeCandidates: () => [{ model: 'small', params: 1e9, family: 'jf' }], // below AGENT_JUDGE_MIN_PARAMS
    judge: async () => true,
    loadGolden: () => ({ need: 'n', cases: [{ id: 'c0', input: 'i', assert: 'ok', kind: GoldenKind.TaskSuccess }] }),
  });
  expect(out).toEqual({ kind: 'skipped', reason: ReevalSkip.JudgeUnavailable });
});
test('evaluated → returns EvalResult + the resolved model (no regeneration)', async () => {
  const out = await reevalArtifact(entry as never, 'x', {
    resolve: async () => ({ decl, numCtx: 8192 }),
    runCase: async (_ref, _model, input) => (input === 'i' ? 'good' : 'bad'),
    judgeCandidates: () => [{ model: 'J:32b', params: 32e9, family: 'jf' }],
    judge: async () => true,
    loadGolden: () => ({ need: 'n', cases: [{ id: 'c0', input: 'i', assert: 'ok', kind: GoldenKind.TaskSuccess }] }),
  });
  expect(out.kind).toBe('evaluated');
  if (out.kind === 'evaluated') { expect(out.result.passed).toBe(true); expect(out.resolved.decl.model).toBe('B:7b'); }
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the Produces block (import `modelFamily` from wherever the builders import it — verify with `grep -n "modelFamily" src/agent-builder/deps.ts`; it lives in the model-family util). Use early returns.
- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/self-improve/reeval.test.ts"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/self-improve/reeval.ts tests/self-improve/reeval.test.ts`.

```bash
git add src/self-improve/reeval.ts tests/self-improve/reeval.test.ts
git commit -m "feat(self-improve): reevalArtifact — generation-free golden replay against the resolved model"
```

*Model: Opus (correctness-critical: must never regenerate; degrade paths must be exact).*

### Task 8: `EvalMode` + `EvalJobPayloadSchema` + dispatch case + turn wiring

**Files:**
- Modify: `src/server/jobs/dispatch.ts` (`EvalMode` enum + `EvalJobPayloadSchema` + `case JobKind.Eval` in `buildExecutor` + `RunEvalTurn` on `JobDispatchDeps:43`), `src/server/launch-turns.ts` (`createRealRunEvalTurn`), `src/cli/daemon.ts` (`buildRealDaemon` `createJobDispatch({…})` call ~line 175), `src/server/main.ts` (its own `createJobDispatch` construction)
- Test: `tests/server/jobs/dispatch.test.ts` (extend), `tests/self-improve/eval-turn.test.ts`

**Interfaces:**
- Consumes: `runEval` from `../../self-improve/executor.ts` — **NOT YET BUILT** (Task 14/16). To keep this task independently testable, wire the dispatch case to call an injected `RunEvalTurn` dep that Task 14 fills with the real executor; here it is exercised with a fake.
- Produces:
  ```ts
  // src/server/jobs/dispatch.ts — NEW
  export enum EvalMode { Sweep = 'sweep', AffectedByPull = 'affected-by-pull', Artifact = 'artifact' }
  const EvalJobPayloadSchema = z.object({
    mode: z.enum(EvalMode),
    ref: z.string().min(1).optional(),   // required iff mode === Artifact
    reason: z.string().optional(),       // 'sweep' | 'pull:<ref>' | 'manual'
  });
  // On JobDispatchDeps (dispatch.ts:43), add:
  //   runEvalTurn?: RunEvalTurn;  // optional so pre-Slice-32 dispatch fixtures compile
  export type RunEvalTurn = (input: {
    mode: EvalMode; ref?: string; reason?: string; runId: string; signal?: AbortSignal;
  }) => Promise<OrchestratorResult>;
  ```
  `case JobKind.Eval`: `const { mode, ref, reason } = EvalJobPayloadSchema.parse(job.payload); if (!deps.runEvalTurn) throw new Error('eval job but no runEvalTurn dep is wired'); return deps.runEvalTurn({ mode, ref, reason, runId: requireRunId(job), signal });` (mirrors the `a2aRef` fail-fast at `dispatch.ts:200`). `EvalMode.Artifact` with no `ref` is a permanent defect — `EvalJobPayloadSchema` refine: `.refine(p => p.mode !== EvalMode.Artifact || !!p.ref, 'ref required for mode=artifact')`.

- [ ] **Step 1: Write the failing tests** — the dispatch maps an eval payload to `runEvalTurn`; a bad payload throws; a missing dep throws:

```ts
test('Eval job dispatches to runEvalTurn with the parsed mode/ref', async () => {
  const calls: unknown[] = [];
  const dispatch = createJobDispatch({ /* fakes */ runEvalTurn: async (i) => { calls.push(i); return { kind: 'answer', text: 'ok' }; } } as never);
  const exec = dispatch(JobKind.Eval);
  await exec({ payload: { mode: 'artifact', ref: 'file_qa' }, runId: 'r1' } as never, undefined as never);
  expect(calls[0]).toMatchObject({ mode: 'artifact', ref: 'file_qa', runId: 'r1' });
});
test('Eval job with mode=artifact and no ref is a permanent defect (throws)', async () => { /* EvalJobPayloadSchema.parse throws */ });
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — add the enum/schema/case/dep. Add `createRealRunEvalTurn(runsRoot): RunEvalTurn` to `src/server/launch-turns.ts` that opens a run via `withRunTelemetry`/`withMcpRun` (root span `eval.reeval` so `deriveRunKind` classifies it) and calls `runEval(...)` (import from `../self-improve/executor.ts` — **this import lands with Task 16; until then, stub `createRealRunEvalTurn` to throw `new Error('runEval not wired until Task 16')` and DO NOT wire it into the daemon/server yet**). Wire `runEvalTurn: createRealRunEvalTurn(runsRoot)` into BOTH `buildRealDaemon` (`src/cli/daemon.ts` `createJobDispatch({…})`) and `src/server/main.ts`'s `createJobDispatch` in Task 16 (not here — this task only lands the dispatch seam + the fake-tested case).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/jobs/dispatch.ts src/server/launch-turns.ts tests/server/jobs/dispatch.test.ts`.

```bash
git add src/server/jobs/dispatch.ts src/server/launch-turns.ts tests/server/jobs/dispatch.test.ts
git commit -m "feat(queue): Eval dispatch case + EvalMode/EvalJobPayloadSchema + RunEvalTurn seam"
```

*Model: Opus (dispatch/turn wiring is the queue→execution seam; the fail-fast on a missing dep must not silently fall through).*

### Task 9: Increment 2 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Green including docs-check.
- [ ] **Step 2: Update the SDD ledger** with Increment 2 commits + the Task-6 refactor's behavior-preservation note.

*Model: controller.*

---

## Increment 3 — D6 store

### Task 10: `eval_history` store + `EVAL_HISTORY_MIGRATIONS` (superset extension, R3)

**Files:**
- Create: `src/self-improve/history.ts`
- Modify: `src/triggers/migrations.ts:85` (extend `JOBS_DB_MIGRATIONS`)
- Test: `tests/self-improve/history.test.ts`, extend `tests/triggers/migrations.test.ts`

**Interfaces:**
- Consumes: `Database` from `bun:sqlite`; `migrate` from `../db/migrate.ts`; `Migration` type; `JOBS_DB_MIGRATIONS` from `../triggers/migrations.ts`; `EvalCaseResult` from `../verified-build/types.ts`.
- Produces:
  ```ts
  export type EvalHistoryRow = {
    id: string; artifactId: string; model: string; baselineModel?: string;
    ts: number; passed: boolean; passedCount: number; total: number;
    regressed: boolean; perCase: EvalCaseResult[]; judgeModel: string; belowBar: boolean; reason?: string;
  };
  export type EvalHistoryStore = {
    insert(row: EvalHistoryRow): void;                 // append-only — NO update/delete method exists
    listByArtifact(artifactId: string): EvalHistoryRow[]; // ts DESC
    latestPassing(artifactId: string): EvalHistoryRow | undefined;
    close(): void;
  };
  export function createEvalHistoryStore(config: { path?: string }): EvalHistoryStore;
  ```
  **R3 — CRITICAL:** `EVAL_HISTORY_MIGRATIONS` is appended to the `jobs.db` superset in `src/triggers/migrations.ts`: `export const JOBS_DB_MIGRATIONS: Migration[] = [...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS, ...EVAL_HISTORY_MIGRATIONS];`. `createEvalHistoryStore` opens `<AGENT_QUEUE_PATH>/jobs.db` and runs `migrate(db, JOBS_DB_MIGRATIONS)` — the FULL superset, NEVER an independent list (a per-DB single `PRAGMA user_version` means two lists over one file collide silently). Pragma trio: `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;` (mirror `createSessionStore`, `src/session/store.ts:117-121`).

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvalHistoryStore } from '../../src/self-improve/history.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'eh-'));
const row = (o: Partial<import('../../src/self-improve/history.ts').EvalHistoryRow>) => ({
  id: crypto.randomUUID(), artifactId: 'a', model: 'B:7b', ts: 1, passed: true,
  passedCount: 3, total: 3, regressed: false, perCase: [], judgeModel: 'J:32b', belowBar: false, ...o,
});

test('insert + listByArtifact returns rows newest-first (ts DESC)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ ts: 1 })); s.insert(row({ ts: 3 })); s.insert(row({ ts: 2 }));
  expect(s.listByArtifact('a').map((r) => r.ts)).toEqual([3, 2, 1]);
  s.close();
});
test('latestPassing skips regressed/failed rows and returns the newest passing', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ ts: 1, passed: true }));
  s.insert(row({ ts: 2, passed: false, regressed: true }));
  expect(s.latestPassing('a')?.ts).toBe(1);
  s.close();
});
test('perCase round-trips through the TEXT JSON column', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ perCase: [{ id: 'c0', passed: false, detail: 'judge answered no' }] }));
  expect(s.listByArtifact('a')[0]?.perCase[0]).toMatchObject({ id: 'c0', passed: false });
  s.close();
});
test('the store has no update/delete surface (append-only, §7.4)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  expect((s as Record<string, unknown>).update).toBeUndefined();
  expect((s as Record<string, unknown>).delete).toBeUndefined();
  s.close();
});
```

```ts
// tests/triggers/migrations.test.ts — ADD: the superset now ends with eval_history,
// and JOB_MIGRATIONS stays the strict prefix.
test('JOBS_DB_MIGRATIONS ends with the eval_history migration (Slice 32)', () => {
  expect(JOBS_DB_MIGRATIONS.at(-1)?.name).toBe('init-eval-history');
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** — define `EVAL_HISTORY_MIGRATIONS` (exported from `history.ts`, imported by `migrations.ts` to append to the superset):

```sql
CREATE TABLE IF NOT EXISTS eval_history (
  id             TEXT PRIMARY KEY,
  artifact_id    TEXT NOT NULL,
  model          TEXT NOT NULL,
  baseline_model TEXT,
  ts             INTEGER NOT NULL,
  passed         INTEGER NOT NULL,
  passed_count   INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  regressed      INTEGER NOT NULL,
  per_case       TEXT NOT NULL,
  judge_model    TEXT NOT NULL,
  below_bar      INTEGER NOT NULL,
  reason         TEXT
);
CREATE INDEX IF NOT EXISTS idx_eval_history_artifact_ts ON eval_history (artifact_id, ts DESC);
```

```ts
// src/self-improve/history.ts — the migration + store; camelCase rows ↔ snake_case columns
export const EVAL_HISTORY_MIGRATIONS: Migration[] = [
  { name: 'init-eval-history', up: (db) => { db.run(`CREATE TABLE …`); db.run(`CREATE INDEX …`); } },
];
export function createEvalHistoryStore(config: { path?: string }): EvalHistoryStore {
  const dbPath = join(config.path ?? 'jobs', 'jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, JOBS_DB_MIGRATIONS); // the FULL superset — R3
  // insert / listByArtifact (ORDER BY ts DESC) / latestPassing (WHERE passed=1 AND regressed=0 ORDER BY ts DESC LIMIT 1)
  …
}
```

Import `JOBS_DB_MIGRATIONS` into `history.ts` and `EVAL_HISTORY_MIGRATIONS` into `migrations.ts`. NOTE the circular-import risk: `migrations.ts` importing from `history.ts` (which imports `JOBS_DB_MIGRATIONS` from `migrations.ts`). Break it by defining `EVAL_HISTORY_MIGRATIONS` in a leaf module `src/self-improve/history-migrations.ts` that imports NOTHING from `migrations.ts`; `migrations.ts` imports the leaf; `history.ts` imports `JOBS_DB_MIGRATIONS` from `migrations.ts`. (Verify no cycle with `bun run typecheck`.)

- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/self-improve/history.test.ts" "tests/triggers/migrations.test.ts"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/self-improve/history.ts src/self-improve/history-migrations.ts src/triggers/migrations.ts tests/self-improve/history.test.ts tests/triggers/migrations.test.ts`.

```bash
git add src/self-improve/history.ts src/self-improve/history-migrations.ts src/triggers/migrations.ts tests/self-improve/history.test.ts tests/triggers/migrations.test.ts
git commit -m "feat(self-improve): append-only eval_history store in jobs.db (JOBS_DB_MIGRATIONS superset extension)"
```

*Model: Opus (R3 migration-superset is a silent-corruption trap; the circular-import break + append-only invariant need care).*

### Task 11: Increment 3 boundary gate

- [ ] **Step 1:** `bun run check` green. **Step 2:** ledger update.

*Model: controller.*

---

## Increment 4 — D4 noise-band decision (HARD §7.1)

### Task 12: `src/self-improve/regression.ts` — `decideRegression` (ADVERSARIAL-VERIFY §7.1)

**Files:**
- Create: `src/self-improve/regression.ts`
- Test: `tests/self-improve/regression.test.ts`

**Interfaces:**
- Consumes: `EvalResult`, `EvalCaseResult` from `../verified-build/types.ts`.
- Produces:
  ```ts
  export enum RegressionVerdict {
    Pass = 'pass', Regression = 'regression', WithinNoise = 'within-noise', Inconclusive = 'inconclusive',
  }
  export type RegressionInput = {
    baseline: EvalResult;
    fresh: EvalResult;
    hysteresis: number;   // H (AGENT_REEVAL_HYSTERESIS)
    rerunCases: number;   // K (AGENT_REEVAL_RERUN_CASES)
    /** Re-run ONLY these case ids `count` extra times each on the SAME resolved
     *  model + judge; returns per-case pass/fail across the `count` runs. */
    rerun: (caseIds: string[], count: number) => Promise<Record<string, boolean[]>>;
  };
  export type RegressionOutcome = {
    verdict: RegressionVerdict;
    regressedCaseIds: string[]; // confirmed-regressed
    drop: number;               // aggregate drop over confirmed
  };
  export async function decideRegression(input: RegressionInput): Promise<RegressionOutcome>;
  ```
  Algorithm (spec §D4, verbatim):
  1. If `fresh.belowBar` → `{ verdict: Inconclusive, regressedCaseIds: [], drop: 0 }` (NO demote; judge unavailable at eval time).
  2. `regressed = fresh.perCase.filter(c => baseline case passed AND fresh case failed)` (per-case; index by id from `baseline.perCase`). If empty → `{ verdict: Pass, [], 0 }`.
  3. `const rr = await rerun(regressed.map(c=>c.id), K);` A case is CONFIRMED only if it failed on EVERY re-run (`rr[id].every(x => x === false)`). A case that recovered on any re-run is noise → dropped. `confirmed = regressed.filter(c => rr[c.id]?.every(x => !x))`.
  4. `drop = confirmed.length / baseline.total` (equivalently `baseline.passedCount/total − (baseline.passedCount − confirmed.length)/total`).
  5. `real = confirmed.length >= 1 AND drop > H`. `real` → `{ Regression, confirmed ids, drop }`; else → `{ WithinNoise, confirmed ids, drop }` (NO demote).
  - **Boundary:** `drop === H` is NOT a regression (strict `>`); `drop` just over H IS.

- [ ] **Step 1: Write the failing tests** — the §7.1 case battery:

```ts
import { expect, test } from 'bun:test';
import { decideRegression, RegressionVerdict } from '../../src/self-improve/regression.ts';

const ev = (perCase: { id: string; passed: boolean }[], belowBar = false) => ({
  passed: perCase.every((c) => c.passed), total: perCase.length,
  passedCount: perCase.filter((c) => c.passed).length,
  perCase: perCase.map((c) => ({ ...c, detail: '' })), judgeModel: 'J:32b', belowBar,
});
const noRerun = async () => ({});

test('no regressed cases → Pass', async () => {
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }]),
    fresh: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }]),
    hysteresis: 0.15, rerunCases: 2, rerun: noRerun,
  });
  expect(out.verdict).toBe(RegressionVerdict.Pass);
});

test('flip-then-recover is noise → WithinNoise, NOT a demote', async () => {
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }, { id: 'c2', passed: true }]),
    fresh: ev([{ id: 'c0', passed: false }, { id: 'c1', passed: true }, { id: 'c2', passed: true }]),
    hysteresis: 0.15, rerunCases: 2,
    rerun: async () => ({ c0: [false, true] }), // recovered on the 2nd re-run
  });
  expect(out.verdict).toBe(RegressionVerdict.WithinNoise);
  expect(out.regressedCaseIds).toEqual([]);
});

test('unanimous-fail across K re-runs AND drop > H → Regression', async () => {
  const base = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, passed: true }));
  const fresh = base.map((c) => (c.id === 'c0' ? { ...c, passed: false } : c));
  const out = await decideRegression({
    baseline: ev(base), fresh: ev(fresh),
    hysteresis: 0.15, rerunCases: 2,
    rerun: async () => ({ c0: [false, false] }),
  });
  // drop = 1/5 = 0.2 > 0.15
  expect(out.verdict).toBe(RegressionVerdict.Regression);
  expect(out.regressedCaseIds).toEqual(['c0']);
  expect(out.drop).toBeCloseTo(0.2);
});

test('aggregate-flat but ONE case flipped is caught by the per-case predicate', async () => {
  // baseline 2/3 pass; fresh also 2/3 pass but a DIFFERENT case now passes/fails
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }, { id: 'c1', passed: true }, { id: 'c2', passed: false }]),
    fresh: ev([{ id: 'c0', passed: false }, { id: 'c1', passed: true }, { id: 'c2', passed: true }]),
    hysteresis: 0.0, rerunCases: 1, // H=0 so any confirmed regression clears it
    rerun: async () => ({ c0: [false] }),
  });
  expect(out.regressedCaseIds).toEqual(['c0']); // c2 improving does NOT offset c0 regressing
  expect(out.verdict).toBe(RegressionVerdict.Regression);
});

test('drop == H is NOT a regression (strict >)', async () => {
  const base = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, passed: true }));
  const fresh = base.map((c) => (['c0', 'c1', 'c2'].includes(c.id) ? { ...c, passed: false } : c));
  const out = await decideRegression({
    baseline: ev(base), fresh: ev(fresh), hysteresis: 0.15, rerunCases: 1,
    rerun: async () => ({ c0: [false], c1: [false], c2: [false] }),
  });
  // drop = 3/20 = 0.15 === H → within noise
  expect(out.drop).toBeCloseTo(0.15);
  expect(out.verdict).toBe(RegressionVerdict.WithinNoise);
});

test('belowBar judge → Inconclusive, never a demote', async () => {
  const out = await decideRegression({
    baseline: ev([{ id: 'c0', passed: true }]),
    fresh: ev([{ id: 'c0', passed: false }], true),
    hysteresis: 0.15, rerunCases: 2, rerun: noRerun,
  });
  expect(out.verdict).toBe(RegressionVerdict.Inconclusive);
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation** per the algorithm; pure + async only for the injected `rerun`. Early returns for the belowBar / no-regressed / confirmed-empty branches.
- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/self-improve/regression.test.ts"` → PASS (all six).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/self-improve/regression.ts tests/self-improve/regression.test.ts`.

```bash
git add src/self-improve/regression.ts tests/self-improve/regression.test.ts
git commit -m "feat(self-improve): noise-robust regression decision (per-case + bounded unanimous-fail re-run + hysteresis)"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.1).** Reviewer probes: can ANY path demote on a single below-bar run? Is the per-case predicate keyed on the baseline case's own prior verdict (not the aggregate)? Is the hysteresis strictly `>` (drop==H is within-noise)? Does a case that recovers on ANY re-run get dropped from the confirmed set?*

### Task 13: Increment 4 boundary gate

- [ ] `bun run check` green + ledger update. *Model: controller.*

---

## Increment 5 — D5 action + Increment 6 detection (the `Eval` executor)

### Task 14: `src/self-improve/action.ts` — `applyRegressionOutcome` (demote + record + degrade + span)

**Files:**
- Create: `src/self-improve/action.ts`
- Test: `tests/self-improve/action.test.ts`

**Interfaces:**
- Consumes: `RegressionOutcome`, `RegressionVerdict` (Task 12); `EvalHistoryStore`, `EvalHistoryRow` (Task 10); `upsertEntry` from `../verified-build/manifest.ts`; `ManifestEntry`, `VerifiedLevel` from `../verified-build/types.ts`; `recordDegrade` from `../telemetry/spans.ts`; `DegradeKind`, `DegradeEvent` from `../reliability/ledger.ts`; `recordEvalRegression` (Task 3).
- Produces:
  ```ts
  export type ApplyDeps = {
    history: EvalHistoryStore;
    upsertEntry: (dir: string, name: string, entry: ManifestEntry) => void;
    now?: () => number;
  };
  /** Records the eval_history row for a completed re-eval and, on a CONFIRMED
   *  regression, demotes Behaves→Unverified (idempotent), records a
   *  ModelDegraded degrade, and emits eval.regression. Returns whether it demoted. */
  export function applyRegressionOutcome(input: {
    dir: string; name: string; entry: ManifestEntry;
    outcome: RegressionOutcome; result: EvalResult;
    currentModel: string; baselineModel?: string; reason?: string;
  }, deps: ApplyDeps): { demoted: boolean };
  ```
  Behavior:
  - ALWAYS append a row: `history.insert({ id: uuid, artifactId: name, model: currentModel, baselineModel, ts: now(), passed: result.passed, passedCount: result.passedCount, total: result.total, regressed: outcome.verdict === Regression, perCase: result.perCase, judgeModel: result.judgeModel, belowBar: result.belowBar, reason })`.
  - IF `outcome.verdict === RegressionVerdict.Regression`:
    - `upsertEntry(dir, name, { ...entry, verifiedLevel: VerifiedLevel.Unverified, lastEvalPass: false })` — idempotent (already-Unverified → same write).
    - `recordDegrade({ kind: DegradeKind.ModelDegraded, subject: name, reason: 'golden re-eval regression on model swap', from: baselineModel ?? '', to: currentModel })`.
    - `recordEvalRegression({ artifact: name, regressedCount: outcome.regressedCaseIds.length, drop: outcome.drop, from: baselineModel ?? '', to: currentModel })`.
    - return `{ demoted: true }`.
  - ELSE return `{ demoted: false }` (Pass / WithinNoise / Inconclusive — row recorded, NO demote).

- [ ] **Step 1: Write the failing tests** (fake history + fake upsert; `recordDegrade`/`recordEvalRegression` are no-ops without a tracer, so just assert they don't throw):

```ts
test('confirmed Regression demotes Behaves→Unverified and records a regressed row', () => {
  const inserted: EvalHistoryRow[] = []; let upserted: ManifestEntry | undefined;
  const r = applyRegressionOutcome(
    { dir: '/d', name: 'a', entry: behavesEntry,
      outcome: { verdict: RegressionVerdict.Regression, regressedCaseIds: ['c0'], drop: 0.2 },
      result: freshResult, currentModel: 'B:7b', baselineModel: 'A:7b', reason: 'sweep' },
    { history: { insert: (r) => inserted.push(r), listByArtifact: () => [], latestPassing: () => undefined, close: () => {} },
      upsertEntry: (_d, _n, e) => { upserted = e; }, now: () => 5 },
  );
  expect(r.demoted).toBe(true);
  expect(upserted?.verifiedLevel).toBe(VerifiedLevel.Unverified);
  expect(inserted[0]).toMatchObject({ regressed: true, model: 'B:7b', baselineModel: 'A:7b', ts: 5 });
});
test('WithinNoise records a NON-regressed row and does NOT demote', () => { /* verdict WithinNoise → demoted false, upsert NOT called */ });
test('Inconclusive records a row (belowBar true) and does NOT demote', () => { /* … */ });
test('demote is idempotent — an already-Unverified entry is a safe re-write', () => { /* entry.verifiedLevel Unverified → still demoted:true, no throw */ });
```

- [ ] **Step 2–4:** implement + tests pass (`bun run test:file -- "tests/self-improve/action.test.ts"`).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/self-improve/action.ts tests/self-improve/action.test.ts`.

```bash
git add src/self-improve/action.ts tests/self-improve/action.test.ts
git commit -m "feat(self-improve): applyRegressionOutcome — demote+record+degrade+eval.regression on confirmed regression"
```

*Model: Opus.*

### Task 15: `src/self-improve/executor.ts` — `runEval` orchestration (ADVERSARIAL-VERIFY §7.2/§7.5)

**Files:**
- Create: `src/self-improve/executor.ts`
- Test: `tests/self-improve/executor.test.ts`

**Interfaces:**
- Consumes: `reevalArtifact`, `ReevalDeps`, `ReevalSkip` (Task 7); `decideRegression`, `RegressionInput` (Task 12); `applyRegressionOutcome`, `ApplyDeps` (Task 14); `EvalMode` from `../server/jobs/dispatch.ts`; `readManifest` from `../verified-build/manifest.ts`; `aggregateUsage` from `../verified-build/usage.ts`; `verifiedWithFrom` (Task 1); `reevalHysteresis`/`reevalRerunCases`/`reevalEnabled` (Task 3); `JobStore`, `JobStatus`, `JobKind` from `../queue/`; `withEvalReevalSpan` (Task 3); `OrchestratorResult` from `../core/orchestrator.ts`.
- Produces:
  ```ts
  export type RunEvalDeps = ReevalDeps & {
    registryDirs: string[];                       // the generated-artifact registry dirs to scan
    runsRoot: string;                             // for aggregateUsage hot-first ordering
    history: import('./history.ts').EvalHistoryStore;
    upsertEntry: ApplyDeps['upsertEntry'];
    jobStore: Pick<JobStore, 'enqueue' | 'list'>; // for R4 de-dup + per-artifact enqueue
    now?: () => number;
  };
  /** The Eval executor invoked by RunEvalTurn (Task 8). Sweep hot-first,
   *  affected-by-pull coalesce, or a single artifact. Degrade-never-crash:
   *  every per-artifact step is caught + skipped (§7.2). */
  export async function runEval(
    input: { mode: EvalMode; ref?: string; reason?: string; signal?: AbortSignal },
    deps: RunEvalDeps,
  ): Promise<OrchestratorResult>;
  ```
  Behavior:
  - `if (!reevalEnabled() && input.mode !== EvalMode.Artifact) return { kind: 'answer', text: 'reeval disabled' };` (the master switch; manual single-artifact still runs).
  - **`EvalMode.Sweep`**: read every entry across `registryDirs` via `readManifest`; order **hot-first** by `aggregateUsage(runsRoot)` (`{lastUsedMs, useCount}` keyed by name); for each entry: `deps.resolve(entry.need)` for the drift diff; if `entry.verifiedWith === undefined` → **R5 SEED** (run one reeval, record baseline row `regressed:false`, upsert `verifiedWith`, keep `verifiedLevel`, never a regression); else if `resolved.decl.model !== entry.verifiedWith.model` → **drifted** → enqueue a per-artifact `Eval` job (`mode: Artifact, ref: name, reason: 'sweep'`) for isolation/retry granularity, subject to R4 de-dup; else no drift → skip. (Per-artifact enqueue preferred so one artifact's judge-unavailable never aborts the sweep.)
  - **`EvalMode.AffectedByPull`**: single re-resolve pass over ALL entries (coalesced — a mass pull must NOT fan out to N× sweeps, §7.5); the drifted set is enqueued as per-artifact `Eval` jobs (`reason: 'pull:…'`) with the same R4 de-dup.
  - **`EvalMode.Artifact`** (`ref` required): the actual evaluate+decide+act for ONE artifact — find its entry+dir; `reevalArtifact(entry, ref, deps)`; on `skipped(NoGolden)` → return answer "skipped: no golden"; on `skipped(JudgeUnavailable)` → record an inconclusive row (via a minimal `applyRegressionOutcome` Inconclusive path or a direct `history.insert`) + return "inconclusive: judge unavailable" (NO demote); on `evaluated`:
    - drift diff `resolved.decl.model` vs `entry.verifiedWith?.model`; if no baseline → SEED (record baseline row, upsert `verifiedWith`, keep level).
    - else baseline = `history.latestPassing(ref)?.perCase`-derived EvalResult (or the manifest commit-time result); build a `rerun(caseIds, count)` closure that re-runs ONLY those cases on the SAME `resolved.decl` + the SAME judge (reuse `deps.runCase` + `deps.judge` over an `evalCases`-style loop of `count`); `decideRegression({ baseline, fresh: result, hysteresis: reevalHysteresis(), rerunCases: reevalRerunCases(), rerun })`; `applyRegressionOutcome({ dir, name: ref, entry, outcome, result, currentModel: resolved.decl.model, baselineModel: entry.verifiedWith?.model, reason: input.reason }, { history, upsertEntry, now })`.
    - Wrap the whole single-artifact eval in `withEvalReevalSpan({ artifact: ref, mode: input.mode, baselineModel, currentModel }, rec => …)` so the run classifies as `RunKind.Eval` and carries the golden/judge/outcome attrs.
  - **R4 de-dup** (a shared helper `hasPendingEval(jobStore, ref)`): before enqueuing an `Eval` for `ref`, skip if `jobStore.list` shows a Queued/Running `Eval` job whose payload `ref === name`.
  - **§7.2 isolation:** every per-artifact operation in Sweep/AffectedByPull is wrapped in `try/catch` that logs (via `src/log/logger.ts`) + continues — a `resolveModel` throw / missing golden / `JudgeUnavailableError` skips ONLY that artifact. Manifest writes stay atomic read-modify-write (`upsertEntry`); serialize writes (the executor is single-threaded per job).

- [ ] **Step 1: Write the failing tests** (fakes for resolve/runCase/judge/history/jobStore; a fake registry dir with one Behaves entry):

```ts
test('Artifact mode: drift + all-cases-fail-on-every-rerun demotes Behaves→Unverified', async () => { /* resolve returns B≠A; runCase fails c0; rerun c0 unanimous fail; drop>H → upsertEntry Unverified + regressed row */ });
test('Artifact mode: no drift (resolved === verifiedWith.model) still evaluates on manual, no demote when passing', async () => { /* … */ });
test('R5 SEED: an entry with no verifiedWith records a baseline row (regressed:false), sets verifiedWith, keeps verifiedLevel', async () => { /* verifiedWith undefined → after runEval, upserted entry keeps Behaves + has verifiedWith; row regressed:false */ });
test('Sweep enqueues a per-artifact Eval only for DRIFTED artifacts (hot-first)', async () => { /* two entries, one drifted → exactly one enqueue with mode:artifact,ref */ });
test('R4 de-dup: sweep skips enqueue when a Queued/Running Eval for the ref already exists', async () => { /* jobStore.list returns a pending Eval for ref → enqueue NOT called */ });
test('AffectedByPull coalesces: N drifted artifacts enqueue N single jobs in ONE resolve pass (no nested sweep)', async () => { /* … */ });
test('§7.2 isolation: one artifact whose resolve throws does not abort the sweep of the others', async () => { /* 3 entries, middle resolve throws → other 2 still processed */ });
test('inconclusive judge records a row and never demotes', async () => { /* reeval → skipped(JudgeUnavailable) → row belowBar:true, no upsert */ });
```

- [ ] **Step 2–4:** implement + tests pass (`bun run test:file -- "tests/self-improve/executor.test.ts"`).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/self-improve/executor.ts tests/self-improve/executor.test.ts`.

```bash
git add src/self-improve/executor.ts tests/self-improve/executor.test.ts
git commit -m "feat(self-improve): Eval executor — sweep(hot-first)/affected-by-pull(coalesce)/artifact + R4 de-dup + R5 seed + degrade-never-crash"
```

*Model: **Opus implementer + ADVERSARIAL-VERIFY (§7.2 + §7.5).** Reviewer probes: does ONE artifact's throw ever abort the sweep? Can the manifest be left half-written (non-atomic write, or a demote of A racing a seed of B)? Does a mass pull fan out to N× full sweeps (coalesce holds)? Is R4 de-dup keyed on the ref AND the Queued/Running status? Does R5 seed ever record a regression?*

### Task 16: Wire the real `Eval` turn into the daemon + server

**Files:**
- Modify: `src/server/launch-turns.ts` (`createRealRunEvalTurn` → construct `RunEvalDeps` + call `runEval` inside a run scope with the `eval.reeval` root span), `src/cli/daemon.ts` (`buildRealDaemon` `createJobDispatch({…, runEvalTurn: createRealRunEvalTurn(runsRoot)})`), `src/server/main.ts` (its own `createJobDispatch`)
- Test: `tests/self-improve/eval-turn.integration.test.ts` (a fake registry + fake JobStore driven through the dispatch → executor path; asserts a drifted Behaves artifact ends Unverified with a regressed `eval_history` row)

**Interfaces:**
- Consumes: `runEval` (Task 15), `createEvalHistoryStore` (Task 10), the real `resolve`/`runCase`/`judge`/`judgeCandidates` seams the builders already wire (`makeRealBuilderDeps` / the selection runtime). Reuse the daemon's existing `runsRoot`, `AGENT_QUEUE_PATH` for the history store, and the registry dirs (`agents`/`crews`/`workflows` dirs — the same the reuse/archive readers scan).
- Produces: `createRealRunEvalTurn(runsRoot: string): RunEvalTurn` that opens `withRunTelemetry({ runId, root: 'eval.reeval' })` (or the equivalent run-scope that emits the `eval.reeval` root span), builds `RunEvalDeps`, and returns `runEval(...)`'s `OrchestratorResult`.

- [ ] **Step 1: Write the failing integration test** — drive an eval job end-to-end through `createJobDispatch` with a fake registry (one Behaves artifact whose `resolve` now returns a different model + a golden the new model fails on every re-run) → assert the manifest entry is demoted to Unverified and `eval_history` has a `regressed:true` row.
- [ ] **Step 2: Run to verify it fails** → FAIL (turn throws "not wired until Task 16").
- [ ] **Step 3: Implement** `createRealRunEvalTurn`; wire it into `buildRealDaemon` + `server/main.ts`.
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/launch-turns.ts src/cli/daemon.ts src/server/main.ts tests/self-improve/eval-turn.integration.test.ts`.

```bash
git add src/server/launch-turns.ts src/cli/daemon.ts src/server/main.ts tests/self-improve/eval-turn.integration.test.ts
git commit -m "feat(self-improve): wire the real Eval turn (eval.reeval run root) into the daemon + standalone server"
```

*Model: Opus (composition seam covered by integration test, mirroring `createRealRunChatTurn`).*

### Task 17: Repo Cron sweep + JobChain pull trigger defs

**Files:**
- Modify: `triggers/index.ts` (**repo-root** registry — add two `TriggerDef` entries to `TRIGGERS`)
- Test: `tests/triggers/repo-reeval-triggers.test.ts`

**Interfaces:**
- Consumes: `TriggerType`, `TriggerDef`, `JobChainConfig`, `CronConfig` from `../src/triggers/types.ts`; `JobKind`, `JobStatus` from `../src/queue/types.ts`; `EvalMode` from `../src/server/jobs/dispatch.ts`; `reevalSweepCron` from `../src/self-improve/config.ts`.
- Produces two entries in `TRIGGERS` (repo defs; `sync.ts` stamps `origin=Repo`):
  ```ts
  'reeval-sweep': {
    name: 'reeval-sweep',
    type: TriggerType.Cron,
    target: { kind: JobKind.Eval, payload: { mode: EvalMode.Sweep, reason: 'sweep' } },
    config: { schedule: reevalSweepCron() } satisfies CronConfig,
  },
  'reeval-on-pull': {
    name: 'reeval-on-pull',
    type: TriggerType.JobChain,
    target: { kind: JobKind.Eval, payload: { mode: EvalMode.AffectedByPull, reason: 'pull' } },
    config: { onKind: JobKind.Pull, onStatus: JobStatus.Done } satisfies JobChainConfig,
  },
  ```
  **NOTE:** `reevalSweepCron()` reads `AGENT_REEVAL_SWEEP_CRON` at module-load — acceptable because `TRIGGERS` is read at daemon boot by `syncRepoTriggers`. No new `TriggerType`.

- [ ] **Step 1: Write the failing test** — the two defs exist with the right kind/target/config:

```ts
import { TRIGGERS } from '../../triggers/index.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';
import { TriggerType } from '../../src/triggers/types.ts';
test('repo registry defines a Cron sweep + a Pull JobChain, both targeting JobKind.Eval', () => {
  expect(TRIGGERS['reeval-sweep']?.type).toBe(TriggerType.Cron);
  expect(TRIGGERS['reeval-sweep']?.target.kind).toBe(JobKind.Eval);
  expect(TRIGGERS['reeval-on-pull']?.type).toBe(TriggerType.JobChain);
  expect((TRIGGERS['reeval-on-pull']?.config as { onKind: JobKind }).onKind).toBe(JobKind.Pull);
  expect((TRIGGERS['reeval-on-pull']?.config as { onStatus: JobStatus }).onStatus).toBe(JobStatus.Done);
});
```

- [ ] **Step 2–4:** add the entries; test passes (`bun run test:file -- "tests/triggers/repo-reeval-triggers.test.ts"`). The `syncRepoTriggers` path (`src/triggers/sync.ts`, called at `engine.ts:149`) picks them up at boot — no engine change needed.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- triggers/index.ts tests/triggers/repo-reeval-triggers.test.ts`.

```bash
git add triggers/index.ts tests/triggers/repo-reeval-triggers.test.ts
git commit -m "feat(triggers): repo Cron sweep + model.pull JobChain trigger defs → Eval (no new TriggerType)"
```

*Model: Sonnet.*

### Task 18: Increment 5+6 boundary gate + detection integration

- [ ] **Step 1: Integration test** — Cron trigger fires an `Eval(sweep)` job on a scheduler tick (drive `scheduler.tick()` with fake time); the pull JobChain fires an `Eval(affected-by-pull)` job on a Pull job's `Done` settle (drive `handleJobSettled(pullJob, JobStatus.Done)`). Assert both enqueue an `Eval` job onto the fake `jobStore`. (Reuse the trigger engine test harness in `tests/triggers/`.)
- [ ] **Step 2:** `bun run check` green.
- [ ] **Step 3:** ledger update + the §7.1/§7.2 ADVERSARIAL-VERIFY verdicts.

*Model: Opus (detection integration) + controller (gate).*

---

## Increment 7 — D7 surfaces (API + web + CLI)

### Task 19: Isomorphic evals contracts + parity

**Files:**
- Create: `src/contracts/evals.ts` (re-exported by `src/contracts/index.ts`'s `export *`)
- Test: `tests/contracts/evals-contracts.test.ts`

**Interfaces:**
- Consumes: `z` from `zod`; `VerifiedLevel` from `./enums.ts`.
- Produces (all Zod + inferred types):
  - `EvalCaseResultDtoSchema`: `{ id: z.string(), passed: z.boolean(), detail: z.string() }`.
  - `EvalHistoryDtoSchema` / `EvalHistoryDTO`: mirrors `EvalHistoryRow` on the wire (`id`, `artifactId`, `model`, `baselineModel: z.string().optional()`, `ts`, `passed`, `passedCount`, `total`, `regressed`, `perCase: z.array(EvalCaseResultDtoSchema)`, `judgeModel`, `belowBar`, `reason: z.string().optional()`).
  - `EvalHealthDtoSchema` / `EvalHealthDTO`: per-artifact rollup — `{ artifact: z.string(), verifiedLevel: z.enum(VerifiedLevel), baselineModel: z.string().optional(), currentModel: z.string().optional(), latest: EvalHistoryDtoSchema.optional(), regressed: z.boolean(), thumbsDown: z.number() }` (the `chat.feedback` 👎 count).
  - `EvalHealthListResponseSchema`: `{ items: z.array(EvalHealthDtoSchema) }`.
  - `EvalHistoryListResponseSchema`: `{ items: z.array(EvalHistoryDtoSchema) }`.
  - `EvalReevalRequestSchema`: `{ mode: z.enum(['artifact', 'all']), ref: z.string().min(1).optional() }.refine(p => p.mode !== 'artifact' || !!p.ref)`; `EvalReevalResponseSchema`: `{ enqueued: z.number(), jobIds: z.array(z.string()) }`.

- [ ] **Step 1: Write the failing test** — schemas parse a valid health row + reject a bad reeval request; `perCase` round-trips:

```ts
test('EvalHealthDtoSchema parses a rollup with a latest history row', () => { /* … */ });
test('EvalReevalRequestSchema requires ref when mode=artifact', () => {
  expect(() => EvalReevalRequestSchema.parse({ mode: 'artifact' })).toThrow();
  expect(EvalReevalRequestSchema.parse({ mode: 'all' })).toMatchObject({ mode: 'all' });
});
```

- [ ] **Step 2–4:** implement; add `export * from './evals.ts';` to `src/contracts/index.ts`; tests pass.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/contracts/evals.ts src/contracts/index.ts tests/contracts/evals-contracts.test.ts`.

```bash
git add src/contracts/evals.ts src/contracts/index.ts tests/contracts/evals-contracts.test.ts
git commit -m "feat(contracts): isomorphic Eval health/history DTOs + reeval request/response"
```

*Model: Sonnet.*

### Task 20: Evals API routes + `chat.feedback` health read

**Files:**
- Create: `src/server/evals/{health,history,reeval,feedback-read}.ts`
- Modify: `src/server/app.ts` (register `GET /api/evals`, `GET /api/evals/:artifact`, `POST /api/evals/reeval`; the mutating POST behind `requireTrustedLocal`)
- Test: `tests/server/evals-routes.test.ts`

**Interfaces:**
- Consumes: `createEvalHistoryStore` (Task 10); `readManifest` (registry dirs) for the `verifiedWith` join; the `chat.feedback` span read (spans are persisted per-run — read the 👎 count per artifact from the run journals' `chat.feedback` spans, mirroring how `readDegrades` reads `degradation.jsonl`; if no per-artifact linkage exists yet, aggregate 👎 across runs and attach `thumbsDown: 0` as a safe default and note the follow-up); `JobStore.enqueue` for the reeval POST; `requireTrustedLocal` (the Slice-24/25b privileged-config guard reused by A2A); `EvalHealthListResponseSchema`/`EvalHistoryListResponseSchema`/`EvalReevalRequestSchema`/`EvalReevalResponseSchema`.
- Produces:
  - `GET /api/evals` → `EvalHealthListResponse` (per-artifact latest + baseline-vs-current, `regressed` flagged, `thumbsDown`).
  - `GET /api/evals/:artifact` → `EvalHistoryListResponse` (full `listByArtifact`, ts DESC — the trend view).
  - `POST /api/evals/reeval` (trusted-local) → enqueue `Eval` job(s): `mode:'artifact'` enqueues one `{ mode: EvalMode.Artifact, ref, reason: 'manual' }`; `mode:'all'` enqueues one `{ mode: EvalMode.Sweep, reason: 'manual' }`. Returns `{ enqueued, jobIds }`.

- [ ] **Step 1: Write the failing tests** — `GET /api/evals` shape; `POST /api/evals/reeval` requires trusted-local (401/403 without); a valid POST enqueues an `Eval` job:

```ts
test('GET /api/evals returns per-artifact health rollups', async () => { /* seed eval_history + manifest, GET → items[] */ });
test('POST /api/evals/reeval is gated by requireTrustedLocal', async () => { /* untrusted → 403 */ });
test('POST /api/evals/reeval {mode:artifact,ref} enqueues one Eval job', async () => { /* enqueue spy called with kind Eval, payload mode artifact */ });
```

- [ ] **Step 2–4:** implement the handlers + register the routes; tests pass (`bun run test:file -- "tests/server/evals-routes.test.ts"`).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/server/evals/*.ts src/server/app.ts tests/server/evals-routes.test.ts`.

```bash
git add src/server/evals/ src/server/app.ts tests/server/evals-routes.test.ts
git commit -m "feat(server): GET /api/evals + /api/evals/:artifact + POST /api/evals/reeval (trusted-local) + chat.feedback health read"
```

*Model: Opus (the mutating route's trusted-local gate is security-sensitive; the feedback read must not leak message text).*

### Task 21: Ops "Evals/Health" tab + `use-evals.ts` + tab registration (R6)

**Files:**
- Create: `web/src/features/ops/evals-tab.tsx`, `web/src/features/ops/use-evals.ts`
- Modify: `web/src/features/ops/index.tsx` (`OpsTab` enum + `TABS` array + the panel conditional), `web/src/app/router.tsx` (`OpsSearch` union at line 56 + `validateSearch` at 63-70)
- Test: `web/src/features/ops/evals-tab.test.tsx`, `web/src/features/ops/use-evals.test.tsx`

**Interfaces:**
- Consumes: `apiFetch(path, { schema })` from `../../shared/contract/client.ts` (no query lib — mirror `use-jobs.ts:22`); `EvalHealthListResponseSchema`, `EvalHistoryListResponseSchema`, `EvalReevalRequestSchema` from `@contracts`.
- Produces:
  - `use-evals.ts`: `useEvals()` (`apiFetch('/evals', { schema: EvalHealthListResponseSchema })` + `refresh`), `useEvalHistory(artifact)` (`apiFetch('/evals/:artifact')`), `useReeval()` (POST `/evals/reeval`, optimistic, mirroring `use-job-actions`).
  - `evals-tab.tsx`: per artifact×model — baseline `verifiedWith` vs current result, a per-case grid with regressed cells highlighted, a "re-eval now" button, a small trend from `eval_history`, and the 👎 count. `data-testid="ops-evals"`.
  - `index.tsx`: `OpsTab.Evals = 'evals'`; `TABS` gains `{ id: OpsTab.Evals, label: 'Evals' }` (beside Federation); the panel conditional gains `{t.id === OpsTab.Evals && <EvalsTab />}`.
  - `router.tsx`: `OpsSearch.tab` union gains `'evals'`; `validateSearch` gains `search.tab === 'evals'`.

- [ ] **Step 1: Write the failing tests** — the tab renders health rows + a re-eval button; `useEvals` fetches; the tab is registered (`data-testid="ops-tab-evals"` present in the shell):

```tsx
test('EvalsTab renders per-artifact health with regressed cells highlighted', () => { /* mock apiFetch → render → assert rows + a [data-regressed] cell */ });
test('the re-eval-now button posts to /api/evals/reeval', () => { /* click → apiFetch POST spy called with mode:artifact,ref */ });
test('Ops shell registers the Evals tab beside Federation', () => { /* render OpsArea → getByTestId('ops-tab-evals') */ });
```

- [ ] **Step 2–4:** implement (mirror `federation-tab.tsx` + `use-a2a-config.ts` structure exactly); tests pass (`cd web && bun run test`).
- [ ] **Step 5: Gate + commit** — `cd web && bun run typecheck && bun run test` (web gate); then `bun run lint:file -- web/src/features/ops/evals-tab.tsx web/src/features/ops/use-evals.ts web/src/features/ops/index.tsx web/src/app/router.tsx`.

```bash
git add web/src/features/ops/evals-tab.tsx web/src/features/ops/use-evals.ts web/src/features/ops/index.tsx web/src/app/router.tsx web/src/features/ops/evals-tab.test.tsx web/src/features/ops/use-evals.test.tsx
git commit -m "feat(web): Ops Evals/Health tab + use-evals hook + tab registration"
```

*Model: Sonnet (mirrors the shipped Federation tab wiring).*

### Task 22: `reeval` CLI + package.json script

**Files:**
- Create: `src/cli/reeval.ts`
- Modify: `package.json` (add `"reeval": "bun run src/cli/reeval.ts"`)
- Test: `tests/cli/reeval.test.ts`

**Interfaces:**
- Consumes: `JobStore.enqueue` (through injected deps mirroring the daemon CLI's `buildRealDeps` shape); `JobKind`, `EvalMode`; `parseArgs` idiom used by other `src/cli/*.ts`.
- Produces: `runReevalCli(argv, deps): Promise<void>` — `--all` → enqueue one `Eval(Sweep, reason:'manual')`; `--agent <name>` → enqueue one `Eval(Artifact, ref:name, reason:'manual')`; prints the enqueued job id(s) via injected `print`. Fail-closed help on no args.

- [ ] **Step 1: Write the failing tests** — `--agent x` enqueues an Artifact eval; `--all` enqueues a Sweep; bad args print usage:

```ts
test('reeval --agent file_qa enqueues an Eval(artifact, ref)', async () => { /* fake enqueue spy */ });
test('reeval --all enqueues an Eval(sweep)', async () => { /* … */ });
```

- [ ] **Step 2–4:** implement; tests pass (`bun run test:file -- "tests/cli/reeval.test.ts"`).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/cli/reeval.ts tests/cli/reeval.test.ts`.

```bash
git add src/cli/reeval.ts package.json tests/cli/reeval.test.ts
git commit -m "feat(cli): reeval [--all | --agent <name>] enqueues Eval jobs through JobStore"
```

*Model: Sonnet.*

### Task 23: Increment 7 boundary gate

- [ ] `bun run check` (incl. `check:web`) green + ledger update. *Model: controller.*

---

## Increment 8 — Docs + ledger + live-verify + land

### Task 24: All four living surfaces + Artifact regen note

**Files:**
- Modify: `docs/architecture.md` (EXPAND the Task-3 stub into the full § `src/self-improve/` writeup + the verified-build/queue/triggers/telemetry/Ops-console deltas + module map + data-flow lane); `README.md` (Status line + slice table row "Slice 32 ✅ Done" + a self-improvement feature paragraph + "Next" line); `docs/ROADMAP.md` (flip the continuous-re-eval capability marker 🟡/❌ → ✅ shipped, Slice 32, in the gap table, the phase table, and the recommended sequence)
- Test: `bun run docs:check`

- [ ] **Step 1:** Expand `docs/architecture.md` per the Standing notes (audit each claim against the diff — the final review checks truth, not just presence).
- [ ] **Step 2:** Update `README.md` + `docs/ROADMAP.md`.
- [ ] **Step 3:** `bun run docs:check` → PASS.
- [ ] **Step 4: Regenerate the interactive architecture-snapshot Artifact** — new `self-improve` node + edges to verified-build / Queue / Triggers / Telemetry / Ops-console; footer slice count → "32" + the real test count (`bun run test 2>&1 | tail` for the count). (Tooling can only remind; regenerating is on you — see the `reference-artifact-regen-mechanics` memory.)
- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md README.md docs/ROADMAP.md
git commit -m "docs(slice-32): self-improve subsystem writeup + README status/slice-row + ROADMAP flip ✅"
```

*Model: Sonnet (docs) — but the FINAL review audits accuracy (Opus/Fable capstone).*

### Task 25: Live-verify gate (§10) + SDD ledger closeout + land

**Files:** none (verification + ledger + merge)

- [ ] **Step 1: Single-box live-verify** (Mac Mini M4 Pro, real Ollama — no second machine). Rebuild web + restart the daemon first (the daemon serves the prebuilt `web/dist`; a stale bundle tests the old UI — see the `reference-daemon-serves-web-dist` memory):
  1. **Seed** — build a small agent through the real gate at model A so it commits **Behaves** with a persisted golden + `verifiedWith.model = A`.
  2. **Swap** — pull/select a different model B such that the agent's requirement now resolves to B (confirm via the drift diff / `agent.model.select` span A→B), where B underperforms on the golden.
  3. **Sweep** — `bun run reeval --agent <name>` (or trigger the Cron sweep) → observe the `Eval` run in the Runs waterfall (classified `RunKind.Eval`), per-case verdicts, bounded re-runs of the failing cases, and — if the drop clears the hysteresis margin — an auto-demote to Unverified in the Evals/Health tab + a `ModelDegraded` degrade on the eval run.
  4. **Pull hook** — run a `model.pull`; confirm the JobChain fires an `Eval` job on the pull job's `Done` settle and re-evals the affected artifact.
  5. **No-op path** — a swap to an equally-good model records a passing/within-noise row and does NOT demote.
  6. **Recovery** — rebuild the artifact (full gate) → `verifiedLevel` back to Behaves, `verifiedWith` re-seeded at the new model.
  - Throughout: `eval.*` spans present + secret-free; `eval_history` rows append-only; the manifest never left half-written.
- [ ] **Step 2:** Record the live-verify outcomes + all task/review/fix/landing entries in `.superpowers/sdd/progress.md` (the SDD ledger — hard-lined; the pre-push slice-landing gate blocks landing on main unless README + ROADMAP + ledger are all updated in the same push).
- [ ] **Step 3: Whole-branch capstone review** — Fable (weekly-Fable headroom permitting) or Opus ultracode over the full diff: docs accuracy vs diff, §7.1/§7.2 hard-part correctness, no secret leakage in `eval.*` spans, R3 migration-superset integrity.
- [ ] **Step 4: Land** — merge to `main` (the pre-push gate enforces the 4-surface + ledger update). Confirm `bun run check` green on `main`.

*Model: controller + Fable/Opus (capstone).*

---

## Self-Review

**1. Spec coverage:**
- D1 baseline → Tasks 1, 2 (type/field/version + capture). ✅
- D3 kind + engine → Tasks 5 (kind/parity/deriveRunKind), 6 (shared binding), 7 (reeval), 8 (dispatch/turn seam). ✅
- D6 store → Task 10 (eval_history + superset, R3). ✅
- D4 decision → Task 12 (regression, §7.1). ✅
- D5 action → Task 14 (applyRegressionOutcome). ✅
- D2 detection → Tasks 15 (executor: sweep/pull/artifact, R4, R5, §7.2/§7.5), 16 (turn wiring), 17 (repo trigger defs), 18 (detection integration). ✅
- D7 surfaces → Tasks 19 (contracts), 20 (API + chat.feedback read), 21 (web tab + R6 registration), 22 (CLI). ✅
- Config knobs (§11), eval ATTR keys + spans, chat.feedback comment fix → Task 3. ✅
- Docs + ledger + live-verify + land (§8/§9/§10) → Tasks 24, 25. ✅
- R1 (new field not modelTier) → Task 1. R2 (best-effort quant) → Task 1 `parseQuant`. R3 (superset) → Task 10. R4 (de-dup) → Task 15. R5 (seed) → Task 15. R6 (tab registration file) → Task 21 (pinned `web/src/features/ops/index.tsx` + `router.tsx`). ✅

**2. Placeholder scan:** Web (Task 21), API (Task 20), and integration (Tasks 16, 18) tasks use `/* … */` sketches for a few test bodies — deliberate, because the exact fake wiring depends on the shipped Federation/jobs harness the implementer will mirror; every such test names the exact assertion and the fixture it needs. All engine tasks (1, 3, 6, 7, 10, 12, 14, 15) carry full runnable code + full test bodies. No "TBD"/"handle edge cases"/"similar to Task N".

**3. Type consistency:** `VerifiedWith` (Task 1) ↔ `verifiedWithFrom` (Tasks 1, 15) ↔ `ManifestEntry.verifiedWith` (Tasks 1, 2, 15). `EvalMode` (Task 8) used in Tasks 15, 17, 20, 22. `ReevalOutcome`/`ReevalSkip` (Task 7) consumed by Task 15. `RegressionInput`/`RegressionOutcome`/`RegressionVerdict` (Task 12) consumed by Tasks 14, 15. `EvalHistoryRow`/`EvalHistoryStore` (Task 10) consumed by Tasks 14, 15, 20. `RunEvalTurn` (Task 8) implemented Task 16. `runGoldenEval`/`GoldenEvalBinding` (Task 6) consumed by Task 7. `EVAL_HISTORY_MIGRATIONS` leaf module (Task 10) breaks the `migrations.ts`↔`history.ts` cycle. Consistent throughout.
