/**
 * `bun run reeval [--all | --agent <name>]` — the thin operator entrypoint
 * for the self-improvement re-eval loop (Slice 32 Task 22). It ENQUEUES only:
 * a single `JobKind.Eval` job is pushed onto the SAME `jobs.db` the daemon's
 * worker pool drains (`src/cli/daemon.ts`'s `buildRealDaemon` wires the real
 * `runEvalTurn` into dispatch) — this CLI never runs the eval inline, mirroring
 * how `server/evals/reeval.ts`'s `handleEvalReeval` route enqueues the exact
 * same payload shape for the web "re-eval now" button.
 *
 * `--agent <name>` enqueues `{mode: EvalMode.Artifact, ref: name,
 * reason:'manual'}` (re-evals ONE artifact); `--all` (or no flags — running
 * `bun run reeval` bare is the everyday "just re-check everything" case)
 * enqueues `{mode: EvalMode.Sweep, reason:'manual'}` (re-evals every reusable
 * artifact). A malformed invocation (`--agent` with no name, or an
 * unrecognized flag) fails closed: usage is printed and NOTHING is enqueued.
 *
 * `runReevalCli` is pure dispatch over an injected `ReevalCliDeps` seam — no
 * subcommand touches a store directly — so it is unit-testable without a real
 * `jobs.db`, exactly like `runA2aCli`/`runDaemonCli`. No `console.log` in the
 * dispatch body — output goes exclusively through `deps.print`.
 */

import { loadConfig } from '../config/schema.ts';
import { createJobStore, type JobStore } from '../queue/store.ts';
import { JobKind } from '../queue/types.ts';
import { EvalMode } from '../server/jobs/dispatch.ts';

export type ReevalCliDeps = {
  jobStore: Pick<JobStore, 'enqueue'>;
  print: (s: string) => void;
};

const USAGE = 'usage: bun run reeval [--all | --agent <name>]';

type ParsedArgs =
  | { kind: 'sweep' }
  | { kind: 'artifact'; ref: string }
  | { kind: 'usage' };

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv[0] === '--all') return { kind: 'sweep' };
  if (argv[0] === '--agent') {
    const ref = argv[1];
    return ref ? { kind: 'artifact', ref } : { kind: 'usage' };
  }
  return { kind: 'usage' };
}

export async function runReevalCli(
  argv: string[],
  deps: ReevalCliDeps,
): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'usage') {
    deps.print(USAGE);
    process.exitCode = 1;
    return;
  }
  // Exactly the payload shape `EvalJobPayloadSchema` (`server/jobs/dispatch.ts`)
  // and `handleEvalReeval` (`server/evals/reeval.ts`) already know how to
  // build/run — no new dispatch wiring is needed here.
  const payload =
    parsed.kind === 'artifact'
      ? { mode: EvalMode.Artifact, ref: parsed.ref, reason: 'manual' }
      : { mode: EvalMode.Sweep, reason: 'manual' };
  const job = deps.jobStore.enqueue({ kind: JobKind.Eval, payload });
  deps.print(`enqueued ${job.id}`);
}

/** Builds the real (non-test) deps: opens the SAME `jobs.db` the daemon's
 *  worker pool drains (`AGENT_QUEUE_PATH`, `createJobStore`) — sharing that
 *  path (rather than a second store) is what makes this an enqueue-only CLI:
 *  the daemon's already-running pool picks the job up and runs it. */
function buildRealDeps(): ReevalCliDeps {
  const cfg = loadConfig().values;
  const jobStore = createJobStore({ path: String(cfg.AGENT_QUEUE_PATH) }, {});
  return {
    jobStore,
    print: (s) => {
      console.log(s);
    },
  };
}

if (import.meta.main) {
  runReevalCli(process.argv.slice(2), buildRealDeps()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
