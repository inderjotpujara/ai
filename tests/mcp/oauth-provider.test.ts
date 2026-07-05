import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOAuthProvider } from '../../src/mcp/oauth-provider.ts';

test('persists + returns tokens and code verifier via the store', async () => {
  const storePath = join(tmpdir(), `oauth-${Date.now()}.json`);
  const p = createOAuthProvider('linear', { storePath });
  await p.saveCodeVerifier('verifier-123');
  expect(await p.codeVerifier()).toBe('verifier-123');
  await p.saveTokens({ access_token: 'tok', token_type: 'Bearer' } as never);
  expect((await p.tokens())?.access_token).toBe('tok');
  expect(p.clientMetadata.redirect_uris.length).toBeGreaterThan(0);
});

test('round-trips client information via the store', async () => {
  const storePath = join(tmpdir(), `oauth-${Date.now()}-client.json`);
  const p = createOAuthProvider('linear', { storePath });
  if (!p.saveClientInformation) {
    throw new Error('provider is missing saveClientInformation');
  }
  await p.saveClientInformation({
    client_id: 'cid',
    client_secret: 'secret',
  });
  const client = await p.clientInformation();
  expect(client?.client_id).toBe('cid');
  expect(client?.client_secret).toBe('secret');
});

test('saveTokens/tokens round-trips expires_in through the expires_at epoch conversion', async () => {
  const storePath = join(tmpdir(), `oauth-${Date.now()}-expiry.json`);
  const p = createOAuthProvider('linear', { storePath });
  await p.saveTokens({
    access_token: 't',
    token_type: 'Bearer',
    expires_in: 3600,
  } as never);
  const expiresIn = (await p.tokens())?.expires_in;
  expect(expiresIn).toBeDefined();
  // Allow a small tolerance for the elapsed time between saveTokens() and
  // tokens() recomputing expires_in from the stored absolute expires_at.
  expect(expiresIn).toBeGreaterThan(3590);
  expect(expiresIn).toBeLessThanOrEqual(3600);
});

test('mints a real per-flow state nonce that storedState() returns', async () => {
  const storePath = join(tmpdir(), `oauth-${Date.now()}-state.json`);
  const p = createOAuthProvider('linear', { storePath });
  if (!p.state || !p.saveState || !p.storedState) {
    throw new Error('provider is missing the optional state members');
  }
  const minted = await p.state();
  expect(minted).toBeTruthy();
  expect(minted.length).toBeGreaterThan(0);
  await p.saveState(minted);
  const stored = await p.storedState();
  expect(stored).toBe(minted);
});
