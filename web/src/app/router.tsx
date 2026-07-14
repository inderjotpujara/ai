import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from '@tanstack/react-router';
import { BuildersArea } from '../features/builders/index.tsx';
import { ChatArea } from '../features/chat/index.tsx';
import { CrewsArea } from '../features/crews/index.tsx';
import { LibraryArea } from '../features/library/index.tsx';
import { RunsArea } from '../features/runs/index.tsx';
import { RunDetail } from '../features/runs/run-detail.tsx';
import { SettingsArea } from '../features/settings/index.tsx';
import { WorkflowsArea } from '../features/workflows/index.tsx';
import { AppShell } from './app-shell.tsx';

const rootRoute = createRootRoute({ component: AppShell });

const route = <TPath extends string>(path: TPath, component: RouteComponent) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

export const routeTree = rootRoute.addChildren([
  route('/', ChatArea),
  route('/crews', CrewsArea),
  route('/workflows', WorkflowsArea),
  route('/builders', BuildersArea),
  route('/runs', RunsArea),
  route('/runs/$runId', RunDetail),
  route('/library', LibraryArea),
  route('/settings', SettingsArea),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
