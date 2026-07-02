import { expect, test } from 'bun:test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { mountMcpServer } from '../../src/mcp/client.ts';

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const server = new McpServer({ name: 'http-test', version: '0.0.1' });
  server.registerTool(
    'ping',
    { description: 'ping', inputSchema: { msg: z.string() } },
    async ({ msg }) => ({ content: [{ type: 'text', text: `pong:${msg}` }] }),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

test('mountMcpServer mounts a real Streamable-HTTP server', async () => {
  const httpServer = createServer((req, res) => {
    handle(req, res).catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
  const addr = httpServer.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  try {
    const { tools, close } = await mountMcpServer({
      type: 'http',
      url: `http://127.0.0.1:${addr.port}/mcp`,
    });
    try {
      expect(tools.ping).toBeDefined();
    } finally {
      await close();
    }
  } finally {
    httpServer.close();
  }
});
