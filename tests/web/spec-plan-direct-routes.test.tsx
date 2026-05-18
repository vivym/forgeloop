// @vitest-environment jsdom
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';

describe('Spec and Plan direct routes', () => {
  it('renders direct Spec detail with parent link and History / Timeline', async () => {
    const screen = await renderRoute('/specs/spec-1', {
      apiOverrides: {
        'GET /specs/spec-1': {
          id: 'spec-1',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'spec-rev-1',
        },
        'GET /specs/spec-1/revisions': [
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
        'GET /query/replay/spec/spec-1': [
          {
            id: 'spec-event-1',
            source: 'fixture',
            object_type: 'spec',
            object_id: 'spec-1',
            summary: 'Spec approved from product planning review.',
            created_at: '2026-05-18T00:30:00.000Z',
            payload: { actor_id: 'actor-owner', work_item_id: 'wi-1' },
          },
        ],
      },
    });

    expect(await screen.findByRole('heading', { level: 1, name: /spec/i })).toBeTruthy();
    expect(await screen.findByText('History / Timeline')).toBeTruthy();
    expect(screen.getByText('Spec approved from product planning review.')).toBeTruthy();
    expect(screen.getByText('2026-05-18T00:30:00.000Z')).toBeTruthy();
    expect(screen.getByText('Parent: Work Item | Actor: actor-owner')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/actor_id/);
    expect(screen.queryByText('Revision 1 created')).toBeNull();
    expect(screen.getByRole('link', { name: 'Work Item' })).toBeTruthy();
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('http://localhost:3000/specs/spec-1', expect.objectContaining({ method: 'GET' }));
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:3000/specs/spec-1/revisions',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:3000/query/replay/spec/spec-1',
        expect.objectContaining({ method: 'GET' }),
      );
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      'http://localhost:3000/query/specs/spec-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('renders direct Spec revision as read-only structured content', async () => {
    const screen = await renderRoute('/specs/spec-1/revisions/spec-rev-1', {
      apiOverrides: {
        'GET /specs/spec-1': {
          id: 'spec-1',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'spec-rev-1',
        },
        'GET /spec-revisions/spec-rev-1': {
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
      },
    });

    expect(await screen.findByText('Read-only revision')).toBeTruthy();
    expect(screen.getByText('Release cockpit scope approved')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders direct Plan revision as read-only structured content', async () => {
    const screen = await renderRoute('/plans/plan-1/revisions/plan-rev-1', {
      apiOverrides: {
        'GET /plans/plan-1': {
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
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('http://localhost:3000/plans/plan-1', expect.objectContaining({ method: 'GET' }));
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      'http://localhost:3000/query/plans/plan-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects Spec revision routes when the revision belongs to a different Spec', async () => {
    const screen = await renderRoute('/specs/spec-1/revisions/spec-rev-other', {
      apiOverrides: {
        'GET /specs/spec-1': {
          id: 'spec-1',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'spec-rev-1',
        },
        'GET /spec-revisions/spec-rev-other': {
          id: 'spec-rev-other',
          spec_id: 'spec-other',
          work_item_id: 'wi-2',
          revision_number: 1,
          summary: 'Wrong Spec revision',
          content: 'This revision belongs to another Spec.',
          background: 'Mismatched route fixture.',
          goals: ['Do not render wrong content'],
          scope_in: ['Mismatch handling'],
          scope_out: [],
          acceptance_criteria: ['Unavailable state renders'],
          test_strategy_summary: 'Route mismatch test.',
        },
      },
    });

    expect(await screen.findByText('Revision data is temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByText('This revision belongs to another Spec.')).toBeNull();
  });

  it('rejects Plan revision routes when the revision belongs to a different Plan', async () => {
    const screen = await renderRoute('/plans/plan-1/revisions/plan-rev-other', {
      apiOverrides: {
        'GET /plans/plan-1': {
          id: 'plan-1',
          work_item_id: 'wi-1',
          entity_type: 'plan',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'plan-rev-1',
        },
        'GET /plan-revisions/plan-rev-other': {
          id: 'plan-rev-other',
          plan_id: 'plan-other',
          work_item_id: 'wi-2',
          revision_number: 1,
          summary: 'Wrong Plan revision',
          content: 'This revision belongs to another Plan.',
          implementation_summary: 'Mismatch fixture.',
          split_strategy: 'Do not render wrong content.',
          dependency_order: [],
          test_matrix: ['Route mismatch test'],
          risk_mitigations: [],
          rollback_notes: 'Unavailable state renders.',
        },
      },
    });

    expect(await screen.findByText('Revision data is temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByText('This revision belongs to another Plan.')).toBeNull();
  });

  it('filters Specs registry by status through search params', async () => {
    const screen = await renderRoute('/specs?status=approved', {
      apiOverrides: {
        'GET /query/specs?project_id=project-web-product&status=approved&limit=100': {
          items: [
            {
              id: 'spec-approved',
              object: { type: 'spec', id: 'spec-approved', title: 'Approved Spec' },
              title: 'Approved Spec',
              status: 'approved',
              gate_state: 'passed',
              resolution: 'approved',
              parent: { type: 'work_item', id: 'wi-1', title: 'Release cockpit work item' },
              related: [],
              revision_state: {
                current_revision_id: 'spec-rev-approved',
                revision_number: 1,
              },
              counts: {},
              updated_at: '2026-05-18T00:00:00.000Z',
            },
            {
              id: 'spec-draft',
              object: { type: 'spec', id: 'spec-draft', title: 'Draft Spec' },
              title: 'Draft Spec',
              status: 'draft',
              gate_state: 'open',
              resolution: 'unresolved',
              parent: { type: 'work_item', id: 'wi-2', title: 'Draft work item' },
              related: [],
              revision_state: {
                current_revision_id: 'spec-rev-draft',
              },
              counts: {},
              updated_at: '2026-05-18T00:05:00.000Z',
            },
          ],
          degraded_sources: [],
        },
      },
    });

    const approvedSpecLink = (await screen.findByRole('link', { name: 'Revision 1' })) as HTMLAnchorElement;
    expect(approvedSpecLink.getAttribute('href')).toBe('/specs/spec-approved');
    const workItemLink = screen.getByRole('link', { name: 'Release cockpit work item' }) as HTMLAnchorElement;
    expect(workItemLink.getAttribute('href')).toBe('/work-items/wi-1');
    expect(screen.queryByRole('link', { name: 'Current revision' })).toBeNull();
    await waitFor(() => {
      const specRegistryRequest = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => new URL(input.toString()))
        .find((url) => url.pathname === '/query/specs');

      expect(specRegistryRequest?.searchParams.get('project_id')).toBe('project-web-product');
      expect(specRegistryRequest?.searchParams.get('status')).toBe('approved');
      expect(specRegistryRequest?.searchParams.get('limit')).toBe('100');
    });
  });

  it('shows registry unavailable copy when Specs list response has the old array shape', async () => {
    const screen = await renderRoute('/specs', {
      apiOverrides: {
        'GET /query/specs?project_id=project-web-product': [],
        'GET /query/specs?project_id=project-web-product&limit=100': [],
      },
    });

    expect(await screen.findByText('Spec registry data is temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByText('No Specs match the current product filters.')).toBeNull();
  });

  it('renders Plan replay events and approved package action placeholder', async () => {
    const screen = await renderRoute('/plans/plan-1', {
      apiOverrides: {
        'GET /plans/plan-1': {
          id: 'plan-1',
          work_item_id: 'wi-1',
          entity_type: 'plan',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'plan-rev-1',
        },
        'GET /plans/plan-1/revisions': [
          {
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
        ],
        'GET /query/replay/plan/plan-1': [
          {
            id: 'plan-event-1',
            source: 'fixture',
            object_type: 'plan',
            object_id: 'plan-1',
            summary: 'Plan approved for package preparation.',
            created_at: '2026-05-18T00:35:00.000Z',
            payload: { work_item_id: 'wi-1' },
          },
        ],
      },
    });

    expect(await screen.findByText('Plan approved for package preparation.')).toBeTruthy();
    expect(screen.getByText('2026-05-18T00:35:00.000Z')).toBeTruthy();
    expect(screen.getByText('Parent: Work Item | Actor: Not recorded')).toBeTruthy();
    expect(screen.getByText('Package generation starts from the Packages workspace.')).toBeTruthy();
    expect(screen.getByText('Package generation is ready for this approved Plan. Open package readiness to continue.')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'View package readiness' }) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/packages?plan=plan-1',
    );
    const generatePackagesAction = screen.getByRole('button', { name: 'Generate packages' }) as HTMLButtonElement;
    expect(generatePackagesAction.disabled).toBe(true);
    expect(generatePackagesAction.getAttribute('title')).not.toMatch(/mutation|wiring/i);
    expect(document.body.textContent).not.toMatch(/mutation|wiring/i);
    expect(screen.queryByText('Revision 1 created')).toBeNull();
  });

  it('renders degraded parent context when replay event omits Work Item linkage', async () => {
    const screen = await renderRoute('/specs/spec-1', {
      apiOverrides: {
        'GET /specs/spec-1': {
          id: 'spec-1',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'spec-rev-1',
        },
        'GET /specs/spec-1/revisions': [
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
        'GET /query/replay/spec/spec-1': [
          {
            id: 'spec-event-no-parent-link',
            source: 'fixture',
            object_type: 'spec',
            object_id: 'spec-1',
            summary: 'Spec replay loaded from historical event.',
            created_at: '2026-05-18T01:00:00.000Z',
            payload: { actor_id: 'actor-reviewer' },
          },
        ],
      },
    });

    expect(await screen.findByText('Spec replay loaded from historical event.')).toBeTruthy();
    expect(screen.getByText('2026-05-18T01:00:00.000Z')).toBeTruthy();
    expect(
      screen.getByText('Parent context: Work Item linkage not recorded on this event | Actor: actor-reviewer'),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/work_item_id|actor_id/);
  });

  it('recognizes Work Item replay events as parent context by object identity', async () => {
    const screen = await renderRoute('/specs/spec-1', {
      apiOverrides: {
        'GET /specs/spec-1': {
          id: 'spec-1',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'spec-rev-1',
        },
        'GET /specs/spec-1/revisions': [
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
        'GET /query/replay/spec/spec-1': [
          {
            id: 'work-item-event',
            source: 'fixture',
            object_type: 'work_item',
            object_id: 'wi-1',
            summary: 'Parent Work Item updated.',
            created_at: '2026-05-18T01:15:00.000Z',
            payload: { actor_id: 'actor-owner' },
          },
        ],
      },
    });

    expect(await screen.findByText('Parent Work Item updated.')).toBeTruthy();
    expect(screen.getByText('Parent: Work Item | Actor: actor-owner')).toBeTruthy();
    expect(
      screen.queryByText('Parent context: Work Item linkage not recorded on this event | Actor: actor-owner'),
    ).toBeNull();
  });

  it('shows explicit timeline unavailable copy when replay is unavailable', async () => {
    const screen = await renderRoute('/specs/spec-1', {
      apiOverrides: {
        'GET /specs/spec-1': {
          id: 'spec-1',
          work_item_id: 'wi-1',
          entity_type: 'spec',
          status: 'approved',
          editing_state: 'locked',
          gate_state: 'passed',
          resolution: 'approved',
          current_revision_id: 'spec-rev-1',
        },
        'GET /specs/spec-1/revisions': [
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
        'GET /query/replay/spec/spec-1': () => {
          throw new Error('Replay unavailable');
        },
      },
    });

    expect(await screen.findByText('History / Timeline replay is temporarily unavailable.')).toBeTruthy();
    expect(screen.getByText('Revision list remains available, but the full event timeline could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('Revision 1 created')).toBeNull();
  });
});
