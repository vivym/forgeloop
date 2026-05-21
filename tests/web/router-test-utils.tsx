import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import type { RouteObject } from 'react-router';
import { afterEach, vi } from 'vitest';

import ProductLayoutRoute from '../../apps/web/src/app/routes/_layout';
import DevToolsRoute from '../../apps/web/src/app/routes/dev-tools';
import PackageDetailRoute from '../../apps/web/src/app/routes/packages/$packageId';
import PackagesRoute from '../../apps/web/src/app/routes/packages';
import PipelineRoute from '../../apps/web/src/app/routes/pipeline';
import PlanDetailRoute from '../../apps/web/src/app/routes/plans/$planId';
import PlanRevisionRoute from '../../apps/web/src/app/routes/plans/$planId/revisions/$revisionId';
import PlansRoute from '../../apps/web/src/app/routes/plans';
import ReleaseDetailRoute from '../../apps/web/src/app/routes/releases/$releaseId';
import ReleasesRoute from '../../apps/web/src/app/routes/releases';
import ReviewDetailRoute from '../../apps/web/src/app/routes/reviews/$reviewPacketId';
import ReviewsRoute from '../../apps/web/src/app/routes/reviews';
import RunDetailRoute from '../../apps/web/src/app/routes/runs/$runSessionId';
import RunsRoute from '../../apps/web/src/app/routes/runs';
import SpecDetailRoute from '../../apps/web/src/app/routes/specs/$specId';
import SpecRevisionRoute from '../../apps/web/src/app/routes/specs/$specId/revisions/$revisionId';
import SpecsRoute from '../../apps/web/src/app/routes/specs';
import ProductLanesRoute from '../../apps/web/src/app/routes/lanes';
import ProductLaneRoute from '../../apps/web/src/app/routes/lanes/$laneId';
import WorkItemDetailRoute from '../../apps/web/src/app/routes/work-items/$workItemId';
import WorkItemSpecPlanRoute from '../../apps/web/src/app/routes/work-items/$workItemId/spec-plan';
import WorkItemsRoute from '../../apps/web/src/app/routes/work-items';
import NewWorkItemRoute from '../../apps/web/src/app/routes/work-items/new';
import { ActorProvider } from '../../apps/web/src/shared/context/actor-context';
import { ProjectProvider } from '../../apps/web/src/shared/context/project-context';
import { RuntimeFlagsProvider } from '../../apps/web/src/shared/context/runtime-flags';
import { installProductApiMock, type ProductApiResponseMap } from './fixtures/product-api-mock';

const productRoutes: RouteObject[] = [
  {
    path: '/',
    Component: ProductLayoutRoute,
    children: [
      { index: true, Component: ProductLanesRoute },
      { path: 'lanes', Component: ProductLanesRoute },
      { path: 'lanes/:laneId', Component: ProductLaneRoute },
      { path: 'pipeline', Component: PipelineRoute },
      { path: 'work-items', Component: WorkItemsRoute },
      { path: 'work-items/new', Component: NewWorkItemRoute },
      { path: 'work-items/:workItemId', Component: WorkItemDetailRoute },
      { path: 'work-items/:workItemId/spec-plan', Component: WorkItemSpecPlanRoute },
      { path: 'specs', Component: SpecsRoute },
      { path: 'specs/:specId', Component: SpecDetailRoute },
      { path: 'specs/:specId/revisions/:revisionId', Component: SpecRevisionRoute },
      { path: 'plans', Component: PlansRoute },
      { path: 'plans/:planId', Component: PlanDetailRoute },
      { path: 'plans/:planId/revisions/:revisionId', Component: PlanRevisionRoute },
      { path: 'packages', Component: PackagesRoute },
      { path: 'packages/:packageId', Component: PackageDetailRoute },
      { path: 'runs', Component: RunsRoute },
      { path: 'runs/:runSessionId', Component: RunDetailRoute },
      { path: 'reviews', Component: ReviewsRoute },
      { path: 'reviews/:reviewPacketId', Component: ReviewDetailRoute },
      { path: 'releases', Component: ReleasesRoute },
      { path: 'releases/:releaseId', Component: ReleaseDetailRoute },
      { path: 'dev-tools', Component: DevToolsRoute },
    ],
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

export async function renderRoute(
  path: string,
  options: {
    routes?: RouteObject[];
    devToolsEnabled?: boolean;
    actorId?: string;
    projectId?: string;
    apiOverrides?: ProductApiResponseMap;
    queryClient?: QueryClient;
  } = {},
) {
  installProductApiMock(options.apiOverrides);
  const queryClient = options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const RoutesStub = createRoutesStub(options.routes ?? productRoutes);

  render(
    <QueryClientProvider client={queryClient}>
      <ActorProvider value={options.actorId ? { actorId: options.actorId } : undefined}>
        <ProjectProvider value={options.projectId ? { projectId: options.projectId } : undefined}>
          <RuntimeFlagsProvider value={{ devToolsEnabled: options.devToolsEnabled ?? false }}>
            <RoutesStub initialEntries={[path]} />
          </RuntimeFlagsProvider>
        </ProjectProvider>
      </ActorProvider>
    </QueryClientProvider>,
  );

  return screen;
}
