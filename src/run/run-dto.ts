import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type DegradeDTO,
  DegradeKind,
  type RunDTO,
  RunDtoSchema,
  RunLifecycle,
  RunOrigin,
  type SpanDTO,
  SpanStatus,
} from '../contracts/index.ts';
import type { DegradeEvent } from '../reliability/ledger.ts';
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';
import { ATTR } from '../telemetry/spans.ts';
import { readRunArtifacts } from './artifacts.ts';
import { buildTree, readSpans, type TraceNode } from './run-trace.ts';

const NANOS_PER_MS = 1e6;
const OTEL_STATUS_ERROR = 2;

/** Human label per DegradeKind (mapper-side; the ledger's LABEL map is not exported). */
const DEGRADE_LABEL: Record<DegradeKind, string> = {
  [DegradeKind.ModelDegraded]: 'degraded model',
  [DegradeKind.AgentDropped]: 'dropped agent',
  [DegradeKind.ToolSkipped]: 'skipped tool',
  [DegradeKind.Retried]: 'retried',
  [DegradeKind.CircuitOpen]: 'circuit open',
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function tokensOf(attrs: Record<string, unknown>): SpanDTO['tokens'] {
  const input = num(attrs[ATTR.USAGE_INPUT_TOKENS]);
  const output = num(attrs[ATTR.USAGE_OUTPUT_TOKENS]);
  if (input === undefined && output === undefined) return undefined;
  return { input, output };
}

/** Read degradation.jsonl (one DegradeEvent per line) → DegradeDTO[]. Missing → []. */
export async function readDegrades(runDir: string): Promise<DegradeDTO[]> {
  let raw: string;
  try {
    raw = await readFile(join(runDir, 'degradation.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const out: DegradeDTO[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      const e = JSON.parse(line) as DegradeEvent;
      out.push({
        kind: e.kind,
        label: DEGRADE_LABEL[e.kind] ?? e.kind,
        subject: e.subject,
        reason: e.reason,
        from: e.from,
        to: e.to,
        attempts: e.attempts,
        lane: e.lane,
      });
    } catch {
      // Tolerate a torn line; degradation is best-effort telemetry.
    }
  }
  return out;
}

function projectSpan(
  span: SpanRecord,
  depth: number,
  rootStartUnixNano: number,
): SpanDTO {
  const a = span.attributes;
  const target = str(a[ATTR.DELEGATION_TARGET]);
  const modelId = str(a[ATTR.MODEL_ID]);
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    offsetMs: (span.startUnixNano - rootStartUnixNano) / NANOS_PER_MS,
    durationMs: span.durationMs,
    depth,
    status:
      span.status.code === OTEL_STATUS_ERROR ? SpanStatus.Error : SpanStatus.Ok,
    statusMessage: span.status.message,
    agent: target,
    delegation: target
      ? {
          target,
          depth: num(a[ATTR.DELEGATION_DEPTH]) ?? depth,
          ancestors: str(a[ATTR.DELEGATION_ANCESTORS])?.split(' → ') ?? [],
        }
      : undefined,
    model: modelId
      ? {
          id: modelId,
          provider: str(a[ATTR.MODEL_PROVIDER]),
          numCtx: num(a[ATTR.MODEL_NUM_CTX]),
          footprintBytes: num(a[ATTR.MODEL_FOOTPRINT_BYTES]),
          runtimeDegraded: bool(a[ATTR.MODEL_RUNTIME_DEGRADED]),
        }
      : undefined,
    tokens: tokensOf(a),
    degraded: span.events.some((e) => e.name === 'reliability.degrade'),
    attributes: a,
    events: span.events.map((e) => ({
      name: e.name,
      offsetMs: (e.timeUnixNano - rootStartUnixNano) / NANOS_PER_MS,
      attributes: e.attributes,
    })),
  };
}

/** Depth-first flatten (tree/offset order), assigning depth. */
function flatten(
  nodes: TraceNode[],
  depth: number,
  rootStart: number,
  out: SpanDTO[],
): void {
  for (const node of nodes) {
    out.push(projectSpan(node.span, depth, rootStart));
    flatten(node.children, depth + 1, rootStart, out);
  }
}

/**
 * Read a run's on-disk spans + degradation ledger + artifacts and project them
 * into a fully-validated `RunDTO`. Returns `undefined` when the run has no spans
 * (mirrors `summarizeRun`). The output is run through `RunDtoSchema.parse` before
 * returning so a malformed projection fails loudly here, not on the wire.
 */
export async function mapRunToDto(
  runsRoot: string,
  id: string,
): Promise<RunDTO | undefined> {
  const runDir = join(runsRoot, id);
  const { spans, malformed } = await readSpans(runDir);
  if (spans.length === 0) return undefined;

  const tree = buildTree(spans);
  const rootStartUnixNano = tree[0]?.span.startUnixNano ?? 0;
  const flat: SpanDTO[] = [];
  flatten(tree, 0, rootStartUnixNano, flat);

  const runRoot = spans.find((s) => s.name === 'agent.run');
  const models = new Set<string>();
  let tokIn: number | undefined;
  let tokOut: number | undefined;
  for (const s of flat) {
    if (s.model?.id) models.add(s.model.id);
    if (s.tokens?.input !== undefined) tokIn = (tokIn ?? 0) + s.tokens.input;
    if (s.tokens?.output !== undefined)
      tokOut = (tokOut ?? 0) + s.tokens.output;
  }
  const runTokens =
    tokIn === undefined && tokOut === undefined
      ? undefined
      : { input: tokIn, output: tokOut };

  const outcome = str(runRoot?.attributes[ATTR.OUTCOME]) ?? 'unknown';
  const lifecycle = !runRoot
    ? RunLifecycle.Running
    : runRoot.status.code === OTEL_STATUS_ERROR || outcome === 'resource'
      ? RunLifecycle.Failed
      : RunLifecycle.Done;

  const degrades = await readDegrades(runDir);
  const artifacts = await readRunArtifacts(runDir);

  const dto: RunDTO = {
    id,
    owner: 'local',
    origin: RunOrigin.Manual,
    lifecycle,
    startMs: Math.round(rootStartUnixNano / NANOS_PER_MS),
    durationMs: runRoot?.durationMs ?? 0,
    outcome,
    models: [...models],
    contentPolicy: str(runRoot?.attributes[ATTR.CONTENT_POLICY]),
    tokens: runTokens,
    degraded: degrades.length > 0,
    degrades,
    malformedSpans: malformed,
    spanCount: spans.length,
    roots: tree.map((n) => n.span.spanId),
    spans: flat,
    artifacts,
  };
  return RunDtoSchema.parse(dto);
}
