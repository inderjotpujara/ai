import { describe, expect, it } from 'bun:test';
import { downloadKindFor } from '../../src/core/kind-map.ts';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';

describe('downloadKindFor', () => {
  it('maps Ollama runtime to Ollama download', () => {
    expect(downloadKindFor(RuntimeKind.Ollama, 'ollama')).toBe(
      ProviderKind.Ollama,
    );
  });
  it('maps MLX runtime + snapshot repo to HfSnapshot download', () => {
    expect(downloadKindFor(RuntimeKind.MlxServer, 'snapshot')).toBe(
      ProviderKind.HfSnapshot,
    );
  });
  it('maps a single-file gguf under Ollama runtime to HfGguf download', () => {
    expect(downloadKindFor(RuntimeKind.Ollama, 'gguf-file')).toBe(
      ProviderKind.HfGguf,
    );
  });
  it('maps LmStudio runtime to LmStudio download', () => {
    expect(downloadKindFor(RuntimeKind.LmStudio, 'snapshot')).toBe(
      ProviderKind.LmStudio,
    );
  });
});
