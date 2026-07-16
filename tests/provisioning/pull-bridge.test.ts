import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRunTelemetry } from '../../src/cli/with-run.ts';
import { RunLifecycle } from '../../src/contracts/enums.ts';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { runModelPullBridge } from '../../src/provisioning/pull-bridge.ts';
import type { DownloadProvider } from '../../src/provisioning/types.ts';
import {
  DownloadPhase,
  type DownloadProgress,
} from '../../src/provisioning/types.ts';
import { mapRunToDto } from '../../src/run/run-dto.ts';

function fakeProvider(ticks: number, fail: boolean): DownloadProvider {
  return {
    kind: ProviderKind.Ollama,
    async download(modelRef, opts) {
      for (let i = 0; i < ticks; i++) {
        const p: DownloadProgress = {
          modelRef,
          phase: DownloadPhase.Downloading,
          bytesCompleted: (i + 1) * 1000,
          bytesTotal: ticks * 1000,
          percent: ((i + 1) / ticks) * 100,
          speedBytesPerSec: 500,
        };
        opts.onProgress(p);
      }
      if (fail) throw new Error('disk full');
    },
  };
}

test('N onProgress ticks land as N+2 spans; lifecycle flips to Done only once the root closes', async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), 'pull-bridge-'));
  const runId = 'run-pull-ok';
  try {
    const N = 3;
    await withRunTelemetry({ runsRoot, runId }, () =>
      runModelPullBridge(
        {
          runtime: RuntimeKind.Ollama,
          provider: ProviderKind.Ollama,
          modelRef: 'qwen3.5:9b',
          signal: new AbortController().signal,
        },
        { providerFor: () => fakeProvider(N, false), destDir: '/tmp/unused' },
      ),
    );
    const dto = await mapRunToDto(runsRoot, runId);
    expect(dto).toBeDefined();
    const tickCount =
      dto?.spans.filter((s) => s.name === 'model.pull.progress').length ?? 0;
    expect(tickCount).toBe(N + 1); // synthetic-started + N real ticks
    expect(dto?.spanCount).toBe(N + 2); // + the model.pull root itself
    expect(dto?.lifecycle).toBe(RunLifecycle.Done);
  } finally {
    await rm(runsRoot, { recursive: true, force: true });
  }
});

test('a rejecting provider marks the root Failed, scoped under withRunTelemetry (mapRunToDto agrees)', async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), 'pull-bridge-fail-scoped-'));
  const runId = 'run-pull-fail-scoped';
  try {
    await withRunTelemetry({ runsRoot, runId }, () =>
      runModelPullBridge(
        {
          runtime: RuntimeKind.Ollama,
          provider: ProviderKind.Ollama,
          modelRef: 'x',
          signal: new AbortController().signal,
        },
        { providerFor: () => fakeProvider(2, true), destDir: '/tmp/unused' },
      ),
    ).catch(() => {});
    const dto = await mapRunToDto(runsRoot, runId);
    expect(dto?.lifecycle).toBe(RunLifecycle.Failed);
  } finally {
    await rm(runsRoot, { recursive: true, force: true });
  }
});
