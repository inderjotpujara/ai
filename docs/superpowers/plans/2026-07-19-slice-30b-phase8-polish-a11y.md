# Slice 30b · Phase 8 — Polish + A11y + Docs + Live-Verify · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining a11y / correctness / observability gap in the local web UI so the Slice-30b capability flips 🟡→✅ — the final 30b phase.

**Architecture:** Five reviewable increments across the existing web + server surfaces (no new subsystem): ① app-wide a11y foundations, ② voice a11y + progressive-decode interim ASR + downsampler anti-alias filter, ③ ⌘K command-palette completeness, ④ the chat-turn `kind=agent` notification fix + a `voice.transcribe.web` telemetry beacon, ⑤ docs + gated live-verify + full-slice land. Design source of truth: [`docs/superpowers/specs/2026-07-19-slice-30b-phase8-polish-a11y-design.md`](../specs/2026-07-19-slice-30b-phase8-polish-a11y-design.md) (D1–D10). Diagram: `docs/diagrams/slice-30b-phase8-polish-a11y/phase8-polish-a11y.png`.

**Tech Stack:** React 19 · Vite/Rolldown · Tailwind v4 · Vitest 4 (+happy-dom, +`vitest-axe`) · @xyflow/react · @huggingface/transformers (Moonshine + Silero, browser Web Worker) · Bun server · Zod contracts · OpenTelemetry spans.

## Global Constraints

*(Every task's requirements implicitly include this section.)*

- **Package manager: `bun`, never `npm`.** Root tests: `bun run test`. Web tests: `cd web && bun run test`.
- **Per-task gate.** Web task: `cd web && bun run typecheck && bun run test`. Root task: `bun run typecheck && bun run lint` + the task's focused test. The controller runs the full `bun run check` (docs-check · typecheck · lint · tests) at each **increment boundary** (after T8, T14, T18, T24, and before the land).
- **Code style:** `type` over `interface`; `enum` over string-literal unions for finite named sets (string enums only, `enum Foo { A = 'A' }`); early returns; small focused files; no `console.log`; no committing without typecheck.
- **`src/contracts/` is isomorphic** — no web-only imports (no `ModelTier` from `web/`; mirror wire values instead — see reconciliation note 2).
- **A11y target: WCAG 2.1 AA.**
- **Docs hard line:** the slice updates all four living surfaces (`docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, the SDD ledger) **plus** the docs-snapshot Artifact — all in Increment 5, same push, for the pre-push slice-landing gate. `bun run docs:check` (pre-commit) blocks if a `src/<subsystem>` is undocumented.
- **Branch:** `slice-30b-phase8-polish-a11y` (off `main` @ `d135d11`). Conventional-commit subjects (`type(scope): summary`); end commit bodies with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.
- **The 30b capability marker flips 🟡→✅ ONLY at the land (T26 docs + T29 land).** Increments 1–4 land on the branch but do not flip anything.

## Controller reconciliation notes (READ BEFORE EXECUTING — cross-part corrections found during drafting)

1. **⌘K `go-agents` maps to `/builders`, NOT a new page (T17).** There is **no `/agents` route or `AgentsArea`** — `web/src/features/agents/` is only Chat's embedded live-rail strip, so the spec's D8 wrongly assumed an Agents stub area. T17 points `go-agents` at `/builders` (which already defaults to its Agent-wizard mode) rather than fabricating a new empty page (scope creep). The real dedupe = drop `jump-to-crew`, `jump-to-workflow`, `jump-to-run`, `search-sessions` (true bare-list duplicates) and rename `jump-to-sessions` → `go-sessions` (fills a genuine gap — no plain `go-sessions` existed). Reconcile the spec's D8 wording (which implies a standalone Agents page) during T26's doc pass; a real standalone Agents page, if ever wanted, is a future slice.
2. **`ModelTier` is a real `enum`** (`web/src/features/voice/model-tier.ts`, shipped Phase 7). The isomorphic contract (T19) must **not** import it — use a wire-mirrored `VOICE_MODEL_TIERS` value set (the `CaptureSource` precedent from Phase 7 D5). `TelemetryEventSchema` is a `z.discriminatedUnion` with one `kind: 'voice.transcribe.web'` variant (extensible per spec §9).
3. **`TextStreamer.callback_function` delivers DELTA text, not cumulative** (verified against `@huggingface/transformers`). T9's `createInterimAccumulator()` concatenates deltas so every `transcribeInterim` message carries the full running text — this makes §7.1 requirement (b) "monotonic replace" true by construction.
4. **`audio-capture.test.ts` bit-exact conflict (T13).** Pre-existing assertions (`[0,9]`, `[0,1.5,3,4.5]`, `[0,5,10,15]`, `naiveResample` per-sample checks) assume filter-free interpolation; the D7 LPF necessarily changes those outputs. T13 replaces the literal expected-arrays with an independent reference (`naiveOnePoleFilter` + `naiveFilteredResample` composed with the file's existing `naiveResample`); the chunk-vs-oneShot **equality** assertions stay valid (IIR state depends on sample order, not chunk boundaries).
5. **`navigator.sendBeacon` cannot set an `Authorization` header (T21/T22).** Telemetry uses a `?k=<token>` query-param scoped **only** to `POST /api/telemetry` via a new constant-time `TokenGuard.verifyQuery(url)`; the shared header guard is untouched. **This touches security-sensitive `src/server/token.ts` → the whole-branch review MUST include a security pass on it** (query-param token log-leak risk; mitigated by constant-time compare + the existing Host/Origin perimeter).
6. **Line drift:** `dag-view.tsx`'s `fitView` is at line 142 (spec says 138). Trust the code.
7. **Execution rigor:** subagent-driven SDD, Sonnet floor. **HARD tasks → ultracode adversarial-verify (2 parallel Opus verifiers):** **T12** (§7.1 progressive-decode correctness) and **T24** (§7.2 kind=agent no-regression). **Opus** for the Increment-4 implementers/review (D9's `chat.run`/`RUN_ROOT_NAMES` blast radius spans the shared engine + run-summarization layer). T28 is a **manual gated** live-verify (steps + pass criteria, not automated asserts). T29 (Artifact regen + land) is controller-owned.

## Task & increment map (execute strictly top-to-bottom, 1 → 29)

- **Increment 1 — A11y foundations:** Tasks 1–8 · **Increment 2 — Voice a11y + interim ASR + downsampler LPF:** Tasks 9–14 · **Increment 3 — ⌘K completeness:** Tasks 15–18 · **Increment 4 — Correctness + observability:** Tasks 19–24 · **Increment 5 — Docs + live-verify + land:** Tasks 25–29.

---

## Increment 1: A11y foundations (Tasks 1–8)

### Task 1: Focus-visible design token + remove composer's `focus:outline-none` + `.sr-only` utility (D1)

**Files:**
- Modify: `web/src/shared/design/tokens.css` (append a token to the `@theme` block at lines 14-25; append a global rule after the `body{}` block at lines 50-57)
- Modify: `web/src/shared/design/tokens.test.ts` (append assertions)
- Modify: `web/src/shared/ai-elements/prompt-input.tsx:53` (drop `focus:outline-none` from the textarea's className)
- Modify: `web/src/shared/ai-elements/smoke.test.tsx` (append an assertion)

**Interfaces:**
- Consumes: nothing new.
- Produces: `--color-focus-ring` CSS custom property (theme-invariant, declared in `@theme` alongside `--color-accent`/`--color-signal`); a global `:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }` rule; a `.sr-only` utility class. Consumed by Task 2 (label text) and by every future component that relies on the browser's native `:focus-visible` behavior instead of a per-component `focus:` Tailwind class.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/shared/design/tokens.test.ts` (new `describe`, same file):

```ts
describe('a11y foundations (D1)', () => {
  it('defines a dedicated --color-focus-ring token and a global :focus-visible rule using it', () => {
    expect(css).toMatch(/--color-focus-ring:\s*#[0-9A-Fa-f]{6}/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--color-focus-ring\)/);
  });

  it('ships a .sr-only utility for visually-hidden accessible label text', () => {
    expect(css).toMatch(/\.sr-only\s*\{/);
    // clip-based hiding, not display:none — must stay in the accessibility tree
    expect(css).toMatch(/\.sr-only\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  });
});
```

Append to `web/src/shared/ai-elements/smoke.test.tsx` (new `it`, inside the existing `describe('ai-elements', ...)`):

```tsx
it('the composer textarea no longer opts out of the browser focus ring (D1)', () => {
  render(
    <PromptInput value="" onChange={() => {}} onSubmit={() => {}} />,
  );
  expect(screen.getByRole('textbox').className).not.toContain('outline-none');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- design/tokens.test.ts ai-elements/smoke.test.tsx`
Expected: FAIL — `--color-focus-ring`/`:focus-visible`/`.sr-only` are absent from `tokens.css`; the textarea's className still contains `outline-none`.

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/shared/design/tokens.css` — add one line to the existing `@theme` block:

```css
@theme {
  --color-accent: #4C8DFF;      /* blueprint-blue — live/interactive only */
  --color-signal: #35D0C0;      /* signal teal */
  --color-focus-ring: #4C8DFF;  /* dedicated a11y token (D1) — same hue as
                                    accent today by design, kept separate so a
                                    future contrast-driven ring tweak never has
                                    to touch the accent color path too */

  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, "SF Mono", monospace;

  --spacing-rail: 18rem;        /* sessions sidebar width */

  --ease-spring: linear(0, 0.12, 0.45, 0.79, 0.96, 1);
  --duration-fast: 140ms;
}
```

Append after the `body { ... }` block, before the `@media (prefers-reduced-motion: reduce)` block:

```css
/* App-wide focus-visible ring (D1) — replaces ad-hoc per-component
   focus:outline-none/focus:border overrides (see prompt-input.tsx). Only
   fires for keyboard/programmatic focus (:focus-visible), never for a mouse
   click, so it doesn't add a ring around every clicked button. */
:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

/* Visually-hidden but screen-reader-accessible label text (D1) — the
   standard clip-rect technique, NOT display:none/visibility:hidden (both of
   which remove the element from the accessibility tree too). */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

Modify `web/src/shared/ai-elements/prompt-input.tsx:53` — remove `focus:outline-none` from the textarea's className (keep everything else):

```tsx
        className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- design/tokens.test.ts ai-elements/smoke.test.tsx`
Expected: PASS.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/design/tokens.css web/src/shared/design/tokens.test.ts web/src/shared/ai-elements/prompt-input.tsx web/src/shared/ai-elements/smoke.test.tsx
git commit -m "feat(a11y): app-wide focus-visible ring token + sr-only utility (D1)"
```

---

### Task 2: Real `<label>`/`htmlFor` for the composer textarea + the Settings model-tier `<select>` (D1)

**Files:**
- Modify: `web/src/shared/ai-elements/prompt-input.tsx` (lines 46-54 — add a `.sr-only` `<label>`, give the textarea an `id`)
- Modify: `web/src/shared/ai-elements/smoke.test.tsx` (append assertion)
- Modify: `web/src/features/settings/index.tsx:162-173` (add a `.sr-only` `<label>`, give the select an `id`)
- Modify: `web/src/features/settings/index.test.tsx` (append assertion)

**Interfaces:**
- Consumes: `.sr-only` (Task 1).
- Produces: `<PromptInput>`'s textarea is reachable via `getByLabelText(/message/i)`; the Settings model-tier select is reachable via `getByLabelText(/voice model tier/i)`. No prop/signature changes — both components keep their existing public interfaces.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/shared/ai-elements/smoke.test.tsx`:

```tsx
it('associates a real (visually-hidden) label with the composer textarea (D1)', () => {
  render(
    <PromptInput value="" onChange={() => {}} onSubmit={() => {}} />,
  );
  expect(screen.getByLabelText(/message/i)).toBe(screen.getByRole('textbox'));
});
```

Append to `web/src/features/settings/index.test.tsx` (inside the existing `describe('SettingsArea — voice input', ...)` block):

```tsx
it('associates a real (visually-hidden) label with the voice model-tier select (D1)', async () => {
  renderAt('/settings');
  expect(await screen.findByLabelText(/voice model tier/i)).toBe(
    screen.getByTestId('voice-model-tier'),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- ai-elements/smoke.test.tsx settings/index.test.tsx`
Expected: FAIL — `getByLabelText` finds no matching element in either case (no `<label>` exists yet).

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/shared/ai-elements/prompt-input.tsx` (inside the `<form>`, immediately before the `<textarea>`):

```tsx
      <label htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
      />
```

Modify `web/src/features/settings/index.tsx` (inside the voice-input `<div>`, immediately before the `<select>`):

```tsx
        <label htmlFor="voice-model-tier" className="sr-only">
          Voice model tier
        </label>
        <select
          id="voice-model-tier"
          data-testid="voice-model-tier"
          value={modelTier}
          disabled={!voiceEnabled}
          onChange={(e) => setModelTier(e.target.value as ModelTier)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]"
        >
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- ai-elements/smoke.test.tsx settings/index.test.tsx`
Expected: PASS.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/ai-elements/prompt-input.tsx web/src/shared/ai-elements/smoke.test.tsx web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx
git commit -m "feat(a11y): real labels for the composer textarea + voice model-tier select (D1)"
```

---

### Task 3: `aria-pressed` on the theme/OS-notify/voice toggles + `aria-label` on the three unnamed `<aside>` landmarks (D1)

**Files:**
- Modify: `web/src/app/app-shell.tsx:82` (theme toggle `<Button>`)
- Modify: `web/src/app/app-shell.test.tsx` (append)
- Modify: `web/src/features/settings/index.tsx:136-161` (OS-notify + voice-input toggle `<Button>`s)
- Modify: `web/src/features/settings/index.test.tsx` (append)
- Modify: `web/src/features/sessions/index.tsx:38` (`<aside data-testid="sessions-sidebar">`)
- Modify: `web/src/features/sessions/index.test.tsx` (append)
- Modify: `web/src/features/workflows/workflow-detail.tsx:111` (`<aside data-testid="step-detail">`)
- Modify: `web/src/features/workflows/workflow-detail.test.tsx` (append)
- Modify: `web/src/features/runs/waterfall.tsx:53` (`<aside data-testid="span-detail">`)
- Modify: `web/src/features/runs/waterfall.test.tsx` (append)

**Interfaces:**
- Consumes: nothing new — `Button` (`web/src/shared/ui/button.tsx`) already forwards arbitrary `ButtonHTMLAttributes`, including `aria-pressed`, via its `...rest` spread.
- Produces: no new exports; five existing elements gain accessibility attributes only (no behavior/prop-shape change).

- [ ] **Step 1: Write the failing tests**

Append to `web/src/app/app-shell.test.tsx` (inside `describe('AppShell', ...)`):

```tsx
it('the theme toggle exposes aria-pressed reflecting dark mode (D1)', async () => {
  renderAt('/');
  const btn = await screen.findByRole('button', { name: /theme/i });
  expect(btn).toHaveAttribute('aria-pressed', 'true'); // ThemeProvider defaults to dark
});
```

Append to `web/src/features/settings/index.test.tsx` (inside `describe('SettingsArea', ...)` for the notify toggle, and inside `describe('SettingsArea — voice input', ...)` for the voice toggle):

```tsx
it('exposes aria-pressed on the OS-notify toggle reflecting its state (D1)', async () => {
  stubNotification('granted');
  renderAt('/settings');
  const btn = await screen.findByTestId('notify-os-toggle');
  expect(btn).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(btn);
  expect(await screen.findByText('OS notifications: on')).toBeInTheDocument();
  expect(btn).toHaveAttribute('aria-pressed', 'true');
});
```

```tsx
it('exposes aria-pressed on the voice-input toggle reflecting its state (D1)', async () => {
  renderAt('/settings');
  const btn = await screen.findByTestId('voice-input-toggle');
  expect(btn).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-pressed', 'true');
});
```

Append to `web/src/features/sessions/index.test.tsx` (inside `describe('SessionsSidebar', ...)`):

```tsx
it('labels the sidebar landmark for assistive tech (D1)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ items: [], total: 0 })),
  );
  renderAt('/');
  expect(
    await screen.findByRole('complementary', { name: /recent sessions/i }),
  ).toBeInTheDocument();
  vi.unstubAllGlobals();
});
```

Append to `web/src/features/workflows/workflow-detail.test.tsx` (inside `describe('WorkflowDetail', ...)`):

```tsx
it('labels the step-detail landmark for assistive tech (D1)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(detail)),
  );
  renderAt('/workflows/fetch-then-summarize');
  fireEvent.click(await screen.findByTestId('dag-node-fetch'));
  expect(
    await screen.findByRole('complementary', { name: /selected step detail/i }),
  ).toBeInTheDocument();
  vi.unstubAllGlobals();
});
```

Append to `web/src/features/runs/waterfall.test.tsx` (inside `describe('Waterfall', ...)`):

```tsx
it('labels the span-detail landmark for assistive tech (D1)', () => {
  render(<Waterfall spans={[span({ spanId: 'a' })]} />);
  fireEvent.click(screen.getByTestId('bar-a'));
  expect(
    screen.getByRole('complementary', { name: /selected span detail/i }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- app-shell.test.tsx settings/index.test.tsx sessions/index.test.tsx workflows/workflow-detail.test.tsx runs/waterfall.test.tsx`
Expected: FAIL on all five new assertions — none of the five elements has the attribute yet.

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/app/app-shell.tsx:82`:

```tsx
          <Button
            onClick={toggle}
            aria-label={`theme: ${theme}`}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? '☾' : '☀'}
          </Button>
```

Modify `web/src/features/settings/index.tsx` (both toggle buttons):

```tsx
        <Button
          data-testid="notify-os-toggle"
          variant={enabled ? 'accent' : 'default'}
          aria-pressed={enabled}
          onClick={handleToggle}
        >
          {enabled ? 'OS notifications: on' : 'Enable OS notifications'}
        </Button>
```

```tsx
        <Button
          data-testid="voice-input-toggle"
          variant={voiceEnabled ? 'accent' : 'default'}
          aria-pressed={voiceEnabled}
          onClick={() => setVoiceEnabled((v) => !v)}
        >
          {voiceEnabled ? 'Voice input: on' : 'Enable voice input'}
        </Button>
```

Modify `web/src/features/sessions/index.tsx:38`:

```tsx
    <aside
      data-testid="sessions-sidebar"
      aria-label="Recent sessions"
      className="w-[var(--spacing-rail)] shrink-0 border-r border-[var(--color-border)] p-4"
    >
```

Modify `web/src/features/workflows/workflow-detail.tsx:111`:

```tsx
                <aside
                  data-testid="step-detail"
                  aria-label="Selected step detail"
                  className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
                >
```

Modify `web/src/features/runs/waterfall.tsx:53`:

```tsx
        <aside
          data-testid="span-detail"
          aria-label="Selected span detail"
          className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
        >
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- app-shell.test.tsx settings/index.test.tsx sessions/index.test.tsx workflows/workflow-detail.test.tsx runs/waterfall.test.tsx`
Expected: PASS.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/app-shell.tsx web/src/app/app-shell.test.tsx web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx web/src/features/sessions/index.tsx web/src/features/sessions/index.test.tsx web/src/features/workflows/workflow-detail.tsx web/src/features/workflows/workflow-detail.test.tsx web/src/features/runs/waterfall.tsx web/src/features/runs/waterfall.test.tsx
git commit -m "feat(a11y): aria-pressed on toggle buttons + aria-label on unnamed aside landmarks (D1)"
```

---

### Task 4: `use-reduced-motion.ts` — the `matchMedia` hook gating JS-driven motion (D3)

**Files:**
- Create: `web/src/shared/a11y/use-reduced-motion.ts`
- Create: `web/src/shared/a11y/use-reduced-motion.test.ts`

**Interfaces:**
- Consumes: `matchMedia` (global, already faked in `web/src/test/setup.ts`'s default `beforeEach` — this task's own tests override that default stub locally).
- Produces: `export function useReducedMotion(): boolean`. Consumed by `DagView` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `web/src/shared/a11y/use-reduced-motion.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './use-reduced-motion.ts';

const QUERY = '(prefers-reduced-motion: reduce)';

function stubMatchMedia(initialMatches: boolean) {
  let changeListener: (() => void) | undefined;
  const mql = {
    matches: initialMatches,
    media: QUERY,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === 'change') changeListener = cb;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return {
    fireChange(nextMatches: boolean) {
      mql.matches = nextMatches;
      changeListener?.();
    },
  };
}

describe('useReducedMotion (D3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads prefers-reduced-motion: true on mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('defaults to false when the OS does not request reduced motion', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('updates when the media query change event fires', () => {
    const { fireChange } = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- a11y/use-reduced-motion.test.ts`
Expected: FAIL — `error: Cannot find module './use-reduced-motion.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/shared/a11y/use-reduced-motion.ts`:

```ts
import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the OS/browser requests reduced motion. `tokens.css`'s
 * `@media (prefers-reduced-motion: reduce)` rule only zeroes CSS
 * animation/transition durations — it has no effect on JS-driven motion like
 * `@xyflow/react`'s imperative `fitView` pan/zoom (D3). Consumers that drive
 * their own animation read this hook instead.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof matchMedia === 'function'
      ? matchMedia(REDUCED_MOTION_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- a11y/use-reduced-motion.test.ts`
Expected: PASS (3 tests).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/a11y/use-reduced-motion.ts web/src/shared/a11y/use-reduced-motion.test.ts
git commit -m "feat(a11y): matchMedia-backed useReducedMotion hook (D3)"
```

---

### Task 5: Gate `DagView`'s `fitView` animation via `useReducedMotion` (D3)

**Files:**
- Modify: `web/src/shared/dag/dag-view.tsx` (import the hook; add `fitViewOptions` to the `<ReactFlow>` element at line 138)
- Create: `web/src/shared/dag/dag-view.reduced-motion.test.tsx` (a separate file from the existing `dag-view.test.tsx` — mocks `@xyflow/react`'s `ReactFlow` export to capture props, which the existing full-render tests must NOT be affected by)

**Interfaces:**
- Consumes: `useReducedMotion` (Task 4).
- Produces: no change to `DagView`'s public props (`model`/`statusById`/`onNodeClick` unchanged) — internal only: `<ReactFlow fitViewOptions={{ duration: reducedMotion ? 0 : 200 }}>`.

- [ ] **Step 1: Write the failing test**

Create `web/src/shared/dag/dag-view.reduced-motion.test.tsx`:

```tsx
import { StepKind } from '@contracts';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let lastProps: Record<string, unknown> | undefined;

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      lastProps = props;
      return <div data-testid="mock-reactflow" />;
    },
  };
});

import { DagView } from './dag-view.tsx';
import type { DagModel } from './types.ts';

const model: DagModel = {
  nodes: [{ id: 'a', label: 'a', kind: StepKind.Tool }],
  edges: [],
};

describe('DagView — reduced motion (D3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lastProps = undefined;
  });

  it('passes a zero fitViewOptions.duration when prefers-reduced-motion is set', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<DagView model={model} />);
    expect(lastProps?.fitViewOptions).toEqual({ duration: 0 });
  });

  it('passes a non-zero fitViewOptions.duration when reduced motion is off', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<DagView model={model} />);
    expect(
      (lastProps?.fitViewOptions as { duration: number }).duration,
    ).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- dag/dag-view.reduced-motion.test.tsx`
Expected: FAIL — `DagView` doesn't pass a `fitViewOptions` prop yet (`lastProps?.fitViewOptions` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/shared/dag/dag-view.tsx` — add the import and use the hook:

```tsx
import { useReducedMotion } from '../a11y/use-reduced-motion.ts';
```

```tsx
export function DagView({
  model,
  statusById,
  onNodeClick,
}: {
  model: DagModel;
  statusById?: Record<string, DagStatus>;
  onNodeClick?: (nodeId: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const { nodes, edges } = useMemo(() => {
```

```tsx
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ duration: reducedMotion ? 0 : 200 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={
          onNodeClick ? (_event, node) => onNodeClick(node.id) : undefined
        }
      >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- dag/dag-view.reduced-motion.test.tsx dag/dag-view.test.tsx`
Expected: PASS on both files — the pre-existing `dag-view.test.tsx` is unaffected since its `vi.mock` scope is per-file, not global.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/dag/dag-view.tsx web/src/shared/dag/dag-view.reduced-motion.test.tsx
git commit -m "feat(a11y): gate DagView's fitView animation via useReducedMotion (D3)"
```

---

### Task 6: Library tabs — real keyboard pattern + shared `nextTabIndex` helper (D2)

**Files:**
- Create: `web/src/shared/ui/tab-list.ts`
- Create: `web/src/shared/ui/tab-list.test.ts`
- Modify: `web/src/features/library/index.tsx` (full new content shown below)
- Modify: `web/src/features/library/index.test.tsx` (append)

**Interfaces:**
- Consumes: nothing new for the helper (pure function).
- Produces: `export function nextTabIndex(key: string, activeIndex: number, count: number): number | undefined` — returns the new roving index for `ArrowLeft`/`ArrowRight` (wrapping)/`Home`/`End`, or `undefined` for any other key (not handled). Consumed by `LibraryArea` here and by `BuildersArea` (Task 7). `LibraryArea`'s tabs gain `role="tabpanel"`/`aria-controls`/`id` linkage and arrow-key roving `tabIndex` — no change to its own public interface (still `export function LibraryArea()`).

- [ ] **Step 1: Write the failing tests**

Create `web/src/shared/ui/tab-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './tab-list.ts';

describe('nextTabIndex (D2 — shared roving-tabindex helper)', () => {
  it('ArrowRight moves to the next index and wraps past the last', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
  });

  it('ArrowLeft moves to the previous index and wraps before the first', () => {
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('Home/End jump to the first/last index', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
  });

  it('any other key returns undefined (not handled by the tab widget)', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeUndefined();
    expect(nextTabIndex('a', 0, 3)).toBeUndefined();
  });
});
```

Append to `web/src/features/library/index.test.tsx` (inside the existing `describe('LibraryArea', ...)`):

```tsx
it('moves focus with ArrowRight/ArrowLeft (roving tabindex), wrapping at the ends (D2)', async () => {
  renderAt('/library');
  const models = await screen.findByTestId('library-tab-models');
  const memory = screen.getByTestId('library-tab-memory');
  const mcp = screen.getByTestId('library-tab-mcp');

  expect(models).toHaveAttribute('tabIndex', '0');
  expect(memory).toHaveAttribute('tabIndex', '-1');

  models.focus();
  fireEvent.keyDown(models, { key: 'ArrowRight' });
  expect(memory).toHaveFocus();
  expect(screen.getByTestId('library-panel-memory')).toBeInTheDocument();

  fireEvent.keyDown(memory, { key: 'ArrowRight' });
  expect(mcp).toHaveFocus();

  fireEvent.keyDown(mcp, { key: 'ArrowRight' });
  expect(models).toHaveFocus(); // wraps past the last tab
});

it('links each tab to its panel via aria-controls/id/role=tabpanel (D2)', async () => {
  renderAt('/library');
  const modelsTab = await screen.findByTestId('library-tab-models');
  expect(modelsTab).toHaveAttribute('aria-controls', 'library-panel-models');
  expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
    'role',
    'tabpanel',
  );
  expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
    'aria-labelledby',
    'library-tab-models',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- shared/ui/tab-list.test.ts features/library/index.test.tsx`
Expected: FAIL — `tab-list.ts` doesn't exist; `LibraryArea`'s tabs have no `tabIndex`/`aria-controls`/`role="tabpanel"` yet.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/shared/ui/tab-list.ts`:

```ts
/**
 * Pure roving-tabindex helper (D2), shared between `LibraryArea` and
 * `BuildersArea` rather than duplicated. Given the pressed key, the
 * currently-active tab index, and the tab count, returns the new active
 * index — or `undefined` if the key isn't part of the tab widget pattern
 * (ArrowLeft/ArrowRight roving, Home/End jump-to-ends). Callers own moving
 * DOM focus to the returned index (this module has no DOM dependency).
 */
export function nextTabIndex(
  key: string,
  activeIndex: number,
  count: number,
): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return (activeIndex + 1) % count;
    case 'ArrowLeft':
      return (activeIndex - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
```

Replace the full contents of `web/src/features/library/index.tsx`:

```tsx
import { type KeyboardEvent, useRef, useState } from 'react';
import { nextTabIndex } from '../../shared/ui/tab-list.ts';
import { McpTab } from './mcp-tab.tsx';
import { MemoryTab } from './memory-tab.tsx';
import { ModelsTab } from './models-tab.tsx';

type LibraryTab = 'models' | 'memory' | 'mcp';

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'models', label: 'Models' },
  { id: 'memory', label: 'Memory' },
  { id: 'mcp', label: 'MCP' },
];

/** The Library area: one shell, three tabs (Models · Memory · MCP). Models
 *  is the real inventory table + per-row Pull (Task 18); MCP is the real
 *  server list + Add-server form + Test-mount (Task 25, Increment 4); Memory
 *  is the real spaces list + upload-ingest + recall search (Task 29,
 *  Increment 5) — each tab replaced its stub the same way, without touching
 *  this shell (D11: one engine seam per increment). Duplicated a third time
 *  rather than prematurely abstracted into a shared facet component (matches
 *  the crews/workflows list precedent, Phase 4). Phase 8 D2 adds the real
 *  keyboard tab-widget pattern (arrow-key roving tabindex + tabpanel
 *  linkage) via the shared `nextTabIndex` helper, reused verbatim by
 *  `BuildersArea` (Task 7). */
export function LibraryArea() {
  const [tab, setTab] = useState<LibraryTab>('models');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextTabIndex(event.key, index, TABS.length);
    if (next === undefined) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (nextTab) setTab(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <section data-testid="area-library" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Library</h1>
      <div
        role="tablist"
        aria-label="Library sections"
        className="mt-4 flex gap-2 border-b border-[var(--color-border)]"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`library-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`library-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            data-testid={`library-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`px-3 py-2 font-mono text-sm ${
              tab === t.id
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]'
                : 'text-[var(--color-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {tab === 'models' && (
          <div
            role="tabpanel"
            id="library-panel-models"
            aria-labelledby="library-tab-models"
            data-testid="library-panel-models"
          >
            <ModelsTab />
          </div>
        )}
        {tab === 'memory' && (
          <div
            role="tabpanel"
            id="library-panel-memory"
            aria-labelledby="library-tab-memory"
            data-testid="library-panel-memory"
          >
            <MemoryTab />
          </div>
        )}
        {tab === 'mcp' && (
          <div
            role="tabpanel"
            id="library-panel-mcp"
            aria-labelledby="library-tab-mcp"
            data-testid="library-panel-mcp"
          >
            <McpTab />
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- shared/ui/tab-list.test.ts features/library/index.test.tsx`
Expected: PASS (4 pre-existing `tab-list`/`nextTabIndex` tests + the pre-existing `LibraryArea` test + the 2 new ones).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/ui/tab-list.ts web/src/shared/ui/tab-list.test.ts web/src/features/library/index.tsx web/src/features/library/index.test.tsx
git commit -m "feat(a11y): Library tabs get real keyboard roving + tabpanel linkage, via a shared helper (D2)"
```

---

### Task 7: Builders tabs — reuse the same `nextTabIndex` helper (D2)

**Files:**
- Modify: `web/src/features/builders/index.tsx` (full new content shown below)
- Modify: `web/src/features/builders/index.test.tsx` (append)

**Interfaces:**
- Consumes: `nextTabIndex` (Task 6, `web/src/shared/ui/tab-list.ts` — no new helper code this task).
- Produces: no change to `BuildersArea`'s public interface (`export function BuildersArea()` unchanged); the existing `builders-mode-agent`/`builders-mode-crew` `data-testid`s are preserved (existing test depends on them).

- [ ] **Step 1: Write the failing test**

Append to `web/src/features/builders/index.test.tsx` (inside `describe('BuildersArea', ...)`):

```tsx
it('moves focus with ArrowRight/ArrowLeft (roving tabindex, wrapping) and links each tab to its panel (D2)', async () => {
  renderAt('/builders');
  const agent = await screen.findByTestId('builders-mode-agent');
  const crew = screen.getByTestId('builders-mode-crew');

  expect(agent).toHaveAttribute('tabIndex', '0');
  expect(crew).toHaveAttribute('tabIndex', '-1');
  expect(agent).toHaveAttribute('aria-controls', 'builders-panel-agent');
  expect(screen.getByTestId('builders-panel-agent')).toHaveAttribute(
    'role',
    'tabpanel',
  );

  agent.focus();
  fireEvent.keyDown(agent, { key: 'ArrowRight' });
  expect(crew).toHaveFocus();

  fireEvent.keyDown(crew, { key: 'ArrowRight' });
  expect(agent).toHaveFocus(); // wraps — only 2 tabs
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/builders/index.test.tsx`
Expected: FAIL — no `tabIndex`/`aria-controls`/`role="tabpanel"` yet.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `web/src/features/builders/index.tsx`:

```tsx
import { type KeyboardEvent, useRef, useState } from 'react';
import { nextTabIndex } from '../../shared/ui/tab-list.ts';
import { AgentWizard } from './agent-wizard.tsx';
import { CrewWizard } from './crew-wizard.tsx';

type Mode = 'agent' | 'crew';

const TABS: { id: Mode; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'crew', label: 'Crew / Workflow' },
];

/** Builders area: an Agent/Crew mode toggle over the two guided wizards
 *  (D11 "a single /builders with an in-page mode switch" — the plan-time
 *  call the spec left open, resolved here in favor of one route). Phase 8
 *  D2 adds the real keyboard tab-widget pattern via the SAME `nextTabIndex`
 *  helper `LibraryArea` uses (Task 6) — no second implementation. */
export function BuildersArea() {
  const [mode, setMode] = useState<Mode>('agent');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextTabIndex(event.key, index, TABS.length);
    if (next === undefined) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (nextTab) setMode(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <section data-testid="area-builders" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Builders</h1>
      <div
        role="tablist"
        aria-label="Builder mode"
        className="mt-4 flex gap-2 border-b border-[var(--color-border)]"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`builders-mode-${t.id}`}
            aria-selected={mode === t.id}
            aria-controls={`builders-panel-${t.id}`}
            tabIndex={mode === t.id ? 0 : -1}
            data-testid={`builders-mode-${t.id}`}
            onClick={() => setMode(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`px-3 py-2 font-mono text-sm ${mode === t.id ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]' : 'text-[var(--color-muted)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {mode === 'agent' ? (
          <div
            role="tabpanel"
            id="builders-panel-agent"
            aria-labelledby="builders-mode-agent"
            data-testid="builders-panel-agent"
          >
            <AgentWizard />
          </div>
        ) : (
          <div
            role="tabpanel"
            id="builders-panel-crew"
            aria-labelledby="builders-mode-crew"
            data-testid="builders-panel-crew"
          >
            <CrewWizard />
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/builders/index.test.tsx`
Expected: PASS (pre-existing test + the new one).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/builders/index.tsx web/src/features/builders/index.test.tsx
git commit -m "feat(a11y): Builders tabs reuse the shared roving-tabindex helper (D2)"
```

---

### Task 8: `vitest-axe` harness + baseline no-violations assertions + dedicated tab-widget keyboard-nav test (D4)

**Files:**
- Modify: `web/package.json` (new devDependency, via `bun add -D`)
- Modify: `web/src/test/setup.ts` (wire the `toHaveNoViolations` matcher globally)
- Create: `web/src/app/a11y-baseline.test.tsx`
- Create: `web/src/app/tab-widget-keyboard.test.tsx`

**Interfaces:**
- Consumes: `renderAt` (`web/src/test/render.tsx`); `axe`/`vitest-axe/matchers` (new dependency).
- Produces: the `toHaveNoViolations` matcher becomes available to every `.test.tsx` file in `web/` from this task forward (the D4 regression net) — no runtime/production code changes.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/a11y-baseline.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { renderAt } from '../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const emptyList = { items: [], total: 0 };

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: 'ready',
    stop: vi.fn(),
  }),
}));

describe("a11y baseline (vitest-axe, D4) — no violations on the app's key screens", () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(emptyList)));
  });

  it('Chat (/)', async () => {
    const { container } = renderAt('/');
    await waitFor(() => screen.getByTestId('area-chat'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Sessions (/sessions)', async () => {
    const { container } = renderAt('/sessions');
    await waitFor(() => screen.getByTestId('area-sessions'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Runs (/runs)', async () => {
    const { container } = renderAt('/runs');
    await waitFor(() => screen.getByTestId('area-runs'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Library (/library)', async () => {
    const { container } = renderAt('/library');
    await waitFor(() => screen.getByTestId('area-library'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Builders (/builders)', async () => {
    const { container } = renderAt('/builders');
    await waitFor(() => screen.getByTestId('area-builders'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Settings (/settings)', async () => {
    const { container } = renderAt('/settings');
    await waitFor(() => screen.getByTestId('area-settings'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

Create `web/src/app/tab-widget-keyboard.test.tsx` (the §6-mandated *dedicated* keyboard-nav test — a cross-cutting characterization test locking in Task 6/7's already-shipped behavior, not new functionality; see Step 2's note):

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render.tsx';

describe('tab widget keyboard pattern (D2, §6) — dedicated arrow-roving + tabpanel-linkage check', () => {
  it('Library: ArrowRight/ArrowLeft rove focus and each tab links to its panel', async () => {
    renderAt('/library');
    const models = await screen.findByTestId('library-tab-models');
    const memory = screen.getByTestId('library-tab-memory');
    const mcp = screen.getByTestId('library-tab-mcp');

    expect(models).toHaveAttribute('aria-controls', 'library-panel-models');
    expect(memory).toHaveAttribute('aria-controls', 'library-panel-memory');
    expect(mcp).toHaveAttribute('aria-controls', 'library-panel-mcp');
    expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
      'role',
      'tabpanel',
    );

    models.focus();
    fireEvent.keyDown(models, { key: 'ArrowRight' });
    expect(memory).toHaveFocus();
    fireEvent.keyDown(memory, { key: 'ArrowLeft' });
    expect(models).toHaveFocus();
  });

  it('Builders: ArrowRight/ArrowLeft rove focus and each tab links to its panel', async () => {
    renderAt('/builders');
    const agent = await screen.findByTestId('builders-mode-agent');
    const crew = screen.getByTestId('builders-mode-crew');

    expect(agent).toHaveAttribute('aria-controls', 'builders-panel-agent');
    expect(crew).toHaveAttribute('aria-controls', 'builders-panel-crew');

    agent.focus();
    fireEvent.keyDown(agent, { key: 'ArrowRight' });
    expect(crew).toHaveFocus();
    fireEvent.keyDown(crew, { key: 'ArrowRight' });
    expect(agent).toHaveFocus(); // wraps — only 2 tabs
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- app/a11y-baseline.test.tsx app/tab-widget-keyboard.test.tsx`
Expected: `a11y-baseline.test.tsx` FAILS at the module-resolution step — `error: Cannot find package 'vitest-axe'` (not installed yet). `tab-widget-keyboard.test.tsx` **passes immediately** — Tasks 6-7 already shipped the underlying roving-tabindex/tabpanel-linkage behavior; this file is a dedicated regression-locking characterization test the spec's §6 explicitly calls for, not a red→green cycle for new functionality. Note this honestly rather than staging a contrived failure.

- [ ] **Step 3: Write minimal implementation**

Run: `cd web && bun add -D vitest-axe`
(Resolves and pins the current version in `web/package.json`/`bun.lock` — do not hand-edit a version number.)

Modify `web/src/test/setup.ts` — add the matcher wiring at the top of the file:

```ts
import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// vitest-axe's `toHaveNoViolations` matcher (D4) — registered once, globally,
// alongside jest-dom's matchers, so every `.test.tsx` file in `web/` can call
// `expect(await axe(container)).toHaveNoViolations()` without per-file setup.
expect.extend(axeMatchers);
```

(The rest of `setup.ts` — the `matchMedia`/`localStorage`/`ResizeObserver`/`confirm`/Web-Audio `beforeEach` fixtures — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- app/a11y-baseline.test.tsx app/tab-widget-keyboard.test.tsx`
Expected: PASS (6 baseline screens + 2 keyboard-nav checks).

Run: `cd web && bun run test`
Expected: PASS — the full web suite, confirming the new global `expect.extend` doesn't collide with any existing matcher usage.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/bun.lock web/src/test/setup.ts web/src/app/a11y-baseline.test.tsx web/src/app/tab-widget-keyboard.test.tsx
git commit -m "test(a11y): vitest-axe harness + baseline no-violations + dedicated tab keyboard-nav test (D4)"
```

---


## Increment 2 — Voice a11y + interim ASR + downsampler LPF (Tasks 9–14)

### Task 9: `stt.worker.ts` — `transcribeInterim` response variant + `TextStreamer` callback in `transcribe()`

**Files:**
- Modify: `web/src/features/voice/stt.worker.ts` (`SttWorkerResponse` union lines 35–40; `transcribe()` lines 162–175; `self.onmessage`'s `transcribe` branch lines 202–211; header comment lines 1–13)
- Test: `web/src/features/voice/stt.worker.test.ts` (append)

**Interfaces:**
- Consumes: `TextStreamer` from `@huggingface/transformers` (verified export — `transformers.js:45` does `export * from './generation/streamers.js'`; constructor `new TextStreamer(tokenizer: PreTrainedTokenizer, { skip_prompt?: boolean; skip_special_tokens?: boolean; callback_function?: (text: string) => void })` — `callback_function` receives only the newly-finalized **delta** substring per call, per `streamers.js`'s `on_finalized_text`, NOT the full accumulated text); `asrProcessor.tokenizer` (a `Processor` getter, typed `PreTrainedTokenizer | undefined`); `asrModel.generate({ ...inputs, max_new_tokens: 256, streamer })` (verified `streamer` is a real generate-option — `modeling_utils.js:842` destructures `streamer = null` and calls `streamer.put(...)`/`streamer.end()` during generation, lines 944–945/1013–1014/1030–1031).
- Produces: new `SttWorkerResponse` variant `{ kind: 'transcribeInterim'; id: number; text: string }` — `text` is always the **full accumulated** interim string so far (not a delta), so every consumer downstream can treat each message as a monotonic **replace** (spec §7.1 (b)) instead of an append. Also produces an exported pure helper `createInterimAccumulator(): { push(chunk: string): string }`, isolated and unit-tested the same way `detectWebGpuDevice` already is in this file (real model/generate behavior stays live-verify-only, per the file's own header comment).

- [ ] **Step 1: Write the failing test**

Append to `web/src/features/voice/stt.worker.test.ts`:

```ts
import { createInterimAccumulator, detectWebGpuDevice } from './stt.worker.ts';
```

(replace the existing single-symbol import line with the two-symbol one above), then append a new `describe` block at the bottom of the file:

```ts
// The pure accumulation logic behind the new `transcribeInterim` response
// variant (D6) — isolated exactly like `detectWebGpuDevice` above, because
// `TextStreamer`'s `callback_function` only ever hands back the newly
// finalized DELTA substring per call (see `streamers.js`'s
// `on_finalized_text`); everything downstream of a real streamer wired to a
// real `generate()` call is live-verify-only, same as the rest of this file.
describe('createInterimAccumulator', () => {
  it('accumulates incremental TextStreamer chunks into the full running text (never a delta)', () => {
    const acc = createInterimAccumulator();
    expect(acc.push('Hello ')).toBe('Hello ');
    expect(acc.push('world')).toBe('Hello world');
    expect(acc.push('!')).toBe('Hello world!');
  });

  it('starts empty and handles an immediate empty-string chunk without changing the running text', () => {
    const acc = createInterimAccumulator();
    expect(acc.push('')).toBe('');
    expect(acc.push('ok')).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/stt.worker.test.ts`
Expected: FAIL — `createInterimAccumulator` is not exported from `./stt.worker.ts`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/features/voice/stt.worker.ts`, update the import line (add `TextStreamer`):

```ts
import {
  AutoModel,
  AutoProcessor,
  env,
  type PreTrainedModel,
  type PretrainedConfig,
  type Processor,
  type ProgressInfo,
  Tensor,
  TextStreamer,
} from '@huggingface/transformers';
```

Add the new response variant to `SttWorkerResponse` (lines 35–40):

```ts
export type SttWorkerResponse =
  | { kind: 'progress'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'detectSpeechResult'; id: number; isSpeech: boolean }
  | { kind: 'transcribeInterim'; id: number; text: string }
  | { kind: 'transcribeResult'; id: number; text: string }
  | { kind: 'error'; id?: number; message: string };
```

Add the pure accumulator (place just above `transcribe()`, near the other small pure helpers):

```ts
/** Pure accumulation for `TextStreamer`'s incremental `callback_function`
 * calls — each call hands back only the newly finalized DELTA substring
 * since the last call (see `@huggingface/transformers`'s
 * `TextStreamer.on_finalized_text`). Returning the FULL running text on
 * every `push()` is what lets `use-voice-input.ts` treat every
 * `transcribeInterim` message as a monotonic REPLACE of its displayed
 * interim text (spec §7.1 (b)), never an append. Isolated and unit-tested
 * the same way `detectWebGpuDevice` above is — everything downstream (a real
 * streamer wired to a real `generate()` call) is live-verify-only. */
export function createInterimAccumulator(): { push(chunk: string): string } {
  let text = '';
  return {
    push(chunk: string): string {
      text += chunk;
      return text;
    },
  };
}
```

Replace `transcribe()` (lines 162–175):

```ts
async function transcribe(samples: Float32Array, id: number): Promise<string> {
  const tokenizer = asrProcessor?.tokenizer;
  if (!asrModel || !asrProcessor || !tokenizer) {
    throw new Error('ASR model not loaded — call load() first');
  }
  const inputs = await asrProcessor(samples);
  const accumulator = createInterimAccumulator();
  // D6: emits `transcribeInterim` as Moonshine decodes the already-captured
  // buffer — progressive reveal AFTER capture, never real-time-during-speech
  // (spec D6/§9). `skip_prompt` drops the encoder-decoder's initial
  // decoder-start token from the stream (it is not user-meaningful text).
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      post({ kind: 'transcribeInterim', id, text: accumulator.push(chunk) });
    },
  });
  const output = (await asrModel.generate({
    ...inputs,
    max_new_tokens: 256,
    streamer,
  })) as Tensor;
  const [text] = asrProcessor.batch_decode(output, {
    skip_special_tokens: true,
  });
  return text ?? '';
}
```

Update the `transcribe` branch of `self.onmessage` (lines 202–211) to pass `msg.id` through:

```ts
  if (msg.kind === 'transcribe') {
    transcribe(msg.samples, msg.id)
      .then((text) => post({ kind: 'transcribeResult', id: msg.id, text }))
      .catch((err: unknown) => {
        post({
          kind: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }
```

Update the file's header comment (lines 1–13) — append one clause to the existing sentence about what's unit-tested:

```
 * ... The one piece of pure logic worth isolating — WebGPU device detection,
 * and (Phase 8, D6) the TextStreamer callback-accumulation logic — IS
 * exported and unit tested here (see stt.worker.test.ts); everything past
 * that boundary (actual model load/inference, including the real streamer
 * wired to a real generate() call) is validated at live-verify, not by an
 * automated test.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/stt.worker.test.ts`
Expected: PASS (6 tests: 4 pre-existing `detectWebGpuDevice` + 2 new `createInterimAccumulator`).

Run: `cd web && bun run typecheck`
Expected: PASS (confirms `tokenizer` narrowing via the local `const tokenizer = asrProcessor?.tokenizer;` guard, and the `streamer` option compiles against `generate()`'s real signature).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt.worker.ts web/src/features/voice/stt.worker.test.ts
git commit -m "feat(voice): stream transcribeInterim via a TextStreamer callback in stt.worker.ts (D6)"
```

---

### Task 10: `stt-engine.ts` — forward `transcribeInterim` via a per-call, id-correlated `onInterim` callback

**Files:**
- Modify: `web/src/features/voice/stt-engine.ts` (`SttEngine` type lines 8–14; `worker.onmessage` lines 56–89; `transcribe()` lines 124–138; `close()` lines 140–154)
- Test: `web/src/features/voice/stt-engine.test.ts` (append)

**Interfaces:**
- Consumes: `SttWorkerResponse`'s new `{ kind: 'transcribeInterim'; id: number; text: string }` variant (Task 9).
- Produces: `SttEngine.transcribe(frames: VoiceFrames, onInterim?: (text: string) => void): Promise<string>` (widened from `transcribe(frames: VoiceFrames): Promise<string>`). Correlation is by the same numeric request `id` `transcribe()` already generates for `pendingTranscribe` — a new `interimListeners: Map<number, (text: string) => void>` is populated only for the duration of that one request and deleted the moment it settles (`transcribeResult` or `error` for that id, or `close()`), so two concurrent `transcribe()` calls never cross-deliver interim text to each other's callback.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/voice/stt-engine.test.ts` (inside the existing `describe('createSttEngine', ...)` block, after the "transcribe() resolves with the matching response by request id" test):

```ts
  it('transcribe() forwards transcribeInterim messages to an optional onInterim callback, id-correlated', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onInterim = vi.fn();
    const resultPromise = engine.transcribe(
      { samples: new Float32Array([0.1]), sampleRate: 16000 },
      onInterim,
    );
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    lastWorker?.emit({ kind: 'transcribeInterim', id: posted.id, text: 'Hel' });
    lastWorker?.emit({ kind: 'transcribeInterim', id: posted.id, text: 'Hello' });
    lastWorker?.emit({
      kind: 'transcribeResult',
      id: posted.id,
      text: 'Hello world',
    });
    expect(await resultPromise).toBe('Hello world');
    expect(onInterim.mock.calls).toEqual([['Hel'], ['Hello']]);
  });

  it('does not cross-deliver transcribeInterim between two concurrent transcribe() calls (different ids)', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onInterimA = vi.fn();
    const onInterimB = vi.fn();
    const promiseA = engine.transcribe(
      { samples: new Float32Array([0.1]), sampleRate: 16000 },
      onInterimA,
    );
    const postedA = lastWorker?.posted.at(-1) as { kind: string; id: number };
    const promiseB = engine.transcribe(
      { samples: new Float32Array([0.2]), sampleRate: 16000 },
      onInterimB,
    );
    const postedB = lastWorker?.posted.at(-1) as { kind: string; id: number };

    lastWorker?.emit({ kind: 'transcribeInterim', id: postedA.id, text: 'A-text' });
    lastWorker?.emit({ kind: 'transcribeInterim', id: postedB.id, text: 'B-text' });
    expect(onInterimA).toHaveBeenCalledWith('A-text');
    expect(onInterimA).not.toHaveBeenCalledWith('B-text');
    expect(onInterimB).toHaveBeenCalledWith('B-text');
    expect(onInterimB).not.toHaveBeenCalledWith('A-text');

    lastWorker?.emit({ kind: 'transcribeResult', id: postedA.id, text: 'A final' });
    lastWorker?.emit({ kind: 'transcribeResult', id: postedB.id, text: 'B final' });
    expect(await promiseA).toBe('A final');
    expect(await promiseB).toBe('B final');
  });

  it('stops delivering to onInterim once its request has settled (no leaked listener)', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onInterim = vi.fn();
    const resultPromise = engine.transcribe(
      { samples: new Float32Array([0.1]), sampleRate: 16000 },
      onInterim,
    );
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    lastWorker?.emit({ kind: 'transcribeResult', id: posted.id, text: 'done' });
    await resultPromise;

    // A stray late transcribeInterim for the same, already-settled id must
    // not throw and must not resurrect the callback via a stale map entry.
    expect(() =>
      lastWorker?.emit({ kind: 'transcribeInterim', id: posted.id, text: 'late' }),
    ).not.toThrow();
    expect(onInterim).not.toHaveBeenCalledWith('late');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts`
Expected: FAIL — `engine.transcribe(frames, onInterim)`'s second argument is silently ignored by the current implementation (`onInterim` mock never called); `transcribeInterim` messages are unhandled by `worker.onmessage`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/features/voice/stt-engine.ts`, widen the `SttEngine` type (lines 8–14):

```ts
export type SttEngine = {
  ready(): Promise<void>;
  onProgress(cb: (p: LoadProgress) => void): () => void;
  detectSpeech(chunk16k: Float32Array): Promise<boolean>;
  transcribe(
    frames: VoiceFrames,
    onInterim?: (text: string) => void,
  ): Promise<string>;
  close(): void;
};
```

Add a new correlation map next to `pendingTranscribe` (near line 54):

```ts
  const pendingTranscribe = new Map<number, Pending<string>>();
  // D6: id-correlated interim-text forwarding — one entry per in-flight
  // transcribe() call that supplied an onInterim callback, deleted the
  // moment that id settles (transcribeResult/error) or on close(). NOT a
  // Set-based multi-subscriber (unlike progressListeners): interim text is
  // inherently per-request, and two concurrent transcribe() calls (e.g. a
  // back-to-back gesture, spec §7.1 (d)) must never cross-deliver.
  const interimListeners = new Map<number, (text: string) => void>();
```

In `worker.onmessage` (lines 56–89), add a branch for `transcribeInterim` (placed after `detectSpeechResult`, before `transcribeResult`) and clear the listener wherever `pendingTranscribe.delete(msg.id)` already happens:

```ts
  worker.onmessage = (event: MessageEvent<SttWorkerResponse>) => {
    const msg = event.data;
    if (msg.kind === 'progress') {
      for (const cb of progressListeners)
        cb({ loaded: msg.loaded, total: msg.total });
      return;
    }
    if (msg.kind === 'ready') {
      readySettled = true;
      readyResolve();
      return;
    }
    if (msg.kind === 'detectSpeechResult') {
      pendingDetect.get(msg.id)?.resolve(msg.isSpeech);
      pendingDetect.delete(msg.id);
      return;
    }
    if (msg.kind === 'transcribeInterim') {
      interimListeners.get(msg.id)?.(msg.text);
      return;
    }
    if (msg.kind === 'transcribeResult') {
      pendingTranscribe.get(msg.id)?.resolve(msg.text);
      pendingTranscribe.delete(msg.id);
      interimListeners.delete(msg.id);
      return;
    }
    if (msg.kind === 'error') {
      if (msg.id !== undefined) {
        pendingDetect.get(msg.id)?.reject(new Error(msg.message));
        pendingDetect.delete(msg.id);
        pendingTranscribe.get(msg.id)?.reject(new Error(msg.message));
        pendingTranscribe.delete(msg.id);
        interimListeners.delete(msg.id);
      } else {
        readySettled = true;
        readyReject(new Error(msg.message));
      }
    }
  };
```

Update `transcribe()` (lines 124–138):

```ts
  function transcribe(
    frames: VoiceFrames,
    onInterim?: (text: string) => void,
  ): Promise<string> {
    if (closed) return Promise.reject(new Error('stt-engine closed'));
    const id = nextId++;
    if (onInterim) interimListeners.set(id, onInterim);
    return new Promise<string>((resolve, reject) => {
      pendingTranscribe.set(id, { resolve, reject });
      worker.postMessage(
        {
          kind: 'transcribe',
          id,
          samples: frames.samples,
        } satisfies SttWorkerRequest,
        [frames.samples.buffer],
      );
    });
  }
```

Update `close()` (lines 140–154) to also clear the new map:

```ts
  function close(): void {
    if (closed) return;
    closed = true;
    const closeErr = new Error('stt-engine closed');
    for (const pending of pendingDetect.values()) pending.reject(closeErr);
    for (const pending of pendingTranscribe.values()) pending.reject(closeErr);
    pendingDetect.clear();
    pendingTranscribe.clear();
    interimListeners.clear();
    if (!readySettled) {
      readySettled = true;
      readyReject(closeErr);
    }
    worker.terminate();
    progressListeners.clear();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts`
Expected: PASS (all pre-existing tests + 3 new).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt-engine.ts web/src/features/voice/stt-engine.test.ts
git commit -m "feat(voice): stt-engine.ts forwards id-correlated transcribeInterim via onInterim (D6)"
```

---

### Task 11: `use-voice-input.ts` — wire real streamed interim text (naive wiring; happy-path + monotonic-replace tests)

This task wires `engine.transcribe(frames, onInterim)` into the hook's `interim` state for both gestures, replacing the static `'…'` placeholder with the real streamed text once it starts arriving. It deliberately does **not yet** add the three adversarial guards (dropped-for-invalidated-segmenter, back-to-back-gesture isolation, final-wins-over-late-interim) — those are Task 12's dedicated, individually-failing-first correctness surface (§7.1 (a), (c), (d)). Requirement (b) — monotonic replace — falls out of Task 9's accumulator design for free (every message carries the full running text, so `setInterim(text)` is always a replace) and is locked here as a property test.

**Files:**
- Modify: `web/src/features/voice/use-voice-input.ts` (the `onSegment` callback, lines 161–196)
- Test: `web/src/features/voice/use-voice-input.test.ts` (append; reuses the file's existing `makeFakeCapture`/`makeFakeEngine`/`deferred` helpers, no new test scaffolding needed)

**Interfaces:**
- Consumes: `SttEngine.transcribe(frames, onInterim?)` (Task 10).
- Produces: `UseVoiceInput.interim` (existing field, unchanged shape) now reflects real streamed text instead of a static `'…'` busy indicator once decoding begins; `onFinal`/`status` semantics are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/voice/use-voice-input.test.ts` (inside `describe('useVoiceInput', ...)`):

```ts
  it('streams real interim text from engine.transcribe (hold-to-talk), replacing the "…" placeholder (D6)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {}); // never resolves — interim-only in this test
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));
    act(() => capturedOnInterim?.('Hel'));
    await waitFor(() => expect(result.current.interim).toBe('Hel'));
    act(() => capturedOnInterim?.('Hello'));
    await waitFor(() => expect(result.current.interim).toBe('Hello'));
  });

  it('streams real interim text via VAD tap-to-toggle too (D6)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    engine.detectSpeech = vi.fn(async () => true);
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {});
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 10, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    await act(async () => {
      emitChunk(new Float32Array(512));
      await Promise.resolve();
    });
    await act(async () => {
      result.current.toggleTap();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.interim).toBe('…'));
    act(() => capturedOnInterim?.('world'));
    await waitFor(() => expect(result.current.interim).toBe('world'));
  });

  it('interim text is always a monotonic replace — every message is the full running text, never a shorter fragment (§7.1 b)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {});
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    const seen: string[] = [];
    for (const chunk of ['Hel', 'Hello', 'Hello world']) {
      act(() => capturedOnInterim?.(chunk));
      await waitFor(() => expect(result.current.interim).toBe(chunk));
      seen.push(result.current.interim);
    }
    // Each observed value is a prefix-superset of the previous one — never
    // shorter, never a different branch (a decode-restart artifact).
    expect(seen).toEqual(['Hel', 'Hello', 'Hello world']);
    expect(seen.every((s, i) => i === 0 || s.startsWith('') )).toBe(true);
    expect(seen[2]?.startsWith('Hello')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts`
Expected: FAIL — the hook's `onSegment` callback still hardcodes `setInterim('…')` with no follow-up updates; `capturedOnInterim` is never invoked because `engine.transcribe(frames)` is called with a single argument.

- [ ] **Step 3: Write minimal implementation**

In `web/src/features/voice/use-voice-input.ts`, replace the `onSegment` callback body (lines 161–196):

```ts
      const offSegment = segmenter.onSegment((frames) => {
        setStatus('transcribing');
        setInterim('…');
        engine
          .transcribe(frames, (text) => {
            // D6: real streamed interim text replaces the static '…'
            // placeholder as Moonshine decodes. The three adversarial
            // guards (dropped-for-invalidated-segmenter, back-to-back
            // gesture isolation, final-wins-over-late-interim) land in
            // Task 12 — deliberately absent here.
            setInterim(text);
          })
          .then((text) => {
            if (!validSegmentersRef.current.has(segmenter)) return;
            if (text) opts.onFinal(text);
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .catch(() => {
            if (!validSegmentersRef.current.has(segmenter)) return;
            setError('transcription failed');
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .finally(() => {
            validSegmentersRef.current.delete(segmenter);
          });
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts`
Expected: PASS (all pre-existing tests + 3 new).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts
git commit -m "feat(voice): wire real streamed interim text into use-voice-input.ts (D6)"
```

---

### Task 12: §7.1 adversarial correctness — dropped/invalidated, back-to-back isolation, final-wins-over-late-interim

**This is the phase's hardest reasoning surface** (spec §7.1, build-order note: "the interim-decode message-ordering/correlation piece is the reasoning-heavy part → ultracode Workflow adversarial-verify"). Task 11 wired interim streaming naively, with no guards on the `onInterim` callback itself — that gap is exactly what this task closes, one requirement at a time, each starting from a genuinely failing test.

**Files:**
- Modify: `web/src/features/voice/use-voice-input.ts` (the `onSegment` callback body Task 11 just wrote)
- Test: `web/src/features/voice/use-voice-input.test.ts` (append)

**Interfaces:**
- Consumes: `validSegmentersRef` (existing, `use-voice-input.ts:79`); `segmenterRef` (existing, `use-voice-input.ts:68`) — both read-only from this task's perspective, no shape change.
- Produces: no new public interface — the `onSegment` callback's `onInterim` closure gains three guards, in this order: `finalized` (local, per-segment) → `validSegmentersRef.current.has(segmenter)` → `segmenterRef.current === segmenter`.

**Requirements under test (spec §7.1, verbatim):**
(a) interim messages for a superseded/invalidated segmenter (per the existing `validSegmentersRef` gate) are dropped, never displayed.
(b) interim text is monotonically replaced, never appended-then-replaced-with-a-shorter-string — **already covered by Task 11's property test**, not repeated here.
(c) the final `transcribeResult` always wins over any late-arriving interim for the same request id.
(d) a back-to-back gesture (new segment starts before the previous segment's decode finishes) never shows the new segment's interim text as if it were the old segment's, or vice versa.

- [ ] **Step 1a: Write the failing test for (a) — invalidated segmenter's interim is dropped**

Append to `web/src/features/voice/use-voice-input.test.ts`. `cancel()` calls `segmenterRef.current?.reset()` and `endGesture('ready')`, which nulls `segmenterRef.current` — but the ALREADY-DISPATCHED `frames` from an earlier `stopHold()`'s flush already started `engine.transcribe(frames, ...)` before a subsequent `cancel()` runs, so starting a second gesture and cancelling it reproduces the real race: an in-flight transcribe whose segmenter has since been invalidated by the destructive `validSegmentersRef.current.clear()` (Fix 4):

```ts
  it('§7.1 (a): interim messages for a segmenter invalidated by a destructive teardown are dropped, never displayed', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {}); // never resolves
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold()); // flushes → transcribe() starts, interim '…'
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // Start a NEW gesture and cancel it — this is the destructive path that
    // clears validSegmentersRef.current entirely (Fix 4), invalidating the
    // FIRST segment's still-in-flight transcribe too.
    act(() => result.current.startHold());
    act(() => result.current.cancel());

    const interimAtCancel = result.current.interim;
    act(() => capturedOnInterim?.('should-not-appear'));
    expect(result.current.interim).toBe(interimAtCancel);
    expect(result.current.interim).not.toBe('should-not-appear');
  });
```

- [ ] **Step 2a: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(a\)"`
Expected: FAIL — `result.current.interim` becomes `'should-not-appear'` because the `onInterim` closure has no `validSegmentersRef` guard yet.

- [ ] **Step 3a: Write the minimal guard for (a)**

In `use-voice-input.ts`'s `onSegment` callback, update the `onInterim` closure:

```ts
          .transcribe(frames, (text) => {
            if (!validSegmentersRef.current.has(segmenter)) return; // §7.1 (a)
            setInterim(text);
          })
```

- [ ] **Step 4a: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(a\)"`
Expected: PASS.

- [ ] **Step 1b: Write the failing test for (d) — back-to-back gesture isolation**

Append:

```ts
  it('§7.1 (d): a back-to-back gesture never shows the OLD segment\'s late interim as if it were the NEW segment\'s', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const captured: Array<(text: string) => void> = [];
    engine.transcribe = vi.fn((_frames, onInterim) => {
      if (onInterim) captured.push(onInterim);
      return new Promise<string>(() => {}); // neither segment's decode ever resolves
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Segment A: hold, release (graceful stop — stays VALID for its final).
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));
    const onInterimA = captured[0];
    act(() => onInterimA?.('A-partial'));
    await waitFor(() => expect(result.current.interim).toBe('A-partial'));

    // Segment B starts BEFORE A's decode resolves — a genuine back-to-back
    // gesture. B becomes segmenterRef.current; A is still in
    // validSegmentersRef (graceful stop), so A's FINAL would still be
    // allowed to land later — but A's INTERIM must not bleed into B's slot.
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // A's decode is STILL in flight and fires another interim chunk late —
    // this must never overwrite B's display.
    act(() => onInterimA?.('A-partial-late'));
    expect(result.current.interim).toBe('…'); // still B's placeholder, not A's text

    const onInterimB = captured[1];
    act(() => onInterimB?.('B-partial'));
    await waitFor(() => expect(result.current.interim).toBe('B-partial'));
    act(() => onInterimA?.('A-partial-even-later'));
    expect(result.current.interim).toBe('B-partial'); // still B's, A never bleeds in
  });
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(d\)"`
Expected: FAIL — segment A is still in `validSegmentersRef` (a graceful stop), so (a)'s guard alone lets A's late interim through and stomps B's `'…'`/`'B-partial'` display.

- [ ] **Step 3b: Write the minimal guard for (d)**

```ts
          .transcribe(frames, (text) => {
            if (!validSegmentersRef.current.has(segmenter)) return; // §7.1 (a)
            if (segmenterRef.current !== segmenter) return; // §7.1 (d): never bleed into a newer gesture's display
            setInterim(text);
          })
```

- [ ] **Step 4b: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(d\)"`
Expected: PASS.

- [ ] **Step 1c: Write the failing test for (c) — final always wins over a late interim, same request id**

Append:

```ts
  it('§7.1 (c): the final transcribeResult always wins over a late-arriving interim for the same request id', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    const transcribeGate = deferred<string>();
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return transcribeGate.promise;
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));

    act(() => capturedOnInterim?.('partial'));
    await waitFor(() => expect(result.current.interim).toBe('partial'));

    // The final resolves — interim is cleared, onFinal fires.
    act(() => transcribeGate.resolve('final text'));
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('final text'));
    await waitFor(() => expect(result.current.interim).toBe(''));

    // A LATE interim for the SAME (already-settled) request id must not
    // stomp the cleared, finalized state.
    act(() => capturedOnInterim?.('late-after-final'));
    expect(result.current.interim).toBe('');
  });
```

- [ ] **Step 2c: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts -t "7.1 \(c\)"`
Expected: FAIL — after `.then()` resolves and `setInterim('')` runs, the still-live `onInterim` closure (guarded only by (a)/(d), both still true for this single, uninterrupted gesture) calls `setInterim('late-after-final')`, resurrecting the cleared text.

- [ ] **Step 3c: Write the minimal guard for (c)**

Final full `onSegment` callback body (all three guards together):

```ts
      const offSegment = segmenter.onSegment((frames) => {
        setStatus('transcribing');
        setInterim('…');
        let finalized = false; // §7.1 (c): a final result always wins over a late interim
        engine
          .transcribe(frames, (text) => {
            if (finalized) return; // §7.1 (c)
            if (!validSegmentersRef.current.has(segmenter)) return; // §7.1 (a)
            if (segmenterRef.current !== segmenter) return; // §7.1 (d)
            setInterim(text);
          })
          .then((text) => {
            finalized = true;
            if (!validSegmentersRef.current.has(segmenter)) return;
            if (text) opts.onFinal(text);
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .catch(() => {
            finalized = true;
            if (!validSegmentersRef.current.has(segmenter)) return;
            setError('transcription failed');
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .finally(() => {
            validSegmentersRef.current.delete(segmenter);
          });
      });
```

- [ ] **Step 4c: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/use-voice-input.test.ts`
Expected: PASS — all pre-existing tests + all Task 11/12 additions (happy-path ×2, monotonic-replace, (a), (d), (c)).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts
git commit -m "fix(voice): §7.1 adversarial guards — drop invalidated interim, isolate back-to-back gestures, final wins over late interim (D6)"
```

**Note for the ultracode adversarial-verify Workflow (increment build-order):** this task's three failing→passing substeps ARE the reviewable unit — verify each guard is independently necessary (temporarily comment out one guard and confirm exactly its own test regresses, not the others) and that no guard's ordering can be swapped without breaking (c) (the `finalized` check must run first, since a late interim after final should short-circuit before even consulting `validSegmentersRef`/`segmenterRef`, both of which may have since been reused by a subsequent gesture).

---

### Task 13: `downsampler.ts` — one-pole anti-alias LPF ahead of the existing interpolation

**Files:**
- Modify: `web/src/features/voice/downsampler.ts` (full function body, lines 29–77)
- Modify: `web/src/features/voice/audio-capture.test.ts` (update the pre-existing bit-exact assertions that assumed no anti-alias filter existed, per D7; add the new aliasing-energy comparison test)

**Interfaces:**
- Consumes: nothing new (still a pure, zero-dependency module).
- Produces: `createDownsampler(inputRate)` — same public shape (`{ process(quantum): Float32Array; flush(): Float32Array }`), now internally low-pass-filtering each quantum (cutoff `CUTOFF_HZ = 7500`, exported for the test to reference — D7's "cutoff ~7.5kHz") **before** the existing linear interpolation, with the filter's own carry state (`lastFiltered`) reset in `flush()` alongside the pre-existing `nextP`/`globalOffsetSoFar`/`prevLast` reset.

**A pre-existing-test conflict this task must resolve:** `audio-capture.test.ts`'s current exactness assertions (`[0, 9]`, `[0, 9, 18, 27]`, `[0, 1.5, 3, 4.5]`, `[0, 5, 10, 15]`, and the `naiveResample`-based per-sample checks) were written for the OLD filter-free interpolation and will start failing the moment a real LPF is added — any non-constant signal's exact per-sample values shift. This is not a regression to work around; it is the DEFINITION of what D7 changes. This task updates those assertions to compare against an independent reference (`naiveOnePoleFilter` + the existing `naiveResample` helper, composed as `naiveFilteredResample`) instead of stale literal arrays — same "correctness, not just self-consistency" spirit the file's own `naiveResample` helper already documents. The chunked-vs-oneShot EQUALITY assertions (the actual §7.1 carry-state invariant) need NO change — an IIR filter's carry state only depends on strict sequential sample order, which chunking never disturbs, so those tests keep passing unmodified and now additionally prove the LPF's own carry state survives a chunk boundary.

- [ ] **Step 1: Write the failing tests**

At the top of `web/src/features/voice/audio-capture.test.ts`, add a new import line for `CUTOFF_HZ` (a `downsampler.ts` export, not re-exported from `audio-capture.ts` — the existing `createAudioCapture`/`createDownsampler` import line is unchanged):

```ts
import { createAudioCapture, createDownsampler } from './audio-capture.ts';
import { CUTOFF_HZ } from './downsampler.ts';
```

Add reference helpers directly below the existing `naiveResample` function:

```ts
/** Independent (non-implementation) reference for the D7 one-pole LPF —
 *  applied to the FULL, unchunked signal with the same warm-start rule
 *  `createDownsampler` uses (first sample seeds the filter state, avoiding a
 *  startup click/ramp). Because an IIR filter's output only ever depends on
 *  strict sequential sample order (never on chunk boundaries), this
 *  whole-signal computation is bit-identical to the implementation's own
 *  per-chunk carry-state computation — exact equality (not toBeCloseTo) is
 *  therefore a meaningful assertion below, not merely a close approximation. */
function naiveOnePoleFilter(
  signal: Float32Array,
  cutoffHz: number,
  inputRate: number,
): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / inputRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(signal.length);
  let last: number | undefined;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i] as number;
    if (last === undefined) last = x;
    last = last + alpha * (x - last);
    out[i] = last;
  }
  return out;
}

/** Filters the FULL signal (`naiveOnePoleFilter`) then reuses the
 *  already-existing `naiveResample` helper on the filtered result — composes
 *  the two independent references instead of hand-deriving decimal literals. */
function naiveFilteredResample(
  signal: Float32Array,
  ratio: number,
  cutoffHz: number,
  inputRate: number,
  k: number,
): number {
  const filtered = naiveOnePoleFilter(signal, cutoffHz, inputRate);
  return naiveResample(filtered, ratio, k);
}

/** Verbatim pre-D7 algorithm (bare interpolation, no anti-alias stage) —
 *  a standalone "before" snapshot used ONLY as an A/B baseline for the new
 *  aliasing-energy test below; never calls production code. */
function unfilteredReferenceDownsample(
  signal: Float32Array,
  inputRate: number,
): Float32Array {
  const ratio = inputRate / 16000;
  const out: number[] = [];
  let k = 0;
  while (k * ratio < signal.length - 1) {
    const p = k * ratio;
    const floorP = Math.floor(p);
    const frac = p - floorP;
    const s0 = signal[floorP] as number;
    const s1 = signal[floorP + 1] as number;
    out.push(s0 + (s1 - s0) * frac);
    k++;
  }
  return new Float32Array(out);
}

/** Single-frequency-bin DFT magnitude (Goertzel algorithm) — used to measure
 *  how much energy an output signal carries at a specific frequency, without
 *  computing a full FFT. */
function goertzelMagnitude(
  samples: Float32Array,
  targetFreqHz: number,
  sampleRateHz: number,
): number {
  const n = samples.length;
  const k = Math.round((n * targetFreqHz) / sampleRateHz);
  const omega = (2 * Math.PI * k) / n;
  const cosine = Math.cos(omega);
  const coeff = 2 * cosine;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = (samples[i] as number) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * cosine;
  const imag = s2 * Math.sin(omega);
  return Math.sqrt(real * real + imag * imag);
}
```

Now update the pre-existing exactness assertions to use `naiveFilteredResample` instead of literal arrays. Replace each `toEqual([...])` on a ramp/tone signal with a computed-array comparison:

```ts
  it('produces exact expected samples for a 3:1 ratio (48k→16k) single-call ramp, filtered then interpolated', () => {
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const downsampler = createDownsampler(48000);
    const output = downsampler.process(input);
    const expected = [0, 1].map((k) =>
      naiveFilteredResample(input, 3, CUTOFF_HZ, 48000, k),
    );
    expect(Array.from(output)).toEqual(expected);
  });

  it('carries BOTH the resample AND the LPF state correctly across a chunk boundary: two chunks equal one big chunk', () => {
    const wholeInput = new Float32Array([
      0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33,
    ]);
    const oneShot = createDownsampler(48000);
    const referenceOutput = Array.from(oneShot.process(wholeInput));

    const chunked = createDownsampler(48000);
    const chunk1 = wholeInput.subarray(0, 6);
    const chunk2 = wholeInput.subarray(6, 12);
    const chunkedOutput = [
      ...chunked.process(chunk1),
      ...chunked.process(chunk2),
    ];

    expect(chunkedOutput).toEqual(referenceOutput);
    const expected = [0, 1, 2, 3].map((k) =>
      naiveFilteredResample(wholeInput, 3, CUTOFF_HZ, 48000, k),
    );
    expect(referenceOutput).toEqual(expected);
  });

  it('is invariant to arbitrary non-aligned chunk sizes, including a boundary requiring the carried prevLast sample (fractional 1.5:1 ratio)', () => {
    const wholeInput = new Float32Array([0, 1, 2, 3, 4, 5]);
    const oneShot = createDownsampler(24000);
    const referenceOutput = Array.from(oneShot.process(wholeInput));
    const expected = [0, 1, 2, 3].map((k) =>
      naiveFilteredResample(wholeInput, 1.5, CUTOFF_HZ, 24000, k),
    );
    expect(referenceOutput).toEqual(expected);

    const chunked = createDownsampler(24000);
    const out1 = chunked.process(wholeInput.subarray(0, 2));
    const out2 = chunked.process(wholeInput.subarray(2, 3));
    const out3 = chunked.process(wholeInput.subarray(3, 6));
    expect([...out1, ...out2, ...out3]).toEqual(referenceOutput);
  });

  it('linearly interpolates at fractional positions off the 0/0.5 grid (44.1k-style ratio), filtered then interpolated', () => {
    const input = new Float32Array([0, 4, 8, 12, 16]); // x[i] = 4i
    const d = createDownsampler(20000); // ratio = 1.25
    const out = Array.from(d.process(input));
    const expected = [0, 1, 2, 3].map((k) =>
      naiveFilteredResample(input, 1.25, CUTOFF_HZ, 20000, k),
    );
    expect(out).toEqual(expected);
  });
```

Update the `naiveResample`-based per-k check inside "invariant to arbitrary non-128-aligned AudioWorklet-style quantum sizes" to use `naiveFilteredResample`:

```ts
    for (const k of [0, 1, 2, 500, 4999, 8192, 15999]) {
      expect(quantaOutput[k]).toBe(
        naiveFilteredResample(signal, 3, CUTOFF_HZ, 48000, k),
      );
    }
```

(The rest of that test — chunked-vs-quanta equality and the output-length assertion — is unchanged; it already proves the resample carry-state invariant, and now additionally proves the LPF carry state survives arbitrary chunk boundaries too, since both partitions run through the same filtered code path.)

Update the `flush()` and zero-length-quantum tests' literal `[0, 9]` the same way:

```ts
  it('flush() returns empty and resets state (including the LPF carry) for reuse', () => {
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const downsampler = createDownsampler(48000);
    downsampler.process(input);
    const residual = downsampler.flush();
    expect(Array.from(residual)).toEqual([]);

    const reused = downsampler.process(input);
    const fresh = createDownsampler(48000).process(input);
    expect(Array.from(reused)).toEqual(Array.from(fresh));
  });

  it('never throws and returns empty on a zero-length quantum', () => {
    const downsampler = createDownsampler(48000);
    expect(Array.from(downsampler.process(new Float32Array(0)))).toEqual([]);
    const input = new Float32Array([0, 3, 6, 9, 12, 15]);
    const expected = [0, 1].map((k) =>
      naiveFilteredResample(input, 3, CUTOFF_HZ, 48000, k),
    );
    expect(Array.from(downsampler.process(input))).toEqual(expected);
  });
```

Finally, add the new spec-required aliasing test:

```ts
  it('the D7 anti-alias LPF measurably reduces aliasing energy vs. raw interpolation for an above-Nyquist tone (reference comparison, not bit-exact)', () => {
    const inputRate = 48000;
    const durationSec = 0.2;
    const n = Math.floor(inputRate * durationSec);
    const toneHz = 9500; // above the 8kHz output Nyquist — a classic fold-back case
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[i] = Math.sin((2 * Math.PI * toneHz * i) / inputRate);
    }

    const filtered = createDownsampler(inputRate).process(signal);
    const unfiltered = unfilteredReferenceDownsample(signal, inputRate);

    const aliasFreqHz = 16000 - toneHz; // 6500 Hz — where 9500Hz folds to at 16kHz
    const filteredAliasEnergy = goertzelMagnitude(filtered, aliasFreqHz, 16000);
    const unfilteredAliasEnergy = goertzelMagnitude(unfiltered, aliasFreqHz, 16000);

    expect(filteredAliasEnergy).toBeLessThan(unfilteredAliasEnergy * 0.5);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: FAIL — `CUTOFF_HZ` is not exported from `./downsampler.ts` (compile error); once stubbed, the exactness assertions fail because `createDownsampler` has no filter stage yet (its raw output matches the OLD literals, not `naiveFilteredResample`'s filtered reference); the new aliasing test fails because `filteredAliasEnergy` is statistically indistinguishable from `unfilteredAliasEnergy` pre-D7 (both paths are identical, bare interpolation).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `web/src/features/voice/downsampler.ts`:

```ts
const OUTPUT_RATE = 16000;

/** D7 anti-alias cutoff: "~7.5kHz" per the design decision — comfortably
 *  under the 16kHz output rate's 8kHz Nyquist, attenuating the content a
 *  bare 48k→16k (or similar) decimation would otherwise fold back into the
 *  audible band. Exported so `audio-capture.test.ts` can build an
 *  independent reference filter at the SAME cutoff, not a hardcoded
 *  duplicate the two could silently drift apart from. */
export const CUTOFF_HZ = 7500;

/**
 * Streaming linear-interpolation resampler from `inputRate` down to the
 * fixed 16 kHz `VoiceFrames` rate, preceded by a one-pole anti-alias
 * low-pass filter (D7). Carries continuous state across `process()` calls
 * so an AudioWorklet render-quantum boundary (128 frames, arbitrary with
 * respect to the resample ratio — Web Audio spec) never drops or
 * duplicates a sample (spec §7.1). Mirrors `src/voice/capture.ts`'s
 * `carryPcmChunk` leftover-byte-carry pattern, adapted from byte-alignment
 * to continuous-time resampling.
 *
 * Output samples sit on the continuous grid `p_k = k * ratio` (in GLOBAL
 * input-sample-index units, k = 0, 1, 2, ...). `nextP` is the next `p_k` to
 * compute; `globalOffsetSoFar` is the global index of the first sample in
 * the quantum about to be processed; `prevLast` is the previous quantum's
 * final FILTERED sample, needed only when an output position's lower
 * interpolation index falls exactly on that boundary sample (`idxLow ===
 * -1`). This makes the function's output PROVABLY invariant to how the same
 * total input is chunked: re-chunking only changes which call computes
 * which output sample, never the sequence of floating-point operations
 * performed — true of both the resample math AND the LPF's own recursive
 * carry state (`lastFiltered`), since a one-pole IIR filter's output only
 * ever depends on strict sequential sample order, never on where a chunk
 * boundary happens to fall.
 *
 * `lastFiltered` is WARM-STARTED (seeded to the very first raw sample
 * rather than 0) so a fresh capture session's filter has no artificial
 * startup ramp/click — this also makes a constant (DC) input pass through
 * the filter bit-exact from sample 0 onward, a useful test property.
 *
 * Lives in its own zero-dependency module so it can be bundled into BOTH the
 * main app (`audio-capture.ts`, which re-exports it) AND the AudioWorklet
 * chunk (`downsample-worklet.ts`, loaded via `?worker&url`) without the
 * worklet build dragging in browser-only code or forming a circular worker
 * reference through `audio-capture.ts`. One source of truth for the math —
 * `audio-capture.test.ts` exercises it via the re-export.
 */
export function createDownsampler(inputRate: number): {
  process(quantum: Float32Array): Float32Array;
  flush(): Float32Array;
} {
  const ratio = inputRate / OUTPUT_RATE;
  // One-pole LPF coefficient (D7): y[n] = y[n-1] + alpha*(x[n]-y[n-1]).
  const rc = 1 / (2 * Math.PI * CUTOFF_HZ);
  const dt = 1 / inputRate;
  const alpha = dt / (rc + dt);
  let nextP = 0;
  let globalOffsetSoFar = 0;
  let prevLast: number | undefined;
  let lastFiltered: number | undefined; // warm-started on first sample seen

  function process(quantum: Float32Array): Float32Array {
    const n = quantum.length;
    if (n === 0) return new Float32Array(0);

    // D7: anti-alias LPF pass BEFORE interpolation. Filtering into its own
    // buffer keeps the carry-state interpolation loop below unchanged
    // except for reading `filtered` instead of the raw `quantum`.
    const filtered = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = quantum[i] as number;
      if (lastFiltered === undefined) lastFiltered = x; // warm start, no click
      lastFiltered = lastFiltered + alpha * (x - lastFiltered);
      filtered[i] = lastFiltered;
    }

    const out: number[] = [];
    const upperBound = globalOffsetSoFar + n - 1;
    while (nextP < upperBound) {
      const floorP = Math.floor(nextP);
      const frac = nextP - floorP;
      const idxLow = floorP - globalOffsetSoFar;
      // Invariant (proven in the doc comment above): idxLow is always >= -1
      // here, and idxLow+1 is always a valid index into `filtered` — so
      // these reads are safe despite `noUncheckedIndexedAccess`.
      const s0 =
        idxLow === -1 ? (prevLast as number) : (filtered[idxLow] as number);
      const s1 =
        idxLow === -1
          ? (filtered[0] as number)
          : (filtered[idxLow + 1] as number);
      out.push(s0 + (s1 - s0) * frac);
      nextP += ratio;
    }
    globalOffsetSoFar += n;
    prevLast = filtered[n - 1];
    return new Float32Array(out);
  }

  function flush(): Float32Array {
    // No output sample is ever withheld beyond what `process()` already
    // emitted: a point is only produced once BOTH its bracketing FILTERED
    // input samples are known, so there is nothing left to synthesize at
    // stop without extrapolating audio that was never captured. Reset ALL
    // carried state — resample AND filter (D7) — so the instance is safe to
    // reuse for a fresh capture session with no click/ramp bleed-through.
    nextP = 0;
    globalOffsetSoFar = 0;
    prevLast = undefined;
    lastFiltered = undefined;
    return new Float32Array(0);
  }

  return { process, flush };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: PASS (all updated exactness tests via the `naiveFilteredResample` reference, the unchanged chunk-invariance tests, and the new aliasing-energy test).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/downsampler.ts web/src/features/voice/audio-capture.test.ts
git commit -m "feat(voice): one-pole anti-alias LPF ahead of the 48k downsampler's interpolation (D7)"
```

---

### Task 14: `mic-button.tsx` — `aria-live="polite"` status region

**Files:**
- Modify: `web/src/features/voice/mic-button.tsx` (the outer `<div data-testid="mic-button" ...>` wrapper, line 70)
- Test: `web/src/features/voice/mic-button.test.tsx` (append)

**Interfaces:**
- Consumes: nothing new — `VoiceStatus` (`use-voice-input.ts:10-16`), unchanged.
- Produces: no new props/exports — the existing `mic-button` container gains `aria-live="polite"` + `aria-atomic="true"`, covering the three currently-silent status affordances D5 names verbatim: the "Loading voice model…" span (lines 104-108), the "● Listening" label swapped inside the hold button (line 83), and the interim-transcript span (lines 96-103). The error span's own separate `role="alert"` (line 110, implicitly `aria-live="assertive"`) is left untouched — nesting an assertive region inside a polite one is standard and the assertive announcement still takes precedence for that inner element.

- [ ] **Step 1: Write the failing test**

Append to `web/src/features/voice/mic-button.test.tsx` (inside `describe('MicButton', ...)`):

```ts
  it('the status region is an aria-live="polite" announcer (D5) covering loading/listening/transcribing', () => {
    useVoiceInputMock.mockReturnValue(baseVoice({ status: 'listening', level: 0.3 }));
    render(<MicButton onFinal={vi.fn()} />);
    const region = screen.getByTestId('mic-button');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('● Listening');
  });

  it('the same polite region announces the loading and transcribing status text across a rerender', () => {
    useVoiceInputMock.mockReturnValue(baseVoice({ status: 'loading' }));
    const { rerender } = render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('mic-button')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading voice model…')).toBeInTheDocument();

    useVoiceInputMock.mockReturnValue(
      baseVoice({ status: 'transcribing', interim: 'Hello' }),
    );
    rerender(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('mic-interim')).toHaveTextContent('Hello');
    expect(screen.getByTestId('mic-button')).toHaveAttribute('aria-live', 'polite');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/mic-button.test.tsx`
Expected: FAIL — `screen.getByTestId('mic-button')` has no `aria-live` attribute yet.

- [ ] **Step 3: Write minimal implementation**

In `web/src/features/voice/mic-button.tsx`, update the outer wrapper (line 70):

```tsx
    <div
      data-testid="mic-button"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-2"
    >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/mic-button.test.tsx`
Expected: PASS (all pre-existing tests + 2 new).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/mic-button.tsx web/src/features/voice/mic-button.test.tsx
git commit -m "feat(voice): aria-live=polite status region on MicButton (D5)"
```

---

**Increment 2 gate:** `cd web && bun run typecheck && bun run test` (full web suite, not just `features/voice/`) — confirms Tasks 9–14 haven't regressed the a11y/settings/other feature suites they share test-setup fixtures with.

## Increment 3: ⌘K command-palette completeness (Tasks 15–18)

### Task 15: Widen `Command` for action commands + a `runCommand` dispatcher (D8)

**Files:**
- Modify: `web/src/app/commands.ts` (full new content shown below)
- Modify: `web/src/app/command-palette.tsx` (import + two call-site changes)
- Modify: `web/src/app/commands.test.ts` (rename import; append)
- Modify: `web/src/app/command-palette.test.tsx` (append)

**Interfaces:**
- Consumes: `NavigateFn = ReturnType<typeof useNavigate>` (existing, unchanged).
- Produces: `export enum CommandKind { Nav = 'nav', Action = 'action' }`; `export type Command = NavCommand | ActionCommand` where `NavCommand = { id: string; label: string; kind: CommandKind.Nav; run: (nav: NavigateFn) => void | Promise<void> }` and `ActionCommand = { id: string; label: string; kind: CommandKind.Action; run: () => void }`; `export function runCommand(cmd: Command, nav: NavigateFn): void | Promise<void>` — the one dispatch point every caller (palette Enter-key handler, palette click handler, and Task 18's tests) uses instead of calling `.run(...)` directly. `export const commands: Command[]` (renamed from `navCommands` — the same array, now holding entries of the widened type; Task 16 appends `Action`-kind entries to this SAME array).

- [ ] **Step 1: Write the failing tests**

Modify `web/src/app/commands.test.ts` — change the import (the array is renamed) and append a new `describe`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { CommandKind, commands, runCommand } from './commands.ts';
```

```ts
describe('runCommand (D8 — widened Command dispatch)', () => {
  it("calls an action-kind command's run() with no arguments, ignoring nav", () => {
    const run = vi.fn();
    const nav = vi.fn() as unknown as Parameters<typeof runCommand>[1];
    runCommand({ id: 'a', label: 'A', kind: CommandKind.Action, run }, nav);
    expect(run).toHaveBeenCalledWith();
    expect(nav).not.toHaveBeenCalled();
  });

  it("calls a nav-kind command's run(nav) with the navigate function", () => {
    const run = vi.fn();
    const nav = vi.fn() as unknown as Parameters<typeof runCommand>[1];
    runCommand({ id: 'b', label: 'B', kind: CommandKind.Nav, run }, nav);
    expect(run).toHaveBeenCalledWith(nav);
  });
});
```

(Every existing `it` in this file keeps working unchanged once `navCommands` → `commands` is renamed — none of those assertions touch `kind`/dispatch.)

Append to `web/src/app/command-palette.test.tsx`:

```tsx
it('runs the selected command via runCommand (nav-kind, unchanged end-to-end behavior)', async () => {
  render(<CommandPalette />);
  await userEvent.keyboard('{Meta>}k{/Meta}');
  await userEvent.type(screen.getByRole('combobox'), 'settings');
  await userEvent.keyboard('{Enter}');
  expect(navigate).toHaveBeenCalledWith({ to: '/settings' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- app/commands.test.ts app/command-palette.test.tsx`
Expected: FAIL — `commands`/`CommandKind`/`runCommand` aren't exported from `commands.ts` yet (only `navCommands` and the narrow `Command` type exist).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `web/src/app/commands.ts`:

```ts
import type { useNavigate } from '@tanstack/react-router';

type NavigateFn = ReturnType<typeof useNavigate>;

/** Phase 8 D8: `Command` now supports two shapes — `Nav` (the original,
 *  navigates somewhere) and `Action` (a no-arg side effect, e.g. toggling a
 *  setting). `enum` per this repo's "enum over string-literal unions for
 *  finite sets" convention. */
export enum CommandKind {
  Nav = 'nav',
  Action = 'action',
}

type NavCommand = {
  id: string;
  label: string;
  kind: CommandKind.Nav;
  run: (nav: NavigateFn) => void | Promise<void>;
};

type ActionCommand = {
  id: string;
  label: string;
  kind: CommandKind.Action;
  run: () => void;
};

export type Command = NavCommand | ActionCommand;

/** The one dispatch point for running a `Command` (D8) — callers (the
 *  palette's Enter-key handler and its click handler) never branch on
 *  `cmd.kind` themselves. */
export function runCommand(cmd: Command, nav: NavigateFn): void | Promise<void> {
  return cmd.kind === CommandKind.Action ? cmd.run() : cmd.run(nav);
}

// Renamed from `navCommands` (Phase 8 D8) — this array now holds the
// widened `Command` union; Task 16 appends `Action`-kind entries here.
export const commands: Command[] = [
  { id: 'go-chat', label: 'Go to Chat', kind: CommandKind.Nav, run: (n) => n({ to: '/' }) },
  { id: 'go-crews', label: 'Go to Crews', kind: CommandKind.Nav, run: (n) => n({ to: '/crews' }) },
  {
    id: 'go-workflows',
    label: 'Go to Workflows',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/workflows' }),
  },
  {
    id: 'go-builders',
    label: 'Go to Builders',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/builders' }),
  },
  { id: 'go-runs', label: 'Go to Runs', kind: CommandKind.Nav, run: (n) => n({ to: '/runs' }) },
  {
    id: 'go-library',
    label: 'Go to Library',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/library' }),
  },
  {
    id: 'go-settings',
    label: 'Go to Settings',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/settings' }),
  },
  { id: 'jump-to-run', label: 'Jump to Runs', kind: CommandKind.Nav, run: (n) => n({ to: '/runs' }) },
  {
    id: 'jump-to-crew',
    label: 'Jump to Crews',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/crews' }),
  },
  {
    id: 'jump-to-workflow',
    label: 'Jump to Workflows',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/workflows' }),
  },
  {
    id: 'jump-to-sessions',
    label: 'Jump to Sessions',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/sessions' }),
  },
  {
    id: 'search-sessions',
    label: 'Search Sessions',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/sessions' }),
  },
];
```

(This task ONLY widens the type + renames the array + adds `kind: CommandKind.Nav` to every existing entry — the degenerate-duplicate dedupe and `go-agents` addition are Task 17; the new "jump to a recent run" behavior is Task 18.)

Modify `web/src/app/command-palette.tsx`:

```tsx
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../shared/ui/dialog.tsx';
import { type Command, commands, runCommand } from './commands.ts';
```

```tsx
  const results = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    return q
      ? commands.filter((c) => c.label.toLowerCase().includes(q))
      : commands;
  }, [query]);
```

```tsx
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = results[selected];
      if (cmd) {
        runCommand(cmd, navigate);
        onOpenChange(false);
      }
    }
```

```tsx
            onClick={() => {
              runCommand(c, navigate);
              onOpenChange(false);
            }}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- app/commands.test.ts app/command-palette.test.tsx`
Expected: PASS (all pre-existing assertions, unaffected by the rename, plus the 3 new ones).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/commands.ts web/src/app/command-palette.tsx web/src/app/commands.test.ts web/src/app/command-palette.test.tsx
git commit -m "feat(cmdk): widen Command to support action (no-nav) entries, via a runCommand dispatcher (D8)"
```

---

### Task 16: Voice-input toggle + theme toggle action commands (D8)

**Files:**
- Modify: `web/src/features/settings/index.tsx` (add `toggleVoiceInputEnabled` export)
- Modify: `web/src/features/settings/index.test.tsx` (append)
- Modify: `web/src/shared/design/theme.tsx` (add `toggleThemeGlobal` export + a resync effect in `ThemeProvider`)
- Modify: `web/src/shared/design/theme.test.tsx` (append)
- Modify: `web/src/app/commands.ts` (append two `Action`-kind entries)
- Modify: `web/src/app/commands.test.ts` (append)
- Modify: `web/src/app/command-palette.test.tsx` (append)

**Interfaces:**
- Consumes: `CommandKind`/`Command`/`commands` (Task 15); the existing private `storedVoiceEnabled()`/`VOICE_ENABLED_KEY` in `settings/index.tsx`; the existing private `apply()`/`STORAGE_KEY`/`Theme` in `theme.tsx`.
- Produces: `export function toggleVoiceInputEnabled(): boolean` (settings/index.tsx — flips + persists the setting, callable from anywhere, not just from a mounted `<SettingsArea>`); `export function toggleThemeGlobal(): void` (theme.tsx — a non-hook theme toggle for callers outside the React tree; fires a DOM event so any mounted `<ThemeProvider>` resyncs its own state); two new `commands` entries: `toggle-voice-input`, `toggle-theme`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/settings/index.test.tsx` (inside `describe('SettingsArea — voice input', ...)`, and add `toggleVoiceInputEnabled` to the existing import line):

```tsx
import {
  isOsNotifyEnabled,
  isVoiceInputEnabled,
  toggleVoiceInputEnabled,
  voiceModelTier,
} from './index.tsx';
```

```tsx
it('toggleVoiceInputEnabled (D8 action command) flips + persists without mounting SettingsArea', () => {
  expect(isVoiceInputEnabled()).toBe(false);
  expect(toggleVoiceInputEnabled()).toBe(true);
  expect(isVoiceInputEnabled()).toBe(true);
  expect(toggleVoiceInputEnabled()).toBe(false);
  expect(isVoiceInputEnabled()).toBe(false);
});
```

Append to `web/src/shared/design/theme.test.tsx` (add `toggleThemeGlobal` to the import line):

```tsx
import { Theme, ThemeProvider, toggleThemeGlobal, useTheme } from './theme.tsx';
```

```tsx
it('toggleThemeGlobal (D8 action command) flips DOM class + storage and resyncs a mounted ThemeProvider without a direct hook call', () => {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByRole('button')).toHaveTextContent('theme:dark');

  toggleThemeGlobal();

  expect(document.documentElement).toHaveClass('light');
  expect(localStorage.getItem('agent-theme')).toBe(Theme.Light);
  expect(screen.getByRole('button')).toHaveTextContent('theme:light');
});
```

Append to `web/src/app/commands.test.ts`:

```ts
it('includes a toggle-voice-input action command (D8)', () => {
  const cmd = commands.find((c) => c.id === 'toggle-voice-input');
  expect(cmd?.kind).toBe(CommandKind.Action);
  expect(cmd?.label).toMatch(/voice/i);
});

it('includes a toggle-theme action command (D8)', () => {
  const cmd = commands.find((c) => c.id === 'toggle-theme');
  expect(cmd?.kind).toBe(CommandKind.Action);
  expect(cmd?.label).toMatch(/theme/i);
});
```

Append to `web/src/app/command-palette.test.tsx`:

```tsx
it('runs a real action command (toggle-theme) via Enter without calling navigate (D8)', async () => {
  document.documentElement.className = '';
  render(<CommandPalette />);
  await userEvent.keyboard('{Meta>}k{/Meta}');
  await userEvent.type(screen.getByRole('combobox'), 'toggle theme');
  await userEvent.keyboard('{Enter}');
  expect(document.documentElement).toHaveClass('dark');
  expect(navigate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- settings/index.test.tsx design/theme.test.tsx app/commands.test.ts app/command-palette.test.tsx`
Expected: FAIL — `toggleVoiceInputEnabled`/`toggleThemeGlobal` aren't exported yet; the two new `commands` entries don't exist.

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/features/settings/index.tsx` — add below `isVoiceInputEnabled`:

```tsx
/** Flips + persists the voice-input setting from anywhere (the ⌘K
 *  toggle-voice-input action command, D8) — does NOT require `<SettingsArea>`
 *  to be mounted, unlike the component's own `voiceEnabled` React state.
 *  Returns the new value. */
export function toggleVoiceInputEnabled(): boolean {
  const next = !storedVoiceEnabled();
  try {
    localStorage.setItem(VOICE_ENABLED_KEY, String(next));
  } catch {
    // ignore persistence failure — reflects the toggle for this call only
  }
  return next;
}
```

Modify `web/src/shared/design/theme.tsx`:

```ts
const STORAGE_KEY = 'agent-theme';
const THEME_CHANGE_EVENT = 'agent:theme-changed';
```

```ts
/** Non-hook theme toggle for callers outside the React tree (the ⌘K
 *  toggle-theme action command, D8 — `ActionCommand.run` takes no argument,
 *  so it can't call the `useTheme()` hook). Mirrors `apply()`/`toggle()`'s
 *  persistence + DOM update, then fires a DOM event so any mounted
 *  `<ThemeProvider>` resyncs its own React state (keeping the header's
 *  theme icon correct without a hook call). */
export function toggleThemeGlobal(): void {
  const next = document.documentElement.classList.contains('dark')
    ? Theme.Light
    : Theme.Dark;
  apply(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore persistence failure — the DOM class change still applies
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
```

In `ThemeProvider`, add a resync effect alongside the existing persistence effect:

```tsx
  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore persistence failure — theme still applies for the session
    }
  }, [theme]);

  useEffect(() => {
    function onExternalChange() {
      setTheme(
        document.documentElement.classList.contains('dark')
          ? Theme.Dark
          : Theme.Light,
      );
    }
    window.addEventListener(THEME_CHANGE_EVENT, onExternalChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onExternalChange);
  }, []);
```

Modify `web/src/app/commands.ts` — add imports and append two entries to `commands`:

```ts
import { toggleVoiceInputEnabled } from '../features/settings/index.tsx';
import { toggleThemeGlobal } from '../shared/design/theme.tsx';
```

```ts
  {
    id: 'toggle-voice-input',
    label: 'Toggle voice input',
    kind: CommandKind.Action,
    run: () => {
      toggleVoiceInputEnabled();
    },
  },
  {
    id: 'toggle-theme',
    label: 'Toggle theme (light/dark)',
    kind: CommandKind.Action,
    run: () => toggleThemeGlobal(),
  },
```

(Appended after `search-sessions`, the last existing entry.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- settings/index.test.tsx design/theme.test.tsx app/commands.test.ts app/command-palette.test.tsx`
Expected: PASS.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx web/src/shared/design/theme.tsx web/src/shared/design/theme.test.tsx web/src/app/commands.ts web/src/app/commands.test.ts web/src/app/command-palette.test.tsx
git commit -m "feat(cmdk): voice-input + theme toggle action commands (D8)"
```

---

### Task 17: `go-agents` nav command + dedupe the degenerate `jump-to-*`/`search-sessions` set (D8)

**⚠ Surprise carried into this task (see the final report's surprises section):** the spec's D8 assumes an "Agents" page/route already exists (like Crews/Workflows/Builders/etc.) and just lacks a nav command. It does not — `grep -rn "'/agents'\|AgentsArea" web/src` returns nothing, `web/src/app/router.tsx` has no `/agents` route, and `web/src/features/agents/` contains only `live-rail.tsx` + `use-status-events.ts` (the Chat page's embedded live-status strip — already consumed by `ChatArea`, not a standalone routed page). Rather than fabricate a new empty page not specified anywhere else in the spec (real scope creep beyond "⌘K completeness"), `go-agents` maps to the closest existing real surface: `/builders`, which already defaults to its Agent-wizard mode. This is called out in the code comment below and MUST be confirmed with the user/spec-owner before Increment 5's docs pass — if a real standalone Agents page is actually wanted, that's new scope for a future task/slice, not a silent add here.

**Files:**
- Modify: `web/src/app/commands.ts` (dedupe + add `go-agents`)
- Modify: `web/src/app/commands.test.ts` (remove stale assertions for deduped ids; add new ones)

**Interfaces:**
- Consumes: `CommandKind`/`commands` (Task 15).
- Produces: `commands` gains `go-agents` (→ `/builders`) and `go-sessions` (→ `/sessions`, replacing `jump-to-sessions` — this was NOT actually a duplicate before now, since no plain "Go to Sessions" command existed; the rename both dedupes naming and fills that real gap); `commands` loses `jump-to-crew`, `jump-to-workflow` (pure duplicates of `go-crews`/`go-workflows`), `search-sessions` (pure duplicate of `jump-to-sessions`), and `jump-to-run` (a pure duplicate of `go-runs` today — Task 18 re-adds a DIFFERENT, real "jump to a recent run" command under a new id, not this one).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `web/src/app/commands.test.ts`'s `describe('navCommands', ...)`-turned-`describe('commands', ...)` block (keep the `runCommand`/action-command `describe` blocks from Tasks 15-16 unchanged, below this one):

```ts
describe('commands — deduped nav set + go-agents (D8, Task 17)', () => {
  it('go-agents navigates to /builders — the closest existing "Agents" surface today (see Task 17\'s surprise note)', () => {
    const cmd = commands.find((c) => c.id === 'go-agents');
    expect(cmd?.label).toMatch(/agent/i);
  });

  it('go-sessions replaces jump-to-sessions, filling the previously-missing plain "Go to Sessions" command', () => {
    expect(commands.find((c) => c.id === 'go-sessions')?.label).toMatch(/session/i);
    expect(commands.find((c) => c.id === 'jump-to-sessions')).toBeUndefined();
  });

  it('drops the degenerate bare-list duplicates: jump-to-crew, jump-to-workflow, jump-to-run, search-sessions', () => {
    expect(commands.find((c) => c.id === 'jump-to-crew')).toBeUndefined();
    expect(commands.find((c) => c.id === 'jump-to-workflow')).toBeUndefined();
    expect(commands.find((c) => c.id === 'jump-to-run')).toBeUndefined();
    expect(commands.find((c) => c.id === 'search-sessions')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- app/commands.test.ts`
Expected: FAIL — `go-agents`/`go-sessions` don't exist yet; `jump-to-crew`/`jump-to-workflow`/`jump-to-run`/`search-sessions` still do.

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/app/commands.ts` — replace the `commands` array's nav-command block (everything from `go-chat` through `search-sessions`):

```ts
export const commands: Command[] = [
  { id: 'go-chat', label: 'Go to Chat', kind: CommandKind.Nav, run: (n) => n({ to: '/' }) },
  { id: 'go-crews', label: 'Go to Crews', kind: CommandKind.Nav, run: (n) => n({ to: '/crews' }) },
  {
    id: 'go-workflows',
    label: 'Go to Workflows',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/workflows' }),
  },
  {
    id: 'go-builders',
    label: 'Go to Builders',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/builders' }),
  },
  {
    // No standalone /agents route or AgentsArea page exists in this repo
    // (verified by grep — `features/agents/` is only Chat's embedded
    // live-status rail). Mapped to /builders, which already defaults to its
    // Agent-wizard mode, rather than fabricating a new empty page outside
    // this task's ⌘K-completeness scope. Flagged for spec-owner sign-off
    // (Task 17's surprise note) — revisit if a real Agents page ships later.
    id: 'go-agents',
    label: 'Go to Agents',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/builders' }),
  },
  { id: 'go-runs', label: 'Go to Runs', kind: CommandKind.Nav, run: (n) => n({ to: '/runs' }) },
  {
    id: 'go-library',
    label: 'Go to Library',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/library' }),
  },
  {
    id: 'go-settings',
    label: 'Go to Settings',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/settings' }),
  },
  {
    // Renamed from jump-to-sessions (Task 17 dedupe) — this was NEVER
    // actually a duplicate (no go-sessions existed before), so the rename
    // both normalizes naming with the other go-* entries and fills a real
    // gap. search-sessions (a pure duplicate of the old jump-to-sessions)
    // is dropped entirely, not renamed.
    id: 'go-sessions',
    label: 'Go to Sessions',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/sessions' }),
  },
];
```

(`jump-to-crew`/`jump-to-workflow`/`jump-to-run`/`search-sessions` are simply removed — no replacement entry. Task 18 adds a NEW, differently-behaved `jump-to-recent-run` command afterward, in its own commit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- app/commands.test.ts app/command-palette.test.tsx`
Expected: PASS.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/commands.ts web/src/app/commands.test.ts
git commit -m "feat(cmdk): add go-agents (mapped to /builders — see surprise note), dedupe degenerate jump-to-*/search-sessions (D8)"
```

---

### Task 18: "Jump to a recent run" — deep-links to a specific `runId` (D8)

**Files:**
- Modify: `web/src/app/commands.ts` (add `jump-to-recent-run`, importing `apiFetch`/`RunListResponseSchema`)
- Modify: `web/src/app/commands.test.ts` (append)

**Interfaces:**
- Consumes: `apiFetch` (`web/src/shared/contract/client.ts`, unchanged); `RunListResponseSchema` (`@contracts`, unchanged); `runCommand` (Task 15, used by the test to invoke the async `run`).
- Produces: a new `commands` entry `jump-to-recent-run` whose `run` is `async (nav) => ...` — fetches `GET /api/runs?limit=1`, and if a most-recent run exists, navigates to `/runs/$runId` with that specific id; otherwise (empty result OR a failed fetch) falls back to the bare `/runs` list, never throwing.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/app/commands.test.ts`:

```ts
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('jump-to-recent-run (D8 — real deep-link, not the bare list)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the most recent run and navigates to its specific runId', async () => {
    const cmd = commands.find((c) => c.id === 'jump-to-recent-run');
    expect(cmd?.kind).toBe(CommandKind.Nav);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              id: 'run-42',
              kind: 'chat',
              startMs: 0,
              durationMs: 1,
              outcome: 'answer',
              lifecycle: 'done',
              origin: 'manual',
              models: [],
              degraded: false,
              spanCount: 1,
            },
          ],
          total: 1,
        }),
      ),
    );
    const nav = vi.fn();
    await runCommand(cmd as Command, nav as unknown as Parameters<typeof runCommand>[1]);
    expect(nav).toHaveBeenCalledWith({
      to: '/runs/$runId',
      params: { runId: 'run-42' },
    });
  });

  it('falls back to the bare /runs list when there are no runs yet', async () => {
    const cmd = commands.find((c) => c.id === 'jump-to-recent-run');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    const nav = vi.fn();
    await runCommand(cmd as Command, nav as unknown as Parameters<typeof runCommand>[1]);
    expect(nav).toHaveBeenCalledWith({ to: '/runs' });
  });

  it('falls back to the bare /runs list (never throws) when the fetch fails', async () => {
    const cmd = commands.find((c) => c.id === 'jump-to-recent-run');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const nav = vi.fn();
    await expect(
      runCommand(cmd as Command, nav as unknown as Parameters<typeof runCommand>[1]),
    ).resolves.toBeUndefined();
    expect(nav).toHaveBeenCalledWith({ to: '/runs' });
  });
});
```

(Add `afterEach` and `Command` to the file's existing `vitest`/`./commands.ts` import lines.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- app/commands.test.ts`
Expected: FAIL — `jump-to-recent-run` doesn't exist (`commands.find(...)` returns `undefined`, `cmd?.kind` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/app/commands.ts` — add the import and one new entry, appended after `go-sessions`:

```ts
import { RunListResponseSchema } from '@contracts';
import { apiFetch } from '../shared/contract/client.ts';
```

```ts
  {
    // A genuinely new command (D8), not a rename of the old jump-to-run
    // (which Task 17 dropped as a pure /runs-list duplicate) — this one
    // deep-links to a SPECIFIC run id, fetched live.
    id: 'jump-to-recent-run',
    label: 'Jump to a recent run',
    kind: CommandKind.Nav,
    run: async (n) => {
      try {
        const page = await apiFetch('/runs?limit=1', {
          schema: RunListResponseSchema,
        });
        const mostRecent = page.items[0];
        if (mostRecent) {
          n({ to: '/runs/$runId', params: { runId: mostRecent.id } });
          return;
        }
      } catch {
        // A failed lookup degrades to the bare list — never worse than the
        // pre-Phase-8 jump-to-run behavior, and never throws on Enter.
      }
      n({ to: '/runs' });
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- app/commands.test.ts app/command-palette.test.tsx`
Expected: PASS (all three new cases + every pre-existing assertion in the file).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/commands.ts web/src/app/commands.test.ts
git commit -m "feat(cmdk): jump-to-recent-run deep-links to a specific runId, with graceful fallback (D8)"
```

## Increment 4 — Correctness + observability (Tasks 19–24)

> **For agentic workers:** implement task-by-task via superpowers:subagent-driven-development. Per-task gate = `bun run typecheck` + `bun run lint` + the task's own focused test(s), run inline. Web-touching tasks additionally run `cd web && bun run typecheck && bun run test`. Conventional commits: `feat(telemetry|voice|runs): …` / `fix(...)` per task. D9's blast radius (T23/T24) spans the shared engine + run-summarization layer both CLI and web depend on — **Opus**, and the §7.2 regressions are load-bearing.

### Task 19: `src/contracts/telemetry.ts` — `TelemetryEventSchema` (D10) + round-trip test

**Files:**
- Create: `src/contracts/telemetry.ts`
- Modify: `src/contracts/index.ts` (append `export * from './telemetry.ts';`)
- Test: `tests/contracts/telemetry.test.ts`

**Interfaces:**
- Consumes: `zod` only (isomorphic rule — `tests/contracts/isomorphic.test.ts` forbids `node:*`/engine/`ai` imports under `src/contracts/`).
- Produces: `VOICE_MODEL_TIERS` (`readonly ['moonshine-base','moonshine-tiny']`), `TelemetryEventSchema` (a `z.discriminatedUnion('kind', …)` with one variant today — extensible per §9), and `type TelemetryEvent = z.infer<typeof TelemetryEventSchema>`. The `voice.transcribe.web` variant shape is exactly spec §4.1: `{ kind: 'voice.transcribe.web'; durationMs: number; wordCount: number; modelTier: 'moonshine-base'|'moonshine-tiny'; realTimeFactor: number; engine: string }`. Consumed by `handleTelemetry` (T21) and `web/src/shared/telemetry/beacon.ts` (T22).

> **Decision (flag to controller):** the spec writes `modelTier: ModelTier`, but `ModelTier` lives web-side (`web/src/features/voice/model-tier.ts`) and contracts is isomorphic and cannot import it. So the two moonshine tier values are **wire-mirrored** here as `VOICE_MODEL_TIERS` — the exact same precedent Phase 7's `CaptureSource` lift set (D5). Values stay byte-identical to the web enum.

- [ ] **Step 1: Write the failing test** — create `tests/contracts/telemetry.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { TelemetryEventSchema } from '../../src/contracts/telemetry.ts';

const valid = {
  kind: 'voice.transcribe.web' as const,
  durationMs: 1234,
  wordCount: 7,
  modelTier: 'moonshine-base' as const,
  realTimeFactor: 0.42,
  engine: 'transformers.js',
};

test('TelemetryEventSchema accepts a well-formed voice.transcribe.web event (round-trip)', () => {
  const parsed = TelemetryEventSchema.parse(valid);
  expect(parsed).toEqual(valid);
});

test('TelemetryEventSchema rejects an unknown kind', () => {
  expect(() => TelemetryEventSchema.parse({ ...valid, kind: 'voice.transcribe' })).toThrow();
});

test('TelemetryEventSchema rejects a missing/negative field', () => {
  const { wordCount: _drop, ...noWordCount } = valid;
  expect(() => TelemetryEventSchema.parse(noWordCount)).toThrow();
  expect(() => TelemetryEventSchema.parse({ ...valid, durationMs: -1 })).toThrow();
  expect(() => TelemetryEventSchema.parse({ ...valid, modelTier: 'whisper' })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/contracts/telemetry.test.ts`. Expected: FAIL — `Cannot find module '../../src/contracts/telemetry.ts'`.

- [ ] **Step 3: Write minimal implementation** — create `src/contracts/telemetry.ts`:

```ts
import { z } from 'zod';

/**
 * Wire mirror of web's `ModelTier` values (web/src/features/voice/model-tier.ts).
 * `src/contracts/` is isomorphic (no web import), so the two Moonshine tiers are
 * mirrored here rather than shared by import — the same precedent `CaptureSource`
 * set in Slice 30b Phase 7 (D5). Slice 30b Phase 8, D10.
 */
export const VOICE_MODEL_TIERS = ['moonshine-base', 'moonshine-tiny'] as const;

/**
 * The client→server telemetry beacon body (spec §4.1, D10). A discriminated
 * union with ONE variant today; written as a union so a future phase can add a
 * second event kind without a schema break (§9). The `kind` discriminant equals
 * the emitted span name 1:1 (`voice.transcribe.web`) so it never conflates with
 * the pre-existing CLI-side `voice.transcribe` span (D10).
 */
export const TelemetryEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('voice.transcribe.web'),
    durationMs: z.number().nonnegative(),
    wordCount: z.number().int().nonnegative(),
    modelTier: z.enum(VOICE_MODEL_TIERS),
    realTimeFactor: z.number().nonnegative(),
    engine: z.string().min(1),
  }),
]);
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
```

Append to `src/contracts/index.ts`: `export * from './telemetry.ts';`.

- [ ] **Step 4: Run test to verify it passes** — `bun test tests/contracts/telemetry.test.ts tests/contracts/isomorphic.test.ts`. Expected: PASS (round-trip + reject shapes + isomorphic guard still green). Then `bun run typecheck`.

- [ ] **Step 5: Commit** — `git add src/contracts/telemetry.ts src/contracts/index.ts tests/contracts/telemetry.test.ts && git commit -m "feat(telemetry): TelemetryEventSchema wire contract for the voice beacon (D10)"`

---

### Task 20: `src/telemetry/spans.ts` — `voice.transcribe.web` span writer (D10)

**Files:**
- Modify: `src/telemetry/spans.ts` (add 3 `ATTR.*` keys in the `ATTR` block near the existing `VOICE_*` keys at lines 146–150; add `recordVoiceTranscribeWeb` beside `withVoiceTranscribeSpan` ~line 1049–1059)
- Test: `tests/telemetry/voice-transcribe-web-span.test.ts`

**Interfaces:**
- Consumes: `inSpan` (private, spans.ts:206), the existing `ATTR.VOICE_STT_MODEL`/`ATTR.VOICE_DURATION_MS`/`ATTR.INPUT_MODALITY` keys, and the `registerTestProvider` harness (`tests/helpers/otel-test-provider.ts`).
- Produces: `export function recordVoiceTranscribeWeb(info: { modelTier: string; durationMs: number; wordCount: number; realTimeFactor: number; engine: string }): Promise<void>` — a **fire-and-forget span writer** in the `recordChatFeedback` mould (spans.ts:365, no request-nesting), opening `inSpan('voice.transcribe.web', …)`. New keys `ATTR.VOICE_WORD_COUNT = 'voice.word.count'`, `ATTR.VOICE_REAL_TIME_FACTOR = 'voice.real_time_factor'`, `ATTR.VOICE_ENGINE = 'voice.engine'`. Reuses `VOICE_STT_MODEL` for the tier value and `VOICE_DURATION_MS` for duration. Consumed by `handleTelemetry` (T21).

> **Distinct span, not a repurpose (D10):** the pre-existing `withVoiceTranscribeSpan` opens `voice.transcribe` (server/CLI, Slice 29) with `VOICE_CAPTURE_SOURCE`/`VOICE_AUDIO_SECONDS`/`VOICE_OUTCOME`. This new `voice.transcribe.web` span carries the browser-only `wordCount`/`realTimeFactor`/`engine` instead — leave `withVoiceTranscribeSpan` untouched.

- [ ] **Step 1: Write the failing test** — create `tests/telemetry/voice-transcribe-web-span.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { ATTR, recordVoiceTranscribeWeb } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let ctx: ReturnType<typeof registerTestProvider>;
afterEach(async () => {
  await ctx?.provider.shutdown();
});

describe('recordVoiceTranscribeWeb', () => {
  test('exposes the new VOICE_* attribute keys', () => {
    expect(ATTR.VOICE_WORD_COUNT).toBe('voice.word.count');
    expect(ATTR.VOICE_REAL_TIME_FACTOR).toBe('voice.real_time_factor');
    expect(ATTR.VOICE_ENGINE).toBe('voice.engine');
  });

  test('writes a voice.transcribe.web span carrying every posted attribute', async () => {
    ctx = registerTestProvider();
    await recordVoiceTranscribeWeb({
      modelTier: 'moonshine-base',
      durationMs: 1200,
      wordCount: 9,
      realTimeFactor: 0.5,
      engine: 'transformers.js',
    });
    const span = ctx.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'voice.transcribe.web');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.VOICE_STT_MODEL]).toBe('moonshine-base');
    expect(span?.attributes[ATTR.VOICE_DURATION_MS]).toBe(1200);
    expect(span?.attributes[ATTR.VOICE_WORD_COUNT]).toBe(9);
    expect(span?.attributes[ATTR.VOICE_REAL_TIME_FACTOR]).toBe(0.5);
    expect(span?.attributes[ATTR.VOICE_ENGINE]).toBe('transformers.js');
    expect(span?.attributes[ATTR.INPUT_MODALITY]).toBe('audio');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/telemetry/voice-transcribe-web-span.test.ts`. Expected: FAIL — `recordVoiceTranscribeWeb` not exported; `ATTR.VOICE_WORD_COUNT` undefined.

- [ ] **Step 3: Write minimal implementation** — in `src/telemetry/spans.ts`, add to the `ATTR` object immediately after `VOICE_OUTCOME: 'voice.outcome',` (line 150):

```ts
  VOICE_WORD_COUNT: 'voice.word.count',
  VOICE_REAL_TIME_FACTOR: 'voice.real_time_factor',
  VOICE_ENGINE: 'voice.engine',
```

Add after `withVoiceTranscribeSpan` (after line 1059):

```ts
/**
 * Fire-and-forget span for one BROWSER voice transcription (Slice 30b Phase 8,
 * D10). Written server-side by `POST /api/telemetry` (`src/server/telemetry/`)
 * from the client's `navigator.sendBeacon` call — distinct from the in-process
 * CLI-side `voice.transcribe` span (`withVoiceTranscribeSpan` above): it carries
 * the browser-only `wordCount`/`realTimeFactor`/`engine`, not capture-source /
 * audio-seconds / outcome. No parent request span carries useful attributes here,
 * so it opens its own root (mirrors `recordChatFeedback`).
 */
export function recordVoiceTranscribeWeb(info: {
  modelTier: string;
  durationMs: number;
  wordCount: number;
  realTimeFactor: number;
  engine: string;
}): Promise<void> {
  return inSpan('voice.transcribe.web', async (span) => {
    span.setAttribute(ATTR.VOICE_STT_MODEL, info.modelTier);
    span.setAttribute(ATTR.VOICE_DURATION_MS, info.durationMs);
    span.setAttribute(ATTR.VOICE_WORD_COUNT, info.wordCount);
    span.setAttribute(ATTR.VOICE_REAL_TIME_FACTOR, info.realTimeFactor);
    span.setAttribute(ATTR.VOICE_ENGINE, info.engine);
    span.setAttribute(ATTR.INPUT_MODALITY, 'audio');
  });
}
```

- [ ] **Step 4: Run test to verify it passes** — `bun test tests/telemetry/voice-transcribe-web-span.test.ts`. Expected: PASS (5 assertions). Then `bun run typecheck && bun run lint:file -- "src/telemetry/spans.ts"`.

- [ ] **Step 5: Commit** — `git add src/telemetry/spans.ts tests/telemetry/voice-transcribe-web-span.test.ts && git commit -m "feat(telemetry): voice.transcribe.web span writer + VOICE_* attrs (D10)"`

---

### Task 21: `src/server/telemetry/` — `POST /api/telemetry` route (D10) + wire in `app.ts` + sendBeacon auth

**Files:**
- Create: `src/server/telemetry/handler.ts`
- Modify: `src/server/app.ts` (add the POST `/api/telemetry` branch in `handleApi` beside `/api/feedback` ~line 158–161; add the beacon-auth exception in `buildFetch`'s `/api` guard ~line 118–120)
- Modify: `src/server/security/token.ts` (add `verifyQuery(url: URL): boolean` to `TokenGuard`)
- Test: `tests/server/telemetry.test.ts`, `tests/server/token.test.ts` (append)

**Interfaces:**
- Consumes: `TelemetryEventSchema` (`src/contracts/telemetry.ts`, T19), `recordVoiceTranscribeWeb` (T20), `json`/`ISOLATION_HEADERS` conventions (`app.ts`, `isolation-headers.ts`), `registerTestProvider`.
- Produces: `export async function handleTelemetry(req: Request): Promise<Response>` (validate → write span → `204` ack; `400` on invalid; no `deps` — the span is the only side effect, like `handleFeedback`). `TokenGuard` gains `verifyQuery(url: URL): boolean`.

> **sendBeacon auth (decision — flag to controller):** `navigator.sendBeacon` cannot set an `Authorization` header, but the whole `/api` surface is header-guarded (`app.ts:119`). Rather than weaken the shared guard for every route, `buildFetch` accepts a `?k=<token>` query-param token **only** for `POST /api/telemetry` (constant-time compared via the new `verifyQuery`). The Host/Origin perimeter (`enforcePerimeter`) still blocks cross-origin first, and the token is already same-origin-readable via `window.__AGENT_TOKEN__`, so this adds no material attack surface. Scoped narrowly on purpose.

- [ ] **Step 1: Write the failing tests** — create `tests/server/telemetry.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { handleTelemetry } from '../../src/server/telemetry/handler.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let ctx: ReturnType<typeof registerTestProvider>;
beforeEach(() => {
  ctx = registerTestProvider();
});
afterEach(async () => {
  await ctx.provider.shutdown();
});

function req(body: unknown): Request {
  return new Request('http://localhost/api/telemetry?k=tok', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const valid = {
  kind: 'voice.transcribe.web',
  durationMs: 1500,
  wordCount: 12,
  modelTier: 'moonshine-tiny',
  realTimeFactor: 0.6,
  engine: 'transformers.js',
};

test('a valid beacon returns 204 and writes a voice.transcribe.web span with the posted attrs', async () => {
  const res = await handleTelemetry(req(valid));
  expect(res.status).toBe(204);
  const span = ctx.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'voice.transcribe.web');
  expect(span?.attributes[ATTR.VOICE_STT_MODEL]).toBe('moonshine-tiny');
  expect(span?.attributes[ATTR.VOICE_WORD_COUNT]).toBe(12);
  expect(span?.attributes[ATTR.VOICE_REAL_TIME_FACTOR]).toBe(0.6);
});

test('an invalid beacon body returns 400 and writes no span', async () => {
  const res = await handleTelemetry(req({ kind: 'voice.transcribe.web' }));
  expect(res.status).toBe(400);
  expect(ctx.exporter.getFinishedSpans().find((s) => s.name === 'voice.transcribe.web')).toBeUndefined();
});

test('a non-JSON body returns 400', async () => {
  const bad = new Request('http://localhost/api/telemetry?k=tok', {
    method: 'POST',
    body: 'not json',
    headers: { 'content-type': 'application/json' },
  });
  expect((await handleTelemetry(bad)).status).toBe(400);
});
```

Append to `tests/server/token.test.ts`:

```ts
import { createTokenGuard } from '../../src/server/security/token.ts';

test('verifyQuery accepts the token from the ?k= query param (sendBeacon path)', () => {
  const guard = createTokenGuard('sekret');
  expect(guard.verifyQuery(new URL('http://localhost/api/telemetry?k=sekret'))).toBe(true);
  expect(guard.verifyQuery(new URL('http://localhost/api/telemetry?k=wrong'))).toBe(false);
  expect(guard.verifyQuery(new URL('http://localhost/api/telemetry'))).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun test tests/server/telemetry.test.ts tests/server/token.test.ts`. Expected: FAIL — `handleTelemetry`/`verifyQuery` do not exist.

- [ ] **Step 3: Write minimal implementation** — create `src/server/telemetry/handler.ts`:

```ts
import { TelemetryEventSchema } from '../../contracts/telemetry.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { recordVoiceTranscribeWeb } from '../../telemetry/spans.ts';

/**
 * `POST /api/telemetry` (Slice 30b Phase 8, D10) — the first client-originated
 * telemetry in the repo. Validates the `sendBeacon` body against
 * `TelemetryEventSchema`, writes the matching `voice.transcribe.web` span, and
 * acks 204 (fire-and-forget: the browser never reads a body). No `deps` — the
 * span is the only side effect (mirrors `handleFeedback`).
 */
export async function handleTelemetry(req: Request): Promise<Response> {
  let event: ReturnType<typeof TelemetryEventSchema.parse>;
  try {
    event = TelemetryEventSchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: 'invalid telemetry event' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
    });
  }
  // Single variant today (§9); switch on `kind` when a second lands.
  await recordVoiceTranscribeWeb({
    modelTier: event.modelTier,
    durationMs: event.durationMs,
    wordCount: event.wordCount,
    realTimeFactor: event.realTimeFactor,
    engine: event.engine,
  });
  return new Response(null, { status: 204, headers: { ...ISOLATION_HEADERS } });
}
```

In `src/server/security/token.ts`, extend the `TokenGuard` type + factory — add a shared constant-time compare and `verifyQuery`:

```ts
export type TokenGuard = { verify(req: Request): boolean; verifyQuery(url: URL): boolean };

export function createTokenGuard(token: string): TokenGuard {
  const expected = Buffer.from(token);
  const prefix = 'Bearer ';
  const matches = (candidate: string): boolean => {
    const got = Buffer.from(candidate);
    if (got.length !== expected.length) return false;
    return timingSafeEqual(got, expected);
  };
  return {
    verify(req) {
      const header = req.headers.get('authorization');
      if (header === null || !header.startsWith(prefix)) return false;
      return matches(header.slice(prefix.length));
    },
    // sendBeacon cannot set an Authorization header (Slice 30b Phase 8, D10);
    // `buildFetch` calls this ONLY for POST /api/telemetry, same-origin, already
    // behind the Host/Origin perimeter.
    verifyQuery(url) {
      const k = url.searchParams.get('k');
      return k !== null && matches(k);
    },
  };
}
```

In `src/server/app.ts`, replace the `/api` guard branch (lines 118–121):

```ts
      if (url.pathname.startsWith('/api')) {
        const isBeacon = req.method === 'POST' && url.pathname === '/api/telemetry';
        if (!guard.verify(req) && !(isBeacon && guard.verifyQuery(url))) {
          return json({ error: 'unauthorized' }, 401);
        }
        return await handleApi(req, url, deps);
      }
```

Add the route branch in `handleApi` after the `/api/feedback` branch (after line 161), and the import at the top:

```ts
import { handleTelemetry } from './telemetry/handler.ts';
```
```ts
        if (req.method === 'POST' && url.pathname === '/api/telemetry') {
          const res = await handleTelemetry(req);
          rec.status(res.status);
          return res;
        }
```

- [ ] **Step 4: Run tests to verify they pass** — `bun test tests/server/telemetry.test.ts tests/server/token.test.ts` (+ re-run `tests/server/app*.test.ts` / any buildFetch test to confirm the guard change didn't regress existing routes). Then `bun run typecheck && bun run lint:file -- "src/server/telemetry/handler.ts" "src/server/app.ts" "src/server/security/token.ts"`. Expected: PASS. (`bun run docs:check` will now flag `src/server/telemetry/` as undocumented — a KNOWN gap closed by T25, not a regression; do not `DOCS_OK=1` a push to main from mid-increment work.)

- [ ] **Step 5: Commit** — `git add src/server/telemetry/handler.ts src/server/app.ts src/server/security/token.ts tests/server/telemetry.test.ts tests/server/token.test.ts && git commit -m "feat(server): POST /api/telemetry beacon route + sendBeacon query-token auth (D10)"`

---

### Task 22: `web/src/shared/telemetry/beacon.ts` client emitter (D10) + call it from `use-voice-input.ts`

**Files:**
- Create: `web/src/shared/telemetry/beacon.ts`
- Modify: `web/src/features/voice/use-voice-input.ts` (add `emitTelemetry` to `VoiceInputDeps`/`DEFAULT_DEPS` ~lines 40–48; measure + emit in the transcribe-completion `.then()` block, lines 169–183)
- Test: `web/src/shared/telemetry/beacon.test.ts`, `web/src/features/voice/use-voice-input.test.ts` (append)

**Interfaces:**
- Consumes: `TelemetryEvent`/`TelemetryEventSchema` (`@contracts`, T19); `window.__AGENT_TOKEN__` (read the same way as `shared/contract/client.ts:15`).
- Produces: `export function sendTelemetry(event: TelemetryEvent): void` — reads the session token, `navigator.sendBeacon('/api/telemetry?k=<token>', new Blob([JSON.stringify(event)], { type: 'application/json' }))`, fully guarded (no `navigator.sendBeacon` → no-op; never throws — fire-and-forget). `VoiceInputDeps` gains **optional** `emitTelemetry?: (e: TelemetryEvent) => void` (optional so existing hook tests' deps objects still typecheck); `DEFAULT_DEPS.emitTelemetry = sendTelemetry`.

- [ ] **Step 1: Write the failing tests** — create `web/src/shared/telemetry/beacon.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelemetry } from './beacon.ts';

const event = {
  kind: 'voice.transcribe.web',
  durationMs: 900,
  wordCount: 5,
  modelTier: 'moonshine-base',
  realTimeFactor: 0.3,
  engine: 'transformers.js',
} as const;

describe('sendTelemetry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts a JSON blob to /api/telemetry with the token in the query string', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('window', { __AGENT_TOKEN__: 'tok-42' });
    sendTelemetry(event);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe('/api/telemetry?k=tok-42');
    expect((blob as Blob).type).toBe('application/json');
  });

  it('is a silent no-op when navigator.sendBeacon is unavailable', () => {
    vi.stubGlobal('navigator', {});
    expect(() => sendTelemetry(event)).not.toThrow();
  });
});
```

Append to `web/src/features/voice/use-voice-input.test.ts` a test that a completed transcription emits a computed beacon (mirror the file's existing fake-deps construction — pass a spy `emitTelemetry` in `deps`, drive a segment's `onSegment` → resolve `transcribe` with known text, assert `emitTelemetry` was called once with `kind: 'voice.transcribe.web'`, the right `modelTier`, a `wordCount` matching the resolved text's word count, and a finite non-negative `realTimeFactor`). Reuse the existing suite's helper that wires a fake capture + fake engine; do NOT touch a real `sendBeacon`.

- [ ] **Step 2: Run tests to verify they fail** — `cd web && bun run test -- shared/telemetry/beacon.test.ts features/voice/use-voice-input.test.ts`. Expected: FAIL — `./beacon.ts` missing; `emitTelemetry` never called (hook doesn't emit yet).

- [ ] **Step 3: Write minimal implementation** — create `web/src/shared/telemetry/beacon.ts`:

```ts
import type { TelemetryEvent } from '@contracts';

/** The BFF injects window.__AGENT_TOKEN__ (empty in Vite dev) — same source as
 *  shared/contract/client.ts. */
function tokenFromWindow(): string {
  const w = globalThis as { window?: { __AGENT_TOKEN__?: string } };
  return w.window?.__AGENT_TOKEN__ ?? '';
}

/**
 * Fire-and-forget client telemetry (Slice 30b Phase 8, D10) — the first
 * client-originated telemetry in the repo. `navigator.sendBeacon` is the one
 * delivery that survives a page unload/navigation, which a completed voice
 * transcription can trigger if the user immediately Sends. The token rides the
 * query string because `sendBeacon` cannot set an Authorization header (the
 * server accepts `?k=` only for this route — see `token.ts` verifyQuery). Never
 * throws: telemetry must never break the voice path.
 */
export function sendTelemetry(event: TelemetryEvent): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
    const url = `/api/telemetry?k=${encodeURIComponent(tokenFromWindow())}`;
    const blob = new Blob([JSON.stringify(event)], { type: 'application/json' });
    navigator.sendBeacon(url, blob);
  } catch {
    // swallow — fire-and-forget
  }
}
```

In `web/src/features/voice/use-voice-input.ts`:
- import `sendTelemetry` + the `TelemetryEvent`/`ModelTier` types;
- extend `VoiceInputDeps` with `emitTelemetry?: (event: TelemetryEvent) => void;` and set `DEFAULT_DEPS.emitTelemetry = sendTelemetry`;
- in the `onSegment` callback, capture `const startedAt = performance.now();` immediately before `engine.transcribe(frames)`, and inside the existing valid-segmenter branch (after `opts.onFinal(text)`, line 181) add:

```ts
            if (text) {
              opts.onFinal(text);
              const durationMs = performance.now() - startedAt;
              const audioMs = (frames.samples.length / 16000) * 1000;
              deps.emitTelemetry?.({
                kind: 'voice.transcribe.web',
                durationMs,
                wordCount: text.trim().split(/\s+/).filter(Boolean).length,
                modelTier: opts.model,
                realTimeFactor: audioMs > 0 ? durationMs / audioMs : 0,
                engine: 'transformers.js',
              });
            }
```

(`opts.model` is a `ModelTier` enum value whose string equals a `VOICE_MODEL_TIERS` member, so it satisfies the schema.)

- [ ] **Step 4: Run tests to verify they pass** — `cd web && bun run test -- shared/telemetry/beacon.test.ts features/voice/use-voice-input.test.ts && bun run typecheck`. Expected: PASS (beacon + hook emit test + the whole pre-existing voice suite unchanged).

- [ ] **Step 5: Commit** — `git add web/src/shared/telemetry/beacon.ts web/src/shared/telemetry/beacon.test.ts web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts && git commit -m "feat(voice): client telemetry beacon on transcribe completion (D10)"`

---

### Task 23: `chat.run` root-span opener in `spans.ts` + point `run-chat.ts` at it (D9)

> **Order:** T23 before T24 — the `chat.run` span name must exist before derivation is tested against it. **Do NOT modify `withRunSpan`** — a future standalone-agent-run feature legitimately reuses its `agent.run` capability (§7.2(b)).

**Files:**
- Modify: `src/telemetry/spans.ts` (add `withChatRunSpan` beside `withRunSpan` ~lines 225–239)
- Modify: `src/cli/run-chat.ts` (import + call site, lines 7 and 21)
- Test: `tests/telemetry/chat-run-span.test.ts`

**Interfaces:**
- Consumes: `inSpan` (spans.ts:206), `ATTR.RUN_ID`/`ATTR.CONTENT_POLICY`/`ATTR.TASK`, `contentPolicyLabel`/`uncensoredEnabled`/`recordIoEnabled` (the same helpers `withRunSpan`'s body already uses), `registerTestProvider`.
- Produces: **`export function withChatRunSpan<T>(runId: string, task: string, fn: () => Promise<T>): Promise<T>`** — a `chat.run`-naming sibling of `withRunSpan` with a byte-identical attribute-setting body, differing only in `inSpan('chat.run', …)`. `runChat` (`run-chat.ts:21`) calls it instead of `withRunSpan`.

- [ ] **Step 1: Write the failing test** — create `tests/telemetry/chat-run-span.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { ATTR, withChatRunSpan, withRunSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let ctx: ReturnType<typeof registerTestProvider>;
afterEach(async () => {
  await ctx?.provider.shutdown();
});

test('withChatRunSpan opens a chat.run root carrying the run id', async () => {
  ctx = registerTestProvider();
  const out = await withChatRunSpan('run-chat-1', 'hello', async () => 'ok');
  expect(out).toBe('ok');
  const span = ctx.exporter.getFinishedSpans().find((s) => s.name === 'chat.run');
  expect(span).toBeDefined();
  expect(span?.attributes[ATTR.RUN_ID]).toBe('run-chat-1');
});

test('withRunSpan STILL opens agent.run — the generic capability is intact (§7.2b)', async () => {
  ctx = registerTestProvider();
  await withRunSpan('run-agent-1', 'task', async () => undefined);
  expect(ctx.exporter.getFinishedSpans().some((s) => s.name === 'agent.run')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/telemetry/chat-run-span.test.ts`. Expected: FAIL — `withChatRunSpan` not exported.

- [ ] **Step 3: Write minimal implementation** — in `src/telemetry/spans.ts`, add directly after `withRunSpan` (after line 239):

```ts
/**
 * Root span for one CHAT turn (Slice 30b Phase 8, D9). A `chat.run`-naming
 * sibling of `withRunSpan` with an identical body — chat turns stop borrowing
 * the generic `agent.run` name so `deriveRunKind` classifies them as
 * `RunKind.Chat` (and the web notifier never toasts a long chat turn). Kept
 * separate rather than reusing `withRunSpan` so a future standalone-agent-run
 * feature still owns the `agent.run` name.
 */
export function withChatRunSpan<T>(
  runId: string,
  task: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('chat.run', async (span) => {
    span.setAttribute(ATTR.RUN_ID, runId);
    span.setAttribute(
      ATTR.CONTENT_POLICY,
      contentPolicyLabel(uncensoredEnabled()),
    );
    if (recordIoEnabled()) span.setAttribute(ATTR.TASK, task);
    return fn();
  });
}
```

In `src/cli/run-chat.ts`: change the import on line 7 to `import { setRunOutcome, withChatRunSpan } from '../telemetry/spans.ts';` and the call on line 21 to `return await withChatRunSpan(run.id, deps.task, async () => {`.

- [ ] **Step 4: Run test to verify it passes** — `bun test tests/telemetry/chat-run-span.test.ts` then the shared chat-turn suites (`bun test tests/cli/ tests/server/chat*` or the equivalent) to confirm the rename didn't break the chat path. Then `bun run typecheck && bun run lint:file -- "src/telemetry/spans.ts" "src/cli/run-chat.ts"`.

- [ ] **Step 5: Commit** — `git add src/telemetry/spans.ts src/cli/run-chat.ts tests/telemetry/chat-run-span.test.ts && git commit -m "feat(telemetry): chat turns open a chat.run root, not agent.run (D9)"`

---

### Task 24: `RUN_ROOT_NAMES` + `deriveRunKind` gain `chat.run` (D9) + the full §7.2(a–c) regression net

**Files:**
- Modify: `src/run/run-dto.ts` (`RUN_ROOT_NAMES` set lines 36–46 + its doc comment 27–35; `deriveRunKind` lines 54–65 + its doc comment 48–53)
- Test: `tests/run/run-kind.test.ts` (append — §7.2b), `tests/run/run-summary.test.ts` (append — §7.2a), `tests/run/run-dto.test.ts` (append — real chat-shaped trace → `RunDTO.kind === Chat`)
- Test (web): `web/src/features/notifications/notify-diff.test.ts` (update §7.2c/d — pin `NOTIFIABLE_KINDS`, model a real post-fix chat run)

**Interfaces:**
- Consumes: `RUN_ROOT_NAMES`/`deriveRunKind`/`runRootSummary`/`summarizeRunListItem`/`mapRunToDto` (`run-dto.ts`), `RunKind`/`RunLifecycle` (`@contracts`), `diffRunNotifications`/`NOTIFIABLE_KINDS` invariant (`notify-diff.ts` — **unchanged**).
- Produces: `RUN_ROOT_NAMES` gains `'chat.run'`; `deriveRunKind` gains an explicit `chat.run → RunKind.Chat` branch. **`NOTIFIABLE_KINDS` is byte-for-byte unchanged** (§7.2c) — this task must not touch `notify-diff.ts`.

> **Why both edits (§7.2):** the `deriveRunKind` branch alone would classify chat as `Chat`, but omitting `'chat.run'` from `RUN_ROOT_NAMES` would make `runRootSummary` fail to find the run's lifecycle-deciding root → every chat run reads `lifecycle: Running`/`durationMs: 0` forever (a ghost row strictly worse than the notification bug). Both edits ship together.

- [ ] **Step 1: Write the failing tests.**

Append to `tests/run/run-kind.test.ts` (§7.2b):

```ts
test('deriveRunKind maps chat.run → Chat and still maps agent.run → Agent (D9, §7.2b)', () => {
  expect(deriveRunKind(['chat.run'])).toBe(RunKind.Chat);
  // The generic agent.run capability is intact for a future standalone-agent run.
  expect(deriveRunKind(['agent.run'])).toBe(RunKind.Agent);
});
```

Append to `tests/run/run-summary.test.ts` (§7.2a — reuse the file's `span`/`write` helpers):

```ts
test('a chat.run-rooted run resolves a real lifecycle/durationMs, not a ghost Running (D9, §7.2a)', async () => {
  await write('rc', [
    span({
      name: 'chat.run',
      spanId: 'c',
      durationMs: 42,
      attributes: { 'agent.outcome': 'answer' },
    }),
  ]);
  const item = await summarizeRunListItem(root, 'rc');
  expect(item?.lifecycle).toBe(RunLifecycle.Done);
  expect(item?.durationMs).toBe(42);
  expect(item?.outcome).toBe('answer');
});
```

Append to `tests/run/run-dto.test.ts` (real chat-shaped trace → non-notifiable kind, end to end through the mapper — mirror that file's existing `write`/`mapRunToDto` fixtures):

```ts
test('mapRunToDto classifies a real chat.run trace as RunKind.Chat (D9)', async () => {
  // build a chat.run-rooted run on disk, map it, assert kind === RunKind.Chat
  // and lifecycle Done — the post-fix reality a chat turn now produces.
});
```

Update `web/src/features/notifications/notify-diff.test.ts` (§7.2c/d): (i) add a test pinning the invariant `expect([...NOTIFIABLE_KINDS_or_behavior]).toEqual({Crew,Workflow,Agent})` semantics — assert a `RunKind.Chat` Running→Done run over-threshold does **not** queue AND a `RunKind.Agent`/`Crew`/`Workflow` one does, so any future edit to `NOTIFIABLE_KINDS` trips a test; (ii) relabel the existing "(d) Chat never fires" test's comment to state it now models the **post-fix real chat run** (`kind: RunKind.Chat` is what `deriveRunKind(['chat.run'])` genuinely returns — proven engine-side by the `run-kind`/`run-dto` tests above — not the pre-fix `agent.run`→`Agent` accident). Seed `prevSeen` with the run `Running`, poll it `Done`/`durationMs: 999_999`, assert `toNotify` empty.

- [ ] **Step 2: Run tests to verify they fail** — `bun test tests/run/run-kind.test.ts tests/run/run-summary.test.ts tests/run/run-dto.test.ts` and `cd web && bun run test -- notifications/notify-diff.test.ts`. Expected: FAIL — `deriveRunKind(['chat.run'])` returns `Chat` only via the default fallback (the explicit-branch assertion is fine, but the summary test fails: `chat.run` ∉ `RUN_ROOT_NAMES` → `runRootSummary` reads `Running`/`0`).

- [ ] **Step 3: Write minimal implementation** — in `src/run/run-dto.ts`:
  - add `'chat.run',` as the first entry of the `RUN_ROOT_NAMES` set (line 37) and extend its doc comment (27–35) to name `chat.run` alongside `agent.run`;
  - add `if (rootSpanNames.includes('chat.run')) return RunKind.Chat;` in `deriveRunKind` immediately before the `return RunKind.Chat;` fallback (line 64), and update the doc comment (48–53) so its "recognizes X/Y/Z" listing includes `chat.run → Chat` (the fallback stays as the catch-all for `ui.stream`/no-root).

```ts
const RUN_ROOT_NAMES: ReadonlySet<string> = new Set([
  'chat.run',
  'agent.run',
  'crew.run',
  // …unchanged…
]);
```
```ts
export function deriveRunKind(rootSpanNames: string[]): RunKind {
  if (rootSpanNames.includes('crew.run')) return RunKind.Crew;
  if (rootSpanNames.includes('workflow.run')) return RunKind.Workflow;
  if (rootSpanNames.includes('agent.run')) return RunKind.Agent;
  if (rootSpanNames.includes('chat.run')) return RunKind.Chat;
  // …build/pull/mcp/memory branches unchanged…
  return RunKind.Chat;
}
```

- [ ] **Step 4: Run tests to verify they pass** — `bun test tests/run/` and `cd web && bun run test -- notifications/notify-diff.test.ts && bun run typecheck`. Expected: PASS. Then `bun run lint:file -- "src/run/run-dto.ts"`.

- [ ] **Step 5: Commit** — `git add src/run/run-dto.ts tests/run/run-kind.test.ts tests/run/run-summary.test.ts tests/run/run-dto.test.ts web/src/features/notifications/notify-diff.test.ts && git commit -m "fix(runs): chat.run root classifies as Chat + resolves lifecycle (D9, §7.2)"`

> **Increment-4 controller boundary:** after T24, run full `bun run check` (docs:check will still flag `src/server/telemetry/` undocumented — closed by T25) + `bun test` + `cd web && bun run test`. The §7.2(d) live half (long chat does not toast; crew/workflow does) is verified in T28, not here.

---

## Increment 5 — Docs + live-verify + land (Tasks 25–29)

> No TDD for the doc tasks — the "test" is `bun run docs:check` passing green, held to the same accuracy bar (claims must match the real merged diff, not this plan's assumptions). Read the actual Increment 1–4 diffs before writing.

### Task 25: `docs/architecture.md` — Voice extension + new Telemetry section + run-kind split + a11y subsection

**Files:** Modify `docs/architecture.md`.

- [ ] **Step 1: Extend `## Voice (web UI — Slice 30b Phase 7)`** (starts line 4651) — additive notes (not a rewrite) for Increments 1–2's voice work: **D6** progressive-decode-reveal (the `TextStreamer` callback on `stt.worker.ts`'s `transcribe()`, the `transcribeInterim` response variant relayed through `stt-engine.ts`'s `onInterim` into `use-voice-input.ts`, superseding the old `'…'` placeholder — explicitly NOT real-time-during-speech: interim words appear only as Moonshine decodes the already-captured buffer after a segment closes) and **D7** (the one-pole anti-alias low-pass filter added ahead of `downsampler.ts`'s linear interpolation, filter state reset in `flush()`; module stays dependency-free).

- [ ] **Step 2: Add a new `## Telemetry (web UI — Slice 30b Phase 8)` section** — document `POST /api/telemetry` (`src/server/telemetry/handler.ts`: schema-validated `TelemetryEventSchema` body → `204` ack; sendBeacon `?k=` query-token auth because `sendBeacon` can't set headers, accepted only for this route) and the new `voice.transcribe.web` span (`recordVoiceTranscribeWeb`, attrs `voice.stt.model`/`voice.duration.ms`/`voice.word.count`/`voice.real_time_factor`/`voice.engine`), written server-side from the browser's `sendBeacon`. **Distinguish it explicitly** from the pre-existing CLI-side `voice.transcribe` span (§23, Slice 29) — different call site, different attributes, first client-originated telemetry in the repo. This closes the pre-commit `docs:check` gate that fails while `src/server/telemetry/` is undocumented.

- [ ] **Step 3: Update the run-kind/notification documentation** (§7 "Observability", around lines 1032–1034 where `RunKind`/`deriveRunKind` are documented) — record the **D9 `chat.run` vs `agent.run` split**: chat turns now open a dedicated `chat.run` root (`withChatRunSpan`), `RUN_ROOT_NAMES` + `deriveRunKind` both recognize it, chat classifies as `RunKind.Chat`, `withRunSpan`'s generic `agent.run` stays reserved for a future standalone-agent run, and `NOTIFIABLE_KINDS` is unchanged (a long chat no longer toasts). Note the accepted one-time quirk: historical pre-Phase-8 on-disk chat runs stay `agent.run`→`Agent`. Also note the tracked `run-trace.ts:100` `summarizeRun` gap (§9) — CLI-only, low-stakes, not touched.

- [ ] **Step 4: Add a new a11y subsection** under the frontend/design-system area — the `:focus-visible` design token + `sr-only` utility, real `<label>`/`aria-pressed`/`aria-label` coverage, the Library/Builders roving-tabindex tab widget, `use-reduced-motion` gating `DagView`'s JS motion, and the `vitest-axe` regression net (Increments 1–2, D1–D5).

- [ ] **Step 5: Verify + commit** — `bun run docs:check` (now green) → `git add docs/architecture.md && git commit -m "docs(architecture): Slice 30b Phase 8 — voice D6/D7, telemetry, chat.run split, a11y"`

---

### Task 26: `README.md` + `docs/ROADMAP.md` — status/tables + capability flip + barge-in→dictation reconciliation

**Files:** Modify `README.md`, `docs/ROADMAP.md`.

- [ ] **Step 1: `README.md`.**
  - Status blockquote (lines 112–126): the Slice 30b line goes from "partial-slice / capability stays 🟡" to **"Slice 30b COMPLETE — capability ✅"**, listing Phases 1–8; the `Next:` pointer (line 116) advances **past 30b** (to the next product-line item — Slice 24 daemon / the `ai@7`-blocked E line, matching the "Next (product line)" row's framing).
  - Slice-status table row **30b** (line 885): append the Phase-8 summary (a11y WCAG 2.1 AA, progressive-decode reveal + anti-alias filter, ⌘K completeness, the D9 chat.run notification fix, the D10 `voice.transcribe.web` beacon), add the new `docs/architecture.md` §Telemetry anchor, and **flip the status cell** `🚧 In progress — Phases … 7 landed` → **✅ Done**.
  - "Next (product line)" row (line 886): drop "Slice 30b Phase 8 onward"; state 30b shipped in full (dictation-only voice — NOT barge-in, which stays explicit future scope).
  - Feature narrative: add a short "Polish + a11y + observability (web UI — Slice 30b Phase 8)" paragraph. Honest caveats: barge-in/TTS voice-out and real-time-during-speech ASR remain future scope (not debt); the `run-trace.ts:100` CLI `summarizeRun` gap is tracked, not fixed.

- [ ] **Step 2: `docs/ROADMAP.md`.**
  - **Gap table row 224 (`TUI / local web UI`):** flip 🟡 → **✅ shipped (Slice 30b, Phase 8)**; rewrite the "in progress … polish/a11y phase pending" prose to "all 8 phases landed."
  - **Recommended-sequence item 21** (lines 313–351): flip the Phase-8 sub-bullet (line 351) `— not yet started.` → **✅ shipped**; add its summary (D1–D10, adversarial §7.1/§7.2 verification, live-verify) mirroring the Phase-7 sub-bullet's style; mark the parent item 21 header as shipped/complete.
  - **Partial-slice notes** (lines 345–346 area and the Phase-7 "partial-slice landing … 30b stays 🟡" wording) → reconcile to "full-slice landing, 30b ✅."
  - **Voice INPUT / recommended-seq item 20** and any parent-spec "voice **barge-in**" criterion citation: reconcile to **dictation-only** everywhere (spec §9 — the parent spec's build-order item 8 listed "voice barge-in" as a live-verify criterion inherited from before Phase 7 locked voice to dictation; this phase corrects it in spec citations, README, and ROADMAP rather than building it).

- [ ] **Step 3: Verify + commit** — `bun run docs:check` → `git add README.md docs/ROADMAP.md && git commit -m "docs(readme,roadmap): Slice 30b Phase 8 — flip 30b capability ✅, dictation-only reconcile"`

---

### Task 27: SDD ledger closeout — `.superpowers/sdd/progress.md` §"SLICE 30b — PHASE 8"

**Files:** Modify `.superpowers/sdd/progress.md`.

- [ ] **Step 1: Append a section header** mirroring the `## SLICE 30b — PHASE 7 (Browser Voice Input)` format exactly (line 1182): branch/base, spec ref, plan refs (Parts A/B/C), model tiering + gate summary, the 5-increment structure.

- [ ] **Step 2: Per-task recovery lines** — one `- ✅` commit-reference line per task T1…T29 across all three plan parts, plus the fix-wave / adversarial-verify (Increment 2 §7.1 + Increment 4 §7.2) / live-verify / landing entries — filled in DURING execution, mirroring the literal bullet format the Phase-7 section already uses (read lines 1182–1221 for the format before appending). Record the §7.2(a–d) adversarial findings and the §7.1 progressive-decode-ordering verification verbatim.

- [ ] **Step 3: Verify + commit** — `bun run docs:check` → `git add .superpowers/sdd/progress.md && git commit -m "chore(sdd): Slice 30b Phase 8 ledger — section header + recovery map"`

---

### Task 28: GATED live-verify (real browser + Ollama) — MANUAL, describe steps + pass criteria

> Not automated asserts — a manual/gated checklist per the standing Live-verify-before-merge gate, covering all 5 increments. Reuse `bun run test:voice-e2e` (Vitest browser-mode + fake-audio harness) where it can stand in for a step; anything it can't cover is driven by hand in a real browser against a real Ollama. Findings feed a fix wave BEFORE landing (T29).

**Files:** none (produces findings, not code).

- [ ] **Step 1: Boot** — `bun run web`, open the printed URL + token in a real Chrome (native `/chrome`, logged-in session).
- [ ] **Step 2: A11y keyboard + SR (Increment 1, D1–D4)** — Tab through Chat/Settings: every control shows the `:focus-visible` ring; the composer `<textarea>` and Settings model-tier `<select>` have real labels; theme/voice/OS-notify toggles announce `aria-pressed` state; the three `<aside>` landmarks are named. On Library and Builders, arrow keys move between tabs (roving tabindex) and each tab's `aria-controls` resolves to its `role="tabpanel"`. **Pass:** a keyboard-only + screen-reader pass with no trapped focus and no unlabeled control. (`vitest-axe` baseline already green in CI — this is the human confirmation.)
- [ ] **Step 3: Reduced motion (D3)** — enable OS "reduce motion"; open a run's `DagView`. **Pass:** no animated `fitView` pan/zoom (JS motion is gated, not just CSS).
- [ ] **Step 4: Dictation progressive reveal (Increment 2, D6/D7)** — enable voice in Settings; hold-to-talk a sentence, release. **Pass:** interim words appear progressively as the captured buffer decodes (after release, never during speech), then the final transcript replaces them in the composer; a fast double-tap never bleeds one segment's interim into the next (§7.1 a–d, human confirmation of the adversarially-verified behavior). Where possible run `bun run test:voice-e2e` first and only hand-verify the reveal timing.
- [ ] **Step 5: Telemetry span lands (Increment 4, D10)** — after a transcription completes, confirm (via `bun run usage` or reading the run's `spans.jsonl`) a `voice.transcribe.web` span with `voice.word.count`/`voice.real_time_factor`/`voice.engine`. **Pass:** span present with plausible attrs; the beacon survived even if the message was Sent immediately.
- [ ] **Step 6: §7.2(d) chat-vs-crew notification** — temporarily lower `AGENT_WEB_NOTIFY_MIN_DURATION_MS`/`AGENT_WEB_NOTIFY_POLL_MS` via env. Run a **long chat turn** (navigate away from the tab while it runs). **Pass:** NO completion toast fires for the chat turn. Then launch a **crew or workflow** run exceeding the threshold. **Pass:** a toast (and, if enabled + permission granted, an OS `Notification`) DOES fire. This is the live half of the D9 fix.
- [ ] **Step 7: ⌘K + Stop + trace render (Increment 3 + regression)** — open ⌘K: the voice/theme toggle action commands fire (not nav), `go-agents` navigates, the deduped jump-to-* set resolves to distinct destinations, "jump to a recent run" deep-links a `runId`. Confirm Stop cancels an in-flight chat and the run-detail waterfall/trace still renders.
- [ ] **Step 8: Record findings** — note any live-only defect for the pre-land fix wave; do not silently work around.

---

### Task 29: Regenerate the docs-snapshot Artifact (controller-owned) + FULL-SLICE LAND

> The Artifact is a claude.ai-hosted page, not a repo file — tooling can only remind; the controller regenerates it directly per `reference-artifact-regen-mechanics`. **This is a full-slice landing** — Phase 8 is the FINAL phase of Slice 30b, so the 30b capability flips 🟡 → ✅.

**Files:** the whole-branch merge (no new source).

- [ ] **Step 1: Whole-branch fan-out review** — 2–3 parallel reviewers (Opus/Fable per model-tiering) over the full `main...HEAD` diff (Increments 1–5): **correctness** (re-confirm the §7.2 a–c regressions hold against the merged whole — `chat.run` resolves lifecycle, `agent.run` still → Agent, `NOTIFIABLE_KINDS` byte-unchanged; the §7.1 progressive-decode ordering); **security** (the `?k=` query-token path is scoped to `POST /api/telemetry` only and constant-time compared; the perimeter still fronts it; the beacon never leaks the token cross-origin); **docs accuracy** (T25/T26/T27 claims vs the real diff — the Slice-9-audit bar); **a11y** (WCAG 2.1 AA against D1–D5). Fold findings into a fix wave before landing; re-run affected T28 steps.
- [ ] **Step 2: Full gate** — `bun run check` (docs:check · typecheck · lint · check:web · test) + `cd web && bun run test`, all green. Capture the real pass counts for the Artifact footer.
- [ ] **Step 3: Merge + push (slice-landing gate)** — merge the phase-8 branch `--no-ff` into `main` and push, with `README.md` + `docs/ROADMAP.md` + `.superpowers/sdd/progress.md` all changed in the **same push** as `docs/architecture.md` (the pre-push slice-landing gate requires all four together). The ROADMAP gap-table 30b marker is flipped 🟡 → **✅** in this same push (T26). No `DOCS_OK=1` bypass.
- [ ] **Step 4: Regenerate the docs-snapshot Artifact** (closing action, after the merge lands so counts reflect merged `main`): locate the existing Artifact URL (`action: "list"` if not in hand); add nodes `src/server/telemetry/` (POST /api/telemetry), `web/src/shared/telemetry/beacon.ts`, `web/src/shared/a11y/use-reduced-motion.ts`, the `voice.transcribe.web` span; add edges `beacon → POST /api/telemetry → voice.transcribe.web span` and the `chat.run` root-span split note on the run-kind node; bump the footer's slice count + **real** test count (post-merge `bun test` + `cd web && bun run test` numbers, never estimated); validate with `node --check` + referential integrity before republishing.
