// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

describe('Workbench product route', () => {
  it('renders Work Item Owner role queue with object kinds and no Intake copy', async () => {
    const screen = await renderRoute('/workbench?project_id=project-web-product');
    expect(screen.getByRole('heading', { name: /workbench/i })).toBeTruthy();
    expect(screen.getByText('Work Item Owner')).toBeTruthy();
    expect(screen.queryByText('Intake')).toBeNull();
    expect(screen.queryByText('Load role queue')).toBeNull();
  });
});
