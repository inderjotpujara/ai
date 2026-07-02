import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPackEntry } from '../../src/cli/mcp.ts';

const tmpConfig = () =>
  join(mkdtempSync(join(tmpdir(), 'mcp-add-')), 'mcp.json');

describe('addPackEntry', () => {
  it('creates mcp.json with the pack entry when absent', () => {
    const path = tmpConfig();
    const r = addPackEntry('git', path);
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.git.command).toBe('uvx');
  });
  it('appends into an existing mcp.json without disturbing other entries', () => {
    const path = tmpConfig();
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { keep: { command: 'bun' } } }),
    );
    addPackEntry('time', path);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.keep.command).toBe('bun');
    expect(parsed.mcpServers.time.command).toBe('uvx');
  });
  it('refuses to overwrite an existing entry of the same name', () => {
    const path = tmpConfig();
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { git: { command: 'custom' } } }),
    );
    const r = addPackEntry('git', path);
    expect(r.ok).toBe(false);
    expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers.git.command).toBe(
      'custom',
    );
  });
  it('reports unknown pack names', () => {
    expect(addPackEntry('nonsense', tmpConfig()).ok).toBe(false);
  });
});
