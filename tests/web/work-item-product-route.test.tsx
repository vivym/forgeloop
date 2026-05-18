// @vitest-environment jsdom
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkItemDetailRoute from '../../apps/web/src/app/routes/work-items/$workItemId';
import { renderRoute } from './router-test-utils';

describe('Work Item product route', () => {
  it('renders Work Item detail with Brief / Intake and Validation sections', async () => {
    const screen = await renderRoute('/work-items/wi-1');
    expect(await screen.findByRole('heading', { name: /improve release cockpit/i })).toBeTruthy();
    expect(screen.getByText('Brief / Intake')).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Update brief' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Attach evidence' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('raw JSON')).toBeNull();
  });

  it('renders unavailable detail state instead of fabricated fallback data', async () => {
    const screen = await renderRoute('/work-items/wi-missing');
    expect(await screen.findByText('Work item data is temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByText('Brief / Intake')).toBeNull();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
  });

  it('renders empty work item list without fabricated fallback data', async () => {
    const screen = await renderRoute('/work-items', {
      apiOverrides: {
        'GET /work-items?project_id=project-web-product': [],
      },
    });

    expect(await screen.findByText('No work items match the current product filters.')).toBeTruthy();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh work items' })).toBeNull();
  });

  it('loads the work item list through the first-class work items API', async () => {
    const screen = await renderRoute('/work-items');

    expect(await screen.findByText('Ship route-backed product workbench')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/work-items?project_id=project-web-product',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      'http://localhost:3000/query/pipeline?project_id=project-web-product',
      expect.anything(),
    );
  });

  it('applies supported URL filters to visible work item rows', async () => {
    const screen = await renderRoute('/work-items?kind=bug&risk=high&phase=validation&status=active', {
      apiOverrides: {
        'GET /work-items?project_id=project-web-product': [
          {
            id: 'wi-visible',
            project_id: 'project-web-product',
            kind: 'bug',
            title: 'Fix release validation failure',
            goal: 'Resolve the release validation blocker.',
            success_criteria: ['Validation succeeds'],
            priority: 'P0',
            risk: 'high',
            owner_actor_id: 'actor-owner',
            phase: 'validation',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
          },
          {
            id: 'wi-hidden',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P1',
            risk: 'medium',
            owner_actor_id: 'actor-owner',
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
          },
        ],
      },
    });

    expect(await screen.findByText('Fix release validation failure')).toBeTruthy();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
  });

  it('renders an invalid route state when work item route params are missing', async () => {
    const screen = await renderRoute('/', {
      routes: [{ path: '/', Component: WorkItemDetailRoute }],
    });

    expect(screen.getByText('This Work Item route is missing a work item.')).toBeTruthy();
    await waitFor(() =>
      expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
        expect.stringContaining('/query/work-item-cockpit/wi-1'),
        expect.anything(),
      ),
    );
  });

  it('keeps create route project and owner ids internal to product context', async () => {
    const screen = await renderRoute('/work-items/new');
    expect(screen.getByRole('heading', { name: 'New Work Item' })).toBeTruthy();
    expect(screen.queryByLabelText('project_id')).toBeNull();
    expect(screen.queryByLabelText('owner_actor_id')).toBeNull();
    expect(screen.queryByLabelText('Source request')).toBeNull();
    expect(screen.queryByDisplayValue('project-web-product')).toBeNull();
    expect(screen.queryByDisplayValue('actor-owner')).toBeNull();
  });
});
