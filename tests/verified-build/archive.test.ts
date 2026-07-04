import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveArtifact,
  archiveDecision,
} from '../../src/verified-build/archive.ts';
import {
  readManifest,
  upsertEntry,
} from '../../src/verified-build/manifest.ts';
import type {
  Manifest,
  ManifestEntry,
} from '../../src/verified-build/types.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';
import type { UsageStat } from '../../src/verified-build/usage.ts';

const DAY_MS = 86_400_000;
const NOW_MS = 100 * DAY_MS;

function entry(
  need: string,
  vector: number[],
  createdAtMs: number,
): ManifestEntry {
  return {
    need,
    signature: { purpose: need, tools: [], modelTier: '', io: '', roles: [] },
    vector,
    verifiedLevel: VerifiedLevel.Runs,
    goldenPath: 'goldens/x.json',
    createdAtMs,
    lastUsedMs: createdAtMs,
    useCount: 0,
    lastEvalPass: true,
  };
}

function manifestWith(entries: Record<string, ManifestEntry>): Manifest {
  return { version: 1, entries };
}

describe('archiveDecision', () => {
  const oldMs = NOW_MS - 40 * DAY_MS;

  test('idle entry with a used near-duplicate is a candidate', () => {
    const manifest = manifestWith({
      A: entry('summarize urls', [1, 0, 0], oldMs),
      B: entry('summarize web pages', [1, 0, 0], oldMs),
    });
    const usage: Record<string, UsageStat> = {
      B: { lastUsedMs: NOW_MS - DAY_MS, useCount: 5 },
    };
    const candidates = archiveDecision(manifest, usage, NOW_MS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe('A');
    expect(candidates[0]?.reason).toBe(
      'idle 40 days, near-duplicate of B is in use',
    );
  });

  test('recently used entry is not a candidate', () => {
    const manifest = manifestWith({
      A: entry('summarize urls', [1, 0, 0], oldMs),
      B: entry('summarize web pages', [1, 0, 0], oldMs),
    });
    const usage: Record<string, UsageStat> = {
      A: { lastUsedMs: NOW_MS - DAY_MS, useCount: 2 },
      B: { lastUsedMs: NOW_MS - DAY_MS, useCount: 5 },
    };
    expect(archiveDecision(manifest, usage, NOW_MS)).toEqual([]);
  });

  test('idle entry without a near-duplicate is preserved', () => {
    const manifest = manifestWith({
      A: entry('summarize urls', [1, 0, 0], oldMs),
      B: entry('triage bugs', [0, 1, 0], oldMs),
    });
    const usage: Record<string, UsageStat> = {
      B: { lastUsedMs: NOW_MS - DAY_MS, useCount: 5 },
    };
    expect(archiveDecision(manifest, usage, NOW_MS)).toEqual([]);
  });

  test('near-duplicate that is itself unused does not trigger archive', () => {
    const manifest = manifestWith({
      A: entry('summarize urls', [1, 0, 0], oldMs),
      B: entry('summarize web pages', [1, 0, 0], oldMs),
    });
    expect(archiveDecision(manifest, {}, NOW_MS)).toEqual([]);
  });
});

describe('archiveArtifact', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vb-archive-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('moves the file under archive/, drops manifest entry and index line', () => {
    writeFileSync(join(dir, 'foo.ts'), 'export const foo = 1;\n');
    writeFileSync(
      join(dir, 'index.ts'),
      "export { foo } from './foo.ts';\nexport { bar } from './bar.ts';\n",
    );
    upsertEntry(dir, 'foo', entry('foo things', [1, 0, 0], 1));
    upsertEntry(dir, 'bar', entry('bar things', [0, 1, 0], 1));

    archiveArtifact(dir, 'foo');

    expect(existsSync(join(dir, 'foo.ts'))).toBe(false);
    expect(readFileSync(join(dir, 'archive', 'foo.ts'), 'utf8')).toBe(
      'export const foo = 1;\n',
    );
    expect(Object.keys(readManifest(dir).entries)).toEqual(['bar']);
    const index = readFileSync(join(dir, 'index.ts'), 'utf8');
    expect(index).not.toContain('./foo.ts');
    expect(index).toContain('./bar.ts');
  });

  test('works without an index.ts', () => {
    writeFileSync(join(dir, 'foo.ts'), 'export const foo = 1;\n');
    upsertEntry(dir, 'foo', entry('foo things', [1, 0, 0], 1));
    archiveArtifact(dir, 'foo');
    expect(existsSync(join(dir, 'archive', 'foo.ts'))).toBe(true);
    expect(readManifest(dir).entries).toEqual({});
  });
});
