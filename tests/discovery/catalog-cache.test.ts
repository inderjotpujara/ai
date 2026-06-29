import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isStale, readCatalog, writeCatalog } from '../../src/discovery/catalog-cache.ts';
import { ProviderKind } from '../../src/core/types.ts';

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('write then read round-trips candidates', () => {
  dir = mkdtempSync(join(tmpdir(), 'cat-'));
  const p = join(dir, 'catalog.json');
  const cands = [{
    provider: ProviderKind.Ollama, model: 'hf.co/x:Q4_K_M', params: {}, role: 'r',
    footprint: { approxParamsBillions: 7, bytesPerWeight: 0.56 },
    repo: 'x', quant: 'Q4_K_M', fileSizeBytes: 5e9, downloads: 1, installed: false,
  }];
  writeCatalog(cands, p);
  expect(readCatalog(p)?.[0]?.model).toBe('hf.co/x:Q4_K_M');
});
test('missing file → undefined and stale', () => {
  dir = mkdtempSync(join(tmpdir(), 'cat-'));
  const p = join(dir, 'none.json');
  expect(readCatalog(p)).toBeUndefined();
  expect(isStale(1000, p)).toBe(true);
});
