import {
  type EvalHealthDTO,
  EvalHealthDtoSchema,
  EvalHealthListResponseSchema,
  EvalHistoryDtoSchema,
} from '../../contracts/evals.ts';
import type {
  EvalHistoryRow,
  EvalHistoryStore,
} from '../../self-improve/history.ts';
import { readManifest } from '../../verified-build/manifest.ts';
import type { ManifestEntry } from '../../verified-build/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { readThumbsDownByArtifact } from './feedback-read.ts';

export type EvalHealthDeps = {
  history: Pick<EvalHistoryStore, 'listByArtifact'>;
  /** The reusable-artifact registry dirs to scan — the SAME canonical list
   *  `runEval`/`archive.ts` use (`REGISTRY_DIRS`), so this route never drifts
   *  from what the eval loop itself considers a "generated artifact". */
  registryDirs: string[];
  /** Runs root the 👎 `chat.feedback` read scans (Task 20). */
  runsRoot: string;
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

/**
 * Project one manifest entry + its most recent `eval_history` row (if any)
 * into an `EvalHealthDTO` (Task 19 shape). `baselineModel` comes from
 * `ManifestEntry.verifiedWith` (the model captured at the last passing
 * build-time eval); `currentModel` comes from the latest re-eval ROW's model
 * — never a live resolve — so a GET stays cheap and side-effect-free (brief's
 * explicit choice). `regressed`/`latest` reflect the row AS-IS (which may
 * itself be a regressed verdict) so a regression actually surfaces here,
 * rather than being filtered out the way `EvalHistoryStore.latestPassing`
 * would.
 */
export function mapToEvalHealthDto(input: {
  artifact: string;
  entry: ManifestEntry;
  /** The newest `eval_history` row for this artifact (`listByArtifact(...)[0]`,
   *  ts DESC), or `undefined` when it has never been re-evaluated. */
  latest: EvalHistoryRow | undefined;
  thumbsDown: number;
}): EvalHealthDTO {
  return EvalHealthDtoSchema.parse({
    artifact: input.artifact,
    verifiedLevel: input.entry.verifiedLevel,
    baselineModel: input.entry.verifiedWith?.model,
    currentModel: input.latest?.model,
    latest: input.latest ? EvalHistoryDtoSchema.parse(input.latest) : undefined,
    regressed: input.latest?.regressed ?? false,
    thumbsDown: input.thumbsDown,
  });
}

/**
 * `GET /api/evals` — per-artifact health rollup (Task 20): every entry across
 * `registryDirs`' manifests, baseline-vs-latest, regressions flagged. Never
 * 500s on a fresh install: `readManifest` returns an empty manifest for a
 * missing/malformed `.generated.json`, and a missing `registryDirs` entry on
 * disk is simply an empty entry set for that dir.
 */
export async function handleEvalHealth(
  deps: EvalHealthDeps,
): Promise<Response> {
  const thumbsDownByArtifact = await readThumbsDownByArtifact(deps.runsRoot);
  const items: EvalHealthDTO[] = [];
  for (const dir of deps.registryDirs) {
    const manifest = readManifest(dir);
    for (const [artifact, entry] of Object.entries(manifest.entries)) {
      const rows = deps.history.listByArtifact(artifact);
      items.push(
        mapToEvalHealthDto({
          artifact,
          entry,
          latest: rows[0],
          thumbsDown: thumbsDownByArtifact[artifact] ?? 0,
        }),
      );
    }
  }
  return json(EvalHealthListResponseSchema.parse({ items }), 200);
}
