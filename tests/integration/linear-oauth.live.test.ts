import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMcpConfig } from '../../src/mcp/config.ts';
import { mountAll } from '../../src/mcp/mount.ts';
import { createOAuthProvider } from '../../src/mcp/oauth-provider.ts';
import { getServerAuth } from '../../src/mcp/token-store.ts';

// Gated live OAuth handshake against Linear's public remote MCP server
// (OAuth 2.1 + Dynamic Client Registration — no app pre-registration needed).
// Run with (a browser window will open for you to approve):
//   MCP_OAUTH_LIVE=1 bun test tests/integration/linear-oauth.live.test.ts
const LIVE = process.env.MCP_OAUTH_LIVE === '1';
const LINEAR_URL = process.env.MCP_OAUTH_URL ?? 'https://mcp.linear.app/mcp';

const workDir = mkdtempSync(join(tmpdir(), 'linear-oauth-'));
const storePath = join(workDir, 'mcp-tokens.json');
const approvalsFile = join(workDir, '.mcp-approvals.json');
const configPath = join(workDir, 'mcp.json');
writeFileSync(
  configPath,
  JSON.stringify({
    mcpServers: {
      linear: { type: 'http', url: LINEAR_URL, auth: { kind: 'oauth' } },
    },
  }),
);

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe.skipIf(!LIVE)('linear OAuth live-verify', () => {
  test('first run: browser handshake mounts the server and persists tokens', async () => {
    const config = loadMcpConfig(configPath);
    const reg = await mountAll(config, {
      authProviders: { linear: createOAuthProvider('linear', { storePath }) },
      consent: { autoYes: true },
      approvalsFile,
    });
    try {
      expect(reg.mounted.map((m) => m.name)).toContain('linear');
      expect(Object.keys(reg.merged).length).toBeGreaterThan(0);
      // Tokens were exchanged and persisted to the 0600 store.
      expect(
        getServerAuth('linear', storePath).tokens?.access_token,
      ).toBeTruthy();
    } finally {
      await reg.close();
    }
  }, 300_000);

  test('second run: reuses stored tokens with NO browser prompt', async () => {
    let browserOpened = false;
    const config = loadMcpConfig(configPath);
    const reg = await mountAll(config, {
      authProviders: {
        linear: createOAuthProvider('linear', {
          storePath,
          openBrowser: () => {
            browserOpened = true;
          },
        }),
      },
      consent: { autoYes: true },
      approvalsFile,
    });
    try {
      expect(reg.mounted.map((m) => m.name)).toContain('linear');
      expect(Object.keys(reg.merged).length).toBeGreaterThan(0);
      expect(browserOpened).toBe(false); // tokens reused → no redirect
    } finally {
      await reg.close();
    }
  }, 120_000);
});
