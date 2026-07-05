import type { OAuthClientProvider } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import {
  askYesNo,
  interactiveTTY,
  stdinInput,
} from '../provisioning/ui/prompt.ts';
import {
  type McpMountSpec,
  type MountedServer,
  mountMcpServer,
} from './client.ts';
import {
  type ApprovalRecord,
  approvalsPath,
  type ConsentDeps,
  checkDrift,
  ensureConsent,
  pinTools,
  readApprovals,
  toolsHash,
  writeApprovals,
} from './consent.ts';
import {
  McpAuthKind,
  type McpConfig,
  type McpServerEntry,
  McpTransportKind,
} from './types.ts';

export type MountedRegistry = {
  /** Every mounted tool (workflow tool-steps dispatch by name against this). */
  merged: ToolSet;
  /** The slice an agent sees: unscoped entries + entries listing this agent. */
  forAgent(name: string): ToolSet;
  mounted: { name: string; toolCount: number; kind: McpTransportKind }[];
  skipped: { name: string; reason: string }[];
  close(): Promise<void>;
};

export type MountAllDeps = {
  mount?: (spec: McpMountSpec) => Promise<MountedServer>;
  consent?: Partial<ConsentDeps>;
  approvalsFile?: string;
  warn?: (msg: string) => void;
  /** OAuth providers, keyed by entry name, for entries whose `auth.kind` is
   *  `oauth`. Never sourced from JSON config (a provider is a stateful
   *  runtime object, not data) — the caller constructs and registers one.
   *  As of Slice 26 `withMcpRun` constructs + registers a live provider for
   *  every `oauth` entry; an entry with no registered provider still degrades
   *  to mounting without auth (warns; never crashes). */
  authProviders?: Record<string, OAuthClientProvider>;
};

function toSpec(
  entry: McpServerEntry,
  authProvider?: OAuthClientProvider,
): McpMountSpec {
  if (entry.kind === McpTransportKind.Http) {
    return {
      type: 'http',
      url: entry.url,
      headers: entry.headers,
      authProvider,
      name: entry.name,
    };
  }
  return {
    command: entry.command,
    args: entry.args,
    env: entry.env,
    name: entry.name,
  };
}

/** Resolve the authProvider for an entry declaring OAuth. When one is
 *  registered, `mountMcpServer` drives the live handshake with it; when none
 *  is registered this degrades to `undefined` (mount without auth) + a
 *  warning — never crashes. */
function resolveAuthProvider(
  entry: McpServerEntry,
  authProviders: Record<string, OAuthClientProvider> | undefined,
  warn: (msg: string) => void,
): OAuthClientProvider | undefined {
  if (entry.kind !== McpTransportKind.Http) return undefined;
  if (entry.auth?.kind !== McpAuthKind.OAuth) return undefined;
  const provider = authProviders?.[entry.name];
  if (!provider) {
    warn(
      `MCP server "${entry.name}" declares OAuth but no authProvider is registered — mounting without auth`,
    );
  }
  return provider;
}

/** Mount every approved config entry; consent-gate first, pin tool definitions
 *  after. Per-entry degrade: one failure never blocks the others. */
export async function mountAll(
  config: McpConfig,
  deps: MountAllDeps = {},
): Promise<MountedRegistry> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const mount = deps.mount ?? mountMcpServer;
  const approvalsFile = deps.approvalsFile ?? approvalsPath();
  const store: Record<string, ApprovalRecord> = readApprovals(approvalsFile);
  const input = stdinInput();
  const consent: ConsentDeps = {
    store,
    ask: (q) => askYesNo(q, { input, autoYes: false }),
    isTTY: interactiveTTY(),
    autoYes: process.env.AGENT_MCP_AUTO_APPROVE === '1',
    warn,
    ...deps.consent,
  };

  for (const w of config.warnings) warn(w);
  for (const d of config.dormant) {
    warn(
      `MCP server "${d.name}" is dormant — set ${d.missingVars.join(', ')} to activate it`,
    );
  }

  const servers: { entry: McpServerEntry; server: MountedServer }[] = [];
  const mounted: { name: string; toolCount: number; kind: McpTransportKind }[] =
    [];
  const skipped: { name: string; reason: string }[] = [];

  for (const entry of config.entries) {
    let ok: boolean;
    try {
      ok = await ensureConsent(entry, consent);
    } catch (cause) {
      warn(
        `MCP server "${entry.name}" has a malformed config: ${(cause as Error).message}`,
      );
      skipped.push({ name: entry.name, reason: (cause as Error).message });
      continue;
    }
    if (!ok) {
      skipped.push({ name: entry.name, reason: 'consent not granted' });
      continue;
    }
    let server: MountedServer;
    try {
      const authProvider = resolveAuthProvider(entry, deps.authProviders, warn);
      server = await mount(toSpec(entry, authProvider));
    } catch (cause) {
      warn(
        `MCP server "${entry.name}" failed to mount: ${(cause as Error).message}`,
      );
      skipped.push({ name: entry.name, reason: (cause as Error).message });
      continue;
    }
    const hash = toolsHash(server.tools);
    if (checkDrift(store, entry.name, hash)) {
      warn(
        `MCP server "${entry.name}" changed its tool definitions since approval (possible rug-pull)`,
      );
      const reOk = consent.autoYes
        ? true
        : consent.isTTY
          ? await consent.ask(
              `Tool definitions for "${entry.name}" CHANGED. Re-approve?`,
            )
          : false;
      if (!reOk) {
        await server.close().catch(() => {});
        skipped.push({
          name: entry.name,
          reason: 'tool-definition drift not re-approved',
        });
        continue;
      }
    }
    pinTools(store, entry.name, hash);
    servers.push({ entry, server });
    mounted.push({
      name: entry.name,
      toolCount: Object.keys(server.tools).length,
      kind: entry.kind,
    });
  }

  try {
    writeApprovals(store, approvalsFile);
  } catch (cause) {
    warn(`could not persist MCP approvals: ${(cause as Error).message}`);
  }

  const merged: ToolSet = {};
  for (const { entry, server } of servers) {
    for (const [name, t] of Object.entries(server.tools)) {
      if (merged[name]) {
        warn(
          `tool "${name}" from MCP server "${entry.name}" overrides an earlier server's tool of the same name`,
        );
      }
      merged[name] = t;
    }
  }

  return {
    merged,
    forAgent(agentName: string): ToolSet {
      const slice: ToolSet = {};
      for (const { entry, server } of servers) {
        if (entry.agents && !entry.agents.includes(agentName)) continue;
        Object.assign(slice, server.tools);
      }
      return slice;
    },
    mounted,
    skipped,
    async close(): Promise<void> {
      for (const { entry, server } of servers) {
        try {
          await server.close();
        } catch (cause) {
          warn(
            `closing MCP server "${entry.name}" failed: ${(cause as Error).message}`,
          );
        }
      }
    },
  };
}

/** Typo guard: warn when an entry's agents list names an agent that doesn't exist. */
export function warnUnknownAgents(
  config: McpConfig,
  knownAgents: string[],
  warn: (msg: string) => void,
): void {
  const known = new Set(knownAgents);
  for (const entry of config.entries) {
    for (const a of entry.agents ?? []) {
      if (!known.has(a)) {
        warn(
          `mcp.json entry "${entry.name}" targets unknown agent "${a}" (known: ${knownAgents.join(', ')})`,
        );
      }
    }
  }
}
