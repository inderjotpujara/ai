### Task 5: Build the A2A Agent Card — Report

**Status:** Implemented, TDD RED→GREEN, gate clean, committed.

**Branch:** `slice-31-a2a-multimachine` (unchanged, no branch switch).

#### Files changed
- Created `src/a2a/card.ts` — `buildAgentCard(deps)` + `cardEtag(card)`.
- Created `tests/a2a/card.test.ts` — the brief's two tests verbatim + one added
  stability/change test for `cardEtag`.

#### TDD trail

**RED** — wrote `tests/a2a/card.test.ts` (brief's two tests) importing the
not-yet-existing `../../src/a2a/card.ts`:
```
$ bun test tests/a2a/card.test.ts
error: Cannot find module '../../src/a2a/card.ts' from '/Users/inderjotsingh/ai/tests/a2a/card.test.ts'
0 pass / 1 fail / 1 error
```

**GREEN** — implemented `src/a2a/card.ts` per the Produces block, added the
third test (`cardEtag` stable across two builds of the same allowlist state,
changes when a skill is added), reran:
```
$ bun test tests/a2a/card.test.ts
3 pass
0 fail
7 expect() calls
```

Full `tests/a2a/` suite (allowlist + card + spans) still green:
```
$ bun test tests/a2a/
11 pass / 0 fail / 17 expect() calls
```

**Gate:**
```
$ bun run typecheck
$ tsc --noEmit    (clean)

$ bun run lint:file -- src/a2a/card.ts tests/a2a/card.test.ts
Checked 2 files. No fixes applied.   (after one `biome check --write` pass to
                                       fix long-line wraps in both new files)
```

**Commit:** `637f378 feat(a2a): build v1.0 Agent Card from the skill allowlist (skills:[] when empty)`
— staged only `src/a2a/card.ts` + `tests/a2a/card.test.ts` (other repo-wide
unstaged/untracked files already present in the working tree — `.remember/`,
`.superpowers/sdd/progress.md`, other task briefs/reports, `AGENTS.md` — were
left untouched by this commit).

#### Implementation notes
- `buildAgentCard({ allowlist, publicBaseUrl, name?, version? })`:
  - `skills`: `allowlist.list().map(...)` → `{ id: skillId, name, description }`
    per entry; `tags`/`inputModes`/`outputModes` are left for
    `AgentSkillSchema.parse` to default (`tags: []`), since
    `AgentCardSchema.parse` recursively validates/defaults the `skills` array.
    Empty allowlist ⇒ `skills: []` (no special-casing needed — `list()` on an
    empty store already returns `[]`).
  - `protocolVersion: '1.0'`, `url: \`${publicBaseUrl}/api/a2a\``,
    `capabilities: { streaming: true, pushNotifications: false }`,
    `defaultInputModes`/`defaultOutputModes: ['text/plain','application/json']`,
    `securitySchemes: { a2aBearer: { type: 'http', scheme: 'bearer' } }`,
    `security: [{ a2aBearer: [] }]` — all pinned exactly per the brief.
  - `preferredTransport` is omitted from the raw object and left to
    `AgentCardSchema`'s own `.default('JSONRPC')`, rather than hardcoding it a
    second time in this module.
  - `name`/`version` default to `pkg.name`/`pkg.version` (`package.json`,
    imported the same way `src/version.ts`'s `APP_VERSION` does) when the
    caller doesn't override — the brief left these defaults unspecified, and
    reusing the existing package-metadata pattern avoided inventing a new one.
    `description` is NOT a `deps` field per the brief's signature; it's a fixed
    module-level string describing the orchestrator (not any one skill).
  - Returns `AgentCardSchema.parse(...)` — self-validating, per the brief.
- `cardEtag(card)`: `sha256` over a recursively key-sorted canonical JSON
  serialization (private `canonicalize` helper — arrays mapped element-wise,
  objects rebuilt with `Object.keys(...).sort()`). A code comment on both the
  helper and the export notes Task 20 extracts this into the shared
  `src/a2a/canonical.ts` (`canonicalizeCard`/`hashCard`), and `cardEtag`
  re-points there per the plan's task-dependency note (line 1213 of the plan
  doc lists `canonicalizeCard`/`hashCard` as "re-pointed from `card.ts
  cardEtag` (Task 5→20)").
- Added test (beyond the brief's two): `cardEtag` is stable across two
  `buildAgentCard` calls over the same (empty) allowlist state, and changes
  once a skill is `put`. This proves canonicalization + hashing are both
  deterministic and sensitive to actual content changes, not just object
  identity.

#### Self-review
- **Card fields match the brief exactly**: `protocolVersion`, `capabilities`,
  `url` shape, the single `a2aBearer` HTTP-bearer `securitySchemes` entry +
  matching `security` array, both default-mode arrays, and `skills: []` on an
  empty allowlist — all verified directly against the Produces block and
  covered by tests (or trivially true from `AgentCardSchema.parse`'s own
  shape).
- **YAGNI**: only `buildAgentCard` and `cardEtag` are exported; `canonicalize`
  is a private, unexported helper. No route/HTTP/Cache-Control wiring here —
  that's Task 6's `AGENT_A2A_CARD_TTL` consumer, correctly out of scope for
  this module (this module never imports `loadConfig`; `buildAgentCard`'s
  actual signature takes `publicBaseUrl` as a plain `deps` field rather than
  reading config internally, matching the brief's literal signature over the
  looser "Consumes" prose).
- **Test hygiene**: tests mirror the existing `tests/a2a/allowlist.test.ts`
  convention (`mkdtempSync(join(tmpdir(), 'a2a-'))` per test, no shared mutable
  state across tests, `JobKind` import from `src/queue/types.ts`). Formatting
  matches repo style after `biome check --write` (both files were originally
  written with the brief's single-line object literals, which violated the
  project's line-length rule; biome's reflow is now the committed form).
- **No regressions**: full `tests/a2a/` directory (11 tests across 3 files)
  and `bun run typecheck` both pass clean.

#### Concerns
- `name`/`version` defaults (`pkg.name`/`pkg.version`) were not specified in
  the brief or the plan doc; inferred from the existing `src/version.ts`
  (`APP_VERSION` from `package.json`) precedent rather than hardcoding a
  literal like `'agent-framework'`. Flagging in case Task 6/9 (the HTTP route
  that actually serves this card) expects a different display name — trivial
  to override via the optional `name`/`version` deps either way, so no
  functional risk, just worth a glance in the next task's review.
- `cardEtag`'s canonicalizer is intentionally the "for now" version called out
  in the brief; it does not yet handle non-JSON-safe values (`Date`, `Map`,
  `undefined` fields) since the parsed `A2aAgentCard` never contains any — a
  non-issue today, moot once Task 20 replaces it with the shared
  `canonicalizeCard`.
- This report file previously held stale content from an unrelated earlier
  "Task 5" (a Slice 25/25b trigger-migrations task, reusing the same task
  number in a different slice) — it has been overwritten with this task's
  actual report.
