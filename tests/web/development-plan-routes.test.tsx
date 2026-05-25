// @vitest-environment jsdom

import { cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { boundarySummary, developmentPlan, developmentPlanItem } from './fixtures/product-data';
import { expectFirstViewportContract } from './helpers/first-viewport-contract';
import { renderRoute } from './router-test-utils';

describe('Development Plan routes', () => {
  it('renders the Development Plans index as a PlanningTableWorkspace with filters and summary actions', async () => {
    const screen = await renderRoute('/development-plans');

    expect(await screen.findByRole('heading', { name: 'Development Plans' })).toBeTruthy();
    expectFirstViewportContract(screen, { pageFamily: 'development-plan-index', heading: 'Development Plans' });
    expect(document.querySelector('[data-workspace-layout="planning-table"]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('table', { name: /active development plans/i })).toBeTruthy();
    for (const column of ['Development Plan', 'Source links', 'Plan items', 'Role', 'Gate', 'Risk', 'Status']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    for (const filter of ['Source type', 'Role', 'Gate', 'Risk', 'Status']) {
      expect(screen.getByRole('combobox', { name: filter })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: /create development plan/i }).getAttribute('href')).toBe('/development-plans/new');
    expect(screen.getByRole('link', { name: /generate with ai assistance/i }).getAttribute('href')).toBe('/development-plans/new');
    expect(await screen.findByText(/1 active plan/i)).toBeTruthy();
    expect(screen.getAllByText(/0 blocked/i).length).toBeGreaterThan(0);
    expect((await screen.findByRole('link', { name: /checkout requirement/i })).getAttribute('href')).toBe('/requirements/req-1');
    expect(screen.getAllByText(/1 Plan Item/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b/);
    expect(document.body.textContent).not.toContain('Release Owner');
  });

  it('filters the Development Plans index using real list projection fields', async () => {
    const screen = await renderRoute('/development-plans');

    expect(await screen.findByRole('link', { name: developmentPlan.title })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'developer' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Gate' }), { target: { value: 'execution' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Risk' }), { target: { value: 'medium' } });

    expect(screen.getByRole('link', { name: developmentPlan.title })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Risk' }), { target: { value: 'critical' } });
    expect(screen.queryByRole('link', { name: developmentPlan.title })).toBeNull();
  });

  it('renders a useful Development Plans empty state without reverting to a source picker placeholder', async () => {
    const screen = await renderRoute('/development-plans', {
      apiOverrides: {
        'GET /query/development-plans?project_id=project-web-product': {
          items: [],
          degraded_sources: [],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Development Plans' })).toBeTruthy();
    expect(screen.getByText(/No active Development Plans yet/i)).toBeTruthy();
    expect(screen.getByText(/Select source context, then create a table of Plan Items for boundary approval/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /create development plan/i }).getAttribute('href')).toBe('/development-plans/new');
    expect(screen.getByRole('link', { name: /generate with ai assistance/i }).getAttribute('href')).toBe('/development-plans/new');
    expect(document.body.textContent).not.toMatch(/Pick a source object first/i);
  });

  it('renders the new Development Plan route as a real authoring workspace', async () => {
    const screen = await renderRoute('/development-plans/new');

    expect(await screen.findByRole('heading', { name: 'New Development Plan' })).toBeTruthy();
    expectFirstViewportContract(screen, { pageFamily: 'development-plan-index', heading: 'New Development Plan' });
    expect(document.querySelector('[data-workspace-layout="planning-table"]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('textbox', { name: /development plan title/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /source type/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /source object id/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /manual source guidance/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /ai generation guidance/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^create development plan$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^generate ai-assisted draft$/i })).toBeTruthy();
    expect(screen.getByText(/Downstream Spec and Execution Plan documents are generated only from Plan Items after boundary approval/i)).toBeTruthy();
    expect(screen.getByText(/Validation summary/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Pick a source object first|Generate Spec|Generate Execution Plan|Work Item Owner|owner_actor_id|\bTask\b/);
  });

  it('submits manual and AI-assisted Development Plan authoring with source context only', async () => {
    const user = userEvent.setup();
    const createBodies: unknown[] = [];
    const generateBodies: unknown[] = [];
    const screen = await renderRoute('/development-plans/new', {
      apiOverrides: {
        'POST /development-plans': ({ init }) => {
          createBodies.push(parseRequestBody(init));
          return developmentPlan;
        },
        'POST /development-plans/generate-draft': ({ init }) => {
          generateBodies.push(parseRequestBody(init));
          return { ...developmentPlan, generation_state: 'draft_generated' };
        },
      },
    });

    await user.clear(await screen.findByRole('textbox', { name: /development plan title/i }));
    await user.type(screen.getByRole('textbox', { name: /development plan title/i }), 'Checkout planning closure');
    await user.selectOptions(screen.getByRole('combobox', { name: /source type/i }), 'requirement');
    await user.clear(screen.getByRole('textbox', { name: /source object id/i }));
    await user.type(screen.getByRole('textbox', { name: /source object id/i }), 'req-1');
    await user.type(screen.getByRole('textbox', { name: /manual source guidance/i }), 'Keep the plan scoped to checkout validation boundaries.');
    await user.type(screen.getByRole('textbox', { name: /ai generation guidance/i }), 'Draft Plan Items from checkout acceptance criteria.');

    await user.click(screen.getByRole('button', { name: /^create development plan$/i }));
    expect(createBodies).toEqual([
      expect.objectContaining({
        title: 'Checkout planning closure',
        source_ref: { type: 'requirement', id: 'req-1', title: 'Checkout planning closure source' },
      }),
    ]);
    expect(JSON.stringify(createBodies)).not.toMatch(/spec|execution_plan/i);

    cleanup();
    const generateScreen = await renderRoute('/development-plans/new', {
      apiOverrides: {
        'POST /development-plans/generate-draft': ({ init }) => {
          generateBodies.push(parseRequestBody(init));
          return { ...developmentPlan, generation_state: 'draft_generated' };
        },
      },
    });
    await user.selectOptions(await generateScreen.findByRole('combobox', { name: /source type/i }), 'requirement');
    await user.clear(generateScreen.getByRole('textbox', { name: /source object id/i }));
    await user.type(generateScreen.getByRole('textbox', { name: /source object id/i }), 'req-1');
    await user.type(generateScreen.getByRole('textbox', { name: /ai generation guidance/i }), 'Draft Plan Items from checkout acceptance criteria.');
    await user.click(generateScreen.getByRole('button', { name: /^generate ai-assisted draft$/i }));

    expect(await generateScreen.findByText(/Development Plan draft generated with source context/i)).toBeTruthy();
    expect(generateScreen.getByRole('link', { name: /open development plan/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}`,
    );
    expect(generateBodies).toEqual([
      expect.objectContaining({
        source_ref: { type: 'requirement', id: 'req-1', title: 'Requirement req-1' },
        guidance: expect.stringContaining('Draft Plan Items'),
      }),
    ]);
    expect(JSON.stringify(generateBodies)).not.toMatch(/spec|execution_plan/i);
  });

  it('renders a table-first Development Plan page with gate columns and next actions', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    for (const column of ['Plan item', 'Role', 'Driver', 'Boundary', 'Spec', 'Execution Plan', 'Execution', 'Risk', 'Next action']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /add row/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /regenerate with ai/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /show context manifest/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
  });

  it('renders Development Plan Item gate detail without calling it a Task', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(screen.getAllByText(/Boundary brainstorming/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Spec document/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Execution Plan document/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: /development plan item revisions/i })).toBeTruthy();
    expect(screen.getByText(/Item revision 1/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /compare item revisions/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /boundary summary revisions/i })).toBeTruthy();
    expect(screen.getByText(/Boundary summary revision 1/i)).toBeTruthy();
    expect(screen.getAllByText(boundarySummary.summary_markdown).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /compare boundary revisions/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bTask\b|Work Item Owner|owner_actor_id/);
  });

  it('supports keyboard navigation in the Development Plan table', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);
    expect(await screen.findByRole('table', { name: /development plan items/i })).toBeTruthy();

    await user.tab();
    while (document.activeElement !== screen.getByRole('link', { name: /open item/i })) {
      await user.tab();
    }
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /open item/i }));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
  });

  it('wires boundary brainstorming commands from the item gate detail', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    await user.click(await screen.findByRole('button', { name: /start boundary brainstorming/i }));
    expect(await screen.findByText(/Brainstorming session started/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /answer boundary questions/i }));
    expect(await screen.findByText(/Boundary answer recorded/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /record boundary decision/i }));
    expect(await screen.findByText(/Boundary decision recorded/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /approve boundary/i }));
    expect(await screen.findByText(/Boundary approved/i)).toBeTruthy();
  });

  it('exposes item-scoped lifecycle actions only when their gate prerequisites are met', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    expectButtonDisabled(await screen.findByRole('button', { name: /^generate spec$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /submit spec for review/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /approve spec/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /request spec changes/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /reject spec/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /regenerate spec/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /compare spec revisions/i }));

    expectButtonDisabled(screen.getByRole('button', { name: /^generate execution plan$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /submit execution plan for review/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /approve execution plan/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /request execution plan changes/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /reject execution plan/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /regenerate execution plan/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /compare execution plan revisions/i }));

    expectButtonDisabled(screen.getByRole('button', { name: /^start execution$/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /^interrupt execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^continue execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^ready for code review$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^create qa handoff$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^accept qa handoff$/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /^block qa handoff$/i }));

    await user.click(screen.getByRole('button', { name: /compare spec revisions/i }));
    expect(await screen.findByText(/Compare Spec Revisions command completed/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /compare execution plan revisions/i }));
    expect(await screen.findByText(/Compare Execution Plan Revisions command completed/i)).toBeTruthy();
  });

  it('enables generation, approval, execution, review, and QA actions at the right item statuses', async () => {
    const scenarios = [
      {
        status: { boundary_status: 'approved', spec_status: 'missing' },
        enabled: /^generate spec$/i,
        disabled: [/^generate execution plan$/i, /^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'in_review' },
        enabled: /approve spec/i,
        disabled: [/^generate execution plan$/i, /^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', execution_plan_status: 'missing' },
        enabled: /^generate execution plan$/i,
        disabled: [/^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', execution_plan_status: 'in_review' },
        enabled: /approve execution plan/i,
        disabled: [/^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', execution_plan_status: 'approved', execution_status: 'not_started' },
        enabled: /^start execution$/i,
        disabled: [/^ready for code review$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', execution_plan_status: 'approved', execution_status: 'completed', review_status: 'not_started' },
        enabled: /^ready for code review$/i,
        disabled: [/^create qa handoff$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', execution_plan_status: 'approved', execution_status: 'completed', review_status: 'approved', qa_handoff_status: 'not_started' },
        enabled: /^create qa handoff$/i,
        disabled: [/^accept qa handoff$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', execution_plan_status: 'approved', execution_status: 'completed', review_status: 'approved', qa_handoff_status: 'in_review' },
        enabled: /^accept qa handoff$/i,
        disabled: [/^continue execution$/i],
      },
    ] as const;

    for (const scenario of scenarios) {
      const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
        apiOverrides: {
          [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(scenario.status),
        },
      });

      expectButtonEnabled(await screen.findByRole('button', { name: scenario.enabled }));
      for (const name of scenario.disabled) {
        expectButtonDisabled(screen.getByRole('button', { name }));
      }
      cleanup();
    }
  });

  it('keeps lifecycle actions disabled before prerequisite gates are approved', async () => {
    const pendingItem = {
      ...developmentPlanItem,
      boundary_status: 'pending',
      spec_status: 'missing',
      execution_plan_status: 'missing',
      execution_status: 'not_started',
      review_status: 'not_started',
      qa_handoff_status: 'not_started',
      specs: [],
      execution_plans: [],
      executions: [],
      qa_handoffs: [],
    };
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(pendingItem),
      },
    });

    expectButtonDisabled(await screen.findByRole('button', { name: /^generate spec$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^generate execution plan$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^start execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^ready for code review$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^create qa handoff$/i }));
  });

  it('uses combined verification evidence and canonical execution status gates', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            execution_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'not_started',
          },
          { execution: { status: 'completed', evidence_refs: [], test_evidence_refs: [{ type: 'execution', id: 'test-evidence', title: 'Test evidence' }] } },
        ),
      },
    });

    expectButtonEnabled(await screen.findByRole('button', { name: /^ready for code review$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^interrupt execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^continue execution$/i }));
    cleanup();

    const invalidActiveScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            execution_plan_status: 'approved',
            execution_status: 'running',
          },
          { execution: { status: 'created', worker_state: 'active' } },
        ),
      },
    });

    expectButtonDisabled(await invalidActiveScreen.findByRole('button', { name: /^interrupt execution$/i }));
  });

  it('makes audited exception QA visible and requires QA acceptance evidence', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            execution_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'changes_requested',
            qa_handoff_status: 'not_started',
          },
          {
            codeReview: {
              status: 'changes_requested',
              audited_exception: { reason: 'Prepare QA while review risk is audited.' },
            },
          },
        ),
      },
    });

    expect(await screen.findByText(/Audited code review exception enables early QA preparation/i)).toBeTruthy();
    expectButtonEnabled(screen.getByRole('button', { name: /^create qa handoff$/i }));
    cleanup();

    const noEvidenceScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            execution_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'approved',
            qa_handoff_status: 'pending',
          },
          { execution: { status: 'completed', evidence_refs: [], test_evidence_refs: [] } },
        ),
      },
    });

    expectButtonDisabled(await noEvidenceScreen.findByRole('button', { name: /^accept qa handoff$/i }));
  });

  it('renders required surface states for Development Plan pages', async () => {
    for (const [route, key] of [
      [`/development-plans/${developmentPlan.id}`, 'Development Plan Page'],
      [`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, 'Development Plan Item Detail'],
    ] as const) {
      const screen = await renderRoute(route);
      expect(await screen.findByLabelText(new RegExp(`${key} .* state`, 'i'))).toBeTruthy();
      cleanup();
    }
  });
});

type ItemStatusOverride = Partial<{
  boundary_status: string;
  spec_status: string;
  execution_plan_status: string;
  execution_status: string;
  review_status: string;
  qa_handoff_status: string;
}>;

function itemOverride(
  status: ItemStatusOverride,
  options: {
    codeReview?: Record<string, unknown>;
    execution?: Record<string, unknown>;
  } = {},
) {
  return {
    ...developmentPlanItem,
    ...status,
    object_ref: {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
    development_plan_ref: { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
    source_ref: developmentPlan.source_refs[0],
    boundary_summary_revisions: status.boundary_status === 'approved' ? [
      {
        ...boundarySummary,
        id: boundarySummary.revision_id,
        boundary_summary_id: boundarySummary.id,
        revision_number: 1,
        summary_markdown: boundarySummary.summary_markdown,
      },
    ] : [],
    specs: status.spec_status === 'missing' || status.spec_status === 'not_started' ? [] : [{ id: 'spec-web-product', title: 'Spec revision', current_revision_id: 'spec-revision-web-product', approved_revision_id: 'spec-revision-web-product' }],
    execution_plans: status.execution_plan_status === 'missing' || status.execution_plan_status === 'not_started' ? [] : [{ id: 'execution-plan-web-product', title: 'Execution Plan revision', current_revision_id: 'execution-plan-revision-web-product', approved_revision_id: 'execution-plan-revision-web-product' }],
    executions: status.execution_status === 'not_started' ? [] : [{
      id: 'execution-web-product',
      title: 'Execution',
      status: status.execution_status ?? developmentPlanItem.execution_status,
      evidence_refs: [{ type: 'execution', id: 'execution-web-product', title: 'Verification evidence' }],
      ...options.execution,
    }],
    code_review_handoffs: status.review_status === 'approved' || options.codeReview !== undefined
      ? [{ id: 'code-review-handoff-web-product', title: 'Code review', status: 'approved', ...options.codeReview }]
      : [],
    qa_handoffs: status.qa_handoff_status === 'not_started' ? [] : [{
      id: 'qa-handoff-web-product',
      title: 'QA handoff',
      status: status.qa_handoff_status === 'in_review' ? 'pending' : (status.qa_handoff_status ?? developmentPlanItem.qa_handoff_status),
    }],
    href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
  };
}

function expectButtonDisabled(element: HTMLElement) {
  expect((element as HTMLButtonElement).disabled).toBe(true);
}

function expectButtonEnabled(element: HTMLElement) {
  expect((element as HTMLButtonElement).disabled).toBe(false);
}

function parseRequestBody(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body ?? '{}')) as unknown;
}
