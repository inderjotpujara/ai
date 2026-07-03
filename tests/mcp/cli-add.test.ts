import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPackEntry } from '../../src/cli/mcp.ts';

const tmpConfig = () =>
  join(mkdtempSync(join(tmpdir(), 'mcp-add-')), 'mcp.json');

describe('addPackEntry', () => {
  it('creates mcp.json with the pack entry when absent', async () => {
    const path = tmpConfig();
    const r = await addPackEntry('git', path);
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.git.command).toBe('uvx');
  });
  it('appends into an existing mcp.json without disturbing other entries', async () => {
    const path = tmpConfig();
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { keep: { command: 'bun' } } }),
    );
    await addPackEntry('time', path);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.keep.command).toBe('bun');
    expect(parsed.mcpServers.time.command).toBe('uvx');
  });
  it('refuses to overwrite an existing entry of the same name', async () => {
    const path = tmpConfig();
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { git: { command: 'custom' } } }),
    );
    const r = await addPackEntry('git', path);
    expect(r.ok).toBe(false);
    expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers.git.command).toBe(
      'custom',
    );
  });
  it('reports unknown pack names', async () => {
    expect((await addPackEntry('nonsense', tmpConfig())).ok).toBe(false);
  });

  describe('concurrent calls (Slice-15 check-then-act race)', () => {
    it('does not lose an update when two different entries are added concurrently', async () => {
      const path = tmpConfig();
      // Fire both without awaiting the first — genuinely overlapping calls.
      const p1 = addPackEntry('git', path);
      const p2 = addPackEntry('time', path);
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      expect(parsed.mcpServers.git.command).toBe('uvx');
      expect(parsed.mcpServers.time.command).toBe('uvx');
    });
    it('stays idempotent/no-clobber when the same entry is added concurrently', async () => {
      const path = tmpConfig();
      const [r1, r2] = await Promise.all([
        addPackEntry('git', path),
        addPackEntry('git', path),
      ]);
      const results = [r1, r2];
      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(results.filter((r) => !r.ok).length).toBe(1);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      expect(parsed.mcpServers.git.command).toBe('uvx');
    });
  });
});
