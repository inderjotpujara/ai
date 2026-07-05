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
