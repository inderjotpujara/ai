import { askYesNo, stdinInput } from '../provisioning/ui/prompt.ts';
import { withBuildArchiveSpan } from '../telemetry/spans.ts';
import type { ArchiveCandidate } from '../verified-build/archive.ts';
import {
  archiveArtifact,
  archiveDecision,
  LiveReferenceError,
} from '../verified-build/archive.ts';
import { readManifest } from '../verified-build/manifest.ts';
import { aggregateUsage } from '../verified-build/usage.ts';
import { withRunTelemetry } from './with-run.ts';

/** Registry dirs holding generated artifacts (each has a sidecar manifest). */
export const REGISTRY_DIRS = ['agents', 'crews', 'workflows'] as const;

function runsRootDir(): string {
  return process.env.AGENT_RUNS_ROOT ?? 'runs';
}

export type DirReport = { dir: string; candidates: ArchiveCandidate[] };

/** Archive candidates per registry dir at nowMs (report only, no mutation). */
export function reportCandidates(
  dirs: readonly string[],
  runsRoot: string,
  nowMs: number,
): DirReport[] {
  const usage = aggregateUsage(runsRoot);
  return dirs.map((dir) => ({
    dir,
    candidates: archiveDecision(readManifest(dir), usage, nowMs),
  }));
}

export function renderReport(reports: DirReport[]): string {
  const lines: string[] = [];
  for (const { dir, candidates } of reports) {
    if (candidates.length === 0) {
      lines.push(`${dir}: no archive candidates`);
      continue;
    }
    lines.push(`${dir}:`);
    for (const candidate of candidates) {
      lines.push(`  ${candidate.name} — ${candidate.reason}`);
    }
  }
  return lines.join('\n');
}

export type PruneResult = {
  archived: number;
  /** Candidates that were consented but refused by the live-reference guard —
   *  reported instead of aborting the rest of the prune loop. */
  skipped: { name: string; reason: string }[];
};

/** Per-candidate consent (via `ask`), then archive. ALL registry dirs go in
 *  as `refDirs` so a candidate referenced from a DIFFERENT registry (e.g. a
 *  workflow using an agent) is protected; a LiveReferenceError skips that
 *  one candidate rather than aborting the whole loop. */
export async function prune(
  reports: DirReport[],
  refDirs: readonly string[],
  ask: (question: string) => Promise<boolean>,
): Promise<PruneResult> {
  let archived = 0;
  const skipped: PruneResult['skipped'] = [];
  for (const { dir, candidates } of reports) {
    for (const candidate of candidates) {
      const yes = await ask(
        `Archive ${candidate.name}? (near-duplicate, idle)`,
      );
      if (!yes) continue;
      try {
        archiveArtifact(dir, candidate.name, [...refDirs]);
        archived += 1;
      } catch (err) {
        if (!(err instanceof LiveReferenceError)) throw err;
        skipped.push({ name: candidate.name, reason: err.message });
      }
    }
  }
  return { archived, skipped };
}

async function main(): Promise<void> {
  const runsRoot = runsRootDir();
  // Run scope + telemetry provider (C2a): the build.archive span below lands
  // in runs/<id>/spans.jsonl like every other CLI's spans.
  await withRunTelemetry({ runsRoot, runId: `archive-${process.pid}` }, () =>
    withBuildArchiveSpan(async (rec) => {
      const reports = reportCandidates(REGISTRY_DIRS, runsRoot, Date.now());
      console.log(renderReport(reports));
      const total = reports.reduce((n, r) => n + r.candidates.length, 0);
      if (!process.argv.includes('--prune')) {
        rec.done(total, 0);
        return;
      }
      const input = stdinInput();
      const { archived, skipped } = await prune(reports, REGISTRY_DIRS, (q) =>
        askYesNo(q, { input, autoYes: false }),
      );
      for (const s of skipped) console.log(`Skipped ${s.name}: ${s.reason}`);
      console.log(`Archived ${archived} artifact(s).`);
      rec.done(total, archived);
    }),
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
