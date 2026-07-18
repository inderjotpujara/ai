import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../shared/design/theme.tsx';
import { routeTree } from './router.tsx';

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  it('renders navigation for all 8 areas', async () => {
    renderAt('/');
    for (const label of [
      'Chat',
      'Sessions',
      'Crews',
      'Workflows',
      'Builders',
      'Runs',
      'Library',
      'Settings',
    ]) {
      expect(
        await screen.findByRole('link', { name: label }),
      ).toBeInTheDocument();
    }
  });

  it('renders the Chat area stub at /', async () => {
    renderAt('/');
    expect(await screen.findByTestId('area-chat')).toBeInTheDocument();
  });

  it('renders the run-detail stub at /runs/:runId', async () => {
    renderAt('/runs/abc');
    expect(await screen.findByTestId('run-detail')).toHaveTextContent('abc');
  });

  it('exposes a theme toggle', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('button', { name: /theme/i }),
    ).toBeInTheDocument();
  });

  it('mounts a ToastHost so useToast works anywhere under AppShell', async () => {
    renderAt('/');
    expect(await screen.findByTestId('toast-host')).toBeInTheDocument();
  });
});
