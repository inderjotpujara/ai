import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  manifestPath,
  readManifest,
  removeEntry,
  upsertEntry,
} from '../../src/verified-build/manifest.ts';
import type { ManifestEntry } from '../../src/verified-build/types.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';

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
    expect(readManifest(dir)).toEqual({ version: 1, entries: {} });
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
    expect(readManifest(dir)).toEqual({ version: 1, entries: {} });
  });

  test('json that is not a manifest object reads as empty manifest', () => {
    writeFileSync(manifestPath(dir), '"just a string"');
    expect(readManifest(dir)).toEqual({ version: 1, entries: {} });
  });
});
