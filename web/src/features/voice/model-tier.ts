/**
 * Canonical home of `ModelTier` (Slice 30b Phase 7 Task 8) — a string enum
 * per the repo's CLAUDE.md convention ("prefer `enum` over string-literal
 * unions for finite sets of named values"). This supersedes Task 4's
 * temporary local union in `settings/index.tsx` and Task 7's local union in
 * `stt.worker.ts`; both now import from here instead of redefining it.
 *
 * The string VALUES ('moonshine-base' / 'moonshine-tiny') MUST stay
 * identical to the original union — they're config defaults, the
 * server-injected `window.__AGENT_VOICE_DEFAULT_MODEL__` global, persisted
 * `localStorage` values, and prefixes of the HF model ids in
 * `stt.worker.ts`'s `MODEL_IDS` map. Changing a value would silently break
 * all four.
 */
export enum ModelTier {
  Base = 'moonshine-base',
  Tiny = 'moonshine-tiny',
}
