# Task 6 Report — `GET /.well-known/agent-card.json` (public discovery route)

Slice 31 (A2A interop), Increment 2. Commit `0543f86`.

## Implemented

- **`src/server/a2a/card.ts`** (new) — `handleAgentCard(req, { allowlist, publicBaseUrl })`:
  - Reads config LIVE per request (`loadConfig().values`). **404 (featureless JSON `{error:'not found'}`) when `AGENT_A2A_ENABLED !== true`** — fail-safe: no card, no skills, no capability leak until an operator enables the surface.
  - When enabled: builds the card via Task 5's `buildAgentCard`, computes a strong quoted `ETag` (`"<sha256>"`) via `cardEtag`, sets `Cache-Control: public, max-age=<AGENT_A2A_CARD_TTL>`.
  - Honors `If-None-Match` (RFC-9110: comma-list + `*`) → `304` (with `ETag`+`Cache-Control`, empty body); else `200` + `content-type: application/json`.
  - Calls `recordA2aCard({ cacheHit })` on both the 200 and 304 paths.
- **`src/server/app.ts`** — added `a2a?: { allowlist: A2aAllowlist }` to `ServerDeps`; added the route branch in `buildFetch` immediately after the `/hooks` branch and BEFORE the `/api` session guard: `GET` + exact path `=== '/.well-known/agent-card.json'` → `503` (DepUnavailableError-shaped) if `!deps.a2a`, else `handleAgentCard(...)` with `need(deps.publicBaseUrl,...)`.
- **`tests/server/a2a-card-route.test.ts`** (new) — 4 tests.

## TDD RED → GREEN

RED (before impl): `bun run test:file -- "tests/server/a2a-card-route.test.ts"` → `1 pass 3 fail` (200/304/503 cases failed; the disabled-404 passed coincidentally since the unrouted `.json` path already 404s via serveStatic). One test-harness fix during RED: the no-a2a server needed its OWN `policy` object (the Host-header port check keys on `policy.port`) — it was 403ing, which itself confirms the perimeter fronts the branch.

GREEN (after impl): `4 pass / 0 fail / 11 expect()`.

Gate:
- `bun run typecheck` → clean.
- `bun run lint:file -- <3 files>` → clean (ran `biome check --write` once to fix import-sort + line-wrap).
- `bun run docs:check` → ✔ (also runs in pre-commit; passed).
- Regression: `app.test.ts` + `app-hooks-route.test.ts` → `24 pass / 0 fail`.

## Files changed
- `src/server/a2a/card.ts` (new, ~78 lines)
- `src/server/app.ts` (import + `ServerDeps.a2a` field + route branch)
- `tests/server/a2a-card-route.test.ts` (new, 4 tests)

## Security self-review

1. **Genuinely unreachable when flag off?** YES. The card is built ONLY inside `handleAgentCard`, reached ONLY when `AGENT_A2A_ENABLED === true`. Flag read live per request (no cached/boot value). Disabled → featureless 404, no skills/URL/capabilities emitted. No other route builds or serves the card; `serveStatic` won't serve it (not a staticDir file, and the `.json` extension excludes it from the SPA fallback). No leak path.
2. **Outside the session guard, inside the perimeter?** YES. Branch sits after `enforcePerimeter(req, deps.policy)` (returns early on a bad Host/Origin) and before `if (url.pathname.startsWith('/api'))`. Test 2 proves `200` with NO `Authorization` header (a 401 would mean it was wrongly behind the guard). The 503 test needed a port-matched policy to avoid a 403 — direct evidence the perimeter runs first.
3. **Method/path scoping.** Only `GET` + the exact string path match; any other method or path falls through to `serveStatic` (→ plain 404), exposing nothing else.
4. **Absent-dep degrade.** `!deps.a2a` → `503` (not the outer catch's opaque 500).

## Concerns (minor)
- Disabled route returns a JSON `{error:'not found'}` 404 vs serveStatic's text `not found` 404 — a caller could tell the well-known path is *recognized*, but the A2A spec makes this path universally known anyway, and NO capability content leaks. Not a capability oracle.
- Per the brief, `publicBaseUrl` is resolved with `need()` INSIDE the branch (before the flag check runs in the handler). If `a2a` is wired but `publicBaseUrl` is unset, the request 500s (outer catch) rather than 404ing when the flag is off. In practice the daemon always wires `publicBaseUrl` alongside `a2a`; matches the brief's specified code exactly.

Report path: `/Users/inderjotsingh/ai/.superpowers/sdd/task-6-report.md`
