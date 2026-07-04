import { describe, expect, test } from 'bun:test';
import {
  type GateDeps,
  verifyAndCommit,
} from '../../src/verified-build/gate.ts';
import type {
  DryRunResult,
  EvalResult,
  GoldenSet,
} from '../../src/verified-build/types.ts';
import { ArtifactKind, VerifiedLevel } from '../../src/verified-build/types.ts';

const golden: GoldenSet = { need: 'summarize urls', cases: [] };

const passEval: EvalResult = {
  passed: true,
  total: 3,
  passedCount: 3,
  perCase: [],
  judgeModel: 'judge-1',
  belowBar: false,
};

const failEval: EvalResult = {
  passed: false,
  total: 3,
  passedCount: 1,
  perCase: [],
  judgeModel: 'judge-1',
  belowBar: false,
};

function ranOk(): DryRunResult {
  return { ran: true, output: 'ok', repairs: 0 };
}

function ranBad(): DryRunResult {
  return { ran: false, error: 'boom', repairs: 0 };
}

type Harness = {
  deps: GateDeps;
  commits: { level: VerifiedLevel }[];
};

function makeDeps(overrides: Partial<GateDeps> = {}): Harness {
  const commits: { level: VerifiedLevel }[] = [];
  const deps: GateDeps = {
    kind: ArtifactKind.Agent,
    name: 'summarizer',
    need: 'summarize urls',
    signature: {
      purpose: 'summarize urls',
      tools: [],
      modelTier: '',
      io: '',
      roles: [],
    },
    stage: async () => ({ def: { id: 'summarizer' } }),
    structural: async () => [],
    dryRunOnce: async () => ranOk(),
    goldenEval: async () => passEval,
    commit: async (_def, level) => {
      commits.push({ level });
    },
    makeGolden: async () => golden,
    vector: [1, 0, 0],
    force: false,
    ...overrides,
  };
  return { deps, commits };
}

describe('verifyAndCommit gate', () => {
  test('happy path commits at behaves', async () => {
    const { deps, commits } = makeDeps();
    const res = await verifyAndCommit(deps);
    expect(res.kind).toBe('committed');
    if (res.kind !== 'committed') return;
    expect(res.name).toBe('summarizer');
    expect(res.level).toBe(VerifiedLevel.Behaves);
    expect(res.eval).toEqual(passEval);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.level).toBe(VerifiedLevel.Behaves);
  });

  test('structural issues without force fail before commit', async () => {
    const { deps, commits } = makeDeps({ structural: async () => ['x'] });
    const res = await verifyAndCommit(deps);
    expect(res).toEqual({ kind: 'failed', stage: 'structural', detail: 'x' });
    expect(commits).toHaveLength(0);
  });

  test('dry-run failure repairs via re-stage then commits', async () => {
    let dryRuns = 0;
    let stages = 0;
    const { deps, commits } = makeDeps({
      stage: async () => {
        stages++;
        return { def: { id: 'summarizer', rev: stages } };
      },
      dryRunOnce: async () => {
        dryRuns++;
        return dryRuns === 1 ? ranBad() : ranOk();
      },
    });
    const res = await verifyAndCommit(deps);
    expect(res.kind).toBe('committed');
    expect(stages).toBe(2);
    expect(dryRuns).toBe(2);
    expect(commits).toHaveLength(1);
  });

  test('dry-run that never runs without force fails at dry-run', async () => {
    const { deps, commits } = makeDeps({ dryRunOnce: async () => ranBad() });
    const res = await verifyAndCommit(deps);
    expect(res.kind).toBe('failed');
    if (res.kind !== 'failed') return;
    expect(res.stage).toBe('dry-run');
    expect(res.detail).toBe('boom');
    expect(commits).toHaveLength(0);
  });

  test('null goldenEval (below bar) commits at runs', async () => {
    const { deps, commits } = makeDeps({ goldenEval: async () => null });
    const res = await verifyAndCommit(deps);
    expect(res.kind).toBe('committed');
    if (res.kind !== 'committed') return;
    expect(res.level).toBe(VerifiedLevel.Runs);
    expect(res.eval).toBeUndefined();
    expect(commits[0]?.level).toBe(VerifiedLevel.Runs);
  });

  test('null makeGolden (judge below bar) skips goldenEval entirely and commits at runs', async () => {
    let evals = 0;
    const { deps, commits } = makeDeps({
      makeGolden: async () => null,
      goldenEval: async () => {
        evals++;
        return passEval;
      },
    });
    const res = await verifyAndCommit(deps);
    expect(res.kind).toBe('committed');
    if (res.kind !== 'committed') return;
    expect(res.level).toBe(VerifiedLevel.Runs);
    expect(evals).toBe(0);
    expect(commits[0]?.level).toBe(VerifiedLevel.Runs);
  });

  test('the golden set is generated once and the SAME set is evaluated and committed', async () => {
    let makes = 0;
    const evaluated: GoldenSet[] = [];
    const committed: (GoldenSet | null)[] = [];
    const { deps } = makeDeps({
      makeGolden: async () => {
        makes++;
        return golden;
      },
      goldenEval: async (_def, g) => {
        evaluated.push(g);
        return passEval;
      },
      commit: async (_def, _level, g) => {
        committed.push(g);
      },
    });
    const res = await verifyAndCommit(deps);
    expect(res.kind).toBe('committed');
    expect(makes).toBe(1);
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0]).toBe(golden);
    expect(committed[0]).toBe(golden);
  });

  test('failing golden eval without force fails at golden-eval', async () => {
    const { deps, commits } = makeDeps({ goldenEval: async () => failEval });
    const res = await verifyAndCommit(deps);
    expect(res).toEqual({
      kind: 'failed',
      stage: 'golden-eval',
      detail: '1/3',
    });
    expect(commits).toHaveLength(0);
  });

  test('force with failing structural commits at unverified', async () => {
    const { deps, commits } = makeDeps({
      structural: async () => ['x'],
      force: true,
    });
    const res = await verifyAndCommit(deps);
    expect(res.kind).toBe('committed');
    if (res.kind !== 'committed') return;
    expect(res.level).toBe(VerifiedLevel.Unverified);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.level).toBe(VerifiedLevel.Unverified);
  });
});
