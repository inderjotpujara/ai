import { createRun, type RunHandle } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { withRunContext } from '../telemetry/run-router.ts';

/** Per-run CLI scope for CLIs that mount NO MCP servers (the builders +
 *  archive). Mirrors withMcpRun's ordering invariant minus the mount step:
 *  create the run dir, install the run-scoped telemetry provider, run the
 *  body, then flush telemetry — so every span opened inside the body
 *  (agent.build / crew.build / build.verify / build.archive) lands in
 *  runs/<id>/spans.jsonl instead of being a no-op. */
export async function withRunTelemetry<T>(
  opts: { runsRoot: string; runId: string },
  body: (run: RunHandle) => Promise<T>,
): Promise<T> {
  const run = await createRun(opts.runsRoot, opts.runId);
  const tel = initRunTelemetry(run.dir, run.id);
  try {
    return await withRunContext(run.id, () => body(run));
  } finally {
    await tel.shutdown();
  }
}
