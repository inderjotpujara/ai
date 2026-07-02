import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MountedServer } from '../../src/mcp/client.ts';
import { readApprovals } from '../../src/mcp/consent.ts';
import { mountAll, warnUnknownAgents } from '../../src/mcp/mount.ts';
import { type McpConfig, McpTransportKind } from '../../src/mcp/types.ts';

const entry = (name: string, agents?: string[]) => ({
  kind: McpTransportKind.Stdio as const,
  name,
  command: 'fake',
  args: [],
  env: {},
  agents,
  raw: { command: 'fake' },
});

const fakeServer = (toolNames: string[]): MountedServer => ({
  tools: Object.fromEntries(
    toolNames.map((n) => [n, { description: n, execute: async () => n }]),
  ) as unknown as MountedServer['tools'],
  close: async () => {},
});

const approvalsIn = (dir: string) => join(dir, '.mcp-approvals.json');

function deps(over: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-mount-'));
  return {
    approvalsFile: approvalsIn(dir),
    consent: { autoYes: true, isTTY: false },
    warn: () => {},
    ...over,
  };
}

describe('mountAll', () => {
  it('mounts entries, merges tools, scopes forAgent by the agents field', async () => {
    const config: McpConfig = {
      entries: [entry('a', ['file_qa']), entry('b')],
      dormant: [],
      warnings: [],
    };
    const reg = await mountAll(
      config,
      deps({
        mount: async (spec: { command?: string; args?: string[] }) =>
          fakeServer(spec.args?.length === 0 ? ['t_shared'] : ['x']),
      }),
    );
    // both entries have args: [] so both serve t_shared → collision: later wins, warn
    expect(Object.keys(reg.merged)).toEqual(['t_shared']);
    expect(reg.mounted).toHaveLength(2);
    await reg.close();
  });
  it('scopes agent slices: scoped entry only for its agents, unscoped for all', async () => {
    let calls = 0;
    const config: McpConfig = {
      entries: [entry('scoped', ['file_qa']), entry('open')],
      dormant: [],
      warnings: [],
    };
    const reg = await mountAll(
      config,
      deps({
        mount: async () => fakeServer([`tool_${++calls}`]),
      }),
    );
    expect(Object.keys(reg.forAgent('file_qa')).sort()).toEqual([
      'tool_1',
      'tool_2',
    ]);
    expect(Object.keys(reg.forAgent('web_fetch'))).toEqual(['tool_2']);
    expect(Object.keys(reg.merged).sort()).toEqual(['tool_1', 'tool_2']);
    await reg.close();
  });
  it('mount failure degrades: boom skipped with reason, ok mounted', async () => {
    const config: McpConfig = {
      entries: [
        { ...entry('boom'), command: 'boom' },
        { ...entry('ok'), command: 'ok' },
      ],
      dormant: [],
      warnings: [],
    };
    const reg = await mountAll(
      config,
      deps({
        mount: async (spec: { command?: string }) => {
          if (spec.command === 'boom') throw new Error('spawn failed');
          return fakeServer(['t_ok']);
        },
      }),
    );
    expect(reg.mounted.map((m) => m.name)).toEqual(['ok']);
    expect(reg.skipped).toEqual([{ name: 'boom', reason: 'spawn failed' }]);
    await reg.close();
  });
  it('declined consent skips the entry without mounting', async () => {
    const config: McpConfig = {
      entries: [entry('a')],
      dormant: [],
      warnings: [],
    };
    let mountCalls = 0;
    const reg = await mountAll(
      config,
      deps({
        consent: { autoYes: false, isTTY: true, ask: async () => false },
        mount: async () => {
          mountCalls++;
          return fakeServer(['t']);
        },
      }),
    );
    expect(mountCalls).toBe(0);
    expect(reg.skipped[0]?.reason).toContain('consent');
    await reg.close();
  });
  it('pins tool definitions on first mount and persists the store', async () => {
    const d = deps({ mount: async () => fakeServer(['t']) });
    const config: McpConfig = {
      entries: [entry('a')],
      dormant: [],
      warnings: [],
    };
    const reg = await mountAll(config, d);
    await reg.close();
    const store = readApprovals(d.approvalsFile as string);
    expect(store.a?.toolsHash).toBeDefined();
  });
  it('drift (changed tool defs) with non-interactive consent skips the server', async () => {
    const d = deps({ mount: async () => fakeServer(['t_v1']) });
    const config: McpConfig = {
      entries: [entry('a')],
      dormant: [],
      warnings: [],
    };
    (await mountAll(config, d)).close();
    // remount with DIFFERENT tools under same approvals file, no TTY, no autoYes
    const reg2 = await mountAll(config, {
      ...d,
      consent: { autoYes: false, isTTY: false },
      mount: async () => fakeServer(['t_v2_changed']),
    });
    expect(reg2.mounted).toHaveLength(0);
    expect(reg2.skipped[0]?.reason).toContain('drift');
    await reg2.close();
  });
  it('skips consent-gated servers non-interactively without calling ask (no hang)', async () => {
    let asked = 0;
    const config: McpConfig = {
      entries: [entry('needs-consent')],
      dormant: [],
      warnings: [],
    };
    const reg = await mountAll(
      config,
      deps({
        consent: {
          isTTY: false,
          autoYes: false,
          ask: async () => {
            asked += 1;
            return true;
          },
        },
        mount: async () => fakeServer([]),
      }),
    );
    expect(asked).toBe(0);
    expect(reg.skipped.some((s) => s.name === 'needs-consent')).toBe(true);
  });
});

describe('warnUnknownAgents', () => {
  it('warns for agents lists naming unknown agents', () => {
    const warnings: string[] = [];
    warnUnknownAgents(
      {
        entries: [entry('a', ['file_qa', 'typo_agent'])],
        dormant: [],
        warnings: [],
      },
      ['file_qa', 'web_fetch'],
      (m) => warnings.push(m),
    );
    expect(warnings[0]).toContain('typo_agent');
  });
});
