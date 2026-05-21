// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductAction } from '../../apps/web/src/shared/api/types';
import { primaryActionForItem, sortProductActions } from '../../apps/web/src/features/product-actions/product-actions';
import { deletedProductLaneRoot } from './deleted-route-guards';
import { renderRoute } from './router-test-utils';
import { projectId } from './fixtures/product-data';

describe('Product Lanes route', () => {
  it('redirects /lanes to Requirements while preserving supported filters and stripping old state', async () => {
    const screen = await renderRoute(
      '/lanes?project_id=project-web-product&kind=bug&status=active&blocked=true&driver_actor_id=actor-driver&unsupported_view=old',
    );

    expect(await screen.findByRole('heading', { name: /requirements/i })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/query/product-lanes/requirements?project_id=project-web-product&driver_actor_id=actor-driver&status=active&blocked=true',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('link', { name: /bugs/i }).getAttribute('href')).toBe(
      '/lanes/bugs?project_id=project-web-product&driver_actor_id=actor-driver&status=active&blocked=true',
    );
    expect(screen.queryByText(/unsupported_view/i)).toBeNull();
    expect(document.body.innerHTML).not.toContain(deletedProductLaneRoot);
  });

  it('renders all canonical lane navigation entries as enabled links', async () => {
    const screen = await renderRoute(`/lanes/bugs?project_id=${projectId}`);

    expect(await screen.findByRole('heading', { name: /bugs/i })).toBeTruthy();
    for (const lane of [
      'Requirements',
      'Bugs',
      'Tech Debt',
      'Initiatives',
      'Spec Approver',
      'Execution Owner',
      'Reviewer',
      'QA / Test Owner',
      'Release Owner',
      'Manager',
    ]) {
      const link = screen.getByRole('link', { name: lane });
      expect(link.getAttribute('aria-disabled')).not.toBe('true');
      expect(link.getAttribute('href')).toMatch(/^\/lanes\//);
    }
    expect(document.body.innerHTML).not.toContain(deletedProductLaneRoot);
  });

  it('drops kind filters when linking into Work Item type lanes', async () => {
    const screen = await renderRoute(
      `/lanes/spec-approver?project_id=${projectId}&kind=bug&status=active&owner_actor_id=actor-execution&driver_actor_id=actor-driver`,
      {
      apiOverrides: {
        [`GET /query/product-lanes/spec-approver?project_id=${projectId}&owner_actor_id=actor-execution&driver_actor_id=actor-driver&kind=bug&status=active`]: {
          lane_id: 'spec-approver',
          label: 'Spec Approver',
          description: 'Spec and Plan approval attention.',
          unsupported_filters: [],
          summary: { total: 0, blocked: 0, high_risk: 0, stale: 0 },
          items: [],
        },
      },
      },
    );

    expect(await screen.findByRole('heading', { name: /spec approver/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Requirements' }).getAttribute('href')).toBe(
      `/lanes/requirements?project_id=${projectId}&driver_actor_id=actor-driver&status=active`,
    );
    expect(screen.getByRole('link', { name: 'Bugs' }).getAttribute('href')).toBe(
      `/lanes/bugs?project_id=${projectId}&driver_actor_id=actor-driver&status=active`,
    );
    expect(screen.getByRole('link', { name: 'Execution Owner' }).getAttribute('href')).toBe(
      `/lanes/execution-owner?project_id=${projectId}&driver_actor_id=actor-driver&owner_actor_id=actor-execution&kind=bug&status=active`,
    );
    expect(screen.getByRole('link', { name: 'Reviewer' }).getAttribute('href')).toBe(
      `/lanes/reviewer?project_id=${projectId}&driver_actor_id=actor-driver&owner_actor_id=actor-execution&kind=bug&status=active`,
    );
  });

  it('uses driver_actor_id for Work Item lanes without translating execution owner filters', async () => {
    const screen = await renderRoute(
      `/lanes/requirements?project_id=${projectId}&driver_actor_id=actor-driver&owner_actor_id=actor-execution`,
      {
        apiOverrides: {
          [`GET /query/product-lanes/requirements?project_id=${projectId}&driver_actor_id=actor-driver`]: {
            lane_id: 'requirements',
            label: 'Requirements',
            description: 'Requirement intake and planning progression.',
            unsupported_filters: [],
            summary: { total: 0, blocked: 0, high_risk: 0, stale: 0 },
            items: [],
          },
        },
      },
    );

    expect(await screen.findByRole('heading', { name: /requirements/i })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/product-lanes/requirements?project_id=${projectId}&driver_actor_id=actor-driver`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('link', { name: 'Bugs' }).getAttribute('href')).toBe(
      `/lanes/bugs?project_id=${projectId}&driver_actor_id=actor-driver`,
    );
    expect(screen.getByRole('link', { name: 'Execution Owner' }).getAttribute('href')).toBe(
      `/lanes/execution-owner?project_id=${projectId}&driver_actor_id=actor-driver&owner_actor_id=actor-execution`,
    );
  });

  it('uses Product Lane API paths and renders unsupported filter notices plus selected actions', async () => {
    const screen = await renderRoute(`/lanes/requirements?project_id=${projectId}&selected=wi-1&phase=planning`);

    expect(await screen.findByText('Unsupported filters: phase')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/product-lanes/requirements?project_id=${projectId}&phase=planning`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('link', { name: 'Open work item' }).getAttribute('href')).toBe('/work-items/wi-1');
    expect(screen.getByRole('button', { name: 'Run package' })).toBeTruthy();
  });

  it('downgrades manager lane command actions to read-only drill-down links', async () => {
    const screen = await renderRoute(`/lanes/manager?project_id=${projectId}&selected=manager-item`, {
      apiOverrides: {
        [`GET /query/product-lanes/manager?project_id=${projectId}`]: {
          lane_id: 'manager',
          label: 'Manager',
          description: 'Read-only delivery health and bottleneck drill-down.',
          unsupported_filters: [],
          summary: { total: 1, blocked: 0, high_risk: 0, stale: 0 },
          items: [
            {
              ...laneItem('manager-item', 'Manager health'),
              actions: [productCommandAction('run-package', 'Run package')],
            },
          ],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: /manager/i })).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Open package' });
    expect(screen.queryByRole('button', { name: 'Run package' })).toBeNull();
    expect(link.getAttribute('href')).toBe('/packages/package-product-action');
  });

  it('renders unknown lanes locally without fetching', async () => {
    const screen = await renderRoute(`/lanes/not-a-lane?project_id=${projectId}`);

    expect(screen.getByRole('heading', { name: /lane unavailable/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open requirements/i }).getAttribute('href')).toBe('/lanes/requirements');
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('/query/product-lanes/not-a-lane'),
      expect.anything(),
    );
  });

  it('resolves selection by selected param, click, current item id, and clears the action rail when selected item disappears', async () => {
    const user = userEvent.setup();
    let requestCount = 0;
    const screen = await renderRoute(`/lanes/requirements?project_id=${projectId}&selected=wi-1`, {
      apiOverrides: {
        [`GET /query/product-lanes/requirements?project_id=${projectId}`]: () => {
          requestCount += 1;
          return {
            lane_id: 'requirements',
            label: 'Requirements',
            description: 'Requirement intake and planning progression.',
            unsupported_filters: [],
            summary: { total: requestCount === 1 ? 2 : 0, blocked: requestCount === 1 ? 1 : 0, high_risk: 0, stale: 0 },
            items: requestCount === 1 ? [laneItem('wi-1', 'Improve release cockpit'), laneItem('wi-2', 'Second requirement')] : [],
          };
        },
      },
    });

    expect((await screen.findByRole('button', { name: /Improve release cockpit/ })).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: /Second requirement/ }));
    expect(screen.getByRole('button', { name: /Second requirement/ }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Refresh lane' }));
    expect(await screen.findByText('No product actions are available.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open work item' })).toBeNull();
  });

  it('does not nest action cards inside the mobile table card list', async () => {
    const screen = await renderRoute(`/lanes/requirements?project_id=${projectId}`);

    expect(await screen.findByRole('heading', { name: /requirements/i })).toBeTruthy();
    const actionRail = screen.getByLabelText('Selected item product actions');
    expect(actionRail.closest('[data-responsive-card-list]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(deletedProductLaneRoot);
  });
});

describe('ProductAction view model helpers', () => {
  it('sorts ProductActions by priority while preserving backend order within each priority', () => {
    const actions = [
      productNavigateAction('secondary-first', 'secondary', '/work-items/wi-1'),
      productNavigateAction('tertiary-first', 'tertiary', '/work-items/wi-2'),
      productNavigateAction('primary-first', 'primary', '/work-items/wi-3'),
      productNavigateAction('secondary-second', 'secondary', '/work-items/wi-4'),
      productNavigateAction('primary-second', 'primary', '/work-items/wi-5'),
    ];

    expect(sortProductActions(actions).map((action) => action.id)).toEqual([
      'primary-first',
      'primary-second',
      'secondary-first',
      'secondary-second',
      'tertiary-first',
    ]);
  });

  it('keeps a blocked primary action as the first visible CTA', () => {
    const blockedPrimary = {
      ...productNavigateAction('blocked-primary', 'primary', '/work-items/wi-1'),
      enabled: false,
      disabled_reason: 'Waiting on approval.',
      blocked_reason: 'Plan has unresolved review comments.',
    };
    const secondary = productNavigateAction('secondary', 'secondary', '/work-items/wi-2');

    expect(primaryActionForItem({ actions: [secondary, blockedPrimary] })?.id).toBe('blocked-primary');
  });
});

function productNavigateAction(id: string, priority: ProductAction['priority'], href: string): ProductAction {
  return {
    id,
    lane_id: 'requirements',
    priority,
    label: id,
    enabled: true,
    kind: 'navigate',
    target: {
      kind: 'object',
      object_type: 'work_item',
      object_id: id,
      href,
    },
  };
}

function productCommandAction(id: string, label: string): ProductAction {
  return {
    id,
    lane_id: 'execution-owner',
    priority: 'primary',
    label,
    enabled: true,
    kind: 'command',
    command: {
      type: 'run_package',
      object_type: 'execution_package',
      object_id: 'package-product-action',
      work_item_id: 'wi-1',
      package_id: 'package-product-action',
    },
    target: {
      kind: 'object',
      object_type: 'execution_package',
      object_id: 'package-product-action',
      href: '/packages/package-product-action',
    },
  };
}

function laneItem(id: string, title: string) {
  return {
    id,
    object: { type: 'work_item', id },
    title,
    kind: 'requirement',
    status: 'active',
    phase: 'planning',
    gate_state: 'open',
    resolution: 'unresolved',
    risk: 'medium',
    updated_at: '2026-05-18T00:00:00.000Z',
    actions: [productNavigateAction(`open-${id}`, 'primary', `/work-items/${id}`)],
  };
}
