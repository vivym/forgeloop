// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderRoute } from '../web/router-test-utils';

const activeRoutes = [
  ['/my-work', /my work/i],
  ['/requirements', /^Requirements$/],
  ['/requirements/req-1', /^Requirement$/],
  ['/initiatives', /^Initiatives$/],
  ['/initiatives/init-1', /^Initiative$/],
  ['/tech-debt', /^Tech Debt$/],
  ['/tech-debt/td-1', /^Tech Debt$/],
  ['/specs-plans', /^Specs & Execution Plans$/],
  ['/executions', /^Executions$/],
  ['/executions/execution-web-product', /^Execution$/],
  ['/bugs', /^Bugs$/],
  ['/bugs/bug-1', /^Bug$/],
  ['/board', /^Board$/],
  ['/releases', /^Releases$/],
  ['/releases/release-web-product', /^Typed scope$/],
  ['/reports', /^Reports$/],
] as const;

const removedRoutes = [
  '/lanes',
  '/pipeline',
  '/work-items',
  '/packages',
  '/runs',
  '/reviews',
  '/tasks',
  '/tasks/task-1',
  '/tasks/task-1/packages/pkg-1',
  '/tasks/task-1/runs/run-1',
  '/tasks/task-1/reviews/review-1',
  '/specs',
  '/specs/spec-1',
  '/plans',
  '/plans/plan-1',
  '/requirements/req-1/spec',
  '/requirements/req-1/plan',
] as const;

describe('web product route smoke', () => {
  it.each(activeRoutes)('visits active product route %s', async (route, heading) => {
    const screen = await renderRoute(route, {
      apiOverrides: {},
    });

    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /not found|404/i })).toBeNull();
    cleanup();
  });

  it.each(removedRoutes)('does not resolve removed product route %s', async (route) => {
    const screen = await renderRoute(route);

    expect(screen.getByRole('heading', { name: /not found/i })).toBeTruthy();
    cleanup();
  });
});
