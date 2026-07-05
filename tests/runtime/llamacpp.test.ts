import { describe, expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import {
  createLlamaCppStrategy,
  llamaCppStrategy,
} from '../../src/runtime/strategies/llamacpp.ts';

/** Narrows `strategy.launch` from optional to present; strategies that spawn
 * a process (llama.cpp) always define it, so a missing one is a test bug. */
function launch(model: string, numCtx: number | undefined, port: number) {
  if (!llamaCppStrategy.launch)
    throw new Error('llamaCppStrategy.launch is undefined');
  return llamaCppStrategy.launch(model, numCtx, port);
}

test('llama.cpp launch sets -c to the requested context', () => {
  const spec = launch('/models/q.gguf', 8192, 8080);
  expect(spec.args).toContain('-c');
  expect(spec.args[spec.args.indexOf('-c') + 1]).toBe('8192');
  expect(spec.args).toContain('--port');
});

test('llama.cpp uses -hf for a repo id, -m for a path', () => {
  expect(launch('TheBloke/x-GGUF:Q4', 4096, 8080).args).toContain('-hf');
  expect(launch('/abs/path.gguf', 4096, 8080).args).toContain('-m');
});

test('kind + capability + health path', () => {
  expect(llamaCppStrategy.kind).toBe(RuntimeKind.LlamaCpp);
  expect(llamaCppStrategy.contextCapability).toBe('relaunch');
  expect(llamaCppStrategy.healthPath).toBe('/health');
});

test('launch uses the passed port, not the default port, in the args', () => {
  const spec = launch('/m.gguf', 4096, 5555);
  expect(spec.port).toBe(5555);
  expect(spec.args[spec.args.indexOf('--port') + 1]).toBe('5555');
  expect(spec.args).not.toContain(String(llamaCppStrategy.defaultPort));
});

test('launch omits -c when numCtx is undefined', () => {
  const spec = launch('/m.gguf', undefined, 8080);
  expect(spec.args).not.toContain('-c');
});

describe('detect via injectable which', () => {
  test('true when llama-server is found on PATH', async () => {
    const strategy = createLlamaCppStrategy({
      which: (cmd) =>
        cmd === 'llama-server' ? '/usr/local/bin/llama-server' : null,
    });
    expect(await strategy.detect()).toBe(true);
  });

  test('false when llama-server is not found on PATH', async () => {
    const strategy = createLlamaCppStrategy({ which: () => null });
    expect(await strategy.detect()).toBe(false);
  });
});
