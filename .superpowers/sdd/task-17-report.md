# Task 17 report — A2A config/skills/token console API (behind requireTrustedLocal)

**Slice 31 (A2A interop), Increment 5. Branch `slice-31-a2a-multimachine`. Commit `0c69a98`.**

(Note: this file previously held a Slice-25b Task 17 report — same filename, different slice; overwritten for the current Slice-31 Task 17.)

## Implemented

The browser-facing (server-side) config surface the Federation tab (Increment 7) will call — four
routes, all trusted-local, distinct from the A2A-Bearer protocol route `POST /api/a2a`:

- `GET /api/a2a/config` — metadata-only view: `{ enabled, skills[], cardPreview, tokens[] }`. Never a raw token.
- `PUT /api/a2a/skills` — set the exposed-skill allowlist; unknown ref → 400.
- `POST /api/a2a/token` — mint an A2A Bearer; raw token returned EXACTLY ONCE (201).
- `DELETE /api/a2a/token/:id` — revoke (idempotent 200).

### Files changed (6, +539)
- **`src/contracts/a2a.ts`** — landed the deferred `JobKindWire` import (first live wire-layer consumer, keeps Task 1 lint-clean) via new DTOs: `IssuedTokenSchema`, `A2aSkillEntryWireSchema` (`kind: z.enum(JobKindWire)`), `A2aConfigResponseSchema`, `A2aSkillsPutRequestSchema`, `A2aTokenIssueRequestSchema`, `A2aTokenIssueResponseSchema`.
- **`src/server/a2a/config.ts`** (new) — `handleA2aConfig(deps)` + shared `buildA2aConfig` + `toWireSkill` (engine `SkillEntry`→wire, `as unknown as JobKindWire` per `enqueue.ts` precedent). `enabled` from `loadConfig().values.AGENT_A2A_ENABLED === true`; `tokens` from `enrollment.list()` (metadata only).
- **`src/server/a2a/skills.ts`** (new) — `handleA2aSkillsPut(req, deps, guard)`: trusted-local FIRST; parse; validate ALL refs via shared `refExistsFor` up front (all-or-nothing, no partial write) → 400 on unknown ref; then `allowlist.put` each; returns updated config.
- **`src/server/a2a/token.ts`** (new) — `handleA2aTokenIssue(req, deps, guard)` (201, token once) + `handleA2aTokenRevoke(id, req, deps, guard)` (200, idempotent). Both trusted-local FIRST.
- **`src/server/app.ts`** — routed all four (action `/token` before `:id`); GET config gated with `requireTrustedLocal` at the route (its handler takes no req/guard); mutating handlers gate internally (the `handleDeviceRevoke` precedent). Unwired `deps.a2a` degrades to 503 via `need`.
- **`tests/server/a2a-token-api.test.ts`** (new) — handler-level harness mirroring `devices/revoke.test.ts`.

### Deviation from brief
The brief's Produces block wrote `handleA2aTokenRevoke(id, deps, guard)`, which cannot run `requireTrustedLocal(req, ...)` without a `req`. Implemented as `handleA2aTokenRevoke(id, req, deps, guard)` — matching the working `handleDeviceRevoke(id, req, deps, guard)` precedent. No functional impact.

### Design choice
PUT skills pre-validates every entry's ref with `refExistsFor` (the exact least-privilege check `allowlist.put` runs internally) BEFORE writing any entry, so a single unknown ref rejects the whole request (400) with the persisted allowlist untouched — avoids a partial write that a naive "put-in-a-loop, catch throw" would leave. Full-array replace-semantics were NOT implemented (no diff/remove) — brief specifies "put per entry"; upsert-by-skillId only.

## TDD

### RED
`bun run test:file -- "tests/server/a2a-token-api.test.ts"`
→ `error: Cannot find module '../../src/server/a2a/config.ts'` — 0 pass, 1 fail (handlers absent).

### GREEN
After implementing handlers + DTOs + routes:
```
bun run test:file -- "tests/server/a2a-token-api.test.ts"
 5 pass  0 fail  21 expect() calls
```
Tests: (1) issue from non-loopback principal → 403, `enrollment.list()` unchanged (no token minted); (2) issue returns raw token once (201) + config `tokens[]` entry has `{id,label}` but no `token` prop and the raw secret appears nowhere in serialized config; (3) PUT unknown ref → 400, allowlist unchanged; (4) PUT from remote → 403, nothing persisted; (5) DELETE remote → 403 (id still present) then local → 200 (id gone).

### Gate (all green)
- `bun run typecheck` — clean.
- `bun run lint:file -- <6 files>` — Checked 6 files, no errors (fixed import-collapse + import-sort + line-wrap during the run).
- `bun run docs:check` — living docs present + linked; every src subsystem documented (`src/server/a2a` already documented; new files under existing subsystem).
- Regression: full a2a suite (auth, rpc-route, card-route, stream-route, token-api, contracts) — `30 pass, 0 fail`.

## Self-review — SECURITY lens
- **Trusted-local FIRST + zero-side-effect-on-reject in ALL mutating handlers.** `handleA2aTokenIssue`, `handleA2aTokenRevoke`, `handleA2aSkillsPut` each call `requireTrustedLocal(req, guard, deps.policy)` as the first statement, before parsing the body or touching any store. Tests assert the reject path mints/removes/persists nothing (`enrollment.list()` / `allowlist.list()` unchanged on 403). GET config is also gated (at the route, since its handler is req/guard-free).
- **Token returned exactly once, never in the config DTO.** `A2aTokenIssueResponseSchema` (`{id,token}`) is the only place `token` leaves; `enrollment.issue` returns it once and persists only `{id,label,createdAt,hash}`. `handleA2aConfig` sources tokens from `enrollment.list()` (metadata only) and `A2aConfigResponseSchema` has no `token` field. Test asserts the raw secret string is absent from the entire serialized config.
- **Unknown ref → 400 reusing the allowlist validation.** PUT reuses `refExistsFor` — the exact function `allowlist.put` calls internally — so there is no second, drift-prone validation path, and no "run anything" exposure can be persisted.
- **`:id` is opaque.** Revoke id flows only to `enrollment.revoke` (an array filter) — never the filesystem; a traversal-shaped id affects only its own (nonexistent) row (idempotent 200), same property as `handleDeviceRevoke`.

## Concerns
- None blocking. Minor: PUT is upsert-only (no removal of skills absent from the payload) per the brief; if the Federation tab expects true PUT-replace semantics, a follow-up would need to diff+remove. Flagging for Increment 7 wiring.

---

## Fix wave (§7.4 replace-semantics)

Two fixes applied on `slice-31-a2a-multimachine` (over commit `0c69a98`), closing the "PUT is upsert-only" concern flagged above.

### Fix 1 (Important) — `PUT /api/a2a/skills` REPLACES, not upserts
`handleA2aSkillsPut` (`src/server/a2a/skills.ts`) previously only `put` each payload entry, so a skill omitted from the desired set stayed exposed — an operator could not retract an exposure via the console (§7.4 silent over-exposure). Now, AFTER the all-refs-valid gate (unchanged), it computes the desired id set, `allowlist.remove(...)`s any currently-exposed skill absent from it, then upserts the desired entries. Ordering preserves the properties: trusted-local gate FIRST → schema parse → all-or-nothing ref validation (400 before any mutation) → remove-then-put → return updated config. A rejected request (bad ref / bad schema / non-loopback) removes nothing.

### Fix 2 (Minor) — bound the skills payload
`src/contracts/a2a.ts`: `A2aSkillsPutRequestSchema.skills` now `.max(100)`; `A2aSkillEntryWireSchema` fields bounded — `skillId`/`ref` `.max(128)`, `name` `.max(200)`, `description` `.max(2000)`. Cheap defense-in-depth; an over-cap PUT → schema reject → 400. Isomorphic contract stays valid (existing parses unaffected).

### RED → GREEN evidence
New tests added to `tests/server/a2a-token-api.test.ts`:
- REPLACE: seed A(`file_qa`)+B(`web_fetch`), PUT only A → 200, `allowlist.list()` and `GET /api/a2a/config` show ONLY A (B un-exposed).
- all-or-nothing: seed A+B, PUT [A, bad-ref C] → 400 and A+B intact (nothing removed).
- bound: PUT 101-entry array → 400, nothing persisted.

RED (before impl): `bun test tests/server/a2a-token-api.test.ts` → **6 pass / 2 fail** — REPLACE test saw `["B","A"]` (B not retracted); bound test got 200 instead of 400. (The all-or-nothing test already passed, since a bad ref rejects before any write.)

GREEN (after impl):
```
$ bun test tests/server/a2a-token-api.test.ts
 8 pass
 0 fail
 29 expect() calls
```

All 6 pre-existing Task-17 tests stay green. All-or-nothing property preserved (validate-all-refs-first → 400 before any remove/put).

### Gate
`bun run typecheck` clean · `bun run lint:file -- src/server/a2a/skills.ts src/contracts/a2a.ts tests/server/a2a-token-api.test.ts` clean · `bun run docs:check` clean.
