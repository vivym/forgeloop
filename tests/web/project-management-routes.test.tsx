// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { actorId, developmentPlan, developmentPlanItem, projectId, requirementListItem } from './fixtures/product-data';
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
    expect(await screen.findByText(/checkout validation must block bad payment states/i)).toBeTruthy();
    expect(document.querySelector('[data-page-family="source-object"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-workspace-layout="object"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-document-surface="source-narrative"]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('region', { name: /source narrative document/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /source metadata/i }).querySelector('[data-compact-metadata]')).toBeInstanceOf(HTMLElement);
    expect(await screen.findByRole('tablist', { name: /source object sections/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /brief/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /development plan/i })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /role lens/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /create development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /link existing development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /add row to existing development plan/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate spec/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /generate execution plan/i })).toBeNull();
    expect(screen.getByRole('link', { name: /open development plan item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(screen.getByText(/evidence 1/i)).toBeTruthy();
    expect(screen.getByText(/release release-web-product/i)).toBeTruthy();
    expect(screen.getByText(/risk medium/i)).toBeTruthy();
    expect(document.querySelector('[data-first-viewport]')?.textContent).not.toMatch(/Evidence attachments|Planning links/i);
    expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
  });

  it('renders source object evidence routes as product-grade evidence workspaces', async () => {
    for (const [route, heading, expectedEvidence] of [
      ['/requirements/req-1/evidence', 'Requirement Evidence', /checkout validation acceptance evidence/i],
      ['/initiatives/init-1/evidence', 'Initiative Evidence', /checkout reliability initiative evidence/i],
      ['/bugs/bug-1/evidence', 'Bug Evidence', /checkout regression reproduction evidence/i],
      ['/tech-debt/td-1/evidence', 'Tech Debt Evidence', /checkout validation debt evidence/i],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect(document.querySelector('[data-page-family="evidence"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-workspace-layout="object"]')).toBeInstanceOf(HTMLElement);
      expect(screen.getByRole('region', { name: /evidence readiness summary/i })).toBeTruthy();
      expect(screen.getAllByText(/relevant evidence/i).length).toBeGreaterThan(0);
      expect((await screen.findAllByText(expectedEvidence)).length).toBeGreaterThan(0);
      expect(screen.getByRole('link', { name: /open source object/i }).getAttribute('href')).toBe(route.replace('/evidence', ''));
      expect(document.querySelector('[data-first-viewport]')?.textContent).not.toMatch(/Raw artifact links|Evidence attachments/i);
      expect(document.body.textContent).not.toMatch(/Scaffold|Generate Spec|Generate Execution Plan|Work Item Owner|owner_actor_id|\/tasks/);
      cleanup();
    }
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

  it('renders source object lists as dense planning queues', async () => {
    for (const [route, heading, objectType, itemTitle, createHref] of [
      ['/requirements', 'Requirements', 'Requirement', /checkout requirement/i, '/requirements/new'],
      ['/initiatives', 'Initiatives', 'Initiative', /checkout reliability initiative/i, '/initiatives/new'],
      ['/tech-debt', 'Tech Debt', 'Tech Debt', /checkout validation debt/i, '/tech-debt/new'],
      ['/bugs', 'Bugs', 'Bug', /checkout regression/i, '/bugs/new'],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect(document.querySelector('[data-page-family="source-object-list"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-workspace-layout="queue"]')).toBeInstanceOf(HTMLElement);
      expect(await screen.findByText(itemTitle)).toBeTruthy();
      expect(screen.getByTestId('current-state').textContent).toMatch(/source object/i);
      expect(screen.getByTestId('next-action').textContent).toMatch(/open source object to inspect planning state/i);
      expect(screen.getByTestId('role-responsibility').textContent).toMatch(/responsibility|assigned/i);
      expect(screen.getByTestId('blocker-risk').textContent).toMatch(/risk|blocker/i);
      expect(screen.getByText('Planning state unknown')).toBeTruthy();
      expect(screen.getByRole('searchbox', { name: new RegExp(`search ${heading}`, 'i') })).toBeTruthy();
      expect(screen.getByRole('button', { name: /view: dense/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /create source object/i }).getAttribute('href')).toBe(createHref);
      expect(screen.getByRole('link', { name: /plan source object/i }).getAttribute('href')).toBe('/development-plans/new');
      expect(screen.getByRole('table', { name: new RegExp(`${heading} source object queue`, 'i') })).toBeTruthy();
      for (const column of ['Object', 'Type', 'Gate / status', 'Risk', 'Role / actor', 'Development Plan', 'Next action', 'Last meaningful update']) {
        expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
      }
      expect(screen.getAllByText(objectType)[0]).toBeTruthy();
      expect(screen.getByRole('link', { name: new RegExp(`open ${objectType}`, 'i') })).toBeTruthy();
      expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
      expect(document.body.textContent).not.toContain('Development Plan missing');
      expect(document.body.textContent).not.toContain('Create Development Plan from source object');
      cleanup();
    }
  });

  it('keeps source object preview tied to the selected row and resets after filtering', async () => {
    const retryRequirement = {
      ...requirementListItem,
      id: 'req-2',
      ref: { type: 'requirement', id: 'req-2' },
      title: 'Checkout retry requirement',
      risk: 'high',
      updated_at: '2026-05-18T02:00:00.000Z',
    };
    const multiRequirementResponse = {
      items: [requirementListItem, retryRequirement],
      degraded_sources: [],
    };
    const screen = await renderRoute('/requirements', {
      apiOverrides: {
        [`GET /query/requirements?project_id=${projectId}`]: multiRequirementResponse,
        [`GET /query/requirements?project_id=${projectId}&limit=100`]: multiRequirementResponse,
      },
    });

    expect(await screen.findByText('Checkout retry requirement')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /view: preview/i }));
    fireEvent.click(screen.getByText('Checkout retry requirement', { selector: 'span.font-semibold' }));

    const preview = screen.getByRole('region', { name: /source object preview/i });
    expect(within(preview).getByText('Updated 2026-05-18T02:00:00.000Z')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: /search requirements/i }), {
      target: { value: 'Checkout requirement' },
    });

    await waitFor(() => expect(screen.queryByText('Checkout retry requirement', { selector: 'span.font-semibold' })).toBeNull());
    expect(within(screen.getByRole('region', { name: /source object preview/i })).queryByText('Updated 2026-05-18T02:00:00.000Z')).toBeNull();
    expect(within(screen.getByRole('region', { name: /source object preview/i })).getByText('Updated 2026-05-18T01:00:00.000Z')).toBeTruthy();
  });

  it('renders unavailable source list relationship metadata without false zeroes', async () => {
    const screen = await renderRoute('/requirements');

    expect(await screen.findByText(/checkout requirement/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /view: preview/i }));

    const preview = screen.getByRole('region', { name: /source object preview/i });
    expect(within(preview).getByText('Related objects')).toBeTruthy();
    expect(within(preview).getByText('Release refs')).toBeTruthy();
    expect(within(preview).getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2);
    expect(within(preview).queryByText('0')).toBeNull();
  });

  it('renders source list empty actions outside DataTable mobile paragraphs', async () => {
    const screen = await renderRoute('/requirements', {
      apiOverrides: {
        [`GET /query/requirements?project_id=${projectId}&limit=100`]: {
          items: [],
          degraded_sources: [],
        },
      },
    });

    expect(await screen.findByText('No requirements source objects.')).toBeTruthy();
    expect(screen.getByText('No requirements source objects.').closest('td')).toBeNull();
    expect(document.querySelector('p [data-source-object-empty-state]')).toBeNull();
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
      expect(screen.queryByRole('textbox', { name: /narrative markdown/i })).toBeNull();
      expect(screen.getByRole('region', { name: /narrative document/i })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: /markdown editor/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /insert image/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /cancel/i }).getAttribute('href')).not.toBe('/work-items');
      cleanup();
    }
  });

  it('shows authoring unsaved-change and validation states', async () => {
    const screen = await renderRoute('/requirements/new');

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Checkout operators need better payment validation.' },
    });

    expect(await screen.findByRole('status', { name: /draft changes/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert', { name: /validation summary/i })).toBeTruthy();
    expect(screen.getAllByText(/desired outcome is required/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText(/desired outcome/i).getAttribute('aria-invalid')).toBe('true');
  });

  it('blocks route navigation for structured-field-only source drafts', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const screen = await renderRoute('/requirements/new');

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Checkout operators need better payment validation.' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Reports' }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Discard unsaved source object draft changes?'));
    expect(screen.getByRole('heading', { name: 'New Requirement' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Reports' })).toBeNull();
    confirm.mockRestore();
  });

  it('navigates from dirty source drafts after a single confirmed cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const screen = await renderRoute('/requirements/new');

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Checkout operators need better payment validation.' },
    });
    fireEvent.click(screen.getByRole('link', { name: /cancel/i }));

    expect(await screen.findByRole('heading', { name: 'Requirements' })).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Discard unsaved source object draft changes?');
    confirm.mockRestore();
  });

  it('submits dirty source drafts without discard prompts blocking success navigation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const screen = await renderRoute('/requirements/new', {
      apiOverrides: {
        'POST /work-items': { id: 'req-created', driver_actor_id: actorId },
        'PATCH /requirements/req-created/narrative': { id: 'req-created' },
      },
    });

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Checkout operators need better payment validation.' },
    });
    fireEvent.change(screen.getByLabelText(/desired outcome/i), {
      target: { value: 'Invalid payment states are rejected before submission.' },
    });
    fireEvent.change(screen.getByLabelText(/acceptance criteria/i), {
      target: { value: 'Invalid cards cannot be submitted.' },
    });
    fireEvent.change(screen.getByLabelText(/^in scope/i), {
      target: { value: 'Checkout payment validation.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('heading', { name: 'Requirements' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
