export type ProductRouteKind = 'product' | 'dev-tools';

export type ProductPageFamily =
  | 'cockpit'
  | 'inbox'
  | 'source-database'
  | 'source-document'
  | 'source-evidence'
  | 'planning-table'
  | 'plan-authoring'
  | 'gate-workspace'
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

export interface ProductVisualViewport {
  width: number;
  height: number;
  label: `${number}x${number}`;
}

export const visualViewports = [
  { width: 375, height: 812, label: '375x812' },
  { width: 768, height: 1024, label: '768x1024' },
  { width: 1280, height: 720, label: '1280x720' },
  { width: 1440, height: 900, label: '1440x900' },
] as const satisfies readonly ProductVisualViewport[];

export interface ProductRouteContract {
  path: string;
  concretePath: string;
  label: string;
  family: ProductPageFamily;
  kind: ProductRouteKind;
  heading: RegExp;
  viewports: typeof visualViewports;
}

export interface ProductCommandItem {
  id: string;
  label: string;
  path: string;
  family: ProductPageFamily;
  kind: ProductRouteKind;
}

const requirementId = 'req-product-workspace-clarity';
const initiativeId = 'init-product-workspace-redesign';
const bugId = 'bug-plan-item-action-eligibility';
const techDebtId = 'td-retire-generic-product-page';
const developmentPlanId = 'dp-product-workspace-core-surface-redesign';
const reviewItemId = 'dpi-plan-item-gate-eligibility';
const implementationPlanItemId = 'dpi-requirements-database-view';
const executionItemId = 'dpi-product-workspace-preview-state';
const executionId = 'exec-product-workspace-preview-active';
const releaseId = 'rel-product-workspace-preview';

const developmentPlanHeading = /^Product workspace core surface redesign$/i;
const actionEligibilityItemHeading = /^Enforce Plan Item action eligibility$/i;
const requirementsDatabaseItemHeading = /^Replace Requirements list with database view$/i;
const productWorkspacePreviewItemHeading = /^Seed product workspace state for visual review$/i;

function productRoute(
  path: string,
  concretePath: string,
  label: string,
  family: ProductPageFamily,
  heading: RegExp,
): ProductRouteContract {
  return { path, concretePath, label, family, kind: 'product', heading, viewports: visualViewports };
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
    'gate-workspace',
    actionEligibilityItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/spec',
    `/development-plans/${developmentPlanId}/items/${reviewItemId}/spec`,
    'Spec',
    'document-review',
    actionEligibilityItemHeading,
  ),
  productRoute(
    '/development-plans/:id/items/:itemId/implementation-plan',
    `/development-plans/${developmentPlanId}/items/${implementationPlanItemId}/implementation-plan`,
    'Implementation Plan Doc',
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
  productRoute('/reviews', '/reviews', 'Document Reviews', 'document-governance', /^Document Reviews$/i),
  productRoute('/qa', '/qa', 'QA', 'qa-handoff', /^QA$/i),
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

export const retiredProductRoutes: readonly ProductRouteContract[] = [];

export const retiredProductQueryStates: readonly string[] = [];

export const requiredScreenshotRoutes: readonly ProductRouteContract[] = canonicalProductRoutes;

export const productCommandItems: readonly ProductCommandItem[] = canonicalProductRoutes.map((route) => ({
  id: route.path === '/' ? 'root' : route.path.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, ''),
  label: route.label,
  path: route.path,
  family: route.family,
  kind: 'product',
}));
