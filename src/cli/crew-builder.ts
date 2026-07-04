import { buildCrewOrWorkflow } from '../crew-builder/builder.ts';
import { makeRealCrewBuilderDeps } from '../crew-builder/deps.ts';
import { VerifiedLevel } from '../verified-build/types.ts';
import { withRunTelemetry } from './with-run.ts';

export function parseArgs(argv: string[]): {
  need: string;
  autoYes: boolean;
  force: boolean;
} {
  const positional: string[] = [];
  let autoYes = false;
  let force = false;
  for (const a of argv) {
    if (a === '--yes' || a === '-y') autoYes = true;
    else if (a === '--force') force = true;
    else positional.push(a);
  }
  return { need: positional.join(' ').trim(), autoYes, force };
}

async function main(): Promise<void> {
  const { need, autoYes, force } = parseArgs(process.argv.slice(2));
  if (need.length === 0) {
    console.error(
      'Usage: bun run crew-builder "<multi-step need>" [--yes] [--force]',
    );
    process.exit(1);
  }
  const { deps, cleanup } = await makeRealCrewBuilderDeps({ autoYes, force });
  try {
    // Run scope + telemetry provider (C2a): without this the crew.build /
    // build.verify spans opened inside buildCrewOrWorkflow are no-ops — with
    // it they land in runs/<id>/spans.jsonl like every other CLI's spans.
    const r = await withRunTelemetry(
      { runsRoot: 'runs', runId: `crew-builder-${process.pid}` },
      () => buildCrewOrWorkflow(need, deps),
    );
    if (r.kind === 'written') {
      console.log(
        `Created ${r.shape} "${r.name}". Files: ${r.files.join(', ')}`,
      );
      if (r.level === VerifiedLevel.Unverified) {
        console.log(
          `WARNING: committed UNVERIFIED (--force) — verification failed but the ${r.shape} was registered anyway. Review it before relying on it.`,
        );
      } else if (r.level !== undefined) {
        console.log(`Verified: ${r.level}.`);
      }
      if (r.builtAgents.length)
        console.log(`New agents built: ${r.builtAgents.join(', ')}`);
      console.log(
        `It is live on your next run (bun run ${r.shape === 'crew' ? 'crew' : 'flow'} ${r.name} "<input>").`,
      );
    } else if (r.kind === 'declined') {
      console.error('Declined — nothing written.');
    } else if (r.kind === 'invalid') {
      console.error('Could not build a valid graph:');
      for (const i of r.issues) console.error(`  - ${i.field}: ${i.problem}`);
      process.exitCode = 1;
    } else if (r.kind === 'reused') {
      console.log(
        `An existing crew/workflow "${r.name}" already covers this need (similarity ${r.similarity.toFixed(2)}). Nothing generated.`,
      );
    } else if (r.kind === 'failed-verification') {
      console.error(
        `Verification failed at "${r.stage}": ${r.detail}. Nothing was registered.`,
      );
      process.exitCode = 1;
    } else {
      console.error(`Abandoned: ${r.reason}`);
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
