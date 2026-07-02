import type { ToolSet } from 'ai';
import { getCrew } from '../../crews/index.ts';
import { type CrewDeps, runCrew } from '../crew/engine.ts';
import type { CrewDef, CrewOutcome } from '../crew/types.ts';
import { loadMcpConfig } from '../mcp/config.ts';
import { mountAll } from '../mcp/mount.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { withMcpMountSpan } from '../telemetry/spans.ts';
import type { VerifyDeps } from '../verification/types.ts';
import { createSelectionRuntime } from './select-runtime.ts';
import { makeRealVerifyDeps } from './verify-runtime.ts';

export type CrewCliDeps = {
  def: CrewDef;
  input: unknown;
  runsRoot: string;
  runId: string;
  tools: ToolSet;
  onBeforeDelegate?: CrewDeps['onBeforeDelegate']; // live model selection
  runAgentStep?: CrewDeps['runAgentStep']; // test seam
  /** Grounded-verification deps. Presence forces every task to verify
   *  (crew-wide default), mirroring `--verify` at the CLI. */
  verifyDeps?: VerifyDeps;
};

/** Run a crew with telemetry + artifact persistence (mirrors runFlow). */
export async function runCrewCli(deps: CrewCliDeps): Promise<CrewOutcome> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
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
  } finally {
    await tel.shutdown();
  }
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

  const config = loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    const selection = await createSelectionRuntime();
    try {
      const tools: ToolSet = reg.merged;
      const verifyRuntime = verify ? makeRealVerifyDeps() : undefined;
      try {
        const outcome = await runCrewCli({
          def,
          input: positional.join(' ').trim(),
          runsRoot: 'runs',
          runId: `crew-${process.pid}`,
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
  } finally {
    await reg.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
