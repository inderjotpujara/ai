import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  manifestPath,
  readManifest,
  rebuildFromArtifacts,
  removeEntry,
  upsertEntry,
} from '../../src/verified-build/manifest.ts';
import type {
  GoldenSet,
  ManifestEntry,
} from '../../src/verified-build/types.ts';
import { GoldenKind, VerifiedLevel } from '../../src/verified-build/types.ts';

function entry(need: string): ManifestEntry {
  return {
    need,
    signature: { purpose: need, tools: [], modelTier: '', io: '', roles: [] },
    vector: [1, 0, 0],
    verifiedLevel: VerifiedLevel.Runs,
    goldenPath: 'goldens/x.json',
    createdAtMs: 1,
    lastUsedMs: 2,
    useCount: 3,
    lastEvalPass: true,
  };
}

describe('manifest sidecar', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vb-manifest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('manifestPath appends .generated.json', () => {
    expect(manifestPath('/some/dir')).toBe('/some/dir/.generated.json');
  });

  test('absent file reads as empty manifest', () => {
    expect(readManifest(dir)).toEqual({ version: 2, entries: {} });
  });

  test('upsert then read returns the entry', () => {
    upsertEntry(dir, 'summarizer', entry('summarize urls'));
    const manifest = readManifest(dir);
    expect(manifest.entries.summarizer?.need).toBe('summarize urls');
    expect(manifest.entries.summarizer?.useCount).toBe(3);
  });

  test('upsert same name twice overwrites', () => {
    upsertEntry(dir, 'summarizer', entry('first'));
    upsertEntry(dir, 'summarizer', entry('second'));
    const manifest = readManifest(dir);
    expect(Object.keys(manifest.entries)).toEqual(['summarizer']);
    expect(manifest.entries.summarizer?.need).toBe('second');
  });

  test('removeEntry drops the entry', () => {
    upsertEntry(dir, 'a', entry('keep'));
    upsertEntry(dir, 'b', entry('drop'));
    removeEntry(dir, 'b');
    const manifest = readManifest(dir);
    expect(Object.keys(manifest.entries)).toEqual(['a']);
  });

  test('malformed file reads as empty manifest without throwing', () => {
    writeFileSync(manifestPath(dir), 'not json at all {{{');
    expect(readManifest(dir)).toEqual({ version: 2, entries: {} });
  });

  test('json that is not a manifest object reads as empty manifest', () => {
    writeFileSync(manifestPath(dir), '"just a string"');
    expect(readManifest(dir)).toEqual({ version: 2, entries: {} });
  });

  test('readManifest tolerates a v1 entry with no verifiedWith (undefined, no throw)', () => {
    writeFileSync(
      manifestPath(dir),
      JSON.stringify({
        version: 1,
        entries: {
          a: {
            need: 'n',
            signature: {
              purpose: 'n',
              tools: [],
              modelTier: '',
              io: '',
              roles: [],
            },
            vector: [],
            verifiedLevel: 'behaves',
            goldenPath: `${dir}/a.golden.json`,
            createdAtMs: 1,
            lastUsedMs: 0,
            useCount: 0,
            lastEvalPass: true,
          },
        },
      }),
    );
    const m = readManifest(dir);
    expect(m.entries.a?.verifiedWith).toBeUndefined();
  });
});

function goldenSet(need: string): GoldenSet {
  return {
    need,
    cases: [
      { id: 'c0', input: 'in', assert: 'out', kind: GoldenKind.TaskSuccess },
    ],
  };
}

function writeArtifactWithGolden(dir: string, name: string, need: string) {
  writeFileSync(join(dir, `${name}.ts`), `export const ${name} = 1;\n`);
  writeFileSync(
    join(dir, `${name}.golden.json`),
    JSON.stringify(goldenSet(need)),
  );
}

describe('rebuildFromArtifacts', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vb-rebuild-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reconstructs entries from <name>.golden.json sidecars after manifest loss', () => {
    writeArtifactWithGolden(dir, 'summarizer', 'summarize urls');
    writeArtifactWithGolden(dir, 'triager', 'triage bug reports');
    // no .generated.json on disk — the "lost manifest" case

    const rebuilt = rebuildFromArtifacts(dir);

    expect(Object.keys(rebuilt.entries).sort()).toEqual([
      'summarizer',
      'triager',
    ]);
    const summarizer = rebuilt.entries.summarizer;
    expect(summarizer?.need).toBe('summarize urls');
    expect(summarizer?.signature.purpose).toBe('summarize urls');
    expect(summarizer?.goldenPath).toBe(join(dir, 'summarizer.golden.json'));
    // not recomputable offline → safe defaults
    expect(summarizer?.vector).toEqual([]);
    expect(summarizer?.verifiedLevel).toBe(VerifiedLevel.Unverified);
    expect(rebuilt.entries.triager?.need).toBe('triage bug reports');
    // rebuilt manifest is persisted so the next read recovers it too
    expect(readManifest(dir).entries.summarizer?.need).toBe('summarize urls');
  });

  test('preserves existing manifest entries instead of clobbering them', () => {
    writeArtifactWithGolden(dir, 'summarizer', 'summarize urls');
    writeArtifactWithGolden(dir, 'triager', 'triage bug reports');
    upsertEntry(dir, 'summarizer', entry('summarize urls (verified)'));

    const rebuilt = rebuildFromArtifacts(dir);

    // the intact entry keeps its real vector/level; only the missing one is rebuilt
    expect(rebuilt.entries.summarizer?.need).toBe('summarize urls (verified)');
    expect(rebuilt.entries.summarizer?.vector).toEqual([1, 0, 0]);
    expect(rebuilt.entries.triager?.verifiedLevel).toBe(
      VerifiedLevel.Unverified,
    );
  });

  test('skips orphan goldens (no artifact file) and malformed goldens', () => {
    writeFileSync(
      join(dir, 'orphan.golden.json'),
      JSON.stringify(goldenSet('x')),
    );
    writeFileSync(join(dir, 'broken.ts'), 'export const broken = 1;\n');
    writeFileSync(join(dir, 'broken.golden.json'), 'not json {{{');

    const rebuilt = rebuildFromArtifacts(dir);
    expect(rebuilt.entries).toEqual({});
  });

  test('missing dir yields the empty manifest without throwing', () => {
    expect(rebuildFromArtifacts(join(dir, 'nope')).entries).toEqual({});
  });

  test('rebuildFromArtifacts leaves verifiedWith undefined', () => {
    writeArtifactWithGolden(dir, 'summarizer', 'summarize urls');
    // no .generated.json on disk — the "lost manifest" case; no live resolve
    // happens offline, so the rebuilt entry cannot carry a model baseline.
    const rebuilt = rebuildFromArtifacts(dir);
    expect(rebuilt.entries.summarizer?.verifiedWith).toBeUndefined();
  });
});
