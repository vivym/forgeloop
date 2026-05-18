// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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
  });
});
