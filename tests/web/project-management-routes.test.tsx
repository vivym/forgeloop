// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { developmentPlan, developmentPlanItem } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

const removedRoutes = [
  '/lanes',
  '/lanes/requirements',
  '/pipeline',
  '/work-items',
  '/work-items/wi-1',
  '/work-items/wi-1/spec-plan',
  '/tasks',
  '/tasks/task-1',
  '/tasks/new',
  '/tasks/task-1/runs/run-web-product',
  '/specs',
  '/specs/spec-1',
  '/plans',
  '/plans/plan-1',
  '/requirements/req-1/spec',
  '/requirements/req-1/plan',
  '/bugs/bug-1/spec',
  '/bugs/bug-1/plan',
  '/tech-debt/td-1/spec',
  '/tech-debt/td-1/plan',
  '/initiatives/init-1/spec',
  '/initiatives/init-1/plan',
  '/packages',
  '/runs',
  '/reviews',
];

const legacyOwnerPattern = new RegExp(`${['Work', 'Item', 'Owner'].join(' ')}|${['owner', 'actor', 'id'].join('_')}`);
const forbiddenProductStrings = [
  '/tasks',
  'Work Item Owner',
  'owner_actor_id',
  'Execution Package Browser',
  'Run Session Browser',
  'Review Packet Browser',
  'Raw Replay Browser',
  '/replay',
] as const;
const forbiddenPrimaryNavLabels = ['Execution Packages', 'Run Sessions', 'Review Packets', 'Replay', 'Traces'] as const;
const renderedProductRoutes = [
  '/cockpit',
  '/dashboard',
  '/requirements/req-1',
  `/development-plans/${developmentPlan.id}`,
  `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
  '/specs-plans',
  '/executions',
  '/reports',
  '/reports?report=replay',
] as const;

describe('project management route IA', () => {
  it('renders grouped primary navigation without generic Tasks or direct artifact routes', async () => {
    const screen = await renderRoute('/my-work');
    for (const label of ['Cockpit', 'My Work', 'Requirements', 'Bugs', 'Tech Debt', 'Development Plans', 'Specs & Execution Plans', 'Board', 'Executions', 'Releases', 'Reports']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    for (const label of ['Dashboard', 'Lanes', 'Pipeline', 'Work Items', 'Tasks', 'Packages', 'Runs', 'Reviews', 'Specs', 'Plans']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
    for (const label of forbiddenPrimaryNavLabels) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
  });

  it.each(renderedProductRoutes)('renders %s without historical product baggage', async (route) => {
    const screen = await renderRoute(route);
    expect((await screen.findAllByRole('heading')).length).toBeGreaterThan(0);

    const renderedText = document.body.textContent ?? '';
    const renderedMarkup = document.body.innerHTML;
    for (const forbidden of forbiddenProductStrings) {
      expect(renderedText).not.toContain(forbidden);
      expect(renderedMarkup).not.toContain(forbidden);
    }
    if (route === '/reports?report=replay') {
      expect(renderedText).toContain('Lifecycle replay evidence context');
      expect(renderedMarkup).toContain('report=replay');
    }
    if (!route.startsWith('/releases')) {
      expect(renderedText).not.toContain('Release Owner');
    }
    cleanup();
  });

  it.each(removedRoutes)('does not resolve removed product route %s', async (route) => {
    const screen = await renderRoute(route);
    expect(screen.getByRole('heading', { name: /not found|404/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate spec|generate execution plan|start execution/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|Raw Replay Browser/i);
    cleanup();
  });

  it('renders Specs & Execution Plans as a governance queue instead of direct document browsers', async () => {
    const screen = await renderRoute('/specs-plans');
    expect(await screen.findByRole('heading', { name: 'Specs & Execution Plans' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Specs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Execution Plans' })).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /open plan item/i }))[0]?.getAttribute('href')).toMatch(/^\/development-plans\//);
    expect(document.body.textContent).not.toMatch(/\/specs\/|\/plans\/|\/tasks\//);
  });

  it('renders focused Specs & Execution Plans context from Development Plan Item links', async () => {
    const screen = await renderRoute(`/specs-plans?development_plan_id=${developmentPlan.id}&development_plan_item_id=${developmentPlanItem.id}`);

    expect(await screen.findByText(/Focused governance queue/i)).toBeTruthy();
    expect(await screen.findByText(new RegExp(`Development Plan Item ${developmentPlanItem.id}`, 'i'))).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Execution Plans' }).getAttribute('href')).toBe(
      `/specs-plans?tab=plans&development_plan_id=${developmentPlan.id}&development_plan_item_id=${developmentPlanItem.id}`,
    );
  });

  it('renders source object workspace with role lens and item-scoped downstream actions', async () => {
    const screen = await renderRoute('/requirements/req-1');

    expect(await screen.findByRole('heading', { name: /^Requirement$/ })).toBeTruthy();
    expect(await screen.findByRole('tablist', { name: /source object sections/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /brief/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /development plan/i })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /role lens/i })).toBeTruthy();
    expect(await screen.findByRole('complementary', { name: /next action/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /create development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /link existing development plan/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate spec/i })).toBeNull();
    expect(screen.getByRole('link', { name: /open development plan item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
  });

  it('renders typed list and detail source object surfaces', async () => {
    for (const [route, heading, expectedText] of [
      ['/requirements', 'Requirements', /checkout requirement/i],
      ['/requirements/req-1', 'Requirement', /checkout validation must block bad payment states/i],
      ['/initiatives', 'Initiatives', /checkout reliability initiative/i],
      ['/initiatives/init-1', 'Initiative', /coordinate checkout reliability/i],
      ['/tech-debt', 'Tech Debt', /checkout validation debt/i],
      ['/tech-debt/td-1', 'Tech Debt', /validation logic is duplicated/i],
      ['/bugs', 'Bugs', /checkout regression/i],
      ['/bugs/bug-1', 'Bug', /checkout accepts invalid cards/i],
    ] as const) {
      const screen = await renderRoute(route);
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      expect(await screen.findByText(expectedText)).toBeTruthy();
      expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
      cleanup();
    }
  });

  it('renders typed create forms without Task creation', async () => {
    for (const [route, fields] of [
      ['/requirements/new', ['Stakeholder problem', 'Desired outcome', 'Acceptance criteria', 'Requirement Driver']],
      ['/initiatives/new', ['Business outcome', 'Scope', 'Milestone intent', 'Initiative Driver']],
      ['/tech-debt/new', ['Current pain', 'Desired invariant', 'Affected modules', 'Validation strategy', 'Tech Debt Driver']],
      ['/bugs/new', ['Observed behavior', 'Expected behavior', 'Reproduction steps', 'Environment', 'Severity', 'Bug Driver']],
    ] as const) {
      const screen = await renderRoute(route);
      for (const field of fields) {
        expect(await screen.findByLabelText(new RegExp(field, 'i'))).toBeTruthy();
      }
      expect(screen.getByRole('textbox', { name: /narrative markdown/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /cancel/i }).getAttribute('href')).not.toBe('/work-items');
      cleanup();
    }
  });
});
