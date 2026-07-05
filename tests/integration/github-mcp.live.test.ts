import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMcpConfig } from '../../src/mcp/config.ts';
import { type MountedRegistry, mountAll } from '../../src/mcp/mount.ts';

// Gated: a real GitHub PAT with Copilot MCP access is required. Run with:
// GITHUB_PAT=ghp_xxx bun test tests/integration/github-mcp.live.test.ts
const HAS_PAT = !!process.env.GITHUB_PAT;

describe.skipIf(!HAS_PAT)('github mcp live-verify', () => {
  let tmpDir: string | undefined;
  let registry: MountedRegistry | undefined;

  afterEach(async () => {
    await registry?.close().catch(() => {});
    registry = undefined;
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test('mounts the real github remote server and exposes tools', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'github-mcp-live-'));
    const configPath = join(tmpDir, 'mcp.json');
    const approvalsFile = join(tmpDir, '.mcp-approvals.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: expanded by loadMcpConfig
            headers: { Authorization: 'Bearer ${GITHUB_PAT}' },
          },
        },
      }),
    );

    const config = loadMcpConfig(configPath);
    expect(config.dormant).toHaveLength(0);
    expect(config.entries.map((e) => e.name)).toContain('github');

    registry = await mountAll(config, {
      consent: { autoYes: true },
      approvalsFile,
    });

    expect(registry.mounted.map((m) => m.name)).toContain('github');
    expect(registry.skipped).toHaveLength(0);
    expect(Object.keys(registry.merged).length).toBeGreaterThan(0);
  }, 120_000);
});
