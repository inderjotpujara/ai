import { DiscoveryError } from './catalog-source.ts';

const HF = 'https://huggingface.co';

/** Anonymous HF GET (adds bearer auth if HF_TOKEN is set). Throws DiscoveryError on failure. */
export async function hfGet(path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  const token = process.env.HF_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${HF}${path}`, { headers, signal: AbortSignal.timeout(8000) });
  } catch (cause) {
    throw new DiscoveryError(`HF GET ${path} failed`, { cause });
  }
  if (!res.ok) throw new DiscoveryError(`HF GET ${path} returned ${res.status}`);
  return res.json();
}
