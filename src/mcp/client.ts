import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

/** How to launch a stdio MCP server. */
export type McpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** A remote Streamable-HTTP MCP server (static headers; OAuth is a follow-on). */
export type McpHttpSpec = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

export type McpMountSpec = McpServerSpec | McpHttpSpec;

/** A mounted server's tools plus a handle to stop its subprocess/connection. */
export type MountedServer = { tools: ToolSet; close: () => Promise<void> };

/** Connect to ANY stdio or Streamable-HTTP MCP server and expose its tools.
 *  The integration primitive. */
export async function mountMcpServer(
  spec: McpMountSpec,
): Promise<MountedServer> {
  const transport =
    'url' in spec
      ? ({ type: 'http', url: spec.url, headers: spec.headers } as const)
      : new StdioMCPTransport(spec);
  const client = await createMCPClient({ transport });
  const tools = await client.tools();
  return { tools, close: () => client.close() };
}

/** Our local read_file MCP server. */
export function createFileTools(): Promise<MountedServer> {
  return mountMcpServer({ command: 'bun', args: ['run', 'src/mcp/server.ts'] });
}

/** The official keyless web-fetch MCP server (requires uvx). Tool: `fetch`. */
export function createFetchTools(): Promise<MountedServer> {
  return mountMcpServer({ command: 'uvx', args: ['mcp-server-fetch'] });
}
