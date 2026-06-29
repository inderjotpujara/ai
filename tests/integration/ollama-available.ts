import { isModelInstalled } from '../../src/resource/ollama-control.ts';

/** True iff Ollama is reachable AND the given model is already installed. */
export async function ollamaReady(model: string): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/version', {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    return await isModelInstalled(model);
  } catch {
    return false;
  }
}
