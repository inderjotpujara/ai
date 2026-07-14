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
];
