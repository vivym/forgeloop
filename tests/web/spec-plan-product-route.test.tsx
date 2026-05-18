// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

describe('Work Item scoped Spec & Plan route', () => {
  it('renders Work Item scoped Spec & Plan actions without raw loaders', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan');
    expect(screen.getByRole('heading', { name: 'Spec & Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open revision history' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create Spec' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Create Plan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('spec_id')).toBeNull();
    expect(screen.queryByLabelText('plan_id')).toBeNull();
    expect(screen.queryByText('raw JSON')).toBeNull();
    expect(screen.queryByText('actor-owner')).toBeNull();
  });

  it('disables deferred spec and plan commands when artifacts exist', async () => {
    const screen = await renderRoute('/work-items/wi-1/spec-plan');

    expect((await screen.findByRole('button', { name: 'Generate spec draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Generate plan draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Submit for approval' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Request changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Pending command wiring').length).toBeGreaterThan(0);
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
