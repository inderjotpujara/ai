import { describe, expect, test } from 'bun:test';
import { buildWanWorkflow } from '../../src/media/generate/comfy-lane.ts';

describe('buildWanWorkflow checkpoint', () => {
  test('adds a checkpoint loader from opts.model when set', () => {
    const wf = buildWanWorkflow('a dog running', {
      model: 'city96/LTX-Video-0.9.6-distilled-gguf',
    }) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    const loader = Object.values(wf).find(
      (n) => n.class_type === 'CheckpointLoaderSimple',
    );
    expect(loader?.inputs.ckpt_name).toBe(
      'city96/LTX-Video-0.9.6-distilled-gguf',
    );
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
