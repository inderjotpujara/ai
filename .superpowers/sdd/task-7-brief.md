### Task 7: Security — Host-header allowlist + cross-origin Origin rejection

**Files:**
- Create: `src/server/security/origin.ts`
- Test: `tests/server/origin.test.ts`

**Interfaces:**
- Consumes: nothing (pure `Request` header inspection).
- Produces: `type OriginPolicy = { port: number; allowedOrigins: string[] }`; `hostAllowed(req: Request, port: number): boolean`; `originAllowed(req: Request, policy: OriginPolicy): boolean`; `enforcePerimeter(req: Request, policy: OriginPolicy): Response | null` (returns a 403 `Response` on violation, else `null`).

- [ ] **Step 1: Write the failing perimeter test**

```ts
// tests/server/origin.test.ts
import { expect, test } from 'bun:test';
import {
  type OriginPolicy,
  enforcePerimeter,
  hostAllowed,
  originAllowed,
} from '../../src/server/security/origin.ts';

const policy: OriginPolicy = { port: 4130, allowedOrigins: ['http://localhost', 'http://127.0.0.1'] };

const req = (headers: Record<string, string>) =>
  new Request('http://localhost:4130/api/health', { headers });

test('accepts a localhost/127.0.0.1 Host on the configured port', () => {
  expect(hostAllowed(req({ host: 'localhost:4130' }), 4130)).toBe(true);
  expect(hostAllowed(req({ host: '127.0.0.1:4130' }), 4130)).toBe(true);
});

test('rejects a rebinding Host (attacker domain) and a missing Host', () => {
  expect(hostAllowed(req({ host: 'evil.example.com:4130' }), 4130)).toBe(false);
  expect(hostAllowed(new Request('http://localhost:4130/x'), 4130)).toBe(false);
});

test('allows an absent Origin (same-origin nav) and a listed origin; rejects cross-origin', () => {
  expect(originAllowed(req({ host: 'localhost:4130' }), policy)).toBe(true);
  expect(originAllowed(req({ host: 'localhost:4130', origin: 'http://localhost:4130' }), policy)).toBe(true);
  expect(originAllowed(req({ host: 'localhost:4130', origin: 'https://evil.example.com' }), policy)).toBe(false);
});

test('enforcePerimeter returns 403 on a bad host, null when clean', () => {
  const bad = enforcePerimeter(req({ host: 'evil.example.com:4130' }), policy);
  expect(bad?.status).toBe(403);
  expect(enforcePerimeter(req({ host: 'localhost:4130' }), policy)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/origin.test.ts`
Expected: FAIL — cannot resolve `../../src/server/security/origin.ts`.

- [ ] **Step 3: Write the origin module**

```ts
// src/server/security/origin.ts
export type OriginPolicy = { port: number; allowedOrigins: string[] };

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The Host header must name a loopback host on the configured port (DNS-rebinding defense). */
export function hostAllowed(req: Request, port: number): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  return LOCAL_HOSTS.some((h) => host === `${h}:${port}` || host === h);
}

/**
 * A cross-origin Origin is rejected (CSRF / 0.0.0.0-day defense). An absent
 * Origin (same-origin navigation / non-CORS GET) is allowed. Loopback origins
 * on the configured port are always allowed; extra origins come from config
 * (a Slice-24 tunnel adds its origin via AGENT_WEB_ORIGIN_ALLOWLIST).
 */
export function originAllowed(req: Request, policy: OriginPolicy): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true;
  const loopback = LOCAL_HOSTS.flatMap((h) => [
    `http://${h}:${policy.port}`,
    `http://${h}`,
  ]);
  return loopback.includes(origin) || policy.allowedOrigins.includes(origin);
}

/** Returns a 403 Response when the request fails the perimeter, else null. */
export function enforcePerimeter(req: Request, policy: OriginPolicy): Response | null {
  if (!hostAllowed(req, policy.port)) {
    return new Response('forbidden host', { status: 403 });
  }
  if (!originAllowed(req, policy)) {
    return new Response('forbidden origin', { status: 403 });
  }
  return null;
}
```

- [ ] **Step 4: Run perimeter test to verify it passes**

Run: `bun test tests/server/origin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/security/origin.ts tests/server/origin.test.ts
git commit -m "feat(server): add Host allowlist + cross-origin Origin rejection"
```

---

