import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRunTelemetry } from '../../src/cli/with-run.ts';
import { withBuildArchiveSpan } from '../../src/telemetry/spans.ts';

describe('withRunTelemetry', () => {
  it('creates the run dir and spans opened in the body land in spans.jsonl', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withrun-'));
    const out = await withRunTelemetry(
      { runsRoot, runId: 'r1' },
      async (run) => {
        expect(run.id).toBe('r1');
        expect(existsSync(run.dir)).toBe(true);
        return withBuildArchiveSpan(async (rec) => {
          rec.done(3, 1);
          return 'ok';
        });
      },
    );
    expect(out).toBe('ok');
    const lines = (await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const span = lines.find((s) => s.name === 'build.archive');
    expect(span).toBeDefined();
    expect(span?.attributes?.['archive.candidates']).toBe(3);
    expect(span?.attributes?.['archive.pruned']).toBe(1);
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('flushes telemetry even when the body throws', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withrun-'));
    await expect(
      withRunTelemetry({ runsRoot, runId: 'r2' }, async () => {
        await withBuildArchiveSpan(async (rec) => {
          rec.done(0, 0);
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const raw = await readFile(join(runsRoot, 'r2', 'spans.jsonl'), 'utf8');
    expect(raw).toContain('build.archive');
    await rm(runsRoot, { recursive: true, force: true });
  });
});
