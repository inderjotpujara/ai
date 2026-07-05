import { loadMcpConfig } from '../mcp/config.ts';
import {
  type MountAllDeps,
  type MountedRegistry,
  mountAll,
} from '../mcp/mount.ts';
import type { McpConfig } from '../mcp/types.ts';
import {
  createLedger,
  type DegradationLedger,
  serializeLedger,
} from '../reliability/ledger.ts';
import { createRun, type RunHandle, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { withMcpMountSpan } from '../telemetry/spans.ts';

export type McpRunContext = {
  run: RunHandle;
  reg: MountedRegistry;
  config: McpConfig;
  ledger: DegradationLedger;
};

/** Owns the per-run CLI scope so the ordering invariant lives in ONE place:
 *  create the run dir, install the run-scoped telemetry provider, THEN mount
 *  MCP under it (so `mcp.mount` reaches runs/<id>/spans.jsonl), run the body,
 *  and tear down (close registry, flush telemetry) in that order. */
export async function withMcpRun<T>(
  opts: {
    runsRoot: string;
    runId: string;
    config?: McpConfig;
    mountDeps?: MountAllDeps;
  },
  body: (ctx: McpRunContext) => Promise<T>,
): Promise<T> {
  const run = await createRun(opts.runsRoot, opts.runId);
  const tel = initRunTelemetry(run.dir);
  const config = opts.config ?? loadMcpConfig();
  const ledger = createLedger();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config, opts.mountDeps);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount, m.kind);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    return await body({ run, reg, config, ledger });
  } finally {
    if (ledger.events.length > 0) {
      await writeArtifact(run, 'degradation.jsonl', serializeLedger(ledger));
    }
    await reg.close();
    await tel.shutdown();
  }
}
