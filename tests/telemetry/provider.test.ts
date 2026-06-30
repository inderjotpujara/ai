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

test('initRunTelemetry registers a provider that writes spans.jsonl', async () => {
  const tel = initRunTelemetry(dir);
  const span = trace.getTracer('t').startSpan('hello');
  span.end();
  await tel.shutdown();
  const raw = await readFile(join(dir, 'spans.jsonl'), 'utf8');
  expect(raw).toContain('"name":"hello"');
});

test('initRunTelemetry re-init swaps the provider so second run writes to its own file', async () => {
  const a = initRunTelemetry(dir);
  await a.shutdown();

  const b = initRunTelemetry(dir2);
  const span = trace.getTracer('t').startSpan('second-run-span');
  span.end();
  await b.shutdown();

  // The span must appear in dir2's file (the re-init swapped the provider)
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
