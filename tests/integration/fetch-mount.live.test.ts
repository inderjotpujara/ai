import { describe, expect, test } from 'bun:test';
import { createFetchTools } from '../../src/mcp/client.ts';
import { uvxReady } from './uvx-available.ts';

const ready = await uvxReady();

describe.skipIf(!ready)('live: uvx mcp-server-fetch mount', () => {
  test('exposes a fetch tool and retrieves a URL', async () => {
    const { tools, close } = await createFetchTools();
    try {
      const fetchTool = tools.fetch;
      expect(fetchTool).toBeDefined();
      if (fetchTool) {
        const result = await fetchTool.execute?.(
          { url: 'https://example.com', max_length: 500 },
          {} as never,
        );
        expect(JSON.stringify(result).toLowerCase()).toContain('example');
      }
    } finally {
      await close();
    }
  }, 60_000);
});
