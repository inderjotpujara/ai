import type { ToolSet } from 'ai';
import { getCrew } from '../../crews/index.ts';
import { type CrewDeps, runCrew } from '../crew/engine.ts';
import type { CrewDef, CrewOutcome } from '../crew/types.ts';
import { type RunHandle, writeArtifact } from '../run/run-store.ts';
import type { VerifyDeps } from '../verification/types.ts';
import { createSelectionRuntime } from './select-runtime.ts';
import { makeRealVerifyDeps } from './verify-runtime.ts';
import { withMcpRun } from './with-mcp-run.ts';

export type CrewCliDeps = {
  def: CrewDef;
  input: unknown;
  run: RunHandle;
  tools: ToolSet;
  onBeforeDelegate?: CrewDeps['onBeforeDelegate']; // live model selection
  runAgentStep?: CrewDeps['runAgentStep']; // test seam
  /** Grounded-verification deps. Presence forces every task to verify
   *  (crew-wide default), mirroring `--verify` at the CLI. */
  verifyDeps?: VerifyDeps;
};

/** Run a crew with telemetry + artifact persistence (mirrors runFlow).
 *  Telemetry + the run dir are established by the caller (withMcpRun). */
export async function runCrewCli(deps: CrewCliDeps): Promise<CrewOutcome> {
  const { run } = deps;
  const def = deps.verifyDeps ? { ...deps.def, verify: true } : deps.def;
  const outcome = await runCrew(def, deps.input, {
    tools: deps.tools,
    onBeforeDelegate: deps.onBeforeDelegate,
    runAgentStep: deps.runAgentStep,
    verifyDeps: deps.verifyDeps,
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
}

/** Split `--verify` out of the positional args (mirrors the `--flag value`
 *  parsing in src/cli/memory.ts, simplified to a single boolean flag). */
function parseArgs(argv: string[]): { positional: string[]; verify: boolean } {
  const positional: string[] = [];
  let verify = false;
  for (const arg of argv) {
    if (arg === '--verify') verify = true;
    else positional.push(arg);
  }
  return { positional, verify };
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: bun run crew <name> [input...] [--verify]');
    process.exit(1);
  }
  const def = getCrew(name);
  if (!def) {
    console.error(`Unknown crew: ${name}`);
    process.exit(1);
  }
  const { positional, verify } = parseArgs(rest);

  await withMcpRun(
    { runsRoot: 'runs', runId: `crew-${process.pid}` },
    async ({ run, reg, ledger }) => {
      const selection = await createSelectionRuntime({ ledger });
      try {
        const tools: ToolSet = reg.merged;
        const verifyRuntime = verify ? makeRealVerifyDeps() : undefined;
        try {
          const outcome = await runCrewCli({
            def,
            input: positional.join(' ').trim(),
            run,
            tools,
            onBeforeDelegate: selection.onBeforeDelegate,
            verifyDeps: verifyRuntime?.verifyDeps,
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
          if (verifyRuntime) {
            verifyRuntime.store.close();
            await verifyRuntime.manager.unloadAll();
          }
        }
      } finally {
        await selection.close();
      }
    },
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
