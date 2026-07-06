import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { runOneShotJob } from '../../src/media/generate/adapter.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { ExecMode, JobStatus, MediaKind } from '../../src/media/types.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';
import { ATTR, withGenerateSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

test('withGenerateSpan runs the body and returns its value', async () => {
  const out = await withGenerateSpan(
    { kind: MediaKind.Image, engine: 'mflux', execMode: ExecMode.OneShot },
    async (rec) => {
      rec.done('completed', 12, 34);
      return 'ok';
    },
  );
  expect(out).toBe('ok');
});

test('exposes MEDIA_GENERATE_* ATTR keys', () => {
  expect(ATTR.MEDIA_GENERATE_KIND).toBe('media.generate.kind');
  expect(ATTR.MEDIA_GENERATE_ENGINE).toBe('media.generate.engine');
  expect(ATTR.MEDIA_GENERATE_MODEL).toBe('media.generate.model');
  expect(ATTR.MEDIA_GENERATE_EXEC_MODE).toBe('media.generate.exec_mode');
  expect(ATTR.MEDIA_GENERATE_DURATION_MS).toBe('media.generate.duration_ms');
  expect(ATTR.MEDIA_GENERATE_SIZE_BYTES).toBe('media.generate.size_bytes');
  expect(ATTR.MEDIA_GENERATE_OUTCOME).toBe('media.generate.outcome');
});

describe('media.generate span emission from runOneShotJob', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    ({ exporter, provider } = registerTestProvider());
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  test('a completed one-shot job records outcome=completed with kind/engine/size', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tel-')));
    const spawn: SpawnFn = (_cmd, args) => {
      const outPath = args[args.indexOf('--output') + 1] ?? '';
      writeFileSync(outPath, new Uint8Array([1, 2, 3]));
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
      { model: 'schnell' },
      { spawn },
    );
    const fh = await job.result();
    expect(job.status()).toBe(JobStatus.Completed);

    // Flush the microtask queue so the span-recording promise (which awaits
    // the same `resultPromise` job.result() just resolved) has a chance to
    // call rec.done() and end the span before we inspect the exporter.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'media.generate');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.MEDIA_GENERATE_KIND]).toBe(MediaKind.Image);
    expect(span?.attributes[ATTR.MEDIA_GENERATE_ENGINE]).toBe('mflux');
    expect(span?.attributes[ATTR.MEDIA_GENERATE_MODEL]).toBe('schnell');
    expect(span?.attributes[ATTR.MEDIA_GENERATE_EXEC_MODE]).toBe(
      ExecMode.OneShot,
    );
    expect(span?.attributes[ATTR.MEDIA_GENERATE_OUTCOME]).toBe('completed');
    expect(span?.attributes[ATTR.MEDIA_GENERATE_SIZE_BYTES]).toBe(fh.sizeBytes);
    expect(typeof span?.attributes[ATTR.MEDIA_GENERATE_DURATION_MS]).toBe(
      'number',
    );
  });

  test('a failed one-shot job records outcome=failed', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tel-')));
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'media.generate');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.MEDIA_GENERATE_OUTCOME]).toBe('failed');
  });

  test('a cancelled one-shot job records outcome=cancelled', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tel-')));
    const spawn: SpawnFn = () => ({
      pid: 3,
      kill: () => {},
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
    await expect(job.result()).rejects.toThrow('job cancelled');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'media.generate');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.MEDIA_GENERATE_OUTCOME]).toBe('cancelled');
  });
});
