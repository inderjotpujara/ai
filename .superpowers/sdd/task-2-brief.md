### Task 2: Blueprint-Mono design-token system (light + dark)

**Files:**
- Create: `web/src/shared/design/tokens.css`
- Test: `web/src/shared/design/tokens.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--color-bg`, `--color-accent`, `--color-signal`, `--color-fg`, `--color-muted`, `--font-sans`, `--font-mono`, motion tokens; the `.dark` variant; font-family names "Geist Variable" / "Geist Mono Variable" (fonts imported in `main.tsx`, Task 6).

- [ ] **Step 1: Write the failing test** (a token-presence contract guarding the palette literals)

`web/src/shared/design/tokens.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf8');

describe('Blueprint-Mono tokens', () => {
  it('imports Tailwind v4 and declares the class-toggled dark variant', () => {
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain('@custom-variant dark');
  });
  it('defines the locked Blueprint-Mono palette literals', () => {
    expect(css).toContain('#0B0C0E'); // near-black base
    expect(css).toContain('#4C8DFF'); // blueprint-blue accent
    expect(css).toContain('#35D0C0'); // signal teal
  });
  it('ships both a dark base and a functional light theme', () => {
    expect(css).toMatch(/@theme/);
    expect(css).toMatch(/\.dark\b/);
  });
  it('honors prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test src/shared/design/tokens.test.ts`
Expected: FAIL — cannot read `tokens.css` (ENOENT).

- [ ] **Step 3: Write `tokens.css`**

`web/src/shared/design/tokens.css`:
```css
@import "tailwindcss";

/* Class-toggled dark mode (Task 3 toggles the .dark class on <html>).
   Without this, dark: only follows OS prefers-color-scheme. */
@custom-variant dark (&:where(.dark, .dark *));

/* Blueprint-Mono tokens → :root vars + Tailwind utilities.
   Palette literals live ONLY here. */
@theme {
  --color-bg: #0B0C0E;          /* near-black canvas */
  --color-surface: #14161A;
  --color-fg: #E6E8EC;
  --color-muted: #8A8F98;
  --color-accent: #4C8DFF;      /* blueprint-blue — live/interactive only */
  --color-signal: #35D0C0;      /* signal teal */
  --color-border: #23262D;

  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, "SF Mono", monospace;

  --spacing-rail: 18rem;        /* sessions sidebar width */

  --ease-spring: linear(0, 0.12, 0.45, 0.79, 0.96, 1);
  --duration-fast: 140ms;
}

/* Dark is the design's home; the functional light theme overrides tokens only. */
:root {
  color-scheme: dark;
  --color-bg: #0B0C0E;
  --color-surface: #14161A;
  --color-fg: #E6E8EC;
  --color-muted: #8A8F98;
  --color-border: #23262D;
}
:root:where(.light) {
  color-scheme: light;
  --color-bg: #FBFBFC;
  --color-surface: #FFFFFF;
  --color-fg: #14161A;
  --color-muted: #5B616B;
  --color-border: #E3E5E9;
  /* accent + signal are shared across themes */
}

body {
  background-color: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
  /* subtle blueprint dot-grid */
  background-image: radial-gradient(var(--color-border) 1px, transparent 1px);
  background-size: 24px 24px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
```

_Note: the `.dark`/`.light` class strategy — default (no class) = dark; `.light` class = light. Task 3's `ThemeProvider` toggles the `light` class. The `@custom-variant dark` line keeps `dark:` utilities working when neither class or the `.dark` class is present._

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test src/shared/design/tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/design/tokens.css web/src/shared/design/tokens.test.ts
git commit -m "feat(web): Blueprint-Mono design tokens — light+dark, reduced-motion, Geist"
```

---

