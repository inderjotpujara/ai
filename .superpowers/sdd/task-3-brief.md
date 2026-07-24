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

