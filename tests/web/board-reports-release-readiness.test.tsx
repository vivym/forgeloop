// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { developmentPlan, developmentPlanItem, reviewPacket } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('board, reports, and release readiness routes', () => {
  it('renders cross-object board cards without assuming one schema', async () => {
    const screen = await renderRoute('/board');

    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    for (const label of ['Requirement', 'Initiative', 'Tech Debt', 'Development Plan Item', 'Bug', 'Release']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
  });

  it('shows release readiness by typed object and scoped evidence', async () => {
    const screen = await renderRoute('/releases/release-web-product');

    expect(await screen.findByRole('heading', { name: /release readiness/i })).toBeTruthy();
    for (const label of ['Initiative', 'Requirement', 'Tech Debt', 'Development Plan Item', 'Bug']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    const evidenceHrefs = screen
      .getAllByRole('link', { name: 'Open execution evidence' })
      .map((link) => link.getAttribute('href'));
    expect(evidenceHrefs).toContain(
      `/reports?development_plan_item_id=${developmentPlanItem.id}&code_review_handoff_id=${reviewPacket.id}`,
    );
    expect(evidenceHrefs).toContain(`/board?development_plan_item_id=${developmentPlanItem.id}`);
    expect(document.body.textContent).not.toContain('/tasks/');
    expect(document.body.textContent).not.toContain('/packages/');
  });

  it('renders report index and report families', async () => {
    for (const [route, heading] of [
      ['/reports', 'Reports'],
      ['/reports/delivery', 'Delivery Flow'],
      ['/reports/quality', 'Quality'],
      ['/reports/release-readiness', 'Release Readiness'],
      ['/reports/observation', 'Observation'],
      ['/reports?report=replay', 'Reports'],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      if (route.includes('report=replay')) {
        expect(screen.getByText(/lifecycle replay evidence context/i)).toBeTruthy();
        expect(document.body.innerHTML).not.toContain('/reports/replay');
      }
      cleanup();
    }
  });
});
