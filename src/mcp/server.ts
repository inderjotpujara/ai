import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileText } from '../tools/read-file.ts';

const server = new McpServer({ name: 'file-tools', version: '0.1.0' });

server.registerTool(
  'read_file',
  {
    title: 'Read File',
    description: 'Read a UTF-8 text file from disk and return its contents.',
    inputSchema: { path: z.string() }, // RAW shape, not z.object(...)
  },
  async ({ path }) => {
    try {
      return { content: [{ type: 'text', text: await readFileText(path) }] };
    } catch (cause) {
      return {
        content: [
          {
            type: 'text',
            text: `Could not read ${path}: ${(cause as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

await server.connect(new StdioServerTransport());
