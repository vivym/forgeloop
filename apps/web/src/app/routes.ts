import { index, layout, prefix, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  layout('./routes/_layout.tsx', [
    index('./routes/lanes/index.tsx', { id: 'routes/lanes/_index' }),
    route('lanes', './routes/lanes/index.tsx'),
    route('lanes/:laneId', './routes/lanes/$laneId.tsx'),
    route('pipeline', './routes/pipeline/index.tsx'),
    ...prefix('work-items', [
      index('./routes/work-items/index.tsx'),
      route('new', './routes/work-items/new.tsx'),
      route(':workItemId', './routes/work-items/$workItemId.tsx'),
      route(':workItemId/spec-plan', './routes/work-items/$workItemId/spec-plan.tsx'),
    ]),
    ...prefix('specs', [
      index('./routes/specs/index.tsx'),
      route(':specId', './routes/specs/$specId.tsx'),
      route(':specId/revisions/:revisionId', './routes/specs/$specId/revisions/$revisionId.tsx'),
    ]),
    ...prefix('plans', [
      index('./routes/plans/index.tsx'),
      route(':planId', './routes/plans/$planId.tsx'),
      route(':planId/revisions/:revisionId', './routes/plans/$planId/revisions/$revisionId.tsx'),
    ]),
    ...prefix('packages', [index('./routes/packages/index.tsx'), route(':packageId', './routes/packages/$packageId.tsx')]),
    ...prefix('runs', [index('./routes/runs/index.tsx'), route(':runSessionId', './routes/runs/$runSessionId.tsx')]),
    ...prefix('reviews', [index('./routes/reviews/index.tsx'), route(':reviewPacketId', './routes/reviews/$reviewPacketId.tsx')]),
    ...prefix('releases', [index('./routes/releases/index.tsx'), route(':releaseId', './routes/releases/$releaseId.tsx')]),
    route('dev-tools', './routes/dev-tools/index.tsx'),
  ]),
] satisfies RouteConfig;
