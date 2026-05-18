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
});
