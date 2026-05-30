// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  bugListItem,
  execution,
  initiativeListItem,
  release,
  requirementListItem,
  techDebtListItem,
  developmentPlanItem,
} from '../web/fixtures/product-data';
import { renderRoute } from '../web/router-test-utils';

const activeRoutes = [
  ['/my-work', /my work/i],
  ['/requirements', /^Requirements$/],
  [`/requirements/${requirementListItem.id}`, /^Requirement$/],
  ['/initiatives', /^Initiatives$/],
  [`/initiatives/${initiativeListItem.id}`, /^Initiative$/],
  ['/tech-debt', /^Tech Debt$/],
  [`/tech-debt/${techDebtListItem.id}`, /^Tech Debt$/],
  ['/reviews', /^Document Reviews$/],
  ['/executions', /^Executions$/],
  [`/executions/${execution.id}`, new RegExp(developmentPlanItem.title, 'i')],
  ['/bugs', /^Bugs$/],
  [`/bugs/${bugListItem.id}`, /^Bug$/],
  ['/board', /^Board$/],
  ['/releases', /^Releases$/],
  [`/releases/${release.id}`, /^Release Readiness$/],
  ['/reports', /^Reports$/],
] as const;

const removedRoutes = [
  '/lanes',
  '/pipeline',
  '/work-items',
  '/packages',
  '/runs',
  '/specs-plans',
  '/tasks',
  '/tasks/task-1',
  '/tasks/task-1/packages/pkg-1',
  '/tasks/task-1/runs/run-1',
  '/tasks/task-1/reviews/review-1',
  '/specs',
  '/specs/spec-1',
  '/plans',
  '/plans/plan-1',
  `/requirements/${requirementListItem.id}/spec`,
  `/requirements/${requirementListItem.id}/plan`,
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
    expect(screen.queryByRole('button', { name: /generate spec|generate execution plan|start execution/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|Raw Replay Browser/i);
    cleanup();
  });
});
