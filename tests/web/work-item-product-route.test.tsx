// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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
        'GET /query/pipeline?project_id=project-web-product': [],
      },
    });

    expect(await screen.findByText('No work items match the current product filters.')).toBeTruthy();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh work items' })).toBeNull();
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
