### Task 12: OAuth client provider

**Files:**
- Create: `src/mcp/oauth-provider.ts`
- Test: `tests/mcp/oauth-provider.test.ts`

**Interfaces:**
- Consumes: Task 10 (token store), Task 11 (loopback), `OAuthClientProvider` type from `@ai-sdk/mcp`.
- Produces: `createOAuthProvider(serverName: string, opts?: { storePath?: string; scopes?: string[]; clientId?: string; openBrowser?: (u: string) => void }): OAuthClientProvider`.
- Behavior: implement every required `OAuthClientProvider` member (verbatim contract from the spec): `tokens()` → store; `saveTokens(t)` → store; `redirectToAuthorization(url)` → `awaitOAuthRedirect` (the SDK gives the authorization URL; our provider opens the browser + captures the code — note: the AI SDK provider contract drives the actual code→token exchange, our `redirectToAuthorization` only needs to open the browser and the SDK's transport polls; confirm the exact SDK callback shape at implementation time and adapt — the SDK may instead expect `redirectToAuthorization` to just `open` and a separate `saveCodeVerifier`/`codeVerifier` + a code-provider callback); `saveCodeVerifier`/`codeVerifier` → store; `get redirectUrl()` → the loopback URI; `get clientMetadata()` → `{ client_name: 'ai-local-agent', redirect_uris: [redirectUrl], grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: scopes?.join(' ') }`; `clientInformation()` → store's `client` (undefined ⇒ triggers DCR/CIMD in the SDK); `saveClientInformation?` → store.

> **Implementer:** the precise wiring of `redirectToAuthorization` vs. the SDK's code-capture differs by `@ai-sdk/mcp` version. Read `node_modules/@ai-sdk/mcp/…/oauth.ts` FIRST and make the provider satisfy the ACTUAL interface. The unit test below pins the store-backed methods (version-independent); the browser/loopback flow is proven live in Task 18.

- [ ] **Step 1: failing test** (store-backed methods, no network)
```typescript
// tests/mcp/oauth-provider.test.ts
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOAuthProvider } from '../../src/mcp/oauth-provider.ts';

test('persists + returns tokens and code verifier via the store', async () => {
  const storePath = join(tmpdir(), `oauth-${Date.now()}.json`);
  const p = createOAuthProvider('linear', { storePath });
  await p.saveCodeVerifier('verifier-123');
  expect(await p.codeVerifier()).toBe('verifier-123');
  await p.saveTokens({ access_token: 'tok', token_type: 'Bearer' } as never);
  expect((await p.tokens())?.access_token).toBe('tok');
  expect(p.clientMetadata.redirect_uris.length).toBeGreaterThan(0);
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** against the real SDK interface.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): live OAuth client provider (store + PKCE + DCR/CIMD)`).

---

