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

