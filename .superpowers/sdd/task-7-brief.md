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

