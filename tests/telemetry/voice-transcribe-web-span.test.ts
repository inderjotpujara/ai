import { afterEach, describe, expect, test } from 'bun:test';
import { ATTR, recordVoiceTranscribeWeb } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let ctx: ReturnType<typeof registerTestProvider>;
afterEach(async () => {
  await ctx?.provider.shutdown();
});

describe('recordVoiceTranscribeWeb', () => {
  test('exposes the new VOICE_* attribute keys', () => {
    expect(ATTR.VOICE_WORD_COUNT).toBe('voice.word.count');
    expect(ATTR.VOICE_REAL_TIME_FACTOR).toBe('voice.real_time_factor');
    expect(ATTR.VOICE_ENGINE).toBe('voice.engine');
  });

  test('writes a voice.transcribe.web span carrying every posted attribute', async () => {
    ctx = registerTestProvider();
    await recordVoiceTranscribeWeb({
      modelTier: 'moonshine-base',
      durationMs: 1200,
      wordCount: 9,
      realTimeFactor: 0.5,
      engine: 'transformers.js',
    });
    const span = ctx.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'voice.transcribe.web');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.VOICE_STT_MODEL]).toBe('moonshine-base');
    expect(span?.attributes[ATTR.VOICE_DURATION_MS]).toBe(1200);
    expect(span?.attributes[ATTR.VOICE_WORD_COUNT]).toBe(9);
    expect(span?.attributes[ATTR.VOICE_REAL_TIME_FACTOR]).toBe(0.5);
    expect(span?.attributes[ATTR.VOICE_ENGINE]).toBe('transformers.js');
    expect(span?.attributes[ATTR.INPUT_MODALITY]).toBe('audio');
  });
});
