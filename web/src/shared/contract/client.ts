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

const PAIRED_TOKEN_KEY = 'agent.pairedToken';

/** A phone that opens the pairing URL (`…/#token=<t>`) adopts that token once,
 *  into localStorage, then strips the fragment (so it never lingers in history).
 *  The token rode the URL FRAGMENT, never a query — fragments do not reach the
 *  server or its access logs. Call once at app boot, before the first apiFetch.
 *  Slice 25b Incr 7 (T36). */
export function adoptPairingTokenFromHash(): void {
  try {
    const m = window.location.hash.match(/^#token=(.+)$/);
    if (!m?.[1]) return;
    localStorage.setItem(PAIRED_TOKEN_KEY, m[1]);
    history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
  } catch {
    // no window/localStorage (SSR/tests without a DOM) — nothing to adopt
  }
}

/** The BFF injects window.__AGENT_TOKEN__ into the served HTML (empty in Vite
 *  dev). Prefers a paired-device token adopted via `adoptPairingTokenFromHash`
 *  (a phone that opened the pairing URL authenticates as the paired device). */
export function sessionToken(): string {
  try {
    const paired = localStorage.getItem(PAIRED_TOKEN_KEY);
    if (paired) return paired;
  } catch {
    // fall through to the injected server token
  }
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
