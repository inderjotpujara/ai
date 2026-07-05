import type { OAuthClientProvider } from '@ai-sdk/mcp';
import { loadMcpConfig } from '../mcp/config.ts';
import {
  type MountAllDeps,
  type MountedRegistry,
  mountAll,
} from '../mcp/mount.ts';
import { createOAuthProvider } from '../mcp/oauth-provider.ts';
import { McpAuthKind, type McpConfig, McpTransportKind } from '../mcp/types.ts';
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

/** Auto-builds a live OAuth provider for every http entry declaring
 *  `auth.kind === oauth`, keyed by entry name — so a caller that never
 *  touches `mountDeps.authProviders` still gets real OAuth instead of the
 *  silent "no provider registered" degrade in mount.ts. */
function buildAuthProviders(
  config: McpConfig,
): Record<string, OAuthClientProvider> {
  const providers: Record<string, OAuthClientProvider> = {};
  for (const entry of config.entries) {
    if (entry.kind !== McpTransportKind.Http) continue;
    if (entry.auth?.kind !== McpAuthKind.OAuth) continue;
    providers[entry.name] = createOAuthProvider(entry.name, {
      scopes: entry.auth.scopes,
      clientId: entry.auth.clientId,
    });
  }
  return providers;
}

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
  // Caller-supplied providers win over the auto-built ones (spread order).
  const authProviders = {
    ...buildAuthProviders(config),
    ...opts.mountDeps?.authProviders,
  };
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config, { ...opts.mountDeps, authProviders });
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount, m.kind);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    return await body({ run, reg, config, ledger });
  } finally {
    if (ledger.events.length > 0) {
      try {
        await writeArtifact(run, 'degradation.jsonl', serializeLedger(ledger));
      } catch (err) {
        console.error(
          `failed to persist degradation ledger: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await reg.close();
    await tel.shutdown();
  }
}
