// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { boundarySummary, developmentPlan, developmentPlanItem } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('Development Plan routes', () => {
  it('renders a table-first Development Plan page with gate columns and next actions', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    for (const column of ['Plan item', 'Role', 'Driver', 'Boundary', 'Spec', 'Execution Plan', 'Execution', 'Risk', 'Next action']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /add row/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /regenerate with ai/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /show context manifest/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
  });

  it('renders Development Plan Item gate detail without calling it a Task', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(screen.getAllByText(/Boundary brainstorming/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Spec document/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Execution Plan document/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: /development plan item revisions/i })).toBeTruthy();
    expect(screen.getByText(/Item revision 1/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /compare item revisions/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /boundary summary revisions/i })).toBeTruthy();
    expect(screen.getByText(/Boundary summary revision 1/i)).toBeTruthy();
    expect(screen.getAllByText(boundarySummary.summary_markdown).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /compare boundary revisions/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bTask\b|Work Item Owner|owner_actor_id/);
  });

  it('supports keyboard navigation in the Development Plan table', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);
    expect(await screen.findByRole('table', { name: /development plan items/i })).toBeTruthy();

    await user.tab();
    while (document.activeElement !== screen.getByRole('link', { name: /open item/i })) {
      await user.tab();
    }
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /open item/i }));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
  });

  it('wires boundary brainstorming commands from the item gate detail', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    await user.click(await screen.findByRole('button', { name: /start boundary brainstorming/i }));
    expect(await screen.findByText(/Brainstorming session started/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /answer first boundary question/i }));
    expect(await screen.findByText(/Boundary answer recorded/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /record boundary decision/i }));
    expect(await screen.findByText(/Boundary decision recorded/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /approve boundary/i }));
    expect(await screen.findByText(/Boundary approved/i)).toBeTruthy();
  });

  it('renders required surface states for Development Plan pages', async () => {
    for (const [route, key] of [
      [`/development-plans/${developmentPlan.id}`, 'Development Plan Page'],
      [`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, 'Development Plan Item Detail'],
    ] as const) {
      const screen = await renderRoute(route);
      expect(await screen.findByLabelText(new RegExp(`${key} .* state`, 'i'))).toBeTruthy();
      cleanup();
    }
  });
});
