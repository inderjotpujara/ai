import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
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
  findLiveReferences,
  LiveReferenceError,
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

  test('mismatched-dimension vectors are skipped, not compared (no crash)', () => {
    const manifest = manifestWith({
      A: entry('summarize urls', [1, 0, 0], oldMs),
      B: entry('summarize web pages', [1, 0], oldMs), // other embed model
    });
    const usage: Record<string, UsageStat> = {
      B: { lastUsedMs: NOW_MS - DAY_MS, useCount: 5 },
    };
    expect(archiveDecision(manifest, usage, NOW_MS)).toEqual([]);
  });

  test('empty vector (e.g. rebuilt entry) is skipped, not compared', () => {
    const manifest = manifestWith({
      A: entry('summarize urls', [], oldMs), // rebuildFromArtifacts default
      B: entry('summarize web pages', [1, 0, 0], oldMs),
    });
    const usage: Record<string, UsageStat> = {
      B: { lastUsedMs: NOW_MS - DAY_MS, useCount: 5 },
    };
    expect(archiveDecision(manifest, usage, NOW_MS)).toEqual([]);
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

  test('refuses to archive an agent referenced by a crew in the same dir', () => {
    writeFileSync(join(dir, 'summarizer.ts'), 'export const s = 1;\n');
    writeFileSync(
      join(dir, 'research-crew.ts'),
      'members: [\n    {\n      name: "lead",\n      agentRef: "summarizer",\n    },\n  ],\n',
    );
    upsertEntry(dir, 'summarizer', entry('summarize', [1, 0, 0], 1));

    expect(() => archiveArtifact(dir, 'summarizer')).toThrow(
      LiveReferenceError,
    );
    expect(() => archiveArtifact(dir, 'summarizer')).toThrow(
      'still referenced',
    );
    // nothing moved, manifest untouched
    expect(existsSync(join(dir, 'summarizer.ts'))).toBe(true);
    expect(readManifest(dir).entries.summarizer).toBeDefined();
  });

  test('refuses when a workflow step in a sibling registry dir references the agent', () => {
    const agentsDir = join(dir, 'agents');
    const workflowsDir = join(dir, 'workflows');
    mkdirSync(agentsDir);
    mkdirSync(workflowsDir);
    writeFileSync(join(agentsDir, 'summarizer.ts'), 'export const s = 1;\n');
    writeFileSync(
      join(workflowsDir, 'digest.ts'),
      'steps: [\n  {\n    id: "s1",\n    agent: "summarizer",\n  },\n],\n',
    );
    upsertEntry(agentsDir, 'summarizer', entry('summarize', [1, 0, 0], 1));

    expect(() =>
      archiveArtifact(agentsDir, 'summarizer', [agentsDir, workflowsDir]),
    ).toThrow(LiveReferenceError);
    // without the cross-registry refDirs the same-dir default cannot see it
    archiveArtifact(agentsDir, 'summarizer');
    expect(existsSync(join(agentsDir, 'archive', 'summarizer.ts'))).toBe(true);
  });

  test('the candidate file itself and archived files do not count as references', () => {
    writeFileSync(
      join(dir, 'self-crew.ts'),
      'members: [{ name: "a", agentRef: "self-crew" }]\n', // self-reference
    );
    mkdirSync(join(dir, 'archive'));
    writeFileSync(
      join(dir, 'archive', 'old-crew.ts'),
      'members: [{ name: "a", agentRef: "self-crew" }]\n',
    );
    upsertEntry(dir, 'self-crew', entry('crew things', [1, 0, 0], 1));
    archiveArtifact(dir, 'self-crew');
    expect(existsSync(join(dir, 'archive', 'self-crew.ts'))).toBe(true);
  });

  test('a same-named artifact in another dir still counts as a referencer', () => {
    const agentsDir = join(dir, 'agents');
    const crewsDir = join(dir, 'crews');
    mkdirSync(agentsDir);
    mkdirSync(crewsDir);
    writeFileSync(join(agentsDir, 'digest.ts'), 'export const d = 1;\n');
    writeFileSync(
      join(crewsDir, 'digest.ts'),
      'members: [{ name: "a", agentRef: "digest" }]\n',
    );
    expect(findLiveReferences('digest', [agentsDir, crewsDir])).toEqual([
      join(crewsDir, 'digest.ts'),
    ]);
  });
});
