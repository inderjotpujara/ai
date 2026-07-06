import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenStrategy } from '../../src/media/generate/adapter.ts';
import { runGenJob, runServerJob } from '../../src/media/generate/adapter.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { ExecMode, JobStatus, MediaKind } from '../../src/media/types.ts';
import { createLedger, DegradeKind } from '../../src/reliability/ledger.ts';

test('server job polls until terminal, fetches the result path, resolves a file handle', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  const outDir = mkdtempSync(join(tmpdir(), 'gen-out-'));
  const outPath = join(outDir, 'clip.mp4');
  writeFileSync(outPath, new Uint8Array([1, 2, 3, 4]));

  let polls = 0;
  const strategy: GenStrategy = {
    kind: MediaKind.Video,
    execMode: ExecMode.Server,
    async serverSubmit() {
      return {
        async poll() {
          polls += 1;
          if (polls < 2) return { fraction: 0.5, message: 'running' };
          return { fraction: 1, message: 'done' };
        },
        async result() {
          return outPath;
        },
      };
    },
  };

  const job = runServerJob(
    strategy,
    'a fox running',
    store,
    'video/mp4',
    {},
    {
      pollIntervalMs: 0,
    },
  );
  const fh = await job.result();
  expect(job.status()).toBe(JobStatus.Completed);
  expect(fh.sizeBytes).toBe(4);
  expect(polls).toBe(2);
});

test('server job cancel rejects result and stops polling', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  let pollCount = 0;
  const strategy: GenStrategy = {
    kind: MediaKind.Video,
    execMode: ExecMode.Server,
    async serverSubmit() {
      return {
        async poll() {
          pollCount += 1;
          return { fraction: 0.1, message: 'running' };
        },
        async result() {
          throw new Error('should never be called after cancel');
        },
      };
    },
  };

  const job = runServerJob(
    strategy,
    'x',
    store,
    'video/mp4',
    {},
    {
      pollIntervalMs: 0,
    },
  );
  // Let the poll loop start before cancelling.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await job.cancel();
  expect(job.status()).toBe(JobStatus.Cancelled);
  await expect(job.result()).rejects.toThrow('job cancelled');
  expect(pollCount).toBeGreaterThan(0);
});

test('a poll loop that never completes fails the job within the injected timeout', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  let pollCount = 0;
  const strategy: GenStrategy = {
    kind: MediaKind.Video,
    execMode: ExecMode.Server,
    async serverSubmit() {
      return {
        async poll() {
          pollCount += 1;
          return { fraction: 0.5, message: 'still running' };
        },
        async result() {
          throw new Error('should never be called — poll never completes');
        },
      };
    },
  };

  const job = runServerJob(
    strategy,
    'x',
    store,
    'video/mp4',
    {},
    { pollIntervalMs: 0, timeoutMs: 20 },
  );
  await expect(job.result()).rejects.toThrow('timed out');
  expect(job.status()).toBe(JobStatus.Failed);
  expect(pollCount).toBeGreaterThan(0);
});

test('runGenJob degrades from a missing one-shot binary to the server fallback lane', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  const outDir = mkdtempSync(join(tmpdir(), 'gen-out-'));
  const outPath = join(outDir, 'clip.mp4');
  writeFileSync(outPath, new Uint8Array([9, 9, 9]));

  let serverSubmitCalled = false;
  const primary: GenStrategy = {
    kind: MediaKind.Video,
    execMode: ExecMode.OneShot,
    buildOneShot: (_p: string, out: string) => ({
      cmd: 'mlx_video.ltx_2.generate',
      args: ['--output-path', out],
    }),
  };
  const fallback: GenStrategy = {
    kind: MediaKind.Video,
    execMode: ExecMode.Server,
    async serverSubmit() {
      serverSubmitCalled = true;
      return {
        async poll() {
          return { fraction: 1, message: 'done' };
        },
        async result() {
          return outPath;
        },
      };
    },
  };

  const ledger = createLedger();
  const job = runGenJob(
    primary,
    'a fox running',
    store,
    'video/mp4',
    {},
    {
      fallback,
      which: () => null,
      ledger,
      pollIntervalMs: 0,
    },
  );
  const fh = await job.result();

  expect(serverSubmitCalled).toBe(true);
  expect(fh.sizeBytes).toBe(3);
  expect(ledger.events).toHaveLength(1);
  expect(ledger.events[0]?.kind).toBe(DegradeKind.ModelDegraded);
  expect(ledger.events[0]?.from).toBe(ExecMode.OneShot);
  expect(ledger.events[0]?.to).toBe(ExecMode.Server);
});

test('runGenJob runs the one-shot primary as-is when its binary is present', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  let spawnCalled = false;
  const primary: GenStrategy = {
    kind: MediaKind.Image,
    execMode: ExecMode.OneShot,
    buildOneShot: (_p: string, out: string) => ({
      cmd: 'mflux-generate',
      args: ['--output', out],
    }),
  };
  const job = runGenJob(
    primary,
    'a fox',
    store,
    'image/png',
    {},
    {
      which: () => '/usr/local/bin/mflux-generate',
      spawn: (_cmd, args) => {
        spawnCalled = true;
        const outPath = args[args.indexOf('--output') + 1] ?? '';
        writeFileSync(outPath, new Uint8Array([5]));
        return { pid: 1, kill() {}, onExit: (cb) => cb(0) };
      },
    },
  );
  const fh = await job.result();
  expect(spawnCalled).toBe(true);
  expect(fh.sizeBytes).toBe(1);
});

test('runGenJob runs a server primary as-is when no fallback probe is configured', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  const outDir = mkdtempSync(join(tmpdir(), 'gen-out-'));
  const outPath = join(outDir, 'clip.mp4');
  writeFileSync(outPath, new Uint8Array([1]));

  const primary: GenStrategy = {
    kind: MediaKind.Video,
    execMode: ExecMode.Server,
    async serverSubmit() {
      return {
        async poll() {
          return { fraction: 1, message: 'done' };
        },
        async result() {
          return outPath;
        },
      };
    },
  };
  const job = runGenJob(
    primary,
    'x',
    store,
    'video/mp4',
    {},
    {
      pollIntervalMs: 0,
    },
  );
  const fh = await job.result();
  expect(fh.sizeBytes).toBe(1);
});
