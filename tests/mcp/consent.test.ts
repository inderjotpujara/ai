import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ApprovalRecord,
  checkDrift,
  dangerFlags,
  describeEntry,
  ensureConsent,
  pinTools,
  readApprovals,
  specHash,
  toolsHash,
  writeApprovals,
} from '../../src/mcp/consent.ts';
import { type McpServerEntry, McpTransportKind } from '../../src/mcp/types.ts';

const stdio: McpServerEntry = {
  kind: McpTransportKind.Stdio,
  name: 'ft',
  command: 'bun',
  args: ['run', 's.ts'],
  env: {},
  raw: { command: 'bun', args: ['run', 's.ts'] },
};
const http: McpServerEntry = {
  kind: McpTransportKind.Http,
  name: 'gh',
  url: 'https://x.test/mcp',
  headers: { Authorization: 'Bearer SECRET' },
  raw: {
    type: 'http',
    url: 'https://x.test/mcp',
    headers: { Authorization: `Bearer \${T}` },
  },
};

describe('specHash', () => {
  it('is stable and ignores header VALUES', () => {
    const other = { ...http, headers: { Authorization: 'Bearer DIFFERENT' } };
    expect(specHash(http)).toBe(specHash(other));
  });
  it('changes when the command changes', () => {
    expect(specHash(stdio)).not.toBe(
      specHash({ ...stdio, command: 'sh', raw: { command: 'sh' } }),
    );
  });
});

describe('toolsHash', () => {
  it('changes when a description changes (rug-pull signal)', () => {
    const a = toolsHash({
      t: { description: 'safe', inputSchema: undefined },
    } as never);
    const b = toolsHash({
      t: { description: 'EVIL', inputSchema: undefined },
    } as never);
    expect(a).not.toBe(b);
  });
});

describe('toolsHash hardening', () => {
  it('is not collidable via delimiter injection (rug-pull regression)', () => {
    const a = toolsHash({
      search: { description: 'find|things', inputSchema: undefined },
    } as never);
    const b = toolsHash({
      'search|find': { description: 'things', inputSchema: undefined },
    } as never);
    expect(a).not.toBe(b);
  });
  it('is independent of tool listing order', () => {
    const one = {
      alpha: { description: 'a', inputSchema: undefined },
      beta: { description: 'b', inputSchema: undefined },
    };
    const two = {
      beta: { description: 'b', inputSchema: undefined },
      alpha: { description: 'a', inputSchema: undefined },
    };
    expect(toolsHash(one as never)).toBe(toolsHash(two as never));
  });
});

describe('approval store', () => {
  it('round-trips atomically and degrades on missing file', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'mcp-appr-')),
      '.mcp-approvals.json',
    );
    expect(readApprovals(path)).toEqual({});
    const store: Record<string, ApprovalRecord> = {
      ft: { specHash: 'h', approvedAt: '2026-07-02T00:00:00Z' },
    };
    writeApprovals(store, path);
    expect(readApprovals(path)).toEqual(store);
  });
  it('degrades a corrupt store file to {} (re-consent, never crash)', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'mcp-appr-')),
      '.mcp-approvals.json',
    );
    writeFileSync(path, '{corrupt');
    expect(readApprovals(path)).toEqual({});
  });
});

describe('ensureConsent', () => {
  const deps = (over: Partial<Parameters<typeof ensureConsent>[1]>) => ({
    store: {},
    ask: async () => true,
    isTTY: true,
    autoYes: false,
    warn: () => {},
    ...over,
  });
  it('prompts and records approval on first mount', async () => {
    const d = deps({});
    expect(await ensureConsent(stdio, d)).toBe(true);
    expect(d.store.ft?.specHash).toBe(specHash(stdio));
  });
  it('skips silently-approved on matching hash without re-prompting', async () => {
    let asked = 0;
    const d = deps({
      store: { ft: { specHash: specHash(stdio), approvedAt: 'x' } },
      ask: async () => {
        asked++;
        return true;
      },
    });
    expect(await ensureConsent(stdio, d)).toBe(true);
    expect(asked).toBe(0);
  });
  it('re-prompts when the spec hash changed', async () => {
    let asked = 0;
    const d = deps({
      store: { ft: { specHash: 'stale', approvedAt: 'x' } },
      ask: async () => {
        asked++;
        return true;
      },
    });
    await ensureConsent(stdio, d);
    expect(asked).toBe(1);
  });
  it('remembers a decline and does not re-prompt on same spec', async () => {
    const d = deps({ ask: async () => false });
    expect(await ensureConsent(stdio, d)).toBe(false);
    expect(d.store.ft?.declined).toBe(true);
    let asked = 0;
    const d2 = deps({
      store: d.store,
      ask: async () => {
        asked++;
        return true;
      },
    });
    expect(await ensureConsent(stdio, d2)).toBe(false);
    expect(asked).toBe(0);
  });
  it('non-TTY without autoYes skips (returns false) and never asks', async () => {
    let asked = 0;
    const d = deps({
      isTTY: false,
      ask: async () => {
        asked++;
        return true;
      },
    });
    expect(await ensureConsent(stdio, d)).toBe(false);
    expect(asked).toBe(0);
    expect(d.store.ft).toBeUndefined(); // a skip is not a decline
  });
  it('autoYes approves without prompting (headless opt-in)', async () => {
    const d = deps({ isTTY: false, autoYes: true, ask: async () => false });
    expect(await ensureConsent(stdio, d)).toBe(true);
  });
});

describe('drift pinning', () => {
  it('pinTools records, checkDrift detects a change', () => {
    const store: Record<string, ApprovalRecord> = {
      ft: { specHash: 'h', approvedAt: 'x' },
    };
    pinTools(store, 'ft', 'toolsA');
    expect(checkDrift(store, 'ft', 'toolsA')).toBe(false);
    expect(checkDrift(store, 'ft', 'toolsB')).toBe(true);
  });
});

describe('display + danger', () => {
  it('describeEntry shows raw command and never header values', () => {
    expect(describeEntry(stdio)).toContain('bun run s.ts');
    const d = describeEntry(http);
    expect(d).toContain('https://x.test/mcp');
    expect(d).not.toContain('SECRET');
  });
  it('flags dangerous patterns', () => {
    const risky: McpServerEntry = {
      kind: McpTransportKind.Stdio,
      name: 'r',
      command: 'sudo',
      args: ['rm', '-rf', '/'],
      env: {},
      raw: { command: 'sudo', args: ['rm', '-rf', '/'] },
    };
    expect(dangerFlags(risky).length).toBeGreaterThan(0);
  });
});
