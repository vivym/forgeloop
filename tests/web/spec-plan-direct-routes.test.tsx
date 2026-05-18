// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderRoute } from './router-test-utils';

describe('Spec and Plan direct routes', () => {
  it('renders direct Spec detail with parent link and History / Timeline', async () => {
    const screen = await renderRoute('/specs/spec-1', {
      apiOverrides: {
        'GET /query/specs/spec-1': {
          id: 'spec-1',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'spec-rev-1',
        },
        'GET /query/specs/spec-1/history': [
          {
            id: 'spec-rev-1',
            spec_id: 'spec-1',
            work_item_id: 'wi-1',
            revision_number: 1,
            summary: 'Release cockpit scope approved',
            content: 'Clarify release cockpit planning scope.',
            background: 'Release readiness needs visible planning context.',
            goals: ['Show planning state'],
            scope_in: ['Direct Spec route'],
            scope_out: ['Package execution'],
            acceptance_criteria: ['Parent Work Item is visible'],
            test_strategy_summary: 'Route tests cover direct navigation.',
            created_at: '2026-05-18T00:00:00.000Z',
          },
        ],
      },
    });

    expect(await screen.findByRole('heading', { level: 1, name: /spec/i })).toBeTruthy();
    expect(await screen.findByText('History / Timeline')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Work Item' })).toBeTruthy();
  });

  it('renders direct Plan revision as read-only structured content', async () => {
    const screen = await renderRoute('/plans/plan-1/revisions/plan-rev-1', {
      apiOverrides: {
        'GET /query/plans/plan-1': {
          id: 'plan-1',
          work_item_id: 'wi-1',
          entity_type: 'plan',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'plan-rev-1',
        },
        'GET /plan-revisions/plan-rev-1': {
          id: 'plan-rev-1',
          plan_id: 'plan-1',
          work_item_id: 'wi-1',
          revision_number: 1,
          summary: 'Approved implementation path',
          content: 'Implement the release cockpit planning surface as direct routes.',
          implementation_summary: 'Use route params, shared hooks, and read-only revision rendering.',
          split_strategy: 'Keep package generation outside this route task.',
          dependency_order: ['Spec detail route', 'Plan detail route'],
          test_matrix: ['Spec and Plan direct route tests'],
          risk_mitigations: ['Avoid raw manual loaders'],
          rollback_notes: 'Revert the route slice commit.',
          created_at: '2026-05-18T00:10:00.000Z',
        },
      },
    });

    expect(await screen.findByText('Read-only revision')).toBeTruthy();
    expect(screen.getByText('Approved implementation path')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('filters Specs registry by status through search params', async () => {
    const screen = await renderRoute('/specs?status=approved', {
      apiOverrides: {
        'GET /query/specs?project_id=project-web-product': [
          {
            id: 'spec-approved',
            work_item_id: 'wi-1',
            entity_type: 'spec',
            status: 'approved',
            editing_state: 'locked',
            gate_state: 'passed',
            resolution: 'approved',
            current_revision_id: 'spec-rev-approved',
            revision_number: 1,
          },
          {
            id: 'spec-draft',
            work_item_id: 'wi-2',
            entity_type: 'spec',
            status: 'draft',
            editing_state: 'editable',
            gate_state: 'open',
            resolution: 'unresolved',
            current_revision_id: 'spec-rev-draft',
          },
        ],
      },
    });

    const approvedSpecLink = (await screen.findByRole('link', { name: 'Revision 1' })) as HTMLAnchorElement;
    expect(approvedSpecLink.getAttribute('href')).toBe('/specs/spec-approved');
    expect(screen.queryByRole('link', { name: 'Current revision' })).toBeNull();
  });
});
