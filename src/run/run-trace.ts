import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';
import { ATTR } from '../telemetry/spans.ts';

export async function readSpans(
  runDir: string,
): Promise<{ spans: SpanRecord[]; malformed: number }> {
  let raw: string;
  try {
    raw = await readFile(join(runDir, 'spans.jsonl'), 'utf8');
  } catch {
    return { spans: [], malformed: 0 };
  }
  const spans: SpanRecord[] = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      spans.push(JSON.parse(line) as SpanRecord);
    } catch {
      malformed += 1;
    }
  }
  return { spans, malformed };
}

export type TraceNode = { span: SpanRecord; children: TraceNode[] };

export function buildTree(spans: SpanRecord[]): TraceNode[] {
  const byId = new Map<string, TraceNode>();
  for (const s of spans) byId.set(s.spanId, { span: s, children: [] });
  const roots: TraceNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortByStart = (a: TraceNode, b: TraceNode) =>
    a.span.startUnixNano - b.span.startUnixNano;
  const sortDeep = (n: TraceNode) => {
    n.children.sort(sortByStart);
    for (const c of n.children) sortDeep(c);
  };
  roots.sort(sortByStart);
  for (const r of roots) sortDeep(r);
  return roots;
}

export type RunSummary = {
  id: string;
  startMs: number;
  durationMs: number;
  outcome: string;
  models: string[];
};

export async function summarizeRun(
  runsRoot: string,
  id: string,
): Promise<RunSummary | undefined> {
  const { spans } = await readSpans(join(runsRoot, id));
  if (spans.length === 0) return undefined;
  const root = spans.find((s) => s.name === 'agent.run');
  const models = new Set<string>();
  for (const s of spans) {
    const m = s.attributes[ATTR.MODEL_ID];
    if (typeof m === 'string') models.add(m);
  }
  return {
    id,
    startMs: (root ?? spans[0])?.startUnixNano
      ? Math.round(((root ?? spans[0]) as SpanRecord).startUnixNano / 1e6)
      : 0,
    durationMs: root?.durationMs ?? 0,
    outcome:
      typeof root?.attributes[ATTR.OUTCOME] === 'string'
        ? (root.attributes[ATTR.OUTCOME] as string)
        : 'unknown',
    models: [...models],
  };
}
