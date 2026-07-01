import { describe, expect, test } from 'bun:test';
import { ATTR } from '../../src/telemetry/spans.ts';
import type { VerifyDeps } from '../../src/verification/types.ts';
import { verify } from '../../src/verification/verify.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

function deps(over: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    generalModel: 'g',
    ensureJudge: async (m: string) => ({ model: m, fallback: false }),
    generate: async (_m: string, p: string) => {
      if (p.includes('atomic factual claims'))
        return '[{"text":"Raft elects a leader","citedIds":["r#0"]}]';
      return p.includes('Raft') ? 'Yes' : 'No'; // checkClaim
    },
    getByIds: async (_s: string, ids: string[]) =>
      ids.map((id) => ({
        id,
        text: 'Raft elects a leader via timeouts',
        source: 'kb',
        score: 0,
        namespace: '',
      })),
    ...over,
  };
}

describe('verify', () => {
  test('grounded answer → supported', async () => {
    const v = await verify(
      'Raft elects a leader [mem:r#0]',
      { query: 'raft leader', space: 'default' },
      deps(),
    );
    expect(v.supported).toBe(true);
    expect(v.faithfulness).toBe(1);
  });
  test('no citations → abstain-worthy (faithfulness 0)', async () => {
    const d = deps({
      generate: async (_m: string, p: string) =>
        p.includes('atomic')
          ? '[{"text":"Uncited claim","citedIds":[]}]'
          : 'No',
    });
    const v = await verify(
      'Uncited claim',
      { query: 'q', space: 'default' },
      d,
    );
    expect(v.supported).toBe(false);
    expect(v.faithfulness).toBe(0);
  });
  test('resolves judge model via ensureJudge(verifyModel()), not generalModel', async () => {
    const seenModels: string[] = [];
    const d = deps({
      ensureJudge: async (m: string) => {
        seenModels.push(m);
        return { model: 'resolved-judge-model', fallback: true };
      },
      generate: async (m: string, p: string) => {
        if (p.includes('atomic factual claims'))
          return '[{"text":"Raft elects a leader","citedIds":["r#0"]}]';
        // checkClaim call should use the resolved judge model, not 'g' (generalModel)
        expect(m).toBe('resolved-judge-model');
        return 'Yes';
      },
    });
    const v = await verify(
      'Raft elects a leader [mem:r#0]',
      { query: 'raft leader', space: 'default' },
      d,
    );
    // ensureJudge must have been called with the configured verify model, not deps.generalModel ('g')
    expect(seenModels).toEqual(['bespoke-minicheck']);
    expect(v.usedFallback).toBe(true);
  });

  test('annotates the verification.check span with the computed verdict via recordVerdict', async () => {
    const { exporter } = registerTestProvider();
    const v = await verify(
      'Uncited claim',
      { query: 'q', space: 'default' },
      deps({
        generate: async (_m: string, p: string) =>
          p.includes('atomic')
            ? '[{"text":"Uncited claim","citedIds":[]}]'
            : 'No',
      }),
    );
    expect(v.unsupportedClaims.length).toBeGreaterThan(0);
    const spans = exporter.getFinishedSpans();
    const s = spans.find((sp) => sp.name === 'verification.check');
    expect(s).toBeDefined();
    expect(s?.attributes[ATTR.VERIFICATION_UNSUPPORTED]).toBe(
      v.unsupportedClaims.length,
    );
  });
});
