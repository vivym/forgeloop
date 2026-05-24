// @vitest-environment jsdom

import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';

import {
  isStrictlyApproved,
  SpecPlanLifecycleActions,
} from '../../apps/web/src/features/spec-plan/spec-plan-lifecycle-actions';
import type { SpecPlan } from '../../apps/web/src/shared/api/types';
import { installProductApiMock } from './fixtures/product-api-mock';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';
import { developmentPlan, developmentPlanItem } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

const inReviewSpec: SpecPlan = {
  id: 'spec-1',
  work_item_id: 'work-item-1',
  entity_type: 'spec',
  status: 'in_review',
  editing_state: 'idle',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  current_revision_id: 'spec-rev-1',
};

const draftSpec: SpecPlan = {
  ...inReviewSpec,
  status: 'draft',
  gate_state: 'not_submitted',
};

const draftPlan: SpecPlan = {
  id: 'plan-1',
  work_item_id: 'work-item-1',
  entity_type: 'plan',
  status: 'draft',
  editing_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  current_revision_id: 'plan-rev-1',
};

const approvedPlan: SpecPlan = {
  ...draftPlan,
  status: 'approved',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'plan-rev-1',
  approved_revision_id: 'plan-rev-1',
};
const lifecycleContext = {
  developmentPlanId: 'development-plan-1',
  itemId: 'development-plan-item-1',
};

const renderLifecycle = (ui: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...rendered, queryClient };
};

describe('SpecPlanLifecycleActions', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('submits a draft Spec with a current revision', async () => {
    const user = userEvent.setup();
    const fetchMock = installProductApiMock({
      'POST /development-plans/development-plan-1/items/development-plan-item-1/spec/submit-for-approval': {
        ...draftSpec,
        status: 'in_review',
        gate_state: 'awaiting_approval',
      },
    });

    renderLifecycle(
      <SpecPlanLifecycleActions actorId="actor-owner" artifact={draftSpec} kind="spec" {...lifecycleContext} />,
    );

    await user.click(screen.getByRole('button', { name: 'Submit Spec for approval' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/development-plans/development-plan-1/items/development-plan-item-1/spec/submit-for-approval',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ actor_id: 'actor-owner' }),
        }),
      ),
    );
  });

  it('approves an in-review Plan with optional rationale', async () => {
    const user = userEvent.setup();
    const inReviewPlan = {
      ...draftPlan,
      status: 'in_review',
      gate_state: 'awaiting_approval',
    };
    const fetchMock = installProductApiMock({
      'POST /development-plans/development-plan-1/items/development-plan-item-1/execution-plan/approve': approvedPlan,
    });

    renderLifecycle(
      <SpecPlanLifecycleActions actorId="actor-reviewer" artifact={inReviewPlan} kind="plan" {...lifecycleContext} />,
    );

    await user.type(screen.getByLabelText('Plan approval rationale'), 'Plan is executable.');
    await user.click(screen.getByRole('button', { name: 'Approve Plan' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/development-plans/development-plan-1/items/development-plan-item-1/execution-plan/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Plan is executable.' }),
        }),
      ),
    );
  });

  it('requires rationale before requesting changes', async () => {
    const user = userEvent.setup();
    const fetchMock = installProductApiMock({
      'POST /development-plans/development-plan-1/items/development-plan-item-1/spec/request-changes': {
        ...inReviewSpec,
        status: 'changes_requested',
        gate_state: 'changes_requested',
        resolution: 'changes_requested',
      },
    });

    renderLifecycle(
      <SpecPlanLifecycleActions actorId="actor-reviewer" artifact={inReviewSpec} kind="spec" {...lifecycleContext} />,
    );

    expect((screen.getByRole('button', { name: 'Request Spec changes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Spec change rationale'), 'Clarify rollout risk.');
    expect((screen.getByRole('button', { name: 'Request Spec changes' }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Request Spec changes' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/development-plans/development-plan-1/items/development-plan-item-1/spec/request-changes',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Clarify rollout risk.' }),
        }),
      ),
    );
  });

  it('shows blocked reasons when artifacts cannot enter lifecycle actions', () => {
    renderLifecycle(
      <div>
        <SpecPlanLifecycleActions
          actorId="actor-owner"
          artifact={{ ...draftSpec, current_revision_id: undefined }}
          developmentPlanId={lifecycleContext.developmentPlanId}
          itemId={lifecycleContext.itemId}
          kind="spec"
        />
        <SpecPlanLifecycleActions
          actorId="actor-owner"
          artifact={{ ...draftPlan, current_revision_id: undefined }}
          developmentPlanId={lifecycleContext.developmentPlanId}
          itemId={lifecycleContext.itemId}
          kind="plan"
        />
      </div>,
    );

    expect(screen.getByText('Create a current Spec revision before submitting for approval.')).toBeTruthy();
    expect(screen.getByText('Plan approval is available after a current Plan revision exists.')).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('blocks lifecycle mutations without Development Plan Item context', async () => {
    const user = userEvent.setup();
    const fetchMock = installProductApiMock();

    renderLifecycle(<SpecPlanLifecycleActions actorId="actor-owner" artifact={draftSpec} kind="spec" />);

    expect(screen.getByText('Spec lifecycle actions require Development Plan Item context.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit Spec for approval' })).toBeNull();
    await user.keyboard('{Enter}');
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/specs/'), expect.anything());
  });

  it('only treats artifacts as strictly approved when the approved revision is current', () => {
    expect(isStrictlyApproved(approvedPlan)).toBe(true);
    expect(isStrictlyApproved({ ...approvedPlan, current_revision_id: 'plan-rev-2' })).toBe(false);
    expect(isStrictlyApproved({ ...approvedPlan, approved_revision_id: undefined })).toBe(false);
    expect(isStrictlyApproved({ ...approvedPlan, resolution: 'none' })).toBe(false);
    expect(isStrictlyApproved(undefined)).toBe(false);
  });
});

describe('Specs & Execution Plans route queue', () => {
  it('renders governance queues scoped to Development Plan Items', async () => {
    const routeScreen = await renderRoute('/specs-plans');

    expect(await routeScreen.findByRole('heading', { name: 'Specs & Execution Plans' })).toBeTruthy();
    expect((await routeScreen.findAllByText(/Spec needs generation/i)).length).toBeGreaterThan(0);
    expect((await routeScreen.findAllByRole('link', { name: /open plan item/i })).map((link) => link.getAttribute('href'))).toEqual([
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`,
    ]);
    const plansTab = routeScreen.getByRole('tab', { name: 'Execution Plans' });
    expect(plansTab.getAttribute('href')).toBe('/specs-plans?tab=plans');
    cleanup();
    const plansScreen = await renderRoute('/specs-plans?tab=plans');
    expect((await plansScreen.findAllByText(/Execution Plan needs review/i)).length).toBeGreaterThan(0);
    expect((await plansScreen.findAllByRole('link', { name: /open plan item/i })).map((link) => link.getAttribute('href'))).toEqual([
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution-plan`,
    ]);
    expect(document.body.textContent).not.toMatch(/\/plans\/|\/specs\/|\/tasks\//);
  });

  it.each([
    '/plans',
    '/plans/plan-1',
    '/specs',
    '/specs/spec-1',
    '/requirements/req-1/spec',
    '/requirements/req-1/plan',
    '/bugs/bug-1/spec',
    '/bugs/bug-1/plan',
    '/tech-debt/td-1/spec',
    '/tech-debt/td-1/plan',
    '/initiatives/init-1/spec',
    '/initiatives/init-1/plan',
  ])('does not expose legacy or direct artifact route %s', async (route) => {
    const routeScreen = await renderRoute(route);
    expect(await routeScreen.findByRole('heading', { name: /not found/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/generate spec|generate execution plan|start execution/i);
  });
});
