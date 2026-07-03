## Task 8 report: docs (4 surfaces) + SDD ledger

Status: complete. Commit `94777a6` on branch `slice-17-agent-builder`.
`bun run docs:check` passes; `bun run typecheck` passes (unaffected, doc-only
diff). `bun test` was not run per the brief — authoritative count carried
forward as given: **459 tests / 136 files (457 pass, 2 skip, 0 fail)**.

Every claim below was checked directly against the Slice-17 source
(`agents/index.ts`, `agents/super.ts`, `src/agent-builder/{types,generate,
suggest-tools,validate,write,builder,deps}.ts`, `src/cli/agent-builder.ts`,
the `chat.ts` gap branch, `src/telemetry/spans.ts`'s `withAgentBuildSpan` +
`ATTR.BUILD_*`) before writing, not assumed from the task brief.

---

### 1. `docs/architecture.md`

**New §18 "Agent-builder (Slice 17)"** appended after §17 Glossary (~120
lines), covering:

- **The `agents/index.ts` registry** (Slice 17 prerequisite) — quotes the
  actual shape (`AgentFactory`, `AGENTS: Record<string, AgentFactory>`,
  `agentNames()`, the two marker comments) and states plainly:
  `createSuperAgent(toolsFor, onBeforeDelegate)` now builds its agent list by
  mapping `agentNames()` through `AGENTS[name](toolsFor(name))` — verified
  against the real `agents/super.ts`, not the old two-hardcoded-imports
  version.
- **Module map**, one bullet per file in `src/agent-builder/`: `types.ts`,
  `generate.ts` (quotes the `<need>…</need>` delimiter + "data not
  instructions" guard verbatim from the code), `suggest-tools.ts` (palette-only
  `Set`-membership filter, silently drops invented/duplicate names),
  `validate.ts` (the exact regex/RESERVED set), `write.ts` (atomic
  temp+rename, `JSON.stringify` escaping, the deep-clone-vs-shared-
  `STARTER_PACK` mutation defense, the `NAME_PATTERN` defense-in-depth
  re-check), `builder.ts` (invalid returns **before** consent — verified this
  ordering directly in `builder.ts`'s `if (issues.length > 0)` branch, which
  precedes `deps.confirm`), `deps.ts` (`resolveModel({role:'agent builder',
  requires:[Capability.Tools], prefer:LargestThatFits}, ...)` — same
  capability-declared selection every other agent gets, no bespoke model).
- **Two triggers**: `bun run agent-builder "<need>" [--yes|-y]` and the
  `chat.ts` TTY-gated offer on `{kind:'gap'}` — states non-TTY behavior is
  unchanged and that only the standalone CLI (not the chat offer) accepts
  `--yes`.
- **Safety model**: review-before-activate, palette-only tools, no
  same-run activation, no tool-code generation, no OAuth — each one line
  with the concrete mechanism backing it.
- **Telemetry**: `withAgentBuildSpan` opens `agent.build`, sets
  `ATTR.BUILD_NEED` up front, records `generated`/`suggested`/`validated`/
  `consent`/`written` as span events, and `BUILD_OUTCOME`/`BUILD_AGENT`/
  `BUILD_SERVERS` at the end — matches `spans.ts` lines 448-470 exactly.
- **Explicit "gap seam unchanged, only extended" note**: `{kind:'gap'}` +
  `ATTR.GAP_MISSING` are untouched; the TTY offer is a separate, additive
  span opened after that outcome is already recorded.
- **Deferred** bullet list (no same-run retry, no OAuth, no tool-code gen, no
  `*.live.test.ts` yet).

**Corrected two stale forward-references** in the pre-existing §14 (MCP)
section that I found while reading for accuracy — both said the agent-builder
was still a *future* consumer:
- "`This is Phase C's "integration library" and the palette Phase D's
  agent-builder will suggest from.`" → "`...the palette the Slice 17
  agent-builder suggests from (§18).`"
- "The pack as a Phase-D palette" paragraph rewritten: previously claimed
  `packByCapability(cap)` was "that lookup already in place, ahead of the
  agent-builder itself." I checked `suggest-tools.ts` directly — it does
  **not** call `packByCapability`; it maps the entire `STARTER_PACK` into a
  text palette (`name`/`description`/`capabilities`) and lets the model pick
  by name. Rewrote to say the Slice-17 agent-builder is now the consumer, but
  via that palette-presentation path, not via `packByCapability`, which
  remains an unused-but-available narrower lookup.

**Module map / Mermaid updates:**
- CLI subgraph: added `abcli["agent-builder.ts · bun run agent-builder"]`.
- AB subgraph: expanded from the Task-2 stub's 2 nodes (`abtypes`,
  `abvalidate`) to all 7 real files (`abtypes`, `abgenerate`, `absuggest`,
  `abvalidate`, `abwrite`, `abbuilder`, `abdeps`).
- DECL subgraph: `agents["agents/*"]` label → `agents["agents/index.ts ·
  AGENTS registry + agentNames() (Slice 17) + agents/*"]`.
- New edges: `abcli→abbuilder/abdeps`; `chat -. TTY gap-offer, optional
  .-> abbuilder/abdeps` (dotted, matching the existing `chat -. optional
  auto-detect .-> provisioner` convention); `abbuilder→{abgenerate,
  absuggest,abvalidate,abwrite,spans}`; `absuggest/abwrite→mcppack`;
  `abwrite→agents`; `abdeps→{buildreg,mgr,sel,reg,agents,mcppack,mcpconfig}`
  — each edge traced to a real import in the source file. Verified
  subgraph/`end` balance stays at 0 with a small Python check before and
  after editing (no dangling subgraph).
- Layer table: rewrote the **CLI** row (added the `agent-builder.ts` +
  gap-offer clause), the **Declarations** row (agents/index.ts is now a
  small registry, not pure data — corrected the "Knows about" column from
  "nothing (pure data)" to "nothing beyond the `Agent`/`AgentFactory` types"),
  and the **Agent-builder** row (was the Task-2 stub naming only
  `types.ts`/`validate.ts`; now names every module + both triggers + §18).
- §16 Testing strategy: new **Agent-builder** bullet naming all 6
  `tests/agent-builder/*.ts` files by what each asserts (I counted
  `test(`/`it(` occurrences per file directly: validate 7, generate 2,
  suggest-tools 4, write 11, builder 3, deps 1) and stating plainly that no
  `*.live.test.ts` exists yet for this subsystem.
- Glossary: added a 1-line **Agent-builder** entry pointing at §18.

### 2. `README.md`

- **Status line** rewritten to Slice-17-complete: states the
  generate→suggest→validate→consent→write pipeline, both triggers, and the
  three headline safety properties in the space the Slice-16 status block
  used to occupy (Slice 16's content folded into the "Also shipped" list).
- **Intro blockquote**: added Slice 17 to the "have landed" list; "Next" line
  changed from "Agent-builder → triggers is next" to "A crew/workflow builder
  + triggers are next" (agent-builder is no longer future work).
- **New feature paragraph** "Agent-builder (Slice 17, Phase D)" inserted
  after the Slice 16 paragraph — same length/density as the other
  slice paragraphs, quotes the prompt-injection delimiter, the
  registry markers, the deep-clone defense, the span/ATTR names, both
  triggers, and the full safety-model list, closing with a §18 link.
- **Slice table**: new row 17 (✅ Done) — "Agent-builder (Phase D) — generate
  a specialist on a capability gap" plus the mechanism/telemetry/safety
  summary the brief asked for.
- **Project-structure table**: added `src/agent-builder/` as a new row, added
  the `agent-builder.ts` CLI entry to the existing `src/cli/` row, and
  appended the `agents/index.ts` registry note to the existing `agents/` row.
- **Test count**: I read the entire README (all 282 lines) before editing —
  no test-count figure appears anywhere in it (the brief's "if a count is
  shown" was conditional on that; it isn't, so nothing to change there).

### 3. `docs/ROADMAP.md`

- **Gap table**: `Create-a-node / create-an-agent | agent-builder ⭐ | ❌ not
  built (seam in place)` → `✅ shipped (Slice 17)`.
- **Phase D table**: Agent-builder row flipped to `✅ shipped (Slice 17)` with
  the real mechanism (generate/suggest/validate/consent/write, §18 link).
  Added **two new rows**: "Crew/workflow builder (Slice 17 follow-on, next
  Phase-D slice)" and "Verified 'works out of the box' (Slice 17 follow-on)"
  — the latter names the three concrete pieces (execution dry-run,
  golden-eval, reuse/archive) the brief asked for.
- **Recommended sequence**: item 9 flipped to `✅ shipped, Slice 17` with
  detail matching the Phase-D table row. Added **item 9a** (crew/workflow
  builder) and **item 9b** (verified out-of-the-box), plus a **north-star
  callout** paragraph stating the D→E arc explicitly: "a user should be able
  to describe any need in chat...and have the system either run it now...or
  grow it, verify it, and then run it, entirely out of the box."
- **New "Slice 17 follow-ons" section** (mirrors the Slice-14/15 sections'
  style) with 8 bullets: crew/workflow builder, execution dry-run,
  per-agent golden-eval, reuse/archive, same-run-retry (deliberately
  deferred, not a bug), OAuth-gated suggestions (out of scope, matches
  Slice-15's own OAuth deferral), tool-code generation (out of scope), and
  the missing `*.live.test.ts`.
- **Gap-narrative paragraph** (top of "Where we are vs. the target"):
  corrected "Six more (Slices 8–13)" → "Nine more (Slices 8–16)" and folded
  in Slices 14/15/16 (previously described only up to 13 despite those
  slices already having shipped before this branch started — a
  pre-existing staleness I caught and fixed while auditing this section for
  accuracy), then added the Slice 17 sentence and softened the stale
  "3 agents" framing to "3 built-in agents...plus whatever the agent-builder
  has grown."
- **Phase-C palette sentence** (Starter-pack row + recommended-sequence item
  8): "gives the future agent-builder a queryable palette (`packByCapability`)
  to suggest from" → "gives the agent-builder a palette to suggest from" —
  same accuracy fix as the architecture.md `packByCapability` correction
  above, applied here too so the two docs don't contradict each other.

### 4. `.superpowers/sdd/progress.md`

Appended one **Task 8** ledger line (docs-only, no code) itemizing every
edit above per surface, and folded a **Slice 17 summary** into the same
line (what shipped, safety model, suite state as of Task 7 — 457 pass/2
skip/0 fail, 459 tests/136 files — noting Task 8 is docs-only so the count
is unaffected, and "NEXT" pointing at ROADMAP items 9a/9b pending a
whole-branch final review). Matches the existing ledger's one-line-per-entry,
dense-prose style (cf. the Slice 14/15/16 summary lines already in the
file).

---

### Concerns / things a reviewer should double-check

1. **`packByCapability` correction is a judgment call, not a hard fact I can
   fully verify without running the model.** I'm confident `suggest-tools.ts`
   as written doesn't call `packByCapability` (grep-verified — it isn't
   imported into that file), but I inferred the *intent* (palette-presented-
   as-text vs. a narrower keyed lookup) from reading the code, which seems
   the only reasonable reading.
2. **Mermaid edge accuracy**: I traced each new edge to a real import
   (`deps.ts`'s imports of `build-registry`, `model-manager`, `selector`,
   `runtime/registry`, `agents/index.ts`, `mcp/pack`, `mcp/config`), but I
   did not re-render the diagram in an actual Mermaid tool — only checked
   `subgraph`/`end` balance programmatically and read the surrounding syntax
   by eye. Worth a visual spot-check if the Artifact regen (owed to the
   controller, not done here per the brief) surfaces any rendering issue.
3. **Test counts inside the new docs prose are hand-counted** from grepping
   `test(`/`it(` per file in `tests/agent-builder/` (validate 7, generate 2,
   suggest-tools 4, write 11, builder 3, deps 1) — I deliberately did **not**
   put these raw counts into architecture.md's Testing-strategy bullet
   (named the files/roles instead) specifically because I didn't run the
   suite to confirm nested-describe counts match `bun test`'s own count; the
   §18 text and this report avoid asserting a per-file number as fact.
4. Per the brief, the **snapshot Artifact was not regenerated** — this is
   explicitly the controller's job. `docs/architecture.md` and `README.md`
   are left accurate as the Artifact's source material for whenever that
   regen happens.
5. This file (`task-8-report.md`) previously held a stale Slice-13 report
   ("Crew auto-insertion of grounded-verification sub-graph") — a leftover
   from that slice's own Task 8, since the numbering resets per slice. It has
   been overwritten with this Slice-17 Task-8 report as intended.

---

## Final-review fixes (2 hardening items)

**Status: DONE.** Two defects flagged in the Slice-17 final review, fixed
TDD-first.

### Fix 1 — escape the `<need>` delimiter (prompt-injection hardening)

`generate.ts` and `suggest-tools.ts` both interpolated the raw `need` string
into a `<need>${need}</need>` block described to the model as "data, not
instructions." A `need` containing a literal `</need>` could close the block
early and inject attacker-controlled instructions into the prompt.

Added `src/agent-builder/prompt.ts`:
```ts
export function delimitNeed(need: string): string {
  const safe = need.replace(/<\/?need>/gi, ' ');
  return `<need>${safe}</need>`;
}
```
Both `<need>` and `</need>` (case-insensitive) are neutralized to a space
before the real delimiters are applied, so no embedded tag — open or close,
any case — survives inside the block; exactly one real `<need>`/`</need>`
pair remains at the boundaries. `generate.ts` and `suggest-tools.ts` now both
import `delimitNeed` and call it in place of the raw template-literal
concatenation; the surrounding "data, not instructions" guard sentence is
unchanged and stays immediately before the block in both files.

**RED → GREEN:** wrote `tests/agent-builder/prompt.test.ts` first (5 cases:
plain text passthrough, embedded `</need>` neutralized to one trailing
delimiter, embedded `<need>` neutralized, mixed-case/repeated attempts, and
"ends with exactly one trailing `</need>`"). Confirmed it failed before
`prompt.ts` existed (module-not-found), then implemented `delimitNeed` and
the suite went green. `tests/agent-builder/generate.test.ts`'s existing
guard-ordering assertion (`data, not instructions` appears before the
`<need>` block) needed no change — `delimitNeed` preserves the need text's
position, only neutralizing embedded tags inside it.

### Fix 2 — check index markers before writing the agent file (no orphan file)

`write.ts`'s `writeAgent` wrote `agents/<name>.ts` first, then
`registerInIndex` checked for the `AGENT-BUILDER:IMPORTS`/`:ENTRIES` markers
and threw if either was absent — leaving a written-but-unregistered orphan
agent file on disk.

Extracted the marker check into `assertIndexMarkers(indexPath)`, called at
the top of `writeAgent` (after the existing snake_case name-pattern guard,
before any `atomicWrite`). It throws the same `agents/index.ts is missing
the AGENT-BUILDER markers` error the code always threw, so no file is
written when the index can't be registered. `registerInIndex` now takes the
already-read `idx` string as a parameter instead of re-reading the file and
re-checking the markers itself — one check, no double-throw.

**RED → GREEN:** extended the existing "throws if agents/index.ts is missing
the AGENT-BUILDER markers" test in `tests/agent-builder/write.test.ts` is
left untouched (still passes — same error message), and added a new test
`'does not write an orphan agent file when markers are missing (checks index
BEFORE writing)'` that sets an unmarked index, asserts `writeAgent` throws,
then asserts `existsSync(join(paths.agentsDir, 'pdf_qa.ts'))` is `false`.
Confirmed this new assertion would have failed against the pre-fix
write-then-check ordering (the file existed on disk after the throw), then
applied the reorder and it went green.

### Gate results
- `bun test tests/agent-builder/` — **32 pass, 0 fail, 57 expect() calls,
  across 7 files** (was 6 files/≈27 tests before the 2 new ones —
  `prompt.test.ts` is new, `write.test.ts` gained one orphan-file test).
- `bun run typecheck` — clean (`tsc --noEmit`, no errors).
- `bun run lint:file -- "src/agent-builder/prompt.ts"
  "src/agent-builder/generate.ts" "src/agent-builder/suggest-tools.ts"
  "src/agent-builder/write.ts" "tests/agent-builder/prompt.test.ts"
  "tests/agent-builder/write.test.ts"` — clean (biome, 6 files, no fixes
  applied).
- Full `bun test` run to confirm no cross-suite regression (see commit for
  the exact pass/fail/skip counts recorded at commit time).

### Concerns
- Zero new deps, no behavior change to generated prompt wording beyond the
  delimiter-escaping itself — verified by reading the full diff of both
  prompt-builder files line by line.
- `noUncheckedIndexedAccess` unaffected — `delimitNeed` and
  `assertIndexMarkers` don't touch indexed access at all.
