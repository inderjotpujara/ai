import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

export type ToastMessage = { id: string; text: string };
type ToastContextValue = { notify: (text: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_TIMEOUT_MS = 6_000;

/** A minimal always-on toast host, mounted once at the AppShell level (spec
 *  D11 — "in-app toast + optional browser Notification API"): any feature
 *  (the notification poll, T62; future features) calls `useToast().notify`. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const counter = useRef(0);

  const notify = useCallback((text: string) => {
    const id = `toast-${counter.current++}`;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TIMEOUT_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        data-testid="toast-host"
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className="pointer-events-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-fg)] shadow-lg"
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Throws if used outside `ToastHost` — a programmer error, not a
 *  degrade-gracefully case (mirrors `useTheme`'s context-required contract,
 *  `web/src/shared/design/theme.tsx`). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastHost');
  return ctx;
}
