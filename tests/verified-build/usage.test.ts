import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import { aggregateUsage } from '../../src/verified-build/usage.ts';

function span(attributes: Record<string, unknown>, endMs: number): SpanRecord {
  return {
    name: 'crew.run',
    kind: 0,
    traceId: 'trace-1',
    spanId: 'span-1',
    parentSpanId: null,
    startUnixNano: (endMs - 5) * 1e6,
    endUnixNano: endMs * 1e6,
    durationMs: 5,
    status: { code: 0 },
    attributes,
    events: [],
  };
}

function writeRun(root: string, id: string, spans: SpanRecord[]): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

describe('aggregateUsage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vb-usage-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('counts uses per artifact id and keeps the max lastUsedMs', () => {
    writeRun(root, 'run-1', [span({ 'crew.id': 'c1' }, 2_000)]);
    writeRun(root, 'run-2', [span({ 'crew.id': 'c1' }, 5_000)]);
    expect(aggregateUsage(root)).toEqual({
      c1: { useCount: 2, lastUsedMs: 5_000 },
    });
  });

  test('reads delegation and workflow ids too', () => {
    writeRun(root, 'run-1', [
      span({ 'agent.delegation.target': 'helper' }, 1_000),
      span({ 'workflow.id': 'wf1' }, 3_000),
    ]);
    const usage = aggregateUsage(root);
    expect(usage.helper).toEqual({ useCount: 1, lastUsedMs: 1_000 });
    expect(usage.wf1).toEqual({ useCount: 1, lastUsedMs: 3_000 });
  });

  test('tolerates run dirs without spans.jsonl', () => {
    mkdirSync(join(root, 'empty-run'), { recursive: true });
    writeRun(root, 'run-1', [span({ 'crew.id': 'c1' }, 1_000)]);
    expect(aggregateUsage(root)).toEqual({
      c1: { useCount: 1, lastUsedMs: 1_000 },
    });
  });

  test('missing runs root yields empty map', () => {
    expect(aggregateUsage(join(root, 'does-not-exist'))).toEqual({});
  });

  test('skips a malformed line (valid JSON, no attributes) without throwing', () => {
    const dir = join(root, 'run-1');
    mkdirSync(dir, { recursive: true });
    const goodBefore = JSON.stringify(span({ 'crew.id': 'c1' }, 1_000));
    const goodAfter = JSON.stringify(span({ 'crew.id': 'c2' }, 2_000));
    // Interleave malformed-but-valid-JSON lines: a bare number, a bare
    // string, and an object with no `attributes` key at all.
    const lines = [
      goodBefore,
      '1',
      '"x"',
      JSON.stringify({ name: 'x' }),
      goodAfter,
    ];
    writeFileSync(join(dir, 'spans.jsonl'), `${lines.join('\n')}\n`);
    expect(() => aggregateUsage(root)).not.toThrow();
    expect(aggregateUsage(root)).toEqual({
      c1: { useCount: 1, lastUsedMs: 1_000 },
      c2: { useCount: 1, lastUsedMs: 2_000 },
    });
  });
});
