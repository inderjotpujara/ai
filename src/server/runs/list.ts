import { readdir } from 'node:fs/promises';
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
 * Filters (search/outcome/degraded) are applied over the cache-fronted
 * `summarizeRunListItem` projection, then the result is sorted newest-first
 * by `startMs` and paginated via an opaque `base64url(startMs:id)` cursor:
 * `total` reflects the post-filter count (not the page size), and
 * `nextCursor` is present only when more items remain past the current page.
 */
export async function handleRunList(
  params: URLSearchParams,
  deps: RunsDeps,
): Promise<Response> {
  const query = RunListQuerySchema.parse({
    search: params.get('search') ?? undefined,
    outcome: params.get('outcome') ?? undefined,
    degraded: params.get('degraded') ?? undefined,
    limit: params.get('limit') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
  });

  let ids: string[];
  try {
    const entries = await readdir(deps.runsRoot, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return json(RunListResponseSchema.parse({ items: [], total: 0 }), 200);
  }

  const summaries: RunListItemDTO[] = [];
  for (const id of ids) {
    const item = await summarizeRunListItem(deps.runsRoot, id);
    if (item) summaries.push(item);
  }

  const filtered = summaries
    .filter((s) => (query.search ? matchesSearch(s, query.search) : true))
    .filter((s) => (query.outcome ? s.outcome === query.outcome : true))
    .filter((s) =>
      query.degraded === undefined ? true : s.degraded === query.degraded,
    )
    .sort((a, b) => b.startMs - a.startMs);

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
