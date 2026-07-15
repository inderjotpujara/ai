import type { useNavigate } from '@tanstack/react-router';

type NavigateFn = ReturnType<typeof useNavigate>;

export type Command = {
  id: string;
  label: string;
  run: (nav: NavigateFn) => void;
};

// Phase 1b: only navigation commands are wireable. Launch-agent/crew/workflow
// and switch-model land with their features (⌘K completeness = Phase 8).
// jump-to-run, jump-to-crew, and jump-to-workflow are wired below; Phase 8
// extends jump-to-run to jump to a specific recent run.
export const navCommands: Command[] = [
  { id: 'go-chat', label: 'Go to Chat', run: (n) => n({ to: '/' }) },
  { id: 'go-crews', label: 'Go to Crews', run: (n) => n({ to: '/crews' }) },
  {
    id: 'go-workflows',
    label: 'Go to Workflows',
    run: (n) => n({ to: '/workflows' }),
  },
  {
    id: 'go-builders',
    label: 'Go to Builders',
    run: (n) => n({ to: '/builders' }),
  },
  { id: 'go-runs', label: 'Go to Runs', run: (n) => n({ to: '/runs' }) },
  {
    id: 'go-library',
    label: 'Go to Library',
    run: (n) => n({ to: '/library' }),
  },
  {
    id: 'go-settings',
    label: 'Go to Settings',
    run: (n) => n({ to: '/settings' }),
  },
  { id: 'jump-to-run', label: 'Jump to Runs', run: (n) => n({ to: '/runs' }) },
  {
    id: 'jump-to-crew',
    label: 'Jump to Crews',
    run: (n) => n({ to: '/crews' }),
  },
  {
    id: 'jump-to-workflow',
    label: 'Jump to Workflows',
    run: (n) => n({ to: '/workflows' }),
  },
];
