### Task 6: Security — per-session bearer token mint + guard

**Files:**
- Create: `src/server/security/token.ts`
- Test: `tests/server/token.test.ts`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `mintSessionToken(): string`; `type TokenGuard = { verify(req: Request): boolean }`; `createTokenGuard(token: string): TokenGuard`.

- [ ] **Step 1: Write the failing token test**

```ts
// tests/server/token.test.ts
import { expect, test } from 'bun:test';
import { createTokenGuard, mintSessionToken } from '../../src/server/security/token.ts';

const withAuth = (value: string) =>
  new Request('http://localhost:4130/api/health', { headers: { authorization: value } });

test('mintSessionToken returns a 64-char hex string, unique per call', () => {
  const a = mintSessionToken();
  const b = mintSessionToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b);
});

test('guard accepts the exact bearer token', () => {
  const token = mintSessionToken();
  expect(createTokenGuard(token).verify(withAuth(`Bearer ${token}`))).toBe(true);
});

test('guard rejects a wrong, missing, or non-bearer token', () => {
  const guard = createTokenGuard(mintSessionToken());
  expect(guard.verify(withAuth(`Bearer ${mintSessionToken()}`))).toBe(false);
  expect(guard.verify(withAuth('deadbeef'))).toBe(false);
  expect(guard.verify(new Request('http://localhost:4130/api/health'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/token.test.ts`
Expected: FAIL — cannot resolve `../../src/server/security/token.ts`.

- [ ] **Step 3: Write the token module**

```ts
// src/server/security/token.ts
import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Mint a per-session bearer token at launch (256 bits of entropy, hex). */
export function mintSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export type TokenGuard = { verify(req: Request): boolean };

/** Constant-time bearer verification against the session token. */
export function createTokenGuard(token: string): TokenGuard {
  const expected = Buffer.from(token);
  const prefix = 'Bearer ';
  return {
    verify(req) {
      const header = req.headers.get('authorization');
      if (header === null || !header.startsWith(prefix)) return false;
      const got = Buffer.from(header.slice(prefix.length));
      if (got.length !== expected.length) return false;
      return timingSafeEqual(got, expected);
    },
  };
}
```

- [ ] **Step 4: Run token test to verify it passes**

Run: `bun test tests/server/token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/security/token.ts tests/server/token.test.ts
git commit -m "feat(server): add per-session bearer token mint + constant-time guard"
```

---

