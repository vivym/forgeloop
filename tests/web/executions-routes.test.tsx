// @vitest-environment jsdom

import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { execution, projectId } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('Executions routes', () => {
  it('renders product Executions queue instead of raw runtime browser', async () => {
    const screen = await renderRoute('/executions');

    expect(await screen.findByRole('heading', { name: 'Executions' })).toBeTruthy();
    expect(await screen.findByText(/Approved Execution Plan/i)).toBeTruthy();
    expect((await screen.findByRole('link', { name: /inspect execution/i })).getAttribute('href')).toBe(`/executions/${execution.id}`);
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser/);
  });

  it('renders execution detail with running controls and handoff panels', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`);

    expect(await screen.findByRole('heading', { name: 'Execution' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /interrupt execution/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /continue execution/i })).toBeNull();
    expect(await screen.findByRole('heading', { name: /Code review handoff/i })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /QA handoff/i })).toBeTruthy();
  });

  it('renders execution detail continue control only for resumable executions', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/executions/${execution.id}`]: { ...execution, status: 'interrupted', worker_state: 'interrupted' },
      },
    });

    expect(await screen.findByRole('button', { name: /continue execution/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /interrupt execution/i })).toBeNull();
  });

  it('exposes continue and inspect actions for resumable executions', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/executions', {
      apiOverrides: {
        [`GET /query/executions?project_id=${projectId}&limit=100`]: {
          degraded_sources: [],
          items: [{ ...execution, status: 'interrupted', worker_state: 'interrupted', title: execution.ref.title, href: `/executions/${execution.id}` }],
        },
      },
    });

    expect(await screen.findByRole('button', { name: /continue execution/i })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /inspect execution/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /continue execution/i }));
    expect(await screen.findByText(/Execution continued/i)).toBeTruthy();
  });
});
