import { expect, test } from 'bun:test';
import { mountMcpServer } from '../../src/mcp/client.ts';

// Proves mountMcpServer is generic (not hardcoded to one server) by mounting our
// OWN read_file server through it. Real subprocess; needs bun, no network.
test('mountMcpServer mounts an arbitrary stdio server and exposes its tools', async () => {
  const { tools, close } = await mountMcpServer({
    command: 'bun',
    args: ['run', 'src/mcp/server.ts'],
  });
  try {
    expect(tools.read_file).toBeDefined();
  } finally {
    await close();
  }
});
