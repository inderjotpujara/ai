import { mlxServerRuntime } from '../../src/runtime/mlx-server.ts';

/** True iff the MLX server is reachable and, when `model` is given, the model
 *  is already loaded there. Mirrors `ollama-available.ts`'s `ollamaReady`. */
export async function mlxReady(model?: string): Promise<boolean> {
  try {
    if (!(await mlxServerRuntime.isAvailable())) return false;
    if (!model) return true;
    return await mlxServerRuntime.control.isInstalled(model);
  } catch {
    return false;
  }
}
