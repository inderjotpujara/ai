# Task 11 Report: Server — `bun run web` entry point (Slice 30b)

*(Note: this path previously held a stale Slice-29 report for a differently-numbered
Task 11 — "Voice ingest + chat wiring." Overwritten here since task numbers are
reused per-slice.)*

## Implemented

- `src/server/main.ts` (new): `renderIndexHtml(token)` builds the Phase-1 minimal
  served page (doctype + `window.__AGENT_TOKEN__` injection). `type StartOptions`
  and `startWebServer(opts?)` load config via `loadConfig()`, resolve
  port/allowedOrigins/recordIo (opts override config), mint a session token via
  `mintSessionToken()`, build `ServerDeps`, boot `Bun.serve({ port, fetch:
  buildFetch(deps), idleTimeout: 0 })`, reconcile the ephemeral port back into
  the `policy` object, and return `{ server, token, port }`. An
  `if (import.meta.main)` boot block starts the server when run directly and
  writes a one-line status to stderr.
- `package.json`: added `"web": "bun run src/server/main.ts"` to `scripts`,
  directly after the existing `"serve"` entry (untouched, per the brief's
  warning).
- `tests/server/main.test.ts` (new): the brief's exact smoke test — verbatim.

### Strict-typing gotcha (per Task-10 precedent)

`Bun.serve(...).port` is typed `number | undefined` under the installed
bun-types. Guarded with a real runtime check, not `!` or a cast:

```ts
const { port: boundPort } = server;
if (boundPort === undefined) {
  throw new Error('Bun.serve() did not report a bound port');
}
policy.port = boundPort;
return { server, token, port: boundPort };
```

The `import.meta.main` boot block itself uses `server.port` directly in a
template string (implicit `String(number | undefined)`), which is fine —
string interpolation, not an assignment/return needing the narrowed type — so
no assertion is needed there either.

## Test commands + results

1. RED — before writing `src/server/main.ts`:
   ```
   $ bun test tests/server/main.test.ts
   error: Cannot find module '../../src/server/main.ts' from '/Users/inderjotsingh/ai/tests/server/main.test.ts'
   0 pass / 1 fail / 1 error
   ```

2. GREEN — after writing `src/server/main.ts` + the `web` script:
   ```
   $ bun test tests/server/main.test.ts
   2 pass
   0 fail
   7 expect() calls
   Ran 2 tests across 1 file. [122.00ms]
   ```

3. Typecheck — clean:
   ```
   $ bun run typecheck
   $ tsc --noEmit
   (no output, exit 0)
   ```

4. Full `tests/server/*` regression — all pass:
   ```
   $ bun test tests/server/
   22 pass
   0 fail
   41 expect() calls
   Ran 22 tests across 5 files. [85.00ms]
   ```

## Self-review

- Interfaces match exactly what Task 5 (`config/schema.ts`), the earlier
  `app.ts`/`token.ts` modules, and this brief specify — read all three source
  files before writing to confirm shapes (`ServerDeps`, `OriginPolicy`,
  `LoadedConfig.values`, `mintSessionToken()` signature) rather than trusting
  the brief's snippet blindly.
- Only staged the three files the brief's commit step names
  (`src/server/main.ts`, `package.json`, `tests/server/main.test.ts`);
  left the many other modified/untracked repo files (SDD ledger docs,
  `.remember/*`) untouched for this commit, since they're owned by other
  in-flight tasks/hooks, not Task 11.
- `git commit` ran the pre-commit `docs:check` hook automatically and passed
  ("living docs present + linked; every src subsystem documented") — no
  `docs/architecture.md` update was needed since `server/main.ts` extends an
  already-documented subsystem (`src/server`) rather than adding a new one.
- Did not touch the existing `"serve"` script, per the explicit warning.

## Concerns

None. Brief's code was used essentially verbatim; the one deviation (the
explicit `boundPort` guard instead of directly assigning `server.port`) is
required by strict tsconfig's typing of `Bun.serve().port` as
`number | undefined`, and mirrors the Task-10 precedent noted in the brief
itself.
