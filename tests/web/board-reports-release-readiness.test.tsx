// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { boardCards, projectId, reviewPacket, runSession, taskListItem } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('board, reports, and release readiness routes', () => {
  it('renders cross-object board cards without assuming one schema', async () => {
    const screen = await renderRoute('/board');

    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    for (const label of ['Requirement', 'Initiative', 'Tech Debt', 'Task', 'Bug', 'Spec', 'Plan', 'Release']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
  });

  it('does not render runtime evidence objects as board cards', async () => {
    const screen = await renderRoute('/board', {
      apiOverrides: {
        [`GET /query/board?project_id=${projectId}&limit=100`]: {
          items: [
            ...boardCards,
            {
              id: 'board:runtime-package',
              object_ref: { type: 'execution_package', id: 'pkg-runtime', title: 'Runtime package card' },
              title: 'Runtime package card',
              column_id: 'active',
              status: 'ready',
              blocked: false,
              href: '/tasks/task-1/packages/pkg-runtime',
            },
          ],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    expect(screen.queryByText('Runtime package card')).toBeNull();
  });

  it('shows release readiness by typed object and scoped evidence', async () => {
    const screen = await renderRoute('/releases/release-web-product');

    expect(await screen.findByRole('heading', { name: /release readiness/i })).toBeTruthy();
    for (const label of ['Initiative', 'Requirement', 'Tech Debt', 'Task', 'Bug']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    const evidenceHrefs = screen
      .getAllByRole('link', { name: 'Open task-scoped evidence' })
      .map((link) => link.getAttribute('href'));
    expect(evidenceHrefs).toContain(`/tasks/${taskListItem.id}/reviews/${reviewPacket.id}`);
    expect(evidenceHrefs).toContain(`/tasks/${taskListItem.id}/runs/${runSession.id}`);
    expect(document.body.textContent).not.toContain('/packages/');
  });

  it('renders report index and report families', async () => {
    for (const [route, heading] of [
      ['/reports', 'Reports'],
      ['/reports/delivery', 'Delivery Flow'],
      ['/reports/quality', 'Quality'],
      ['/reports/release-readiness', 'Release Readiness'],
      ['/reports/observation', 'Observation'],
      ['/reports/replay', 'Replay'],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      cleanup();
    }
  });
});
