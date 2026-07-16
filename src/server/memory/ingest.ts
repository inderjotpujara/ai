import { withRunTelemetry } from '../../cli/with-run.ts';
import {
  MemoryIngestRequestSchema,
  MemoryIngestResponseSchema,
} from '../../contracts/index.ts';
import type { MemoryStore } from '../../memory/store.ts';
import { newRunId } from '../../run/run-id.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';

export type MemoryIngestDeps = {
  memoryStore: MemoryStore;
  runsRoot: string;
  uploadsDir: string;
};

/** Same "plain identifier, not a path segment" guard `handleMemoryRecall`
 *  applies to `:space` (`src/server/memory/recall.ts:26`) — kept in sync
 *  here rather than shared to avoid a premature cross-handler dependency. */
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
 * `POST /api/memory/:space/ingest` — resolves the ALREADY-UPLOADED file id
 * through `confineToDir` (the exact Phase-2 read-side pattern `handleChat`
 * uses for image uploads, `src/server/chat/handler.ts:61-74`), mints an
 * ephemeral run (D8) so `memory.ingest`'s ALREADY-WIRED span
 * (`withMemoryIngestSpan`, `src/memory/store.ts:124`) lands somewhere, then
 * calls `store.ingest`. The browser reaches this route by first uploading
 * the document's bytes through the confined `POST /api/upload` (Phase 2,
 * extended in this task to allow `text/plain`/`text/markdown`) and then
 * passing the returned opaque `uploadId` as `fileId` — the server NEVER
 * accepts a client-supplied filesystem path (FORK-3; mirrors the D17 fix
 * that disabled `ingestMedia`'s server-side `autoDetectPaths`). A bad/
 * escaping fileId, or a non-identifier `:space`, 400s before any engine
 * work.
 */
export async function handleMemoryIngest(
  req: Request,
  deps: MemoryIngestDeps,
  space: string,
): Promise<Response> {
  if (!SAFE_SPACE.test(space)) {
    return json({ error: 'invalid space' }, 400);
  }

  let body: ReturnType<typeof MemoryIngestRequestSchema.parse>;
  try {
    body = MemoryIngestRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid ingest request' }, 400);
  }

  let path: string;
  try {
    path = confineToDir(body.fileId, deps.uploadsDir);
  } catch (err) {
    if (err instanceof MediaPathError) {
      return json({ error: 'invalid ingest request: unknown fileId' }, 400);
    }
    throw err;
  }

  const runId = newRunId();
  const result = await withRunTelemetry(
    { runsRoot: deps.runsRoot, runId },
    () => deps.memoryStore.ingest(path, { space, at: Date.now() }),
  );
  return json(
    MemoryIngestResponseSchema.parse({
      chunks: result.chunks,
      skipped: result.skipped,
    }),
    200,
  );
}
