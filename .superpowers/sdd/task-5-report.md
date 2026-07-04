# Task 5 report — think-first `analyze` stage + `BuilderModel.text` seam

## Status: DONE

Commit: `dad069d` — `feat(crew-builder): think-first analyze stage + BuilderModel.text seam`

## What was implemented

1. **`src/agent-builder/types.ts`** — extended `BuilderModel` (additive) with a
   required `text: (args: { prompt: string }) => Promise<string>` seam,
   alongside the existing `object`. Doc comment explains it's for think-first
   stages that must not be JSON-constrained.

2. **`src/agent-builder/deps.ts`** — `makeBuilderModel` now returns a `text`
   implementation that mirrors `.object`'s `generateTextImpl` call exactly
   (same `model`, same conditional `providerOptions` spread) and returns
   `r.text` directly, with no JSON extraction/parsing/retry — appropriate
   since this seam is explicitly free-text.

3. **`src/crew-builder/analyze.ts`** (new) — `analyzeNeed(need, shape, model):
   Promise<string>`. Builds a prompt instructing the model to think step by
   step in prose (crew: roles + goals + ordered tasks; workflow: pipeline
   steps/order/branches/fan-out), explicitly says "Do NOT output JSON," wraps
   `need` via `delimitNeed` (prompt-injection hardening, consistent with every
   other agent-builder/crew-builder prompt), calls `model.text(...)`, and
   returns the trimmed result.

## TDD RED -> GREEN

- **RED**: `tests/crew-builder/analyze.test.ts` written first, importing the
  not-yet-existing `analyze.ts` -> `bun test tests/crew-builder/analyze.test.ts`
  failed with `Cannot find module '../../src/crew-builder/analyze.ts'`.
- **GREEN**: after implementing `analyze.ts`, both tests pass:
  - "returns the model plaintext decomposition" — asserts the model's text
    output flows through.
  - "does not ask for JSON and delimits the need as data" — asserts the
    prompt contains `Do NOT output JSON`, `<need>`, the injected string, and
    that the "data, not instructions" guard note precedes the injected text
    (mirrors the injection-guard test pattern used in `generate.test.ts` /
    `generate-tool.test.ts`).

## Broken fakes fixed (added `text: async () => ''` or equivalent stub)

- `tests/crew-builder/classify.test.ts` — `fakeModel` helper.
- `tests/agent-builder/generate.test.ts` — `stubModel` helper.
- `tests/agent-builder/generate-tool.test.ts` — `stubModel` helper.
- `tests/agent-builder/suggest-tools.test.ts` — `pick` helper.
- `tests/agent-builder/builder.test.ts` — 5 inline `BuilderModel` literals:
  `twoStepModel`, `countingDraftModel`, `toolModel`, `countingToolModel`, and
  the ad-hoc literal in the "injection guard" `buildTool` test.
- `tests/agent-builder/deps.test.ts` — **not actually broken**: it exercises
  `makeBuilderModel` itself and never constructs a bare `BuilderModel`
  literal; its shared `fakeGenerateText` fixtures already return the
  `{ text: string }` shape both `.object` and `.text` consume, so `.text`
  worked automatically. Added one new test,
  `'text() returns the raw generateText output, unparsed'`, to give the new
  seam explicit direct coverage rather than leaving it implicitly exercised.

## Test output

```
$ bun test tests/agent-builder/ tests/crew-builder/
bun test v1.3.11 (af24e281)

 73 pass
 0 fail
 140 expect() calls
Ran 73 tests across 14 files. [159.00ms]
```

## Typecheck / lint

- `bun run typecheck` -> clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- src/agent-builder/types.ts src/agent-builder/deps.ts
  src/crew-builder/analyze.ts tests/crew-builder/analyze.test.ts
  tests/crew-builder/classify.test.ts tests/agent-builder/generate.test.ts
  tests/agent-builder/generate-tool.test.ts
  tests/agent-builder/suggest-tools.test.ts tests/agent-builder/builder.test.ts
  tests/agent-builder/deps.test.ts` -> `Checked 10 files. No fixes applied.`

## Files changed (commit `dad069d`)

```
 src/agent-builder/deps.ts                 |  8 ++++++++
 src/agent-builder/types.ts                |  2 ++
 src/crew-builder/analyze.ts               | 24 ++++++++++++++++++++++++ (new)
 tests/agent-builder/builder.test.ts       |  6 +++++-
 tests/agent-builder/deps.test.ts          | 11 +++++++++++
 tests/agent-builder/generate-tool.test.ts |  1 +
 tests/agent-builder/generate.test.ts      |  1 +
 tests/agent-builder/suggest-tools.test.ts |  1 +
 tests/crew-builder/analyze.test.ts        | 31 +++++++++++++++++++++++++++++++ (new)
 tests/crew-builder/classify.test.ts       |  1 +
 10 files changed, 85 insertions(+), 1 deletion(-)
```

## Self-review

- `.text`'s implementation is a byte-for-byte mirror of `.object`'s
  `generateTextImpl` call site (same `model`, same conditional
  `providerOptions` spread) — no drift between the two seams' model-invocation
  contract.
- `analyzeNeed` follows the exact prompt-injection pattern used everywhere
  else in `agent-builder`/`crew-builder` (`delimitNeed` + "data, not
  instructions" guard note before the delimited block), so the new
  think-first stage doesn't introduce a weaker injection posture than
  `generateProposal`/`generateToolProposal`/`classifyNeed`.
- Every existing inline `BuilderModel` fake across both test directories was
  grepped for (`grep -n "BuilderModel\|object:"`) and fixed; none left with
  only `{ object }`. Verified via a full green run of the target test
  directories after the fixes (73/73 pass), not just the newly-touched files.
- `analyzeNeed`'s two tests together exercise both the `'crew'` and
  `'workflow'` shape branches (one test per shape), so branch coverage
  exists, though neither test asserts the shape-specific bullet-text content
  verbatim — acceptable since the brief's Step 1 test didn't ask for that
  granularity and `analyzeNeed`'s output is consumed as opaque prose context
  by later stages, not parsed.

## Concerns

- None blocking. `analyzeNeed`'s output isn't consumed by any other stage yet
  in this slice — per the brief it exists now purely as the think-first
  infrastructure; wiring it into the pipeline is presumably a later task.
