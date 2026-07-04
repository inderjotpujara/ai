import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';

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
    console.error(
      'Usage: bun run agent-builder "<capability you need>" [--yes]',
    );
    process.exit(1);
  }
  const { deps, cleanup } = await makeRealBuilderDeps({ autoYes });
  try {
    const result = await buildAgent(need, deps);
    if (result.kind === 'written') {
      console.log(
        `Created agent "${result.proposal.name}". Files: ${result.files.join(', ')}`,
      );
      console.log(
        'It is live on your next run. Its MCP server (if any) is consent-gated on first mount.',
      );
    } else if (result.kind === 'declined') {
      console.error('Declined — nothing written.');
    } else if (result.kind === 'invalid') {
      console.error('Could not build a valid agent:');
      for (const i of result.issues)
        console.error(`  - ${i.field}: ${i.problem}`);
      process.exitCode = 1;
    } else if (result.kind === 'reused') {
      console.log(
        `An existing agent "${result.name}" already covers this need (similarity ${result.similarity.toFixed(2)}). Nothing generated.`,
      );
    } else if (result.kind === 'failed-verification') {
      console.error(
        `Verification failed at "${result.stage}": ${result.detail}. Nothing was registered.`,
      );
      process.exitCode = 1;
    } else {
      console.error(`Abandoned: ${result.reason}`);
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
