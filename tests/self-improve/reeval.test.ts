import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { ReevalSkip, reevalArtifact } from '../../src/self-improve/reeval.ts';
import { GoldenKind } from '../../src/verified-build/types.ts';

const decl = {
  runtime: RuntimeKind.Ollama,
  model: 'B:7b',
  params: {},
  role: 'r',
  footprint: { approxParamsBillions: 7, bytesPerWeight: 0.5 },
};
const entry = {
  need: 'n',
  signature: { purpose: 'n', tools: [], modelTier: '', io: '', roles: [] },
  vector: [],
  verifiedLevel: 'behaves',
  goldenPath: '/tmp/x.golden.json',
  createdAtMs: 1,
  lastUsedMs: 0,
  useCount: 0,
  lastEvalPass: true,
} as const;

test('missing golden → skipped(no-golden), never resolves or evaluates', async () => {
  let resolved = false;
  const out = await reevalArtifact(entry as never, 'x', {
    resolve: async () => {
      resolved = true;
      return { decl, numCtx: 8192 };
    },
    runCase: async () => 'a',
    judgeCandidates: () => [],
    judge: async () => true,
    loadGolden: () => null,
  });
  expect(out).toEqual({ kind: 'skipped', reason: ReevalSkip.NoGolden });
  expect(resolved).toBe(false);
});

test('below-bar judge → skipped(judge-unavailable), no demote path taken here', async () => {
  const out = await reevalArtifact(entry as never, 'x', {
    resolve: async () => ({ decl, numCtx: 8192 }),
    runCase: async () => 'a',
    judgeCandidates: () => [{ model: 'small', params: 1e9, family: 'jf' }], // below AGENT_JUDGE_MIN_PARAMS
    judge: async () => true,
    loadGolden: () => ({
      need: 'n',
      cases: [
        { id: 'c0', input: 'i', assert: 'ok', kind: GoldenKind.TaskSuccess },
      ],
    }),
  });
  expect(out).toEqual({ kind: 'skipped', reason: ReevalSkip.JudgeUnavailable });
});

test('evaluated → returns EvalResult + the resolved model (no regeneration)', async () => {
  const out = await reevalArtifact(entry as never, 'x', {
    resolve: async () => ({ decl, numCtx: 8192 }),
    runCase: async (_ref, _model, input) => (input === 'i' ? 'good' : 'bad'),
    judgeCandidates: () => [{ model: 'J:32b', params: 32e9, family: 'jf' }],
    judge: async () => true,
    loadGolden: () => ({
      need: 'n',
      cases: [
        { id: 'c0', input: 'i', assert: 'ok', kind: GoldenKind.TaskSuccess },
      ],
    }),
  });
  expect(out.kind).toBe('evaluated');
  if (out.kind === 'evaluated') {
    expect(out.result.passed).toBe(true);
    expect(out.resolved.decl.model).toBe('B:7b');
  }
});

test('the resolved model family is fed to the judge selection (runCase ref = artifact name)', async () => {
  const refs: string[] = [];
  const out = await reevalArtifact(entry as never, 'my-agent', {
    resolve: async () => ({ decl, numCtx: 8192 }),
    runCase: async (ref, _model, _input) => {
      refs.push(ref);
      return 'good';
    },
    judgeCandidates: () => [{ model: 'J:32b', params: 32e9, family: 'jf' }],
    judge: async () => true,
    loadGolden: () => ({
      need: 'n',
      cases: [
        { id: 'c0', input: 'i', assert: 'ok', kind: GoldenKind.TaskSuccess },
      ],
    }),
  });
  expect(out.kind).toBe('evaluated');
  expect(refs).toEqual(['my-agent']);
});
