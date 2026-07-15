import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from '@tanstack/react-router';
import { BuildersArea } from '../features/builders/index.tsx';
import { ChatArea } from '../features/chat/index.tsx';
import { CrewDetail } from '../features/crews/crew-detail.tsx';
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

/** Amendment A (Phase 4 D7a plan): `/runs/$runId` accepts optional
 *  `graphKind`/`graphId` search params so a crew/workflow-run navigation can
 *  carry the def id for the live overlay (Task 18 joins this back to
 *  `crewGraph`/`workflowGraph` instead of re-deriving structure from spans
 *  alone). Both are optional so a bare `/runs/$runId` visit (e.g. from the
 *  runs list) still validates. */
export type RunDetailSearch = {
  graphKind?: 'crew' | 'workflow';
  graphId?: string;
};

const runDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs/$runId',
  component: RunDetail,
  validateSearch: (search: Record<string, unknown>): RunDetailSearch => ({
    graphKind:
      search.graphKind === 'crew' || search.graphKind === 'workflow'
        ? search.graphKind
        : undefined,
    graphId: typeof search.graphId === 'string' ? search.graphId : undefined,
  }),
});

export const routeTree = rootRoute.addChildren([
  route('/', ChatArea),
  route('/crews', CrewsArea),
  route('/crews/$crewName', CrewDetail),
  route('/workflows', WorkflowsArea),
  route('/builders', BuildersArea),
  route('/runs', RunsArea),
  runDetailRoute,
  route('/library', LibraryArea),
  route('/settings', SettingsArea),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
