import { describe, expect, test } from 'bun:test';
import {
  decomposeClaims,
  parseCitations,
} from '../../src/verification/claims.ts';

describe('citations + claims', () => {
  test('parseCitations extracts + dedupes [mem:id]', () => {
    expect(parseCitations('x [mem:a#0] y [mem:b#1] z [mem:a#0]')).toEqual([
      'a#0',
      'b#1',
    ]);
    expect(parseCitations('no cites')).toEqual([]);
  });
  test('decomposeClaims parses model JSON', async () => {
    interface MockDeps {
      generalModel: string;
      generate: (model: string, prompt: string) => Promise<string>;
    }
    const mockDeps: MockDeps = {
      generalModel: 'm',
      generate: async () =>
        '```json\n[{"text":"The sky is blue","citedIds":["a#0"]},{"text":"Grass is green","citedIds":[]}]\n```',
    };
    const claims = await decomposeClaims(
      '...',
      mockDeps as Parameters<typeof decomposeClaims>[1],
    );
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual({ text: 'The sky is blue', citedIds: ['a#0'] });
    expect(claims[1]?.citedIds).toEqual([]);
  });
});
