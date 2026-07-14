### Task 5: Contract client + transport port interface

**Files:**
- Create: `web/src/shared/contract/client.ts`, `web/src/shared/transport/types.ts`
- Test: `web/src/shared/contract/client.test.ts`, `web/src/shared/transport/types.test.ts`

**Interfaces:**
- Consumes: `@contracts` (the isomorphic Zod schemas + types from `src/contracts/index.ts`), `window.__AGENT_TOKEN__`.
- Produces:
  - `sessionToken(): string` — reads `window.__AGENT_TOKEN__`, `''` if absent (dev).
  - `apiFetch<T>(path: string, opts: { schema: ZodType<T>; method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>` — prefixes `/api`, sets `Authorization: Bearer <token>`, JSON-encodes body, throws `ApiError` on non-2xx, zod-parses the response.
  - `getHealth(): Promise<{ ok: boolean }>`.
  - `class ApiError extends Error { status: number }`.
  - Transport port types: `ChatTransport`, `RunStream`, `TransportEvent` (all `type`, no `ai` import) shaped for bidirectional + resumable per D14.

- [ ] **Step 1: Write the failing tests**

`web/src/shared/contract/client.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiFetch, ApiError, sessionToken } from './client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noExplicitAny: test cleanup of injected global
  delete (globalThis as any).window;
});

function stubToken(token: string) {
  vi.stubGlobal('window', { __AGENT_TOKEN__: token });
}

describe('contract client', () => {
  it('reads the session token from window, empty string when absent', () => {
    vi.stubGlobal('window', {});
    expect(sessionToken()).toBe('');
    stubToken('abc123');
    expect(sessionToken()).toBe('abc123');
  });

  it('sends the bearer token and zod-parses the response', async () => {
    stubToken('secret');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/health', { schema: z.object({ ok: z.boolean() }) });
    expect(result).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/health');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('throws ApiError with the status on non-2xx', async () => {
    stubToken('secret');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 401 })),
    );
    await expect(
      apiFetch('/health', { schema: z.object({ ok: z.boolean() }) }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 401 } satisfies Partial<ApiError>);
  });
});
```

`web/src/shared/transport/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ChatTransport, RunStream } from './types.ts';
import { StatusEventType } from '@contracts';

describe('transport port', () => {
  it('a stub adapter satisfies the ChatTransport contract (compile + shape)', () => {
    const stub: ChatTransport = {
      async *stream() {
        yield { type: StatusEventType.RunStart, eventId: '1', data: { runId: 'r1' } };
      },
      async respond() {
        /* back-channel — Phase 2 */
      },
    };
    expect(typeof stub.stream).toBe('function');
    expect(typeof stub.respond).toBe('function');
  });

  it('RunStream carries a resume cursor', () => {
    const rs: RunStream = { runId: 'r1', cursor: null };
    expect(rs.cursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test src/shared/contract/ src/shared/transport/`
Expected: FAIL — cannot resolve `./client.ts` / `./types.ts`.

- [ ] **Step 3: Write the client + transport types**

`web/src/shared/transport/types.ts`:
```ts
import type { RespondRequest, StatusEvent } from '@contracts';

/** A transport event = a wire StatusEvent tagged with an SSE event id for resume. */
export type TransportEvent = StatusEvent & { eventId: string };

/**
 * Bidirectional + resumable transport (spec D14). Adapter is SSE now
 * (Last-Event-ID reconnect); the interface leaves room for WS/resumable later.
 */
export type ChatTransport = {
  /** server→client stream; `fromCursor` replays after a Last-Event-ID reconnect. */
  stream(runId?: string, fromCursor?: string | null): AsyncIterable<TransportEvent>;
  /** client→server back-channel: POST /api/runs/:id/respond (consent / human-in-loop). */
  respond(runId: string, payload: RespondRequest): Promise<void>;
};

/** A live run handle carrying the resume cursor (last seen event id). */
export type RunStream = {
  runId: string;
  cursor: string | null;
};
```

`web/src/shared/contract/client.ts`:
```ts
import type { ZodType } from 'zod';

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

type FetchOpts<T> = {
  schema: ZodType<T>;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiFetch<T>(path: string, opts: FetchOpts<T>): Promise<T> {
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
```

Add `getHealth` (imports a schema from `@contracts` when Phase 1 exposes one; until then a local literal schema is fine — health is not in `src/contracts`):
```ts
import { z } from 'zod';
export function getHealth(): Promise<{ ok: boolean }> {
  return apiFetch('/health', { schema: z.object({ ok: z.boolean() }) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test src/shared/contract/ src/shared/transport/`
Expected: PASS (5 tests). Confirms the `@contracts` alias resolves cross-boundary. Then `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/contract/ web/src/shared/transport/
git commit -m "feat(web): token'd contract client + bidirectional transport port interface"
```

---

