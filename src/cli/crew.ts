import type { ToolSet } from 'ai';
import { getCrew } from '../../crews/index.ts';
import { type CrewDeps, runCrew } from '../crew/engine.ts';
import type { CrewDef, CrewOutcome } from '../crew/types.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { createSelectionRuntime } from './select-runtime.ts';

export type CrewCliDeps = {
  def: CrewDef;
  input: unknown;
  runsRoot: string;
  runId: string;
  tools: ToolSet;
  onBeforeDelegate?: CrewDeps['onBeforeDelegate']; // live model selection
  runAgentStep?: CrewDeps['runAgentStep']; // test seam
};

/** Run a crew with telemetry + artifact persistence (mirrors runFlow). */
export async function runCrewCli(deps: CrewCliDeps): Promise<CrewOutcome> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
    const outcome = await runCrew(deps.def, deps.input, {
      tools: deps.tools,
      onBeforeDelegate: deps.onBeforeDelegate,
      runAgentStep: deps.runAgentStep,
    });
    if (outcome.kind === 'done') {
      const text =
        typeof outcome.output === 'string'
          ? outcome.output
          : JSON.stringify(outcome.output, null, 2);
      await writeArtifact(run, 'result.txt', text);
    } else if (outcome.kind === 'unverified') {
      await writeArtifact(
        run,
        'unverified.txt',
        `task ${outcome.failedTaskId ?? '?'} abstained (faithfulness ${outcome.faithfulness}); unsupported claims:\n${outcome.unsupportedClaims.join('\n')}\n\ndraft:\n${outcome.draft}`,
      );
    } else {
      await writeArtifact(
        run,
        'failed.txt',
        `task ${outcome.failedTask ?? '?'}: ${outcome.message}`,
      );
    }
    return outcome;
  } finally {
    await tel.shutdown();
  }
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: bun run crew <name> [input...]');
    process.exit(1);
  }
  const def = getCrew(name);
  if (!def) {
    console.error(`Unknown crew: ${name}`);
    process.exit(1);
  }

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const selection = await createSelectionRuntime();
      try {
        const tools: ToolSet = { ...fileServer.tools, ...fetchServer.tools };
        const outcome = await runCrewCli({
          def,
          input: rest.join(' ').trim(),
          runsRoot: 'runs',
          runId: `crew-${process.pid}`,
          tools,
          onBeforeDelegate: selection.onBeforeDelegate,
        });
        if (outcome.kind === 'done') {
          console.log(
            typeof outcome.output === 'string'
              ? outcome.output
              : JSON.stringify(outcome.output, null, 2),
          );
        } else if (outcome.kind === 'unverified') {
          console.error(
            `Crew abstained at ${outcome.failedTaskId ?? '?'} (unverified, faithfulness ${outcome.faithfulness}): ${outcome.unsupportedClaims.join('; ')}`,
          );
          process.exitCode = 1;
        } else {
          console.error(
            `Crew failed at ${outcome.failedTask ?? '?'}: ${outcome.message}`,
          );
          process.exitCode = 1;
        }
      } finally {
        await selection.close();
      }
    } finally {
      await fetchServer.close();
    }
  } finally {
    await fileServer.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
