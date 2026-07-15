### Task 10: `withRunStreamSpan` + `handleRunStream` (SSE snapshot-then-tail)

**Files:**
- Modify: `src/telemetry/spans.ts` (add `RUN_STREAM_*` ATTR keys + `withRunStreamSpan`)
- Create: `src/server/runs/stream.ts`
- Test: `tests/telemetry/run-stream-span.test.ts`, `tests/server/runs-stream.test.ts`

**Interfaces:**
- Produces (telemetry): new ATTR keys `RUN_STREAM_CHUNKS='run.stream.chunks'`, `RUN_STREAM_BYTES='run.stream.bytes'`, `RUN_STREAM_RESUMES='run.stream.resumes'`, `RUN_STREAM_OUTCOME='run.stream.outcome'`, `RUN_STREAM_RUN_ID='run.stream.run_id'`; and `withRunStreamSpan(info: { route: string; runId: string }, fn: (rec: { chunk(bytes): void; resume(): void; outcome(o): void }) => Promise<T>): Promise<T>` — opens a `runs.stream` span, aggregates chunks/bytes/resumes/outcome in a `finally` (mirror `withUiStreamSpan` at `spans.ts:259`).
- Produces (server): `handleRunStream(id, deps, opts): Promise<Response>` where `opts = { lastEventId?: string; signal?: AbortSignal; pollMs?: number; maxWaitMs?: number }`. `confineToDir` guard → 404. Otherwise a `text/event-stream` Response whose body: (a) emits each `RunDTO.spans` entry as an SSE frame `id: <spanId>\ndata: <SpanDTO json>\n\n` (snapshot), tracking emitted `spanId`s; (b) polls (`mapRunToDto` every `pollMs`, default 250) emitting only new spans until `lifecycle !== Running` (root closed — same stop signal the CLI `--follow` uses) then records outcome + closes; (c) on `lastEventId`, seeds the emitted set with every span up to and including that id from the first snapshot and calls `rec.resume()` (replay only newer). Bounded by `maxWaitMs` (default 600_000) and `signal` abort. Wrapped in `withRunStreamSpan`.

- [ ] **Step 1a: Telemetry test** — `tests/telemetry/run-stream-span.test.ts` (mirror `ui-stream-span.test.ts` exactly — same helper import path `../helpers/otel-test-provider.ts`, same `exporter.getFinishedSpans()` accessor):

```ts
import { describe, expect, it } from 'bun:test';
import { ATTR, withRunStreamSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('runs.stream span', () => {
  it('aggregates chunks/bytes/resumes/outcome + runId', async () => {
    const { exporter, provider } = registerTestProvider();
    await withRunStreamSpan(
      { route: '/api/runs/r1/stream', runId: 'r1' },
      async (rec) => {
        rec.chunk(10);
        rec.chunk(20);
        rec.resume();
        rec.outcome('done');
      },
    );
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runs.stream');
    expect(span?.attributes[ATTR.RUN_STREAM_CHUNKS]).toBe(2);
    expect(span?.attributes[ATTR.RUN_STREAM_BYTES]).toBe(30);
    expect(span?.attributes[ATTR.RUN_STREAM_RESUMES]).toBe(1);
    expect(span?.attributes[ATTR.RUN_STREAM_OUTCOME]).toBe('done');
    expect(span?.attributes[ATTR.RUN_STREAM_RUN_ID]).toBe('r1');
    await provider.shutdown();
  });
});
```

- [ ] **Step 1b: Impl telemetry** — add the five ATTR keys next to the `UI_STREAM_*` block (`spans.ts:155-158`) and `withRunStreamSpan` right after `withUiStreamSpan` (`spans.ts:293`):

```ts
export function withRunStreamSpan<T>(
  info: { route: string; runId: string },
  fn: (rec: {
    chunk: (bytes: number) => void;
    resume: () => void;
    outcome: (o: string) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('runs.stream', async (span) => {
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    span.setAttribute(ATTR.RUN_STREAM_RUN_ID, info.runId);
    let chunks = 0;
    let bytes = 0;
    let resumes = 0;
    let outcome = 'unknown';
    try {
      return await fn({
        chunk: (b) => {
          chunks += 1;
          bytes += b;
        },
        resume: () => {
          resumes += 1;
        },
        outcome: (o) => {
          outcome = o;
        },
      });
    } finally {
      span.setAttribute(ATTR.RUN_STREAM_CHUNKS, chunks);
      span.setAttribute(ATTR.RUN_STREAM_BYTES, bytes);
      span.setAttribute(ATTR.RUN_STREAM_RESUMES, resumes);
      span.setAttribute(ATTR.RUN_STREAM_OUTCOME, outcome);
    }
  });
}
```

- [ ] **Step 1c: Gate telemetry** — `bun test --path-ignore-patterns 'web/**' tests/telemetry/run-stream-span.test.ts` → PASS; `bun run typecheck`.

- [ ] **Step 2: Server stream test** — `tests/server/runs-stream.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRunStream } from '../../src/server/runs/stream.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(p: Partial<SpanRecord> & { name: string; spanId: string }): SpanRecord {
  return { kind: 0, traceId: 't', parentSpanId: null, startUnixNano: 0, endUnixNano: 1_000_000, durationMs: 1, status: { code: 0 }, attributes: {}, events: [], ...p };
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
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
}

/** Collect SSE `{id,data}` frames from a Response body until it closes. */
async function collect(res: Response): Promise<{ id: string; data: unknown }[]> {
  const out: { id: string; data: unknown }[] = [];
  const reader = res.body!.getReader();
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

test('snapshot then tail: emits existing spans, then a newly-appended span, then closes on root close', async () => {
  // in-flight: no agent.run yet → Running → keeps tailing
  await writeSpans('r1', [span({ name: 'agent.delegation', spanId: 's1' })]);
  const res = await handleRunStream('r1', { runsRoot: root }, { pollMs: 20, maxWaitMs: 5_000 });
  // append the root while the stream tails → run becomes Done → stream closes
  setTimeout(() => {
    void writeSpans('r1', [
      span({ name: 'agent.delegation', spanId: 's1' }),
      span({ name: 'agent.run', spanId: 'root', attributes: { 'agent.outcome': 'answer' } }),
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
    span({ name: 'agent.run', spanId: 'a', attributes: { 'agent.outcome': 'answer' } }),
    span({ name: 'x', spanId: 'b', parentSpanId: 'a' }),
  ]);
  // full run (Done) closes immediately after snapshot
  const first = await collect(await handleRunStream('r2', { runsRoot: root }, { pollMs: 20 }));
  const firstId = first[0]!.id;
  const resumed = await collect(
    await handleRunStream('r2', { runsRoot: root }, { lastEventId: firstId, pollMs: 20 }),
  );
  expect(resumed.map((f) => f.id)).not.toContain(firstId);
  expect(resumed.length).toBeLessThan(first.length);
});
```

- [ ] **Step 3: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-stream.test.ts` → FAIL (module missing).

- [ ] **Step 4: Minimal impl** — `src/server/runs/stream.ts`:

```ts
import { mapRunToDto } from '../../run/run-dto.ts';
import { RunLifecycle, type SpanDTO } from '../../contracts/index.ts';
import { withRunStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunsDeps } from './detail.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function frame(span: SpanDTO): string {
  return `id: ${span.spanId}\ndata: ${JSON.stringify(span)}\n\n`;
}

export type RunStreamOpts = {
  lastEventId?: string;
  signal?: AbortSignal;
  pollMs?: number;
  maxWaitMs?: number;
};

export async function handleRunStream(
  id: string,
  deps: RunsDeps,
  opts: RunStreamOpts,
): Promise<Response> {
  try {
    confineToDir(id, deps.runsRoot);
  } catch (err) {
    if (err instanceof MediaPathError) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
      });
    }
    throw err;
  }

  const pollMs = opts.pollMs ?? 250;
  const maxWaitMs = opts.maxWaitMs ?? 600_000;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void withRunStreamSpan(
        { route: `/api/runs/${id}/stream`, runId: id },
        async (rec) => {
          const emitted = new Set<string>();
          let seededResume = false;
          const deadline = Date.now() + maxWaitMs;
          try {
            for (;;) {
              if (opts.signal?.aborted || Date.now() > deadline) {
                rec.outcome('aborted');
                break;
              }
              const dto = await mapRunToDto(deps.runsRoot, id);
              if (dto) {
                // Resume: on the first snapshot, mark everything up to and
                // including lastEventId as already-emitted so only newer spans go.
                if (!seededResume && opts.lastEventId) {
                  seededResume = true;
                  rec.resume();
                  for (const s of dto.spans) {
                    emitted.add(s.spanId);
                    if (s.spanId === opts.lastEventId) break;
                  }
                }
                for (const s of dto.spans) {
                  if (emitted.has(s.spanId)) continue;
                  emitted.add(s.spanId);
                  const text = frame(s);
                  controller.enqueue(encoder.encode(text));
                  rec.chunk(text.length);
                }
                if (dto.lifecycle !== RunLifecycle.Running) {
                  rec.outcome(dto.outcome);
                  break;
                }
              }
              await sleep(pollMs);
            }
          } catch (err) {
            rec.outcome('error');
            // Degrade: end the stream with the last known spans, never crash.
            void err;
          } finally {
            controller.close();
          }
        },
      );
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      ...ISOLATION_HEADERS,
    },
  });
}
```

- [ ] **Step 5: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/server/runs-stream.test.ts` → PASS.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/telemetry/spans.ts" "src/server/runs/stream.ts" "tests/telemetry/run-stream-span.test.ts" "tests/server/runs-stream.test.ts"
git add src/telemetry/spans.ts src/server/runs/stream.ts tests/telemetry/run-stream-span.test.ts tests/server/runs-stream.test.ts
git commit -m "feat(server): runs.stream span + handleRunStream (SSE snapshot-then-tail + Last-Event-ID resume)"
```

---

