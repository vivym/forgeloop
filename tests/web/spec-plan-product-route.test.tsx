// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkItemSpecPlanRoute from '../../apps/web/src/app/routes/work-items/$workItemId/spec-plan';
import type { WorkItemDeliveryReadiness } from '../../apps/web/src/shared/api/types';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';
import { renderRoute } from './router-test-utils';

const cockpitReadiness = (workItemId = 'wi-1'): WorkItemDeliveryReadiness => ({
  work_item_id: workItemId,
  work_item_kind: 'requirement',
  active_lane: 'requirements',
  overall_state: 'in_progress',
  stages: [
    'spec',
    'plan',
    'packages',
    'execution',
    'review',
    'integration_readiness',
    'quality_gate',
    'release_readiness',
  ].map((id) => ({
    id: id as WorkItemDeliveryReadiness['stages'][number]['id'],
    label: id,
    state: 'ready',
    owner_lane: 'requirements',
    object_refs: [],
    blockers: [],
    evidence_refs: [],
  })),
  blockers: [],
  evidence: [],
  next_actions: [],
  degraded_sources: [],
});

const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Delivery teams need visible planning readiness.',
  desired_outcome: 'Spec and Plan route fixtures include typed Work Item intake data.',
  acceptance_criteria: ['Work Item cockpit fixtures parse as requirement read models.'],
  in_scope: ['Spec and Plan route cockpit fixtures'],
} as const;

describe('Work Item scoped Spec & Plan route', () => {
  it('renders Work Item scoped Spec & Plan actions without raw loaders', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan');
    expect(await screen.findByRole('heading', { name: 'Spec & Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open revision history' })).toBeTruthy();
    expect(screen.queryByText('actor-owner')).toBeNull();
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('runs create spec when no spec exists and refreshes the work item cockpit', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {
          work_item: {
            id: 'wi-1',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P0',
            risk: 'medium',
            driver_actor_id: 'actor-owner',
            intake_context: requirementIntakeContext,
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
          },
          current_spec: null,
          current_plan: null,
          packages: [],
          run_sessions: [],
          review_packets: [],
          delivery_readiness: cockpitReadiness(),
        },
        'POST /work-items/wi-1/specs': {
          id: 'spec-created',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'draft',
          editing_state: 'editable',
          gate_state: 'open',
          resolution: 'unresolved',
        },
      },
    });

    const createSpec = (await screen.findByRole('button', { name: 'Create Spec' })) as HTMLButtonElement;
    await waitFor(() => expect(createSpec.disabled).toBe(false));
    expect((screen.getByRole('button', { name: 'Create Plan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Generate spec draft' })).toBeNull();

    await user.click(createSpec);

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:3000/work-items/wi-1/specs',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => {
      const cockpitRequests = vi
        .mocked(fetch)
        .mock.calls.filter(([input]) => String(input).includes('/query/work-item-cockpit/wi-1'));
      expect(cockpitRequests.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('keeps create spec disabled until stale cockpit data has refetched', async () => {
    const user = userEvent.setup();
    let cockpitRequests = 0;
    let resolveCockpitRefetch: (() => void) | undefined;
    const staleCockpit = {
      work_item: {
        id: 'wi-1',
        project_id: 'project-web-product',
        kind: 'requirement',
        title: 'Improve release cockpit',
        goal: 'Improve release readiness visibility.',
        success_criteria: ['Planning artifacts are visible'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: 'actor-owner',
        intake_context: requirementIntakeContext,
        phase: 'planning',
        activity_state: 'active',
        gate_state: 'open',
        resolution: 'unresolved',
      },
      current_spec: null,
      current_plan: null,
      packages: [],
      run_sessions: [],
      review_packets: [],
      delivery_readiness: cockpitReadiness(),
    };
    const refreshedCockpit = {
      ...staleCockpit,
      work_item: {
        ...staleCockpit.work_item,
        current_spec_id: 'spec-created',
      },
      current_spec: {
        id: 'spec-created',
        work_item_id: 'wi-1',
        entity_type: 'spec',
        status: 'draft',
        editing_state: 'editable',
        gate_state: 'open',
        resolution: 'unresolved',
      },
    };
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': async () => {
          cockpitRequests += 1;
          if (cockpitRequests === 1) {
            return staleCockpit;
          }

          await new Promise<void>((resolve) => {
            resolveCockpitRefetch = resolve;
          });
          return refreshedCockpit;
        },
        'POST /work-items/wi-1/specs': refreshedCockpit.current_spec,
      },
    });

    const createSpec = (await screen.findByRole('button', { name: 'Create Spec' })) as HTMLButtonElement;
    await waitFor(() => expect(createSpec.disabled).toBe(false));

    await user.click(createSpec);

    await waitFor(() => expect(cockpitRequests).toBe(2));
    await waitFor(() => expect(createSpec.disabled).toBe(true));

    resolveCockpitRefetch?.();

    await waitFor(() => expect(createSpec.disabled).toBe(true));
    expect(await screen.findByRole('button', { name: 'Generate spec draft' })).toBeTruthy();
  });

  it('runs create plan only after the current spec revision is approved', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {
          work_item: {
            id: 'wi-1',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P0',
            risk: 'medium',
            driver_actor_id: 'actor-owner',
            intake_context: requirementIntakeContext,
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
            current_spec_id: 'spec-1',
          },
          current_spec: {
            id: 'spec-1',
            work_item_id: 'wi-1',
            entity_type: 'spec',
            status: 'approved',
            editing_state: 'idle',
            gate_state: 'approved',
            resolution: 'approved',
            current_revision_id: 'spec-rev-approved',
            approved_revision_id: 'spec-rev-approved',
          },
          current_plan: null,
          packages: [],
          run_sessions: [],
          review_packets: [],
          delivery_readiness: cockpitReadiness(),
        },
        'POST /work-items/wi-1/plans': {
          id: 'plan-created',
          work_item_id: 'wi-1',
          entity_type: 'plan',
          status: 'draft',
          editing_state: 'idle',
          gate_state: 'not_submitted',
          resolution: 'none',
        },
      },
    });

    const createPlan = (await screen.findByRole('button', { name: 'Create Plan' })) as HTMLButtonElement;
    expect((screen.getByRole('button', { name: 'Create Spec' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(createPlan.disabled).toBe(false));

    await user.click(createPlan);

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:3000/work-items/wi-1/plans',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('keeps plan creation blocked until spec approval is strict', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {
          work_item: {
            id: 'wi-1',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P0',
            risk: 'medium',
            driver_actor_id: 'actor-owner',
            intake_context: requirementIntakeContext,
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
            current_spec_id: 'spec-1',
          },
          current_spec: {
            id: 'spec-1',
            work_item_id: 'wi-1',
            entity_type: 'spec',
            status: 'approved',
            editing_state: 'idle',
            gate_state: 'approved',
            resolution: 'approved',
            current_revision_id: 'spec-rev-current',
            approved_revision_id: 'spec-rev-approved',
          },
          current_plan: null,
          packages: [],
          run_sessions: [],
          review_packets: [],
          delivery_readiness: cockpitReadiness(),
        },
      },
    });

    expect(await screen.findByText('Create Plan unlocks after the current Spec revision is approved.')).toBeTruthy();
    const createPlan = screen.getByRole('button', { name: 'Create Plan' }) as HTMLButtonElement;

    expect(createPlan.disabled).toBe(true);
    expect(screen.queryByText('Ready for packages')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Continue to Packages' })).toBeNull();
  });

  it('keeps plan creation blocked when approved spec metadata is missing', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {
          work_item: {
            id: 'wi-1',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P0',
            risk: 'medium',
            driver_actor_id: 'actor-owner',
            intake_context: requirementIntakeContext,
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
            current_spec_id: 'spec-1',
          },
          current_spec: {
            id: 'spec-1',
            work_item_id: 'wi-1',
            entity_type: 'spec',
            status: 'approved',
            editing_state: 'idle',
            gate_state: 'approved',
            resolution: 'approved',
            current_revision_id: 'spec-rev-current',
          },
          current_plan: null,
          packages: [],
          run_sessions: [],
          review_packets: [],
          delivery_readiness: cockpitReadiness(),
        },
      },
    });

    expect(await screen.findByText('Create Plan unlocks after the current Spec revision is approved.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create Plan' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('completes Spec approval, Plan creation, Plan approval, and approved package handoff from the Work Item flow', async () => {
    const user = userEvent.setup();
    const workItemState = {
      id: 'wi-1',
      project_id: 'project-web-product',
      kind: 'requirement',
      title: 'Improve release cockpit',
      goal: 'Improve release readiness visibility.',
      success_criteria: ['Planning artifacts are visible'],
      priority: 'P0',
      risk: 'medium',
      driver_actor_id: 'actor-owner',
      intake_context: requirementIntakeContext,
      phase: 'planning',
      activity_state: 'active',
      gate_state: 'open',
      resolution: 'unresolved',
      current_spec_id: 'spec-1',
      current_plan_id: undefined as string | undefined,
    };
    let currentSpec = {
      id: 'spec-1',
      work_item_id: 'wi-1',
      entity_type: 'spec',
      status: 'draft',
      editing_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      current_revision_id: 'spec-rev-approved',
    };
    let currentPlan: Record<string, unknown> | null = null;
    const cockpitResponse = () => ({
      work_item: workItemState,
      current_spec: currentSpec,
      current_plan: currentPlan,
      packages: [],
      run_sessions: [],
      review_packets: [],
      delivery_readiness: cockpitReadiness(),
    });

    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      actorId: 'actor-reviewer',
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': cockpitResponse,
        'POST /specs/spec-1/submit-for-approval': () => {
          currentSpec = {
            ...currentSpec,
            status: 'in_review',
            gate_state: 'awaiting_approval',
            resolution: 'none',
          };
          return currentSpec;
        },
        'POST /specs/spec-1/approve': () => {
          currentSpec = {
            ...currentSpec,
            status: 'approved',
            gate_state: 'approved',
            resolution: 'approved',
            approved_revision_id: 'spec-rev-approved',
          };
          return currentSpec;
        },
        'POST /work-items/wi-1/plans': () => {
          workItemState.current_plan_id = 'plan-1';
          currentPlan = {
            id: 'plan-1',
            work_item_id: 'wi-1',
            entity_type: 'plan',
            status: 'draft',
            editing_state: 'idle',
            gate_state: 'not_submitted',
            resolution: 'none',
            current_revision_id: 'plan-rev-approved',
          };
          return currentPlan;
        },
        'POST /plans/plan-1/submit-for-approval': () => {
          currentPlan = {
            ...currentPlan,
            status: 'in_review',
            gate_state: 'awaiting_approval',
            resolution: 'none',
          };
          return currentPlan;
        },
        'POST /plans/plan-1/approve': () => {
          currentPlan = {
            ...currentPlan,
            status: 'approved',
            gate_state: 'approved',
            resolution: 'approved',
            approved_revision_id: 'plan-rev-approved',
          };
          return currentPlan;
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Submit Spec for approval' }));
    await user.type(await screen.findByLabelText('Spec approval rationale'), 'Spec is ready.');
    await user.click(screen.getByRole('button', { name: 'Approve Spec' }));

    const createPlan = (await screen.findByRole('button', { name: 'Create Plan' })) as HTMLButtonElement;
    await waitFor(() => expect(createPlan.disabled).toBe(false));
    await user.click(createPlan);
    await user.click(await screen.findByRole('button', { name: 'Submit Plan for approval' }));
    await user.click(await screen.findByRole('button', { name: 'Approve Plan' }));

    expect((await screen.findByRole('link', { name: 'Continue to Packages' })).getAttribute('href')).toBe(
      '/packages?plan_revision_id=plan-rev-approved',
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/plans/plan-1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('links package handoff by approved Plan revision only', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {
          work_item: {
            id: 'wi-1',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P0',
            risk: 'medium',
            driver_actor_id: 'actor-owner',
            intake_context: requirementIntakeContext,
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
            current_spec_id: 'spec-1',
            current_plan_id: 'plan-1',
          },
          current_spec: {
            id: 'spec-1',
            work_item_id: 'wi-1',
            entity_type: 'spec',
            status: 'approved',
            editing_state: 'idle',
            gate_state: 'approved',
            resolution: 'approved',
            current_revision_id: 'spec-rev-approved',
            approved_revision_id: 'spec-rev-approved',
          },
          current_plan: {
            id: 'plan-1',
            work_item_id: 'wi-1',
            entity_type: 'plan',
            status: 'approved',
            editing_state: 'idle',
            gate_state: 'approved',
            resolution: 'approved',
            current_revision_id: 'plan-rev-current',
            approved_revision_id: 'plan-rev-approved',
          },
          packages: [],
          run_sessions: [],
          review_packets: [],
          delivery_readiness: cockpitReadiness(),
        },
      },
    });

    expect((await screen.findByRole('link', { name: 'Continue to Packages' })).getAttribute('href')).toBe(
      '/packages?plan_revision_id=plan-rev-approved',
    );
    expect(screen.queryByText('/packages?plan_revision_id=plan-rev-current')).toBeNull();
    expect(screen.queryByText('Ready for packages')).toBeNull();
  });

  it('falls back to package inventory when an approved Plan has no approved revision id', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {
          work_item: {
            id: 'wi-1',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P0',
            risk: 'medium',
            driver_actor_id: 'actor-owner',
            intake_context: requirementIntakeContext,
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
            current_spec_id: 'spec-1',
            current_plan_id: 'plan-1',
          },
          current_spec: {
            id: 'spec-1',
            work_item_id: 'wi-1',
            entity_type: 'spec',
            status: 'approved',
            editing_state: 'idle',
            gate_state: 'approved',
            resolution: 'approved',
            current_revision_id: 'spec-rev-approved',
            approved_revision_id: 'spec-rev-approved',
          },
          current_plan: {
            id: 'plan-1',
            work_item_id: 'wi-1',
            entity_type: 'plan',
            status: 'approved',
            editing_state: 'idle',
            gate_state: 'approved',
            resolution: 'approved',
            current_revision_id: 'plan-rev-current',
          },
          packages: [],
          run_sessions: [],
          review_packets: [],
          delivery_readiness: cockpitReadiness(),
        },
      },
    });

    expect((await screen.findByRole('link', { name: 'View package inventory' })).getAttribute('href')).toBe('/packages');
    expect(screen.queryByRole('link', { name: 'Continue to Packages' })).toBeNull();
  });

  it('generates drafts only for existing artifacts and uses product lifecycle actions', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/work-items/wi-1/spec-plan');

    const generateSpec = (await screen.findByRole('button', { name: 'Generate spec draft' })) as HTMLButtonElement;
    const generatePlan = screen.getByRole('button', { name: 'Generate plan draft' }) as HTMLButtonElement;
    expect(generateSpec.disabled).toBe(false);
    expect(generatePlan.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull();
    expect(screen.queryByText('Available after planning artifacts are ready.')).toBeNull();
    expect(screen.queryByText(new RegExp(`Pending command ${'wir'}${'ing'}`, 'i'))).toBeNull();
    expect(screen.queryByText(new RegExp(`${'wir'}${'ing'}`, 'i'))).toBeNull();

    await user.click(generateSpec);
    await user.click(generatePlan);

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:3000/specs/spec-web-product/generate-draft',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:3000/plans/plan-web-product/generate-draft',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('renders an invalid route state when work item route params are missing', async () => {
    const screen = await renderRoute('/', {
      routes: [{ path: '/', Component: WorkItemSpecPlanRoute }],
    });

    expect(screen.getByText('This Spec & Plan route is missing a work item.')).toBeTruthy();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('/query/work-item-cockpit/wi-1'),
      expect.anything(),
    );
  });

  it('shows revision history without raw revision ids', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {
          work_item: {
            id: 'wi-1',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P0',
            risk: 'medium',
            driver_actor_id: 'actor-owner',
            intake_context: requirementIntakeContext,
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
            current_spec_id: 'spec-1',
            current_plan_id: 'plan-1',
          },
          current_spec: {
            id: 'spec-1',
            work_item_id: 'wi-1',
            entity_type: 'spec',
            status: 'approved',
            editing_state: 'locked',
            gate_state: 'passed',
            resolution: 'approved',
            current_revision_id: 'spec-rev-1',
          },
          current_plan: {
            id: 'plan-1',
            work_item_id: 'wi-1',
            entity_type: 'plan',
            status: 'approved',
            editing_state: 'locked',
            gate_state: 'passed',
            resolution: 'approved',
            current_revision_id: 'plan-rev-1',
          },
          packages: [],
          run_sessions: [],
          review_packets: [],
          delivery_readiness: cockpitReadiness(),
        },
      },
    });

    expect(await screen.findByRole('button', { name: 'Generate spec draft' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open revision history' }));

    expect(screen.getByRole('heading', { name: 'Revision history' })).toBeTruthy();
    expect(screen.queryByText('spec-rev-1')).toBeNull();
    expect(screen.queryByText('plan-rev-1')).toBeNull();
    expect(screen.queryByText('current_revision_id')).toBeNull();
    expect(screen.queryByText('approved_revision_id')).toBeNull();
  });

  it('does not open revision history when work item planning data is unavailable', async () => {
    const user = userEvent.setup();
    const unavailableCockpitPath = '/query/work-item-cockpit/wi-1';
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        [`GET ${unavailableCockpitPath}`]: async () => {
          throw new Error('Work Item cockpit unavailable.');
        },
      },
    });

    expect(await screen.findByText('Spec & Plan data is temporarily unavailable.')).toBeTruthy();
    const historyButton = screen.getByRole('button', { name: 'Open revision history' }) as HTMLButtonElement;
    expect(historyButton.disabled).toBe(true);

    await user.click(historyButton);

    expect(screen.queryByRole('heading', { name: 'Revision history' })).toBeNull();
    expect(screen.queryByText('No revision yet')).toBeNull();
    expect(screen.getByText('Revision history is available after work item planning data loads.')).toBeTruthy();
  });
});
