import type { useNavigate } from '@tanstack/react-router';
import { toggleVoiceInputEnabled } from '../features/settings/index.tsx';
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
    id: 'jump-to-run',
    label: 'Jump to Runs',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/runs' }),
  },
  {
    id: 'jump-to-crew',
    label: 'Jump to Crews',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/crews' }),
  },
  {
    id: 'jump-to-workflow',
    label: 'Jump to Workflows',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/workflows' }),
  },
  {
    id: 'jump-to-sessions',
    label: 'Jump to Sessions',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/sessions' }),
  },
  {
    id: 'search-sessions',
    label: 'Search Sessions',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/sessions' }),
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
