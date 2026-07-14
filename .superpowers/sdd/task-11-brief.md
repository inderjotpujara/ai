### Task 11: Server — `bun run web` entry point (config → mint token → boot → inject into HTML)

**Files:**
- Create: `src/server/main.ts`
- Modify: `package.json`
- Test: `tests/server/main.test.ts`

**Interfaces:**
- Consumes: `loadConfig` from `../config/schema.ts`; `buildFetch`, `type ServerDeps` from `./app.ts`; `mintSessionToken` from `./security/token.ts`.
- Produces: `renderIndexHtml(token: string): string`; `type StartOptions`; `startWebServer(opts?: StartOptions): { server: ReturnType<typeof Bun.serve>; token: string; port: number }`; a `web` script in `package.json`.

- [ ] **Step 1: Write the failing entry-point smoke test**

```ts
// tests/server/main.test.ts
import { expect, test } from 'bun:test';
import { renderIndexHtml, startWebServer } from '../../src/server/main.ts';

test('renderIndexHtml injects the session token into the served page', () => {
  const html = renderIndexHtml('tok-123');
  expect(html).toContain('tok-123');
  expect(html.toLowerCase()).toContain('<!doctype html>');
});

test('startWebServer boots on an ephemeral port, mints a token, and serves it', async () => {
  const { server, token, port } = startWebServer({ port: 0 });
  try {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(port).toBeGreaterThan(0);

    const index = await fetch(`http://localhost:${port}/`);
    expect(await index.text()).toContain(token);

    const health = await fetch(`http://localhost:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(health.status).toBe(200);

    const unauth = await fetch(`http://localhost:${port}/api/health`);
    expect(unauth.status).toBe(401);
  } finally {
    server.stop(true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/main.test.ts`
Expected: FAIL — cannot resolve `../../src/server/main.ts`.

- [ ] **Step 3: Write the entry point**

```ts
// src/server/main.ts
import { loadConfig } from '../config/schema.ts';
import { type ServerDeps, buildFetch } from './app.ts';
import { mintSessionToken } from './security/token.ts';

/**
 * Minimal served page for Phase 1 (no web/ build yet). The token is injected as
 * `window.__AGENT_TOKEN__` so the future frontend reads it from the served HTML
 * rather than a network round-trip. Phase 1b replaces this with the Vite build.
 */
export function renderIndexHtml(token: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>AI Local Agent</title>' +
    `<script>window.__AGENT_TOKEN__=${JSON.stringify(token)};</script>` +
    '</head><body><div id="root"></div></body></html>'
  );
}

export type StartOptions = {
  port?: number;
  allowedOrigins?: string[];
  recordIo?: boolean;
  staticDir?: string;
  token?: string;
};

/** Boot the local web BFF. Returns the server handle for tests/shutdown. */
export function startWebServer(opts: StartOptions = {}): {
  server: ReturnType<typeof Bun.serve>;
  token: string;
  port: number;
} {
  const cfg = loadConfig().values;
  const port = opts.port ?? (cfg.AGENT_WEB_PORT as number);
  const allowedOrigins =
    opts.allowedOrigins ??
    String(cfg.AGENT_WEB_ORIGIN_ALLOWLIST)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const recordIo = opts.recordIo ?? (cfg.AGENT_WEB_RECORD_IO as boolean);
  const token = opts.token ?? mintSessionToken();

  const policy = { port, allowedOrigins };
  const deps: ServerDeps = {
    token,
    policy,
    recordIo,
    staticDir: opts.staticDir,
    indexHtml: renderIndexHtml(token),
  };
  // idleTimeout: 0 is required so future SSE streams are not idle-closed.
  const server = Bun.serve({ port, fetch: buildFetch(deps), idleTimeout: 0 });
  policy.port = server.port; // reconcile when port === 0 (ephemeral)
  return { server, token, port: server.port };
}

if (import.meta.main) {
  const { server } = startWebServer();
  process.stderr.write(
    `web BFF on http://localhost:${server.port} ` +
      '(session token minted + injected into served HTML)\n',
  );
}
```

- [ ] **Step 4: Add the `web` script to `package.json`**

In `package.json` `scripts`, add (do NOT touch the existing `serve`):

```json
    "web": "bun run src/server/main.ts",
```

- [ ] **Step 5: Run smoke test + typecheck to verify pass**

Run: `bun test tests/server/main.test.ts && bun run typecheck`
Expected: PASS (2 tests) and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/main.ts package.json tests/server/main.test.ts
git commit -m "feat(server): add bun run web entry point with token minting + HTML injection"
```

---

