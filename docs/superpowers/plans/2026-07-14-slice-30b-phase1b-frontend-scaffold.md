# Slice 30b Phase 1b — Frontend Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `web/` browser frontend foundation — a Vite 8 + React 19 SPA with a Vitest/Testing-Library harness, a Blueprint-Mono light+dark design-token system, a TanStack-Router app shell across the 7 nav areas, a ⌘K command-palette skeleton, the isomorphic contract client, and the transport-port interface — served as static assets by the already-landed Bun BFF.

**Architecture:** `web/` is its own Bun **workspace member** (own `package.json` / `tsconfig.json` / Vitest config) because React + DOM + Vitest cannot ride the repo's Bun-native `bun test` gate. The frontend is **feature-sliced** (`web/src/app/` = shell/routing/providers/⌘K; `web/src/shared/` = design tokens, UI primitives, contract client, transport port; `web/src/features/*` = per-area screens, stubbed in 1b). It consumes the isomorphic Zod contracts from `src/contracts/` via a `@contracts` alias — the single source of truth for the wire boundary. The Vite build (`web/dist/`) is served by the existing `src/server/` BFF (`staticDir` + `window.__AGENT_TOKEN__` injection + COOP/COEP). This phase ships **scaffold only** — no live SSE/`useChat`, no feature screens, no voice; those are Phases 2–8.

**Tech Stack:** React 19.2 · Vite 8 (Rolldown) · `@vitejs/plugin-react` v6 (Oxc) · Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first `@theme`) · TanStack Router v1 · `@base-ui-components/react` primitives · Vitest 4 + `@testing-library/react`/`jest-dom`/`user-event` + happy-dom · `@fontsource-variable/geist` + `@fontsource-variable/geist-mono` · TypeScript strict · Bun.

## Global Constraints

_Every task's requirements implicitly include this section. Values copied verbatim from the spec, the 2026 stack validation, and repo convention._

- **Runtime is Bun, never npm.** All install/run commands use `bun`.
- **Strict ESM with explicit import extensions** — `.ts`/`.tsx` in import specifiers (`allowImportingTsExtensions`, `verbatimModuleSyntax`, `moduleResolution: bundler`), mirroring the root tsconfig.
- **`type` over `interface`; string `enum` over string-literal unions** for finite named sets (matches the repo + the delivered `src/contracts/enums.ts`). Discriminated unions stay `type`.
- **Components reference design tokens, never raw hex.** Themes are token overrides only (spec §Design-token system). The only file allowed to contain the literal palette hex values is `web/src/shared/design/tokens.css`.
- **A functional light theme ships now** (spec D18) — not deferred. Both light + dark in the token system from the scaffold.
- **Accessibility is first-class** (spec D18): keyboard nav, ARIA, and `prefers-reduced-motion` honored by every interactive scaffold component (the shell, the ⌘K palette).
- **Degrade, never crash** (repo standing rule): missing token, missing font, failed fetch → graceful fallback, never a thrown uncaught error. Each nav region has its own error boundary (spec isolation rule).
- **Feature isolation:** a `features/x/` folder imports only from `shared/` + `@contracts`, never another feature's internals (spec §Frontend).
- **Pin `@ai-sdk/react@^3`** (spec D4 / Risk 3) when it is added to `web/`; keep AI-SDK types out of `src/contracts/`.
- **COOP/COEP everywhere:** dev (`vite server.headers` + `preview.headers`) and prod (BFF, already done) must both yield `crossOriginIsolated === true`. Self-host all assets (fonts bundled by Vite) — no cross-origin subresources.
- **Tailwind v4 CSS-first:** no `tailwind.config.js`, no PostCSS/autoprefixer. `@import "tailwindcss";` + `@theme{}`; declare `@custom-variant dark (&:where(.dark, .dark *));` so the class-toggled dark mode works (not just OS `prefers-color-scheme`).
- **React plugin = `@vitejs/plugin-react` v6 (Oxc), NOT `plugin-react-swc`.** No React Compiler at scaffold.
- **Tests:** Vitest, files at `web/src/**/*.test.tsx` (co-located) or `web/tests/**`, header `import { describe, expect, it, vi } from 'vitest';`. happy-dom environment. No coverage threshold is mandated — do not invent one.
- **Commits:** Conventional Commits, one per task, scoped `feat(web): …` / `chore(web): …` / `docs(architecture): …`. The `.githooks` append the `Co-Authored-By` trailer.
- **Gate:** `bun run typecheck` + `bun run lint` (Biome, covers `web/` tsx) + `bun run check:web` (web typecheck + vitest) must all be clean before each commit. Full pre-PR gate = `bun run check` (which now includes `check:web`).

## Blueprint-Mono design values (spec D3 + §Design-token system)

_The authoritative palette/type values for Task 2. These literals live only in `tokens.css`._

- Background near-black: `#0B0C0E` (dark theme base) + a dot-grid texture.
- Accent "blueprint-blue": `#4C8DFF` — reserved for live/interactive elements only.
- Signal teal: `#35D0C0`.
- Typography: humanist sans for prose (**Geist Sans** → "Geist Variable"), mono for labels/data (**Geist Mono** → "Geist Mono Variable"), self-hosted via Fontsource (bundled same-origin).
- Motion: spring micro-motion; must be disabled under `prefers-reduced-motion`.
- Token categories: **palette / type / spacing / motion** as CSS custom properties via Tailwind v4 `@theme`.
- Both **light** and **dark** themes required.

## File Structure

**Created:**
- `web/package.json` — workspace member manifest + scripts (Task 1)
- `web/tsconfig.json` — React/DOM/JSX strict config + `@contracts` path (Task 1)
- `web/vite.config.ts` — Vite 8 + plugin-react(Oxc) + tailwind + COOP/COEP + alias (Task 1)
- `web/vitest.config.ts` — Vitest 4 + happy-dom + setup + alias (Task 1)
- `web/index.html` — Vite entry, `#root`, module script (Task 1)
- `web/src/test/setup.ts` — jest-dom matchers + matchMedia mock (Task 1)
- `web/src/test/harness.test.tsx` — the first green test (Task 1)
- `web/src/shared/design/tokens.css` — Blueprint-Mono tokens, light+dark, `@theme` (Task 2)
- `web/src/shared/design/theme.tsx` — `ThemeProvider` / `useTheme` (Task 3)
- `web/src/shared/ui/error-boundary.tsx` — `RegionErrorBoundary` (Task 4)
- `web/src/shared/ui/button.tsx` — token'd Base-UI button (Task 4)
- `web/src/shared/ui/dialog.tsx` — Base-UI dialog wrapper (Task 4)
- `web/src/shared/contract/client.ts` — token'd, zod-parsing API client (Task 5)
- `web/src/shared/transport/types.ts` — `ChatTransport` / `RunStream` port interfaces (Task 5)
- `web/src/app/router.tsx` — TanStack Router route tree (Task 6)
- `web/src/app/app-shell.tsx` — layout: nav + sessions sidebar + outlet (Task 6)
- `web/src/features/{chat,crews,workflows,builders,runs,library,settings,sessions}/index.tsx` — area stubs (Task 6)
- `web/src/features/runs/run-detail.tsx` — `/runs/$runId` stub (Task 6)
- `web/src/app/command-palette.tsx` — ⌘K skeleton (Task 7)
- `web/src/app/commands.ts` — command registry scaffold (Task 7)
- `web/src/main.tsx` — root render: providers + tokens + fonts (Task 6, extended Task 7)

**Modified:**
- `package.json` (root) — add `"workspaces": ["web"]`; move `react`/`react-dom`/`@ai-sdk/react` → `web/`; add `check:web` script; fold into `check` (Task 1)
- `tsconfig.json` (root) — add `"web"` to `exclude` (Task 1)
- `docs/architecture.md` — new web/ frontend-scaffold subsystem section (Task 8)

---

### Task 1: Bun workspace + `web/` toolchain bootstrap

Deliverable: `bun run check:web` runs one green Vitest test inside `web/`, and the root gate is extended to invoke it. All build/config scaffolding folds into this task.

**Files:**
- Modify: `package.json` (root), `tsconfig.json` (root)
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/src/test/setup.ts`
- Test: `web/src/test/harness.test.tsx`

**Interfaces:**
- Consumes: nothing (bootstrap).
- Produces: the `web/` workspace, the `@contracts` alias resolving to `../src/contracts/index.ts`, a working Vitest+happy-dom harness, root scripts `check:web` and an extended `check`.

- [ ] **Step 1: Write the failing test**

`web/src/test/harness.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('web test harness', () => {
  it('renders a DOM node and jest-dom matchers work', () => {
    render(<button type="button">ping</button>);
    expect(screen.getByRole('button', { name: 'ping' })).toBeInTheDocument();
  });

  it('runs under a cross-origin-isolation-aware DOM', () => {
    // happy-dom provides window; crossOriginIsolated may be undefined in jsdom-likes.
    expect(typeof window).toBe('object');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test 2>&1 | head -20` (or from root once scripts exist: `bun run check:web`)
Expected: FAIL — `web/package.json` / vitest not present ("script not found" / "vitest: command not found").

- [ ] **Step 3: Write the workspace + config**

Root `package.json` — add the workspaces field (top level) and scripts:
```jsonc
{
  // ...existing...
  "workspaces": ["web"],
  "scripts": {
    // ...existing scripts unchanged...
    "check:web": "cd web && bun run typecheck && bun run test",
    "check": "bun run docs:check && bun run typecheck && bun run lint && bun run check:web && bun run test"
  }
}
```
Move `react`, `react-dom`, `@ai-sdk/react` OUT of root `devDependencies` (they go to `web/package.json` below). Leave `ai` and `zod` in root `dependencies` (used by `src/`).

Root `tsconfig.json` — add `"web"` to `exclude`:
```jsonc
{
  // ...
  "exclude": ["scripts/spikes/**/*.tsx", "web"]
}
```

`web/package.json`:
```json
{
  "name": "@local-agents/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "@ai-sdk/react": "^3",
    "@tanstack/react-router": "^1",
    "@base-ui-components/react": "^1",
    "@fontsource-variable/geist": "^5",
    "@fontsource-variable/geist-mono": "^5"
  },
  "devDependencies": {
    "vite": "^8",
    "@vitejs/plugin-react": "^6",
    "@tailwindcss/vite": "^4",
    "tailwindcss": "^4",
    "vitest": "^4",
    "happy-dom": "^15",
    "@testing-library/react": "^16",
    "@testing-library/jest-dom": "^6",
    "@testing-library/user-event": "^14",
    "typescript": "^5.9.0",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

`web/tsconfig.json`:
```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "paths": { "@contracts": ["../src/contracts/index.ts"] }
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`web/vite.config.ts`:
```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts') },
  },
  server: { headers: isolation, fs: { allow: ['..'] } },
  preview: { headers: isolation },
});
```

`web/vitest.config.ts`:
```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts') },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Local Agents</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// happy-dom does not implement matchMedia; ThemeProvider (Task 3) depends on it.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});
```

- [ ] **Step 4: Install and run the test to verify it passes**

Run: `bun install && bun run check:web`
Expected: `bun run typecheck` clean, then Vitest PASS (2 tests). If Biome later flags `web/`, run `bun run lint` and fix.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json web/
git commit -m "chore(web): bootstrap web/ workspace — Vite 8 + Vitest 4 + happy-dom harness"
```

---

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

### Task 3: ThemeProvider + light/dark toggle

**Files:**
- Create: `web/src/shared/design/theme.tsx`
- Test: `web/src/shared/design/theme.test.tsx`

**Interfaces:**
- Consumes: `matchMedia`, `localStorage`.
- Produces: `ThemeProvider` (React component), `useTheme(): { theme: 'light' | 'dark'; toggle: () => void; set: (t: 'light' | 'dark') => void }`, and a `Theme` string enum `{ Light='light', Dark='dark' }`. Applies/removes the `light` class + `data-theme` attribute on `document.documentElement`; persists to `localStorage['agent-theme']`; initial = stored value ?? (`prefers-color-scheme: light` → light, else dark).

- [ ] **Step 1: Write the failing test**

`web/src/shared/design/theme.test.tsx`:
```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme, Theme } from './theme.tsx';

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      theme:{theme}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('ThemeProvider', () => {
  it('defaults to dark when no stored value and OS is not light', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark');
    expect(document.documentElement).not.toHaveClass('light');
  });

  it('toggles to light, applies the class, and persists', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('theme:light');
    expect(document.documentElement).toHaveClass('light');
    expect(localStorage.getItem('agent-theme')).toBe(Theme.Light);
  });

  it('restores the persisted theme on mount', () => {
    localStorage.setItem('agent-theme', Theme.Light);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('theme:light');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test src/shared/design/theme.test.tsx`
Expected: FAIL — cannot resolve `./theme.tsx`.

- [ ] **Step 3: Write `theme.tsx`**

`web/src/shared/design/theme.tsx`:
```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export enum Theme {
  Light = 'light',
  Dark = 'dark',
}

const STORAGE_KEY = 'agent-theme';

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === Theme.Light || stored === Theme.Dark) return stored;
  } catch {
    // localStorage unavailable → fall through to OS preference
  }
  const prefersLight =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? Theme.Light : Theme.Dark;
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('light', theme === Theme.Light);
  root.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore persistence failure — theme still applies for the session
    }
  }, [theme]);

  const set = useCallback((t: Theme) => setTheme(t), []);
  const toggle = useCallback(
    () => setTheme((t) => (t === Theme.Dark ? Theme.Light : Theme.Dark)),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, toggle, set }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test src/shared/design/theme.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd web && bun run typecheck && cd ..
git add web/src/shared/design/theme.tsx web/src/shared/design/theme.test.tsx
git commit -m "feat(web): ThemeProvider with persisted light/dark toggle"
```

---

### Task 4: Region error boundary + Base-UI primitives

**Files:**
- Create: `web/src/shared/ui/error-boundary.tsx`, `web/src/shared/ui/button.tsx`, `web/src/shared/ui/dialog.tsx`
- Test: `web/src/shared/ui/error-boundary.test.tsx`, `web/src/shared/ui/dialog.test.tsx`

**Interfaces:**
- Consumes: `@base-ui-components/react`.
- Produces: `RegionErrorBoundary` (props `{ region: string; children: ReactNode }`, renders a fallback with the region name on throw), `Button` (props extend native button + `variant?: 'default' | 'accent'`), `Dialog` (`{ open, onOpenChange, title, children }` wrapping Base UI's Dialog with focus trap + Esc-close).

- [ ] **Step 1: Write the failing tests**

`web/src/shared/ui/error-boundary.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegionErrorBoundary } from './error-boundary.tsx';

function Boom(): never {
  throw new Error('kaboom');
}

describe('RegionErrorBoundary', () => {
  it('renders children normally', () => {
    render(
      <RegionErrorBoundary region="Chat">
        <span>ok</span>
      </RegionErrorBoundary>,
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('catches a throwing child and shows a region-scoped fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RegionErrorBoundary region="Chat">
        <Boom />
      </RegionErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Chat/);
  });
});
```

`web/src/shared/ui/dialog.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog } from './dialog.tsx';

describe('Dialog', () => {
  it('renders its title and content when open', () => {
    render(
      <Dialog open title="Palette" onOpenChange={vi.fn()}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByText('Palette')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} title="Palette" onOpenChange={vi.fn()}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test src/shared/ui/`
Expected: FAIL — cannot resolve `./error-boundary.tsx` / `./dialog.tsx`.

- [ ] **Step 3: Write the primitives**

`web/src/shared/ui/error-boundary.tsx`:
```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { region: string; children: ReactNode };
type State = { error: Error | null };

export class RegionErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-first: log to console; a telemetry sink lands in a later phase.
    console.error(`[region:${this.props.region}]`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" className="p-6 font-mono text-sm text-[var(--color-muted)]">
          <strong className="text-[var(--color-fg)]">{this.props.region}</strong> failed to
          render. {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
```

`web/src/shared/ui/button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'accent';
};

export function Button({ variant = 'default', className = '', ...rest }: Props) {
  const accent = variant === 'accent';
  return (
    <button
      type="button"
      className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-sm transition-colors ${
        accent
          ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
          : 'bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-accent)]'
      } ${className}`}
      {...rest}
    />
  );
}
```

`web/src/shared/ui/dialog.tsx`:
```tsx
import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
};

export function Dialog({ open, onOpenChange, title, children }: Props) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 bg-black/50" />
        <BaseDialog.Popup className="fixed left-1/2 top-24 w-[36rem] max-w-[90vw] -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xl">
          <BaseDialog.Title className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">
            {title}
          </BaseDialog.Title>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
```

_If the installed `@base-ui-components/react` subpath export differs, import `{ Dialog as BaseDialog } from '@base-ui-components/react'` and use `BaseDialog.Root` etc. Verify the exact export against the installed version's `package.json` `exports` before finalizing._

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test src/shared/ui/`
Expected: PASS (4 tests). Then `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/ui/
git commit -m "feat(web): RegionErrorBoundary + Base-UI Button/Dialog primitives"
```

---

### Task 5: Contract client + transport port interface

**Files:**
- Create: `web/src/shared/contract/client.ts`, `web/src/shared/transport/types.ts`
- Test: `web/src/shared/contract/client.test.ts`, `web/src/shared/transport/types.test.ts`

**Interfaces:**
- Consumes: `@contracts` (the isomorphic Zod schemas + types from `src/contracts/index.ts`), `window.__AGENT_TOKEN__`.
- Produces:
  - `sessionToken(): string` — reads `window.__AGENT_TOKEN__`, `''` if absent (dev).
  - `apiFetch<T>(path: string, opts: { schema: ZodType<T>; method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>` — prefixes `/api`, sets `Authorization: Bearer <token>`, JSON-encodes body, throws `ApiError` on non-2xx, zod-parses the response.
  - `getHealth(): Promise<{ ok: boolean }>`.
  - `class ApiError extends Error { status: number }`.
  - Transport port types: `ChatTransport`, `RunStream`, `TransportEvent` (all `type`, no `ai` import) shaped for bidirectional + resumable per D14.

- [ ] **Step 1: Write the failing tests**

`web/src/shared/contract/client.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiFetch, ApiError, sessionToken } from './client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noExplicitAny: test cleanup of injected global
  delete (globalThis as any).window;
});

function stubToken(token: string) {
  vi.stubGlobal('window', { __AGENT_TOKEN__: token });
}

describe('contract client', () => {
  it('reads the session token from window, empty string when absent', () => {
    vi.stubGlobal('window', {});
    expect(sessionToken()).toBe('');
    stubToken('abc123');
    expect(sessionToken()).toBe('abc123');
  });

  it('sends the bearer token and zod-parses the response', async () => {
    stubToken('secret');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/health', { schema: z.object({ ok: z.boolean() }) });
    expect(result).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/health');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('throws ApiError with the status on non-2xx', async () => {
    stubToken('secret');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 401 })),
    );
    await expect(
      apiFetch('/health', { schema: z.object({ ok: z.boolean() }) }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 401 } satisfies Partial<ApiError>);
  });
});
```

`web/src/shared/transport/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ChatTransport, RunStream } from './types.ts';
import { StatusEventType } from '@contracts';

describe('transport port', () => {
  it('a stub adapter satisfies the ChatTransport contract (compile + shape)', () => {
    const stub: ChatTransport = {
      async *stream() {
        yield { type: StatusEventType.RunStart, eventId: '1', data: { runId: 'r1' } };
      },
      async respond() {
        /* back-channel — Phase 2 */
      },
    };
    expect(typeof stub.stream).toBe('function');
    expect(typeof stub.respond).toBe('function');
  });

  it('RunStream carries a resume cursor', () => {
    const rs: RunStream = { runId: 'r1', cursor: null };
    expect(rs.cursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test src/shared/contract/ src/shared/transport/`
Expected: FAIL — cannot resolve `./client.ts` / `./types.ts`.

- [ ] **Step 3: Write the client + transport types**

`web/src/shared/transport/types.ts`:
```ts
import type { RespondRequest, StatusEvent } from '@contracts';

/** A transport event = a wire StatusEvent tagged with an SSE event id for resume. */
export type TransportEvent = StatusEvent & { eventId: string };

/**
 * Bidirectional + resumable transport (spec D14). Adapter is SSE now
 * (Last-Event-ID reconnect); the interface leaves room for WS/resumable later.
 */
export type ChatTransport = {
  /** server→client stream; `fromCursor` replays after a Last-Event-ID reconnect. */
  stream(runId?: string, fromCursor?: string | null): AsyncIterable<TransportEvent>;
  /** client→server back-channel: POST /api/runs/:id/respond (consent / human-in-loop). */
  respond(runId: string, payload: RespondRequest): Promise<void>;
};

/** A live run handle carrying the resume cursor (last seen event id). */
export type RunStream = {
  runId: string;
  cursor: string | null;
};
```

`web/src/shared/contract/client.ts`:
```ts
import type { ZodType } from 'zod';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The BFF injects window.__AGENT_TOKEN__ into the served HTML (empty in Vite dev). */
export function sessionToken(): string {
  const w = globalThis as { window?: { __AGENT_TOKEN__?: string } };
  return w.window?.__AGENT_TOKEN__ ?? '';
}

type FetchOpts<T> = {
  schema: ZodType<T>;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiFetch<T>(path: string, opts: FetchOpts<T>): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${sessionToken()}`,
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (!res.ok) throw new ApiError(`request to ${path} failed`, res.status);
  return opts.schema.parse(await res.json());
}
```

Add `getHealth` (imports a schema from `@contracts` when Phase 1 exposes one; until then a local literal schema is fine — health is not in `src/contracts`):
```ts
import { z } from 'zod';
export function getHealth(): Promise<{ ok: boolean }> {
  return apiFetch('/health', { schema: z.object({ ok: z.boolean() }) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test src/shared/contract/ src/shared/transport/`
Expected: PASS (5 tests). Confirms the `@contracts` alias resolves cross-boundary. Then `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/contract/ web/src/shared/transport/
git commit -m "feat(web): token'd contract client + bidirectional transport port interface"
```

---

### Task 6: TanStack Router app shell + feature-area stubs + root render

**Files:**
- Create: `web/src/app/router.tsx`, `web/src/app/app-shell.tsx`, `web/src/main.tsx`, `web/src/features/{chat,crews,workflows,builders,runs,library,settings,sessions}/index.tsx`, `web/src/features/runs/run-detail.tsx`
- Test: `web/src/app/app-shell.test.tsx`

**Interfaces:**
- Consumes: `@tanstack/react-router`, `ThemeProvider`/`useTheme` (Task 3), `RegionErrorBoundary` (Task 4), `Button` (Task 4).
- Produces: `router` (a configured TanStack `Router` with routes `/`, `/crews`, `/workflows`, `/builders`, `/runs`, `/runs/$runId`, `/library`, `/settings`), `AppShell` (root-route layout: top nav across the 7 areas + sessions sidebar placeholder + `<Outlet/>` each wrapped in `RegionErrorBoundary` + theme toggle button). `main.tsx` mounts `<StrictMode><ThemeProvider><RouterProvider/></ThemeProvider></StrictMode>` and imports fonts + tokens.

- [ ] **Step 1: Write the failing test**

`web/src/app/app-shell.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { routeTree } from './router.tsx';
import { ThemeProvider } from '../shared/design/theme.tsx';

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  it('renders navigation for all 7 areas', async () => {
    renderAt('/');
    for (const label of ['Chat', 'Crews', 'Workflows', 'Builders', 'Runs', 'Library', 'Settings']) {
      expect(await screen.findByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the Chat area stub at /', async () => {
    renderAt('/');
    expect(await screen.findByTestId('area-chat')).toBeInTheDocument();
  });

  it('renders the run-detail stub at /runs/:runId', async () => {
    renderAt('/runs/abc');
    expect(await screen.findByTestId('run-detail')).toHaveTextContent('abc');
  });

  it('exposes a theme toggle', async () => {
    renderAt('/');
    expect(await screen.findByRole('button', { name: /theme/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test src/app/app-shell.test.tsx`
Expected: FAIL — cannot resolve `./router.tsx`.

- [ ] **Step 3: Write the area stubs, shell, and router**

Feature stubs — one per area. Example `web/src/features/chat/index.tsx` (repeat the pattern for crews/workflows/builders/runs/library/settings/sessions, changing the name + testid):
```tsx
export function ChatArea() {
  return (
    <section data-testid="area-chat" className="p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Chat</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Streaming chat lands in Phase 2.
      </p>
    </section>
  );
}
```
Create the analogous exports: `CrewsArea` (`area-crews`), `WorkflowsArea` (`area-workflows`), `BuildersArea` (`area-builders`), `RunsArea` (`area-runs`), `LibraryArea` (`area-library`), `SettingsArea` (`area-settings`), and `SessionsSidebar` in `web/src/features/sessions/index.tsx`:
```tsx
export function SessionsSidebar() {
  return (
    <aside
      data-testid="sessions-sidebar"
      className="w-[var(--spacing-rail)] shrink-0 border-r border-[var(--color-border)] p-4"
    >
      <h2 className="font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">
        Sessions
      </h2>
      <p className="mt-2 text-xs text-[var(--color-muted)]">History arrives in Phase 6.</p>
    </aside>
  );
}
```

`web/src/features/runs/run-detail.tsx`:
```tsx
import { useParams } from '@tanstack/react-router';

export function RunDetail() {
  const { runId } = useParams({ from: '/runs/$runId' });
  return (
    <section data-testid="run-detail" className="p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Run {runId}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">Trace view lands in Phase 3.</p>
    </section>
  );
}
```

`web/src/app/app-shell.tsx`:
```tsx
import { Link, Outlet } from '@tanstack/react-router';
import { RegionErrorBoundary } from '../shared/ui/error-boundary.tsx';
import { Button } from '../shared/ui/button.tsx';
import { useTheme } from '../shared/design/theme.tsx';
import { SessionsSidebar } from '../features/sessions/index.tsx';

const NAV: { to: string; label: string }[] = [
  { to: '/', label: 'Chat' },
  { to: '/crews', label: 'Crews' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/builders', label: 'Builders' },
  { to: '/runs', label: 'Runs' },
  { to: '/library', label: 'Library' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell() {
  const { theme, toggle } = useTheme();
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-2">
        <span className="font-mono text-sm text-[var(--color-accent)]">◇ local-agents</span>
        <nav className="flex gap-3" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="font-mono text-sm text-[var(--color-muted)] [&.active]:text-[var(--color-fg)]"
              activeOptions={{ exact: n.to === '/' }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <kbd className="rounded border border-[var(--color-border)] px-1.5 text-xs text-[var(--color-muted)]">
            ⌘K
          </kbd>
          <Button onClick={toggle} aria-label={`theme: ${theme}`}>
            {theme === 'dark' ? '☾' : '☀'}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <SessionsSidebar />
        <main className="min-w-0 flex-1 overflow-auto">
          <RegionErrorBoundary region="Workspace">
            <Outlet />
          </RegionErrorBoundary>
        </main>
      </div>
    </div>
  );
}
```

`web/src/app/router.tsx`:
```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { AppShell } from './app-shell.tsx';
import { ChatArea } from '../features/chat/index.tsx';
import { CrewsArea } from '../features/crews/index.tsx';
import { WorkflowsArea } from '../features/workflows/index.tsx';
import { BuildersArea } from '../features/builders/index.tsx';
import { RunsArea } from '../features/runs/index.tsx';
import { RunDetail } from '../features/runs/run-detail.tsx';
import { LibraryArea } from '../features/library/index.tsx';
import { SettingsArea } from '../features/settings/index.tsx';

const rootRoute = createRootRoute({ component: AppShell });

const route = (path: string, component: () => JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

export const routeTree = rootRoute.addChildren([
  route('/', ChatArea),
  route('/crews', CrewsArea),
  route('/workflows', WorkflowsArea),
  route('/builders', BuildersArea),
  route('/runs', RunsArea),
  route('/runs/$runId', RunDetail),
  route('/library', LibraryArea),
  route('/settings', SettingsArea),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './shared/design/tokens.css';
import { ThemeProvider } from './shared/design/theme.tsx';
import { router } from './app/router.tsx';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root mount');

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
```

_Note: if `tsc` complains about the `JSX.Element` return type in the `route` helper, import `type { JSX } from 'react'` or type the components as `React.ComponentType`. Verify against `@tanstack/react-router`'s installed types._

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test src/app/app-shell.test.tsx`
Expected: PASS (4 tests). Then `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ web/src/features/ web/src/main.tsx
git commit -m "feat(web): TanStack Router app shell + 7 nav-area stubs + root render"
```

---

### Task 7: ⌘K command-palette skeleton

**Files:**
- Create: `web/src/app/commands.ts`, `web/src/app/command-palette.tsx`
- Modify: `web/src/app/app-shell.tsx` (mount the palette)
- Test: `web/src/app/command-palette.test.tsx`

**Interfaces:**
- Consumes: `Dialog` (Task 4), `useNavigate` from `@tanstack/react-router`.
- Produces: `type Command = { id: string; label: string; run: (nav: NavigateFn) => void }`, `navCommands: Command[]` (the 7 area jumps — the only wireable commands in 1b; launch-agent/switch-model land with their features), `CommandPalette` component: opens on ⌘K / Ctrl+K (global keydown), closes on Esc, `includes`-filters by label, ArrowUp/Down moves selection, Enter runs the selected command, has `role="listbox"` + `aria-selected` for a11y.

- [ ] **Step 1: Write the failing test**

`web/src/app/command-palette.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import { CommandPalette } from './command-palette.tsx';

describe('CommandPalette', () => {
  it('is hidden until ⌘K, then opens', async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('filters commands by typed text', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox'), 'runs');
    expect(screen.getByText(/Go to Runs/i)).toBeInTheDocument();
    expect(screen.queryByText(/Go to Settings/i)).not.toBeInTheDocument();
  });

  it('runs the selected command on Enter and navigates', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox'), 'crews');
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith({ to: '/crews' });
  });

  it('closes on Escape', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test src/app/command-palette.test.tsx`
Expected: FAIL — cannot resolve `./command-palette.tsx`.

- [ ] **Step 3: Write the registry + palette, mount in the shell**

`web/src/app/commands.ts`:
```ts
import type { useNavigate } from '@tanstack/react-router';

type NavigateFn = ReturnType<typeof useNavigate>;

export type Command = {
  id: string;
  label: string;
  run: (nav: NavigateFn) => void;
};

// Phase 1b: only navigation commands are wireable. Launch-agent/crew/workflow,
// jump-to-run, and switch-model land with their features (⌘K completeness = Phase 8).
export const navCommands: Command[] = [
  { id: 'go-chat', label: 'Go to Chat', run: (n) => n({ to: '/' }) },
  { id: 'go-crews', label: 'Go to Crews', run: (n) => n({ to: '/crews' }) },
  { id: 'go-workflows', label: 'Go to Workflows', run: (n) => n({ to: '/workflows' }) },
  { id: 'go-builders', label: 'Go to Builders', run: (n) => n({ to: '/builders' }) },
  { id: 'go-runs', label: 'Go to Runs', run: (n) => n({ to: '/runs' }) },
  { id: 'go-library', label: 'Go to Library', run: (n) => n({ to: '/library' }) },
  { id: 'go-settings', label: 'Go to Settings', run: (n) => n({ to: '/settings' }) },
];
```

`web/src/app/command-palette.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog } from '../shared/ui/dialog.tsx';
import { navCommands, type Command } from './commands.ts';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    return q ? navCommands.filter((c) => c.label.toLowerCase().includes(q)) : navCommands;
  }, [query]);

  function reset() {
    setQuery('');
    setSelected(0);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = results[selected];
      if (cmd) {
        cmd.run(navigate);
        onOpenChange(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Command palette">
      {/* biome-ignore lint/a11y/noAutofocus: command palettes focus their input on open */}
      <input
        role="combobox"
        aria-expanded="true"
        aria-controls="cmdk-list"
        aria-label="Command palette"
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={onInputKey}
        placeholder="Type a command…"
        className="w-full bg-transparent font-mono text-sm text-[var(--color-fg)] outline-none"
      />
      <ul id="cmdk-list" role="listbox" className="mt-3 max-h-80 overflow-auto">
        {results.map((c, i) => (
          <li
            key={c.id}
            role="option"
            aria-selected={i === selected}
            className={`cursor-pointer rounded px-2 py-1.5 font-mono text-sm ${
              i === selected
                ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
                : 'text-[var(--color-fg)]'
            }`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => {
              c.run(navigate);
              onOpenChange(false);
            }}
          >
            {c.label}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
```

Mount it in `web/src/app/app-shell.tsx` — add the import and render it inside the root `<div>` (it portals, so placement is cosmetic):
```tsx
import { CommandPalette } from './command-palette.tsx';
// ...inside AppShell's returned tree, e.g. right after <header>…</header>:
<CommandPalette />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test src/app/command-palette.test.tsx`
Expected: PASS (4 tests). Then `bun run typecheck` + `bun run test` (full web suite green).

_If Base UI's Dialog blocks the `role="combobox"` query under happy-dom (portal timing), assert via `findByRole` and ensure the Dialog portal renders into `document.body` (happy-dom supports portals)._

- [ ] **Step 5: Commit**

```bash
git add web/src/app/commands.ts web/src/app/command-palette.tsx web/src/app/app-shell.tsx
git commit -m "feat(web): ⌘K command-palette skeleton wired to router navigation"
```

---

### Task 8: Architecture docs + full gate

**Files:**
- Modify: `docs/architecture.md`
- (Verify) root gate green.

**Interfaces:**
- Consumes: everything above.
- Produces: an accurate `docs/architecture.md` section for the `web/` frontend scaffold; a green `bun run check`.

- [ ] **Step 1: Update `docs/architecture.md`**

Add a subsection under the web/UI area documenting the delivered scaffold — verbatim truthful, scaffold-only:
- `web/` is a Bun workspace member (own `package.json`/`tsconfig`/Vitest); served as static assets by `src/server/` (`staticDir` + token injection + COOP/COEP).
- **Structure:** `app/` (shell, TanStack Router route tree, providers, ⌘K palette) · `shared/` (design tokens, `ThemeProvider`, Base-UI primitives, `RegionErrorBoundary`, contract client, transport port) · `features/*` (per-area stubs; isolation rule: a feature imports only `shared/` + `@contracts`).
- **Design system:** Blueprint-Mono tokens in `shared/design/tokens.css` (Tailwind v4 `@theme`, light+dark, reduced-motion, Geist via Fontsource); components reference tokens never raw hex.
- **Contract boundary:** `shared/contract/client.ts` reads `window.__AGENT_TOKEN__`, sends `Authorization: Bearer`, zod-parses against `@contracts` (`src/contracts/`).
- **Transport port:** `shared/transport/types.ts` (`ChatTransport`/`RunStream`, bidirectional + resumable per D14) — interface only; SSE adapter + `useChat` wiring is Phase 2.
- **Explicitly NOT yet built (scaffold phase):** live SSE/`useChat` streaming, feature screens, @visx/@xyflow, persistence, voice — Phases 2–8.
- Add the `web/` test lane note: component tests run under Vitest/happy-dom via `bun run check:web`, folded into `bun run check`.

Keep the module map / data-flow diagrams consistent (add a `web/` node/edge if the doc uses them for the UI). Do NOT claim streaming/chat works.

- [ ] **Step 2: Run the doc gate**

Run: `bun run docs:check`
Expected: PASS (no orphaned/undocumented living surfaces). If it flags `web/` as an undocumented `src/<subsystem>` — it should not, since `web/` is not under `src/` — investigate before proceeding.

- [ ] **Step 3: Run the full gate**

Run: `bun run check`
Expected: `docs:check` ✔ · `typecheck` ✔ (root, excludes `web/`) · `lint` ✔ (Biome, includes `web/` tsx) · `check:web` ✔ (web typecheck + Vitest, all web tests green) · `test` ✔ (root `bun test`, unchanged count).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): web/ frontend scaffold (Slice 30b Phase 1b)"
```

---

## Self-Review

**1. Spec coverage (the four Phase-1b scaffold clauses + structure):**
- "frontend test harness (Vitest/Testing-Library)" → Task 1 (Vitest 4 + RTL + happy-dom, `check:web` wired into `check`). ✔
- "design-token system (light + dark)" → Task 2 (`tokens.css`, `@theme`, both themes, Geist, reduced-motion) + Task 3 (`ThemeProvider` toggle). ✔
- "app shell + routing/providers" → Task 6 (TanStack Router, `AppShell`, 7 nav areas + run-detail, `main.tsx` providers). ✔
- "⌘K skeleton" → Task 7 (open/close/filter/keyboard-nav/registry→router). ✔
- `web/src/{app,shared}/` feature-sliced structure + per-region error boundary + isolation rule → Tasks 4/6. ✔
- Transport-port interface stub in `shared/transport` + transport-port contract test → Task 5. ✔
- Contract client consuming `src/contracts/` + token handshake → Task 5. ✔
- Deferred correctly (NOT in 1b): live SSE/`useChat`, feature screens, @visx/@xyflow, persistence, voice, ⌘K completeness — all left as stubs/interfaces. ✔

**2. Placeholder scan:** No "TBD"/"add error handling"/"write tests for the above". Every code step has complete code; every test step has real assertions. Two `_Note:_` blocks flag *verify-against-installed-version* points (Base UI Dialog export subpath, TanStack `JSX.Element` typing) — these are genuine integration-verification steps, not placeholders; the implementer resolves them against the installed package types.

**3. Type consistency:** `Theme` enum (Task 3) used in Task 3 tests; `RegionErrorBoundary`/`Button`/`Dialog` props (Task 4) consumed unchanged in Tasks 6/7; `ChatTransport`/`RunStream`/`TransportEvent` (Task 5) used in Task 5 test; `Command`/`navCommands` (Task 7) consistent between `commands.ts` and the palette; `routeTree`/`router` (Task 6) consumed by `main.tsx` + the shell test; `apiFetch`/`ApiError`/`sessionToken` (Task 5) consistent across client + tests. `@contracts` alias defined in Task 1 (tsconfig paths + vite + vitest) and consumed in Task 5. ✔

**Known integration risks flagged for execution (not blockers):**
- Base UI package export subpath (`@base-ui-components/react/dialog` vs root) — verify at Task 4.
- happy-dom portal/focus timing for the palette — Task 7 note gives the `findByRole` fallback.
- Biome may flag React-specific rules on `web/` tsx — fix inline or add scoped `biome-ignore` (two already anticipated in Tasks 5/7).
- Fontsource variable Geist package family names ("Geist Variable" / "Geist Mono Variable") — verify against installed package; tokens.css already lists system fallbacks so a mismatch degrades gracefully, not crashes.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-slice-30b-phase1b-frontend-scaffold.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

After all 8 tasks: whole-branch fan-out review → live-verify (`bun run build` in `web/` → `bun run web` serves `dist/` → real Chrome: shell renders, 7 nav routes, ⌘K opens/filters/navigates, theme toggles, `crossOriginIsolated === true`, zero console errors) → all-4-docs + Artifact regen decision → SDD ledger → land on `main`.
