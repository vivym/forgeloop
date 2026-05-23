// @vitest-environment jsdom

import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';

import {
  isStrictlyApproved,
  SpecPlanLifecycleActions,
} from '../../apps/web/src/features/spec-plan/spec-plan-lifecycle-actions';
import type { SpecPlan } from '../../apps/web/src/shared/api/types';
import { installProductApiMock } from './fixtures/product-api-mock';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

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

const renderLifecycle = (ui: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...rendered, queryClient };
};

describe('SpecPlanLifecycleActions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('submits a draft Spec with a current revision', async () => {
    const user = userEvent.setup();
    const fetchMock = installProductApiMock({
      'POST /specs/spec-1/submit-for-approval': {
        ...draftSpec,
        status: 'in_review',
        gate_state: 'awaiting_approval',
      },
    });

    renderLifecycle(
      <SpecPlanLifecycleActions actorId="actor-owner" artifact={draftSpec} kind="spec" workItemId="work-item-1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Submit Spec for approval' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/specs/spec-1/submit-for-approval',
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
      'POST /plans/plan-1/approve': approvedPlan,
    });

    renderLifecycle(
      <SpecPlanLifecycleActions actorId="actor-reviewer" artifact={inReviewPlan} kind="plan" workItemId="work-item-1" />,
    );

    await user.type(screen.getByLabelText('Plan approval rationale'), 'Plan is executable.');
    await user.click(screen.getByRole('button', { name: 'Approve Plan' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/plans/plan-1/approve',
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
      'POST /specs/spec-1/request-changes': {
        ...inReviewSpec,
        status: 'changes_requested',
        gate_state: 'changes_requested',
        resolution: 'changes_requested',
      },
    });

    renderLifecycle(
      <SpecPlanLifecycleActions actorId="actor-reviewer" artifact={inReviewSpec} kind="spec" workItemId="work-item-1" />,
    );

    expect((screen.getByRole('button', { name: 'Request Spec changes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Spec change rationale'), 'Clarify rollout risk.');
    expect((screen.getByRole('button', { name: 'Request Spec changes' }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Request Spec changes' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/specs/spec-1/request-changes',
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
          kind="spec"
          workItemId="work-item-1"
        />
        <SpecPlanLifecycleActions
          actorId="actor-owner"
          artifact={{ ...draftPlan, current_revision_id: undefined }}
          kind="plan"
          workItemId="work-item-1"
        />
      </div>,
    );

    expect(screen.getByText('Create a current Spec revision before submitting for approval.')).toBeTruthy();
    expect(screen.getByText('Plan approval is available after a current Plan revision exists.')).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('only treats artifacts as strictly approved when the approved revision is current', () => {
    expect(isStrictlyApproved(approvedPlan)).toBe(true);
    expect(isStrictlyApproved({ ...approvedPlan, current_revision_id: 'plan-rev-2' })).toBe(false);
    expect(isStrictlyApproved({ ...approvedPlan, approved_revision_id: undefined })).toBe(false);
    expect(isStrictlyApproved({ ...approvedPlan, resolution: 'none' })).toBe(false);
    expect(isStrictlyApproved(undefined)).toBe(false);
  });
});
