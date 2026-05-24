import { describe, expect, it } from 'vitest';

import {
  canonicalProductRoutes,
  productCommandItems,
  requiredScreenshotRoutes,
  retiredProductRoutes,
} from '../../apps/web/src/features/product-surfaces/route-contract';
import appRouteConfig from '../../apps/web/src/app/routes';
import { flattenProductRouteConfig } from './helpers/product-route-config';

describe('product-grade route contract', () => {
  const expectedProductRoutes = [
    '/',
    '/cockpit',
    '/my-work',
    '/requirements',
    '/requirements/new',
    '/requirements/:id',
    '/requirements/:id/evidence',
    '/initiatives',
    '/initiatives/new',
    '/initiatives/:id',
    '/initiatives/:id/evidence',
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
    '/plans',
    '/plans/:id',
    '/specs',
    '/specs/:id',
    '/tasks',
    '/tasks/:id',
  ];

  const expectedScreenshotRoutes = [
    '/',
    '/cockpit',
    '/dashboard',
    '/my-work',
    ...expectedProductRoutes.filter((path) => !['/', '/cockpit', '/my-work'].includes(path)),
  ];

  it('covers every required product route family exactly', () => {
    expect(canonicalProductRoutes.map((route) => route.path)).toEqual(expectedProductRoutes);
    expect(requiredScreenshotRoutes.map((route) => route.path)).toEqual(expectedScreenshotRoutes);
  });

  it('keeps retired route families out of command search', () => {
    const commandText = JSON.stringify(productCommandItems);
    for (const route of retiredProductRoutes) {
      expect(commandText).not.toContain(route.path);
    }
    expect(retiredProductRoutes.map((route) => route.path)).toEqual(expectedRetiredSmokeRoutes);
  });

  it('requires screenshot fixtures for every route family', () => {
    expect(requiredScreenshotRoutes.every((route) => route.viewports.join(',') === '1440,1024,768,375')).toBe(true);
    expect(requiredScreenshotRoutes.every((route) => route.concretePath.length > 0)).toBe(true);
  });

  it('classifies every registered public router path', () => {
    const registeredPaths = flattenProductRouteConfig(appRouteConfig);
    const classified = new Set([
      ...canonicalProductRoutes.map((route) => route.path.replace(/^\//, '')),
      'dashboard',
      'dev-tools',
      '*',
      '',
    ]);

    expect(registeredPaths.filter((path) => !classified.has(path))).toEqual([]);
    expect(registeredPaths.join('\n')).not.toMatch(/(^|\/)(tasks|plans|specs|packages|runs|reviews|replay)(\/|$)/);
  });
});
