# Task 5 report — `mapRunToDto` (src/run/run-dto.ts) — Slice 30b Phase 3

**Status:** DONE
**Commit:** `971179a` — `feat(run): mapRunToDto — flatten spans/degrades/artifacts into a validated RunDTO`
**Branch:** `slice-30b-phase3-runs`
**Tests:** `bun test tests/run/run-dto.test.ts` → 9 pass / 0 fail / 41 expect() calls.
**Gate:** `bun run typecheck` clean; `bun run lint:file` clean (after biome auto-format).

## What shipped

- `src/run/run-dto.ts` — `mapRunToDto(runsRoot, id): Promise<RunDTO | undefined>` plus the shared
  `readDegrades(runDir): Promise<DegradeDTO[]>` helper. `summarizeRunListItem` + the mtime summary
  cache are **not** here — those are Task 6, as instructed.
- `tests/run/run-dto.test.ts` — 9 tests off fabricated tmp-dir run fixtures.

## Interfaces consumed (all verified against real source, not assumed)

- `readSpans` / `buildTree` / `type TraceNode` from `./run-trace.ts` — reused, not reimplemented.
  `buildTree` sorts roots ascending by `startUnixNano`, so `tree[0]` is the earliest root.
- `type SpanRecord` from `../telemetry/jsonl-exporter.ts` — confirmed `startUnixNano`/`endUnixNano`
  are µs×1000 (ordering only); `durationMs` is exact ms. Events carry `timeUnixNano`.
- `ATTR` from `../telemetry/spans.ts` — verified every key used: `OUTCOME`(`agent.outcome`),
  `CONTENT_POLICY`(`content.policy`), `DELEGATION_TARGET`/`DELEGATION_DEPTH`/`DELEGATION_ANCESTORS`,
  `MODEL_ID`(`gen_ai.request.model`)/`MODEL_PROVIDER`/`MODEL_NUM_CTX`/`MODEL_FOOTPRINT_BYTES`/
  `MODEL_RUNTIME_DEGRADED`, `USAGE_INPUT_TOKENS`/`USAGE_OUTPUT_TOKENS`. The per-span degrade event
  name is `reliability.degrade` (confirmed in `recordDegrade`).
- `type DegradeEvent` from `../reliability/ledger.ts` — `{kind, subject, reason, detail?, from?, to?,
  attempts?, lane?}`. No `spanId` on disk → `DegradeDTO.spanId` left unset.
- `readRunArtifacts` from `./artifacts.ts` (Task 4) — wired directly into `RunDTO.artifacts`.
- Contracts from `../contracts/index.ts`: `RunDtoSchema`, `SpanStatus`, `RunLifecycle`, `RunOrigin`,
  `DegradeKind`, `DegradeDTO`, `RunDTO`, `SpanDTO`. Output validated through `RunDtoSchema.parse`
  before return (a test asserts the parse does not throw).

## Correctness rules implemented + hand-verified against fixtures

- **offsetMs** = `(span.startUnixNano - rootStartUnixNano) / 1e6`, `rootStartUnixNano =
  tree[0].span.startUnixNano` (earliest root). Fixture run-1: child start `1_010_000_000`, root
  `1_000_000_000` → offset `10`. Root offset `0`. ✓
- **startMs** = `round(rootStartUnixNano / 1e6)`. run-1 → `1000`. ✓ (based on earliest root, per spec —
  distinct from `durationMs`, which comes from the `agent.run` span.)
- **depth** — root 0, child parent+1, assigned during a depth-first flatten in tree/offset order. ✓
- **status** — `code === 2 → SpanStatus.Error` else `Ok` (OTel ERROR===2); `statusMessage` from
  `span.status.message`. ✓
- **tokens (per span)** — from `USAGE_*` when either present, else omitted (most spans carry none).
  **run tokens** = sum of per-span input/output; `undefined` when no span carried any. run-7 → `{13,12}`. ✓
- **lifecycle** — `Running` when no `agent.run` span exists yet (BatchSpanProcessor exports on end,
  so an in-flight root is simply absent); else `Failed` when root `status.code===2` OR
  `outcome==='resource'`; else `Done`. Only Running/Done/Failed emitted. All three branches tested,
  plus the `outcome=resource on a non-error root` case (run-2b) which must still be Failed. ✓
- **models** = distinct `MODEL_ID` across spans; **roots** = tree roots' span ids;
  **degraded** = `degrades.length > 0` (run-level) and per-span `reliability.degrade` event presence.
- **origin** = `RunOrigin.Manual`, **owner** = `'local'` (reserved constants). **malformedSpans** from
  `readSpans`; **spanCount** = `spans.length`. **undefined** when the run dir has no spans. `node` omitted.

## Test cases

1. Clean run — offsets/depth/tokens-sum/startMs/durationMs/roots/Done lifecycle + `RunDtoSchema.parse`.
2. Error root (`code:2`) → Failed + span status Error + statusMessage.
3. `outcome=resource` on a non-error root → still Failed (span status stays Ok).
4. In-flight run (no `agent.run`) → Running; delegation projection (agent + `depth`/`ancestors` split on ` → `).
5. Degrades from `degradation.jsonl` → `degraded=true`, label populated, `spanId` unset.
6. Per-span `reliability.degrade` event → `span.degraded=true`, event offset projected.
7. No spans → `undefined`; malformed line counted (`malformedSpans=1`, `spanCount=1`).
8. Artifacts wired in from the run dir (`answer.txt` + `spans.jsonl`).
9. Multi-gen token roll-up (`{13,12}`), distinct models `[m1,m2]`, token-less span omits tokens.

## Correctness subtleties resolved

- **`startMs` vs `durationMs` base differ by design.** `startMs`/`offsetMs` are anchored on the
  *earliest root* (`tree[0]`), while `durationMs` and `outcome`/`contentPolicy` come from the
  `agent.run` span specifically. This matches the brief and is intentional.
- **DegradeKind string identity.** On-disk `kind` is the string value (e.g. `'tool_skipped'`), which
  is exactly the `DegradeKind` enum value, so `DEGRADE_LABEL[e.kind]` indexes correctly; a `?? e.kind`
  fallback tolerates any unknown kind without throwing. The contract's `DegradeKind` is a wire mirror
  with identical values (guarded by `degrade-kind-parity.test.ts`).
- **`spanId` on degrades left unset** — not persisted to `degradation.jsonl`; `DegradeDTO.spanId` is
  optional and omitted. Asserted in test 5.
- **Extracted a `bool()` helper** (vs the brief's inline `typeof === 'boolean'` ternary) for
  `runtimeDegraded` — same behavior, matches the `str`/`num` helper style.
- **`noUncheckedIndexedAccess`** — the only raw index is `tree[0]?.span.startUnixNano ?? 0`; all other
  span iteration is via `for...of`/`.map`, so no unguarded array access.

## Concerns

None. All requirements met; no correctness ambiguity remained unresolved.

---

## Adversarial-verification fixes (appended)

Two verified findings in `src/run/run-dto.ts` fixed at high reasoning effort.

### FIX 1 (Important) — crew/workflow runs mapped to lifecycle=Running forever
The mapper derived the run root as `spans.find(s => s.name === 'agent.run')`. Crew
runs (`crew.run`) and workflow runs (`workflow.run`) have no `agent.run` span, so
`runRoot` was `undefined` → lifecycle perpetually `Running`, `outcome='unknown'`,
`durationMs=0` for any finished crew/workflow run.

Fix — made the run root generic:
- Added `RUN_ROOT_NAMES = {agent.run, crew.run, workflow.run}`.
- The run root is now the earliest top-level root `tree[0]` (already anchors
  `startMs`/offsets). `runRootPresent = tree[0] exists && its name ∈ RUN_ROOT_NAMES`.
  Because a run's root span is exported only when it ends, an earliest root whose
  name is NOT a run-root name means the root hasn't flushed yet → still in-flight
  (this is the name-agnostic "no recorded end" check).
- `outcome`/`contentPolicy` read from whichever top-level root carries `ATTR.OUTCOME`
  (fall back to earliest root) — name-agnostic across all three root kinds.
- Lifecycle rule preserved: `Running` if no run root present; else `Failed` if
  run-root status is error OR `outcome === 'resource'`; else `Done`. `durationMs`
  is the run root's duration when present, else 0.
- `resource`→Failed / `gap`→Done decisions untouched (out of scope).
- Regression: for `agent.run`-rooted runs `tree[0]` IS the `agent.run` span, so
  behavior is identical — all 9 original tests stay green.

Note: the crew/workflow engines don't currently call `setRunOutcome`, so real
`crew.run`/`workflow.run` spans may not carry `agent.outcome` yet. The core fix
still lands: a finished crew/workflow run is now `Done` (not stuck `Running`) with
its real `durationMs`; `outcome` falls back to `'unknown'` if the attr is absent.
Wiring crew/workflow outcome emission is a separate engine concern, out of scope
for this mapper fix.

### FIX 2 (robustness) — schema-invalid degrade line crashed the whole run map
`readDegrades` only caught JSON syntax errors. A line that is valid JSON but fails
`DegradeDtoSchema` (unknown `kind`, missing `reason`/`subject`, wrong-typed
`attempts`) was pushed into `RunDTO.degrades`, and the terminal
`RunDtoSchema.parse(dto)` then threw → one bad line made the entire run unviewable.

Fix — each mapped `DegradeDTO` is now run through `DegradeDtoSchema.safeParse`;
only `success` entries are pushed, non-conforming lines are silently skipped.
The existing torn-JSON `try/catch` is kept. Guarantee: `mapRunToDto` never throws
on degrade-line content, and `RunDTO.degrades` contains only schema-valid entries.

### Tests added (`tests/run/run-dto.test.ts`)
- `completed crew.run root (no agent.run) → Done, non-zero duration, outcome`
- `completed workflow.run root → Done, non-zero duration, outcome`
- `crew.run root with resource outcome → Failed lifecycle`
- `in-flight crew/workflow run (no recorded run-root span yet) → Running`
- `schema-invalid degrade line is skipped; run still maps + validates`

### Gate
- `bun run typecheck` — clean (noUncheckedIndexedAccess).
- `bun run lint:file` on both files — clean (Biome format applied to the test).
- `bun test tests/run/run-dto.test.ts` — **14 pass / 0 fail** (9 original + 5 new).

### Judgment calls
- Anchored the run root on `tree[0]` (earliest top-level root) rather than a
  `spans.find(name)`: robust against a nested `crew.run` inside an `agent.run`
  (the outer root wins) and keeps `agent.run` behavior byte-identical.
- `durationMs` stays 0 for in-flight runs (matches the existing in-flight test)
  rather than reporting the earliest child's partial duration.
