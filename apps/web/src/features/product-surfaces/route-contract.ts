export type ProductRouteKind = 'product' | 'retired' | 'dev-tools';

export type ProductPageFamily =
  | 'cockpit'
  | 'inbox'
  | 'source-database'
  | 'source-document'
  | 'source-evidence'
  | 'planning-table'
  | 'plan-authoring'
  | 'gate-flow'
  | 'document-review'
  | 'code-review'
  | 'qa-handoff'
  | 'document-governance'
  | 'delivery-board'
  | 'execution-supervision'
  | 'release-readiness'
  | 'release-evidence'
  | 'report-insight';

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
  path: string;
  family: ProductPageFamily;
  kind: Exclude<ProductRouteKind, 'retired'>;
}

export const visualViewports = [1440, 1024, 768, 375] as const;

const requirementId = 'req-product-workspace-clarity';
const initiativeId = 'init-product-workspace-redesign';
const bugId = 'bug-plan-item-action-eligibility';
const techDebtId = 'td-retire-generic-product-page';
const developmentPlanId = 'dp-product-workspace-core-surface-redesign';
const boundaryItemId = 'dpi-typed-source-boundary';
const reviewItemId = 'dpi-plan-item-gate-eligibility';
const executionPlanItemId = 'dpi-requirements-database-view';
const executionItemId = 'dpi-product-workspace-preview-state';
const qaItemId = 'dpi-qa-shift-left-strategy';
const executionId = 'exec-product-workspace-preview-active';
const releaseId = 'rel-product-workspace-preview';

const developmentPlanHeading = /^Product workspace core surface redesign$/i;
const actionEligibilityItemHeading = /^Enforce Plan Item action eligibility$/i;
const requirementsDatabaseItemHeading = /^Replace Requirements list with database view$/i;
const productWorkspacePreviewItemHeading = /^Seed product workspace state for visual review$/i;
const typedSourceBoundaryItemHeading = /^Define typed source workspace boundaries$/i;
const qaShiftLeftItemHeading = /^Expose QA strategy before execution planning$/i;

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
  productRoute('/my-work', '/my-work', 'My Work', 'inbox', /^My Work$/i),
  productRoute('/initiatives', '/initiatives', 'Initiatives', 'source-database', /^Initiatives$/i),
  productRoute('/initiatives/new', '/initiatives/new', 'New Initiative', 'source-document', /Initiative/i),
  productRoute('/initiatives/:id', `/initiatives/${initiativeId}`, 'Initiative', 'source-document', /^Initiative$/i),
  productRoute('/initiatives/:id/evidence', `/initiatives/${initiativeId}/evidence`, 'Initiative Evidence', 'source-evidence', /Evidence/i),
  productRoute('/requirements', '/requirements', 'Requirements', 'source-database', /^Requirements$/i),
  productRoute('/requirements/new', '/requirements/new', 'New Requirement', 'source-document', /Requirement/i),
  productRoute('/requirements/:id', `/requirements/${requirementId}`, 'Requirement', 'source-document', /^Requirement$/i),
  productRoute('/requirements/:id/evidence', `/requirements/${requirementId}/evidence`, 'Requirement Evidence', 'source-evidence', /Evidence/i),
  productRoute('/bugs', '/bugs', 'Bugs', 'source-database', /^Bugs$/i),
  productRoute('/bugs/new', '/bugs/new', 'New Bug', 'source-document', /Bug/i),
  productRoute('/bugs/:id', `/bugs/${bugId}`, 'Bug', 'source-document', /^Bug$/i),
  productRoute('/bugs/:id/evidence', `/bugs/${bugId}/evidence`, 'Bug Evidence', 'source-evidence', /Evidence/i),
  productRoute('/tech-debt', '/tech-debt', 'Tech Debt', 'source-database', /^Tech Debt$/i),
  productRoute('/tech-debt/new', '/tech-debt/new', 'New Tech Debt', 'source-document', /Tech Debt/i),
  productRoute('/tech-debt/:id', `/tech-debt/${techDebtId}`, 'Tech Debt', 'source-document', /^Tech Debt$/i),
  productRoute('/tech-debt/:id/evidence', `/tech-debt/${techDebtId}/evidence`, 'Tech Debt Evidence', 'source-evidence', /Evidence/i),
  productRoute('/development-plans', '/development-plans', 'Development Plans', 'planning-table', /^Development Plans$/i),
  productRoute('/development-plans/new', '/development-plans/new', 'New Development Plan', 'plan-authoring', /Development Plan/i),
  productRoute(
    '/development-plans/:id',
    `/development-plans/${developmentPlanId}`,
    'Development Plan',
    'planning-table',
    developmentPlanHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId',
    `/development-plans/${developmentPlanId}/items/${reviewItemId}`,
    'Development Plan Item',
    'gate-flow',
    actionEligibilityItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/brainstorming',
    `/development-plans/${developmentPlanId}/items/${boundaryItemId}/brainstorming`,
    'Boundary Brainstorming',
    'gate-flow',
    typedSourceBoundaryItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/spec',
    `/development-plans/${developmentPlanId}/items/${reviewItemId}/spec`,
    'Spec',
    'document-review',
    actionEligibilityItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/execution-plan',
    `/development-plans/${developmentPlanId}/items/${executionPlanItemId}/execution-plan`,
    'Execution Plan',
    'document-review',
    requirementsDatabaseItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/execution',
    `/development-plans/${developmentPlanId}/items/${executionItemId}/execution`,
    'Execution',
    'execution-supervision',
    productWorkspacePreviewItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/review',
    `/development-plans/${developmentPlanId}/items/${reviewItemId}/review`,
    'Code Review',
    'code-review',
    actionEligibilityItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/qa',
    `/development-plans/${developmentPlanId}/items/${qaItemId}/qa`,
    'QA Handoff',
    'qa-handoff',
    qaShiftLeftItemHeading,
  ),
  productRoute('/specs-plans', '/specs-plans', 'Document Reviews', 'document-governance', /^Document Reviews$/i),
  productRoute('/executions', '/executions', 'Executions', 'execution-supervision', /^Executions$/i),
  productRoute('/executions/:id', `/executions/${executionId}`, 'Execution', 'execution-supervision', productWorkspacePreviewItemHeading),
  productRoute('/board', '/board', 'Board', 'delivery-board', /^Board$/i),
  productRoute('/releases', '/releases', 'Releases', 'release-readiness', /^Releases$/i),
  productRoute('/releases/:id', `/releases/${releaseId}`, 'Release', 'release-readiness', /Release/i),
  productRoute('/releases/:id/evidence', `/releases/${releaseId}/evidence`, 'Release Evidence', 'release-evidence', /Evidence/i),
  productRoute('/reports', '/reports', 'Reports', 'report-insight', /^Reports$/i),
  productRoute('/reports/delivery', '/reports/delivery', 'Delivery Report', 'report-insight', /Delivery|Reports/i),
  productRoute('/reports/quality', '/reports/quality', 'Quality Report', 'report-insight', /Quality|Reports/i),
  productRoute('/reports/release-readiness', '/reports/release-readiness', 'Release Readiness Report', 'report-insight', /Release Readiness|Reports/i),
  productRoute('/reports/observation', '/reports/observation', 'Observation Report', 'report-insight', /Observation|Reports/i),
];

export const retiredProductRoutes: readonly ProductRouteContract[] = [
  retiredRoute('/dashboard', '/dashboard', 'Retired Dashboard', 'cockpit'),
  retiredRoute('/work-items', '/work-items', 'Retired Work Items', 'inbox'),
  retiredRoute('/work-items/:id', '/work-items/work-item-1', 'Retired Work Item Detail', 'source-document'),
  retiredRoute('/packages', '/packages', 'Retired Packages', 'execution-supervision'),
  retiredRoute('/packages/:id', '/packages/package-1', 'Retired Package Detail', 'execution-supervision'),
  retiredRoute('/runs', '/runs', 'Retired Runs', 'execution-supervision'),
  retiredRoute('/runs/:id', '/runs/run-1', 'Retired Run Detail', 'execution-supervision'),
  retiredRoute('/reviews', '/reviews', 'Retired Reviews', 'code-review'),
  retiredRoute('/reviews/:id', '/reviews/review-1', 'Retired Review Detail', 'code-review'),
  retiredRoute('/plans', '/plans', 'Retired Plans', 'planning-table'),
  retiredRoute('/plans/:id', '/plans/plan-1', 'Retired Plan Detail', 'planning-table'),
  retiredRoute('/specs', '/specs', 'Retired Specs', 'document-governance'),
  retiredRoute('/specs/:id', '/specs/spec-1', 'Retired Spec Detail', 'document-governance'),
  retiredRoute('/tasks', '/tasks', 'Retired Tasks', 'inbox'),
  retiredRoute('/tasks/:id', '/tasks/task-1', 'Retired Task Detail', 'gate-flow'),
];

export const retiredProductQueryStates = ['/reports?report=replay'] as const;

export const requiredScreenshotRoutes: readonly ProductRouteContract[] = canonicalProductRoutes;

export const productCommandItems: readonly ProductCommandItem[] = canonicalProductRoutes.map((route) => ({
  id: route.path === '/' ? 'root' : route.path.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, ''),
  label: route.label,
  path: route.path,
  family: route.family,
  kind: 'product',
}));
