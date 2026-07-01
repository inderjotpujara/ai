import { describe, expect, test } from 'bun:test';
import {
  correctiveRetrieve,
  gradeRetrieval,
} from '../../src/verification/crag.ts';
import type { VerifyDeps } from '../../src/verification/types.ts';
import { CragGrade } from '../../src/verification/types.ts';

describe('crag', () => {
  test('gradeRetrieval maps model label → enum', async () => {
    const deps: VerifyDeps = {
      generate: async () => 'INCORRECT',
      getByIds: async () => [],
      ensureJudge: async (m) => ({ model: m, fallback: false }),
      generalModel: 'g',
    };
    expect(await gradeRetrieval('q', [], deps)).toBe(CragGrade.Incorrect);
  });
  test('correctiveRetrieve rewrites query + re-recalls once', async () => {
    const deps: VerifyDeps = {
      generalModel: 'g',
      generate: async () => 'better query',
      getByIds: async () => [],
      ensureJudge: async (m) => ({ model: m, fallback: false }),
    };
    const recall = async (q: string) => [
      {
        id: 'x#0',
        text: `hit for ${q}`,
        source: 'x',
        score: 0,
        namespace: '',
      },
    ];
    const out = await correctiveRetrieve('orig', recall, deps);
    expect(out.query).toBe('better query');
    expect(out.chunks[0]?.text).toContain('better query');
  });
});
