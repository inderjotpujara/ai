import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOneShotJob } from '../../src/media/generate/adapter.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { ExecMode, JobStatus, MediaKind } from '../../src/media/types.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

test('one-shot job writes output, resolves a file handle, completes', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('--output') + 1] ?? '';
    writeFileSync(outPath, new Uint8Array([1, 2]));
    return { pid: 7, kill() {}, onExit: (cb) => cb(0) };
  };
  const strategy = {
    kind: MediaKind.Image,
    execMode: ExecMode.OneShot,
    buildOneShot: (_p: string, out: string) => ({
      cmd: 'mflux',
      args: ['--output', out],
    }),
  };
  const job = runOneShotJob(
    strategy,
    'a fox',
    store,
    'image/png',
    {},
    { spawn },
  );
  const fh = await job.result();
  expect(job.status()).toBe(JobStatus.Completed);
  expect(fh.sizeBytes).toBe(2);
});

test('non-zero exit -> Failed and result rejects', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  const spawn: SpawnFn = () => ({ pid: 7, kill() {}, onExit: (cb) => cb(1) });
  const strategy = {
    kind: MediaKind.Image,
    execMode: ExecMode.OneShot,
    buildOneShot: (_p: string, out: string) => ({
      cmd: 'mflux',
      args: ['--output', out],
    }),
  };
  const job = runOneShotJob(strategy, 'x', store, 'image/png', {}, { spawn });
  await expect(job.result()).rejects.toThrow('generation failed');
  expect(job.status()).toBe(JobStatus.Failed);
});

test('progress iterable terminates when job reaches a terminal status', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('--output') + 1] ?? '';
    writeFileSync(outPath, new Uint8Array([9]));
    return { pid: 1, kill() {}, onExit: (cb) => cb(0) };
  };
  const strategy = {
    kind: MediaKind.Image,
    execMode: ExecMode.OneShot,
    buildOneShot: (_p: string, out: string) => ({
      cmd: 'mflux',
      args: ['--output', out],
    }),
  };
  const job = runOneShotJob(strategy, 'x', store, 'image/png', {}, { spawn });
  await job.result();
  const collected = [];
  for await (const event of job.progress) {
    collected.push(event);
  }
  expect(collected).toEqual([]);
});

test('cancel kills the child, sets Cancelled, and rejects result', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
  let killed: NodeJS.Signals | undefined;
  const spawn: SpawnFn = () => ({
    pid: 3,
    kill: (sig) => {
      killed = sig;
    },
    onExit: () => {
      // never exits on its own — only cancel() settles the job
    },
  });
  const strategy = {
    kind: MediaKind.Image,
    execMode: ExecMode.OneShot,
    buildOneShot: (_p: string, out: string) => ({
      cmd: 'mflux',
      args: ['--output', out],
    }),
  };
  const job = runOneShotJob(strategy, 'x', store, 'image/png', {}, { spawn });
  await job.cancel();
  expect(killed).toBe('SIGTERM');
  expect(job.status()).toBe(JobStatus.Cancelled);
  await expect(job.result()).rejects.toThrow('job cancelled');
});
