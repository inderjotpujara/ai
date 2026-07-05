import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOneShotJob } from '../../src/media/generate/adapter.ts';
import type { MediaStore } from '../../src/media/store.ts';
import { createMediaStore } from '../../src/media/store.ts';
import type { MediaItem } from '../../src/media/types.ts';
import { ExecMode, JobStatus, MediaKind } from '../../src/media/types.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

/** A deferred promise whose resolution is controlled externally, used to pin
 *  a `putFile` call in its pending state until a test is ready to release it. */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

test('cancel during in-flight putFile does not resurrect status to Completed', async () => {
  const deferred = createDeferred<MediaItem>();
  const fakeStore: MediaStore = {
    put: () => Promise.reject(new Error('not implemented')),
    putFile: () => deferred.promise,
    get: () => undefined,
    resolveBytes: () => Promise.reject(new Error('not implemented')),
    toFileHandle: () => ({
      uri: 'file:///fake',
      mediaType: 'image/png',
      sizeBytes: 1,
    }),
    registerGroup: () => {
      throw new Error('not implemented');
    },
  };
  const spawn: SpawnFn = () => ({
    pid: 9,
    kill() {},
    onExit: (cb) => cb(0),
  });
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
    'x',
    fakeStore,
    'image/png',
    {},
    { spawn },
  );
  // `onExit(0)` already ran synchronously above, so the job is in the exit-0
  // branch awaiting the still-pending `putFile` — cancel it now, before the
  // deferred resolves.
  await job.cancel();
  // Attach the rejection assertion immediately (before the `setTimeout`
  // flush below) so bun doesn't flag the already-settled rejection as
  // unhandled while we wait a tick for the late `putFile` resolution.
  const resultAssertion = expect(job.result()).rejects.toThrow('job cancelled');
  deferred.resolve({
    handle: 'img_1',
    kind: MediaKind.Image,
    path: '/fake/img_1.png',
    mediaType: 'image/png',
  });
  // Flush the `putFile` .then/.catch/.finally microtask chain.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(job.status()).toBe(JobStatus.Cancelled);
  await resultAssertion;
});
