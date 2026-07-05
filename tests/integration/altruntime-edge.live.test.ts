import { describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { RuntimeKind } from '../../src/core/types.ts';
import { createManagedRuntime } from '../../src/runtime/managed-openai-compatible.ts';
import { llamaCppStrategy } from '../../src/runtime/strategies/llamacpp.ts';
import { lmStudioStrategy } from '../../src/runtime/strategies/lmstudio.ts';
import { mlxStrategy } from '../../src/runtime/strategies/mlx.ts';

// EDGE-CASE live-verify (the final gate before merge). Real llama.cpp +
// LM Studio daemon (:1234) + mlx_lm.server (on PATH) required. Run with:
//   ALTRUNTIME_LIVE=1 bun test tests/integration/altruntime-edge.live.test.ts
const LIVE = process.env.ALTRUNTIME_LIVE === '1';
const GGUF =
  process.env.ALTRUNTIME_LLAMACPP_GGUF ??
  `${process.env.HOME}/.lmstudio/models/bartowski/Qwen2.5-0.5B-Instruct-GGUF/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf`;
const LMSTUDIO_MODEL =
  process.env.ALTRUNTIME_LMSTUDIO_MODEL ?? 'qwen2.5-0.5b-instruct';
const MLX_MODEL =
  process.env.ALTRUNTIME_MLX_MODEL ??
  'mlx-community/Qwen2.5-0.5B-Instruct-4bit';

const decl = (model: string, runtime: RuntimeKind) => ({
  runtime,
  model,
  params: {},
  role: 'edge-verify',
  footprint: { approxParamsBillions: 0.5, bytesPerWeight: 0.5 },
});

async function nCtxOf(port: number): Promise<number | undefined> {
  const p = (await fetch(`http://127.0.0.1:${port}/props`).then((r) =>
    r.json(),
  )) as { default_generation_settings?: { n_ctx?: number }; n_ctx?: number };
  return p.default_generation_settings?.n_ctx ?? p.n_ctx;
}

/** Poll until a port stops answering (server torn down), or throw after `ms`. */
async function waitPortDead(
  port: number,
  path: string,
  ms = 15_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}${path}`, {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      return; // connection refused → dead
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`port ${port} still alive after ${ms}ms (leaked process?)`);
}

describe.skipIf(!LIVE)('altruntime edge-case live-verify', () => {
  test('EDGE: concurrent warm is single-flight (no port collision, no orphan)', async () => {
    // Pinned constant port: WITHOUT single-flight, two concurrent same-model
    // warms would each spawn `llama-server --port 8961` and the second collides
    // (EADDRINUSE) → warm throws. WITH single-flight, the second reuses → both
    // resolve cleanly on one server.
    const port = 8961;
    const rt = createManagedRuntime(llamaCppStrategy, {
      portAlloc: async () => port,
    });
    await Promise.all([
      rt.control.warm(GGUF, 8192),
      rt.control.warm(GGUF, 8192),
    ]);
    expect(await nCtxOf(port)).toBe(8192); // exactly one server, at the requested ctx
    const { text } = await generateText({
      model: rt.createModel(decl(GGUF, RuntimeKind.LlamaCpp)),
      prompt: 'One short sentence about rivers.',
    });
    expect(text.trim().length).toBeGreaterThan(0);
    await rt.control.unload(GGUF);
    await waitPortDead(port, '/health'); // EDGE: cleanup, no orphan
  }, 180_000);

  test('EDGE: relaunch at a NEW context kills the old server and applies the new -c', async () => {
    const ports = [8971, 8972];
    let i = 0;
    const rt = createManagedRuntime(llamaCppStrategy, {
      portAlloc: async () => ports[i++] ?? 8979,
    });
    await rt.control.warm(GGUF, 4096);
    expect(await nCtxOf(8971)).toBe(4096);
    await rt.control.warm(GGUF, 8192); // relaunch on a fresh port with new -c
    expect(await nCtxOf(8972)).toBe(8192);
    await waitPortDead(8971, '/health'); // old server torn down (no double-serve)
    await rt.control.unload(GGUF);
    await waitPortDead(8972, '/health');
  }, 180_000);

  test('EDGE: MLX (spawned, fresh port) + LM Studio (daemon :1234) coexist despite the same default port', async () => {
    const mlxPort = 8981;
    const mlxRt = createManagedRuntime(mlxStrategy, {
      portAlloc: async () => mlxPort,
    });
    const lmRt = createManagedRuntime(lmStudioStrategy); // LM Studio daemon owns :1234
    // MLX's default base URL is also :1234 — the managed base must spawn it on a
    // fresh port so it never collides with the running LM Studio daemon.
    await Promise.all([
      mlxRt.control.warm(MLX_MODEL, 8192), // fixed-capability: 8192 is advisory only
      lmRt.control.warm(LMSTUDIO_MODEL, 4096),
    ]);
    expect(mlxPort).not.toBe(1234);
    const [mlxOut, lmOut] = await Promise.all([
      generateText({
        model: mlxRt.createModel(decl(MLX_MODEL, RuntimeKind.MlxServer)),
        prompt: 'One short sentence about the sea.',
      }),
      generateText({
        model: lmRt.createModel(decl(LMSTUDIO_MODEL, RuntimeKind.LmStudio)),
        prompt: 'One short sentence about the sky.',
      }),
    ]);
    expect(mlxOut.text.trim().length).toBeGreaterThan(0); // MLX fixed-context still generates
    expect(lmOut.text.trim().length).toBeGreaterThan(0);
    await mlxRt.control.unload(MLX_MODEL);
    await waitPortDead(mlxPort, '/v1/models'); // MLX cleanup; LM Studio daemon left running
  }, 240_000);
});
