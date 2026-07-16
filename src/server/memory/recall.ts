import { withRunTelemetry } from '../../cli/with-run.ts';
import { MemoryRecallRequestSchema } from '../../contracts/index.ts';
import type { MemoryStore } from '../../memory/store.ts';
import { newRunId } from '../../run/run-id.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type MemoryRecallDeps = { memoryStore: MemoryStore; runsRoot: string };

/**
 * A memory space is a lookup key into `MemoryStore` (a sqlite `spaces` row
 * name / LanceDB table name), not a filesystem path segment resolved via
 * `../`-joins — `store.recall` gates every `space` value through
 * `sql.getSpace()` (a parameterized query) BEFORE any table access
 * (`src/memory/store.ts:143`; `retrieve()` only ever passes the resolved
 * `SpaceMeta.name` on to LanceDB, never the raw input, `src/memory/retrieve.ts:69`),
 * so `confineToDir` (a realpath-against-a-root check) doesn't apply here the
 * way it does to `handleRunDetail`'s `:id` — there is no directory to
 * confine against. The guard this route still owns: reject any `:space`
 * segment that isn't a plain identifier BEFORE calling the store, so a
 * traversal- or separator-shaped value (`../../etc/passwd`, `foo/bar`) is
 * refused outright rather than relying solely on "no such space" abstention
 * downstream (defense in depth; mirrors `handleCrewDetail`'s "registry key,
 * not a path" reasoning, `src/server/crews/detail.ts:15-17`).
 */
const SAFE_SPACE = /^[A-Za-z0-9_-]+$/;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `POST /api/memory/:space/recall` (spec §4.2 item 5) — validates the body,
 * mints an ephemeral run (D8) so the ALREADY-WIRED `memory.recall` span
 * (`store.recall` → `retrieve()` → `withMemoryRecallSpan`,
 * `src/memory/retrieve.ts:55` — no new telemetry code here) lands under
 * `runs/<id>/spans.jsonl`, then returns the ranked `RetrievalResultDTO[]`
 * (a bare array on the wire, per spec — see `handleMemorySpaces`'s doc
 * comment for why this route doesn't use the `{items}`-wrapped shape). The
 * URL's `:space` segment is authoritative over the request body's optional
 * `space` field (a REST-path convention); the body field exists on
 * `MemoryRecallRequestSchema` for other potential callers of the same
 * schema shape, not this route.
 */
export async function handleMemoryRecall(
  req: Request,
  deps: MemoryRecallDeps,
  space: string,
): Promise<Response> {
  if (!SAFE_SPACE.test(space)) {
    return json({ error: 'invalid space' }, 400);
  }
  let body: ReturnType<typeof MemoryRecallRequestSchema.parse>;
  try {
    body = MemoryRecallRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid recall request' }, 400);
  }
  const runId = newRunId();
  const results = await withRunTelemetry(
    { runsRoot: deps.runsRoot, runId },
    () =>
      deps.memoryStore.recall(body.query, {
        space,
        ...(body.topK !== undefined ? { topK: body.topK } : {}),
      }),
  );
  return json(results, 200);
}
