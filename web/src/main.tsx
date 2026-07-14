import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './shared/design/tokens.css';
import { router } from './app/router.tsx';
import { ThemeProvider } from './shared/design/theme.tsx';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root mount');

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
