import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentNames } from '../../agents/index.ts';
import { createMediaCreatorAgent } from '../../agents/media-creator.ts';
import { createSuperAgent } from '../../agents/super.ts';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';

test('agentNames includes media_creator', () => {
  expect(agentNames()).toContain('media_creator');
});

test('createMediaCreatorAgent, built with the generate tools, exposes generate_image, generate_speech, and generate_video', () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'media-creator-')));
  const agent = createMediaCreatorAgent(createGenerateTools(store));
  expect(agent.name).toBe('media_creator');
  expect(Object.keys(agent.tools)).toContain('generate_image');
  expect(Object.keys(agent.tools)).toContain('generate_speech');
  expect(Object.keys(agent.tools)).toContain('generate_video');
});

test('createSuperAgent wires a delegate tool for media_creator when a mediaStore is supplied', () => {
  const store = createMediaStore(
    mkdtempSync(join(tmpdir(), 'media-creator-super-')),
  );
  const orch = createSuperAgent(() => ({}), undefined, undefined, store);
  expect(Object.keys(orch.tools)).toContain('delegate_to_media_creator');
});

test('createSuperAgent without a mediaStore still builds media_creator (no generate tools, no crash)', () => {
  const orch = createSuperAgent(() => ({}));
  expect(Object.keys(orch.tools)).toContain('delegate_to_media_creator');
});
