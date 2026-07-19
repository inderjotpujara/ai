import { readdir } from 'node:fs/promises';
import { ZodError } from 'zod';
import type { RunListItemDTO } from '../../contracts/index.ts';
import {
  RunListQuerySchema,
  RunListResponseSchema,
} from '../../contracts/index.ts';
import { summarizeRunListItem } from '../../run/run-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { RunsDeps } from './detail.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

function encodeCursor(item: RunListItemDTO): string {
  return Buffer.from(`${item.startMs}:${item.id}`).toString('base64url');
}
function decodeCursorId(cursor: string): string | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx === -1 ? undefined : decoded.slice(idx + 1);
  } catch {
    return undefined;
  }
}

function matchesSearch(item: RunListItemDTO, search: string): boolean {
  const hay =
    `${item.id} ${item.models.join(' ')} ${item.outcome}`.toLowerCase();
  return hay.includes(search.toLowerCase());
}

/**
 * `GET /api/runs` — filtered/sorted/paginated list of run summaries.
 * Filters (search/outcome/degraded/kind/origin) are applied over the cache-fronted
 * `summarizeRunListItem` projection, then the result is sorted newest-first
 * by `startMs` and paginated via an opaque `base64url(startMs:id)` cursor:
 * `total` reflects the post-filter count (not the page size), and
 * `nextCursor` is present only when more items remain past the current page.
 * A malformed query (bad `limit`/`degraded`) is rejected with a 400 rather than
 * bubbling to a 500, and the sort carries an `id` tie-break so equal `startMs`
 * values page deterministically (never fall back to unstable readdir order).
 */
export async function handleRunList(
  params: URLSearchParams,
  deps: RunsDeps,
): Promise<Response> {
  let query: ReturnType<typeof RunListQuerySchema.parse>;
  try {
    query = RunListQuerySchema.parse({
      search: params.get('search') ?? undefined,
      outcome: params.get('outcome') ?? undefined,
      degraded: params.get('degraded') ?? undefined,
      kind: params.get('kind') ?? undefined,
      origin: params.get('origin') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    });
  } catch (err) {
    // A bad query (limit=abc, degraded=maybe, …) is the caller's fault → 400,
    // not a 500. Body stays generic (no zod detail) to avoid echoing input.
    if (err instanceof ZodError) return json({ error: 'bad request' }, 400);
    throw err;
  }

  let ids: string[];
  try {
    const entries = await readdir(deps.runsRoot, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return json(RunListResponseSchema.parse({ items: [], total: 0 }), 200);
  }

  const summaries: RunListItemDTO[] = [];
  for (const id of ids) {
    // Defense-in-depth: one unreadable/corrupt run must not fail the whole
    // list. `summarizeRunListItem` already isolates malformed span lines, but
    // any unexpected throw (bad permissions, a torn projection) is swallowed
    // here so the other runs still list.
    try {
      const item = await summarizeRunListItem(deps.runsRoot, id);
      if (item) summaries.push(item);
    } catch {
      // skip this run
    }
  }

  const filtered = summaries
    .filter((s) => (query.search ? matchesSearch(s, query.search) : true))
    .filter((s) => (query.outcome ? s.outcome === query.outcome : true))
    .filter((s) =>
      query.degraded === undefined ? true : s.degraded === query.degraded,
    )
    .filter((s) => (query.kind ? s.kind === query.kind : true))
    .filter((s) => (query.origin ? s.origin === query.origin : true))
    // Stable secondary key: equal startMs must not fall back to the unstable
    // readdir order, or cursor pagination flakes (a tie could reorder between
    // requests and skip/repeat a page).
    .sort((a, b) => b.startMs - a.startMs || a.id.localeCompare(b.id));

  let start = 0;
  if (query.cursor) {
    const cursorId = decodeCursorId(query.cursor);
    const idx = filtered.findIndex((s) => s.id === cursorId);
    start = idx === -1 ? 0 : idx + 1;
  }
  const page = filtered.slice(start, start + query.limit);
  const hasMore = start + query.limit < filtered.length;
  const last = page[page.length - 1];

  return json(
    RunListResponseSchema.parse({
      items: page,
      total: filtered.length,
      nextCursor: hasMore && last ? encodeCursor(last) : undefined,
    }),
    200,
  );
}
