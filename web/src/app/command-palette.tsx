import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../shared/ui/dialog.tsx';
import { type Command, navCommands } from './commands.ts';

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
    return q
      ? navCommands.filter((c) => c.label.toLowerCase().includes(q))
      : navCommands;
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
      <div
        id="cmdk-list"
        role="listbox"
        className="mt-3 max-h-80 overflow-auto"
      >
        {results.map((c, i) => (
          <div
            key={c.id}
            role="option"
            tabIndex={-1}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                c.run(navigate);
                onOpenChange(false);
              }
            }}
          >
            {c.label}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
