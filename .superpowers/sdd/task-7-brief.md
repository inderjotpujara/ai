### Task 7: Wire selector + runGenJob into createGenerateTools

**Files:**
- Modify: `src/media/generate/tools.ts` (whole `createGenerateTools`)
- Test: `tests/media/gen-tools-wiring.test.ts`

**Interfaces:**
- Consumes: `selectGenModel` (Task 3); `runGenJob` (Task 6); `mfluxStrategy`/`kokoroStrategy`/`ltxStrategy`/`wanComfyStrategy`; `GenEngine`/`GenModelCandidate` (Task 1).
- Produces: the three tools now (a) select a fit model → set `opts.model`, (b) run via `runGenJob` with the strategy matching the candidate's engine, (c) video passes `fallback` (the other video strategy) + a `serverReachable` probe, (d) return a graceful message when `selectGenModel` returns `undefined`.

Add a `strategyForEngine` map local to tools.ts:

```ts
const STRATEGY_FOR_ENGINE: Record<GenEngine, GenStrategy> = {
  [GenEngine.Mflux]: mfluxStrategy,
  [GenEngine.MlxAudio]: kokoroStrategy,
  [GenEngine.MlxVideo]: ltxStrategy,
  [GenEngine.ComfyWan]: wanComfyStrategy,
};
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/gen-tools-wiring.test.ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';

describe('createGenerateTools no-fit degrade', () => {
  test('generate_image returns a graceful message when no model fits', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
    const tools = createGenerateTools(store, {
      selectModel: async () => undefined, // force no-fit
    });
    const result = await (tools.generate_image as any).execute({ prompt: 'x' });
    expect(String(result).toLowerCase()).toContain('no ');
    expect(String(result).toLowerCase()).toContain('image');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/gen-tools-wiring.test.ts"`
Expected: FAIL — `deps.selectModel` seam / no-fit message not present.

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/media/generate/tools.ts`:

```ts
import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import {
  affirmCloneConsent,
  defaultCloneConsentAsk,
  requiresCloneConsent,
} from '../consent.ts';
import type { MediaStore } from '../store.ts';
import { MediaKind } from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';
import { runGenJob } from './adapter.ts';
import { resolveVoiceModel } from './audio-mlx.ts';
import { kokoroStrategy } from './audio-mlx.ts';
import { GenEngine } from './catalog.ts';
import type { GenModelCandidate } from './catalog.ts';
import { mfluxStrategy } from './image-mflux.ts';
import { selectGenModel } from './select.ts';
import { ltxStrategy } from './video-mlx.ts';
import { wanComfyStrategy } from './comfy-lane.ts';

const STRATEGY_FOR_ENGINE: Record<GenEngine, GenStrategy> = {
  [GenEngine.Mflux]: mfluxStrategy,
  [GenEngine.MlxAudio]: kokoroStrategy,
  [GenEngine.MlxVideo]: ltxStrategy,
  [GenEngine.ComfyWan]: wanComfyStrategy,
};

/** The same-kind other-engine video strategy, used as the runGenJob fallback
 *  so the one-shot↔server degrade is reachable. */
function videoFallbackFor(primary: GenStrategy): GenStrategy {
  return primary === ltxStrategy ? wanComfyStrategy : ltxStrategy;
}

/** Probe whether a local ComfyUI server is reachable (server-lane engine).
 *  Best-effort; a failed/absent probe means "unreachable" → degrade. */
async function comfyReachable(): Promise<boolean> {
  const host = process.env.AGENT_COMFY_HOST ?? '127.0.0.1';
  const port = process.env.AGENT_COMFY_PORT ?? '8188';
  try {
    const res = await fetch(`http://${host}:${port}/system_stats`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function createGenerateTools(
  store: MediaStore,
  deps?: {
    spawn?: SpawnFn;
    askCloneConsent?: (question: string) => Promise<boolean>;
    /** Test seam: override the fit selector. */
    selectModel?: (kind: MediaKind) => Promise<GenModelCandidate | undefined>;
  },
): ToolSet {
  const select = deps?.selectModel ?? ((kind: MediaKind) => selectGenModel(kind));

  const generate_image = tool({
    description: 'Generates an image from a text prompt and saves it to disk.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('A clear, detailed description of the image to generate'),
    }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Image);
      if (!candidate) {
        return 'No image-generation model fits this machine — set AGENT_IMAGE_MODEL or free up memory. Image was not generated.';
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const opts: GenOpts = { model: candidate.repo };
      const job = runGenJob(strategy, prompt, store, 'image/png', opts, deps);
      const fh = await job.result();
      return `Generated image: ${fh.uri}`;
    },
  });

  const generate_speech = tool({
    description: 'Generates spoken audio from text and saves it to disk.',
    inputSchema: z.object({ prompt: z.string().describe('The text to speak') }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Audio);
      if (!candidate) {
        return 'No speech-generation model fits this machine — set AGENT_VOICE_MODEL or free up memory. Speech was not generated.';
      }
      const opts: GenOpts = { model: candidate.repo };
      const model = resolveVoiceModel(opts);
      if (requiresCloneConsent(model)) {
        const ask = deps?.askCloneConsent ?? defaultCloneConsentAsk();
        const consented = await affirmCloneConsent({ ask });
        if (!consented) {
          return `Voice-clone consent declined for model "${model}" — speech was not generated.`;
        }
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const job = runGenJob(strategy, prompt, store, 'audio/wav', opts, deps);
      const fh = await job.result();
      return `Generated speech: ${fh.uri}`;
    },
  });

  const generate_video = tool({
    description:
      'Generates a short video from a text prompt and saves it to disk.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe('A clear, detailed description of the video to generate'),
    }),
    execute: async ({ prompt }) => {
      const candidate = await select(MediaKind.Video);
      if (!candidate) {
        return 'No video-generation model fits this machine — set AGENT_VIDEO_MODEL or use a higher-memory/disk box. Video was not generated.';
      }
      const strategy = STRATEGY_FOR_ENGINE[candidate.engine];
      const opts: GenOpts = { model: candidate.repo };
      const job = runGenJob(strategy, prompt, store, 'video/mp4', opts, {
        ...deps,
        fallback: videoFallbackFor(strategy),
        serverReachable: () => true, // sync probe seam; async reachability below
      });
      const fh = await job.result();
      return `Generated video: ${fh.uri}`;
    },
  });

  return { generate_image, generate_speech, generate_video };
}
```

Note on `serverReachable`: `runGenJob`'s `serverReachable` is synchronous `(strategy) => boolean`. A real async ComfyUI probe (`comfyReachable`) can't be awaited inside that sync callback, so for this slice the server→one-shot degrade is exercised by the **one-shot-primary→server-fallback** path (LTX binary missing → Wan). Keep `comfyReachable` defined for the live-verify task, but wire the synchronous default here; a fully-async reachability probe in `runGenJob` is a disclosed follow-on (matches the existing "serverReachable deferred to Phase C" note in adapter.ts).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/gen-tools-wiring.test.ts"`
Expected: PASS. Then run the existing media suite: `bun run test:file -- "tests/media/*"` — Expected: PASS (fix any test that constructed tools expecting the old `runOneShotJob` direct call — update to the `selectModel` seam).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/tools.ts tests/media/gen-tools-wiring.test.ts
git commit -m "feat(media): wire gen-fit selector + runGenJob into createGenerateTools"
```

---

