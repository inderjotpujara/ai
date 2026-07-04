import { afterEach, beforeEach, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR,
  withBuildArchiveSpan,
  withBuildVerifySpan,
} from '../../src/telemetry/spans.ts';
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
