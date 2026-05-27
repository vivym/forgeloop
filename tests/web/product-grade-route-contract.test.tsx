import { describe, expect, it } from 'vitest';

import appRouteConfig from '../../apps/web/src/app/routes';
import {
  canonicalProductRoutes,
  productCommandItems,
  requiredScreenshotRoutes,
  retiredProductQueryStates,
  retiredProductRoutes,
} from '../../apps/web/src/features/product-surfaces/route-contract';
import { productNavigationGroups } from '../../apps/web/src/shared/navigation/product-navigation';
import { productWorkspacePreviewScenario } from './fixtures/product-data';
import { duplicateProductRoutePaths, flattenProductRouteConfig } from './helpers/product-route-config';

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
  '/development-plans/:id/items/:itemId/brainstorming',
  '/development-plans/:id/items/:itemId/spec',
  '/development-plans/:id/items/:itemId/execution-plan',
  '/development-plans/:id/items/:itemId/execution',
  '/development-plans/:id/items/:itemId/review',
  '/development-plans/:id/items/:itemId/qa',
  '/specs-plans',
  '/executions',
  '/executions/:id',
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

const expectedRetiredSmokeRoutes = [
  '/dashboard',
  '/work-items',
  '/work-items/:id',
  '/packages',
  '/packages/:id',
  '/runs',
  '/runs/:id',
  '/reviews',
  '/reviews/:id',
  '/plans',
  '/plans/:id',
  '/specs',
  '/specs/:id',
  '/tasks',
  '/tasks/:id',
];

const expectedScreenshotRoutes = expectedProductRoutes;

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
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-typed-source-boundary/brainstorming',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-plan-item-gate-eligibility/spec',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-requirements-database-view/execution-plan',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-product-workspace-preview-state/execution',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-plan-item-gate-eligibility/review',
  '/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-qa-shift-left-strategy/qa',
  '/specs-plans',
  '/executions',
  '/executions/exec-product-workspace-preview-active',
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

    for (const route of retiredProductRoutes) {
      expect(commandPaths).not.toContain(route.path);
    }
    expect(commandPaths).not.toContain('/dev-tools');
    expect(retiredProductRoutes.map((route) => route.path)).toEqual(expectedRetiredSmokeRoutes);
  });

  it('requires screenshot fixtures for every route family', () => {
    expect(requiredScreenshotRoutes.every((route) => route.viewports.join(',') === '1440,1024,768,375')).toBe(true);
    expect(requiredScreenshotRoutes.every((route) => route.concretePath.length > 0)).toBe(true);
    expect(requiredScreenshotRoutes.map((route) => route.concretePath)).toEqual(expectedConcreteScreenshotRoutes);
  });

  it('does not accept retired visual fixture headings as product review evidence', () => {
    const retiredHeadings = [
      'Build AI-native project management API clients',
      'Web product UI architecture foundation plan',
      'Specs & Execution Plans',
      'Specs and Execution Plans',
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
    expect(labels).not.toContain('Specs & Execution Plans');
    expect(labels).not.toContain('Specs and Execution Plans');
  });

  it('does not register retired product routes as active route config entries', () => {
    const activeRoutePaths = flattenProductRouteConfig(appRouteConfig);
    expect(activeRoutePaths).not.toContain('dashboard');
    expect(activeRoutePaths).not.toContain('tasks');
    expect(activeRoutePaths).not.toContain('work-items');
    expect(activeRoutePaths).not.toContain('packages');
    expect(activeRoutePaths).not.toContain('runs');
    expect(activeRoutePaths).not.toContain('reviews');
    expect(activeRoutePaths).not.toContain('plans');
    expect(activeRoutePaths).not.toContain('specs');
  });

  it('classifies retired query product modes as dev-only or rejected', () => {
    expect(retiredProductRoutes.map((route) => route.path)).toEqual(expectedRetiredSmokeRoutes);
    expect(retiredProductQueryStates).toContain('/reports?report=replay');
  });

  it('classifies every registered public router path', () => {
    const registeredPaths = flattenProductRouteConfig(appRouteConfig);
    const classified = new Set([...canonicalProductRoutes.map((route) => route.path.replace(/^\//, '')), 'dev-tools', '*', '']);

    expect(registeredPaths.filter((path) => !classified.has(path))).toEqual([]);
    expect(duplicateProductRoutePaths(registeredPaths)).toEqual([]);
    expect(registeredPaths.join('\n')).not.toMatch(/(^|\/)(dashboard|tasks|work-items|packages|runs|reviews|plans|specs)(\/|$)/);
  });
});
