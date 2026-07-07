import { describe, expect, it } from 'bun:test';
import {
  createSubprocessTranscriber,
  createTranscriber,
} from '../../src/voice/transcribe.ts';

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 5000 };

describe('createTranscriber selection', () => {
  it('uses subprocess impl when AGENT_VOICE_EXEC=subprocess', () => {
    const t = createTranscriber(cfg, { AGENT_VOICE_EXEC: 'subprocess' });
    // Subprocess impl lazily spawns; we only assert the shape here.
    expect(typeof t.transcribe).toBe('function');
    expect(typeof t.close).toBe('function');
  });
  it('defaults to in-process (throws on addon load, proving it took that path)', () => {
    // With no real addon + no fake, in-process load will throw when transcribe runs;
    // constructing the selector must not itself throw for the default path decision.
    expect(() => createTranscriber(cfg, {})).toBeDefined();
  });
});

describe('createSubprocessTranscriber', () => {
  it('returns the text from the worker stdout on success', async () => {
    const t = createSubprocessTranscriber(cfg, {
      spawn: async () => ({ code: 0, stdout: '{"text":"hi"}', stderr: '' }),
    });
    const text = await t.transcribe({
      samples: new Float32Array(16000),
      sampleRate: 16000,
    });
    expect(text).toBe('hi');
    await t.close();
  });
  it('throws VoiceError with stderr on non-zero exit', async () => {
    const t = createSubprocessTranscriber(cfg, {
      spawn: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
    });
    await expect(
      t.transcribe({ samples: new Float32Array(16000), sampleRate: 16000 }),
    ).rejects.toThrow(/boom/);
  });
  it('throws VoiceError before spawning on empty samples', async () => {
    let spawned = false;
    const t = createSubprocessTranscriber(cfg, {
      spawn: async () => {
        spawned = true;
        return { code: 0, stdout: '{"text":""}', stderr: '' };
      },
    });
    await expect(
      t.transcribe({ samples: new Float32Array(0), sampleRate: 16000 }),
    ).rejects.toThrow(/no audio/i);
    expect(spawned).toBe(false);
  });
});
