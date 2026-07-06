import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  affirmCloneConsent,
  contentPolicyLabel,
  LEGAL_NOTE,
  requiresCloneConsent,
} from '../../src/media/consent.ts';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

test('contentPolicyLabel maps uncensored/default', () => {
  expect(contentPolicyLabel(true)).toBe('uncensored');
  expect(contentPolicyLabel(false)).toBe('default');
});

test('requiresCloneConsent is true for voice-cloning models, case-insensitive substring match', () => {
  expect(requiresCloneConsent('csm')).toBe(true);
  expect(requiresCloneConsent('CSM-1b')).toBe(true);
  expect(requiresCloneConsent('suno/csm-1b')).toBe(true);
  expect(requiresCloneConsent('dia')).toBe(true);
  expect(requiresCloneConsent('coqui/xtts-v2')).toBe(true);
  expect(requiresCloneConsent('fishaudio/fish-speech')).toBe(true);
});

test('requiresCloneConsent is false for Kokoro (preset voices only, no cloning)', () => {
  expect(requiresCloneConsent('mlx-community/Kokoro-82M-bf16')).toBe(false);
});

test('affirmCloneConsent returns the ask() answer', async () => {
  expect(await affirmCloneConsent({ ask: async () => false })).toBe(false);
  expect(await affirmCloneConsent({ ask: async () => true })).toBe(true);
});

test('LEGAL_NOTE is a non-empty string constant about legal obligations surviving filter removal', () => {
  expect(typeof LEGAL_NOTE).toBe('string');
  expect(LEGAL_NOTE.length).toBeGreaterThan(0);
  expect(LEGAL_NOTE.toLowerCase()).toContain('legal');
});

test('generate_speech with a clone-consent model does not generate when consent is declined', async () => {
  const store = createMediaStore(
    mkdtempSync(join(tmpdir(), 'gen-tools-consent-')),
  );
  let spawnCalled = false;
  const spawn: SpawnFn = (_cmd, args) => {
    spawnCalled = true;
    const prefix = args[args.indexOf('--file_prefix') + 1] ?? '';
    writeFileSync(`${prefix}_000.wav`, new Uint8Array([9]));
    return { pid: 5, kill() {}, onExit: (cb) => cb(0) };
  };
  const prevModel = process.env.AGENT_VOICE_MODEL;
  process.env.AGENT_VOICE_MODEL = 'csm-1b';
  try {
    const tools = createGenerateTools(store, {
      spawn,
      askCloneConsent: async () => false,
    });
    const result = await tools.generate_speech?.execute?.(
      { prompt: 'hello there' },
      {} as never,
    );
    expect(spawnCalled).toBe(false);
    expect(result as string).toContain('consent declined');
  } finally {
    if (prevModel === undefined) delete process.env.AGENT_VOICE_MODEL;
    else process.env.AGENT_VOICE_MODEL = prevModel;
  }
});

test('generate_speech with a clone-consent model generates once consent is granted', async () => {
  const store = createMediaStore(
    mkdtempSync(join(tmpdir(), 'gen-tools-consent-')),
  );
  const spawn: SpawnFn = (_cmd, args) => {
    const prefix = args[args.indexOf('--file_prefix') + 1] ?? '';
    writeFileSync(`${prefix}_000.wav`, new Uint8Array([9]));
    return { pid: 6, kill() {}, onExit: (cb) => cb(0) };
  };
  const prevModel = process.env.AGENT_VOICE_MODEL;
  process.env.AGENT_VOICE_MODEL = 'csm-1b';
  try {
    const tools = createGenerateTools(store, {
      spawn,
      askCloneConsent: async () => true,
    });
    const result = await tools.generate_speech?.execute?.(
      { prompt: 'hello there' },
      {} as never,
    );
    expect(result as string).toMatch(/\.wav$/);
  } finally {
    if (prevModel === undefined) delete process.env.AGENT_VOICE_MODEL;
    else process.env.AGENT_VOICE_MODEL = prevModel;
  }
});

test('generate_speech with the default Kokoro model needs no consent prompt', async () => {
  const store = createMediaStore(
    mkdtempSync(join(tmpdir(), 'gen-tools-consent-')),
  );
  const spawn: SpawnFn = (_cmd, args) => {
    const prefix = args[args.indexOf('--file_prefix') + 1] ?? '';
    writeFileSync(`${prefix}_000.wav`, new Uint8Array([9]));
    return { pid: 7, kill() {}, onExit: (cb) => cb(0) };
  };
  const tools = createGenerateTools(store, {
    spawn,
    askCloneConsent: async () => {
      throw new Error('should not be called for Kokoro');
    },
  });
  const result = await tools.generate_speech?.execute?.(
    { prompt: 'hello there' },
    {} as never,
  );
  expect(result as string).toMatch(/\.wav$/);
});
