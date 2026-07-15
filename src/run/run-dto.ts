import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ArtifactKind,
  type DegradeDTO,
  DegradeDtoSchema,
  DegradeKind,
  type RunDTO,
  RunDtoSchema,
  RunKind,
  RunLifecycle,
  type RunListItemDTO,
  RunListItemDtoSchema,
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

/** Root span names that anchor a run: an agent run, a crew run, or a workflow
 *  run. Recognizing all three (not just `agent.run`) is what keeps a finished
 *  crew/workflow run from being read as perpetually in-flight. */
const RUN_ROOT_NAMES: ReadonlySet<string> = new Set([
  'agent.run',
  'crew.run',
  'workflow.run',
]);

/** Derive what a run IS from the names of its root spans. A crew/workflow root
 *  wins over an agent root (a crew nests agent runs); everything else (chat's
 *  ui.stream, or no recognized root) is Chat. */
export function deriveRunKind(rootSpanNames: string[]): RunKind {
  if (rootSpanNames.includes('crew.run')) return RunKind.Crew;
  if (rootSpanNames.includes('workflow.run')) return RunKind.Workflow;
  if (rootSpanNames.includes('agent.run')) return RunKind.Agent;
  return RunKind.Chat;
}

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

type RunRootSummary = {
  startMs: number;
  durationMs: number;
  outcome: string;
  lifecycle: RunLifecycle;
  contentPolicy?: string;
};

/**
 * Derive run-level startMs/durationMs/outcome/lifecycle from the top-level
 * trace roots — name-agnostic across `agent.run` / `crew.run` / `workflow.run`
 * (the earliest recognized root anchors the run; `tree[0]` is already sorted
 * by start time by `buildTree`). Shared by `mapRunToDto` and
 * `summarizeRunListItem` so the two projections cannot drift apart: the sibling
 * `summarizeRun` in run-trace.ts only recognizes `agent.run`, which makes a
 * completed crew.run/workflow.run report durationMs 0 / lifecycle Running —
 * this helper is the fix, applied to both list and detail views alike.
 */
function runRootSummary(tree: TraceNode[]): RunRootSummary {
  const roots = tree.map((n) => n.span);
  // The earliest top-level root anchors the run's start time (tree[0] is
  // already start-sorted).
  const startSpan = roots[0];
  // ...but the run-root that decides lifecycle/duration/outcome is the
  // recognized agent.run/crew.run/workflow.run among ALL top-level roots — it
  // need not be tree[0]. An orphan child (its parent span never written — an
  // in-flight run whose root span is still open, or a torn trace) is a sibling
  // root and can sort ahead of the closed run-root. Keying lifecycle off
  // tree[0] alone made such a run read as perpetually Running even after its
  // run-root closed (surfaced by the live run-stream tail, which stops on
  // lifecycle !== Running).
  const runRoot = roots.find((s) => RUN_ROOT_NAMES.has(s.name));
  const runRootPresent = runRoot !== undefined;
  const outcomeSource =
    roots.find((s) => ATTR.OUTCOME in s.attributes) ?? runRoot ?? startSpan;
  const outcome = str(outcomeSource?.attributes[ATTR.OUTCOME]) ?? 'unknown';
  const lifecycle = !runRootPresent
    ? RunLifecycle.Running
    : runRoot.status.code === OTEL_STATUS_ERROR || outcome === 'resource'
      ? RunLifecycle.Failed
      : RunLifecycle.Done;
  return {
    startMs: Math.round((startSpan?.startUnixNano ?? 0) / NANOS_PER_MS),
    durationMs: runRootPresent ? runRoot.durationMs : 0,
    outcome,
    lifecycle,
    contentPolicy: str(outcomeSource?.attributes[ATTR.CONTENT_POLICY]),
  };
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
      const dto: DegradeDTO = {
        kind: e.kind,
        label: DEGRADE_LABEL[e.kind] ?? e.kind,
        subject: e.subject,
        reason: e.reason,
        from: e.from,
        to: e.to,
        attempts: e.attempts,
        lane: e.lane,
      };
      // Best-effort: a line that is valid JSON but doesn't conform to the
      // degrade shape (unknown kind, missing reason/subject, wrong-typed
      // attempts, an evolved/corrupt schema) is dropped rather than pushed —
      // otherwise the terminal RunDtoSchema.parse would throw and make the
      // whole run unviewable. mapRunToDto never throws on degrade content.
      const parsed = DegradeDtoSchema.safeParse(dto);
      if (parsed.success) out.push(parsed.data);
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
  const artifacts = await readRunArtifacts(runDir);
  const hasError = artifacts.some((a) => a.kind === ArtifactKind.Error);
  // A run whose process died before ANY span ever flushed (spans.length===0,
  // spans.jsonl absent or empty) has nothing else to report — unless the
  // detached-catch handler in server/{crews,workflows}/run.ts already wrote
  // error.json, in which case it IS a viewable (Failed) run; fall through
  // instead of the usual "no spans → not a run" undefined.
  if (spans.length === 0 && !hasError) return undefined;

  const tree = buildTree(spans);
  const rootStartUnixNano = tree[0]?.span.startUnixNano ?? 0;
  const flat: SpanDTO[] = [];
  flatten(tree, 0, rootStartUnixNano, flat);

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

  const {
    startMs,
    durationMs,
    outcome: rootOutcome,
    lifecycle: rootLifecycle,
    contentPolicy,
  } = runRootSummary(tree);
  // Mirrors the spans.length===0 rescue above for the sibling case: spans DID
  // flush (e.g. an `mcp.mount` span from crew/workflow setup) but the process
  // died before the crew.run/workflow.run/agent.run root ever appeared, so
  // runRootSummary reads Running forever — the SSE watch stream's
  // `lifecycle !== Running` stop condition then never fires and it polls to
  // its maxWaitMs cap. error.json is this run's real terminal state in that
  // case. A run whose root DID resolve (already Done/Failed) is untouched —
  // a completed/failed root wins even if an error.json also happens to be
  // present.
  const earlyFailed = rootLifecycle === RunLifecycle.Running && hasError;
  const lifecycle = earlyFailed ? RunLifecycle.Failed : rootLifecycle;
  const outcome = earlyFailed ? 'error' : rootOutcome;

  const degrades = await readDegrades(runDir);

  const dto: RunDTO = {
    id,
    owner: 'local',
    origin: RunOrigin.Manual,
    kind: deriveRunKind(tree.map((n) => n.span.name)),
    lifecycle,
    startMs,
    durationMs,
    outcome,
    models: [...models],
    contentPolicy,
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

/** Cheap existence check for `error.json` — a single `stat`, not the full
 *  artifacts readdir `mapRunToDto` pays for. Used by `summarizeRunListItem`
 *  only on the already-narrow "root reads Running" branch. */
async function hasErrorArtifact(runDir: string): Promise<boolean> {
  try {
    await stat(join(runDir, 'error.json'));
    return true;
  } catch {
    return false;
  }
}

/** List twin of `mapRunToDto`'s no-spans+error.json rescue: a run that died
 *  before any span flushed (no spans.jsonl at all) still has error.json as its
 *  real terminal state. The list must project it as Failed — returning
 *  `undefined` at the spans.jsonl stat gate would hide it here while
 *  `mapRunToDto` rescues it in detail, so list and detail would disagree
 *  (visible ⇔ invisible) for the same run. Mirrors mapRunToDto's projection for
 *  this case (deriveRunKind([]) === Chat, no spans/models/tokens). */
function earlyFailedListItem(id: string): RunListItemDTO {
  return RunListItemDtoSchema.parse({
    id,
    startMs: 0,
    durationMs: 0,
    outcome: 'error',
    lifecycle: RunLifecycle.Failed,
    origin: RunOrigin.Manual,
    kind: deriveRunKind([]),
    models: [],
    degraded: false,
    spanCount: 0,
  });
}

// why: mtime-keyed summary cache. The list view would otherwise be
// O(runs × spans/run) disk reads on every request (a keystroke-driven search
// re-lists constantly); a real persisted index is Phase 6 — this in-process
// Map is the stateless-friendly interim. Keyed on `spans.jsonl`'s `mtimeMs`
// (NOT the run directory's mtime): a directory's mtime only changes on entry
// add/remove/rename, not on append, so keying on the dir would leave an
// in-flight run's summary stale as spans stream in. runDir (not id) is the
// map key purely so it reads unambiguously in a debugger; id is unique per
// runsRoot in practice.
const summaryCache = new Map<
  string,
  { mtimeMs: number; item: RunListItemDTO }
>();

/** Test-only: current cache entry count (asserts memoization vs recompute). */
export function __summaryCacheSize(): number {
  return summaryCache.size;
}

/**
 * List-cheap projection of a run: spanCount/models/tokens/outcome/lifecycle
 * without the full flatten, artifacts readdir, or degradation.jsonl read that
 * `mapRunToDto` does. `degraded` is derived from per-span `reliability.degrade`
 * events (already in spans.jsonl) rather than reading degradation.jsonl, since
 * that file read is exactly the extra I/O this projection exists to avoid.
 * Uses the same `runRootSummary` as `mapRunToDto` (agent.run/crew.run/
 * workflow.run, earliest recognized root) so the two projections cannot
 * disagree on lifecycle/duration/outcome for the same run.
 */
export async function summarizeRunListItem(
  runsRoot: string,
  id: string,
): Promise<RunListItemDTO | undefined> {
  const runDir = join(runsRoot, id);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(join(runDir, 'spans.jsonl'))).mtimeMs;
  } catch {
    // I2: no spans.jsonl — but the detached-catch handler may have written
    // error.json before any span ever flushed. mapRunToDto rescues that as a
    // Failed run; the list must too, or the run is invisible here while the
    // detail view shows it (list/detail divergence).
    if (await hasErrorArtifact(runDir)) return earlyFailedListItem(id);
    return undefined; // genuinely not a started/completed run
  }
  const cached = summaryCache.get(runDir);
  if (cached && cached.mtimeMs === mtimeMs) {
    // I1: a cached `running` summary goes stale silently — error.json is
    // written WITHOUT touching spans.jsonl, so the mtime key never invalidates
    // and the list would show `running` forever while detail shows `failed`.
    // Re-check the cheap error artifact on a cached Running item and derive the
    // terminal Failed state if it now exists (then refresh the cache entry).
    if (
      cached.item.lifecycle === RunLifecycle.Running &&
      (await hasErrorArtifact(runDir))
    ) {
      const item = RunListItemDtoSchema.parse({
        ...cached.item,
        lifecycle: RunLifecycle.Failed,
        outcome: 'error',
      });
      summaryCache.set(runDir, { mtimeMs, item });
      return item;
    }
    return cached.item;
  }

  const { spans } = await readSpans(runDir);
  const tree = buildTree(spans);
  const {
    startMs,
    durationMs,
    outcome: rootOutcome,
    lifecycle: rootLifecycle,
  } = runRootSummary(tree);
  // Mirrors mapRunToDto's early-failed rescue (see its comment there): a run
  // whose root span never flushed reads Running here too; if the
  // detached-catch handler already wrote error.json, that IS this run's
  // terminal state. A single extra stat — cheap, and only paid on the
  // already-narrow Running branch — keeps this list projection from
  // disagreeing with the detail view.
  const earlyFailed =
    rootLifecycle === RunLifecycle.Running && (await hasErrorArtifact(runDir));
  if (spans.length === 0 && !earlyFailed) return undefined;
  const lifecycle = earlyFailed ? RunLifecycle.Failed : rootLifecycle;
  const outcome = earlyFailed ? 'error' : rootOutcome;

  const models = new Set<string>();
  let tokIn: number | undefined;
  let tokOut: number | undefined;
  let degraded = false;
  for (const s of spans) {
    const m = str(s.attributes[ATTR.MODEL_ID]);
    if (m) models.add(m);
    const i = num(s.attributes[ATTR.USAGE_INPUT_TOKENS]);
    const o = num(s.attributes[ATTR.USAGE_OUTPUT_TOKENS]);
    if (i !== undefined) tokIn = (tokIn ?? 0) + i;
    if (o !== undefined) tokOut = (tokOut ?? 0) + o;
    if (s.events.some((e) => e.name === 'reliability.degrade')) degraded = true;
  }

  const item = RunListItemDtoSchema.parse({
    id,
    startMs,
    durationMs,
    outcome,
    lifecycle,
    origin: RunOrigin.Manual,
    kind: deriveRunKind(tree.map((n) => n.span.name)),
    models: [...models],
    degraded,
    spanCount: spans.length,
    tokens:
      tokIn === undefined && tokOut === undefined
        ? undefined
        : { input: tokIn, output: tokOut },
  });
  summaryCache.set(runDir, { mtimeMs, item });
  return item;
}
