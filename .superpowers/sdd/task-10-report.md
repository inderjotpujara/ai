# Task 10 report — thin Bun.serve BFF pipeline (`src/server/app.ts`)

## Implemented

- `src/server/app.ts`:
  - `type ServerDeps = { token: string; policy: OriginPolicy; staticDir?: string; recordIo: boolean; indexHtml: string }`.
  - `buildFetch(deps): (req: Request) => Promise<Response>` — the pipeline:
    1. `enforcePerimeter(req, deps.policy)` FIRST → 403 short-circuit before any auth check (attacker origin never reaches the token guard).
    2. For `/api/*`: `createTokenGuard(deps.token).verify(req)` → 401 JSON `{error:'unauthorized'}` on failure.
    3. `/api/health` → `{ok:true}` (200); any other `/api/*` → JSON 404 `{error:'not found'}`.
    4. Non-`/api` paths → `serveStatic`: `/` or `/index.html` serves `deps.indexHtml` with `cache-control: no-store`; other paths serve from `deps.staticDir` (traversal-guarded via a `..` check before any filesystem touch) or 404.
  - All API handling wrapped in `withServerRequestSpan` (route/method attrs, `rec.status(...)`) with a try/catch that maps any thrown typed error to JSON 500 via `explain(err).title` — never crashes the handler.
  - COOP/COEP headers (`same-origin` / `require-corp`) applied to every static + JSON response.
  - Implementation matches the brief's Step-3 code verbatim (imports, structure, comments).
- `tests/server/app.test.ts`: the brief's 4-test integration suite verbatim, with one necessary fix (see Concerns) — boots a real `Bun.serve({port:0, fetch: buildFetch(deps), idleTimeout:0})`, reconciles `policy.port` to the ephemeral port, and exercises: `/` under COOP/COEP; `/api/health` 401 unauth → 200 `{ok:true}` bearer-auth; cross-origin → 403 before auth; unknown `/api/*` → JSON 404.

## Test commands + results

**RED (Step 2, before `src/server/app.ts` existed):**
```
$ bun test tests/server/app.test.ts
error: Cannot find module '../../src/server/app.ts' from '/Users/inderjotsingh/ai/tests/server/app.test.ts'
0 pass / 1 fail / 1 error
```

**GREEN (after writing `src/server/app.ts`):**
```
$ bun test tests/server/app.test.ts
4 pass / 0 fail / 10 expect() calls
Ran 4 tests across 1 file. [90.00ms]
```

**Typecheck (clean):**
```
$ bun run typecheck
$ tsc --noEmit
(no output — exit 0)
```

**Regression — all `tests/server/*` (app + origin + token + media-path):**
```
$ bun test tests/server/
20 pass / 0 fail / 34 expect() calls
Ran 20 tests across 4 files. [74.00ms]
```

## Self-review

- Pipeline order verified by the dedicated "cross-origin → 403 before auth" test: a request with a valid bearer token but a foreign `Origin` header still gets 403, not 401 — confirms `enforcePerimeter` truly runs before `guard.verify`.
- `enforcePerimeter`, `createTokenGuard`, `withServerRequestSpan`, `explain` all consumed with the exact signatures already on this branch (re-read each source file before wiring — no drift from Tasks 6–9).
- No vacuous assertions; strict tsconfig (`noUncheckedIndexedAccess` + strict null checks) is genuinely satisfied, not silenced.
- COOP/COEP headers present on all three response paths (index HTML, static file, JSON) via the shared `ISOLATION_HEADERS` object — spot-checked in the diff, not just the tested `/` path.
- Traversal guard (`!url.pathname.includes('..')`) runs before any `Bun.file`/`join` call, so a `../` path never touches the filesystem.

## Concerns

- **Brief's sample test code did not typecheck as-is.** The brief's Step 1 snippet does `policy.port = server.port;` directly, but this repo's installed `bun-types` (`node_modules/bun-types/serve.d.ts:1086`) types `Server.port` as `number | undefined`, and the project's strict tsconfig rejects the bare assignment (`TS2322`). Fixed by destructuring `port` and throwing if `undefined` before use — a real guard, not a vacuous `!` assertion, per the repo's "no vacuous assertions" rule. This is the only deviation from the brief's literal code; behavior and all four test assertions are unchanged. `src/server/app.ts` itself matches the brief's Step 3 code verbatim with no changes needed.
- Static-file serving (`serveStatic`'s `deps.staticDir` branch) has no dedicated test in this task — only `/` (indexHtml) and the 404 fallback are exercised. That branch is straightforward and mirrors the brief exactly, but a future task wiring a real `staticDir` should add coverage for an actual on-disk asset.
- Note: this file previously held a stale "Task 10: CLI flag parsing (--voice/--voice-in)" report left over from an earlier slice's numbering; replaced with this task's content.
