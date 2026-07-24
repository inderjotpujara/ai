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
  // Slice 32: a golden-set re-eval run (`eval.reeval`, opened by the eval turn /
  // `withEvalReevalSpan`) — its own top-level root, so `deriveRunKind` reads it
  // as `RunKind.Eval` and it never reads as perpetually in-flight.
  'eval.reeval',
  'mcp.mount',
  'memory.recall',
  'memory.ingest',
]);

// Top-level run roots that signal a run's OWN completion — EXCLUDES the ephemeral
// sub-run roots (mcp.mount / memory.recall / memory.ingest) that a chat/crew/workflow
// run emits as EARLY precursors (via withMcpRun / injectRecall) before its body.
// Those precursors land in spans.jsonl at run START (each span flushes on end), so
// keying "run finished?" off the full RUN_ROOT_NAMES set fires prematurely (at mount
// time) and mis-resolves the run root to whichever precursor ended first. The two CLI
// consumers (`summarizeRun` below, and the `--follow` stopper in src/cli/runs.ts) gate
// on THIS set instead. The web projection (run-dto.ts) keeps its own multi-root
// semantics and is intentionally not switched.
export const TERMINAL_RUN_ROOTS: ReadonlySet<string> = new Set([
  'agent.run',
  'chat.run',
  'crew.run',
  'workflow.run',
  'agent.build',
  'crew.build',
  'model.pull',
  // Slice 32: an eval run IS a terminal root (like chat.run/agent.run) — it
  // signals the eval run's OWN completion, not an ephemeral precursor — so the
  // CLI `--follow` stopper + `summarizeRun` classify + terminate on it.
  'eval.reeval',
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
  // Resolve the run root with PRECEDENCE. `spans` is in span-END order, so a
  // chat/crew/workflow run's ephemeral precursors (mcp.mount / memory.recall,
  // opened via withMcpRun / injectRecall BEFORE the body) end — and thus appear
  // — first. A plain `RUN_ROOT_NAMES.has` find would return the precursor's
  // durationMs/outcome, not the real root's. So prefer a TERMINAL_RUN_ROOTS
  // match (the run's own top-level root: chat.run / crew.run / …); only if none
  // is present fall back to any RUN_ROOT_NAMES root (a standalone pull / mcp /
  // memory run), then to spans[0] (never throw).
  const root =
    spans.find((s) => TERMINAL_RUN_ROOTS.has(s.name)) ??
    spans.find((s) => RUN_ROOT_NAMES.has(s.name));
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
