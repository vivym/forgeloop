// @vitest-environment jsdom

import { cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from './router-test-utils';
import { taskDetail } from './fixtures/product-data';

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

const legacyOwnerPattern = new RegExp(`${['Work', 'Item', 'Owner'].join(' ')}|${['owner', 'actor', 'id'].join('_')}`);

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

  it('renders Specs & Plans as one queue with separate tabs', async () => {
    const screen = await renderRoute('/specs-plans');
    expect(await screen.findByRole('heading', { name: 'Specs & Plans' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Specs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Plans' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Specs registry' })).toBeNull();
  });

  it('renders typed list and detail surfaces', async () => {
    for (const [route, heading, expectedText] of [
      ['/requirements', 'Requirements', /checkout requirement/i],
      ['/requirements/req-1', 'Requirement', /checkout validation must block bad payment states/i],
      ['/initiatives', 'Initiatives', /checkout reliability initiative/i],
      ['/initiatives/init-1', 'Initiative', /coordinate checkout reliability/i],
      ['/tech-debt', 'Tech Debt', /checkout validation debt/i],
      ['/tech-debt/td-1', 'Tech Debt', /validation logic is duplicated/i],
      ['/tasks', 'Tasks', /developer task/i],
      ['/tasks/task-1', 'Task', /implement checkout guard/i],
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

  it('renders typed create forms with structured fields and object templates', async () => {
    for (const [route, fields] of [
      ['/requirements/new', ['Stakeholder problem', 'Desired outcome', 'Acceptance criteria', 'Requirement Driver']],
      ['/initiatives/new', ['Business outcome', 'Scope', 'Milestone intent', 'Initiative Driver']],
      ['/tech-debt/new', ['Current pain', 'Desired invariant', 'Affected modules', 'Validation strategy', 'Tech Debt Driver']],
      ['/tasks/new', ['Execution brief', 'Acceptance checklist', 'Parent context']],
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

  it('persists task narrative and readiness context during typed create', async () => {
    const screen = await renderRoute('/tasks/new', {
      apiOverrides: {
        'POST /tasks': {
          id: 'task-created',
          object_ref: { type: 'task', id: 'task-created' },
          title: 'Implement checkout guard',
          stale_state: 'current',
          package_generation_eligible: false,
          href: '/tasks/task-created',
        },
        'PATCH /tasks/task-created/narrative': {
          ...taskDetail,
          id: 'task-created',
          ref: { type: 'task', id: 'task-created' },
          title: 'Implement checkout guard',
        },
      },
    });
    const user = userEvent.setup();
    const fetchMock = vi.mocked(globalThis.fetch);

    await user.clear(screen.getByLabelText(/execution brief/i));
    await user.type(screen.getByLabelText(/execution brief/i), 'Implement checkout guard');
    await user.clear(screen.getByLabelText(/acceptance checklist/i));
    await user.type(screen.getByLabelText(/acceptance checklist/i), 'Focused route test passes');
    await user.type(screen.getByLabelText(/repo\/package readiness context/i), 'Ready after approved Spec and Plan revisions.');
    await user.clear(screen.getByLabelText(/narrative markdown/i));
    await user.type(screen.getByLabelText(/narrative markdown/i), '## Task narrative\n\nKeep validation scoped.');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/tasks/task-created/narrative',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Ready after approved Spec and Plan revisions.'),
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/tasks',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"execution_brief":"Implement checkout guard"'),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://localhost:3000/work-items',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"execution_brief":"Implement checkout guard"'),
      }),
    );
  });
});
