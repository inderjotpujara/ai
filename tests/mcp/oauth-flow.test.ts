import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auth } from '@ai-sdk/mcp';
import { createOAuthProvider } from '../../src/mcp/oauth-provider.ts';
import { getServerAuth } from '../../src/mcp/token-store.ts';
import { startMockOAuthAs } from './helpers/mock-oauth-as.ts';

// Deterministic, fully-local end-to-end OAuth 2.1 handshake test. This is the
// TDD net for the bug the live Linear handshake exposed: `auth()`'s
// code-exchange call needs the authorization-server metadata discovered on
// the FIRST `auth()` call to be persisted by the provider and returned on the
// exchange call, or it throws:
//   "Stored OAuth authorization server metadata is required when exchanging
//    an authorization code"
// (see `authInternal` in `@ai-sdk/mcp`'s `dist/index.js`). Before the
// Task-18b fix (the provider's `authorizationServerInformation` /
// `saveAuthorizationServerInformation` members), this test reproduces that
// exact error; after the fix it passes.

let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test('completes DCR + redirect + PKCE exchange against a mock AS, persists tokens + AS metadata, and lets a second provider reuse them', async () => {
  workDir = mkdtempSync(join(tmpdir(), 'oauth-flow-'));
  const storePath = join(workDir, 'mcp-tokens.json');
  const as = startMockOAuthAs();
  try {
    const provider = createOAuthProvider('mock', {
      storePath,
      // "Opens a browser": a same-process fetch that follows the mock AS's
      // 302 straight into the provider's own loopback listener — no human
      // step, fully deterministic.
      openBrowser: (url) => {
        fetch(url).catch(() => {});
      },
    });

    // First auth() call: no stored client / tokens yet, so the SDK drives
    // DCR against the mock AS, discovers + (per the fix) persists AS
    // metadata, saves the PKCE code verifier, and redirects.
    const first = await auth(provider, { serverUrl: as.url });
    expect(first).toBe('REDIRECT');
    expect(as.registeredClientIds.length).toBe(1);

    // Exactly the Task-18a orchestration (src/mcp/client.ts connectMcpClient):
    // await the loopback capture, then redrive auth() with the code.
    const { code, state } = await provider.waitForRedirect();
    const exchanged = await auth(provider, {
      serverUrl: as.url,
      authorizationCode: code,
      callbackState: state,
    });
    expect(exchanged).toBe('AUTHORIZED');

    // Tokens were exchanged (mock AS issued exactly one authorization_code
    // grant) and persisted to the store.
    expect(as.issuedTokens.length).toBe(1);
    const persisted = getServerAuth('mock', storePath);
    expect(persisted.tokens?.access_token).toBe(
      as.issuedTokens[0]?.access_token,
    );
    expect(persisted.tokens?.refresh_token).toBe(
      as.issuedTokens[0]?.refresh_token,
    );

    // The AS-metadata members were exercised: the provider persisted what
    // discovery returned (issuer == mock AS origin, per RFC 8414).
    expect(persisted.authorizationServer?.authorizationServerUrl).toBe(as.url);
    expect(persisted.authorizationServer?.tokenEndpoint).toBe(`${as.url}token`);

    // A second provider instance built on the same store reuses the tokens
    // with no re-auth (no browser open, no fresh loopback listener needed).
    let browserOpened = false;
    const provider2 = createOAuthProvider('mock', {
      storePath,
      openBrowser: () => {
        browserOpened = true;
      },
    });
    const reused = await provider2.tokens();
    expect(reused?.access_token).toBe(as.issuedTokens[0]?.access_token);
    expect(browserOpened).toBe(false);
  } finally {
    as.stop();
  }
});
