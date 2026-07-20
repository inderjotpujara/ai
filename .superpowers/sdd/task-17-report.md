# Task 17 report — `POST /api/devices` pair (§7.1 security crux) [FABLE ADVERSARIAL-VERIFY]

**Status:** COMPLETE. Commit `e42badc` — `feat(devices): POST /api/devices pair (server-minted id, token once) (Slice 25b Incr 3, §7.1)`.

## Files changed
- **Create** `src/server/devices/pair.ts` — `handleDevicePair(req, deps, guard)`.
- **Modify** `src/server/app.ts` — import + `POST /api/devices` route (below the GET, method-discriminated, deps built via `need()`).
- **Test** `tests/server/devices/pair.test.ts` — 7 tests (the 4 brief cases + 3 extra §7.1 hardening cases).

## TDD RED → GREEN
- RED: wrote `pair.test.ts` first; run failed with `Cannot find module .../pair.ts`.
- GREEN: implemented `pair.ts` + wired the route → 7 pass / 19 expect().
- Gate: `bun run typecheck` clean; `bun run lint:file` clean (after biome import-sort/format autofix on the test file); `bun test tests/server/` = **354 pass / 0 fail**.

## The four §7.1 invariants — how enforced + the test that proves each

### 1. IDOR — server mints deviceId, body id ignored
**Enforced:** `const deviceId = randomUUID()` is the ONLY source of the id. The body is parsed with `DevicePairRequestSchema.parse(...)` whose schema is `{ label }` ONLY (zod `.parse`, not passthrough) — a `deviceId` field in the JSON is stripped at parse and can never reach the mint/append. The minted UUID is what threads into `mintSessionToken`, `registry.append`, the span, and the response.
**Proven by:** `IDOR: a client-supplied deviceId in the body is IGNORED` — POST `{ label:'x', deviceId:'local' }` → `body.deviceId !== 'local'` AND matches `/^[0-9a-f-]{36}$/` AND the registry's only row is the minted id (the injected `'local'` is nowhere). (minted-not-body)

### 2. Trusted-local gate — 403 + NO side effect on failure
**Enforced:** `requireTrustedLocal(req, guard, deps.policy)` runs FIRST, before `req.json()` is read or anything is minted/appended. It requires `principal === 'local'` AND `isLoopbackHost` AND `originAllowed`; any miss → 403 and early return. Because it precedes all mutation, a rejected caller leaves zero side effect.
**Proven by:** two tests — `a non-local principal is 403 ... with NO side effect` (remoteGuard `principal:()=>'uuid-remote'` → 403, `registry.list()` empty) and `a non-loopback / tunnel Host is 403 even for a local principal, NO side effect` (Host `box.ts.net` + localGuard → 403, registry empty). Both cover the "gate on session-guard alone" and "loopback-not-tunnel" failure modes. (403 + no-side-effect)

### 3. Token once, never persisted / re-listed
**Enforced:** `registry.append({ deviceId, label, createdAt, exp })` — the token is NOT a field (and `device-registry.append` additionally runtime-field-strips to exactly those four). The token appears only in the `DevicePairResponse` body. The span (`recordDevicePair`) carries principal+deviceId, never the token.
**Proven by:** the mint test asserts `JSON.stringify(listed)` does NOT contain the token and the registry row list equals `[deviceId]`; plus a dedicated `the minted token NEVER appears in a subsequent GET /api/devices` test that pairs then calls `handleDeviceList` and asserts the serialized list body does not contain the token. The mint test also confirms the token actually authenticates: `sessionTokens.verifySessionToken(token)?.deviceId === deviceId`. (token-once)

### 4. pairingUrl fragment, not query
**Enforced:** `pairingUrl = ${publicBaseUrl}/#token=${token}` — token after `#`.
**Proven by:** `pairingUrl carries the token in the # fragment, NOT the query string` — parses the URL and asserts `url.search === ''`, `url.searchParams.has('token') === false`, and `url.hash === '#token=' + token`. (fragment-not-query)

## App-layer gates (inherited, not re-tested in this unit file)
- **401-unauth:** the shared `!guard.verify(req)` check in `serve()` gates every `/api` route (POST /api/devices included) before dispatch — no route-local code needed.
- **503-unwired:** the route builds its deps with `need(deps.deviceRegistry/sessionTokens/publicBaseUrl/bindInfo, ...)`, which throws `DepUnavailableError` → the existing handler maps to 503. So until T20 wires these, POST /api/devices degrades to a clean 503. Both are generic app-level behaviors already covered by the app test suite (354 pass).

## Notes / decisions
- Response status is **202** (per brief/contract), body validated through `DevicePairResponseSchema.parse` before send.
- `bad body → 400` via try/catch around `parse` (covers empty `label`, non-JSON, missing field).
- `DevicePairDeps.bindInfo` is `{ sessionTtlMs }`; the app passes the full `ServerDeps.bindInfo` (structurally assignable). `ttlMs = bindInfo.sessionTtlMs` drives both the token exp and the registry `exp = createdAt + ttlMs`.
- Only my three files were `git add`-ed. No `git add -A`.

## Concerns
None blocking. One observation for the Fable reviewer: the registry `exp` is computed as `createdAt + ttlMs`, matching the token payload's own `Date.now()+ttlMs` closely but not identically (two `Date.now()` reads, sub-ms apart) — cosmetic, both are the device's session lifetime; no security impact. `recordDevicePair` hardcodes `'local'` as the principal, which is correct here since `requireTrustedLocal` has already proven `principal === 'local'` before we reach it.
