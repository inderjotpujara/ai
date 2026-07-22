import { expect, test } from 'bun:test';
import { frameRunSpanAsA2a } from '../../src/a2a/stream.ts';
import { type SpanDTO, SpanStatus } from '../../src/contracts/index.ts';

const CTX = { taskId: 'task-1', contextId: 'ctx-1' };

/** Minimal SpanDTO factory — only the fields the framer inspects matter. */
function spanDto(
  p: Partial<SpanDTO> & { spanId: string; name: string },
): SpanDTO {
  return {
    parentSpanId: null,
    offsetMs: 0,
    durationMs: 1,
    depth: 0,
    status: SpanStatus.Ok,
    degraded: false,
    attributes: {},
    events: [],
    ...p,
  };
}

/** Parse one SSE frame string → { id?, data }. */
function parseFrame(frame: string): { id?: string; data: unknown } {
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  return { id, data: JSON.parse(data.join('\n')) };
}

test('a run-root span (ok) frames as a terminal completed status-update, keyed by spanId', () => {
  const frame = frameRunSpanAsA2a(
    spanDto({ spanId: 'root', name: 'chat.run', status: SpanStatus.Ok }),
    CTX,
  );
  if (frame === undefined) throw new Error('expected a frame');
  const { id, data } = parseFrame(frame);
  expect(id).toBe('root'); // keyed by wire id so Last-Event-ID replay works
  expect(data).toMatchObject({
    taskId: 'task-1',
    contextId: 'ctx-1',
    kind: 'status-update',
    status: { state: 'completed' },
    final: true,
  });
});

test('a run-root span (error) frames as a terminal failed status-update', () => {
  const frame = frameRunSpanAsA2a(
    spanDto({ spanId: 'root', name: 'workflow.run', status: SpanStatus.Error }),
    CTX,
  );
  if (frame === undefined) throw new Error('expected a frame');
  const { data } = parseFrame(frame);
  expect(data).toMatchObject({
    kind: 'status-update',
    status: { state: 'failed' },
    final: true,
  });
});

test('a delegation span frames as a TaskArtifactUpdate with a data part (progress)', () => {
  const frame = frameRunSpanAsA2a(
    spanDto({
      spanId: 'd1',
      name: 'agent.delegation',
      agent: 'researcher',
      delegation: { target: 'researcher', depth: 1, ancestors: ['researcher'] },
    }),
    CTX,
  );
  if (frame === undefined) throw new Error('expected a frame');
  const { id, data } = parseFrame(frame);
  expect(id).toBe('d1');
  expect(data).toMatchObject({
    taskId: 'task-1',
    kind: 'artifact-update',
    append: true,
    lastChunk: false,
  });
  const art = (
    data as { artifact: { parts: { kind: string; data?: unknown }[] } }
  ).artifact;
  expect(art.parts[0]?.kind).toBe('data');
  expect(art.parts[0]?.data).toMatchObject({ agent: 'researcher' });
});

test('a plain non-root span with no A2A meaning is skipped (undefined)', () => {
  const frame = frameRunSpanAsA2a(
    spanDto({ spanId: 's', name: 'agent.model.load' }),
    CTX,
  );
  expect(frame).toBeUndefined();
});

test('an ephemeral precursor root (mcp.mount) does NOT emit a premature completed frame', () => {
  // mcp.mount / memory.* roots flush at run START (precursors). Framing them as
  // a terminal completed status-update would close the A2A task before the real
  // run root ends — the Slice-24-adjacent premature-terminal bug. They carry no
  // delegation, so the framer skips them.
  const frame = frameRunSpanAsA2a(
    spanDto({ spanId: 'm', name: 'mcp.mount', status: SpanStatus.Ok }),
    CTX,
  );
  expect(frame).toBeUndefined();
});
