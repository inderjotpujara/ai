import type { OAuthClientProvider } from '@ai-sdk/mcp';
import { loadMcpConfig } from '../mcp/config.ts';
import {
  type MountAllDeps,
  type MountedRegistry,
  mountAll,
} from '../mcp/mount.ts';
import { createOAuthProvider } from '../mcp/oauth-provider.ts';
import { getServerAuth } from '../mcp/token-store.ts';
import { McpAuthKind, type McpConfig, McpTransportKind } from '../mcp/types.ts';
import {
  createLedger,
  type DegradationLedger,
  serializeLedger,
} from '../reliability/ledger.ts';
import { createRun, type RunHandle, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { withRunContext } from '../telemetry/run-router.ts';
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
 *  silent "no provider registered" degrade in mount.ts.
 *
 *  Exported (Slice 30b Phase 5) so `src/server/mcp/mount-one.ts` can build a
 *  live OAuth provider for a single test-mount entry, reusing the exact
 *  Slice-26 loopback-pop mechanism `withMcpRun` already uses for real runs —
 *  no new OAuth code, no change to this file's own CLI behavior. */
export function buildAuthProviders(
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

/** Determines (never performs) the auth outcome for each HTTP entry ahead of
 *  mount, so it's observable without depending on the live OAuth handshake:
 *  static-header entries are always `static-key`; OAuth entries are
 *  `token-reused` when the token store already holds an access token for
 *  that server, else `authenticated` (a fresh handshake is expected to run
 *  during mount). `auth-failed` is not determinable here — a thrown mount
 *  for an OAuth server is covered by the live path in Task 18. */
function recordAuthOutcomes(
  config: McpConfig,
  recordAuth: (name: string, kind: string, outcome: string) => void,
): void {
  for (const entry of config.entries) {
    if (entry.kind !== McpTransportKind.Http) continue;
    if (entry.auth?.kind !== McpAuthKind.OAuth) {
      recordAuth(entry.name, McpAuthKind.Static, 'static-key');
      continue;
    }
    const hasToken = getServerAuth(entry.name).tokens?.access_token != null;
    recordAuth(
      entry.name,
      McpAuthKind.OAuth,
      hasToken ? 'token-reused' : 'authenticated',
    );
  }
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
  const tel = initRunTelemetry(run.dir, run.id);
  const config = opts.config ?? loadMcpConfig();
  const ledger = createLedger();
  // Caller-supplied providers win over the auto-built ones (spread order).
  const authProviders = {
    ...buildAuthProviders(config),
    ...opts.mountDeps?.authProviders,
  };
  // Bind the run id into the OTel context so every span opened inside — the
  // mcp.mount span AND everything the body emits — routes to this run's
  // spans.jsonl (the router fans by run id; there is no per-run provider).
  return await withRunContext(run.id, async () => {
    const reg = await withMcpMountSpan(async (record, recordAuth) => {
      recordAuthOutcomes(config, recordAuth);
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
          await writeArtifact(
            run,
            'degradation.jsonl',
            serializeLedger(ledger),
          );
        } catch (err) {
          console.error(
            `failed to persist degradation ledger: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      await reg.close();
      await tel.shutdown();
    }
  });
}
