import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRunStream } from '../../src/server/runs/stream.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

function span(
  p: Partial<SpanRecord> & { name: string; spanId: string },
): SpanRecord {
  return {
    kind: 0,
    traceId: 't',
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 1,
    status: { code: 0 },
    attributes: {},
    events: [],
    ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'strm-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSpans(id: string, spans: SpanRecord[]) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

/** Collect SSE `{id,data}` frames from a Response body until it closes. */
async function collect(
  res: Response,
): Promise<{ id: string; data: unknown }[]> {
  const out: { id: string; data: unknown }[] = [];
  const body = res.body;
  if (!body) throw new Error('response has no body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep = buf.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let id = '';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length) out.push({ id, data: JSON.parse(data.join('\n')) });
      sep = buf.indexOf('\n\n');
    }
  }
  return out;
}

test('404 on a path-escaping id', async () => {
  const res = await handleRunStream('../../etc', { runsRoot: root }, {});
  expect(res.status).toBe(404);
});

test('missing runsRoot dir → 404, not 500 (fresh install with no runs/)', async () => {
  const res = await handleRunStream(
    'r1',
    { runsRoot: join(root, 'no-such-runs-root') },
    {},
  );
  expect(res.status).toBe(404);
});

test('a spanId with CR/LF cannot inject a spurious SSE frame', async () => {
  // Done run so the stream closes promptly; the malicious id lives on a child.
  await writeSpans('r-inject', [
    span({
      name: 'agent.run',
      spanId: 'a',
      attributes: { 'agent.outcome': 'answer' },
    }),
    span({
      name: 'x',
      spanId: 'x\ndata:evil\n\n',
      parentSpanId: 'a',
    }),
  ]);
  const res = await handleRunStream(
    'r-inject',
    { runsRoot: root },
    { pollMs: 20 },
  );
  const frames = await collect(res);
  // One frame per real span (2), NOT an extra injected frame. Every emitted
  // frame carries valid JSON data (the injected `data:evil` would have been a
  // separate, unparseable frame).
  expect(frames).toHaveLength(2);
  const ids = frames.map((f) => f.id);
  // The sanitized id has its control chars stripped (no newline survives).
  expect(ids.some((id) => id.includes('\n') || id.includes('\r'))).toBe(false);
  expect(ids).toContain('xdata:evil');
});

test('snapshot then tail: emits existing spans, then a newly-appended span, then closes on root close', async () => {
  // in-flight: no agent.run yet → Running → keeps tailing
  await writeSpans('r1', [span({ name: 'agent.delegation', spanId: 's1' })]);
  const res = await handleRunStream(
    'r1',
    { runsRoot: root },
    { pollMs: 20, maxWaitMs: 5_000 },
  );
  // append the root while the stream tails → run becomes Done → stream closes
  setTimeout(() => {
    void writeSpans('r1', [
      span({ name: 'agent.delegation', spanId: 's1' }),
      span({
        name: 'agent.run',
        spanId: 'root',
        attributes: { 'agent.outcome': 'answer' },
      }),
    ]);
  }, 60);
  const frames = await collect(res);
  const ids = frames.map((f) => f.id);
  expect(ids).toContain('s1');
  expect(ids).toContain('root');
  expect(res.headers.get('content-type')).toContain('text/event-stream');
});

test('Last-Event-ID resume replays only spans after the cursor', async () => {
  await writeSpans('r2', [
    span({
      name: 'agent.run',
      spanId: 'a',
      attributes: { 'agent.outcome': 'answer' },
    }),
    span({ name: 'x', spanId: 'b', parentSpanId: 'a' }),
  ]);
  // full run (Done) closes immediately after snapshot
  const first = await collect(
    await handleRunStream('r2', { runsRoot: root }, { pollMs: 20 }),
  );
  const firstId = first[0]?.id;
  if (!firstId) throw new Error('expected at least one snapshot frame');
  const resumed = await collect(
    await handleRunStream(
      'r2',
      { runsRoot: root },
      { lastEventId: firstId, pollMs: 20 },
    ),
  );
  expect(resumed.map((f) => f.id)).not.toContain(firstId);
  expect(resumed.length).toBeLessThan(first.length);
});

test('stale/unknown Last-Event-ID replays the full snapshot (not nothing)', async () => {
  await writeSpans('r3', [
    span({
      name: 'agent.run',
      spanId: 'a',
      attributes: { 'agent.outcome': 'answer' },
    }),
    span({ name: 'x', spanId: 'b', parentSpanId: 'a' }),
  ]);
  const resumed = await collect(
    await handleRunStream(
      'r3',
      { runsRoot: root },
      { lastEventId: 'no-such-span', pollMs: 20 },
    ),
  );
  // a stale cursor degrades to a fresh connection: replay everything
  expect(resumed.map((f) => f.id)).toEqual(['a', 'b']);
});

test('reader cancel() stops the tail promptly without throwing', async () => {
  // in-flight run (no run-root) → Running: with maxWaitMs 5s the loop can ONLY
  // stop quickly via the cancel() handler, so a finished `runs.stream` span
  // within the short wait below proves the disconnect ended the poll loop
  // (not the deadline). No unhandled rejection proves the guarded close.
  await writeSpans('r5', [span({ name: 'agent.delegation', spanId: 's1' })]);
  const { exporter, provider } = registerTestProvider();
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  try {
    const res = await handleRunStream(
      'r5',
      { runsRoot: root },
      { pollMs: 10, maxWaitMs: 5_000 },
    );
    const body = res.body;
    if (!body) throw new Error('response has no body');
    const reader = body.getReader();
    // receive the snapshot frame, then disconnect
    const { value } = await reader.read();
    expect(value).toBeDefined();
    await reader.cancel(); // must resolve, not throw
    // a few poll ticks to observe the abort, hit finally, end the span
    await new Promise((r) => setTimeout(r, 80));
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runs.stream');
    // loop actually terminated (well before maxWaitMs) with the abort outcome
    expect(span?.attributes[ATTR.RUN_STREAM_OUTCOME]).toBe('aborted');
    expect(rejections).toEqual([]);
  } finally {
    process.off('unhandledRejection', onRejection);
    await provider.shutdown();
  }
});

test('bounded by maxWaitMs when spans.jsonl never appears', async () => {
  // no writeSpans → run dir never created; must not hang
  await mkdir(join(root, 'r4'), { recursive: true });
  const res = await handleRunStream(
    'r4',
    { runsRoot: root },
    { pollMs: 10, maxWaitMs: 60 },
  );
  const frames = await collect(res);
  expect(frames).toEqual([]);
});
