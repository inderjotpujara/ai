import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenStrategy } from '../../src/media/generate/adapter.ts';
import { runGenJob } from '../../src/media/generate/adapter.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { ExecMode, MediaKind } from '../../src/media/types.ts';

describe('runGenJob cross-engine degrade drops the model repo', () => {
  test('fallback strategy is invoked without opts.model', async () => {
    let fallbackModel: string | undefined = 'UNSET';
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
    const primary: GenStrategy = {
      kind: MediaKind.Video,
      execMode: ExecMode.OneShot,
      buildOneShot: () => ({ cmd: 'definitely-not-installed-xyz', args: [] }),
    };
    const fallback: GenStrategy = {
      kind: MediaKind.Video,
      execMode: ExecMode.Server,
      serverSubmit: async (_p, opts) => {
        fallbackModel = opts.model;
        return {
          poll: async () => ({ fraction: 1, message: 'done' }),
          result: async () => '/tmp/never.mp4', // putFile will fail; we only assert the model
        };
      },
    };
    const job = runGenJob(
      primary,
      'a cat',
      store,
      'video/mp4',
      { model: 'mlx/repo' },
      {
        fallback,
        which: () => null, // force the "primary binary missing" degrade
      },
    );
    await job.result().catch(() => {}); // result may reject on the fake path; irrelevant
    expect(fallbackModel).toBeUndefined();
  });
});
