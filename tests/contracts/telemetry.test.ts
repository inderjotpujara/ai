import { expect, test } from 'bun:test';
import { TelemetryEventSchema } from '../../src/contracts/telemetry.ts';

const valid = {
  kind: 'voice.transcribe.web' as const,
  durationMs: 1234,
  wordCount: 7,
  modelTier: 'moonshine-base' as const,
  realTimeFactor: 0.42,
  engine: 'transformers.js',
};

test('TelemetryEventSchema accepts a well-formed voice.transcribe.web event (round-trip)', () => {
  const parsed = TelemetryEventSchema.parse(valid);
  expect(parsed).toEqual(valid);
});

test('TelemetryEventSchema rejects an unknown kind', () => {
  expect(() =>
    TelemetryEventSchema.parse({ ...valid, kind: 'voice.transcribe' }),
  ).toThrow();
});

test('TelemetryEventSchema rejects a missing/negative field', () => {
  const { wordCount: _drop, ...noWordCount } = valid;
  expect(() => TelemetryEventSchema.parse(noWordCount)).toThrow();
  expect(() =>
    TelemetryEventSchema.parse({ ...valid, durationMs: -1 }),
  ).toThrow();
  expect(() =>
    TelemetryEventSchema.parse({ ...valid, modelTier: 'whisper' }),
  ).toThrow();
});
