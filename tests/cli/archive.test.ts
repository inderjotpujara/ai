import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReport, reportCandidates } from '../../src/cli/archive.ts';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import { upsertEntry } from '../../src/verified-build/manifest.ts';
import type { ManifestEntry } from '../../src/verified-build/types.ts';
import { VerifiedLevel } from '../../src/verified-build/types.ts';

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

function span(attributes: Record<string, unknown>, endMs: number): SpanRecord {
  return {
    name: 'crew.run',
    kind: 0,
    traceId: 'trace-1',
    spanId: 'span-1',
    parentSpanId: null,
    startUnixNano: (endMs - 5) * 1e6,
    endUnixNano: endMs * 1e6,
    durationMs: 5,
    status: { code: 0 },
    attributes,
    events: [],
  };
}

describe('archive CLI report', () => {
  let root: string;
  let registryDir: string;
  let runsRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cli-archive-'));
    registryDir = join(root, 'crews');
    runsRoot = join(root, 'runs');
    mkdirSync(registryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('lists the idle near-duplicate candidate with its reason', () => {
    const oldMs = NOW_MS - 40 * DAY_MS;
    // A is idle; B is its near-duplicate (same vector) and in use via a run span.
    upsertEntry(registryDir, 'A', entry('summarize urls', [1, 0, 0], oldMs));
    upsertEntry(
      registryDir,
      'B',
      entry('summarize web pages', [1, 0, 0], oldMs),
    );
    const runDir = join(runsRoot, 'run-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'spans.jsonl'),
      `${JSON.stringify(span({ 'crew.id': 'B' }, NOW_MS - DAY_MS))}\n`,
    );

    const reports = reportCandidates([registryDir], runsRoot, NOW_MS);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.candidates).toHaveLength(1);
    expect(reports[0]?.candidates[0]?.name).toBe('A');
    expect(reports[0]?.candidates[0]?.reason).toBe(
      'idle 40 days, near-duplicate of B is in use',
    );

    const rendered = renderReport(reports);
    expect(rendered).toContain('A — idle 40 days');
  });

  test('dir with no candidates renders "no archive candidates"', () => {
    const reports = reportCandidates([registryDir], runsRoot, NOW_MS);
    expect(reports[0]?.candidates).toEqual([]);
    expect(renderReport(reports)).toBe(`${registryDir}: no archive candidates`);
  });

  test('missing runs root still reports (idle without used duplicate = none)', () => {
    const oldMs = NOW_MS - 40 * DAY_MS;
    upsertEntry(registryDir, 'A', entry('summarize urls', [1, 0, 0], oldMs));
    upsertEntry(
      registryDir,
      'B',
      entry('summarize web pages', [1, 0, 0], oldMs),
    );
    // No runs at all: B is never used, so A must be preserved.
    const reports = reportCandidates(
      [registryDir],
      join(root, 'no-runs'),
      NOW_MS,
    );
    expect(reports[0]?.candidates).toEqual([]);
  });
});
