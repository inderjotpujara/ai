import { expect, test } from 'bun:test';
import { awaitOAuthRedirect } from '../../src/mcp/loopback.ts';

function redirectUriFrom(authUrl: string): string {
  const raw = new URL(authUrl).searchParams.get('redirect_uri');
  if (!raw) throw new Error('authUrl missing redirect_uri');
  return decodeURIComponent(raw);
}

test('captures code+state from the callback', async () => {
  const p = awaitOAuthRedirect(
    (redirectUri) =>
      `https://as.example/auth?redirect_uri=${encodeURIComponent(redirectUri)}`,
    'xyz',
    {
      openBrowser: (url) => {
        void fetch(`${redirectUriFrom(url)}?code=CODE123&state=xyz`);
      },
      timeoutMs: 5000,
    },
  );
  const r = await p;
  expect(r.code).toBe('CODE123');
  expect(r.state).toBe('xyz');
  expect(r.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
});

test('rejects on state mismatch and stops the server', async () => {
  const p = awaitOAuthRedirect(
    (redirectUri) =>
      `https://as.example/auth?redirect_uri=${encodeURIComponent(redirectUri)}`,
    'expected-state',
    {
      openBrowser: (url) => {
        void fetch(`${redirectUriFrom(url)}?code=CODE123&state=wrong-state`);
      },
      timeoutMs: 5000,
    },
  );
  await expect(p).rejects.toThrow('state mismatch');
});

test('rejects on missing code and stops the server', async () => {
  const p = awaitOAuthRedirect(
    (redirectUri) =>
      `https://as.example/auth?redirect_uri=${encodeURIComponent(redirectUri)}`,
    'expected-state',
    {
      openBrowser: (url) => {
        void fetch(`${redirectUriFrom(url)}?state=expected-state`);
      },
      timeoutMs: 5000,
    },
  );
  await expect(p).rejects.toThrow('missing code');
});
