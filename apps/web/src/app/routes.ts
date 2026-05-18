import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  layout('./routes/_layout.tsx', [
    index('./routes/workbench/index.tsx', { id: 'routes/workbench/_index' }),
    route('workbench', './routes/workbench/index.tsx'),
  ]),
] satisfies RouteConfig;
