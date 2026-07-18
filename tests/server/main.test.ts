import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { renderIndexHtml, startWebServer } from '../../src/server/main.ts';

test('renderIndexHtml injects the session token into the served page', () => {
  const html = renderIndexHtml('tok-123');
  expect(html).toContain('tok-123');
  expect(html.toLowerCase()).toContain('<!doctype html>');
});

test('renderIndexHtml with no dist index returns the Phase-1 stub (root div, token, no /assets)', () => {
  const html = renderIndexHtml('tok-stub');
  expect(html).toContain('id="root"');
  expect(html).toContain('tok-stub');
  expect(html).not.toContain('/assets');
});

test('renderIndexHtml with a built dist index injects the token script before the module bundle script, keeps the stylesheet, and escapes a hostile token', () => {
  const distHtml =
    '<!doctype html><html lang="en"><head><meta charset="UTF-8" />' +
    '<title>Local Agents</title>' +
    '<script type="module" crossorigin src="/assets/index-x.js"></script>' +
    '<link rel="stylesheet" crossorigin href="/assets/index.css">' +
    '</head><body><div id="root"></div></body></html>';

  const html = renderIndexHtml('tok-456', distHtml);

  expect(html).toContain('tok-456');
  expect(html).toContain(
    '<script type="module" crossorigin src="/assets/index-x.js"></script>',
  );
  expect(html).toContain(
    '<link rel="stylesheet" crossorigin href="/assets/index.css">',
  );

  const tokenScriptIndex = html.indexOf('window.__AGENT_TOKEN__');
  const moduleScriptIndex = html.indexOf('type="module"');
  expect(tokenScriptIndex).toBeGreaterThan(-1);
  expect(moduleScriptIndex).toBeGreaterThan(-1);
  expect(tokenScriptIndex).toBeLessThan(moduleScriptIndex);

  const hostile = renderIndexHtml(
    '</script><script>alert(1)</script>',
    distHtml,
  );
  expect(hostile).not.toContain('</script><script>alert(1)</script>');
  expect(hostile).toContain(
    '\\u003c/script>\\u003cscript>alert(1)\\u003c/script>',
  );
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

test('renderIndexHtml also injects the notify-poll config (defaults) alongside the token', () => {
  const html = renderIndexHtml('tok-777');
  expect(html).toContain('window.__AGENT_NOTIFY_POLL_MS__=5000');
  expect(html).toContain('window.__AGENT_NOTIFY_MIN_DURATION_MS__=60000');
});

test('renderIndexHtml threads an explicit notify config through', () => {
  const html = renderIndexHtml('tok-888', undefined, {
    pollMs: 1234,
    minDurationMs: 99_999,
  });
  expect(html).toContain('window.__AGENT_NOTIFY_POLL_MS__=1234');
  expect(html).toContain('window.__AGENT_NOTIFY_MIN_DURATION_MS__=99999');
});

test('renderIndexHtml also injects the voice config (defaults) alongside the token', () => {
  const html = renderIndexHtml('tok-999');
  expect(html).toContain(
    'window.__AGENT_VOICE_DEFAULT_MODEL__="moonshine-base"',
  );
  expect(html).toContain('window.__AGENT_VOICE_VAD_SILENCE_MS__=800');
});

test('renderIndexHtml threads an explicit voice config through', () => {
  const html = renderIndexHtml('tok-1000', undefined, undefined, {
    defaultModel: 'moonshine-tiny',
    vadSilenceMs: 1200,
  });
  expect(html).toContain(
    'window.__AGENT_VOICE_DEFAULT_MODEL__="moonshine-tiny"',
  );
  expect(html).toContain('window.__AGENT_VOICE_VAD_SILENCE_MS__=1200');
});

test('renderIndexHtml escapes a hostile voice.defaultModel STRING value against </script> breakout (S1 fix — every JSON.stringify interpolation in the tokenScript must route through the shared safeJson escaper, not just the token)', () => {
  const html = renderIndexHtml('tok-1001', undefined, undefined, {
    defaultModel: '</script><script>alert(1)</script>',
    vadSilenceMs: 800,
  });
  expect(html).not.toContain('</script><script>alert(1)</script>');
  expect(html).toContain(
    'window.__AGENT_VOICE_DEFAULT_MODEL__="\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"',
  );
});
