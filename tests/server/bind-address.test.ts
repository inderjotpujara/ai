import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/schema.ts';
import { startWebServer } from '../../src/server/main.ts';

// Hermetic durable-auth paths so booting a server here never reads/writes the
// real ~/.agent daemon token (Slice 24 Incr 5), mirroring main.test.ts.
function authPaths(): { rootTokenPath: string; sessionRevocationPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bind-addr-auth-'));
  return {
    rootTokenPath: join(dir, 'daemon-token'),
    sessionRevocationPath: join(dir, 'revoked-devices.json'),
  };
}

test('startWebServer binds the given loopback address and serves', async () => {
  const h = startWebServer({ port: 0, bind: '127.0.0.1', ...authPaths() });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/`, {
      headers: { host: `127.0.0.1:${h.port}` },
    });
    expect(res.status).toBeLessThan(500); // loopback reachable
    expect(h.server.hostname).toBe('127.0.0.1');
  } finally {
    await h.pool.stop();
    h.server.stop();
  }
});

test('startWebServer with no bind option defaults to AGENT_WEB_BIND', async () => {
  const h = startWebServer({ port: 0, ...authPaths() });
  try {
    expect(h.server.hostname).toBe('127.0.0.1');
  } finally {
    await h.pool.stop();
    h.server.stop();
  }
});

test('AGENT_WEB_BIND defaults to loopback (no implicit 0.0.0.0)', () => {
  const prev = process.env.AGENT_WEB_BIND;
  delete process.env.AGENT_WEB_BIND;
  try {
    expect(String(loadConfig().values.AGENT_WEB_BIND)).toBe('127.0.0.1');
  } finally {
    if (prev !== undefined) process.env.AGENT_WEB_BIND = prev;
  }
});
