### Task 6: runGenJob clears model on cross-engine degrade

**Files:**
- Modify: `src/media/generate/adapter.ts:507-554` (`runGenJob`)
- Test: `tests/media/gen-job-degrade-model.test.ts`

**Interfaces:**
- Consumes: `runGenJob`, `GenStrategy` (existing).
- Produces: on a degrade to a different-`engine` fallback, `runGenJob` passes `{ ...opts, model: undefined }` so the fallback strategy uses its own default repo (a repo is engine-specific and must not leak across engines). Same-engine degrades keep `opts.model`.

Note: the `GenStrategy` type has no `engine` field. Use `execMode` difference as the proxy is insufficient (both video strategies differ by execMode but also by engine/repo). Instead, ALWAYS clear `opts.model` when running the fallback — the fallback is always a *different* strategy with its own default. Both degrade branches (`runServerJob(fallback,...)` and `runOneShotJob(fallback,...)`) get `{ ...opts, model: undefined }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/gen-job-degrade-model.test.ts
import { describe, expect, test } from 'bun:test';
import { runGenJob } from '../../src/media/generate/adapter.ts';
import type { GenStrategy } from '../../src/media/generate/adapter.ts';
import { ExecMode, MediaKind } from '../../src/media/types.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('runGenJob cross-engine degrade drops the model repo', () => {
  test('fallback strategy is invoked without opts.model', async () => {
    let fallbackModel: string | undefined = 'UNSET';
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
    const primary: GenStrategy = {
      kind: MediaKind.Video,
      execMode: ExecMode.OneShot,
      buildOneShot: () => ({ cmd: 'definitely-not-installed-xyz', args: [] }),
    };
    const fallback: GenStrategy = {
      kind: MediaKind.Video,
      execMode: ExecMode.Server,
      serverSubmit: async (_p, opts) => {
        fallbackModel = opts.model;
        return {
          poll: async () => ({ fraction: 1 }),
          result: async () => '/tmp/never.mp4', // putFile will fail; we only assert the model
        };
      },
    };
    const job = runGenJob(primary, 'a cat', store, 'video/mp4', { model: 'mlx/repo' }, {
      fallback,
      which: () => null, // force the "primary binary missing" degrade
    });
    await job.result().catch(() => {}); // result may reject on the fake path; irrelevant
    expect(fallbackModel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/gen-job-degrade-model.test.ts"`
Expected: FAIL — `fallbackModel` is `'mlx/repo'` (opts.model leaked into the fallback).

- [ ] **Step 3: Write minimal implementation**

In `src/media/generate/adapter.ts`, in `runGenJob`, change the two fallback invocations to strip the model repo:

```ts
    if (fallback) {
      recordExecModeDegrade(
        deps,
        ExecMode.OneShot,
        ExecMode.Server,
        primary.kind,
        `engine binary "${cmd}" not found on PATH`,
      );
      return runServerJob(fallback, prompt, store, mediaType, { ...opts, model: undefined }, deps);
    }
```

and

```ts
  if (fallback) {
    recordExecModeDegrade(
      deps,
      ExecMode.Server,
      ExecMode.OneShot,
      primary.kind,
      'server engine unreachable',
    );
    return runOneShotJob(fallback, prompt, store, mediaType, { ...opts, model: undefined }, deps);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/gen-job-degrade-model.test.ts"`
Expected: PASS. Also re-run the existing adapter tests: `bun run test:file -- "tests/media/*adapter*"` — Expected: still PASS (same-strategy non-degrade paths unchanged).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/adapter.ts tests/media/gen-job-degrade-model.test.ts
git commit -m "fix(media): runGenJob drops engine-specific model repo when degrading to a fallback"
```

---

