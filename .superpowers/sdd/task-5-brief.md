### Task 5: Wan checkpoint from opts.model

**Files:**
- Modify: `src/media/generate/comfy-lane.ts:34-87` (`buildWanWorkflow`)
- Test: extend `tests/media/*` — add `tests/media/wan-checkpoint.test.ts`

**Interfaces:**
- Consumes: `wanComfyStrategy` (its internal `buildWanWorkflow` is not exported — test through the public seam by exporting `buildWanWorkflow`).
- Produces: `buildWanWorkflow` exported; adds a `CheckpointLoaderSimple` node whose `ckpt_name` is `opts.model` when set.

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/wan-checkpoint.test.ts
import { describe, expect, test } from 'bun:test';
import { buildWanWorkflow } from '../../src/media/generate/comfy-lane.ts';

describe('buildWanWorkflow checkpoint', () => {
  test('adds a checkpoint loader from opts.model when set', () => {
    const wf = buildWanWorkflow('a dog running', {
      model: 'city96/LTX-Video-0.9.6-distilled-gguf',
    }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const loader = Object.values(wf).find(
      (n) => n.class_type === 'CheckpointLoaderSimple',
    );
    expect(loader?.inputs.ckpt_name).toBe('city96/LTX-Video-0.9.6-distilled-gguf');
  });

  test('omits the checkpoint loader when opts.model is unset', () => {
    const wf = buildWanWorkflow('a dog running', {}) as Record<
      string,
      { class_type: string }
    >;
    const hasLoader = Object.values(wf).some(
      (n) => n.class_type === 'CheckpointLoaderSimple',
    );
    expect(hasLoader).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/wan-checkpoint.test.ts"`
Expected: FAIL — `buildWanWorkflow` not exported / no loader node.

- [ ] **Step 3: Write minimal implementation**

In `src/media/generate/comfy-lane.ts`: change `function buildWanWorkflow(` to `export function buildWanWorkflow(`. Before the `return workflow;` line, add:

```ts
  // Checkpoint from the gen-fit-selected repo (opts.model). Shape-only until
  // live-verify against a real ComfyUI export corrects the exact node wiring.
  if (opts.model) {
    workflow['10'] = {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: opts.model },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/wan-checkpoint.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/comfy-lane.ts tests/media/wan-checkpoint.test.ts
git commit -m "feat(media): Wan workflow takes checkpoint from opts.model (gen-fit injection)"
```

---

