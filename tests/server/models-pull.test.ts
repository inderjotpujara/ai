import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import type { RunModelPullTurn } from '../../src/server/models/pull.ts';
import { handleModelPull } from '../../src/server/models/pull.ts';

let root: string;
async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'modelpull-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function pullReq(body: unknown): Request {
  return new Request('http://localhost/api/models/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('200 + {runId}, pre-creates dir, invokes the turn detached with the resolved ProviderKind', async () => {
  await withRoot(async (runsRoot) => {
    const seen: {
      runtime: RuntimeKind;
      provider: ProviderKind;
      modelRef: string;
    }[] = [];
    const turn: RunModelPullTurn = async ({ runtime, provider, modelRef }) => {
      seen.push({ runtime, provider, modelRef });
    };
    const res = await handleModelPull(
      pullReq({
        runtime: RuntimeKind.MlxServer,
        modelRef: 'mlx-community/Qwen3.5-30B',
      }),
      {
        runsRoot,
        runModelPull: turn,
        resolveProvider: () => ProviderKind.HfSnapshot,
      },
    );
    expect(res.status).toBe(200);
    const { runId } = (await res.json()) as { runId: string };
    expect(runId.startsWith('run-')).toBe(true);
    expect(existsSync(join(runsRoot, runId))).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([
      {
        runtime: RuntimeKind.MlxServer,
        provider: ProviderKind.HfSnapshot,
        modelRef: 'mlx-community/Qwen3.5-30B',
      },
    ]);
  });
});

test('unresolvable (runtime, modelRef) → 404, no dir created', async () => {
  await withRoot(async (runsRoot) => {
    const res = await handleModelPull(
      pullReq({ runtime: RuntimeKind.Ollama, modelRef: 'no-such-model' }),
      {
        runsRoot,
        runModelPull: async () => {},
        resolveProvider: () => undefined,
      },
    );
    expect(res.status).toBe(404);
  });
});

test('malformed body → 400', async () => {
  await withRoot(async (runsRoot) => {
    const res = await handleModelPull(pullReq({ wrong: 1 }), {
      runsRoot,
      runModelPull: async () => {},
      resolveProvider: () => ProviderKind.Ollama,
    });
    expect(res.status).toBe(400);
  });
});

test('a throwing turn persists error.json (no unhandled rejection)', async () => {
  await withRoot(async (runsRoot) => {
    const turn: RunModelPullTurn = async () => {
      throw new Error('disk full');
    };
    const res = await handleModelPull(
      pullReq({ runtime: RuntimeKind.Ollama, modelRef: 'qwen3.5:9b' }),
      {
        runsRoot,
        runModelPull: turn,
        resolveProvider: () => ProviderKind.Ollama,
      },
    );
    const { runId } = (await res.json()) as { runId: string };
    await new Promise((r) => setTimeout(r, 10));
    expect(existsSync(join(runsRoot, runId, 'error.json'))).toBe(true);
  });
});
