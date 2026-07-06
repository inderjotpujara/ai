import { describe, expect, it } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { isUncensoredModel } from '../../src/media/policy.ts';
import { loadSnapshot } from '../../src/provisioning/catalog/snapshot-source.ts';

describe('uncensored catalog entries', () => {
  const textModelId = 'goekdenizguelmez/JOSIEFIED-Qwen3:8b';
  const visionModelId = 'huihui_ai/qwen3-vl-abliterated:8b';

  it('includes JOSIEFIED-Qwen3:8b text uncensored model', () => {
    const snap = loadSnapshot();
    const entry = snap.find((c) => c.model === textModelId);

    expect(entry).toBeDefined();
    expect(entry?.provider).toBe(ProviderKind.Ollama);
    expect(entry?.role).toBe('uncensored general reasoning + tool use');
    expect(entry?.capabilities).toContain(Capability.Tools);
  });

  it('JOSIEFIED-Qwen3:8b is detected as uncensored by policy', () => {
    const snap = loadSnapshot();
    const entry = snap.find((c) => c.model === textModelId);

    expect(entry).toBeDefined();
    if (entry) {
      expect(isUncensoredModel({ model: entry.model })).toBe(true);
    }
  });

  it('includes qwen3-vl-abliterated:8b vision uncensored model', () => {
    const snap = loadSnapshot();
    const entry = snap.find((c) => c.model === visionModelId);

    expect(entry).toBeDefined();
    expect(entry?.provider).toBe(ProviderKind.Ollama);
    expect(entry?.role).toBe('uncensored vision analysis');
    expect(entry?.capabilities).toContain(Capability.Vision);
  });

  it('qwen3-vl-abliterated:8b is detected as uncensored by policy', () => {
    const snap = loadSnapshot();
    const entry = snap.find((c) => c.model === visionModelId);

    expect(entry).toBeDefined();
    if (entry) {
      expect(isUncensoredModel({ model: entry.model })).toBe(true);
    }
  });
});
