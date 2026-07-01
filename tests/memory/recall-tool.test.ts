import { describe, expect, test } from 'bun:test';
import { formatResults } from '../../src/memory/recall-tool.ts';
import type { RetrievalResult } from '../../src/memory/types.ts';

describe('formatResults', () => {
  test('tags each chunk with [mem:<id>] citation', () => {
    const r: RetrievalResult[] = [
      {
        id: 'doc#0',
        text: 'the sky is blue',
        source: 'doc',
        score: 0.1,
        namespace: '',
      },
    ];
    const out = formatResults(r);
    expect(out).toContain('[mem:doc#0]');
    expect(out).toContain('the sky is blue');
  });
  test('empty results → explicit abstention message', () => {
    expect(formatResults([])).toMatch(/no supporting memory/i);
  });
});
