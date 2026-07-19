import { afterEach, beforeEach, expect, test } from 'bun:test';
import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerPool, type WorkerPool } from '../../../src/queue/pool.ts';
import { createJobStore, type JobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { readSpans } from '../../../src/run/run-trace.ts';
import { handleRunStream } from '../../../src/server/runs/stream.ts';
import type { SpanRecord } from '../../../src/telemetry/jsonl-exporter.ts';

/**
 * §7.1 SSE-reconcile gate (Slice 24 Incr 3). A run is now DETACHED onto the
 * worker pool — it starts (and emits spans to `runs/<runId>/spans.jsonl`) BEFORE
 * any client subscribes to `GET /api/runs/:id/stream`. This locks the property
 * that a LATE subscriber (one that connects after the run already emitted its
 * first spans) still receives the FULL, gap-free span sequence off the on-disk
 * journal, and that a disconnect → `Last-Event-ID` reconnect replays only the
 * spans the client had not yet seen — no dup, no gap.
 *
 * The harness runs a REAL `JobStore` + `WorkerPool` (the exact components
 * `startWebServer` self-hosts) with a test-injected dispatch whose executor
 * writes a KNOWN ordered span sequence to the run's journal over time. The run
 * therefore genuinely outlives the enqueue call and executes on a pool worker,
 * independent of any HTTP connection — the real detached-run topology. The SSE
 * side is exercised through `handleRunStream` (the exact handler the route
 * mounts) against a temp runsRoot, so the test isolates the reconcile property
 * from HTTP/auth noise irrelevant to it.
 */

// Nanosecond clock base for the synthetic journal. A run root (`agent.run`)
// STARTS first (smallest start) and ENDS last (largest end) — its children
// flush to the journal as they end, so on disk the children precede the root
// even though the flattened DTO lists the root first (depth-0). This is the
// exact ordering a real nested run produces and is what makes the
// Last-Event-ID reconnect path non-trivial.
const NANOS = 1_000_000; // 1ms in nanos
const ROOT_START = 10 * NANOS;

function childSpan(i: number): SpanRecord {
  const start = ROOT_START + i * NANOS;
  const end = start + NANOS / 2;
  return {
    name: 'agent.step',
    kind: 0,
    traceId: 't',
    spanId: `c${i}`,
    parentSpanId: 'root',
    startUnixNano: start,
    endUnixNano: end,
    durationMs: (end - start) / NANOS,
    status: { code: 0 },
    attributes: {},
    events: [],
  };
}

function rootSpan(childCount: number): SpanRecord {
  // Ends AFTER every child — largest endUnixNano, so it lands last on disk.
  const end = ROOT_START + (childCount + 5) * NANOS;
  return {
    name: 'agent.run',
    kind: 0,
    traceId: 't',
    spanId: 'root',
    parentSpanId: null,
    startUnixNano: ROOT_START,
    endUnixNano: end,
    durationMs: (end - ROOT_START) / NANOS,
    status: { code: 0 },
    attributes: { 'agent.outcome': 'answer' },
    events: [],
  };
}

/** Append one span as a JSONL line to the run's on-disk journal — the same
 *  file+format the real telemetry exporter writes. */
async function appendSpan(dir: string, span: SpanRecord): Promise<void> {
  await appendFile(join(dir, 'spans.jsonl'), `${JSON.stringify(span)}\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the on-disk journal until it holds at least `n` spans — used to
 *  deterministically subscribe AFTER the run has already emitted. */
async function waitForSpans(dir: string, n: number): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    const { spans } = await readSpans(dir);
    if (spans.length >= n) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${n} spans in ${dir}`);
}

type Frame = { id: string; data: unknown };

/** Read SSE `{id,data}` frames from a Response body until the stream closes. */
async function collectAll(res: Response): Promise<Frame[]> {
  const out: Frame[] = [];
  await drain(res, out, () => false);
  return out;
}

/** Read frames until `stop(out)` returns true (or the stream closes), leaving
 *  the connection open so the caller can `.cancel()` it — simulates a client
 *  that disconnects mid-run. */
async function readUntil(
  res: Response,
  stop: (out: Frame[]) => boolean,
): Promise<{ frames: Frame[]; cancel: () => Promise<void> }> {
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
    buf = pushFrames(buf, out);
    if (stop(out)) break;
  }
  return { frames: out, cancel: () => reader.cancel() };
}

async function drain(
  res: Response,
  out: Frame[],
  stop: (out: Frame[]) => boolean,
): Promise<void> {
  const body = res.body;
  if (!body) throw new Error('response has no body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = pushFrames(buf, out);
    if (stop(out)) break;
  }
}

/** Split complete `\n\n`-terminated SSE frames out of `buf`, appending each to
 *  `out`; returns the unconsumed tail. */
function pushFrames(buf: string, out: Frame[]): string {
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
  return buf;
}

let runsRoot: string;
let jobStore: JobStore;
let pool: WorkerPool;

beforeEach(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), 'sse-recon-'));
  jobStore = createJobStore({ path: join(runsRoot, 'jobs.db') }, {});
});

afterEach(async () => {
  await pool?.stop();
  jobStore.close();
  await rm(runsRoot, { recursive: true, force: true });
});

const CHILDREN = 4;

test('late subscriber (run already started on the pool) still gets the FULL, gap-free span sequence', async () => {
  // The detached executor writes c1..c4 (each as it "ends"), then the run root
  // last. It gates between the first child and the rest so the test can prove
  // it subscribes AFTER the run has already emitted, yet still sees c1.
  let released = () => {};
  const gate = new Promise<void>((r) => {
    released = r;
  });

  const dispatch = () => async (job: { runId?: string }) => {
    const dir = join(runsRoot, job.runId ?? '');
    await mkdir(dir, { recursive: true });
    await appendSpan(dir, childSpan(1)); // pre-subscribe span
    await gate; // hold until the client has subscribed late
    for (let i = 2; i <= CHILDREN; i += 1) {
      await appendSpan(dir, childSpan(i));
      await sleep(15);
    }
    await appendSpan(dir, rootSpan(CHILDREN)); // terminal → lifecycle Done
    return {};
  };

  pool = createWorkerPool({
    store: jobStore,
    concurrency: 1,
    dispatch,
    pollMs: 5,
  });
  pool.start();

  const rec = jobStore.enqueue({
    kind: JobKind.Crew,
    payload: { name: 'c', input: 'go' },
  });
  const runId = rec.runId;
  if (!runId) throw new Error('enqueue did not mint a runId');
  const dir = join(runsRoot, runId);

  // Subscribe LATE: only after the run has already written its first span.
  await waitForSpans(dir, 1);
  const res = await handleRunStream(
    runId,
    { runsRoot },
    { pollMs: 10, maxWaitMs: 5_000 },
  );
  released(); // let the rest of the run stream out while we tail

  const frames = await collectAll(res);
  const ids = frames.map((f) => f.id);

  // No gap: every spanId the run produced (including the pre-subscribe c1) is
  // delivered exactly once, in wire order, ending on the terminal run root.
  expect(ids).toEqual(['c1', 'c2', 'c3', 'c4', 'root']);
  // The terminal frame is the run root and reports the run's outcome.
  const last = frames.at(-1);
  expect((last?.data as { name: string }).name).toBe('agent.run');
});

test('disconnect mid-run → Last-Event-ID reconnect replays only newer spans (no dup, no gap)', async () => {
  // Gate the executor AFTER it has emitted the first two children so the first
  // connection reads c1,c2 LIVE (wire order = children-first) and disconnects
  // BEFORE the root exists. The root is then written while disconnected — the
  // exact race where a naive DTO-index reseed would drop the late-written root.
  let released = () => {};
  const gate = new Promise<void>((r) => {
    released = r;
  });
  let finished = () => {};
  const done = new Promise<void>((r) => {
    finished = r;
  });

  const dispatch = () => async (job: { runId?: string }) => {
    const dir = join(runsRoot, job.runId ?? '');
    await mkdir(dir, { recursive: true });
    await appendSpan(dir, childSpan(1));
    await appendSpan(dir, childSpan(2));
    await gate; // hold until connection 1 has read c1,c2 and disconnected
    for (let i = 3; i <= CHILDREN; i += 1) await appendSpan(dir, childSpan(i));
    await appendSpan(dir, rootSpan(CHILDREN));
    finished();
    return {};
  };

  pool = createWorkerPool({
    store: jobStore,
    concurrency: 1,
    dispatch,
    pollMs: 5,
  });
  pool.start();

  const rec = jobStore.enqueue({
    kind: JobKind.Crew,
    payload: { name: 'c', input: 'go' },
  });
  const runId = rec.runId;
  if (!runId) throw new Error('enqueue did not mint a runId');
  const dir = join(runsRoot, runId);

  // Connection 1: subscribe live, read the two available children, disconnect.
  await waitForSpans(dir, 2);
  const conn1 = await handleRunStream(
    runId,
    { runsRoot },
    { pollMs: 10, maxWaitMs: 5_000 },
  );
  const { frames: first, cancel } = await readUntil(
    conn1,
    (out) => out.length >= 2,
  );
  expect(first.map((f) => f.id)).toEqual(['c1', 'c2']);
  const cursor = first.at(-1)?.id; // 'c2' — a child, root not yet seen
  await cancel();

  // Release the rest of the run (root written while the client is disconnected).
  released();
  await done;

  // Connection 2: reconnect with Last-Event-ID = c2. Must replay ONLY what the
  // client had not seen: c3, c4, and the late-written root — no dup of c1/c2,
  // and critically NO GAP (the root must not be treated as already-seen just
  // because it sorts first in the flattened DTO).
  const conn2 = await handleRunStream(
    runId,
    { runsRoot },
    { lastEventId: cursor, pollMs: 10, maxWaitMs: 5_000 },
  );
  const resumed = await collectAll(conn2);
  const ids = resumed.map((f) => f.id);

  // No dup: the already-seen c1/c2 are not resent, and nothing repeats.
  expect(ids).not.toContain('c1');
  expect(ids).not.toContain('c2');
  expect(new Set(ids).size).toBe(ids.length);
  // No gap: every span the client had NOT seen replays — c3, c4, AND the
  // late-written terminal root (dropped before the fix because it sorts first
  // in the flattened DTO). A batch reconnect against a completed run emits the
  // remaining snapshot in DTO order, so exact wire order is not asserted here —
  // completeness is the property.
  expect([...ids].sort()).toEqual(['c3', 'c4', 'root']);
});
