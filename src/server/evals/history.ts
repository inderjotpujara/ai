import {
  EvalHistoryDtoSchema,
  EvalHistoryListResponseSchema,
} from '../../contracts/evals.ts';
import type { EvalHistoryStore } from '../../self-improve/history.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';

export type EvalHistoryDeps = {
  history: Pick<EvalHistoryStore, 'listByArtifact'>;
  /** The reusable-artifact registry dirs (`REGISTRY_DIRS`) the `:artifact`
   *  param is confined against — SAME list `health.ts` scans. */
  registryDirs: string[];
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** True iff `artifact` names a real generated artifact file
 *  (`<dir>/<artifact>.ts`, the SAME existence marker `manifest.ts`'s
 *  `rebuildFromArtifacts` uses) under one of `registryDirs` — checked via
 *  `confineToDir` so a `../`/absolute/symlink escape is defeated exactly like
 *  `handleRunDetail`'s `:id` guard (`src/server/runs/detail.ts`), not merely a
 *  string-shape check. */
function isKnownArtifact(artifact: string, registryDirs: string[]): boolean {
  return registryDirs.some((dir) => {
    try {
      confineToDir(`${artifact}.ts`, dir);
      return true;
    } catch (err) {
      if (err instanceof MediaPathError) return false;
      throw err;
    }
  });
}

/**
 * `GET /api/evals/:artifact` — the full `eval_history` trend view (Task 20).
 * `:artifact` is a generated-artifact NAME, not a caller-controlled filesystem
 * path — `isKnownArtifact` re-resolves it against every registry dir BEFORE
 * any history lookup; an escape attempt or a genuinely-unknown artifact both
 * collapse to the SAME 404 (no filesystem-structure leak). Rows come back
 * newest-first (`listByArtifact`'s `ORDER BY ts DESC`).
 */
export function handleEvalHistory(
  artifact: string,
  deps: EvalHistoryDeps,
): Response {
  if (!isKnownArtifact(artifact, deps.registryDirs)) {
    return json({ error: 'not found' }, 404);
  }
  const rows = deps.history.listByArtifact(artifact);
  return json(
    EvalHistoryListResponseSchema.parse({
      items: rows.map((r) => EvalHistoryDtoSchema.parse(r)),
    }),
    200,
  );
}
