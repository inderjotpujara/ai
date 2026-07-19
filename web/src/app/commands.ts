import { RunListResponseSchema } from '@contracts';
import type { useNavigate } from '@tanstack/react-router';
import { toggleVoiceInputEnabled } from '../features/settings/index.tsx';
import { apiFetch } from '../shared/contract/client.ts';
import { toggleThemeGlobal } from '../shared/design/theme.tsx';

type NavigateFn = ReturnType<typeof useNavigate>;

/** Phase 8 D8: `Command` now supports two shapes — `Nav` (the original,
 *  navigates somewhere) and `Action` (a no-arg side effect, e.g. toggling a
 *  setting). `enum` per this repo's "enum over string-literal unions for
 *  finite sets" convention. */
export enum CommandKind {
  Nav = 'nav',
  Action = 'action',
}

type NavCommand = {
  id: string;
  label: string;
  kind: CommandKind.Nav;
  run: (nav: NavigateFn) => void | Promise<void>;
};

type ActionCommand = {
  id: string;
  label: string;
  kind: CommandKind.Action;
  run: () => void;
};

export type Command = NavCommand | ActionCommand;

/** The one dispatch point for running a `Command` (D8) — callers (the
 *  palette's Enter-key handler and its click handler) never branch on
 *  `cmd.kind` themselves. */
export function runCommand(
  cmd: Command,
  nav: NavigateFn,
): void | Promise<void> {
  return cmd.kind === CommandKind.Action ? cmd.run() : cmd.run(nav);
}

// Renamed from `navCommands` (Phase 8 D8) — this array now holds the
// widened `Command` union; Task 16 appends `Action`-kind entries here.
export const commands: Command[] = [
  {
    id: 'go-chat',
    label: 'Go to Chat',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/' }),
  },
  {
    id: 'go-crews',
    label: 'Go to Crews',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/crews' }),
  },
  {
    id: 'go-workflows',
    label: 'Go to Workflows',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/workflows' }),
  },
  {
    id: 'go-builders',
    label: 'Go to Builders',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/builders' }),
  },
  {
    // No standalone /agents route or AgentsArea page exists in this repo
    // (verified by grep — `features/agents/` is only Chat's embedded
    // live-status rail). Mapped to /builders, which already defaults to its
    // Agent-wizard mode, rather than fabricating a new empty page outside
    // this task's ⌘K-completeness scope. Flagged for spec-owner sign-off
    // (Task 17's surprise note) — revisit if a real Agents page ships later.
    id: 'go-agents',
    label: 'Go to Agents',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/builders' }),
  },
  {
    id: 'go-runs',
    label: 'Go to Runs',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/runs' }),
  },
  {
    id: 'go-library',
    label: 'Go to Library',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/library' }),
  },
  {
    id: 'go-settings',
    label: 'Go to Settings',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/settings' }),
  },
  {
    // Renamed from jump-to-sessions (Task 17 dedupe) — this was NEVER
    // actually a duplicate (no go-sessions existed before), so the rename
    // both normalizes naming with the other go-* entries and fills a real
    // gap. search-sessions (a pure duplicate of the old jump-to-sessions)
    // is dropped entirely, not renamed.
    id: 'go-sessions',
    label: 'Go to Sessions',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/sessions' }),
  },
  {
    // A genuinely new command (D8), not a rename of the old jump-to-run
    // (which Task 17 dropped as a pure /runs-list duplicate) — this one
    // deep-links to a SPECIFIC run id, fetched live.
    id: 'jump-to-recent-run',
    label: 'Jump to a recent run',
    kind: CommandKind.Nav,
    run: async (n) => {
      try {
        const page = await apiFetch('/runs?limit=1', {
          schema: RunListResponseSchema,
        });
        const mostRecent = page.items[0];
        if (mostRecent) {
          n({ to: '/runs/$runId', params: { runId: mostRecent.id } });
          return;
        }
      } catch {
        // A failed lookup degrades to the bare list — never worse than the
        // pre-Phase-8 jump-to-run behavior, and never throws on Enter.
      }
      n({ to: '/runs' });
    },
  },
  {
    id: 'toggle-voice-input',
    label: 'Toggle voice input',
    kind: CommandKind.Action,
    run: () => {
      toggleVoiceInputEnabled();
    },
  },
  {
    id: 'toggle-theme',
    label: 'Toggle theme (light/dark)',
    kind: CommandKind.Action,
    run: () => toggleThemeGlobal(),
  },
];
