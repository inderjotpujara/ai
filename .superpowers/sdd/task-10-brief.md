### Task 10: OAuth token store (0600 file)

**Files:**
- Create: `src/mcp/token-store.ts`
- Test: `tests/mcp/token-store.test.ts`

**Interfaces:**
- Produces:
```typescript
export type StoredTokens = { access_token: string; token_type?: string; refresh_token?: string; expires_at?: number };
export type ClientRecord = { client_id: string; client_secret?: string };
export type ServerAuthRecord = { tokens?: StoredTokens; codeVerifier?: string; client?: ClientRecord };
export function tokenStorePath(): string; // default: $XDG_CONFIG_HOME|~/.config + /ai/mcp-tokens.json
export function readTokenStore(path?: string): Record<string, ServerAuthRecord>;
export function writeTokenStore(store: Record<string, ServerAuthRecord>, path?: string): void; // atomic temp+rename, mode 0o600
export function getServerAuth(server: string, path?: string): ServerAuthRecord;
export function setServerAuth(server: string, rec: ServerAuthRecord, path?: string): void; // merge + persist
```
- Behavior: mirror `consent.ts` atomic write BUT add `{ mode: 0o600 }` on the temp write AND `chmodSync(path, 0o600)` after rename (rename preserves the temp's mode; set on both to be safe). Corrupt/missing file → `{}` (never throw). Create the parent dir (`mkdirSync(dirname, { recursive: true, mode: 0o700 })`).

- [ ] **Step 1: failing tests**
```typescript
// tests/mcp/token-store.test.ts
import { expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setServerAuth, getServerAuth } from '../../src/mcp/token-store.ts';

test('round-trips tokens per server and writes 0600', () => {
  const path = join(tmpdir(), `mcp-tokens-${Date.now()}.json`);
  setServerAuth('linear', { tokens: { access_token: 'abc', token_type: 'Bearer' } }, path);
  expect(getServerAuth('linear', path).tokens?.access_token).toBe('abc');
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('missing file reads as empty, never throws', () => {
  expect(getServerAuth('nope', join(tmpdir(), `absent-${Date.now()}.json`))).toEqual({});
});
```
- [ ] **Step 2: fail**.
- [ ] **Step 3: implement** per Interfaces.
- [ ] **Step 4: pass**.
- [ ] **Step 5: commit** (`feat(mcp): 0600 OAuth token store`).

---

