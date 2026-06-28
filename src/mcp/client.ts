import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

/** Launch the file-tools MCP server and expose its tools to the agent. */
export async function createFileTools(): Promise<{
  tools: ToolSet;
  close: () => Promise<void>;
}> {
  const client = await createMCPClient({
    transport: new StdioMCPTransport({
      command: 'bun',
      args: ['run', 'src/mcp/server.ts'],
    }),
  });
  const tools = await client.tools();
  return { tools, close: () => client.close() };
}
