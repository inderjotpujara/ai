import { createMCPClient, type OAuthClientProvider } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';
import { type BreakerOpts, breakerFor } from '../reliability/breaker.ts';

/** How to launch a stdio MCP server. */
export type McpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Stable id for this server's circuit breaker; falls back to `command`. */
  name?: string;
};

/** A remote Streamable-HTTP MCP server. Static-key auth (default): fixed
 *  `headers` (PAT/API key from env), unchanged. OAuth: an `authProvider` —
 *  the installed `@ai-sdk/mcp`'s HTTP transport accepts one natively
 *  (`OAuthClientProvider`); we pass it straight through. Contract-tested
 *  only — live token exchange is deferred (no server to auth against; see
 *  docs/architecture.md §14). */
export type McpHttpSpec = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  authProvider?: OAuthClientProvider;
  /** Stable id for this server's circuit breaker; falls back to `url`. */
  name?: string;
};

export type McpMountSpec = McpServerSpec | McpHttpSpec;

/** A mounted server's tools plus a handle to stop its subprocess/connection. */
export type MountedServer = { tools: ToolSet; close: () => Promise<void> };

/** Pure builder for the HTTP transport config, split out so the
 *  static-header-vs-authProvider wiring is unit-testable without a network
 *  round-trip or mocking `createMCPClient`. */
export function buildHttpTransportConfig(spec: McpHttpSpec) {
  return {
    type: 'http' as const,
    url: spec.url,
    headers: spec.headers,
    authProvider: spec.authProvider,
  };
}

/** Wrap each tool's `execute` in a per-server circuit breaker so one dead MCP
 *  server can't stall a whole crew: after `opts.threshold` consecutive
 *  failures the breaker opens and further calls reject fast with
 *  `CircuitOpenError` instead of hanging/retrying against a dead server. */
export function wrapToolsWithBreaker(
  serverName: string,
  tools: ToolSet,
  opts?: BreakerOpts,
): ToolSet {
  const breaker = breakerFor(`mcp:${serverName}`, opts);
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const execute = t.execute;
    out[name] = execute
      ? ({
          ...t,
          execute: (args: unknown, o: unknown) =>
            breaker.run(() => execute(args, o as never)),
        } as typeof t)
      : t;
  }
  return out;
}

/** Connect to ANY stdio or Streamable-HTTP MCP server and expose its tools.
 *  The integration primitive. */
export async function mountMcpServer(
  spec: McpMountSpec,
): Promise<MountedServer> {
  const transport =
    'url' in spec
      ? buildHttpTransportConfig(spec)
      : new StdioMCPTransport(spec);
  const client = await createMCPClient({ transport });
  const tools = await client.tools();
  const serverName = spec.name ?? ('url' in spec ? spec.url : spec.command);
  return {
    tools: wrapToolsWithBreaker(serverName, tools),
    close: () => client.close(),
  };
}

/** Our local read_file MCP server. */
export function createFileTools(): Promise<MountedServer> {
  return mountMcpServer({ command: 'bun', args: ['run', 'src/mcp/server.ts'] });
}

/** The official keyless web-fetch MCP server (requires uvx). Tool: `fetch`. */
export function createFetchTools(): Promise<MountedServer> {
  return mountMcpServer({ command: 'uvx', args: ['mcp-server-fetch'] });
}
