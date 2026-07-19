import { expect, test } from 'bun:test';
import { noRedirectFetch } from '../../src/mcp/http-redirect.ts';

test('a redirect response is rejected, not followed (SSRF guard)', async () => {
  const fake = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/' },
    })) as unknown as typeof fetch;
  await expect(
    noRedirectFetch('https://mcp.example/sse', {}, fake),
  ).rejects.toThrow();
});

test('a normal 200 passes through', async () => {
  const fake = (async () =>
    new Response('ok', { status: 200 })) as unknown as typeof fetch;
  expect(
    (await noRedirectFetch('https://mcp.example/sse', {}, fake)).status,
  ).toBe(200);
});
