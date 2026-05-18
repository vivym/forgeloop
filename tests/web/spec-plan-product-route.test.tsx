// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkItemSpecPlanRoute from '../../apps/web/src/app/routes/work-items/$workItemId/spec-plan';
import { renderRoute } from './router-test-utils';

describe('Work Item scoped Spec & Plan route', () => {
  it('renders Work Item scoped Spec & Plan actions without raw loaders', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan');
    expect(screen.getByRole('heading', { name: 'Spec & Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open revision history' })).toBeTruthy();
    expect(screen.queryByLabelText('spec_id')).toBeNull();
    expect(screen.queryByLabelText('plan_id')).toBeNull();
    expect(screen.queryByText('raw JSON')).toBeNull();
    expect(screen.queryByText('actor-owner')).toBeNull();
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
            owner_actor_id: 'actor-owner',
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
          next_actions: [],
          completion_state: {},
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
        owner_actor_id: 'actor-owner',
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
      next_actions: [],
      completion_state: {},
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

  it('runs create plan only after a spec exists', async () => {
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
            owner_actor_id: 'actor-owner',
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
            status: 'draft',
            editing_state: 'editable',
            gate_state: 'open',
            resolution: 'unresolved',
          },
          current_plan: null,
          packages: [],
          run_sessions: [],
          review_packets: [],
          next_actions: [],
          completion_state: {},
        },
        'POST /work-items/wi-1/plans': {
          id: 'plan-created',
          work_item_id: 'wi-1',
          entity_type: 'plan',
          status: 'draft',
          editing_state: 'editable',
          gate_state: 'open',
          resolution: 'unresolved',
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

  it('generates drafts only for existing artifacts and keeps approval commands deferred', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/work-items/wi-1/spec-plan');

    const generateSpec = (await screen.findByRole('button', { name: 'Generate spec draft' })) as HTMLButtonElement;
    const generatePlan = screen.getByRole('button', { name: 'Generate plan draft' }) as HTMLButtonElement;
    expect(generateSpec.disabled).toBe(false);
    expect(generatePlan.disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Submit for approval' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Request changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Available after planning artifacts are ready.')).toBeTruthy();
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
            owner_actor_id: 'actor-owner',
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
          next_actions: [],
          completion_state: {},
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
    const screen = await renderRoute('/work-items/wi-1/spec-plan', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1': {},
      },
    });

    expect(await screen.findByText('No work item planning context is available.')).toBeTruthy();
    const historyButton = screen.getByRole('button', { name: 'Open revision history' }) as HTMLButtonElement;
    expect(historyButton.disabled).toBe(true);

    await user.click(historyButton);

    expect(screen.queryByRole('heading', { name: 'Revision history' })).toBeNull();
    expect(screen.queryByText('No revision yet')).toBeNull();
    expect(screen.getByText('Revision history is available after work item planning data loads.')).toBeTruthy();
  });
});
