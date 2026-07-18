import { type ZodType, z } from 'zod';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The BFF injects window.__AGENT_TOKEN__ into the served HTML (empty in Vite dev). */
export function sessionToken(): string {
  const w = globalThis as { window?: { __AGENT_TOKEN__?: string } };
  return w.window?.__AGENT_TOKEN__ ?? '';
}

/** Web-only runtime config the BFF injects alongside the session token
 *  (Slice 30b Phase 6 — `server/main.ts`'s `renderIndexHtml`). Falls back to
 *  the same defaults `config/schema.ts` documents when unset (e.g. the
 *  Phase-1 stub page, or a component test with no injected globals). */
export function notifyConfig(): { pollMs: number; minDurationMs: number } {
  const w = globalThis as {
    window?: {
      __AGENT_NOTIFY_POLL_MS__?: number;
      __AGENT_NOTIFY_MIN_DURATION_MS__?: number;
    };
  };
  return {
    pollMs: w.window?.__AGENT_NOTIFY_POLL_MS__ ?? 5_000,
    minDurationMs: w.window?.__AGENT_NOTIFY_MIN_DURATION_MS__ ?? 60_000,
  };
}

type FetchOpts<T> = {
  schema: ZodType<T>;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiFetch<T>(
  path: string,
  opts: FetchOpts<T>,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${sessionToken()}`,
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (!res.ok) throw new ApiError(`request to ${path} failed`, res.status);
  return opts.schema.parse(await res.json());
}

/** Health is not part of `src/contracts` (it's a bare liveness probe, not a domain DTO). */
export function getHealth(): Promise<{ ok: boolean }> {
  return apiFetch('/health', { schema: z.object({ ok: z.boolean() }) });
}
