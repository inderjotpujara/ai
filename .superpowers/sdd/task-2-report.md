# Task 2 report — Central config schema + `bun run config`

## Status: DONE

Commit: `d16adae` on branch `slice-30a-production-foundation`
("feat(config): single documented AGENT_* schema + 'bun run config' dump (was 63 scattered env reads)")

## What shipped

- `src/config/schema.ts` — `ConfigKind`, `ConfigEntry`, `CONFIG_SPEC` (64 entries,
  one per `AGENT_*` var found by `grep -rEo 'AGENT_[A-Z_]+' src | sort -u`),
  `coerce()`, `loadConfig(env?)` returning `{ values, sources }`.
- `src/cli/config.ts` — `bun run config` dump (`def `/`env ` + var + value + doc,
  one line per entry, via `process.stdout.write`, no `console.log`).
- `tests/config/schema.test.ts` — the 4 brief tests verbatim (doc+default
  presence, defaults applied, env override wins, invalid number falls back).
  All pass: `bun test tests/config/` → 4 pass, 0 fail, 134 expect() calls.
- `package.json` — added `"config": "bun run src/cli/config.ts"`.
- `src/cli/chat.ts` — imports `loadConfig` from `../config/schema.ts` and calls
  it as the first statement in `main()`, with a comment clarifying it never
  throws (invalid values silently fall back to documented defaults, matching
  every other env-fallback site in the codebase — "fail-fast" in the brief's
  wording means "validate eagerly," not "throw").
- `docs/architecture.md` — new **Config** row in the subsystem registry table
  (inserted after **DB migrations**), documenting `src/config/`'s scope,
  `CONFIG_SPEC`/`loadConfig`/`cli/config.ts`, the `chat.ts` wiring, and the
  explicit non-migration scope note (existing ~63 read sites still read
  `process.env` directly — tracked follow-on; this is the schema Slice-30b's
  settings UI will read/write against).

## CONFIG_SPEC coverage

**64 entries** — exact 1:1 match against `grep -rEo 'AGENT_[A-Z_]+' src | sort -u`
(diffed the two lists; zero mismatches, zero extras, zero omissions).

Grouped by concern with comments: core/guardrails (2), reliability (11),
memory/RAG (5), verification (5), verified-build (7), resource/hardware (4),
provisioning (1), MCP (2), telemetry (2), logging (1), runs/archive (1),
workflow (1), media uncensored policy (1), media timeout (1), STT (2), image
gen (3), TTS/voice gen (3), video gen (3), ComfyUI lane (2), media venv
resolution (2), voice input/STT (5).

## Defaults verification (spot-checked + traced every entry to its real read site)

All defaults were pulled from the actual read site, not guessed:
- `AGENT_MAX_DELEGATION_DEPTH`=5 ← `core/guardrails.ts` `maxDelegationDepth()`
- `AGENT_RUN_TIMEOUT_MS`=120000 ← `reliability/config.ts` `runTimeoutMs()`
- `AGENT_MEMORY_TOP_K`=6 ← `memory/retrieve.ts`
- `AGENT_UNCENSORED`=true ← `media/policy.ts` `uncensoredEnabled()`
- `AGENT_TELEMETRY_RECORD_IO`=true ← `telemetry/provider.ts` `recordIoEnabled()`

`bun run config` output confirms all five print exactly these values with
`def` source (verified live).

## Notable defaults requiring a documented caveat (not wrong, but non-trivial)

1. **`AGENT_MEDIA_TIMEOUT_MS`** has two different real fallbacks depending on
   call site: 600_000ms in the media generation/STT pipeline (4 call sites)
   vs. 30_000ms in the interactive voice-capture path
   (`voice/cli-io.ts resolveVoiceConfig`). Documented `def: 600_000` (the
   majority default) and called out the voice-path divergence explicitly in
   the entry's `doc` string so it isn't misleading.
2. **Dynamic (homedir-relative) defaults** — `AGENT_VOICE_DIR`,
   `AGENT_MEDIA_VENV`, `AGENT_MEDIA_VIDEO_VENV` resolve via
   `join(homedir(), ...)` at runtime, not a static literal. Documented with
   the `~/...` shorthand and a doc-string note that the real default is
   joined against the live home dir.
3. **Env-pin-with-no-literal-default vars** — `AGENT_VIDEO_MODEL` and
   `AGENT_VOICE_STT_MODEL` have no hardcoded fallback string in the real code
   (unset defers to the gen-fit selector's catalog ranking / mlx-video's own
   built-in, or to a path computed from `AGENT_VOICE_DIR`). Documented with
   `def: ''` and a doc string explaining what unset actually resolves to.
4. **`AGENT_METAL_WORKING_SET_BYTES`** has no numeric default either — it's a
   pure live-read override; unset means "use the fraction heuristic instead."
   Documented `def: 0` with that meaning spelled out.
5. **Boolean-convention mismatch for two vars** — `AGENT_MCP_AUTO_APPROVE` and
   `AGENT_PROVISION_AUTO_YES` are real default-OFF booleans that only flip on
   when the raw value is **exactly** `'1'` (real code: `=== '1'`). The
   brief's uniform `coerce()` boolean rule (`raw !== '0' && raw.toLowerCase()
   !== 'false'` ⇒ true) is looser — any non-`0`/`false` value would coerce to
   `true` in the schema, not just `'1'`. This is a deliberate, documented
   simplification of the schema layer (called out in both the `CONFIG_SPEC`
   header comment and each entry's `doc`) — the real read sites keep their
   stricter check unchanged since this task does not migrate them.

## Verification run

- `bun test tests/config/` → 4 pass, 0 fail
- `bun test tests/config tests/cli` → 74 pass, 0 fail (chat.ts wiring didn't
  break any existing CLI test)
- `bun run typecheck` → clean
- `bun run lint` (full) → exit 0, 14 pre-existing warnings in unrelated files
  (`noExplicitAny` in test mocks), zero issues in any file this task touched
- `bun run docs:check` → `✔ docs-check: living docs present + linked; every
  src subsystem documented.`
- `bun run config | head` → prints the effective table correctly (verified
  full output, not just head)

## Scope confirmation

Per the brief, this task does **not** migrate the ~63 existing scattered
`process.env.AGENT_*` read sites onto `loadConfig` — none of those files were
touched. Only `src/cli/chat.ts` gained the one eager `loadConfig()` call at
the top of `main`, as specified.

## Concerns

None blocking. The five items above are documented caveats, not defects —
each is called out inline in the relevant `ConfigEntry.doc` so `bun run
config`'s output itself carries the caveat, not just this report.
