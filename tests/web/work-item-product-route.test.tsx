// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

describe('Work Item product route', () => {
  it('renders Work Item detail with Brief / Intake and Validation sections', async () => {
    const screen = await renderRoute('/work-items/wi-1');
    expect(screen.getByRole('heading', { name: /improve release cockpit/i })).toBeTruthy();
    expect(screen.getByText('Brief / Intake')).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.queryByText('raw JSON')).toBeNull();
  });

  it('keeps create route project and owner ids internal to product context', async () => {
    const screen = await renderRoute('/work-items/new');
    expect(screen.getByRole('heading', { name: 'New Work Item' })).toBeTruthy();
    expect(screen.queryByLabelText('project_id')).toBeNull();
    expect(screen.queryByLabelText('owner_actor_id')).toBeNull();
    expect(screen.queryByDisplayValue('project-web-product')).toBeNull();
    expect(screen.queryByDisplayValue('actor-owner')).toBeNull();
  });
});
