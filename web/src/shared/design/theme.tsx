import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

export enum Theme {
  Light = 'light',
  Dark = 'dark',
}

const STORAGE_KEY = 'agent-theme';
const THEME_CHANGE_EVENT = 'agent:theme-changed';

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
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: light)').matches;
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

  useEffect(() => {
    function onExternalChange() {
      // `flushSync` forces the resulting re-render to commit synchronously,
      // in the same tick as `toggleThemeGlobal()`'s `dispatchEvent` call —
      // this listener runs from a plain DOM event (not a React synthetic
      // event), so without it React would defer the update to a later
      // microtask and callers reading the DOM right after
      // `toggleThemeGlobal()` (e.g. `runCommand`'s caller) would see stale
      // text content.
      flushSync(() => {
        setTheme(
          document.documentElement.classList.contains('dark')
            ? Theme.Dark
            : Theme.Light,
        );
      });
    }
    window.addEventListener(THEME_CHANGE_EVENT, onExternalChange);
    return () =>
      window.removeEventListener(THEME_CHANGE_EVENT, onExternalChange);
  }, []);

  const set = useCallback((t: Theme) => setTheme(t), []);
  const toggle = useCallback(
    () => setTheme((t) => (t === Theme.Dark ? Theme.Light : Theme.Dark)),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, toggle, set }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
