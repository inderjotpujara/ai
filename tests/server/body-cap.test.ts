import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from '../../src/server/main.ts';

// Hermetic durable-auth paths so booting a server here never reads/writes the
// real ~/.agent daemon token (Slice 24 Incr 5), mirroring main.test.ts.
function authPaths(): { rootTokenPath: string; sessionRevocationPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'body-cap-auth-'));
  return {
    rootTokenPath: join(dir, 'daemon-token'),
    sessionRevocationPath: join(dir, 'revoked-devices.json'),
  };
}

test('a request body over AGENT_WEB_MAX_BODY_BYTES is rejected with 413', async () => {
  process.env.AGENT_WEB_MAX_BODY_BYTES = '1024';
  const h = startWebServer({ port: 0, ...authPaths() });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/telemetry`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${h.port}` },
      body: 'x'.repeat(8192), // over the 1 KiB cap
    });
    expect(res.status).toBe(413); // enforced by Bun.serve BEFORE the fetch handler
  } finally {
    await h.pool.stop();
    h.server.stop();
    delete process.env.AGENT_WEB_MAX_BODY_BYTES;
  }
});

test('a within-cap request body is not rejected at the runtime layer', async () => {
  process.env.AGENT_WEB_MAX_BODY_BYTES = '1024';
  const h = startWebServer({ port: 0, ...authPaths() });
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/api/telemetry`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${h.port}` },
      body: 'x'.repeat(64), // well under the cap
    });
    // Not enforced by the body-size gate; the telemetry handler's own auth
    // (Task 36) still governs the final status (401 for a missing token).
    expect(res.status).not.toBe(413);
  } finally {
    await h.pool.stop();
    h.server.stop();
    delete process.env.AGENT_WEB_MAX_BODY_BYTES;
  }
});
