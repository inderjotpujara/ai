import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandVars, loadMcpConfig } from '../../src/mcp/config.ts';
import { McpTransportKind } from '../../src/mcp/types.ts';

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-config-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, typeof json === 'string' ? json : JSON.stringify(json));
  return path;
}

describe('expandVars', () => {
  it(`expands ${'$'}{VAR} from env`, () => {
    expect(expandVars(`Bearer ${'$'}{TOK}`, { TOK: 'abc' })).toEqual({
      value: 'Bearer abc',
      missing: [],
    });
  });
  it(`uses ${'$'}{VAR:-default} when unset`, () => {
    expect(expandVars(`${'$'}{HOST:-localhost}`, {})).toEqual({
      value: 'localhost',
      missing: [],
    });
  });
  it('reports missing vars without a default', () => {
    expect(expandVars(`${'$'}{NOPE}`, {}).missing).toEqual(['NOPE']);
  });
});

describe('loadMcpConfig', () => {
  it('parses stdio and http entries with agents', () => {
    const path = writeConfig({
      mcpServers: {
        ft: { command: 'bun', args: ['run', 's.ts'], agents: ['file_qa'] },
        gh: {
          type: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: `Bearer ${'$'}{T}` },
        },
      },
    });
    const cfg = loadMcpConfig(path, { T: 'tok' });
    expect(cfg.entries).toHaveLength(2);
    const [ft, gh] = cfg.entries;
    expect(ft?.kind).toBe(McpTransportKind.Stdio);
    expect(ft?.agents).toEqual(['file_qa']);
    if (gh?.kind === McpTransportKind.Http)
      expect(gh.headers.Authorization).toBe('Bearer tok');
  });
  it('marks entries with unset env vars dormant, not failed', () => {
    const path = writeConfig({
      mcpServers: {
        gh: {
          type: 'http',
          url: 'https://x.test',
          headers: { A: `${'$'}{MISSING_KEY}` },
        },
      },
    });
    const cfg = loadMcpConfig(path, {});
    expect(cfg.entries).toHaveLength(0);
    expect(cfg.dormant).toEqual([{ name: 'gh', missingVars: ['MISSING_KEY'] }]);
  });
  it('skips a malformed entry with a warning but keeps valid ones', () => {
    const path = writeConfig({
      mcpServers: { bad: { args: ['no-command'] }, ok: { command: 'bun' } },
    });
    const cfg = loadMcpConfig(path, {});
    expect(cfg.entries.map((e) => e.name)).toEqual(['ok']);
    expect(cfg.warnings.some((w) => w.includes('bad'))).toBe(true);
  });
  it('tolerates a VS-Code-style "servers" root with a notice', () => {
    const path = writeConfig({ servers: { ok: { command: 'bun' } } });
    const cfg = loadMcpConfig(path, {});
    expect(cfg.entries).toHaveLength(1);
    expect(cfg.warnings.some((w) => w.includes('servers'))).toBe(true);
  });
  it('degrades on missing file and corrupt JSON (warn, empty, never throw)', () => {
    expect(loadMcpConfig('/nope/mcp.json', {}).entries).toEqual([]);
    const corrupt = writeConfig('{not json');
    expect(loadMcpConfig(corrupt, {}).warnings.length).toBeGreaterThan(0);
  });
  it('keeps raw unexpanded while expanding the live fields (consent-hash security property)', () => {
    const path = writeConfig({
      mcpServers: {
        s: { command: 'bun', args: [`${'$'}{TOKEN}`] },
        h: {
          type: 'http',
          url: 'https://x.test',
          headers: { A: `Bearer ${'$'}{TOKEN}` },
        },
      },
    });
    const cfg = loadMcpConfig(path, { TOKEN: 'secret-value' });
    const [s, h] = cfg.entries;
    if (s?.kind !== McpTransportKind.Stdio) throw new Error('expected stdio');
    expect(s.args).toEqual(['secret-value']);
    expect(JSON.stringify(s.raw)).toContain(`${'$'}{TOKEN}`);
    expect(JSON.stringify(s.raw)).not.toContain('secret-value');
    if (h?.kind !== McpTransportKind.Http) throw new Error('expected http');
    expect(h.headers.A).toBe('Bearer secret-value');
    expect(JSON.stringify(h.raw)).not.toContain('secret-value');
  });
  it('malformed-entry warning names the actual problem, not "Invalid input"', () => {
    const path = writeConfig({ mcpServers: { bad: { args: ['x'] } } });
    const w =
      loadMcpConfig(path, {}).warnings.find((x) => x.includes('bad')) ?? '';
    expect(w).toContain('command');
    expect(w).not.toBe(
      'mcp.json entry "bad" is invalid and was skipped: Invalid input',
    );
  });
});
