import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelDeclaration } from '../../src/core/types.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import { setLogSink } from '../../src/log/logger.ts';
import type { JobInput, JobRecord } from '../../src/queue/types.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';
import type { RunEvalDeps } from '../../src/self-improve/executor.ts';
import { runEval } from '../../src/self-improve/executor.ts';
import type { EvalHistoryRow } from '../../src/self-improve/history.ts';
import { EvalMode } from '../../src/server/jobs/dispatch.ts';
import { upsertEntry as writeManifestEntry } from '../../src/verified-build/manifest.ts';
import type {
  GoldenSet,
  ManifestEntry,
  VerifiedWith,
} from '../../src/verified-build/types.ts';
import { GoldenKind, VerifiedLevel } from '../../src/verified-build/types.ts';

afterEach(() => setLogSink(undefined));

const reg = (): string => mkdtempSync(join(tmpdir(), 'exec-reg-'));

const model = (name: string): ModelDeclaration => ({
  runtime: RuntimeKind.Ollama,
  model: name,
  params: {},
  role: 'r',
  footprint: { approxParamsBillions: 7, bytesPerWeight: 2 },
});

const verifiedWith = (name: string): VerifiedWith => ({
  runtime: RuntimeKind.Ollama,
  model: name,
  paramsBillions: 7,
  numCtx: 4096,
  capturedAtMs: 1,
});

const entryAt = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  need: 'summarize',
  signature: {
    purpose: 'summarize',
    tools: [],
    modelTier: '',
    io: '',
    roles: [],
  },
  vector: [],
  verifiedLevel: VerifiedLevel.Behaves,
  goldenPath: '/golden/a.json',
  createdAtMs: 1,
  lastUsedMs: 0,
  useCount: 0,
  lastEvalPass: true,
  ...over,
});

const goldenC0: GoldenSet = {
  need: 'summarize',
  cases: [{ id: 'c0', input: 'in', assert: 'a', kind: GoldenKind.TaskSuccess }],
};

const rowFor = (over: Partial<EvalHistoryRow> = {}): EvalHistoryRow => ({
  id: 'base',
  artifactId: 'a',
  model: 'A:7b',
  ts: 1,
  passed: true,
  passedCount: 1,
  total: 1,
  regressed: false,
  perCase: [{ id: 'c0', passed: true, detail: '' }],
  judgeModel: 'J:32b',
  belowBar: false,
  ...over,
});

type Captured = {
  inserted: EvalHistoryRow[];
  upserts: { dir: string; name: string; entry: ManifestEntry }[];
  enqueued: JobInput[];
  resolves: string[];
};

const makeDeps = (opts: {
  registryDirs: string[];
  runsRoot?: string;
  resolveModel: (need: string) => string;
  judgePass?: boolean;
  judgeCandidates?: boolean;
  latestPassing?: EvalHistoryRow | undefined;
  pending?: JobRecord[];
  upsertThrows?: (name: string) => boolean;
  captured: Captured;
}): RunEvalDeps => {
  const c = opts.captured;
  return {
    registryDirs: opts.registryDirs,
    runsRoot: opts.runsRoot ?? join(tmpdir(), 'no-runs-here'),
    resolve: async (need: string) => {
      c.resolves.push(need);
      return { decl: model(opts.resolveModel(need)), numCtx: 4096 };
    },
    runCase: async () => 'output',
    judge: async () => opts.judgePass ?? true,
    judgeCandidates: () =>
      opts.judgeCandidates === false
        ? []
        : [{ model: 'J:32b', params: 32e9, family: 'jf' }],
    loadGolden: () => goldenC0,
    history: {
      insert: (r) => c.inserted.push(r),
      listByArtifact: () => [],
      latestPassing: () => opts.latestPassing,
      close: () => {},
    },
    upsertEntry: (dir, name, entry) => {
      if (opts.upsertThrows?.(name)) throw new Error('fs boom');
      c.upserts.push({ dir, name, entry });
    },
    jobStore: {
      enqueue: (input) => {
        c.enqueued.push(input);
        return { id: 'j', ...input } as unknown as JobRecord;
      },
      listJobs: (q) => ({
        items: (opts.pending ?? []).filter((j) => j.status === q.status),
        total: 0,
      }),
    },
    now: () => 42,
  };
};

const emptyCaptured = (): Captured => ({
  inserted: [],
  upserts: [],
  enqueued: [],
  resolves: [],
});

test('Artifact mode: drift + all-cases-fail-on-every-rerun demotes Behaves→Unverified', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    judgePass: false,
    latestPassing: rowFor(),
    captured,
  });
  const res = await runEval(
    { mode: EvalMode.Artifact, ref: 'a', reason: 'manual' },
    deps,
  );
  expect(res.kind).toBe('answer');
  const demote = captured.upserts.find((u) => u.name === 'a');
  expect(demote?.entry.verifiedLevel).toBe(VerifiedLevel.Unverified);
  const regRow = captured.inserted.find((r) => r.regressed);
  expect(regRow).toBeDefined();
  expect(regRow?.model).toBe('B:7b');
});

test('Artifact mode: no drift still evaluates, no demote when passing', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'A:7b', // == verifiedWith → no drift
    judgePass: true,
    latestPassing: rowFor(),
    captured,
  });
  const res = await runEval({ mode: EvalMode.Artifact, ref: 'a' }, deps);
  expect(res).toEqual({ kind: 'answer', text: 'pass' });
  expect(captured.upserts).toHaveLength(0); // no demote
  expect(captured.inserted[0]?.regressed).toBe(false);
});

test('R5 SEED: entry with no verifiedWith records baseline row, sets verifiedWith, keeps level', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: undefined }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'A:7b',
    judgePass: true,
    latestPassing: undefined, // no baseline yet
    captured,
  });
  await runEval({ mode: EvalMode.Artifact, ref: 'a' }, deps);
  const up = captured.upserts.find((u) => u.name === 'a');
  expect(up?.entry.verifiedWith?.model).toBe('A:7b');
  expect(up?.entry.verifiedLevel).toBe(VerifiedLevel.Behaves); // kept
  expect(captured.inserted[0]?.regressed).toBe(false);
});

test('Sweep enqueues per-artifact Eval only for DRIFTED artifacts (hot-first)', async () => {
  const dir = reg();
  // hot: b (later usage) > a; c is NOT drifted
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  writeManifestEntry(dir, 'b', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  writeManifestEntry(dir, 'c', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const runsRoot = mkdtempSync(join(tmpdir(), 'exec-runs-'));
  const writeUsage = (name: string, endMs: number): void => {
    const rd = join(runsRoot, `run-${name}`);
    mkdirSync(rd, { recursive: true });
    writeFileSync(
      join(rd, 'spans.jsonl'),
      `${JSON.stringify({ endUnixNano: endMs * 1e6, attributes: { 'crew.id': name } })}\n`,
    );
  };
  writeUsage('a', 100);
  writeUsage('b', 200);
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    runsRoot,
    resolveModel: (need) => need, // never used for drift; overridden below
    captured,
  });
  // a,b drift (resolve B ≠ A); c no drift (resolve A == A)
  deps.resolve = async (need) => {
    captured.resolves.push(need);
    return { decl: model('A:7b'), numCtx: 4096 };
  };
  // custom: drift only for a,b via name — emulate by resolving per manifest name
  // Simpler: make resolve return B for all; c is non-drift by giving it B baseline.
  writeManifestEntry(dir, 'c', entryAt({ verifiedWith: verifiedWith('B:7b') }));
  deps.resolve = async (need) => {
    captured.resolves.push(need);
    return { decl: model('B:7b'), numCtx: 4096 };
  };
  await runEval({ mode: EvalMode.Sweep }, deps);
  const refs = captured.enqueued.map((e) => (e.payload as { ref: string }).ref);
  expect(refs).toEqual(['b', 'a']); // hot-first, c excluded
  for (const e of captured.enqueued) {
    expect(e.kind).toBe(JobKind.Eval);
    expect((e.payload as { mode: EvalMode }).mode).toBe(EvalMode.Artifact);
    expect((e.payload as { reason: string }).reason).toBe('sweep');
  }
});

test('§7.2: malformed spans.jsonl in runsRoot degrades ordering to unordered, sweep still processes drifted artifacts', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  writeManifestEntry(dir, 'b', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const runsRoot = mkdtempSync(join(tmpdir(), 'exec-bad-runs-'));
  const rd = join(runsRoot, 'run-bad');
  mkdirSync(rd, { recursive: true });
  // Valid JSON, but no `attributes` object — the malformed-span shape that
  // used to make `aggregateUsage` throw and abort the whole sweep.
  writeFileSync(join(rd, 'spans.jsonl'), '1\n{"name":"x"}\n');
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    runsRoot,
    resolveModel: () => 'B:7b', // both a,b drift
    captured,
  });
  const logs: string[] = [];
  setLogSink((l) => logs.push(l));
  const res = await runEval({ mode: EvalMode.Sweep }, deps);
  expect(res.kind).toBe('answer');
  const refs = captured.enqueued
    .map((e) => (e.payload as { ref: string }).ref)
    .sort();
  expect(refs).toEqual(['a', 'b']); // sweep still processed both, unordered
});

test('R4 de-dup: sweep skips enqueue when a Queued/Running Eval for the ref exists', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const pending = [
    {
      kind: JobKind.Eval,
      status: JobStatus.Queued,
      payload: { mode: EvalMode.Artifact, ref: 'a', reason: 'sweep' },
    } as unknown as JobRecord,
  ];
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    pending,
    captured,
  });
  await runEval({ mode: EvalMode.Sweep }, deps);
  expect(captured.enqueued).toHaveLength(0);
});

test('AffectedByPull coalesces: N drifted → N single jobs in ONE resolve pass', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  writeManifestEntry(dir, 'b', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    captured,
  });
  await runEval({ mode: EvalMode.AffectedByPull, reason: 'pull:B:7b' }, deps);
  expect(captured.resolves).toHaveLength(2); // ONE pass, no nested sweep
  const refs = captured.enqueued
    .map((e) => (e.payload as { ref: string }).ref)
    .sort();
  expect(refs).toEqual(['a', 'b']);
  expect((captured.enqueued[0]?.payload as { reason: string }).reason).toBe(
    'pull:B:7b',
  );
});

test('§7.2 isolation: one artifact whose resolve throws does not abort the sweep', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  writeManifestEntry(dir, 'b', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  writeManifestEntry(dir, 'c', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    captured,
  });
  deps.resolve = async (need) => {
    captured.resolves.push(need);
    if (captured.resolves.length === 2) throw new Error('resolve boom');
    return { decl: model('B:7b'), numCtx: 4096 };
  };
  const logs: string[] = [];
  setLogSink((l) => logs.push(l));
  await runEval({ mode: EvalMode.Sweep }, deps);
  expect(captured.enqueued).toHaveLength(2); // the other two still enqueued
  expect(logs.some((l) => l.includes('skipped'))).toBe(true);
});

test('inconclusive judge records a row and never demotes', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    judgeCandidates: false, // no judge clears bar → JudgeUnavailable
    latestPassing: rowFor(),
    captured,
  });
  const res = await runEval({ mode: EvalMode.Artifact, ref: 'a' }, deps);
  expect(res).toEqual({
    kind: 'answer',
    text: 'inconclusive: judge unavailable',
  });
  expect(captured.upserts).toHaveLength(0); // no demote
  expect(captured.inserted).toHaveLength(1);
  expect(captured.inserted[0]?.belowBar).toBe(true);
  expect(captured.inserted[0]?.regressed).toBe(false);
});

test('NoGolden: artifact with no persisted golden is skipped, no row, no demote', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    captured,
  });
  deps.loadGolden = () => null;
  const res = await runEval({ mode: EvalMode.Artifact, ref: 'a' }, deps);
  expect(res).toEqual({ kind: 'answer', text: 'skipped: no golden' });
  expect(captured.inserted).toHaveLength(0);
  expect(captured.upserts).toHaveLength(0);
});

// Finding #2 — stale-golden baseline guard: baseline case-id universe differs
// from the fresh golden → re-SEED, never a (diluted, masked) regression.
test('Finding #2: divergent baseline case-set re-seeds instead of masking a regression', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'a', entryAt({ verifiedWith: verifiedWith('A:7b') }));
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    judgePass: false, // fresh c0 FAILS — would look like a regression vs baseline
    // baseline was over {c0,c1,c2} (bigger, stale golden); fresh golden = {c0}
    latestPassing: rowFor({
      total: 3,
      passedCount: 3,
      perCase: [
        { id: 'c0', passed: true, detail: '' },
        { id: 'c1', passed: true, detail: '' },
        { id: 'c2', passed: true, detail: '' },
      ],
    }),
    captured,
  });
  const res = await runEval({ mode: EvalMode.Artifact, ref: 'a' }, deps);
  // re-seed, NOT a regression/demote
  expect(
    captured.upserts.some(
      (u) => u.entry.verifiedLevel === VerifiedLevel.Unverified,
    ),
  ).toBe(false);
  expect(captured.inserted.every((r) => !r.regressed)).toBe(true);
  expect((res as { text: string }).text).toContain('seed');
});

// Finding #4 — a persistent persist (demote/seed write) failure is logged with a
// DISTINCT warn so Ops sees under-reported regressions; the sweep still continues.
test('Finding #4: a persistent persist failure is logged distinctly and sweep continues', async () => {
  const dir = reg();
  writeManifestEntry(dir, 'seedme', entryAt({ verifiedWith: undefined })); // seed path
  writeManifestEntry(
    dir,
    'drift',
    entryAt({ verifiedWith: verifiedWith('A:7b') }),
  );
  const captured = emptyCaptured();
  const deps = makeDeps({
    registryDirs: [dir],
    resolveModel: () => 'B:7b',
    judgePass: true,
    upsertThrows: (name) => name === 'seedme',
    captured,
  });
  const logs: string[] = [];
  setLogSink((l) => logs.push(l));
  await runEval({ mode: EvalMode.Sweep }, deps);
  expect(logs.some((l) => l.includes('persist') && l.includes('seedme'))).toBe(
    true,
  );
  // sweep continued: the drifted artifact was still enqueued
  const refs = captured.enqueued.map((e) => (e.payload as { ref: string }).ref);
  expect(refs).toContain('drift');
});

test('master switch: sweep is a no-op answer when reeval disabled', async () => {
  process.env.AGENT_REEVAL_ENABLED = '0';
  try {
    const dir = reg();
    writeManifestEntry(
      dir,
      'a',
      entryAt({ verifiedWith: verifiedWith('A:7b') }),
    );
    const captured = emptyCaptured();
    const deps = makeDeps({
      registryDirs: [dir],
      resolveModel: () => 'B:7b',
      captured,
    });
    const res = await runEval({ mode: EvalMode.Sweep }, deps);
    expect(res).toEqual({ kind: 'answer', text: 'reeval disabled' });
    expect(captured.enqueued).toHaveLength(0);
    // manual single-artifact STILL runs even when disabled (latestPassing
    // undefined → seed path); the answer is NOT the disabled sentinel.
    const res2 = await runEval({ mode: EvalMode.Artifact, ref: 'a' }, deps);
    expect(res2.kind).toBe('answer');
    expect((res2 as { text: string }).text).not.toBe('reeval disabled');
  } finally {
    delete process.env.AGENT_REEVAL_ENABLED;
  }
});
