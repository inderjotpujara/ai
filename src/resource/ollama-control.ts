import { ProviderError } from '../core/errors.ts';

const DEFAULT_BASE_URL = 'http://localhost:11434';

type TagsResponse = { models?: Array<{ name: string }> };

async function postJson(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ProviderError(`Ollama request to ${path} failed`, { cause });
  }
  if (!res.ok) {
    throw new ProviderError(`Ollama ${path} returned ${res.status}`);
  }
}

/** True if `model` appears in `GET /api/tags` (field is `name`, not `model`). */
export async function isModelInstalled(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/tags`);
  } catch (cause) {
    throw new ProviderError('Ollama /api/tags failed', { cause });
  }
  if (!res.ok) {
    throw new ProviderError(`Ollama /api/tags returned ${res.status}`);
  }
  const data = (await res.json()) as TagsResponse;
  return (data.models ?? []).some((m) => m.name === model);
}

/** Pull a model (blocking, non-streamed). Write field is `model`. */
export function pullModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  return postJson(baseUrl, '/api/pull', { model, stream: false });
}

/** Warm/preload a model into memory with an empty-prompt generate. */
export function warmModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  return postJson(baseUrl, '/api/generate', { model, stream: false });
}

/** Unload a model from memory immediately (keep_alive: 0). */
export function unloadModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  return postJson(baseUrl, '/api/generate', {
    model,
    keep_alive: 0,
    stream: false,
  });
}
