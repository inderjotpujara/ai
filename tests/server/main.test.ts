import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { renderIndexHtml, startWebServer } from '../../src/server/main.ts';

test('renderIndexHtml injects the session token into the served page', () => {
  const html = renderIndexHtml('tok-123');
  expect(html).toContain('tok-123');
  expect(html.toLowerCase()).toContain('<!doctype html>');
});

test('startWebServer boots on an ephemeral port, mints a token, and serves it', async () => {
  const { server, token, port } = startWebServer({ port: 0 });
  try {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(port).toBeGreaterThan(0);

    const index = await fetch(`http://localhost:${port}/`);
    expect(await index.text()).toContain(token);

    const health = await fetch(`http://localhost:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(health.status).toBe(200);

    const unauth = await fetch(`http://localhost:${port}/api/health`);
    expect(unauth.status).toBe(401);
  } finally {
    server.stop(true);
  }
});

test("startWebServer mkdirs the uploads dir at boot, so a chat request with a bogus uploadId (before any upload ever happened) 400s instead of 500ing on a missing root dir (regression: confineToDir's realpathSync on a nonexistent ROOT throws a raw ENOENT, not MediaPathError, which was re-thrown into a 500)", async () => {
  const uploadsDir = join('runs', '_uploads');
  // Simulate "no upload has ever happened yet": the dir doesn't exist.
  rmSync(uploadsDir, { recursive: true, force: true });

  const { server, token, port } = startWebServer({ port: 0 });
  try {
    // The fix: startWebServer creates it up front, before any request lands.
    expect(existsSync(uploadsDir)).toBe(true);

    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        ],
        uploadIds: ['does-not-exist.png'],
      }),
    });

    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});
