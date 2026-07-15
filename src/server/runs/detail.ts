import { mapRunToDto } from '../../run/run-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';

export type RunsDeps = { runsRoot: string };

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
 * `GET /api/runs/:id` — full `RunDTO`, or 404 (missing OR path-escaping id).
 * `confineToDir` guards the `:id` path segment against `../`/symlink/absolute
 * traversal BEFORE any run lookup; a `MediaPathError` maps to the SAME 404 as
 * a genuinely-missing run so a caller cannot distinguish "escaped the runs
 * root" from "no such run" (no leak of filesystem structure).
 */
export async function handleRunDetail(
  id: string,
  deps: RunsDeps,
): Promise<Response> {
  try {
    confineToDir(id, deps.runsRoot); // realpath-confine; throws on ../ / symlink / missing
  } catch (err) {
    if (err instanceof MediaPathError) return json({ error: 'not found' }, 404);
    throw err;
  }
  const dto = await mapRunToDto(deps.runsRoot, id);
  if (!dto) return json({ error: 'not found' }, 404);
  return json(dto, 200);
}
