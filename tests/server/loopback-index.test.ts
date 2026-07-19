import { expect, test } from 'bun:test';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';

// A minimal ServerDeps: only the fields serveStatic/perimeter touch matter here.
function opsDeps(): ServerDeps {
  return {
    token: 'local-tok',
    localToken: 'local-tok',
    // Token-LESS base (what main.ts now renders): a <head> with a module script.
    indexHtml:
      '<!doctype html><html><head><title>t</title>' +
      '<script type="module" src="/assets/x.js"></script></head><body></body></html>',
    // Allow a non-loopback tunnel host past the perimeter so we can prove the
    // token is still withheld from it.
    policy: { port: 4130, allowedOrigins: [], allowedHosts: ['ts.example'] },
    recordIo: false,
  } as unknown as ServerDeps;
}

const get = (host: string) =>
  buildFetch(opsDeps())(new Request('http://x/', { headers: { host } }));

test('a loopback / request gets window.__AGENT_TOKEN__ injected', async () => {
  const body = await (await get('127.0.0.1:4130')).text();
  expect(body).toContain('window.__AGENT_TOKEN__="local-tok"');
});

test('a non-loopback (allowed tunnel) / request gets NO injected token', async () => {
  const res = await get('ts.example');
  expect(res.status).toBe(200); // passes the perimeter (allowlisted)
  const body = await res.text();
  expect(body).not.toContain('window.__AGENT_TOKEN__'); // but never the local token
});

test('the injected token appears BEFORE the SPA module script (defined before app code runs)', async () => {
  const body = await (await get('127.0.0.1:4130')).text();
  const tokenAt = body.indexOf('window.__AGENT_TOKEN__');
  const moduleAt = body.indexOf('<script type="module"');
  expect(tokenAt).toBeGreaterThanOrEqual(0);
  expect(moduleAt).toBeGreaterThanOrEqual(0);
  expect(tokenAt).toBeLessThan(moduleAt);
});

test('the SPA fallback (extensionless client route) also injects the local token only on loopback', async () => {
  const fetchFn = buildFetch(opsDeps());
  const loopback = await fetchFn(
    new Request('http://x/runs/run-1', { headers: { host: '127.0.0.1:4130' } }),
  );
  expect(await loopback.text()).toContain('window.__AGENT_TOKEN__="local-tok"');

  const tunnel = await fetchFn(
    new Request('http://x/runs/run-1', { headers: { host: 'ts.example' } }),
  );
  expect(await tunnel.text()).not.toContain('window.__AGENT_TOKEN__');
});

test('injection is per-request: a prior loopback load does not stamp the shared base served to a later tunnel request', async () => {
  const fetchFn = buildFetch(opsDeps());
  // Warm a loopback request first (which injects the token)...
  await (
    await fetchFn(
      new Request('http://x/', { headers: { host: '127.0.0.1:4130' } }),
    )
  ).text();
  // ...then a tunnel request must STILL get the token-less base.
  const tunnel = await fetchFn(
    new Request('http://x/', { headers: { host: 'ts.example' } }),
  );
  expect(await tunnel.text()).not.toContain('window.__AGENT_TOKEN__');
});
