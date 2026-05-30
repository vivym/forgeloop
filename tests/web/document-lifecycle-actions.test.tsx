// @vitest-environment jsdom

import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';

import {
  isStrictlyApproved,
  DocumentLifecycleActions,
} from '../../apps/web/src/features/development-plans/document-lifecycle-actions';
import type { ReviewableDocumentArtifact } from '../../apps/web/src/shared/api/types';
import { installProductApiMock } from './fixtures/product-api-mock';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';
import {
  bugListItem,
  developmentPlan,
  developmentPlanItem,
  executionPlan,
  initiativeListItem,
  projectId,
  requirementListItem,
  techDebtListItem,
} from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

const inReviewSpec: ReviewableDocumentArtifact = {
  id: 'spec-1',
  work_item_id: 'work-item-1',
  entity_type: 'spec',
  status: 'in_review',
  editing_state: 'idle',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  current_revision_id: 'spec-rev-1',
};

const draftSpec: ReviewableDocumentArtifact = {
  ...inReviewSpec,
  status: 'draft',
  gate_state: 'not_submitted',
};

const draftPlan: ReviewableDocumentArtifact = {
  id: 'plan-1',
  work_item_id: 'work-item-1',
  entity_type: 'plan',
  status: 'draft',
  editing_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  current_revision_id: 'plan-rev-1',
};

const approvedPlan: ReviewableDocumentArtifact = {
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

describe('DocumentLifecycleActions', () => {
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
      <DocumentLifecycleActions actorId="actor-owner" artifact={draftSpec} kind="spec" {...lifecycleContext} />,
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

  it('approves an in-review Implementation Plan Doc with optional rationale', async () => {
    const user = userEvent.setup();
    const inReviewPlan = {
      ...draftPlan,
      status: 'in_review',
      gate_state: 'awaiting_approval',
    };
    const fetchMock = installProductApiMock({
      'POST /development-plans/development-plan-1/items/development-plan-item-1/implementation-plan/approve': approvedPlan,
    });

    renderLifecycle(
      <DocumentLifecycleActions actorId="actor-reviewer" artifact={inReviewPlan} kind="implementation-plan" {...lifecycleContext} />,
    );

    await user.type(screen.getByLabelText('Implementation Plan Doc approval rationale'), 'Plan is executable.');
    await user.click(screen.getByRole('button', { name: 'Approve Implementation Plan Doc' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/development-plans/development-plan-1/items/development-plan-item-1/implementation-plan/approve',
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
      <DocumentLifecycleActions actorId="actor-reviewer" artifact={inReviewSpec} kind="spec" {...lifecycleContext} />,
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
        <DocumentLifecycleActions
          actorId="actor-owner"
          artifact={{ ...draftSpec, current_revision_id: undefined }}
          developmentPlanId={lifecycleContext.developmentPlanId}
          itemId={lifecycleContext.itemId}
          kind="spec"
        />
        <DocumentLifecycleActions
          actorId="actor-owner"
          artifact={{ ...draftPlan, current_revision_id: undefined }}
          developmentPlanId={lifecycleContext.developmentPlanId}
          itemId={lifecycleContext.itemId}
          kind="implementation-plan"
        />
      </div>,
    );

    expect(screen.getByText('Create a current Spec revision before submitting for approval.')).toBeTruthy();
    expect(screen.getByText('Implementation Plan Doc approval is available after a current Implementation Plan Doc revision exists.')).toBeTruthy();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('blocks lifecycle mutations without Development Plan Item context', async () => {
    const user = userEvent.setup();
    const fetchMock = installProductApiMock();

    renderLifecycle(<DocumentLifecycleActions actorId="actor-owner" artifact={draftSpec} kind="spec" />);

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

describe('Document Reviews route queue', () => {
  it('renders governance queues scoped to Development Plan Items', async () => {
    const governanceRows = [
      {
        id: 'spec-needs-generation',
        artifact_type: 'spec',
        title: 'Spec needs generation',
        status: 'missing',
        gate_state: 'needs_generation',
        summary: 'Spec is missing for the approved Development Plan Item boundary.',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        reviewer_actor_id: 'actor-tech-lead',
        age_label: '2h',
        risk: developmentPlanItem.risk,
        next_action: 'Generate Spec from approved boundary.',
        command: 'Generate Spec',
        href: '/specs/spec-needs-generation',
      },
      {
        id: 'spec-needs-review',
        artifact_type: 'spec',
        title: 'Spec needs review',
        status: 'in_review',
        gate_state: 'awaiting_review',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'development-plan-item-review',
          development_plan_id: developmentPlan.id,
          title: 'Review execution continuation states',
        },
        reviewer_actor_id: 'actor-reviewer',
        age_label: '1h',
        risk: 'medium',
        next_action: 'Review Spec revision.',
        command: 'Submit Spec for approval',
      },
      {
        id: 'spec-changes-requested',
        artifact_type: 'spec',
        title: 'Spec changes requested',
        status: 'changes_requested',
        gate_state: 'changes_requested',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'development-plan-item-changes',
          development_plan_id: developmentPlan.id,
          title: 'Clarify retry behavior',
        },
        reviewer_actor_id: 'actor-reviewer',
        age_label: '4h',
        risk: 'high',
        next_action: 'Revise Spec and resubmit.',
        command: 'Revise Spec',
      },
      {
        id: 'spec-approved',
        artifact_type: 'spec',
        title: 'Spec approved',
        status: 'approved',
        gate_state: 'approved',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'development-plan-item-approved',
          development_plan_id: developmentPlan.id,
          title: 'Ready Implementation Plan Doc item',
        },
        reviewer_actor_id: 'actor-reviewer',
        age_label: '10m',
        risk: 'low',
        next_action: 'Generate Implementation Plan Doc.',
        command: 'Generate Implementation Plan Doc',
      },
      {
        id: 'spec-stale',
        artifact_type: 'spec',
        title: 'Spec stale after boundary change',
        status: 'stale',
        gate_state: 'stale',
        stale: true,
        blocked: true,
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'development-plan-item-stale',
          development_plan_id: developmentPlan.id,
          title: 'Blocked stale governance row',
        },
        reviewer_actor_id: 'actor-reviewer',
        age_label: '2d',
        risk: 'critical',
        next_action: 'Resolve stale boundary blocker.',
        command: 'Regenerate Spec',
      },
      {
        id: executionPlan.id,
        artifact_type: 'implementation_plan_doc',
        title: 'Implementation Plan Doc needs review',
        status: 'in_review',
        gate_state: 'awaiting_review',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        reviewer_actor_id: 'actor-reviewer',
        age_label: '45m',
        risk: developmentPlanItem.risk,
        next_action: 'Review Implementation Plan Doc before execution.',
        command: 'Approve Implementation Plan Doc',
        href: `/plans/${executionPlan.id}`,
      },
    ];
    const apiOverrides = {
      [`GET /query/reviews?project_id=${projectId}&limit=100`]: {
        items: governanceRows,
        degraded_sources: [],
      },
    };
    const routeScreen = await renderRoute('/reviews', { apiOverrides });

    expect(await routeScreen.findByRole('heading', { name: 'Document Reviews' })).toBeTruthy();
    for (const label of ['Needs generation', 'Needs review', 'Changes requested', 'Approved / ready', 'Stale / blocked']) {
      expect(routeScreen.getByRole('region', { name: label })).toBeTruthy();
    }
    expect(routeScreen.getByRole('region', { name: /selected governance row/i }).textContent).toMatch(
      /document summary|gate status|reviewer|development plan item|command/i,
    );
    expect((await routeScreen.findAllByRole('link', { name: /open plan item/i })).map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`,
    );
    const plansTab = routeScreen.getByRole('tab', { name: 'Implementation Plan Docs' });
    expect(plansTab.getAttribute('href')).toBe('/reviews?tab=implementation-plans');
    cleanup();
    const plansScreen = await renderRoute('/reviews?tab=implementation-plans', { apiOverrides });
    expect((await plansScreen.findAllByText(/Implementation Plan Doc needs review/i)).length).toBeGreaterThan(0);
    expect((await plansScreen.findAllByRole('link', { name: /open plan item/i })).map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/implementation-plan`,
    );
    expect(document.body.textContent).not.toMatch(/\/plans\/|\/specs\/|\/tasks\//);
  });

  it.each([
    '/plans',
    '/plans/plan-1',
    '/specs',
    '/specs/spec-1',
    `/requirements/${requirementListItem.id}/spec`,
    `/requirements/${requirementListItem.id}/plan`,
    `/bugs/${bugListItem.id}/spec`,
    `/bugs/${bugListItem.id}/plan`,
    `/tech-debt/${techDebtListItem.id}/spec`,
    `/tech-debt/${techDebtListItem.id}/plan`,
    `/initiatives/${initiativeListItem.id}/spec`,
    `/initiatives/${initiativeListItem.id}/plan`,
  ])('does not expose legacy or direct artifact route %s', async (route) => {
    const routeScreen = await renderRoute(route);
    expect(await routeScreen.findByRole('heading', { name: /not found/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/generate spec|generate implementation plan doc|start execution/i);
  });
});
