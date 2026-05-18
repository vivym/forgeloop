// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

describe('Workbench product route', () => {
  it('renders Work Item Owner role queue with object kinds and no Intake copy', async () => {
    const screen = await renderRoute('/workbench?project_id=project-web-product');
    expect(screen.getByRole('heading', { name: /workbench/i })).toBeTruthy();
    expect(screen.getByText('Work Item Owner')).toBeTruthy();
    expect((await screen.findAllByText('Requirement')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/release cockpit/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Intake')).toBeNull();
    expect(screen.queryByText('Load role queue')).toBeNull();
  });

  it('renders empty queue state without fabricated work items', async () => {
    const screen = await renderRoute('/workbench?project_id=project-web-product', {
      apiOverrides: {
        'GET /query/workbenches/intake?project_id=project-web-product': {
          summary: { role: 'intake', project_id: 'project-web-product', actor_id: 'actor-owner', total: 0 },
          items: [],
        },
      },
    });

    expect(await screen.findByText('No owned work items match the current product filters.')).toBeTruthy();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open work item' })).toBeNull();
  });
});
