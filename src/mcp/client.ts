import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

/** How to launch a stdio MCP server. */
export type McpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** A mounted server's tools plus a handle to stop its subprocess. */
export type MountedServer = { tools: ToolSet; close: () => Promise<void> };

/** Connect to ANY stdio MCP server and expose its tools. The integration primitive. */
export async function mountMcpServer(spec: McpServerSpec): Promise<MountedServer> {
  const client = await createMCPClient({
    transport: new StdioMCPTransport(spec),
  });
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
