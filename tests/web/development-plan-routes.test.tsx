// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { boundarySummary, developmentPlan, developmentPlanItem } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('Development Plan routes', () => {
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
