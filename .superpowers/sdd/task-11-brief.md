### Task 11: Browser loopback callback server

**Files:**
- Create: `src/mcp/loopback.ts`
- Test: `tests/mcp/loopback.test.ts`

**Interfaces:**
- Produces:
```typescript
export type LoopbackDeps = { openBrowser?: (url: string) => void; port?: number; timeoutMs?: number };
/** Start a one-shot localhost server, open `authUrl` in the browser, resolve with the
 *  captured {code,state} on the first /callback hit, then stop the server. */
export function awaitOAuthRedirect(authUrl: string, expectedState: string, deps?: LoopbackDeps):
  Promise<{ code: string; state: string; redirectUri: string }>;
export function loopbackRedirectUri(port: number): string; // http://127.0.0.1:<port>/callback
```
- Behavior: bind `127.0.0.1:0` (ephemeral) via `Bun.serve`; `redirectUri = http://127.0.0.1:{actualPort}/callback`; call `deps.openBrowser(authUrl)` (default: `Bun.spawn(['open', url])` on darwin); on GET `/callback?code&state`, verify `state === expectedState` (else 400 + reject `Error('state mismatch')`), respond 200 "You may close this window", resolve, stop. `withWallClock(timeoutMs ?? 180000, ...)` guards a no-show.

> NOTE: to make it testable without a browser, `deps.openBrowser` is injected; the test drives the callback by `fetch`-ing the redirect URI directly. `awaitOAuthRedirect` must expose the bound port before it resolves — accept a caller-provided `port` in tests, or resolve the redirectUri via a small two-step: return the server's port through `deps` callback. Implement `openBrowser` receiving the FINAL authUrl with the real redirect port substituted; simplest: bind first, compute redirectUri, let the CALLER build authUrl with it (so signature is `awaitOAuthRedirect(buildAuthUrl: (redirectUri) => string, expectedState, deps)`). Use that signature.

- [ ] **Step 1: failing test**
```typescript
// tests/mcp/loopback.test.ts
import { expect, test } from 'bun:test';
import { awaitOAuthRedirect } from '../../src/mcp/loopback.ts';

test('captures code+state from the callback', async () => {
  const p = awaitOAuthRedirect(
    (redirectUri) => `https://as.example/auth?redirect_uri=${encodeURIComponent(redirectUri)}`,
    'xyz',
    { openBrowser: (url) => {
        const uri = decodeURIComponent(new URL(url).searchParams.get('redirect_uri')!);
        void fetch(`${uri}?code=CODE123&state=xyz`);
      }, timeoutMs: 5000 },
  );
  const r = await p;
  expect(r.code).toBe('CODE123');
  expect(r.state).toBe('xyz');
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** with the `buildAuthUrl(redirectUri)` signature.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): browser loopback OAuth redirect capture`).

---

