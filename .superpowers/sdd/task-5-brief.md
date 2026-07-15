### Task 5: `mapRunToDto` — flatten spans + degrades + artifacts into a full `RunDTO`

**Files:**
- Create: `src/run/run-dto.ts`
- Test: `tests/run/run-dto.test.ts`

**Interfaces:**
- Consumes: `readSpans`, `buildTree`, `type TraceNode` from `./run-trace.ts`; `type SpanRecord` from `../telemetry/jsonl-exporter.ts`; `ATTR` from `../telemetry/spans.ts`; `readRunArtifacts` (Task 4); `type DegradeEvent` from `../reliability/ledger.ts`; contract types + `RunDtoSchema`, `RunLifecycle`, `RunOrigin`, `SpanStatus`, `DegradeKind` from `../contracts/index.ts`.
- Produces: `mapRunToDto(runsRoot: string, id: string): Promise<RunDTO | undefined>` — `undefined` when the run has no spans (mirrors `summarizeRun`). Output is validated through `RunDtoSchema` before returning (mapper contract).

Per-span projection (from spec Layer ②):
- Walk `buildTree(spans)` assigning `depth` (root 0, child parent+1); flatten in tree/offset order.
- `rootStartUnixNano` = earliest root's `startUnixNano` (`buildTree` returns roots sorted asc, so `roots[0].span.startUnixNano`).
- `offsetMs = (span.startUnixNano - rootStartUnixNano) / 1e6`; `durationMs = span.durationMs` (already ms).
- `status = span.status.code === 2 ? SpanStatus.Error : SpanStatus.Ok`; `statusMessage = span.status.message`.
- `agent` = `attrs[ATTR.DELEGATION_TARGET]` (string) when present.
- `delegation` = `{ target, depth: attrs[ATTR.DELEGATION_DEPTH], ancestors: String(attrs[ATTR.DELEGATION_ANCESTORS]).split(' → ') }` when `DELEGATION_TARGET` present.
- `model` = `{ id, provider?, numCtx?, footprintBytes?, runtimeDegraded? }` from `MODEL_ID`/`MODEL_PROVIDER`/`MODEL_NUM_CTX`/`MODEL_FOOTPRINT_BYTES`/`MODEL_RUNTIME_DEGRADED` when `MODEL_ID` present.
- `tokens` = `{ input?, output? }` from `USAGE_INPUT_TOKENS`/`USAGE_OUTPUT_TOKENS` when either present.
- `degraded` = `span.events.some((e) => e.name === 'reliability.degrade')`.
- `events` → `{ name, offsetMs: (e.timeUnixNano - rootStartUnixNano) / 1e6, attributes? }`.
- `node` omitted (reserved).

Run-level:
- `roots` = tree roots' span ids; `startMs = Math.round(rootStartUnixNano / 1e6)`.
- `root` = span named `agent.run` (else `undefined`); `durationMs = root?.durationMs ?? 0`.
- `outcome` = `attrs[ATTR.OUTCOME]` off `root` else `'unknown'`; `contentPolicy` = `attrs[ATTR.CONTENT_POLICY]` off `root` when present.
- `models` = distinct `MODEL_ID` across spans.
- `tokens` (run) = sum of per-span input/output (each `undefined` when no span carried it).
- `origin = RunOrigin.Manual`; `owner = 'local'`.
- **lifecycle:** `Running` when there is no `agent.run` span yet (BatchSpanProcessor exports a span only on end, so an in-flight run's root is simply absent — same signal the CLI `--follow` uses); else `Failed` when root `status.code === 2` OR `outcome === 'resource'`; else `Done`.
- `degrades` from `degradation.jsonl` (Task-6 helper `readDegrades` shared); `RunDTO.degraded = degrades.length > 0`.
- `malformedSpans` = `readSpans` malformed count; `spanCount = spans.length`.

- [ ] **Step 1: Write the failing test** — `tests/run/run-dto.test.ts` (fixture spans written to a tmp dir; mirror `run-trace.test.ts`'s `span()` builder):

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunDtoSchema } from '../../src/contracts/dto.ts';
import { RunLifecycle, SpanStatus } from '../../src/contracts/enums.ts';
import { mapRunToDto } from '../../src/run/run-dto.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';

function span(
  p: Partial<SpanRecord> & { name: string; spanId: string },
): SpanRecord {
  return {
    kind: 0,
    traceId: 't1',
    parentSpanId: null,
    startUnixNano: 0,
    endUnixNano: 1_000_000,
    durationMs: 1,
    status: { code: 0 },
    attributes: {},
    events: [],
    ...p,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rd-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRun(id: string, spans: SpanRecord[], extra?: { degradation?: string }) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`);
  if (extra?.degradation) await writeFile(join(dir, 'degradation.jsonl'), extra.degradation);
  return dir;
}

test('maps a clean run: offsets, depth, tokens sum, Done lifecycle; validates through RunDtoSchema', async () => {
  await writeRun('run-1', [
    span({
      name: 'agent.run',
      spanId: 'a',
      startUnixNano: 1_000_000_000,
      durationMs: 50,
      attributes: { 'agent.outcome': 'answer', 'content.policy': 'standard' },
    }),
    span({
      name: 'ai.generateText',
      spanId: 'b',
      parentSpanId: 'a',
      startUnixNano: 1_010_000_000, // +10ms
      durationMs: 30,
      attributes: {
        'gen_ai.request.model': 'qwen3.5:9b',
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 8,
      },
    }),
  ]);
  const dto = await mapRunToDto(root, 'run-1');
  expect(dto).toBeDefined();
  const parsed = RunDtoSchema.parse(dto); // throws if the mapper produced a bad shape
  expect(parsed.lifecycle).toBe(RunLifecycle.Done);
  expect(parsed.outcome).toBe('answer');
  expect(parsed.contentPolicy).toBe('standard');
  expect(parsed.models).toEqual(['qwen3.5:9b']);
  expect(parsed.tokens).toEqual({ input: 12, output: 8 });
  const child = parsed.spans.find((s) => s.spanId === 'b');
  expect(child?.depth).toBe(1);
  expect(child?.offsetMs).toBe(10);
  expect(child?.tokens).toEqual({ input: 12, output: 8 });
  expect(child?.model?.id).toBe('qwen3.5:9b');
});

test('error root → Failed lifecycle + span status Error (code 2)', async () => {
  await writeRun('run-2', [
    span({ name: 'agent.run', spanId: 'a', status: { code: 2, message: 'boom' }, attributes: { 'agent.outcome': 'resource' } }),
  ]);
  const dto = await mapRunToDto(root, 'run-2');
  expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  expect(dto?.spans[0]?.status).toBe(SpanStatus.Error);
  expect(dto?.spans[0]?.statusMessage).toBe('boom');
});

test('in-flight run (no agent.run span yet) → Running lifecycle', async () => {
  await writeRun('run-3', [
    span({ name: 'agent.delegation', spanId: 'd', attributes: { 'agent.delegation.target': 'researcher' } }),
  ]);
  const dto = await mapRunToDto(root, 'run-3');
  expect(dto?.lifecycle).toBe(RunLifecycle.Running);
  expect(dto?.spans[0]?.agent).toBe('researcher');
});

test('degrades come from degradation.jsonl and set degraded=true', async () => {
  await writeRun(
    'run-4',
    [span({ name: 'agent.run', spanId: 'a' })],
    { degradation: `${JSON.stringify({ kind: 'tool_skipped', subject: 'voice', reason: 'no audio' })}\n` },
  );
  const dto = await mapRunToDto(root, 'run-4');
  expect(dto?.degraded).toBe(true);
  expect(dto?.degrades[0]).toMatchObject({ kind: 'tool_skipped', subject: 'voice', label: expect.any(String) });
});

test('undefined for a run with no spans; malformed lines are counted', async () => {
  expect(await mapRunToDto(root, 'missing')).toBeUndefined();
  const dir = join(root, 'run-5');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'spans.jsonl'), `${JSON.stringify(span({ name: 'agent.run', spanId: 'a' }))}\nNOT JSON\n`);
  const dto = await mapRunToDto(root, 'run-5');
  expect(dto?.malformedSpans).toBe(1);
  expect(dto?.spanCount).toBe(1);
});
```

- [ ] **Step 2: Run to fail** — `bun test --path-ignore-patterns 'web/**' tests/run/run-dto.test.ts` → FAIL (module missing).

- [ ] **Step 3: Minimal impl** — `src/run/run-dto.ts` (the `readDegrades` + summary/cache parts land in Task 6; this task ships `mapRunToDto` + shared helpers):

```ts
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
      // tolerate a torn line; degradation is best-effort telemetry
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
          runtimeDegraded:
            typeof a[ATTR.MODEL_RUNTIME_DEGRADED] === 'boolean'
              ? (a[ATTR.MODEL_RUNTIME_DEGRADED] as boolean)
              : undefined,
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
function flatten(nodes: TraceNode[], depth: number, rootStart: number, out: SpanDTO[]): void {
  for (const node of nodes) {
    out.push(projectSpan(node.span, depth, rootStart));
    flatten(node.children, depth + 1, rootStart, out);
  }
}

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
    if (s.tokens?.output !== undefined) tokOut = (tokOut ?? 0) + s.tokens.output;
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
```

- [ ] **Step 4: Run to pass** — `bun test --path-ignore-patterns 'web/**' tests/run/run-dto.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- "src/run/run-dto.ts" "tests/run/run-dto.test.ts"
git add src/run/run-dto.ts tests/run/run-dto.test.ts
git commit -m "feat(run): mapRunToDto — flatten spans/degrades/artifacts into a validated RunDTO"
```

---

