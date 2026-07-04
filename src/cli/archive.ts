import { askYesNo, stdinInput } from '../provisioning/ui/prompt.ts';
import type { ArchiveCandidate } from '../verified-build/archive.ts';
import { archiveArtifact, archiveDecision } from '../verified-build/archive.ts';
import { readManifest } from '../verified-build/manifest.ts';
import { aggregateUsage } from '../verified-build/usage.ts';

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

/** Per-candidate consent, then archive. Returns how many were archived. */
async function prune(reports: DirReport[]): Promise<number> {
  const input = stdinInput();
  let archived = 0;
  for (const { dir, candidates } of reports) {
    for (const candidate of candidates) {
      const yes = await askYesNo(
        `Archive ${candidate.name}? (near-duplicate, idle)`,
        { input, autoYes: false },
      );
      if (!yes) continue;
      archiveArtifact(dir, candidate.name);
      archived += 1;
    }
  }
  return archived;
}

async function main(): Promise<void> {
  const reports = reportCandidates(REGISTRY_DIRS, runsRootDir(), Date.now());
  console.log(renderReport(reports));
  if (!process.argv.includes('--prune')) return;
  const archived = await prune(reports);
  console.log(`Archived ${archived} artifact(s).`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
