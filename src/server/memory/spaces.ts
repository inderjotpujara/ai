import type { MemoryStore } from '../../memory/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type MemorySpacesDeps = { memoryStore: MemoryStore };

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
 * `GET /api/memory/spaces` (spec §4.2 item 5) — `store.stats()` projected to
 * `MemorySpaceDTO[]` (a bare array on the wire, per spec — not the
 * `{items}`-wrapped shape `CrewListResponseSchema`/`ModelListResponseSchema`
 * use elsewhere). Per D8, a metadata read (space list + row counts) does NOT
 * mint an ephemeral run — there's no recall/ingest span here worth placing.
 */
export async function handleMemorySpaces(
  deps: MemorySpacesDeps,
): Promise<Response> {
  const stats = await deps.memoryStore.stats();
  const spaces = Object.entries(stats).map(([name, chunkCount]) => ({
    name,
    chunkCount,
  }));
  return json(spaces, 200);
}
