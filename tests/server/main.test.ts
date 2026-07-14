import { expect, test } from 'bun:test';
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
