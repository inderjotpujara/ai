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

