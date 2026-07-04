import { describe, expect, it } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { providerFor } from '../../src/provisioning/registry.ts';

describe('providerFor', () => {
  it('routes HfGguf and HfSnapshot to the HF fetcher (kind preserved)', () => {
    expect(providerFor(ProviderKind.HfGguf).kind).toBe(ProviderKind.HfGguf);
    expect(providerFor(ProviderKind.HfSnapshot).kind).toBe(
      ProviderKind.HfSnapshot,
    );
  });
  it('routes LmStudio to the LM Studio provider', () => {
    expect(providerFor(ProviderKind.LmStudio).kind).toBe(ProviderKind.LmStudio);
  });
  it('routes Ollama to the Ollama provider', () => {
    expect(providerFor(ProviderKind.Ollama).kind).toBe(ProviderKind.Ollama);
  });
});
