# Slice 23 — AI SDK v6→v7 major-dependency upgrade

**Status:** design · 2026-07-19 · branch `slice-23-ai-sdk-v7-upgrade` (off `main`)
**Predecessor:** the deferred-dependency-major-upgrades register — `~/ai` was pinned to AI SDK v6, with `ai`→7 / `typescript`→6 / the `@ai-sdk/*` majors explicitly held for "a dedicated upgrade slice" (memory `deferred-dependency-major-upgrades`). This is that slice.
**Unblocks:** Phase E daemon line — Slice 24 (secure remote access) → Slice 25 (triggers). None of that can start on a v6 base.

---

## 1. Thesis

Slice 23 was **HELD 2026-07-05**: `ollama-ai-provider-v2@3.6.0` — our DEFAULT Tier-1 runtime — spoke provider-spec-v3 while `ai@7` requires spec-v4, with no override-safe path, and the openai-compatible `/v1` fallback silently lost dynamic `num_ctx`. That `num_ctx` regression (the selector's computed context window collapsing to Ollama's 4096 default) was the single blocker.

**Unblocked 2026-07-19.** `ollama-ai-provider-v2@4.0.1` now declares `peerDependencies { ai: '^7.0.0', zod: '^4.0.16' }`; `ai@7.0.31` is GA; the native provider now speaks spec-v4, so the openai-compatible fallback never has to be exercised for the default runtime. This is a **CLEAN bump** — dependency majors moving in lockstep, codemod-first then hand-migrate — **NOT** a durable/resumable `WorkflowAgent` adoption (that stays Slice 24, D4). The whole point is to land a green v7 base that the Phase E daemon work can build on, with the `num_ctx` live-verify as the acceptance gate that clears the original hold's core concern.

## 2. Scope

**In:** `ai` 6→7 (root + web, both copies); `@ai-sdk/react` 3→4 (web); `@ai-sdk/mcp` 1→2; `@ai-sdk/openai-compatible` 1→3; `@ai-sdk/provider-utils` (v7 line); `ollama-ai-provider-v2` 3→4; `typescript` 5→6; add `@ai-sdk/otel`. Node `engines` → `>=22`. Codemod pass + the ten manual (non-codemod) items. Docs (4 surfaces) + SDD ledger.

**Out:** `WorkflowAgent` adoption (D4 — Slice 24); `zod` change (D2 — already `^4.4.3`, no breakers); `ai`→any pre-release beyond GA; any new feature — this slice adds capability by unblocking, not by shipping product surface.

## 3. Decisions (locked, from the synthesis brief — verbatim in intent)

- **D1 — One slice, everything in lockstep.** Root AND web move together. There are two `ai` copies today (root `6.0.217`, web `6.0.225`); both go to 7 or the UI-message-stream framing desyncs across the transport boundary. Rationale: the wire envelope between server (`ai` root) and browser (`ai` web via `@ai-sdk/react`) is version-coupled; a split bump breaks streaming silently.
- **D2 — zod: NO CHANGE.** Already `^4.4.3` root + web; every AI-SDK zod peer is `^3.25.76 || ^4.1.8`; zero zod-4 breakers present (no `.format()`/`.flatten()`/`.email()`/`errorMap`). Non-issue — explicitly not touched.
- **D3 — Codemod-first, then manual.** `npx @ai-sdk/codemod v7` over `src/` and `web/src/`, then hand-fix the non-codemod items (§5.1). Rationale: the 32-codemod pack handles the mechanical renames deterministically; reserve human attention for the seams it can't reach.
- **D4 — `WorkflowAgent` adoption OUT of scope.** Clean bump only; durable/resumable `WorkflowAgent` is Slice 24. Rationale: keep the blast radius to "same behavior on a newer SDK" — mixing in a new execution model would make the live-verify non-comparable.
- **D5 — TS 5→6 folded in.** Independent, near-no-op (configs already modern/strict). Per `no-deferrals-full-throttle` — no new deferred debt. Rationale: bundling it costs one typecheck pass now vs. a whole separate slice later.
- **D6 — Introduce a shared `makeMockModel()` test helper** during the mock migration. 25 inline `MockLanguageModelV3` sites across 15 files with NO shared helper today; we touch all 25 anyway, so centralizing caps future cost. Recommended; final call in the plan.
- **D7 — Node `engines` field → `>=22`.** Declaration only (bun runtime is fine). Rationale: v7 baseline; makes the supported floor explicit without changing what actually runs.

## 4. Architecture / affected modules

Blast radius concentrates in the choke-point files below (from the brief §"Choke-point files"):

1. `src/core/agent.ts` — hottest: `streamText`/`generateText`, `stepCountIs`, `experimental_telemetry`×2 (`agent.ts:87,136`), `providerOptions`, `ModelMessage`, `.toUIMessageStream()` (`agent.ts:95`), multi-step result reads.
2. `src/core/agent-def.ts:22-26` — `ollamaCtxOptions` `num_ctx` `providerOptions` shape — the most fragile runtime coupling, the reason for the hold (§7.1).
3. `src/runtime/runtime.ts` — the `Runtime`/`RuntimeControl` port typed against `ai`'s `LanguageModel`.
4. `src/providers/ollama.ts` + `src/runtime/ollama.ts` — only `ollama-ai-provider-v2` construction; `embedMany`/`textEmbeddingModel`.
5. `src/runtime/managed-openai-compatible.ts:233` — only `@ai-sdk/openai-compatible` construction (all four compat runtimes).
6. `src/mcp/client.ts` — only `@ai-sdk/mcp` consumer (v2 import moves + `Experimental_StdioMCPTransport` rename + `redirect: 'error'` SSRF default).
7. `src/telemetry/{run-router,provider,spans}.ts` — OTel wiring, paired with #1 (§7.3). `run-router.ts:79-87` holds the global `BasicTracerProvider`; `provider.ts` holds `recordIoEnabled()`.
8. `web/src/features/chat/index.tsx` + `web/src/shared/transport/sse-adapter.ts` — web transport (§7.2), the highest silent-break risk.

## 5. Build order (6 increments)

1. **Bump-and-observe spike** — bump all deps in root + web `package.json`, `bun install`, run `bun run typecheck` (root) + `cd web && bun run typecheck`; capture the FULL error surface. Resolves the 3 empirical unknowns — **MockLanguageModel V3→V4?**, **`num_ctx` provider-options shape**, **`ProviderOptions` type change** — BEFORE any hand-migration. Output: a concrete error inventory that re-scopes increments 2–5. **NO fixes yet.**
2. **Codemod pass** — `npx @ai-sdk/codemod v7` on `src/` + `web/src/`; review the diff; commit. Re-typecheck.
3. **Core + provider manual fixes** — `agent.ts`/`agent-def.ts`/`providers`/`runtime` + telemetry (`@ai-sdk/otel` + opt-out inversion) + `mcp/client.ts` v2. Re-green root tests.
4. **Test-double migration** — MockLanguageModel spec fix + `makeMockModel()` helper (D6) across 15 files. Root suite green.
5. **Web migration** — react 3→4 `useChat`/transport + `sse-adapter` re-verify + 6 web test mocks + TS6 side-effect imports. Web suite + `vite build` green.
6. **Docs (4 surfaces) + live-verify + land.** `architecture.md` (§5 runtimes/provider + §7 telemetry), README (status + slice table), ROADMAP (flip Slice 23 ✅), SDD ledger. Regenerate the Artifact. Then whole-branch fan-out review → live-verify → merge `--no-ff` + push (README+ROADMAP+ledger in the same push for the slice-landing gate).

### 5.1 Codemod command + manual items

**Codemod:** `npx @ai-sdk/codemod v7` (run separately over `src/` and `web/src/`). Auto-handles (relevant): `rename-step-count-is` (`stepCountIs`→`isStepCount`), `rename-experimental-telemetry-to-telemetry`, `rename-system-to-instructions`, `remove-tool-call-options-type` (`ToolCallOptions`→`ToolExecutionOptions`), `rename-full-stream-to-stream`, the `experimental_*` lifecycle renames.

**Manual (non-codemod) items 1–10:**
1. **OTel extraction** — OpenTelemetry moved out of core `ai` into `@ai-sdk/otel`. Add dep + `registerTelemetry(new OpenTelemetry({ tracer }))` at the telemetry entry point (pairs with `run-router.ts:79-87` + `provider.ts`); `agent.ts:87,136` currently pass `experimental_telemetry` inline.
2. **Telemetry opt-out inversion** — v7 telemetry is opt-out (on once registered). Remove `isEnabled:true`; keep `functionId`/`recordInputs`/`recordOutputs`; reconcile our `recordIoEnabled()` gating with default-on (may need `isEnabled:false` when recording disabled).
3. **Multi-step result aggregation** — v7 accumulates `usage`/`content`/`toolCalls` across steps; `reasoning`/`request`/`response`/`providerMetadata` move to `result.finalStep`. Audit every read of a `generateText`/`streamText` result.
4. **`system:`→`instructions:` behavioral** — codemod renames the param; verify `prepareStep` carry-forward doesn't affect us (likely no `prepareStep` — verify). System messages in `messages[]` now rejected by default; verify we don't inject system into `messages` (fallback `allowSystemInMessages:true` if we do).
5. **Response helpers** — `result.toUIMessageStream()` (`agent.ts:95`) deprecated-alias still works; migrate to stateless `toUIMessageStream({ stream: result.stream })`. Server already uses top-level `createUIMessageStream`/`createUIMessageStreamResponse` (`handler.ts`/`build.ts`/`test-mount.ts`) — verify signatures unchanged.
6. **`@ai-sdk/mcp` v2** — `src/mcp/client.ts`: import moves; `Experimental_StdioMCPTransport` now from `@ai-sdk/mcp/mcp-stdio`; `redirect` defaults to `'error'` (SSRF) — verify our http transport still works; we use only http+stdio (no SSE, which v2 dropped — safe); `ToolCallOptions`→`ToolExecutionOptions`.
7. **MockLanguageModelV3 → V4?** — UNKNOWN until the spike. 15 files, ~25 inline instantiations, 4 `simulateReadableStream`. Resolve empirically; introduce `makeMockModel()` (D6).
8. **Web `useChat`/transport (react 3→4)** — `web/src/features/chat/index.tsx` (`useChat` + `DefaultChatTransport` + `UIMessage`), `web/src/features/agents/use-status-events.ts` (`DataUIPart`/`onData`), 6 web test mocks of `@ai-sdk/react`.
9. **HAND-ROLLED SSE seam** — `web/src/shared/transport/sse-adapter.ts` hardcodes the AI-SDK envelope (`id:`/`data:` frames, `[DONE]` sentinel from `JsonToSseTransformStream.flush`). Least type-checked, highest silent-break risk. Re-verify against v7 `createUIMessageStreamResponse` output + the `sse-adapter.test.ts` `[DONE]` test (§7.2).
10. **TS 6** — `noUncheckedSideEffectImports` default-on may error on web CSS/asset side-effect imports; ambient-declare or set the flag false.

## 6. Testing / acceptance gates

- **`bun run check` GREEN** — docs:check + root typecheck + biome + web typecheck+test + root bun tests. Baseline counts: **root ~1572, web ~348** (a drop signals a silently-skipped suite, not a smaller surface).
- **`cd web && bun run build`** — Vite build (not covered by `check`).
- **Web transport seam:** `sse-adapter.test.ts` `[DONE]` test green + (optional) `test:voice-e2e`.
- **LIVE-VERIFY vs real Ollama — the `num_ctx` gate (the hold's core concern):** run a real chat through `ollama-ai-provider-v2@4` and confirm dynamic `num_ctx` is honored — native `/api/chat`, context set to the selector's computed value, **not** the 4096 default. This is the single most important verification; it is WHY the slice was blocked. A green typecheck/test suite does NOT clear this gate — it must be observed against a live model.
- **Whole-branch fan-out review** — correctness / security / docs (Opus; **Fable for the final whole-branch gate** per `background-agents-and-fable`, weekly-Fable headroom permitting).

## 7. Hard parts

### 7.1 The `num_ctx` provider-options seam — the reason for the hold

`src/core/agent-def.ts:22-26` builds `ollamaCtxOptions` as `{ ollama: { options: { num_ctx } } }` and threads it through `providerOptions`. This is the **most fragile runtime coupling** in the slice: v7's `ProviderOptions` typing and `ollama-ai-provider-v2@4`'s own options shape both change under us, and the entire original hold was that a broken `num_ctx` path silently degrades to Ollama's 4096 default (the selector's computed window is lost, long-context runs quietly truncate — no error). The spike (increment 1) resolves the shape empirically; the manual fix lands in increment 3; and the **live-verify (§6) is the acceptance gate** — a real `/api/chat` run must show the honored, computed `num_ctx`, not the default. Do not declare this seam done on types alone.

### 7.2 The hand-rolled web SSE seam — highest silent-break risk

`web/src/shared/transport/sse-adapter.ts` hardcodes the AI-SDK wire envelope: the `id:`/`data:` frame layout and the `[DONE]` sentinel that `JsonToSseTransformStream.flush` emits. It is the **least type-checked** surface in the codebase (a hand-rolled string protocol, not a typed API), so a v7 envelope change passes typecheck and breaks streaming at runtime — the exact silent-break class D1 warns about. It MUST be re-verified against v7's `createUIMessageStreamResponse` output, and the `sse-adapter.test.ts` `[DONE]` test must stay green (asserting the sentinel framing survives the bump). Migrated in increment 5. (Forward-item §9: replace this with an AI-SDK-provided reader in a later web-hardening pass.)

### 7.3 Telemetry OTel-extraction + opt-out inversion reconciled with `recordIoEnabled()`

v7 moves OpenTelemetry out of core `ai` into `@ai-sdk/otel` (add dep, `registerTelemetry(new OpenTelemetry({ tracer }))`), and flips telemetry to **opt-out** — enabled by default once the integration is registered. Today `agent.ts:87,136` pass `experimental_telemetry` inline with `isEnabled:true`, and `src/telemetry/provider.ts`'s `recordIoEnabled()` gates whether inputs/outputs are recorded. Under the new default-on model, "enabled" is no longer per-call, so our gating must be reconciled: keep `functionId`/`recordInputs`/`recordOutputs`, and where recording is disabled we likely need an explicit `isEnabled:false` rather than the old absence-of-opt-in. The registration must be paired with the global `BasicTracerProvider` at `run-router.ts:79-87` so spans still route per-run. Landed in increment 3.

## 8. Standing notes (per the CLAUDE.md hard line)

**Architecture-doc update:** two sections of `docs/architecture.md` change. (a) **§5 "Discovery & runtimes"** (`architecture.md:968`, incl. the Runtime-telemetry sub-section at `:990`) — the provider/runtime port now sits on `ai@7` spec-v4; `ollama-ai-provider-v2@4`, `@ai-sdk/openai-compatible@3`, and `@ai-sdk/mcp@2` construction points are re-described, and the `num_ctx` provider-options shape is corrected to whatever the spike resolves. (b) **§7 "Observability — telemetry & run-viewer"** (`architecture.md:1017`) — the AI-SDK span emission path is re-documented: `experimental_telemetry`-inline is replaced by the registered `@ai-sdk/otel` integration (opt-out model + `recordIoEnabled()` reconciliation). `bun run docs:check` + the pre-push slice-landing gate hard-fail until README, ROADMAP, and the SDD ledger are updated in the same push; regenerate the Artifact.

**Telemetry to emit:** **no NEW spans and no new attribute keys.** The `gen_ai.*` AI-SDK spans that previously flowed via inline `experimental_telemetry` now flow via `@ai-sdk/otel`'s registered integration — the **emission path changes, the output must not.** The acceptance check is behavioral: after the bump, confirm the same `gen_ai.*` spans still land in `runs/<id>/spans.jsonl` (a run whose `spans.jsonl` is empty or missing `gen_ai.*` entries is a regression, even if every test is green). This is the telemetry half of the §7.3 reconciliation.

## 9. Forward-items (deferred, tracked)

- **`WorkflowAgent` adoption** — durable/resumable execution on v7's `WorkflowAgent`; explicitly Slice 24 (D4), not this slice.
- **Replace the hand-rolled `web/src/shared/transport/sse-adapter.ts`** with an AI-SDK-provided reader in a later web-hardening pass (§7.2) — this slice only re-verifies the existing hand-rolled framing survives v7; it does not rewrite it.
- **`makeMockModel()` test helper** — if D6 is not taken during increment 4, it lands as a test-infra follow-up.
- **`ai`→8 / further `@ai-sdk/*` majors** — the next dependency-upgrade slice when they arrive; this slice lands the v7 GA base only.
