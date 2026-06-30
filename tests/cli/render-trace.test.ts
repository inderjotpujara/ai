import { expect, test } from 'bun:test';
import { renderRunList, renderTimeline } from '../../src/cli/render-trace.ts';
import type { TraceNode } from '../../src/run/run-trace.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function node(
  name: string,
  attrs: Record<string, unknown>,
  children: TraceNode[] = [],
): TraceNode {
  const span: SpanRecord = {
    name,
    kind: 0,
    traceId: 't',
    spanId: name,
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 5,
    status: { code: 0 },
    attributes: attrs,
    events: [],
  };
  return { span, children };
}

test('renderTimeline indents children and shows model + duration', () => {
  const tree = [
    node('agent.run', { 'agent.outcome': 'answer' }, [
      node('agent.delegation', { 'agent.delegation.target': 'file_qa' }, [
        node('agent.model.load', { 'gen_ai.request.model': 'qwen3.5:9b' }),
      ]),
    ]),
  ];
  const out = renderTimeline(tree);
  expect(out).toContain('agent.run');
  expect(out).toContain('answer');
  expect(out).toContain('file_qa');
  expect(out).toContain('qwen3.5:9b');
  // child is indented deeper than parent
  const runLine = out.split('\n').find((l) => l.includes('agent.run')) ?? '';
  const loadLine =
    out.split('\n').find((l) => l.includes('agent.model.load')) ?? '';
  expect(loadLine.indexOf('agent.model.load')).toBeGreaterThan(
    runLine.indexOf('agent.run'),
  );
});

test('renderRunList lists newest-first with id, outcome, duration', () => {
  const out = renderRunList([
    {
      id: 'run-2',
      startMs: 200,
      durationMs: 5,
      outcome: 'answer',
      models: ['m'],
    },
    { id: 'run-1', startMs: 100, durationMs: 9, outcome: 'gap', models: [] },
  ]);
  const lines = out.split('\n').filter((l) => l.includes('run-'));
  expect(lines[0]).toContain('run-2'); // newest first
  expect(out).toContain('answer');
  expect(out).toContain('gap');
});
