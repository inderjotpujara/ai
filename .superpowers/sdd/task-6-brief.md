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

