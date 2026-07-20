# Task 14 Report — `isLoopbackHost` + `requireTrustedLocal` (Slice 25b Incr 3, D5)

> Note: this path previously held a superseded report for an unrelated
> "Task 14" from Slice 30b Phase 8 (aria-live MicButton). Overwritten here per
> this task's instruction to write the Slice-25b Task-14 report to this exact
> path; prior content remains in git history.

## Summary
Implemented the trusted-local privileged-write gate that makes plan-audit CRITICAL-2 real:
a remote/paired client can never pair/revoke/rotate. Two units:

1. `isLoopbackHost(req: Request): boolean` added to `src/server/security/origin.ts`
   (next to `hostAllowed`, reusing the existing `LOCAL_HOSTS` constant — no reinvention
   of Host parsing).
2. `requireTrustedLocal(req, guard, policy): Response | null` in new
   `src/server/security/trusted-local.ts`.

## isLoopbackHost matching rules
- Reads the `host` header. Absent (`null`) OR empty string → `false`.
- Strips an optional `:PORT` suffix via `/:\d+$/` (the `[::1]` brackets are preserved —
  only a trailing `:digits` is stripped, so `[::1]:4130` → `[::1]`).
- Returns `LOCAL_HOSTS.includes(bare)` where `LOCAL_HOSTS = ['localhost','127.0.0.1','[::1]']`.
- TRUE for: `127.0.0.1`, `127.0.0.1:4130`, `localhost`, `localhost:4130`, `[::1]`, `[::1]:4130`.
- FALSE for tunnel/LAN/allowlisted-but-not-loopback hosts — a request over an
  `AGENT_WEB_ALLOWED_HOSTS` tunnel is admitted by `hostAllowed` but is NOT loopback here.

### Adversarial host cases tested (`tests/server/security/origin-loopback.test.ts`)
- `127.0.0.1.evil.com` → false (subdomain-suffix spoof; no `:port` to strip, not in set).
- `localhost.evil.com` → false; `evil.com:127.0.0.1` → false (port-position spoof).
- tunnel host `ts.example` → false; LAN/CGNAT `100.64.0.1:4130` → false.
- absent Host (`null`) → false; empty Host (`''`) → false.
- `0.0.0.0` and `0.0.0.0:4130` → false (bind wildcard, never a client host — excluded
  because it is not in `LOCAL_HOSTS`).

## requireTrustedLocal — 3-condition logic
Returns `null` (proceed) IFF ALL THREE hold; otherwise a **403** JSON Response
(`{"error":"forbidden: trusted-local only"}`, `content-type: application/json`):
1. `guard.principal(req) === 'local'` — only the local-minted session token carries
   deviceId `'local'`; a paired remote device resolves to a random UUID (or `undefined`).
2. `isLoopbackHost(req)` — a LOOPBACK Host specifically, so an injected `'local'` token
   replayed over an ALLOWED TUNNEL host is still rejected (the FIX-2 backstop).
3. `originAllowed(req, policy)` — same-/allowed-origin (CSRF defense; reuses existing helper).

### requireTrustedLocal cases tested (`tests/server/security/trusted-local.test.ts`)
- local principal + loopback Host + no cross-origin → `null` (pass).
- principal is a UUID (paired remote device) → 403.
- Host is non-loopback non-allowlisted remote (`evil.example`) → 403.
- injected `'local'` token replayed over ALLOWED TUNNEL host (`ts.example`) → 403 (core fix).
- no verified principal (`undefined`) → 403.
- loopback + local principal but cross-origin `Origin: http://evil.example` → 403 (condition 3).

## TDD
- RED: ran both new test files before implementation — `Export named 'isLoopbackHost' not
  found` + `Cannot find module trusted-local.ts` (0 pass, 2 fail).
- GREEN: after adding the helper + module — 9 pass / 0 fail across the two new files
  (21 expect calls). Existing `tests/server/origin.test.ts` stays green (unchanged
  `hostAllowed`/`originAllowed` behavior). Full `tests/server/`: 339 pass / 0 fail.

## Brief consistency check
The brief's loopback matching (strip `:\d+$`, compare against `LOCAL_HOSTS`) is consistent
with the real `origin.ts` Host-parsing and the shared `LOCAL_HOSTS` constant — no
contradiction, no NEEDS_CONTEXT.

## Files changed
- `src/server/security/origin.ts` (added `isLoopbackHost`)
- `src/server/security/trusted-local.ts` (new)
- `tests/server/security/origin-loopback.test.ts` (new)
- `tests/server/security/trusted-local.test.ts` (new)

## Gate
- `bun run typecheck` — clean.
- `bun run lint:file` on all 4 files — clean.
- targeted tests 9/9 green; `tests/server/` sanity 339/339 green.

## Concerns
- None blocking. Note for downstream (T17–T21, Fable review): `requireTrustedLocal` is a
  belt-and-suspenders gate that must be applied to pair/revoke/rotate routes IN ADDITION to
  the inherited session guard — it narrows those privileged routes to the physically-local
  browser; it does not replace `enforcePerimeter` or the session guard.
- `originAllowed` treats an absent Origin as allowed (matching the existing perimeter);
  conditions 1+2 carry the core protection, so this is intentional and safe here.
