import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import appRouteConfig from '../../apps/web/src/app/routes';
import {
  canonicalProductRoutes,
  productCommandItems,
  requiredScreenshotRoutes,
  retiredProductQueryStates,
  retiredProductRoutes,
  visualViewports,
} from '../../apps/web/src/features/product-surfaces/route-contract';
import { productNavigationGroups } from '../../apps/web/src/shared/navigation/product-navigation';
import { productWorkspacePreviewScenario } from './fixtures/product-data';
import { planItemGateModels } from '../../apps/web/src/features/development-plans/plan-item-gates';
import { itemHref } from '../../apps/web/src/features/development-plans/development-plan-table';
import { duplicateProductRoutePaths, flattenProductRouteConfig } from './helpers/product-route-config';

const repoRoot = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

const expectedProductRoutes = [
  '/',
  '/cockpit',
  '/my-work',
  '/initiatives',
  '/initiatives/new',
  '/initiatives/:id',
  '/initiatives/:id/evidence',
  '/requirements',
  '/requirements/new',
  '/requirements/:id',
  '/requirements/:id/evidence',
  '/bugs',
  '/bugs/new',
  '/bugs/:id',
  '/bugs/:id/evidence',
  '/tech-debt',
  '/tech-debt/new',
  '/tech-debt/:id',
  '/tech-debt/:id/evidence',
  '/development-plans',
  '/development-plans/new',
  '/development-plans/:id',
  '/development-plans/:id/items/:itemId',
  '/development-plans/:id/items/:itemId/spec',
  '/development-plans/:id/items/:itemId/implementation-plan',
  '/development-plans/:id/items/:itemId/execution',
  '/reviews',
  '/qa',
  '/executions',
  '/executions/:id',
  '/session-operations',
  '/board',
  '/releases',
  '/releases/:id',
  '/releases/:id/evidence',
  '/reports',
  '/reports/delivery',
  '/reports/quality',
  '/reports/release-readiness',
  '/reports/observation',
];

const legacyRoutePaths = [
  '/dashboard',
  '/work-items',
  '/work-items/:id',
  '/packages',
  '/packages/:id',
  '/runs',
  '/runs/:id',
  '/plans',
  '/plans/:id',
  '/specs',
  '/specs/:id',
  '/tasks',
  '/tasks/:id',
];

const expectedScreenshotRoutes = expectedProductRoutes;

const expectedVisualViewports = [
  { width: 375, height: 812, label: '375x812' },
  { width: 768, height: 1024, label: '768x1024' },
  { width: 1280, height: 720, label: '1280x720' },
  { width: 1440, height: 900, label: '1440x900' },
] as const;

const expectedConcreteScreenshotRoutes = [
  '/',
  '/cockpit',
  '/my-work',
  '/initiatives',
  '/initiatives/new',
  '/initiatives/init-product-workspace-redesign',
  '/initiatives/init-product-workspace-redesign/evidence',
  '/requirements',
  '/requirements/new',
  '/requirements/req-product-workspace-clarity',
  '/requirements/req-product-workspace-clarity/evidence',
  '/bugs',
  '/bugs/new',
  '/bugs/bug-plan-item-action-eligibility',
  '/bugs/bug-plan-item-action-eligibility/evidence',
  '/tech-debt',
  '/tech-debt/new',
  '/tech-debt/td-retire-generic-product-page',
  '/tech-debt/td-retire-generic-product-page/evidence',
  '/development-plans',
  '/development-plans/new',
  '/development-plans/dp-product-workspace-core-surface-redesign',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-plan-item-gate-eligibility',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-plan-item-gate-eligibility/spec',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-requirements-database-view/implementation-plan',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-product-workspace-preview-state/execution',
  '/reviews',
  '/qa',
  '/executions',
  '/executions/exec-product-workspace-preview-active',
  '/session-operations',
  '/board',
  '/releases',
  '/releases/rel-product-workspace-preview',
  '/releases/rel-product-workspace-preview/evidence',
  '/reports',
  '/reports/delivery',
  '/reports/quality',
  '/reports/release-readiness',
  '/reports/observation',
];

describe('product-grade route contract', () => {
  it('seeds dense product workspace preview data for every route family', () => {
    expect(productWorkspacePreviewScenario.requirements.map((item) => item.id)).toEqual([
      'req-product-workspace-clarity',
      'req-ai-native-delivery-flow',
      'req-qa-shift-left',
      'req-release-readiness',
    ]);
    expect(productWorkspacePreviewScenario.initiatives.map((item) => item.id)).toEqual([
      'init-product-workspace-redesign',
    ]);
    expect(productWorkspacePreviewScenario.bugs.map((item) => item.id)).toEqual([
      'bug-plan-item-action-eligibility',
    ]);
    expect(productWorkspacePreviewScenario.techDebt.map((item) => item.id)).toEqual([
      'td-retire-generic-product-page',
    ]);
    expect(productWorkspacePreviewScenario.developmentPlans.map((plan) => plan.id)).toEqual([
      'dp-product-workspace-core-surface-redesign',
      'dp-release-risk-closure',
    ]);
    expect(productWorkspacePreviewScenario.developmentPlanItems.length).toBeGreaterThanOrEqual(8);
    expect(productWorkspacePreviewScenario.executions.some((execution) => execution.status === 'running')).toBe(true);
    expect(productWorkspacePreviewScenario.executions.some((execution) => execution.status === 'interrupted')).toBe(true);
    expect(productWorkspacePreviewScenario.codeReviews.some((review) => review.status === 'changes_requested')).toBe(true);
    expect(productWorkspacePreviewScenario.qaHandoffs.some((handoff) => handoff.status === 'pending')).toBe(true);
    expect(productWorkspacePreviewScenario.qaHandoffs.some((handoff) => handoff.status === 'blocked')).toBe(true);
    expect(productWorkspacePreviewScenario.requirements.some((requirement) => requirement.narrative_markdown.includes('!['))).toBe(true);
    expect(productWorkspacePreviewScenario.releaseReadiness.ready).toBe(false);
    expect(productWorkspacePreviewScenario.releaseReadiness.disabled_reasons.length).toBeGreaterThan(0);
  });

  it('covers every required product route family exactly', () => {
    expect(canonicalProductRoutes.map((route) => route.path)).toEqual(expectedProductRoutes);
    expect(requiredScreenshotRoutes.map((route) => route.path)).toEqual(expectedScreenshotRoutes);
  });

  it('keeps retired route families out of command search', () => {
    const commandPaths = productCommandItems.map((item) => item.path);
    expect(commandPaths).toEqual(expectedProductRoutes);

    expect(retiredProductRoutes).toEqual([]);
    for (const routePath of legacyRoutePaths) {
      expect(commandPaths).not.toContain(routePath);
    }
    expect(commandPaths).not.toContain('/dev-tools');
  });

  it('requires screenshot fixtures for every route family', () => {
    expect(visualViewports).toEqual(expectedVisualViewports);
    expect(requiredScreenshotRoutes.every((route) => route.viewports === visualViewports)).toBe(true);
    expect(requiredScreenshotRoutes.every((route) => route.viewports.map((viewport) => viewport.label).join(',') === '375x812,768x1024,1280x720,1440x900')).toBe(true);
    expect(requiredScreenshotRoutes.every((route) => route.concretePath.length > 0)).toBe(true);
    expect(requiredScreenshotRoutes.map((route) => route.concretePath)).toEqual(expectedConcreteScreenshotRoutes);
  });

  it('does not accept retired visual fixture headings as product review evidence', () => {
    const retiredHeadings = [
      'Build AI-native project management API clients',
      'Web product UI architecture foundation plan',
      'Specs & Implementation Plan Docs',
      'Specs and Implementation Plan Docs',
    ];

    for (const route of requiredScreenshotRoutes) {
      for (const heading of retiredHeadings) {
        expect(route.heading.test(heading), `${route.path} must not accept retired heading ${heading}`).toBe(false);
      }
    }
  });

  it('uses the approved primary navigation labels', () => {
    const labels = productNavigationGroups({ devToolsEnabled: false }).flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toContain('Document Reviews');
    expect(labels).not.toContain('Specs & Implementation Plan Docs');
    expect(labels).not.toContain('Specs and Implementation Plan Docs');
  });

  it('does not register retired product routes as active route config entries', () => {
    const activeRoutePaths = flattenProductRouteConfig(appRouteConfig);
    for (const routePath of legacyRoutePaths) {
      expect(activeRoutePaths).not.toContain(routePath.replace(/^\//, ''));
    }
    expect(activeRoutePaths.join('\n')).not.toMatch(/specs-plans|brainstorming|execution-plan|\/items\/[^/]+\/review$|\/items\/[^/]+\/qa$/);
  });

  it('keeps legacy query product modes out of the product route contract', () => {
    expect(retiredProductRoutes).toEqual([]);
    expect(retiredProductQueryStates).toEqual([]);
  });

  it('classifies every registered public router path', () => {
    const registeredPaths = flattenProductRouteConfig(appRouteConfig);
    const classified = new Set([...canonicalProductRoutes.map((route) => route.path.replace(/^\//, '')), 'dev-tools', '*', '']);

    expect(registeredPaths.filter((path) => !classified.has(path))).toEqual([]);
    expect(duplicateProductRoutePaths(registeredPaths)).toEqual([]);
    expect(registeredPaths.join('\n')).not.toMatch(/(^|\/)(dashboard|tasks|work-items|packages|runs|plans|specs)(\/|$)/);
  });

  it('keeps active product link builders on canonical document-native routes', () => {
    const activeLinkSources = [
      'apps/web/src/features/reviews/reviews-route.tsx',
      'apps/web/src/features/reviews/document-review-queue.tsx',
      'apps/web/src/features/reviews/review-queue-view-model.ts',
      'apps/web/src/features/development-plans/development-plan-view-model.ts',
      'apps/web/src/features/my-work/my-work-view-model.ts',
      'apps/web/src/features/cockpit/cockpit-view-model.ts',
      'apps/web/src/features/board/board-route.tsx',
    ].map(readRepoFile).join('\n');

    expect(activeLinkSources).toContain('/reviews');
    expect(activeLinkSources).toContain('implementation-plan');
    expect(activeLinkSources).not.toMatch(/\/specs-plans|\/execution-plan|\/items\/[^`'"]+\/review\b|\/items\/[^`'"]+\/qa\b/);
  });

  it('keeps Plan Item gate model links on registered public routes', () => {
    const [item] = productWorkspacePreviewScenario.developmentPlanItems;
    expect(item).toBeDefined();

    const gateHrefs = planItemGateModels(item).map((gate) => gate.href);
    const itemBaseHref = itemHref(item);

    expect(gateHrefs).toContain(`${itemBaseHref}/spec`);
    expect(gateHrefs).toContain(`${itemBaseHref}/implementation-plan`);
    expect(gateHrefs).toContain(`${itemBaseHref}/execution`);
    expect(gateHrefs).toContain('/executions');
    expect(gateHrefs).toContain('/qa');
    expect(gateHrefs.join('\n')).not.toMatch(/brainstorming|execution-plan|\/items\/[^/]+\/review$|\/items\/[^/]+\/qa$/);
  });
});
