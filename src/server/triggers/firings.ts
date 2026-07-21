import { ZodError } from 'zod';
import {
  TriggerFiringListQuerySchema,
  TriggerFiringListResponseSchema,
} from '../../contracts/index.ts';
import type { TriggersEngine } from '../../triggers/engine.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { toTriggerFiringDto } from './dto.ts';

export type TriggerFiringsDeps = { triggers: TriggersEngine };

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
 * `GET /api/triggers/:id/firings?cursor=&limit=` — keyset-paginated firing
 * history, newest first, backed directly by `TriggerStore.listFirings`'s
 * `(fired_at DESC, rowid DESC)` page (byte-for-byte `handleJobList`'s
 * query-parse-then-page idiom). A malformed query (bad `limit`/`cursor`) is
 * rejected with a 400 rather than bubbling to a 500. An unknown trigger id
 * is not distinguished from a known-but-empty one — `listFirings` just
 * returns an empty page + `total: 0`, mirroring the store's own contract.
 */
export function handleTriggerFirings(
  id: string,
  params: URLSearchParams,
  deps: TriggerFiringsDeps,
): Response {
  let query: ReturnType<typeof TriggerFiringListQuerySchema.parse>;
  try {
    query = TriggerFiringListQuerySchema.parse({
      cursor: params.get('cursor') ?? undefined,
      limit: params.get('limit') ?? undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) return json({ error: 'bad request' }, 400);
    throw err;
  }

  const { items, nextCursor, total } = deps.triggers.store.listFirings(
    id,
    query,
  );

  return json(
    TriggerFiringListResponseSchema.parse({
      items: items.map(toTriggerFiringDto),
      nextCursor,
      total,
    }),
    200,
  );
}
