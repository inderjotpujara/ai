import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { routeTree } from '../app/router.tsx';
import { ThemeProvider } from '../shared/design/theme.tsx';

/**
 * Shared test render helper: mounts the full router (memory history) + theme
 * provider, so a component under test gets the same context it has in the
 * running app. Copied from the inline `renderAt` in `app-shell.test.tsx`.
 */
export function renderAt(path: string) {
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
