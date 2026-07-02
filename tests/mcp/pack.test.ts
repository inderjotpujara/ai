import { describe, expect, it } from 'bun:test';
import {
  getPackEntry,
  packByCapability,
  STARTER_PACK,
} from '../../src/mcp/pack.ts';

describe('starter pack', () => {
  it('has the 12 curated entries with unique names', () => {
    expect(STARTER_PACK).toHaveLength(12);
    expect(new Set(STARTER_PACK.map((e) => e.name)).size).toBe(12);
  });
  it('every entry has a description and ≥1 capability', () => {
    for (const e of STARTER_PACK) {
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.capabilities.length).toBeGreaterThan(0);
    }
  });
  it('is queryable by capability (the agent-builder palette)', () => {
    expect(packByCapability('web-search').map((e) => e.name)).toEqual([
      'brave-search',
      'exa-search',
    ]);
    expect(packByCapability('sql')[0]?.name).toBe('sqlite');
  });
  it('keyed entries declare requiresEnv and reference ${VAR} in the server value', () => {
    const gh = getPackEntry('github');
    expect(gh?.requiresEnv).toEqual(['GITHUB_PAT']);
    expect(JSON.stringify(gh?.server)).toContain('${GITHUB_PAT}');
  });
  it('never emits archived @modelcontextprotocol invocations (2025 prune)', () => {
    const all = JSON.stringify(STARTER_PACK);
    for (const dead of [
      'server-postgres',
      'server-sqlite',
      'server-brave-search',
      'server-puppeteer',
      'server-github',
    ]) {
      expect(all).not.toContain(dead);
    }
  });
});
