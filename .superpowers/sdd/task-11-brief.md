### Task 11: Migrate verified-build withWallClock + runtime probe literals

**Files:**
- Modify: `src/verified-build/dry-run.ts` (re-export `withWallClock` from reliability)
- Modify: `src/runtime/ollama.ts` + `src/runtime/mlx-server.ts` (probe literals → `probeTimeoutMs()`)
- Test: existing `tests/verified-build/*` + `tests/runtime/*` (or `tests/cli/select-runtime*`) still pass; add `tests/reliability/timeout-reexport.test.ts`.

**Interfaces:**
- Consumes: `withWallClock` (timeout.ts), `probeTimeoutMs` (config.ts).

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/timeout-reexport.test.ts
import { describe, expect, it } from 'bun:test';
import { withWallClock as fromReliability } from '../../src/reliability/timeout.ts';
import { withWallClock as fromDryRun } from '../../src/verified-build/dry-run.ts';

describe('withWallClock re-export', () => {
  it('verified-build re-exports the reliability implementation', () => {
    expect(fromDryRun).toBe(fromReliability);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/timeout-reexport.test.ts`
Expected: FAIL — the two references are different functions (dry-run defines its own).

- [ ] **Step 3: Migrate**

In `src/verified-build/dry-run.ts`: delete the local `withWallClock` body; add `export { withWallClock } from '../reliability/timeout.ts';`. (Note: reliability's version rejects `Error('timeout')` whereas dry-run's said `'dry-run timeout'`; update any dry-run test asserting the exact message to match `'timeout'`, or keep a thin wrapper `export const withWallClock = <T>(ms:number, fn:()=>Promise<T>) => reliabilityWithWallClock(ms, fn)` — prefer the plain re-export and fix the message assertion.)

In `src/runtime/ollama.ts`: replace `AbortSignal.timeout(1500)` with `AbortSignal.timeout(probeTimeoutMs())` (import from `../reliability/config.ts`).

In `src/runtime/mlx-server.ts`: replace both `AbortSignal.timeout(1500)` occurrences with `AbortSignal.timeout(probeTimeoutMs())`.

- [ ] **Step 4: Run tests to verify no regression**

Run: `bun test tests/reliability/timeout-reexport.test.ts tests/verified-build/ tests/runtime/ tests/cli/`
Expected: PASS (fix any exact-message assertion for the old `'dry-run timeout'` string).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/verified-build/dry-run.ts" "src/runtime/ollama.ts" "src/runtime/mlx-server.ts"
git add src/verified-build/dry-run.ts src/runtime/ tests/
git commit -m "refactor: migrate withWallClock + probe timeouts onto reliability module"
```

---

