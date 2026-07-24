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

