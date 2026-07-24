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

