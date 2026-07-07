### Task 3: Model + tool resolution

**Files:**
- Create: `src/voice/model.ts`
- Test: `tests/voice/model.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `voiceCacheDir(): string`, `resolveVoiceModel(env?): string` (returns model dir), `ffmpegCmd(env?): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/model.test.ts
import { describe, expect, it } from 'bun:test';
import { ffmpegCmd, resolveVoiceModel, voiceCacheDir } from '../../src/voice/model.ts';

describe('voice model resolution', () => {
  it('defaults the cache dir under ~/.cache/ai/voice', () => {
    expect(voiceCacheDir({})).toMatch(/\.cache\/ai\/voice$/);
  });
  it('AGENT_VOICE_DIR overrides the cache dir', () => {
    expect(voiceCacheDir({ AGENT_VOICE_DIR: '/tmp/v' })).toBe('/tmp/v');
  });
  it('resolveVoiceModel joins the default model name under the cache dir', () => {
    expect(resolveVoiceModel({ AGENT_VOICE_DIR: '/tmp/v' })).toBe(
      '/tmp/v/sherpa-onnx-moonshine-tiny-en-int8',
    );
  });
  it('AGENT_VOICE_STT_MODEL overrides the model dir absolutely', () => {
    expect(resolveVoiceModel({ AGENT_VOICE_STT_MODEL: '/models/base' })).toBe('/models/base');
  });
  it('ffmpegCmd honors AGENT_FFMPEG_CMD then falls back to ffmpeg', () => {
    expect(ffmpegCmd({ AGENT_FFMPEG_CMD: '/opt/ffmpeg' })).toBe('/opt/ffmpeg');
    expect(ffmpegCmd({})).toBe('ffmpeg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/voice/model.ts
import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

export const DEFAULT_VOICE_MODEL = 'sherpa-onnx-moonshine-tiny-en-int8';

/** Cache dir for downloaded voice models. Env AGENT_VOICE_DIR overrides. */
export function voiceCacheDir(env: Env = process.env): string {
  return env.AGENT_VOICE_DIR ?? join(homedir(), '.cache', 'ai', 'voice');
}

/**
 * Resolves the moonshine model directory. Precedence:
 * explicit AGENT_VOICE_STT_MODEL (absolute) > <cacheDir>/<DEFAULT_VOICE_MODEL>.
 */
export function resolveVoiceModel(env: Env = process.env): string {
  if (env.AGENT_VOICE_STT_MODEL) return env.AGENT_VOICE_STT_MODEL;
  return join(voiceCacheDir(env), DEFAULT_VOICE_MODEL);
}

/** ffmpeg binary. Env AGENT_FFMPEG_CMD overrides; else bare PATH `ffmpeg`. */
export function ffmpegCmd(env: Env = process.env): string {
  return env.AGENT_FFMPEG_CMD ?? 'ffmpeg';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/model.ts tests/voice/model.test.ts
git commit -m "feat(voice): model + ffmpeg resolution with env overrides"
```

---

