# Task 6 Report: Security — per-session bearer token mint + guard

**Status:** DONE
**Commit:** 72ba514
**Date:** 2026-07-14

## Implementation Summary

Created the per-session bearer token security foundation for Slice 30b Phase 1 web BFF:
- New file: `src/server/security/token.ts` — 256-bit hex entropy mint + constant-time verification
- New test file: `tests/server/token.test.ts` — 3-test gate covering format, uniqueness, accept/reject flows
- Updated: `docs/architecture.md` — added minimal Server layer documentation row

## Test Execution

### Step 1: Failing test (BEFORE implementation)
```bash
$ bun test tests/server/token.test.ts
error: Cannot find module '../../src/server/security/token.ts' from '/Users/inderjotsingh/ai/tests/server/token.test.ts'
 0 pass
 1 fail
 1 error
```
**Result:** FAIL as expected — module did not exist.

### Step 2: Implementation created
Implemented `src/server/security/token.ts` with:
- `mintSessionToken(): string` — returns 64-char hex (256 bits from `randomBytes(32)`)
- `type TokenGuard = { verify(req: Request): boolean }`
- `createTokenGuard(token: string): TokenGuard` — constant-time bearer verification via `timingSafeEqual()`

### Step 3: Passing test (AFTER implementation)
```bash
$ bun test tests/server/token.test.ts
bun test v1.3.11 (af24e281)

 3 pass
 0 fail
 6 expect() calls
Ran 3 tests across 1 file. [13.00ms]
```
**Result:** PASS — all 3 tests pass:
1. ✓ mintSessionToken returns a 64-char hex string, unique per call
2. ✓ guard accepts the exact bearer token
3. ✓ guard rejects a wrong, missing, or non-bearer token

## Typecheck

```bash
$ bun run typecheck
$ tsc --noEmit
```
**Result:** CLEAN — no type errors. Strict tsconfig (`noUncheckedIndexedAccess`) enforced.

## Documentation Check

```bash
$ bun run docs:check
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```
**Result:** PASS — added minimal Server layer row to `docs/architecture.md`:
> **Server** | `src/server/` | Slice 30b Phase 1 web BFF security perimeter (Tasks 6+): per-session bearer token mint + constant-time verification (`security/token.ts` — `mintSessionToken()` / `createTokenGuard(token)` with `timingSafeEqual`-protected `verify(req)`) | `node:crypto` only

Hook enforced by pre-commit gate, passed cleanly.

## Commit

```bash
[slice-30b-local-web-ui 72ba514] feat(server): add per-session bearer token mint + constant-time guard
 3 files changed, 49 insertions(+)
 create mode 100644 src/server/security/token.ts
 create mode 100644 tests/server/token.test.ts
```

Commit message matches brief specification exactly. Pre-commit hook (docs-check) ran and passed.

## Self-Review

✓ **TDD gate observed:** failing test → implementation → passing test, in sequence per brief steps 1–4.

✓ **Code matches brief verbatim:** implementation lines 50–73 match the brief's exact specification.

✓ **Test coverage:** 3 tests exercise:
  - Mint format (64-char hex) + uniqueness (no collisions on 2 calls)
  - Guard accepts exact bearer token (Authorization: Bearer <token>)
  - Guard rejects wrong token, non-bearer format, missing header

✓ **Security gate:** `timingSafeEqual()` from `node:crypto` prevents timing-side-channel attacks on token comparison.

✓ **Constant-time verify flow:**
  - Early exit only on missing/non-bearer (no token comparison yet)
  - Length check before `timingSafeEqual()` to avoid exposing token length
  - `timingSafeEqual()` ensures fixed-time comparison regardless of mismatch position

✓ **Documentation enforced:** pre-commit hook verified Server layer is documented; pre-push gate will re-verify on merge.

✓ **Greenfield created cleanly:** `src/server/` and `tests/server/` created from scratch; no conflicts or orphaned files.

✓ **Bun conventions:** all imports use `.ts` extensions; `type` not `interface`; test imports from `bun:test`; no `console.log`.

## Concerns

None. The implementation is complete, tested, documented, and ready for Task 7 (the web server host that consumes this guard).

## Next Steps (Task 7+)

Tasks 7+ wire this token into the web server's request handler:
- Task 7: HTTP middleware that calls `guard.verify(req)` and returns 401 on failure
- Task 8+: Mint a token at server startup, pass it to browser via initial handshake
- Full auth model codified in Slice 30b Phase 1 spec (localhost-only, no OAuth needed for local session)
