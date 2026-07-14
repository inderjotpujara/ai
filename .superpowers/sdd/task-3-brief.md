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
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
  });

  it('toggles to light, applies the class, and persists', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('theme:light');
    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
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
  // Set BOTH classes explicitly. `.dark` must be present in dark mode so
  // Tailwind's `dark:` variant (@custom-variant dark → `.dark` ancestor) fires;
  // tokens.css also keeps the dark palette on bare :root as a fallback.
  root.classList.toggle('dark', theme === Theme.Dark);
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

