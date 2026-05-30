import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import type { RouteObject } from 'react-router';
import { afterEach, vi } from 'vitest';

import ProductLayoutRoute from '../../apps/web/src/app/routes/_layout';
import RootIndexRoute from '../../apps/web/src/app/routes/_index';
import CockpitRoute from '../../apps/web/src/app/routes/cockpit';
import BoardRoute from '../../apps/web/src/app/routes/board';
import BugDetailRoute from '../../apps/web/src/app/routes/bugs/$bugId';
import BugEvidenceRoute from '../../apps/web/src/app/routes/bugs/$bugId/evidence';
import BugsRoute from '../../apps/web/src/app/routes/bugs';
import NewBugRoute from '../../apps/web/src/app/routes/bugs/new';
import DevelopmentPlanDetailRoute from '../../apps/web/src/app/routes/development-plans/$developmentPlanId';
import DevelopmentPlanItemDetailRoute from '../../apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId';
import DevelopmentPlanItemExecutionRoute from '../../apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/execution';
import DevelopmentPlanItemImplementationPlanRoute from '../../apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/implementation-plan';
import DevelopmentPlanItemSpecRoute from '../../apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/spec';
import DevelopmentPlansRoute from '../../apps/web/src/app/routes/development-plans';
import NewDevelopmentPlanRoute from '../../apps/web/src/app/routes/development-plans/new';
import DevToolsRoute from '../../apps/web/src/app/routes/dev-tools';
import ExecutionDetailRoute from '../../apps/web/src/app/routes/executions/$executionId';
import ExecutionsRoute from '../../apps/web/src/app/routes/executions';
import InitiativeDetailRoute from '../../apps/web/src/app/routes/initiatives/$initiativeId';
import InitiativeEvidenceRoute from '../../apps/web/src/app/routes/initiatives/$initiativeId/evidence';
import InitiativesRoute from '../../apps/web/src/app/routes/initiatives';
import NewInitiativeRoute from '../../apps/web/src/app/routes/initiatives/new';
import MyWorkRoute from '../../apps/web/src/app/routes/my-work';
import ReleaseDetailRoute from '../../apps/web/src/app/routes/releases/$releaseId';
import ReleaseEvidenceRoute from '../../apps/web/src/app/routes/releases/$releaseId/evidence';
import ReleasesRoute from '../../apps/web/src/app/routes/releases';
import DeliveryReportRoute from '../../apps/web/src/app/routes/reports/delivery';
import ObservationReportRoute from '../../apps/web/src/app/routes/reports/observation';
import QualityReportRoute from '../../apps/web/src/app/routes/reports/quality';
import ReleaseReadinessReportRoute from '../../apps/web/src/app/routes/reports/release-readiness';
import ReportsRoute from '../../apps/web/src/app/routes/reports';
import RequirementEvidenceRoute from '../../apps/web/src/app/routes/requirements/$requirementId/evidence';
import RequirementDetailRoute from '../../apps/web/src/app/routes/requirements/$requirementId';
import RequirementsRoute from '../../apps/web/src/app/routes/requirements';
import NewRequirementRoute from '../../apps/web/src/app/routes/requirements/new';
import ReviewsRoute from '../../apps/web/src/app/routes/reviews';
import QaRoute from '../../apps/web/src/app/routes/qa';
import TechDebtDetailRoute from '../../apps/web/src/app/routes/tech-debt/$techDebtId';
import TechDebtEvidenceRoute from '../../apps/web/src/app/routes/tech-debt/$techDebtId/evidence';
import TechDebtRoute from '../../apps/web/src/app/routes/tech-debt';
import NewTechDebtRoute from '../../apps/web/src/app/routes/tech-debt/new';
import { ActorProvider } from '../../apps/web/src/shared/context/actor-context';
import { ProjectProvider } from '../../apps/web/src/shared/context/project-context';
import { RuntimeFlagsProvider } from '../../apps/web/src/shared/context/runtime-flags';
import { PageHeader, Section } from '../../apps/web/src/shared/layout';
import { InlineNotice } from '../../apps/web/src/shared/ui';
import { projectId as fixtureProjectId } from './fixtures/product-data';
import { installProductApiMock, type ProductApiResponseMap } from './fixtures/product-api-mock';

function ProductNotFoundRoute() {
  return (
    <>
      <PageHeader subtitle="This product route is not available." title="Not Found" />
      <Section title="Route unavailable">
        <InlineNotice title="The requested product route was not found." tone="warning" />
      </Section>
    </>
  );
}

const productRoutes: RouteObject[] = [
  {
    path: '/',
    Component: ProductLayoutRoute,
    children: [
      { index: true, Component: RootIndexRoute },
      { path: 'cockpit', Component: CockpitRoute },
      { path: 'my-work', Component: MyWorkRoute },
      { path: 'requirements', Component: RequirementsRoute },
      { path: 'requirements/new', Component: NewRequirementRoute },
      { path: 'requirements/:requirementId', Component: RequirementDetailRoute },
      { path: 'requirements/:requirementId/evidence', Component: RequirementEvidenceRoute },
      { path: 'initiatives', Component: InitiativesRoute },
      { path: 'initiatives/new', Component: NewInitiativeRoute },
      { path: 'initiatives/:initiativeId', Component: InitiativeDetailRoute },
      { path: 'initiatives/:initiativeId/evidence', Component: InitiativeEvidenceRoute },
      { path: 'tech-debt', Component: TechDebtRoute },
      { path: 'tech-debt/new', Component: NewTechDebtRoute },
      { path: 'tech-debt/:techDebtId', Component: TechDebtDetailRoute },
      { path: 'tech-debt/:techDebtId/evidence', Component: TechDebtEvidenceRoute },
      { path: 'development-plans', Component: DevelopmentPlansRoute },
      { path: 'development-plans/new', Component: NewDevelopmentPlanRoute },
      { path: 'development-plans/:developmentPlanId', Component: DevelopmentPlanDetailRoute },
      { path: 'development-plans/:developmentPlanId/items/:itemId', Component: DevelopmentPlanItemDetailRoute },
      { path: 'development-plans/:developmentPlanId/items/:itemId/spec', Component: DevelopmentPlanItemSpecRoute },
      { path: 'development-plans/:developmentPlanId/items/:itemId/implementation-plan', Component: DevelopmentPlanItemImplementationPlanRoute },
      { path: 'development-plans/:developmentPlanId/items/:itemId/execution', Component: DevelopmentPlanItemExecutionRoute },
      { path: 'reviews', Component: ReviewsRoute },
      { path: 'qa', Component: QaRoute },
      { path: 'bugs', Component: BugsRoute },
      { path: 'bugs/new', Component: NewBugRoute },
      { path: 'bugs/:bugId', Component: BugDetailRoute },
      { path: 'bugs/:bugId/evidence', Component: BugEvidenceRoute },
      { path: 'board', Component: BoardRoute },
      { path: 'executions', Component: ExecutionsRoute },
      { path: 'executions/:executionId', Component: ExecutionDetailRoute },
      { path: 'releases', Component: ReleasesRoute },
      { path: 'releases/:releaseId', Component: ReleaseDetailRoute },
      { path: 'releases/:releaseId/evidence', Component: ReleaseEvidenceRoute },
      { path: 'reports', Component: ReportsRoute },
      { path: 'reports/delivery', Component: DeliveryReportRoute },
      { path: 'reports/quality', Component: QualityReportRoute },
      { path: 'reports/release-readiness', Component: ReleaseReadinessReportRoute },
      { path: 'reports/observation', Component: ObservationReportRoute },
      { path: 'dev-tools', Component: DevToolsRoute },
      { path: '*', Component: ProductNotFoundRoute },
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
        <ProjectProvider value={{ projectId: options.projectId ?? fixtureProjectId }}>
          <RuntimeFlagsProvider value={{ devToolsEnabled: options.devToolsEnabled ?? false }}>
            <RoutesStub initialEntries={[path]} />
          </RuntimeFlagsProvider>
        </ProjectProvider>
      </ActorProvider>
    </QueryClientProvider>,
  );

  return screen;
}
