import type { RuntimeKind } from '../core/types.ts';
import { mlxServerRuntime } from './mlx-server.ts';
import { ollamaRuntime } from './ollama.ts';
import type { Runtime } from './runtime.ts';

export const RUNTIMES: Runtime[] = [ollamaRuntime, mlxServerRuntime];

export function runtimeFor(kind: RuntimeKind): Runtime {
  const rt = RUNTIMES.find((r) => r.kind === kind);
  if (!rt) throw new Error(`No runtime registered for provider ${kind}`);
  return rt;
}

export async function availableRuntimes(): Promise<Runtime[]> {
  const flags = await Promise.all(RUNTIMES.map((r) => r.isAvailable()));
  return RUNTIMES.filter((_, i) => flags[i]);
}
