### Task 1: Extend `ArtifactKind` with the classification members

**Files:**
- Modify: `src/contracts/enums.ts`
- Test: `tests/contracts/enums.test.ts` (extend), `tests/contracts/dto.test.ts` (already parses `ArtifactKind`; no change expected but re-run)

**Interfaces:**
- Produces: `ArtifactKind` gains `Result='result'`, `Resource='resource'`, `Unverified='unverified'`, `Failed='failed'`, `Error='error'`, `Media='media'`. Pure additions — existing members (`Answer/Gap/Spans/Degradation/Other`) unchanged.

- [ ] **Step 1: Write the failing test** — append to `tests/contracts/enums.test.ts`:

```ts
import { ArtifactKind } from '../../src/contracts/enums.ts';

test('ArtifactKind carries the Phase-3 classification members (additive)', () => {
  expect(Object.values(ArtifactKind) as string[]).toEqual([
    'answer',
    'gap',
    'spans',
    'degradation',
    'other',
    'result',
    'resource',
    'unverified',
    'failed',
    'error',
    'media',
  ]);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/contracts/enums.test.ts` → FAIL (new values absent).

- [ ] **Step 3: Minimal impl** — in `src/contracts/enums.ts`, replace the `ArtifactKind` body (keep the existing five, append six):

```ts
/** Run-artifact classification (mapper-side readdir+classify; Slice 30b Phase 3). */
export enum ArtifactKind {
  Answer = 'answer',
  Gap = 'gap',
  Spans = 'spans',
  Degradation = 'degradation',
  Other = 'other',
  Result = 'result',
  Resource = 'resource',
  Unverified = 'unverified',
  Failed = 'failed',
  Error = 'error',
  Media = 'media',
}
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/contracts` → PASS (enums + dto + isomorphic all green; the enum is only appended to).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/contracts/enums.ts" "tests/contracts/enums.test.ts"
git add src/contracts/enums.ts tests/contracts/enums.test.ts
git commit -m "feat(contracts): extend ArtifactKind for run-artifact classification (Slice 30b Phase 3)"
```

---

