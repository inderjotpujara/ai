# Task 5 report: Wan checkpoint from opts.model

## Status
DONE

## Note on this file
This report overwrites a stale `task-5-report.md` left over from an earlier
slice's unrelated "MLX strategy + rewrite mlx-server.ts" task (same filename,
different slice/task numbering — that content is preserved in git history at
the commit before this one, and in `.superpowers/sdd/progress.md` if it was
ledgered there).

## What shipped

### `src/media/generate/comfy-lane.ts`
- `buildWanWorkflow` changed from a module-private `function` to an
  `export function`, making it directly testable.
- Before `return workflow;`, added a guarded block: when `opts.model` is set,
  adds `workflow['10'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: opts.model } }`.
  When `opts.model` is unset, no such node is added — existing behavior for
  callers that don't pass a model is unchanged. Kept the brief's comment
  noting this is shape-only pending live-verify against a real ComfyUI export
  (ComfyUI/Wan is not installed in this environment).

### `tests/media/wan-checkpoint.test.ts` (new)
Two tests, per the brief verbatim:
1. `adds a checkpoint loader from opts.model when set` — asserts the
   `CheckpointLoaderSimple` node's `inputs.ckpt_name` equals the passed
   `opts.model` value.
2. `omits the checkpoint loader when opts.model is unset` — asserts no node
   with `class_type === 'CheckpointLoaderSimple'` exists in the returned graph.

## TDD sequence (as run this session)
1. Wrote `tests/media/wan-checkpoint.test.ts` first.
2. Ran `bun run test:file -- "tests/media/wan-checkpoint.test.ts"` → **failed**
   as expected: `SyntaxError: Export named 'buildWanWorkflow' not found in
   module '.../src/media/generate/comfy-lane.ts'`.
3. Applied the two-part implementation change (export + guarded checkpoint
   node) to `comfy-lane.ts`.
4. Re-ran the same test → **2 pass, 0 fail, 2 expect() calls**.

## Checks (this session, branch `slice-28-hardware-adaptive-gen`)
- `bun run test:file -- "tests/media/wan-checkpoint.test.ts"` → 2 pass, 0 fail,
  2 expect() calls (both before and after the lint autofix pass).
- `bun run lint:file --write -- "src/media/generate/comfy-lane.ts" "tests/media/wan-checkpoint.test.ts"`
  → `biome check`, checked 2 files, fixed 1 (reformatted line wraps in the new
  test file only — no logic change).
- `bun run typecheck` → clean, no errors.
- Pre-commit hook (`bun run scripts/docs-check.ts`) passed on commit — no
  `docs/architecture.md` update was required since this is a small internal
  wiring change on an already-documented subsystem (`src/media`), not a new
  subsystem or a change to documented data flow.

## Commit
- `483a840` — `feat(media): Wan workflow takes checkpoint from opts.model (gen-fit injection)`
  on branch `slice-28-hardware-adaptive-gen`. Files: `src/media/generate/comfy-lane.ts`
  (modified), `tests/media/wan-checkpoint.test.ts` (new).

Only these two files were staged and committed. Other unstaged changes present
in the working tree at commit time (from other in-flight Slice 28 tasks/
sessions, e.g. `.superpowers/sdd/task-1..4-*`, `.remember/*`) were left
untouched.

## Concerns / follow-ups
- None blocking. As the brief and code comment both note, the exact
  `CheckpointLoaderSimple` node wiring (id `'10'`, input key `ckpt_name`) is
  shape-only and has not been exercised against a live ComfyUI server —
  correcting it against a real Wan workflow export is deferred to the
  Slice 27 Phase C live-verify gate (`MULTIMODAL_LIVE=1`), consistent with how
  the rest of `comfy-lane.ts` is already flagged.
- Worth a follow-up audit of `task-1..4-report.md` for similar cross-slice
  filename collisions, per the note already left in this same file by the
  prior task's session.
