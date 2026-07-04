import { afterEach, beforeEach, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR,
  recordReuseDecision,
  withBuildArchiveSpan,
  withBuildVerifySpan,
  withRunSpan,
} from '../../src/telemetry/spans.ts';
import type { GateDeps } from '../../src/verified-build/gate.ts';
import { verifyAndCommit } from '../../src/verified-build/gate.ts';
import { ArtifactKind, VerifiedLevel } from '../../src/verified-build/types.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
beforeEach(() => {
  ({ exporter, provider } = registerTestProvider());
});
afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
});

test('withBuildVerifySpan records events and the verified level', async () => {
  const out = await withBuildVerifySpan(ArtifactKind.Crew, async (rec) => {
    rec.event('dry_run', { ran: true });
    rec.result(VerifiedLevel.Behaves);
    return 'ok';
  });
  expect(out).toBe('ok');

  const span = exporter
    .getFinishedSpans()
    .find((s) => s.name === 'build.verify');
  expect(span).toBeDefined();
  expect(span?.attributes['artifact.kind']).toBe('crew');
  expect(span?.attributes[ATTR.VERIFY_LEVEL]).toBe('behaves');
  const ev = span?.events.find((e) => e.name === 'dry_run');
  expect(ev).toBeDefined();
  expect(ev?.attributes?.ran).toBe(true);
});

test('withBuildVerifySpan result() merges extra attributes', async () => {
  await withBuildVerifySpan(ArtifactKind.Agent, async (rec) => {
    rec.result(VerifiedLevel.Runs, {
      [ATTR.VERIFY_GOLDEN_PASSED]: 3,
      [ATTR.VERIFY_GOLDEN_TOTAL]: 4,
    });
  });
  const span = exporter
    .getFinishedSpans()
    .find((s) => s.name === 'build.verify');
  expect(span?.attributes[ATTR.VERIFY_LEVEL]).toBe('runs');
  expect(span?.attributes[ATTR.VERIFY_GOLDEN_PASSED]).toBe(3);
  expect(span?.attributes[ATTR.VERIFY_GOLDEN_TOTAL]).toBe(4);
});

test('withBuildVerifySpan attrs() sets attributes mid-pass', async () => {
  await withBuildVerifySpan(ArtifactKind.Agent, async (rec) => {
    rec.attrs({ [ATTR.VERIFY_DRYRUN_RAN]: true });
    rec.result(VerifiedLevel.Runs);
  });
  const span = exporter
    .getFinishedSpans()
    .find((s) => s.name === 'build.verify');
  expect(span?.attributes[ATTR.VERIFY_DRYRUN_RAN]).toBe(true);
});

function gateDeps(overrides: Partial<GateDeps> = {}): GateDeps {
  return {
    kind: ArtifactKind.Agent,
    name: 'x',
    need: 'do x',
    signature: { purpose: 'do x', tools: [], modelTier: '', io: '', roles: [] },
    stage: async () => ({ def: {} }),
    structural: async () => [],
    dryRunOnce: async () => ({ ran: true, output: 'ok', repairs: 0 }),
    makeGolden: async () => ({ need: 'do x', cases: [] }),
    goldenEval: async () => ({
      passed: true,
      total: 3,
      passedCount: 2,
      perCase: [],
      judgeModel: 'judge-big',
      belowBar: false,
    }),
    commit: async () => {},
    vector: [1, 0],
    force: true,
    ...overrides,
  };
}

test('the gate sets verify.dry_run/judge/golden attributes on build.verify', async () => {
  await verifyAndCommit(gateDeps());
  const span = exporter
    .getFinishedSpans()
    .find((s) => s.name === 'build.verify');
  expect(span?.attributes[ATTR.VERIFY_DRYRUN_RAN]).toBe(true);
  expect(span?.attributes[ATTR.VERIFY_DRYRUN_REPAIRS]).toBe(0);
  expect(span?.attributes[ATTR.VERIFY_JUDGE_MODEL]).toBe('judge-big');
  expect(span?.attributes[ATTR.VERIFY_JUDGE_BELOW_BAR]).toBe(false);
  expect(span?.attributes[ATTR.VERIFY_GOLDEN_PASSED]).toBe(2);
  expect(span?.attributes[ATTR.VERIFY_GOLDEN_TOTAL]).toBe(3);
});

test('a skipped golden eval (below-bar judge) records verify.judge.below_bar', async () => {
  await verifyAndCommit(gateDeps({ makeGolden: async () => null }));
  const span = exporter
    .getFinishedSpans()
    .find((s) => s.name === 'build.verify');
  expect(span?.attributes[ATTR.VERIFY_JUDGE_BELOW_BAR]).toBe(true);
  expect(span?.attributes[ATTR.VERIFY_JUDGE_MODEL]).toBeUndefined();
});

test('recordReuseDecision sets decision + similarity on the active span', async () => {
  await withRunSpan('run-1', 'task', async () => {
    recordReuseDecision('offer', 0.8);
  });
  const span = exporter.getFinishedSpans().find((s) => s.name === 'agent.run');
  expect(span?.attributes[ATTR.VERIFY_REUSE_DECISION]).toBe('offer');
  expect(span?.attributes[ATTR.VERIFY_REUSE_SIMILARITY]).toBe(0.8);
});

test('withBuildArchiveSpan records candidate and pruned counts', async () => {
  await withBuildArchiveSpan(async (rec) => {
    rec.done(5, 2);
  });
  const span = exporter
    .getFinishedSpans()
    .find((s) => s.name === 'build.archive');
  expect(span).toBeDefined();
  expect(span?.attributes[ATTR.ARCHIVE_CANDIDATES]).toBe(5);
  expect(span?.attributes[ATTR.ARCHIVE_PRUNED]).toBe(2);
});
