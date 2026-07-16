import { buildAuthProviders } from '../../cli/with-mcp-run.ts';
import { approvalsPath } from '../../mcp/consent.ts';
import { mountAll } from '../../mcp/mount.ts';
import type { McpConfig, McpServerEntry } from '../../mcp/types.ts';
import { withMcpMountSpan } from '../../telemetry/spans.ts';

export type McpMountOneResult = {
  outcome: 'mounted' | 'skipped';
  reason?: string;
  toolCount?: number;
};

export type McpMountOneOpts = {
  ask: (question: string) => Promise<boolean>;
  warn: (msg: string) => void;
};

export type McpMountOne = (
  entry: McpServerEntry,
  opts: McpMountOneOpts,
) => Promise<McpMountOneResult>;

/**
 * Mounts ONE config entry to verify it works, then closes it — this is a
 * one-off connectivity + consent check, not a long-lived mount (a real
 * agent/crew/workflow run mounts its OWN registry per `withMcpRun`; nothing
 * here is shared with that path). Forces `isTTY: true` so `ensureConsent`
 * (`src/mcp/consent.ts`) actually calls `opts.ask` instead of silently
 * skipping (the D10 gap this whole seam exists to close). An OAuth entry
 * gets a live provider via the SAME `buildAuthProviders` helper `withMcpRun`
 * uses for real runs (Slice 26 loopback-pop, unchanged).
 */
export function createRealMcpMountOne(): McpMountOne {
  return async (entry, opts) => {
    const config: McpConfig = { entries: [entry], dormant: [], warnings: [] };
    const authProviders = buildAuthProviders(config);
    return withMcpMountSpan(async (record) => {
      const reg = await mountAll(config, {
        consent: {
          ask: opts.ask,
          isTTY: true,
          autoYes: false,
          warn: opts.warn,
        },
        authProviders,
        approvalsFile: approvalsPath(),
      });
      try {
        const mounted = reg.mounted.find((m) => m.name === entry.name);
        if (mounted) {
          record(mounted.name, 'mounted', mounted.toolCount, mounted.kind);
          return { outcome: 'mounted' as const, toolCount: mounted.toolCount };
        }
        const skipped = reg.skipped.find((s) => s.name === entry.name);
        record(entry.name, skipped?.reason ?? 'unknown', undefined, entry.kind);
        return {
          outcome: 'skipped' as const,
          reason: skipped?.reason ?? 'unknown',
        };
      } finally {
        await reg.close();
      }
    });
  };
}
