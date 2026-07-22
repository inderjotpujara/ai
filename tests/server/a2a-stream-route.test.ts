import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { A2aAllowlist, ResolvedTarget } from '../../src/a2a/allowlist.ts';
import type { A2aServerDeps } from '../../src/a2a/server.ts';
import { createTaskIndex } from '../../src/a2a/task-index.ts';
import { A2aMethod } from '../../src/contracts/index.ts';
import type { JobStore } from '../../src/queue/store.ts';
import {
  type JobInput,
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../src/queue/types.ts';
import {
  handleA2aStream,
  parseSpanFrame,
} from '../../src/server/a2a/stream-route.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

// ---- fakes ------------------------------------------------------------------

function fakeAllowlist(table: Record<string, ResolvedTarget>): A2aAllowlist {
  return {
    list: () => [],
    put: () => {},
    remove: () => {},
    resolve: (skillId: string) => table[skillId],
  };
}

function baseRecord(id: string): JobRecord {
  return {
    id,
    kind: JobKind.Chat,
    payload: {},
    priority: JobPriority.Normal,
    status: JobStatus.Queued,
    attempts: 0,
    maxAttempts: 1,
    createdAt: 0,
    updatedAt: 0,
    startedAt: undefined,
    finishedAt: undefined,
    availableAt: 0,
    runId: undefined,
    result: undefined,
    error: undefined,
    retriedFrom: null,
    origin: undefined,
    chainDepth: 0,
  };
}

function fakeJobStore() {
  const jobs = new Map<string, JobRecord>();
  let seq = 0;
  const store = {
    enqueue(input: JobInput): JobRecord {
      const id = `job-${++seq}`;
      const rec: JobRecord = {
        ...baseRecord(id),
        kind: input.kind,
        payload: input.payload,
        runId: input.runId,
        origin: input.origin,
      };
      jobs.set(id, rec);
      return rec;
    },
    getJob: (id: string) => jobs.get(id),
    markCanceled: () => {},
  };
  return { store: store as unknown as JobStore, jobs };
}

function harness() {
  const js = fakeJobStore();
  const runsRoot = tmpRoot;
  const deps: A2aServerDeps = {
    allowlist: fakeAllowlist({ ask: { kind: JobKind.Chat, ref: 'file_qa' } }),
    // These tests call the stream handler directly (past the route gate); a stub
    // enrollment satisfies the required field without being consulted.
    enrollment: {
      issue: () => ({ id: '', token: '' }),
      verify: () => false,
      revoke: () => {},
      list: () => [],
    },
    jobStore: js.store,
    runsRoot,
    taskIndex: createTaskIndex(),
  };
  return { deps, js };
}

function spanRec(
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
  } as SpanRecord;
}

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'a2a-strm-'));
});
afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writeSpans(runId: string, spans: SpanRecord[]): Promise<void> {
  const dir = join(tmpRoot, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'spans.jsonl'),
    `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`,
  );
}

type Frame = { id?: string; data: Record<string, unknown> };

async function collect(res: Response): Promise<Frame[]> {
  const out: Frame[] = [];
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
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let id: string | undefined;
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length) {
        out.push({
          id,
          data: JSON.parse(data.join('\n')) as Record<string, unknown>,
        });
      }
      sep = buf.indexOf('\n\n');
    }
  }
  return out;
}

const streamReq = (headers?: Record<string, string>): Request =>
  new Request('http://agent.local/api/a2a', { method: 'POST', headers });

function msg(text: string): unknown {
  return { role: 'user', parts: [{ kind: 'text', text }], messageId: 'm1' };
}

// A delegation child (framer → progress artifact) that ENDS BEFORE the root.
const childSpan = spanRec({
  name: 'agent.delegation',
  spanId: 'd1',
  parentSpanId: null,
  startUnixNano: 1_000_000, // +1ms
  endUnixNano: 2_000_000,
  durationMs: 1,
  attributes: { 'agent.delegation.target': 'researcher' },
});
// The run root ENDS LAST (largest end offset), status ok, outcome=answer.
const rootSpan = spanRec({
  name: 'chat.run',
  spanId: 'root',
  parentSpanId: null,
  startUnixNano: 0,
  endUnixNano: 100_000_000, // +100ms — ends after the child
  durationMs: 100,
  status: { code: 0 },
  attributes: { 'agent.outcome': 'answer' },
});

// ---- tests ------------------------------------------------------------------

test('message/stream re-frames the run: submitted → working → progress artifact → answer artifact → completed(final)', async () => {
  const { deps, js } = harness();
  const res = await handleA2aStream(
    { message: msg('summarize this'), metadata: { skillId: 'ask' } },
    A2aMethod.MessageStream,
    streamReq(),
    deps,
  );
  expect(res.headers.get('content-type')).toContain('text/event-stream');

  // Capture the run the enqueue pre-minted, then simulate it streaming:
  // the child flushes first (in-flight), the root flushes when the run completes.
  const job = [...js.jobs.values()][0];
  if (!job?.runId) throw new Error('expected an enqueued job with a runId');
  await writeSpans(job.runId, [childSpan]);
  setTimeout(() => {
    // Run completes: the terminal result lands on the job, then the root flushes.
    job.status = JobStatus.Done;
    job.result = { kind: 'answer', text: 'the summary' };
    void writeSpans(job.runId as string, [childSpan, rootSpan]);
  }, 40);

  const frames = await collect(res);
  const kinds = frames.map((f) => f.data.kind);
  // submitted then working open the stream (synthetic, no id).
  expect(kinds[0]).toBe('status-update');
  expect(frames[0]?.data.status).toMatchObject({ state: 'submitted' });
  expect(frames[1]?.data.status).toMatchObject({ state: 'working' });
  // an artifact appears in the stream
  expect(kinds).toContain('artifact-update');
  // the answer text artifact carries the real answer text, and is IMMEDIATELY
  // followed by the terminal completed status-update (A2A artifact→completed
  // order; both frame the same run-root, emitted back-to-back).
  const answerIdx = frames.findIndex(
    (f) =>
      f.data.kind === 'artifact-update' &&
      JSON.stringify(f.data).includes('the summary'),
  );
  if (answerIdx === -1) {
    throw new Error('expected an answer artifact carrying the text');
  }
  const completed = frames[answerIdx + 1];
  expect(completed?.data).toMatchObject({
    kind: 'status-update',
    status: { state: 'completed' },
    final: true,
  });
  expect(completed?.id).toBe('root'); // keyed by the root span id
});

test('the terminal completed frame is never dropped when the run completes', async () => {
  const { deps, js } = harness();
  const res = await handleA2aStream(
    { message: msg('do it'), metadata: { skillId: 'ask' } },
    A2aMethod.MessageStream,
    streamReq(),
    deps,
  );
  const job = [...js.jobs.values()][0];
  if (!job?.runId) throw new Error('expected an enqueued job with a runId');
  await writeSpans(job.runId, [childSpan]);
  setTimeout(() => {
    job.status = JobStatus.Done;
    job.result = { kind: 'answer', text: 'done' };
    void writeSpans(job.runId as string, [childSpan, rootSpan]);
  }, 40);
  const frames = await collect(res);
  const terminal = frames.filter(
    (f) => f.data.kind === 'status-update' && f.data.final === true,
  );
  expect(terminal).toHaveLength(1);
  expect(terminal[0]?.data.status).toMatchObject({ state: 'completed' });
});

test('message/stream to an UNLISTED skill fails fast (no SSE stream, no enqueue)', async () => {
  const { deps, js } = harness();
  const res = await handleA2aStream(
    { message: msg('hi'), metadata: { skillId: 'ghost' } },
    A2aMethod.MessageStream,
    streamReq(),
    deps,
  );
  expect(res.headers.get('content-type')).not.toContain('text/event-stream');
  expect(js.jobs.size).toBe(0);
});

test('tasks/resubscribe replays only frames NEWER than Last-Event-ID (cursor child not resent; terminal present)', async () => {
  const { deps, js } = harness();
  // A completed run already on disk. taskId === jobId.
  const runId = 'run-resub';
  js.jobs.set('job-resub', {
    ...baseRecord('job-resub'),
    status: JobStatus.Done,
    runId,
    result: { kind: 'answer', text: 'resub answer' },
  });
  deps.taskIndex.bind('job-resub', 'job-resub', 'ctx-resub');
  await writeSpans(runId, [rootSpan, childSpan]);

  // Reconnect with the CHILD as the cursor — only the root (which ends later)
  // should replay: the completed terminal frame, and NOT the child's progress.
  const res = await handleA2aStream(
    { id: 'job-resub' },
    A2aMethod.TasksResubscribe,
    streamReq({ 'Last-Event-ID': 'd1' }),
    deps,
  );
  const frames = await collect(res);
  const ids = frames.map((f) => f.id);
  expect(ids).not.toContain('d1'); // the acked cursor span is not resent
  // The terminal completed frame IS replayed (never dropped on reconnect).
  const terminal = frames.find(
    (f) => f.data.kind === 'status-update' && f.data.final === true,
  );
  if (!terminal) throw new Error('expected the terminal frame on replay');
  expect(terminal.data.status).toMatchObject({ state: 'completed' });
  expect(terminal.id).toBe('root');
  // No synthetic submitted/working on a reconnect.
  expect(
    frames.some(
      (f) =>
        f.data.status &&
        (f.data.status as { state: string }).state === 'submitted',
    ),
  ).toBe(false);
});

test('same-poll (message/stream fast path): child progress precedes final:true, and final:true is the LAST frame', async () => {
  const { deps, js } = harness();
  const res = await handleA2aStream(
    { message: msg('go'), metadata: { skillId: 'ask' } },
    A2aMethod.MessageStream,
    streamReq(),
    deps,
  );
  const job = [...js.jobs.values()][0];
  if (!job?.runId) throw new Error('expected an enqueued job with a runId');
  // The run completes BEFORE the first poll: root + child land in ONE snapshot
  // (written in a single file write, so a poll sees both together). The run
  // root sorts FIRST in the depth-first DTO, so a naive framer would emit its
  // completed(final:true) BEFORE the child's progress artifact.
  job.status = JobStatus.Done;
  job.result = { kind: 'answer', text: 'fast answer' };
  await writeSpans(job.runId, [childSpan, rootSpan]);

  const frames = await collect(res);
  const childIdx = frames.findIndex((f) => f.id === 'd1'); // child progress
  const finalIdx = frames.findIndex((f) => f.data.final === true);
  expect(childIdx).toBeGreaterThanOrEqual(0);
  expect(finalIdx).toBeGreaterThanOrEqual(0);
  // the child progress artifact is emitted BEFORE the terminal completed frame
  expect(childIdx).toBeLessThan(finalIdx);
  // final:true is genuinely the LAST frame in the stream
  expect(finalIdx).toBe(frames.length - 1);
  // exactly one terminal frame (never dropped, never duplicated)
  expect(frames.filter((f) => f.data.final === true)).toHaveLength(1);
});

test('resubscribe on a Done run (whole snapshot in ONE poll): final:true is the LAST frame', async () => {
  const { deps, js } = harness();
  const runId = 'run-resub-order';
  js.jobs.set('job-ro', {
    ...baseRecord('job-ro'),
    status: JobStatus.Done,
    runId,
    result: { kind: 'answer', text: 'ro answer' },
  });
  deps.taskIndex.bind('job-ro', 'job-ro', 'ctx-ro');
  // Root written first (also sorts first in the DTO); child ends earlier. No
  // Last-Event-ID → the full snapshot replays in a single poll, so root and
  // child are re-framed within the same poll.
  await writeSpans(runId, [rootSpan, childSpan]);

  const res = await handleA2aStream(
    { id: 'job-ro' },
    A2aMethod.TasksResubscribe,
    streamReq(),
    deps,
  );
  const frames = await collect(res);
  const childIdx = frames.findIndex((f) => f.id === 'd1');
  const finalIdx = frames.findIndex((f) => f.data.final === true);
  expect(childIdx).toBeGreaterThanOrEqual(0);
  expect(childIdx).toBeLessThan(finalIdx);
  expect(finalIdx).toBe(frames.length - 1); // final:true genuinely last
});

test('parseSpanFrame SKIPS a non-JSON upstream data line (returns undefined) instead of throwing — one bad line must not abort the A2A stream and drop the buffered terminal frame', () => {
  // A well-formed SpanDTO data line parses to the span (re-framed normally).
  const goodLine = JSON.stringify({
    spanId: 'root',
    parentSpanId: null,
    name: 'chat.run',
    offsetMs: 0,
    durationMs: 100,
    depth: 0,
    status: 'ok',
    degraded: false,
    attributes: {},
    events: [],
  });
  const good = parseSpanFrame(goodLine);
  expect(good).toBeDefined();
  expect(good?.spanId).toBe('root');

  // A non-JSON line (a truncated / heartbeat / future-format upstream line) is
  // SKIPPED — returns undefined, never throws (which would bubble to the reader
  // catch and close the stream, losing the buffered final:true terminal frame).
  expect(parseSpanFrame('this is : not json {')).toBeUndefined();
  expect(parseSpanFrame('')).toBeUndefined();
  // Valid JSON but not a SpanDTO shape → also skipped (mirrors safeParse).
  expect(parseSpanFrame('{"not":"a span"}')).toBeUndefined();
});

test('a streaming reject returns a JSON-RPC error envelope (jsonrpc/id/error)', async () => {
  const { deps, js } = harness();
  const res = await handleA2aStream(
    { message: msg('hi'), metadata: { skillId: 'ghost' } },
    A2aMethod.MessageStream,
    streamReq(),
    deps,
    'req-77', // the JSON-RPC id to echo
  );
  expect(res.headers.get('content-type')).not.toContain('text/event-stream');
  expect(js.jobs.size).toBe(0);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    jsonrpc: '2.0',
    id: 'req-77',
    error: { code: expect.any(Number), message: expect.any(String) },
  });
});
