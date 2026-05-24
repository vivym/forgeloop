export type ProductRouteKind = 'product' | 'retired' | 'dev-tools';

export type ProductPageFamily =
  | 'cockpit'
  | 'queue'
  | 'source-object-list'
  | 'source-object-authoring'
  | 'source-object-detail'
  | 'evidence'
  | 'development-plan-index'
  | 'development-plan-detail'
  | 'gate-workspace'
  | 'governance-queue'
  | 'execution-list'
  | 'execution-detail'
  | 'board'
  | 'release'
  | 'report';

export interface ProductRouteContract {
  path: string;
  concretePath: string;
  label: string;
  family: ProductPageFamily;
  kind: ProductRouteKind;
  heading: RegExp;
  viewports: readonly [1440, 1024, 768, 375];
}

export interface ProductCommandItem {
  id: string;
  label: string;
  family: ProductPageFamily;
  kind: Exclude<ProductRouteKind, 'retired'>;
}

export const visualViewports = [1440, 1024, 768, 375] as const;

const requirementId = 'req-1';
const initiativeId = 'init-1';
const bugId = 'bug-1';
const techDebtId = 'td-1';
const developmentPlanId = 'development-plan-web-product';
const developmentPlanItemId = 'development-plan-item-web-product';
const executionId = 'execution-web-product';
const releaseId = 'release-web-product';

function productRoute(
  path: string,
  concretePath: string,
  label: string,
  family: ProductPageFamily,
  heading: RegExp,
): ProductRouteContract {
  return { path, concretePath, label, family, kind: 'product', heading, viewports: visualViewports };
}

function retiredRoute(path: string, concretePath: string, label: string, family: ProductPageFamily): ProductRouteContract {
  return {
    path,
    concretePath,
    label,
    family,
    kind: 'retired',
    heading: /not found|retired|not available/i,
    viewports: visualViewports,
  };
}

export const canonicalProductRoutes: readonly ProductRouteContract[] = [
  productRoute('/', '/', 'Cockpit', 'cockpit', /^Cockpit$/i),
  productRoute('/cockpit', '/cockpit', 'Cockpit', 'cockpit', /^Cockpit$/i),
  productRoute('/my-work', '/my-work', 'My Work', 'queue', /^My Work$/i),
  productRoute('/requirements', '/requirements', 'Requirements', 'source-object-list', /^Requirements$/i),
  productRoute('/requirements/new', '/requirements/new', 'New Requirement', 'source-object-authoring', /Requirement/i),
  productRoute('/requirements/:id', `/requirements/${requirementId}`, 'Requirement', 'source-object-detail', /^Requirement$/i),
  productRoute('/requirements/:id/evidence', `/requirements/${requirementId}/evidence`, 'Requirement Evidence', 'evidence', /Evidence/i),
  productRoute('/initiatives', '/initiatives', 'Initiatives', 'source-object-list', /^Initiatives$/i),
  productRoute('/initiatives/new', '/initiatives/new', 'New Initiative', 'source-object-authoring', /Initiative/i),
  productRoute('/initiatives/:id', `/initiatives/${initiativeId}`, 'Initiative', 'source-object-detail', /^Initiative$/i),
  productRoute('/initiatives/:id/evidence', `/initiatives/${initiativeId}/evidence`, 'Initiative Evidence', 'evidence', /Evidence/i),
  productRoute('/bugs', '/bugs', 'Bugs', 'source-object-list', /^Bugs$/i),
  productRoute('/bugs/new', '/bugs/new', 'New Bug', 'source-object-authoring', /Bug/i),
  productRoute('/bugs/:id', `/bugs/${bugId}`, 'Bug', 'source-object-detail', /^Bug$/i),
  productRoute('/bugs/:id/evidence', `/bugs/${bugId}/evidence`, 'Bug Evidence', 'evidence', /Evidence/i),
  productRoute('/tech-debt', '/tech-debt', 'Tech Debt', 'source-object-list', /^Tech Debt$/i),
  productRoute('/tech-debt/new', '/tech-debt/new', 'New Tech Debt', 'source-object-authoring', /Tech Debt/i),
  productRoute('/tech-debt/:id', `/tech-debt/${techDebtId}`, 'Tech Debt', 'source-object-detail', /^Tech Debt$/i),
  productRoute('/tech-debt/:id/evidence', `/tech-debt/${techDebtId}/evidence`, 'Tech Debt Evidence', 'evidence', /Evidence/i),
  productRoute('/development-plans', '/development-plans', 'Development Plans', 'development-plan-index', /^Development Plans$/i),
  productRoute('/development-plans/new', '/development-plans/new', 'New Development Plan', 'development-plan-index', /Development Plan/i),
  productRoute('/development-plans/:id', `/development-plans/${developmentPlanId}`, 'Development Plan', 'development-plan-detail', /Development Plan/i),
  productRoute(
    '/development-plans/:id/items/:itemId',
    `/development-plans/${developmentPlanId}/items/${developmentPlanItemId}`,
    'Development Plan Item',
    'gate-workspace',
    /Development Plan Item/i,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/brainstorming',
    `/development-plans/${developmentPlanId}/items/${developmentPlanItemId}/brainstorming`,
    'Boundary Brainstorming',
    'gate-workspace',
    /Brainstorming|Development Plan Item/i,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/spec',
    `/development-plans/${developmentPlanId}/items/${developmentPlanItemId}/spec`,
    'Spec',
    'gate-workspace',
    /Spec|Development Plan Item/i,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/execution-plan',
    `/development-plans/${developmentPlanId}/items/${developmentPlanItemId}/execution-plan`,
    'Execution Plan',
    'gate-workspace',
    /Execution Plan|Development Plan Item/i,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/execution',
    `/development-plans/${developmentPlanId}/items/${developmentPlanItemId}/execution`,
    'Execution',
    'gate-workspace',
    /Execution|Development Plan Item/i,
  ),
  productRoute('/specs-plans', '/specs-plans', 'Specs and Execution Plans', 'governance-queue', /^Specs & Execution Plans$/i),
  productRoute('/executions', '/executions', 'Executions', 'execution-list', /^Executions$/i),
  productRoute('/executions/:id', `/executions/${executionId}`, 'Execution', 'execution-detail', /Execution/i),
  productRoute('/board', '/board', 'Board', 'board', /^Board$/i),
  productRoute('/releases', '/releases', 'Releases', 'release', /^Releases$/i),
  productRoute('/releases/:id', `/releases/${releaseId}`, 'Release', 'release', /Release/i),
  productRoute('/releases/:id/evidence', `/releases/${releaseId}/evidence`, 'Release Evidence', 'evidence', /Evidence/i),
  productRoute('/reports', '/reports', 'Reports', 'report', /^Reports$/i),
  productRoute('/reports/delivery', '/reports/delivery', 'Delivery Report', 'report', /Delivery|Reports/i),
  productRoute('/reports/quality', '/reports/quality', 'Quality Report', 'report', /Quality|Reports/i),
  productRoute('/reports/release-readiness', '/reports/release-readiness', 'Release Readiness Report', 'report', /Release Readiness|Reports/i),
  productRoute('/reports/observation', '/reports/observation', 'Observation Report', 'report', /Observation|Reports/i),
];

export const retiredProductRoutes: readonly ProductRouteContract[] = [
  retiredRoute('/dashboard', '/dashboard', 'Retired Dashboard', 'cockpit'),
  retiredRoute('/plans', '/plans', 'Retired Plans', 'development-plan-index'),
  retiredRoute('/plans/:id', '/plans/plan-1', 'Retired Plan Detail', 'development-plan-detail'),
  retiredRoute('/specs', '/specs', 'Retired Specs', 'governance-queue'),
  retiredRoute('/specs/:id', '/specs/spec-1', 'Retired Spec Detail', 'governance-queue'),
  retiredRoute('/tasks', '/tasks', 'Retired Tasks', 'queue'),
  retiredRoute('/tasks/:id', '/tasks/task-1', 'Retired Task Detail', 'gate-workspace'),
];

const dashboardScreenshotRoute = retiredProductRoutes[0];
if (dashboardScreenshotRoute === undefined) throw new Error('Dashboard retired route fixture is required');

export const requiredScreenshotRoutes: readonly ProductRouteContract[] = [
  canonicalProductRoutes[0],
  canonicalProductRoutes[1],
  dashboardScreenshotRoute,
  canonicalProductRoutes[2],
  ...canonicalProductRoutes.slice(3),
].filter((route): route is ProductRouteContract => route !== undefined);

export const productCommandItems: readonly ProductCommandItem[] = canonicalProductRoutes.map((route) => ({
  id: route.path === '/' ? 'root' : route.path.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, ''),
  label: route.label,
  family: route.family,
  kind: 'product',
}));
