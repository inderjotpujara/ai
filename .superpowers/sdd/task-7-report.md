# Task 7 Report: Security — Host-header allowlist + cross-origin Origin rejection

## Status: DONE

## Commit
`a16fb9d` — feat(server): add Host allowlist + cross-origin Origin rejection

## What changed
- **`src/server/security/origin.ts`** (37 lines, new file):
  - `OriginPolicy` type: `{ port: number; allowedOrigins: string[] }`
  - `hostAllowed(req, port)`: Validates Host header against loopback hosts (localhost/127.0.0.1/[::1]) on configured port; rejects rebinding attacks and missing Host.
  - `originAllowed(req, policy)`: Allows absent Origin (same-origin navigation); rejects cross-origin unless loopback on port or allowlisted in policy.
  - `enforcePerimeter(req, policy)`: Orchestrator; returns 403 Response on host/origin violation, null if clean.
  - Pure `Request` header inspection; no external dependencies.

- **`tests/server/origin.test.ts`** (34 lines, new file):
  - Test 1: Accepts localhost/127.0.0.1 Host on configured port.
  - Test 2: Rejects rebinding Host (attacker domain) and missing Host.
  - Test 3: Allows absent Origin and allowlisted origins; rejects cross-origin.
  - Test 4: enforcePerimeter returns 403 on bad host, null when clean.

## TDD flow
1. Wrote test first (`tests/server/origin.test.ts`); ran `bun test tests/server/origin.test.ts` — failed with "Cannot find module" (expected).
2. Implemented module exactly as specified in the brief.
3. Re-ran test — **4 pass, 0 fail**.

## Verification
- **Test results:**
  ```
  bun test tests/server/origin.test.ts
   4 pass
   0 fail
   9 expect() calls
  Ran 4 tests across 1 file. [13.00ms]
  ```

- **Typecheck:** `bun run typecheck` → clean, no errors.
  ```
  $ tsc --noEmit
  (exit 0)
  ```

- **Docs check (pre-commit hook):** Passed automatically on commit.
  ```
  ✔ docs-check: living docs present + linked; every src subsystem documented.
  ```

- No stray `console.log` introduced.
- No regressions — existing server tests unaffected (this is a new subsystem addition).

## Self-review (per dispatch instructions)
- **Host validation:** Loopback-only enforcement correct; missing Host rejected as expected.
- **Origin validation:** Absent Origin allowed (same-origin navigation); cross-origin rejected; loopback and allowlisted origins accepted per policy.
- **Perimeter enforcement:** Checks Host first (DNS-rebinding defense), then Origin (CSRF defense); returns appropriate 403 or null.
- **Code style:** Follows project conventions (type over interface, early returns, small focused functions). TypeScript strict mode passed.
- **Test coverage:** All 4 test groups cover the brief's semantic gates (loopback accept, rebinding reject, missing-host reject, absent-origin allow, cross-origin reject, enforcePerimeter behavior).

## Concerns
None. Implementation matches brief verbatim; all gates pass; semantics empirically validated by the test suite.

## FIX WAVE (port-scoping bypass)

### The finding
A security review found a port-scoping bypass in both perimeter functions:
- `hostAllowed`: the `|| host === h` disjunct accepted a bare (portless) `localhost`/`127.0.0.1`/`[::1]` Host header regardless of the configured port.
- `originAllowed`: the loopback allow-list included bare `http://${h}` entries (implicit port 80), accepted regardless of `policy.port`.

Impact: a non-browser local client, or a page served from `http://localhost` (port 80), could satisfy the Host/Origin check against a service running on a *different* configured port — defeating the port-scoped CSRF/rebinding defense the spec requires (loopback MUST be on the configured port).

### The fix
`src/server/security/origin.ts`:

```ts
/** The Host header must name a loopback host on the configured port (DNS-rebinding defense). */
export function hostAllowed(req: Request, port: number): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  return LOCAL_HOSTS.some((h) => host === `${h}:${port}`);
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
  const loopback = LOCAL_HOSTS.map((h) => `http://${h}:${policy.port}`);
  return loopback.includes(origin) || policy.allowedOrigins.includes(origin);
}
```

- `hostAllowed`: dropped the bare fallback — accepts ONLY exact `host === \`${h}:${port}\`` for each loopback host. A portless Host is now rejected.
- `originAllowed`: dropped the bare `http://${h}` entries — the loopback allow-list is now ONLY `http://${h}:${policy.port}`. `policy.allowedOrigins` still allows explicitly-configured extra origins (e.g. a Slice-24 tunnel), unchanged.
- Exact-match (`===`/`Array.includes`) discipline preserved throughout; no substring/prefix matching introduced.

### New tests added (`tests/server/origin.test.ts`)
- `rejects a bare (portless) loopback Host` — `Host: localhost` (no port) → `hostAllowed` false.
- `rejects a bare (portless) loopback Origin when not explicitly allowlisted` — `Origin: http://localhost` (no port), empty `allowedOrigins` → `originAllowed` false.
- `rejects a loopback Host on the wrong port` — policy port 4130, `Host: localhost:9999` → false.
- `accepts an IPv6 loopback Host on the configured port` — `Host: [::1]:4130` → true.
- `accepts a distinct non-loopback origin configured via allowedOrigins` — `Origin: https://tunnel.example.com` in `policy.allowedOrigins`, not loopback → `originAllowed` true (proves the config path works independently of the loopback list).

All previously-passing tests kept unchanged and still pass.

### Verification
```
$ bun run typecheck
$ tsc --noEmit
(exit 0, clean)

$ bun test tests/server/origin.test.ts
bun test v1.3.11 (af24e281)

 9 pass
 0 fail
 14 expect() calls
Ran 9 tests across 1 file. [31.00ms]
```

### Commit
`984d186` — fix(server): port-scope Host/Origin allowlist (drop portless loopback bypass)
