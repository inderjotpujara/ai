import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from '@opentelemetry/api';
import { readSpans } from '../../src/run/run-trace.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'router-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('two overlapping runs in one process write to separate spans.jsonl', async () => {
  const a = initRunTelemetry(join(root, 'A'), 'A');
  const b = initRunTelemetry(join(root, 'B'), 'B');
  // Interleave: emit a span under each run's context while both are open.
  withRunContext('A', () => trace.getTracer('t').startSpan('span-A').end());
  withRunContext('B', () => trace.getTracer('t').startSpan('span-B').end());
  await a.shutdown();
  await b.shutdown();
  const aSpans = (await readSpans(join(root, 'A'))).spans.map((s) => s.name);
  const bSpans = (await readSpans(join(root, 'B'))).spans.map((s) => s.name);
  expect(aSpans).toEqual(['span-A']);
  expect(bSpans).toEqual(['span-B']);
});
