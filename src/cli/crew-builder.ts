import { buildCrewOrWorkflow } from '../crew-builder/builder.ts';
import { makeRealCrewBuilderDeps } from '../crew-builder/deps.ts';

function parseArgs(argv: string[]): { need: string; autoYes: boolean } {
  const positional: string[] = [];
  let autoYes = false;
  for (const a of argv) {
    if (a === '--yes' || a === '-y') autoYes = true;
    else positional.push(a);
  }
  return { need: positional.join(' ').trim(), autoYes };
}

async function main(): Promise<void> {
  const { need, autoYes } = parseArgs(process.argv.slice(2));
  if (need.length === 0) {
    console.error('Usage: bun run crew-builder "<multi-step need>" [--yes]');
    process.exit(1);
  }
  const { deps, cleanup } = await makeRealCrewBuilderDeps({ autoYes });
  try {
    const r = await buildCrewOrWorkflow(need, deps);
    if (r.kind === 'written') {
      console.log(
        `Created ${r.shape} "${r.name}". Files: ${r.files.join(', ')}`,
      );
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
