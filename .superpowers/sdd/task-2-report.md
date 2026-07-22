# Task 2 Report: Config knobs + telemetry ATTR keys + a2a spans (+ `src/a2a/` docs stub)

Slice 31 (A2A interop), Increment 1. Branch `slice-31-a2a-multimachine`. Commit `6a55598` — "feat(a2a): config knobs + telemetry ATTR keys + a2a spans (+ src/a2a docs stub)".

(Note: this report file previously held stale content from an earlier slice's unrelated "Task 2" — trigger wire enums/parity tests. It has been overwritten with this task's actual report.)

## What was implemented

1. **`src/config/schema.ts`** — appended a new "A2A interop (Slice 31)" group to `CONFIG_SPEC` right after the `AGENT_TRIGGERS_ENABLED` entry (was `schema.ts:618`), five entries, each `{env, kind, def, doc}` per the existing shape:
   - `AGENT_A2A_ENABLED` (boolean, `false`)
   - `AGENT_A2A_CARD_TTL` (number, `300`)
   - `AGENT_A2A_REPLAY_WINDOW_MS` (number, `300_000`)
   - `AGENT_A2A_SKILLS_PATH` (string, `'a2a-skills.json'`)
   - `AGENT_A2A_REMOTES_PATH` (string, `'~/.config/ai/a2a-remotes.json'`)

   `doc` text transcribed verbatim from the brief (each names its future read site, per the no-hardcode/documented-contract convention this module follows).

2. **`src/telemetry/spans.ts`** — added five `A2A_*` keys to the `ATTR` map, placed right after the Slice-25 `TRIGGER_*` block, with a comment calling out the peer-host-only privacy rule:
   - `A2A_METHOD: 'a2a.method'`
   - `A2A_SKILL_ID: 'a2a.skill.id'`
   - `A2A_TASK_STATE: 'a2a.task.state'`
   - `A2A_PEER_HOST: 'a2a.peer.host'`
   - `A2A_OUTCOME: 'a2a.outcome'`

3. **`src/a2a/spans.ts`** (new) — mirrors `src/daemon/spans.ts`'s idiom exactly: `const tracer = () => trace.getTracer('agent')`, reuses `inSpan`/`ATTR` from `telemetry/spans.ts` (no parallel span-emission path). Four helpers per the Produces block:
   - `recordA2aCard(info: { cacheHit: boolean }): void` — one-shot `startSpan('a2a.server.card')...end()`. Sets an inline `'a2a.card.cache_hit'` attribute (not one of the 5 mandated `ATTR` keys — the brief's ATTR list doesn't include a cache-hit key, so I followed existing codebase precedent of inline literal attribute strings for one-off, non-shared attrs, e.g. `'memory.source'`/`'memory.chunks'` in `telemetry/spans.ts`, rather than inventing a new shared `ATTR` entry beyond the five specified).
   - `withA2aServerTaskSpan<T>(info, fn)` — root span `a2a.server.task` via `inSpan`; sets `A2A_METHOD`/`A2A_SKILL_ID` up front; `fn`'s recorder sets `A2A_TASK_STATE` (via `rec.taskState`) and `A2A_OUTCOME` (via `rec.outcome`).
   - `recordA2aClientDiscover(info: { peerHost: string; outcome: string }): void` — one-shot `a2a.client.discover` span, sets `A2A_PEER_HOST` + `A2A_OUTCOME`.
   - `recordA2aClientInvoke(info: { peerHost: string; method: A2aMethod; taskState?: TaskStateWire }): void` — one-shot `a2a.client.invoke` span, sets `A2A_PEER_HOST` + `A2A_METHOD` + optional `A2A_TASK_STATE`.

   Peer-host-only rule: none of these helpers accept or construct a URL — the parameter type is `peerHost: string`, forcing whatever calls them later (the CONSUME-side `a2a/remotes.ts` work in a later task) to have already extracted the host before calling. No URL-parsing/redaction logic lives in this module because it never touches a URL value at all.

4. **`docs/architecture.md`** — landed the mandatory `src/a2a/` docs stub verbatim from the brief, placed at the `---` separator immediately before the `## 24. Always-on daemon...` heading (satisfies "near the §24 Queue/Daemon section" without splitting the existing module-map table, whose Queue/Daemon rows already reference "§24" for their full narrative).

## TDD evidence

**RED** (before implementation):
```
$ bun run test -- -t "A2A knobs"
error: expect(received).toBe(expected)
Expected: false
Received: undefined
(fail) A2A knobs carry conventional defaults [0.82ms]

(same run, second file)
error: Cannot find module '../../src/a2a/spans.ts' from '/Users/inderjotsingh/ai/tests/a2a/spans.test.ts'
0 pass / 31 skip / 2 fail / 1 error
```

**GREEN** (after implementation):
```
$ bun run test -- -t "A2A knobs"
1 pass, 31 skip, 0 fail, 5 expect() calls

$ bun run test -- -t "a2a span helpers"
1 pass, 31 skip, 0 fail, 1 expect() calls
```

## Gate

```
$ bun run typecheck
$ tsc --noEmit   → clean, no output

$ bun run lint:file -- src/config/schema.ts src/telemetry/spans.ts src/a2a/spans.ts tests/config/a2a-knobs.test.ts tests/a2a/spans.test.ts
Checked 5 files in 16ms. No fixes applied.   (after fixing one quote-style + one import-order finding biome caught on first pass)

$ bun run docs:check
✔ docs-check: living docs present + linked; every src subsystem documented.
```

All three gate commands pass.

## Files changed

- `src/config/schema.ts` — +5 `CONFIG_SPEC` entries
- `src/telemetry/spans.ts` — +5 `ATTR` keys
- `src/a2a/spans.ts` (new) — 4 span helpers
- `docs/architecture.md` — `src/a2a/` docs stub (+14 lines)
- `tests/config/a2a-knobs.test.ts` (new)
- `tests/a2a/spans.test.ts` (new)

## Self-review vs Produces block (completeness / YAGNI)

- All 5 config knobs present, correct kind/def, doc text matches brief verbatim. ✓
- All 5 ATTR keys present, correct string values. ✓
- All 4 span helpers present with the exact signatures specified. ✓
- No extra knobs, ATTR keys, or helpers added beyond what the brief specifies — confirmed no scope creep (e.g. did not add a card-cache-hit `ATTR` entry; did not add any URL-parsing helper — `a2a/spans.ts` doesn't need one yet).
- Peer-host-only rule: verified structurally — every helper signature takes `peerHost: string`, never a URL type; nothing in this file constructs, logs, or truncates a URL.
- No-op-without-tracer: the test asserts this behaviorally (`recordA2aCard` must not throw with no global tracer provider registered in the test env, and `withA2aServerTaskSpan` resolves normally returning `7`). Structurally this holds because every helper routes exclusively through `inSpan`/`tracer().startSpan()`, exactly like `daemon/spans.ts`, and OTel's default (no-provider) tracer returns a non-recording span whose methods are safe no-ops.
- Docs stub is a verbatim copy of the brief's markdown, so its future "full narrative" replacement (Task 29) is unambiguous.
- Test hygiene: both test files match the brief's exact test bodies (only change: reordered the two import lines in `tests/a2a/spans.test.ts` to satisfy biome's `organizeImports` rule — no semantic change).

## Concerns

- Minor: `recordA2aCard`'s `cacheHit` is recorded via an inline attribute string (`'a2a.card.cache_hit'`) rather than a shared `ATTR` constant, since the brief's ATTR list doesn't include one for it. This is consistent with existing precedent elsewhere in `telemetry/spans.ts` (e.g. `'memory.source'`, `'memory.chunks'`) but is worth a glance in the whole-slice docs task (Task 29) in case a shared key is wanted once `server/a2a/card.ts` actually calls this helper.
- This task only lands the seam (config + ATTR + span helpers + docs stub) — no consumer wiring (`server/a2a/*`, `a2a/card.ts`, `a2a/remotes.ts`, `a2a/allowlist.ts`, `a2a/enroll.ts`) exists yet; that's explicitly out of scope per the brief and is later increment/task work.
- Pre-existing unstaged changes in `.remember/`, `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-1-*` and an untracked `AGENTS.md` were present in the working tree before I started and were deliberately left out of this commit (not part of Task 2's scope) — flagging so the controller doesn't mistake them for something this task should have picked up.
