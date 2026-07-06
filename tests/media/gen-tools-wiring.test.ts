import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';

describe('createGenerateTools no-fit degrade', () => {
  test('generate_image returns a graceful message when no model fits', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
    const tools = createGenerateTools(store, {
      selectModel: async () => undefined, // force no-fit
    });
    const result = await tools.generate_image?.execute?.(
      { prompt: 'x' },
      {} as never,
    );
    expect(String(result).toLowerCase()).toContain('no ');
    expect(String(result).toLowerCase()).toContain('image');
  });
});
