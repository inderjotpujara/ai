# Slice 28 — Hardware-adaptive media generation + reachable gen degrade

**Date:** 2026-07-06
**Branch:** `slice-28-hardware-adaptive-gen`
**Status:** design approved (brainstorm), pre-plan
**Closes:** the two Slice-27 multimodal-generation follow-ons.

## Problem

Slice 27 shipped media generation (`generate_image`/`generate_speech`/
`generate_video` tools on the `media_creator` specialist), but two gaps were
disclosed and deferred:

1. **Generation model choice is not hardware-adaptive.** Each gen strategy
   picks its model by `opts.model ?? AGENT_*_MODEL env ?? hardcoded default` —
   there is no fit-ranking. The `Capability.{ImageGen,SpeechGen,VideoGen}` enum
   values added in Slice 27 are placeholders: no `ModelDeclaration` carries
   them and no code consumes them. The user's directive is that generation
   models be **prescribed by the same dynamic hardware-fit logic as inference**
   (largest-that-fits), so a small model is auto-chosen on this box and a bigger
   one on a higher-end box, with zero hardcode.

2. **`runGenJob`'s degrade is unreachable.** `createGenerateTools` calls
   `runOneShotJob` directly against a fixed strategy. The `runGenJob` dispatcher
   (one-shot↔server degrade with `DegradeKind.ModelDegraded`) and the
   `wanComfyStrategy` server lane are fully implemented but dead code — nothing
   imports `runGenJob`.

## Key constraint — the gen-fit impedance mismatch

The hardware-fit selector's **ranking** half is capability-agnostic
(`selector.ts` `hasAll`/`selectCandidates` treat `Capability` as opaque
strings), so a `Capability.ImageGen` declaration *would* filter and rank. But
its **resolution** half is hard-wired to "warm the model in a `Runtime` →
return an AI-SDK `LanguageModel`" (`resolveModel` → `ensureReady`;
`select-hook.ts` → `runtimeFor(decl.runtime)` → `rt.createModel(decl)`).

Media-gen has **no runtime and no `LanguageModel`** — a gen strategy spawns a
Python CLI (`runOneShotJob`) that writes a **file**. Four gaps block riding the
main selector: no `RuntimeKind` for a gen engine; `createModel` must return a
`LanguageModel` (gen can't); `RuntimeControl` (warm/unload/getModelMax/
listLoaded) is meaningless for a fire-and-forget subprocess; `ensureReady`
cannot size gen weights. The current design deliberately routes `media_creator`
through `Capability.Tools` (a chat model calls gen *tools*) to sidestep this.

**Decision (approved):** do **not** unify into the main selector. Build a
**parallel gen-fit path** that respects the CLI-spawn reality and reuses only
the footprint→budget ranking core, feeding the chosen model repo in through the
existing `GenOpts.model` seam.

## Design

### 1. Gen candidate catalog — `src/media/generate/catalog.ts`

A new `GenModelCandidate` type (intentionally **not** a `ModelDeclaration`):

```ts
type GenModelCandidate = {
  kind: MediaKind;                 // Image | Audio | Video
  repo: string;                    // e.g. 'dhairyashil/FLUX.1-schnell-mflux-4bit'
  engine: GenEngine;               // mflux | mlx-audio | mlx-video | comfy-wan
  venv: MediaVenv;                 // Media | Video
  execMode: ExecMode;              // OneShot | Server
  footprint: { approxParamsBillions: number; bytesPerWeight: number };
  contentPolicy?: ContentPolicy;   // absent = Default
  label: string;
};
```

Seeded ladders per kind (**footprints/repos web-validated before locking** —
`prefers-latest-methodology`):

- **Image:** `FLUX.1-schnell-mflux-4bit` (small, ungated) → optional larger
  SDXL / FLUX-dev tier.
- **Speech:** `Kokoro-82M-bf16` (tiny) → optional cloning-capable tier (behind
  the existing clone-consent gate).
- **Video (ladder, degrades gracefully):** LTX `2B`/distilled → Wan2.2
  `TI2V-5B` → full `LTX-2 19B`.

### 2. Gen-fit selector — `src/media/generate/select.ts`

`selectGenModel(kind, deps) → GenModelCandidate | undefined`:

- **Env pin is authoritative.** If `AGENT_{IMAGE,VOICE,VIDEO}_MODEL` is set,
  return a candidate built from it and skip ranking. Precedence: explicit env
  pin > auto-fit > hardcoded default (consistent with "env fallback-only" and
  the main selector's philosophy — the pin is the manual override).
- Else filter the catalog by `kind` + uncensored eligibility (reuse `policy.ts`
  `uncensoredEnabled`/`isUncensoredModel`), then rank **largest-that-fits** by
  footprint against the **live hardware budget** (`resource/hardware.ts`
  `liveBudgetBytes`/`fitsBudget`). Extract a shared footprint-ranking helper if
  `provisioning/fitAndRank` is too provisioning-coupled to reuse directly.
- **No candidate fits** → return `undefined`. The caller degrades: a clear
  message (*"largest video candidate `<repo>` needs `<X>`, budget is `<Y>` —
  set `AGENT_VIDEO_MODEL` or use a bigger box"*), `DegradeKind.ModelDegraded`
  on the ledger, and the tool returns a graceful text result — **never
  crashes**.
- **Consent-before-pull** (`feedback-consent-before-model-pull`): if the
  best-fit candidate is not installed, prescribe + consent-gate the download;
  on decline, degrade to the next-installed candidate or skip.

### 3. Injection seam

`createGenerateTools`' `execute` calls `selectGenModel(kind)` and sets
`opts.model = candidate.repo` (and the candidate's `venv`/`cmd` where
relevant). Because `opts.model` already wins the `opts.model ?? env ?? default`
precedence inside each `buildOneShot`:

- **Image / speech:** zero strategy change.
- **Video:** `ltxStrategy.buildOneShot` must be taught to emit `--model` from
  `opts.model` (LTX repo is baked today), and `wanComfyStrategy`'s workflow
  graph must take its checkpoint from `opts.model`.

### 4. Wire `runGenJob` — `src/media/generate/tools.ts`

Replace the three `runOneShotJob` calls with `runGenJob`:

- **Video:** pass `deps.fallback = wanComfyStrategy` (same `MediaKind.Video`,
  opposite `ExecMode`) + a real `serverReachable` probe (ComfyUI
  `/system_stats`). One-shot LTX degrades to server Wan when the LTX binary is
  absent; server Wan degrades to one-shot LTX when ComfyUI is unreachable.
- **Image / speech:** `runGenJob` with no fallback → gains the PATH-reachability
  probe, still runs one-shot (no sibling strategy).

### 5. Telemetry (standing note)

Extend `withGenerateSpan` / add gen-fit attrs: `gen.fit.chosen`,
`gen.fit.fits` (bool), `gen.fit.budget_bytes`, `gen.fit.model_bytes`,
candidate count. Reuse existing `DegradeKind.ModelDegraded` for both no-fit and
exec-mode degrade. `media.generate` span already carries `model`.

### 6. Architecture-doc update note (standing)

`docs/architecture.md` §22 (Multimodal): add the gen-fit selector + candidate
catalog to the module map and generation section; note the impedance mismatch
and why gen uses a parallel path (not the main selector); update the §2 mermaid
Media subgraph with the new `select`/`catalog` nodes + edges (gen-fit →
hardware budget, gen-fit → policy, tools → gen-fit). Update the "honest gap"
prose: `runGenJob` is now wired; `Capability.*Gen` remain typed-but-not-
selector-consumed *by design* (gen uses its own fit path).

## Non-goals (YAGNI / deferred)

- **Not** unifying gen into the main model selector / `Runtime` contract.
- **Not** a full local video render on this box — the ladder degrades here;
  full render on a higher-disk/RAM box remains the separate "scales on a bigger
  box" track.
- **Not** a refine-loop / iterative generation UX (future).
- **Not** a per-run `--model` CLI flag (framework has none; env pin + auto-fit
  only, mirroring every other flow).

## Testing

- **Unit:** ranking (largest-that-fits, uncensored filter, env-pin override,
  no-fit → `undefined`); catalog well-formed (every candidate resolvable);
  `runGenJob` wired with the video fallback; video `--model` plumb; degrade
  message + ledger entry on no-fit.
- **Live-verify (this box, `MULTIMODAL_LIVE=1`):** image auto-fits →
  mflux-4bit renders; speech auto-fits → Kokoro renders; video either auto-fits
  a ladder tier + renders **or** degrades with the clear message — **both are
  valid outcomes proving the mechanism** (graceful-degrade choice). Edge cases
  post-review.

## Numbering

Slotted as **Slice 28**; voice/streaming shifts to Slice 29 — the same
out-of-numeric-sequence pull Slices 26/27 used, per user direction. Slices
23/24/25 remain held on the `ai@7` provider blocker.

## Grounding

`reference-gen-fit-impedance-mismatch`, `slice-27-video-gen-shipped-verified`,
`local-agent-framework`, `feedback-consent-before-model-pull`,
`target-hardware-m4-pro` (context only — framework computes live, never
hardcodes to this box).
