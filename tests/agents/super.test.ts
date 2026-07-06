import { expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { CAPABILITY_GAP_TOOL } from '../../src/core/capability-gap.ts';

test('super agent exposes delegate tools for both specialists and the gap tool', () => {
  const toolsFor = () => ({ read_file: { description: 'x' } }) as never;
  const sup = createSuperAgent(toolsFor);
  const toolNames = Object.keys(sup.tools);
  expect(toolNames).toContain('delegate_to_file_qa');
  expect(toolNames).toContain('delegate_to_web_fetch');
  expect(toolNames).toContain(CAPABILITY_GAP_TOOL);
  expect(sup.model).toBeTruthy();
});

test('super agent uses the small router model', () => {
  const sup = createSuperAgent(() => ({ read_file: {} }) as never);
  // model is a resolved LanguageModel for qwen3:4b
  expect((sup.model as { modelId?: string }).modelId).toBe(qwenRouter.model);
});

test('super agent system prompt instructs verbatim media-marker preservation', () => {
  const sup = createSuperAgent(() => ({ read_file: {} }) as never);
  expect(sup.systemPrompt).toContain('[img:...]');
  expect(sup.systemPrompt).toContain('[audio:...]');
  expect(sup.systemPrompt).toContain('[video:...]');
  expect(sup.systemPrompt.toLowerCase()).toContain('verbatim');
});
