### Task 4: Video model plumb (LTX `--model` from opts.model)

**Files:**
- Modify: `src/media/generate/video-mlx.ts:18-49` (`ltxStrategy.buildOneShot`)
- Test: `tests/media/video-model-plumb.test.ts`

**Interfaces:**
- Consumes: `ltxStrategy` from `src/media/generate/video-mlx.ts`; `GenOpts` from `src/media/generate/adapter.ts`.
- Produces: `ltxStrategy.buildOneShot` now emits `--model <repo>` when `opts.model` is set (absent otherwise, preserving today's baked-repo behavior). Live-verify confirms the exact flag name against the real CLI (like the earlier `--num-frames` fix).

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/video-model-plumb.test.ts
import { describe, expect, test } from 'bun:test';
import { ltxStrategy } from '../../src/media/generate/video-mlx.ts';

describe('ltxStrategy --model plumb', () => {
  test('emits --model when opts.model is set', () => {
    const { args } = ltxStrategy.buildOneShot!('a cat', '/tmp/out.mp4', {
      model: 'dgrauet/ltx-2.3-mlx-q4',
    });
    const i = args.indexOf('--model');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('dgrauet/ltx-2.3-mlx-q4');
  });

  test('omits --model when opts.model is unset (baked-repo behavior)', () => {
    const { args } = ltxStrategy.buildOneShot!('a cat', '/tmp/out.mp4', {});
    expect(args).not.toContain('--model');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/video-model-plumb.test.ts"`
Expected: FAIL — first test fails (no `--model` in args).

- [ ] **Step 3: Write minimal implementation**

In `src/media/generate/video-mlx.ts`, inside `buildOneShot`'s returned `args` array, add the model flag conditionally right after `'--prompt', prompt,` (mirroring the existing `opts.image` conditional spread):

```ts
      args: [
        '--prompt',
        prompt,
        ...(opts.model ? ['--model', opts.model] : []),
        '--pipeline',
        pipeline,
        ...(opts.image ? ['--image', opts.image] : []),
        '--num-frames',
        String(frames),
        '--width',
        String(width),
        '--height',
        String(height),
        ...(opts.steps ? ['--steps', String(opts.steps)] : []),
        '--output-path',
        outPath,
      ],
```

Also update the doc-comment above `ltxStrategy` to note: `model: opts.model adds --model <repo> (from the gen-fit selector); omitted → the mlx-video default repo.`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/video-model-plumb.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/video-mlx.ts tests/media/video-model-plumb.test.ts
git commit -m "feat(media): ltxStrategy emits --model from opts.model (gen-fit injection)"
```

---

