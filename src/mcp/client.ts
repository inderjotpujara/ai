import {
  auth,
  createMCPClient,
  type MCPClient,
  type OAuthClientProvider,
  UnauthorizedError,
} from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';
import { type BreakerOpts, breakerFor } from '../reliability/breaker.ts';
import type { LiveOAuthClientProvider } from './oauth-provider.ts';

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
 *  (`OAuthClientProvider`); we pass it straight through. `mountMcpServer`
 *  additionally completes the first-time handshake (browser redirect → code
 *  exchange → token save) when `authProvider` is our own
 *  `LiveOAuthClientProvider` (`createOAuthProvider`, see below); see
 *  docs/architecture.md §14. */
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

/** Injectable seams for {@link mountMcpServer} so the first-time-OAuth
 *  orchestration is unit-testable without a live server: default to the real
 *  `@ai-sdk/mcp` exports, override with fakes in tests. */
export type MountMcpServerDeps = {
  createClient?: typeof createMCPClient;
  authFn?: typeof auth;
};

/** True for a `RichError`-shaped `UnauthorizedError` from `@ai-sdk/mcp`.
 *  Falls back to a constructor-name match (rather than `instanceof`-only) in
 *  case a duplicate module instance is loaded (e.g. hoisted differently by
 *  the package manager) — same defensive pattern as other cross-boundary
 *  error checks in this codebase. */
function isUnauthorizedError(err: unknown): boolean {
  if (err instanceof UnauthorizedError) return true;
  return (
    (err as { constructor?: { name?: string } } | undefined)?.constructor
      ?.name === 'UnauthorizedError'
  );
}

/** Narrows an `OAuthClientProvider` to the `LiveOAuthClientProvider` our own
 *  `createOAuthProvider` returns — the only shape with a `waitForRedirect`
 *  to await after the SDK throws `UnauthorizedError`. A caller-supplied
 *  `OAuthClientProvider` without it (e.g. the contract-test stub above)
 *  can't complete an interactive handshake, so it's left to throw. */
function hasWaitForRedirect(
  provider: OAuthClientProvider | undefined,
): provider is LiveOAuthClientProvider {
  return (
    typeof (provider as Partial<LiveOAuthClientProvider> | undefined)
      ?.waitForRedirect === 'function'
  );
}

/** Connects to an MCP server, completing the first-time OAuth handshake if
 *  needed. The SDK's HTTP transport calls `auth()` internally with no
 *  authorization code on a never-before-authorized server; that fires the
 *  provider's `redirectToAuthorization` (pops the browser) and then throws
 *  `UnauthorizedError` — there's no `transport.finishAuth` re-entry point,
 *  so the caller has to redrive the exchange itself via the SDK's exported
 *  `auth()`. On that error (only for an HTTP spec whose `authProvider` is
 *  our live one), this: awaits the loopback callback the provider already
 *  captured, exchanges the code for tokens via `auth()` (which validates
 *  `state` and calls `saveTokens` — our provider persists to the 0600
 *  store), then retries `createClient` exactly once with a fresh transport
 *  config (now reads back the just-saved tokens). A retry failure rethrows
 *  — a second `UnauthorizedError` means the exchange itself didn't work
 *  (bad code, revoked client, …), not that another browser hop would help. */
async function connectMcpClient(
  spec: McpMountSpec,
  createClient: typeof createMCPClient,
  authFn: typeof auth,
): Promise<MCPClient> {
  const transport =
    'url' in spec
      ? buildHttpTransportConfig(spec)
      : new StdioMCPTransport(spec);
  try {
    return await createClient({ transport });
  } catch (err) {
    if (
      !('url' in spec) ||
      !hasWaitForRedirect(spec.authProvider) ||
      !isUnauthorizedError(err)
    ) {
      throw err;
    }
    const { code, state } = await spec.authProvider.waitForRedirect();
    await authFn(spec.authProvider, {
      serverUrl: new URL(spec.url),
      authorizationCode: code,
      callbackState: state,
    });
    return await createClient({ transport: buildHttpTransportConfig(spec) });
  }
}

/** Connect to ANY stdio or Streamable-HTTP MCP server and expose its tools.
 *  The integration primitive. */
export async function mountMcpServer(
  spec: McpMountSpec,
  deps: MountMcpServerDeps = {},
): Promise<MountedServer> {
  const createClient = deps.createClient ?? createMCPClient;
  const authFn = deps.authFn ?? auth;
  const client = await connectMcpClient(spec, createClient, authFn);
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
