### Task 2: Gen-fit telemetry

**Files:**
- Modify: `src/telemetry/spans.ts` (ATTR block near line 129–135; add `recordGenFit` near `recordDegrade` ~line 297)
- Test: `tests/telemetry/gen-fit-span.test.ts`

**Interfaces:**
- Consumes: `trace.getActiveSpan()` (already imported in spans.ts), the `ATTR` object.
- Produces: `ATTR.GEN_FIT_CHOSEN/GEN_FIT_FITS/GEN_FIT_BUDGET_BYTES/GEN_FIT_MODEL_BYTES/GEN_FIT_CANDIDATES`; `recordGenFit(info)` (see locked interface).

- [ ] **Step 1: Write the failing test**

```ts
// tests/telemetry/gen-fit-span.test.ts
import { describe, expect, test } from 'bun:test';
import { recordGenFit } from '../../src/telemetry/spans.ts';

describe('recordGenFit', () => {
  test('is a no-op with no active span (does not throw)', () => {
    expect(() =>
      recordGenFit({
        kind: 'video',
        chosen: 'dgrauet/ltx-2.3-mlx-q4',
        fits: true,
        budgetBytes: 30_000_000_000,
        modelBytes: 14_520_000_000,
        candidates: 3,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/telemetry/gen-fit-span.test.ts"`
Expected: FAIL — `recordGenFit` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to the `ATTR` object in `src/telemetry/spans.ts` (right after `MEDIA_GENERATE_OUTCOME`):

```ts
  GEN_FIT_CHOSEN: 'media.gen_fit.chosen',
  GEN_FIT_FITS: 'media.gen_fit.fits',
  GEN_FIT_BUDGET_BYTES: 'media.gen_fit.budget_bytes',
  GEN_FIT_MODEL_BYTES: 'media.gen_fit.model_bytes',
  GEN_FIT_CANDIDATES: 'media.gen_fit.candidates',
```

Add near `recordDegrade` (mirrors its active-span-event shape):

```ts
/** Record the gen-fit selection decision on the active span (mirrors
 *  recordDegrade). No-op when there is no active span. */
export function recordGenFit(info: {
  kind: string;
  chosen?: string;
  fits: boolean;
  budgetBytes: number;
  modelBytes?: number;
  candidates: number;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('media.gen_fit', {
    [ATTR.MEDIA_GENERATE_KIND]: info.kind,
    [ATTR.GEN_FIT_FITS]: info.fits,
    [ATTR.GEN_FIT_BUDGET_BYTES]: info.budgetBytes,
    [ATTR.GEN_FIT_CANDIDATES]: info.candidates,
    ...(info.chosen ? { [ATTR.GEN_FIT_CHOSEN]: info.chosen } : {}),
    ...(info.modelBytes !== undefined
      ? { [ATTR.GEN_FIT_MODEL_BYTES]: info.modelBytes }
      : {}),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/telemetry/gen-fit-span.test.ts"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/telemetry/spans.ts tests/telemetry/gen-fit-span.test.ts
git commit -m "feat(telemetry): recordGenFit + gen.fit.* attrs for gen-fit decisions"
```

---

