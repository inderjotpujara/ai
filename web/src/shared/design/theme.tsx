import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
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
