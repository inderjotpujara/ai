import { ProviderError } from '../core/errors.ts';
import type { KvArch } from './kv-cache.ts';

const DEFAULT_BASE_URL = 'http://localhost:11434';

type TagsResponse = { models?: Array<{ name: string }> };

/** A model currently resident in Ollama, with its memory footprint. */
export type LoadedModel = { name: string; sizeBytes: number };

type PsResponse = { models?: Array<{ name: string; size: number }> };

type ShowResponse = { model_info?: Record<string, unknown> };

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

/** Warm/preload a model into memory, optionally reserving a context window. */
export function warmModel(
  model: string,
  numCtx?: number,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  const body: Record<string, unknown> = { model, stream: false };
  if (numCtx !== undefined) body.options = { num_ctx: numCtx };
  return postJson(baseUrl, '/api/generate', body);
}

/**
 * The model's true maximum context window, read live from `POST /api/show`
 * (`model_info["<arch>.context_length"]`). Returns undefined if not reported.
 */
export async function getModelMaxContext(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<number | undefined> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
  } catch (cause) {
    throw new ProviderError('Ollama /api/show failed', { cause });
  }
  if (!res.ok) {
    throw new ProviderError(`Ollama /api/show returned ${res.status}`);
  }
  const data = (await res.json()) as ShowResponse;
  const info = data.model_info ?? {};
  const arch = info['general.architecture'];
  if (typeof arch !== 'string') return undefined;
  const ctx = info[`${arch}.context_length`];
  return typeof ctx === 'number' ? ctx : undefined;
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

/** Models currently loaded in memory, from `GET /api/ps`. */
export async function listLoadedModels(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<LoadedModel[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/ps`);
  } catch (cause) {
    throw new ProviderError('Ollama /api/ps failed', { cause });
  }
  if (!res.ok) throw new ProviderError(`Ollama /api/ps returned ${res.status}`);
  const data = (await res.json()) as PsResponse;
  return (data.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size }));
}

/** The model's KV attention dims, read live from POST /api/show. Undefined if unavailable. */
export async function getModelKvArch(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<KvArch | undefined> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  const data = (await res.json()) as { model_info?: Record<string, unknown> };
  const info = data.model_info ?? {};
  const arch = info['general.architecture'];
  if (typeof arch !== 'string') return undefined;
  const num = (key: string): number | undefined => {
    const v = info[`${arch}.${key}`];
    return typeof v === 'number' ? v : undefined;
  };
  const blockCount = num('block_count');
  const headCountKv = num('attention.head_count_kv');
  const keyLength = num('attention.key_length');
  const valueLength = num('attention.value_length');
  if (
    blockCount === undefined || headCountKv === undefined ||
    keyLength === undefined || valueLength === undefined
  ) {
    return undefined;
  }
  return { blockCount, headCountKv, keyLength, valueLength, expertCount: num('expert_count') ?? 0 };
}
