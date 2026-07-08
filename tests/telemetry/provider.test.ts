import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from '@opentelemetry/api';
import {
  buildProcessors,
  initRunTelemetry,
  recordIoEnabled,
} from '../../src/telemetry/provider.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';

let dir: string;
let dir2: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prov-'));
  dir2 = await mkdtemp(join(tmpdir(), 'prov2-'));
});
afterEach(async () => {
  delete process.env.AGENT_OTLP_ENDPOINT;
  delete process.env.AGENT_TELEMETRY_RECORD_IO;
  await rm(dir, { recursive: true, force: true });
  await rm(dir2, { recursive: true, force: true });
});

test('initRunTelemetry registers processors that write spans.jsonl', async () => {
  const tel = initRunTelemetry(dir, 'run-x');
  withRunContext('run-x', () => trace.getTracer('t').startSpan('hello').end());
  await tel.shutdown();
  const raw = await readFile(join(dir, 'spans.jsonl'), 'utf8');
  expect(raw).toContain('"name":"hello"');
});

test('a second run routes its spans to its own file (no provider swap)', async () => {
  const a = initRunTelemetry(dir, 'run-a');
  await a.shutdown();

  const b = initRunTelemetry(dir2, 'run-b');
  withRunContext('run-b', () =>
    trace.getTracer('t').startSpan('second-run-span').end(),
  );
  await b.shutdown();

  // The span is routed to run-b's file by the router (no global provider swap).
  const raw = await readFile(join(dir2, 'spans.jsonl'), 'utf8');
  expect(raw).toContain('"name":"second-run-span"');
});

test('buildProcessors adds OTLP only when AGENT_OTLP_ENDPOINT is set', () => {
  expect(buildProcessors(join(dir, 's.jsonl'))).toHaveLength(1);
  process.env.AGENT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
  expect(buildProcessors(join(dir, 's.jsonl'))).toHaveLength(2);
});

test('recordIoEnabled defaults true, off when set to 0', () => {
  expect(recordIoEnabled()).toBe(true);
  process.env.AGENT_TELEMETRY_RECORD_IO = '0';
  expect(recordIoEnabled()).toBe(false);
});
