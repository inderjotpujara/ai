import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';
import { ATTR } from '../telemetry/spans.ts';

/**
 * A JSON-valid line whose SHAPE the projection cannot consume — e.g. `{}` (no
 * `attributes`/`name`/`status`/…) — must be isolated as malformed, NOT pushed:
 * otherwise the mapper does `undefined[ATTR.x]` / reads `.status.code` off
 * nothing and throws a `TypeError`, which (before this guard) 500'd the whole
 * `GET /api/runs` list because ONE bad line in ANY run's spans.jsonl bubbled
 * out. We validate exactly the fields the mappers touch (`spanId`, `name`,
 * `startUnixNano`, `durationMs`, `status.code`, `attributes`, `events`); a
 * record missing any of them is counted toward `malformed`, same as an
 * unparseable line.
 */
function isValidSpanRecord(v: unknown): v is SpanRecord {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const status = s.status as { code?: unknown } | undefined;
  return (
    typeof s.spanId === 'string' &&
    typeof s.name === 'string' &&
    typeof s.startUnixNano === 'number' &&
    typeof s.durationMs === 'number' &&
    typeof status === 'object' &&
    status !== null &&
    typeof status.code === 'number' &&
    typeof s.attributes === 'object' &&
    s.attributes !== null &&
    Array.isArray(s.events)
  );
}

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    // JSON-valid but wrong-shaped (e.g. `{}`) → isolate, don't let the mapper
    // dereference a missing field and throw.
    if (isValidSpanRecord(parsed)) spans.push(parsed);
    else malformed += 1;
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
    if (parent && parent !== node) parent.children.push(node);
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

/** Root span names that anchor a run: a chat turn (`chat.run`, D9), an
 *  agent/crew/workflow run, an agent/crew build (Phase 5), a model pull
 *  (Phase 5), a one-off MCP test-mount (`mcp.mount`), or a memory
 *  recall/ingest. This is the single source of truth for "which span names
 *  count as a run root", shared by the web projection (`run-dto.ts`, which
 *  re-exports it), the CLI `runs` list summary (`summarizeRun` below) and the
 *  `--follow` stopper (`src/cli/runs.ts`). Defined here — the dependency-free
 *  base module — so `run-dto.ts` (which imports from this file) can reuse it
 *  without a circular import. An unrecognized root leaves a run reading as
 *  perpetually in-flight (durationMs 0 / lifecycle Running), so every
 *  ephemeral-run root must be listed. */
export const RUN_ROOT_NAMES: ReadonlySet<string> = new Set([
  'chat.run',
  'agent.run',
  'crew.run',
  'workflow.run',
  'agent.build',
  'crew.build',
  'model.pull',
  'mcp.mount',
  'memory.recall',
  'memory.ingest',
]);

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
  // Find the run root by the shared RUN_ROOT_NAMES set (not just `agent.run`):
  // a chat turn writes `chat.run`, a crew/workflow writes `crew.run`/
  // `workflow.run`. Keying only off `agent.run` made those report durationMs 0
  // / outcome 'unknown' in the CLI `runs` list. Fall back to spans[0] when no
  // recognized root is present (never throw).
  const root = spans.find((s) => RUN_ROOT_NAMES.has(s.name));
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
