import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import { atomicWrite } from '../../src/agent-builder/write.ts';
import {
  generateGolden,
  goldenPathFor,
  loadGolden,
} from '../../src/verified-build/golden.ts';
import type {
  CapabilitySignature,
  GoldenSet,
} from '../../src/verified-build/types.ts';
import { GoldenKind } from '../../src/verified-build/types.ts';

const sig: CapabilitySignature = {
  purpose: 'summarize urls',
  tools: ['fetch'],
  modelTier: 'fast',
  io: 'text',
  roles: [],
};

type RawCase = { input: string; assert: string; kind: GoldenKind };

function fakeModel(cases: RawCase[]): BuilderModel {
  return {
    object: async <T>() => ({ cases }) as T,
    text: async () => '',
  };
}

function rawCase(n: number): RawCase {
  return {
    input: `input ${n}`,
    assert: `assert ${n}`,
    kind: GoldenKind.TaskSuccess,
  };
}

describe('generateGolden', () => {
  test('maps model cases to GoldenCases with sequential ids', async () => {
    const set = await generateGolden(
      'summarize urls',
      sig,
      fakeModel([rawCase(0), rawCase(1), rawCase(2)]),
    );
    expect(set.need).toBe('summarize urls');
    expect(set.cases.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    expect(set.cases[0]?.input).toBe('input 0');
    expect(set.cases[0]?.kind).toBe(GoldenKind.TaskSuccess);
  });

  test('trims more than 7 cases down to 7', async () => {
    const many = Array.from({ length: 9 }, (_, i) => rawCase(i));
    const set = await generateGolden('n', sig, fakeModel(many));
    expect(set.cases).toHaveLength(7);
    expect(set.cases[6]?.id).toBe('c6');
  });

  test('keeps fewer than 3 cases as-is without throwing', async () => {
    const set = await generateGolden('n', sig, fakeModel([rawCase(0)]));
    expect(set.cases).toHaveLength(1);
  });
});

describe('golden store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vb-golden-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('goldenPathFor joins dir, name and .golden.json', () => {
    expect(goldenPathFor('/g', 'summarizer')).toBe('/g/summarizer.golden.json');
  });

  test('loadGolden round-trips a written file', () => {
    const path = goldenPathFor(dir, 'summarizer');
    const set: GoldenSet = {
      need: 'summarize urls',
      cases: [{ id: 'c0', ...rawCase(0) }],
    };
    atomicWrite(path, JSON.stringify(set));
    expect(loadGolden(path)).toEqual(set);
  });

  test('loadGolden returns null for an absent file', () => {
    expect(loadGolden(goldenPathFor(dir, 'missing'))).toBeNull();
  });

  test('loadGolden returns null for a malformed file', () => {
    const path = goldenPathFor(dir, 'broken');
    atomicWrite(path, 'not json {{{');
    expect(loadGolden(path)).toBeNull();
  });
});
