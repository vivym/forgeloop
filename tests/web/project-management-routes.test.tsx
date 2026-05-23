// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

const removedRoutes = [
  '/lanes',
  '/lanes/requirements',
  '/pipeline',
  '/work-items',
  '/work-items/wi-1',
  '/work-items/wi-1/spec-plan',
  '/specs',
  '/plans',
  '/packages',
  '/packages/pkg-1',
  '/runs',
  '/runs/run-1',
  '/reviews',
  '/reviews/review-1',
];

describe('project management route IA', () => {
  it('renders target primary navigation only', async () => {
    const screen = await renderRoute('/my-work');
    for (const label of ['Dashboard', 'My Work', 'Requirements', 'Specs & Plans', 'Tasks', 'Bugs', 'Board', 'Releases', 'Reports']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    for (const label of ['Lanes', 'Pipeline', 'Work Items', 'Packages', 'Runs', 'Reviews']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
  });

  it.each(removedRoutes)('does not resolve removed product route %s', async (route) => {
    const screen = await renderRoute(route);
    expect(screen.getByRole('heading', { name: /not found|404/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /lanes|pipeline|work items|packages|runs|reviews/i })).toBeNull();
  });

  it.each([
    ['/specs/spec-1', /spec/i],
    ['/specs/spec-1/revisions/rev-1', /spec/i],
    ['/plans/plan-1', /plan/i],
    ['/plans/plan-1/revisions/rev-1', /plan/i],
  ])('keeps direct spec and plan detail route %s active', async (route, heading) => {
    const screen = await renderRoute(route);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /not found|404/i })).toBeNull();
  });
});
