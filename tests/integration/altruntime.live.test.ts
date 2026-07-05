import { describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { RuntimeKind } from '../../src/core/types.ts';
import { createManagedRuntime } from '../../src/runtime/managed-openai-compatible.ts';
import { llamaCppStrategy } from '../../src/runtime/strategies/llamacpp.ts';
import { lmStudioStrategy } from '../../src/runtime/strategies/lmstudio.ts';
import { mlxStrategy } from '../../src/runtime/strategies/mlx.ts';

// Gated: real llama.cpp + LM Studio (daemon on :1234) + mlx_lm.server (on PATH)
// must be installed/running. Run with:
//   ALTRUNTIME_LIVE=1 bun test tests/integration/altruntime.live.test.ts
// Model refs default to what Task 17's live pass provisioned; override via env.
const LIVE = process.env.ALTRUNTIME_LIVE === '1';

const LLAMACPP_GGUF =
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
  role: 'live-verify',
  footprint: { approxParamsBillions: 0.5, bytesPerWeight: 0.5 },
});

describe.skipIf(!LIVE)('altruntime managed-runtime live-verify', () => {
  test('llama.cpp: managed runtime spawns llama-server at the computed context and generates', async () => {
    // Pin the port so we can independently assert the launched context via /props.
    const port = 8951;
    const rt = createManagedRuntime(llamaCppStrategy, {
      portAlloc: async () => port,
    });
    await rt.control.warm(LLAMACPP_GGUF, 8192);

    // The managed base spawned `llama-server -m <gguf> -c 8192 --port 8951`.
    // Assert the load-time context was actually applied.
    const props = (await fetch(`http://127.0.0.1:${port}/props`).then((r) =>
      r.json(),
    )) as { default_generation_settings?: { n_ctx?: number }; n_ctx?: number };
    const nCtx = props.default_generation_settings?.n_ctx ?? props.n_ctx;
    expect(nCtx).toBe(8192);

    const { text } = await generateText({
      model: rt.createModel(decl(LLAMACPP_GGUF, RuntimeKind.LlamaCpp)),
      prompt: 'Reply with a single short sentence about the ocean.',
    });
    expect(text.trim().length).toBeGreaterThan(0);

    await rt.control.unload(LLAMACPP_GGUF);
  }, 120_000);

  test('LM Studio: managed runtime loads via the daemon and generates', async () => {
    // Uses the running LM Studio daemon on :1234 (no spawn).
    const rt = createManagedRuntime(lmStudioStrategy);
    await rt.control.warm(LMSTUDIO_MODEL, 4096);

    const { text } = await generateText({
      model: rt.createModel(decl(LMSTUDIO_MODEL, RuntimeKind.LmStudio)),
      prompt: 'Reply with a single short sentence about the mountains.',
    });
    expect(text.trim().length).toBeGreaterThan(0);
  }, 120_000);

  test('MLX: managed runtime spawns mlx_lm.server (fixed context) and generates', async () => {
    // Requires mlx_lm.server on PATH (e.g. PATH=/tmp/mlxvenv/bin:$PATH).
    const port = 8952;
    const rt = createManagedRuntime(mlxStrategy, {
      portAlloc: async () => port,
    });
    await rt.control.warm(MLX_MODEL, 8192); // fixed capability: numCtx is advisory only

    const { text } = await generateText({
      model: rt.createModel(decl(MLX_MODEL, RuntimeKind.MlxServer)),
      prompt: 'Reply with a single short sentence about the sea.',
    });
    expect(text.trim().length).toBeGreaterThan(0);

    await rt.control.unload(MLX_MODEL);
  }, 180_000);
});
