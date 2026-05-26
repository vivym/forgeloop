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
  '/initiatives/init-ai-native-rollout',
  '/initiatives/init-ai-native-rollout/evidence',
  '/requirements',
  '/requirements/new',
  '/requirements/req-plan-item-governance',
  '/requirements/req-plan-item-governance/evidence',
  '/bugs',
  '/bugs/new',
  '/bugs/bug-execution-review-context',
  '/bugs/bug-execution-review-context/evidence',
  '/tech-debt',
  '/tech-debt/new',
  '/tech-debt/td-retire-workspace-page-template',
  '/tech-debt/td-retire-workspace-page-template/evidence',
  '/development-plans',
  '/development-plans/new',
  '/development-plans/dp-product-architecture-visual-rebuild',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-development-plan-table-inspector/brainstorming',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/spec',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/execution-plan',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-demo-seed-visual-review/execution',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/review',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/qa',
  '/specs-plans',
  '/executions',
  '/executions/exec-demo-seed-visual-review',
  '/board',
  '/releases',
  '/releases/rel-product-architecture-preview',
  '/releases/rel-product-architecture-preview/evidence',
  '/reports',
  '/reports/delivery',
  '/reports/quality',
  '/reports/release-readiness',
  '/reports/observation',
];

describe('product-grade route contract', () => {
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
