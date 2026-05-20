// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen as rtlScreen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import WorkItemDetailRoute from '../../apps/web/src/app/routes/work-items/$workItemId';
import { ProductActionList } from '../../apps/web/src/features/product-actions/product-action-list';
import { ActorProvider } from '../../apps/web/src/shared/context/actor-context';
import type { ProductAction } from '../../apps/web/src/shared/api/types';
import { renderRoute } from './router-test-utils';

describe('Work Item product route', () => {
  it('renders Work Item detail with Brief / Intake and Validation sections', async () => {
    const screen = await renderRoute('/work-items/wi-1');
    expect(await screen.findByRole('heading', { name: /improve release cockpit/i })).toBeTruthy();
    expect(screen.getByText('Brief / Intake')).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Open work item' })).toBeTruthy();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(expect.stringContaining('/query/work-items/wi-1/actions'), expect.anything());
    expect(screen.queryByRole('button', { name: ['Update', 'brief'].join(' ') })).toBeNull();
    expect(screen.queryByRole('button', { name: ['Attach', 'evidence'].join(' ') })).toBeNull();
    expect(screen.queryByText(`${'Available after a draft'} exists.`)).toBeNull();
    expect(screen.queryByText(new RegExp(`Pending command ${'wir'}${'ing'}`, 'i'))).toBeNull();
    expect(screen.queryByText(new RegExp(`${'wir'}${'ing'}`, 'i'))).toBeNull();
  });

  it('uses cockpit readiness as the Work Item action source', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=reviewer');

    expect(await screen.findByText('No actions for Reviewer lane.')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/query/work-item-cockpit/wi-1?lane=reviewer',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(expect.stringContaining('/query/work-items/wi-1/actions'), expect.anything());
  });

  it('labels empty Work Item action states by lane', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=requirements');

    expect(await screen.findByRole('link', { name: 'Open work item' })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/query/work-item-cockpit/wi-1?lane=requirements',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not fetch Work Item actions for invalid lane params', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=unknown');

    expect(await screen.findByText('This lane is not available for this Work Item.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open default lane' }).getAttribute('href')).toBe('/work-items/wi-1?lane=requirements');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/query/work-item-cockpit/wi-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('/query/work-item-cockpit/wi-1?lane=unknown'),
      expect.anything(),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(expect.stringContaining('/query/work-items/wi-1/actions'), expect.anything());
  });

  it('renders unavailable detail state instead of fabricated fallback data', async () => {
    const screen = await renderRoute('/work-items/wi-missing');
    expect(await screen.findByText('Work item data is temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByText('Brief / Intake')).toBeNull();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
  });

  it('renders empty work item list without fabricated fallback data', async () => {
    const screen = await renderRoute('/work-items', {
      apiOverrides: {
        'GET /work-items?project_id=project-web-product': [],
      },
    });

    expect(await screen.findByText('No work items match the current product filters.')).toBeTruthy();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh work items' })).toBeNull();
  });

  it('loads the work item list through the first-class work items API', async () => {
    const screen = await renderRoute('/work-items');

    expect(await screen.findByText('Ship route-backed product lane')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/work-items?project_id=project-web-product',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      'http://localhost:3000/query/pipeline?project_id=project-web-product',
      expect.anything(),
    );
  });

  it('applies supported URL filters to visible work item rows', async () => {
    const screen = await renderRoute('/work-items?kind=bug&risk=high&phase=validation&status=active', {
      apiOverrides: {
        'GET /work-items?project_id=project-web-product': [
          {
            id: 'wi-visible',
            project_id: 'project-web-product',
            kind: 'bug',
            title: 'Fix release validation failure',
            goal: 'Resolve the release validation blocker.',
            success_criteria: ['Validation succeeds'],
            priority: 'P0',
            risk: 'high',
            owner_actor_id: 'actor-owner',
            phase: 'validation',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
          },
          {
            id: 'wi-hidden',
            project_id: 'project-web-product',
            kind: 'requirement',
            title: 'Improve release cockpit',
            goal: 'Improve release readiness visibility.',
            success_criteria: ['Planning artifacts are visible'],
            priority: 'P1',
            risk: 'medium',
            owner_actor_id: 'actor-owner',
            phase: 'planning',
            activity_state: 'active',
            gate_state: 'open',
            resolution: 'unresolved',
          },
        ],
      },
    });

    expect(await screen.findByText('Fix release validation failure')).toBeTruthy();
    expect(screen.queryByText('Improve release cockpit')).toBeNull();
  });

  it('renders an invalid route state when work item route params are missing', async () => {
    const screen = await renderRoute('/', {
      routes: [{ path: '/', Component: WorkItemDetailRoute }],
    });

    expect(screen.getByText('This Work Item route is missing a work item.')).toBeTruthy();
    await waitFor(() =>
      expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
        expect.stringContaining('/query/work-item-cockpit/wi-1'),
        expect.anything(),
      ),
    );
  });

  it('keeps create route project and owner ids internal to product context', async () => {
    const screen = await renderRoute('/work-items/new');
    expect(screen.getByRole('heading', { name: 'New Work Item' })).toBeTruthy();
    expect(screen.queryByLabelText('project_id')).toBeNull();
    expect(screen.queryByLabelText('owner_actor_id')).toBeNull();
    expect(screen.queryByLabelText('Source request')).toBeNull();
    expect(screen.queryByDisplayValue('project-web-product')).toBeNull();
    expect(screen.queryByDisplayValue('actor-owner')).toBeNull();
  });
});

describe('ProductActionList', () => {
  it('renders disabled and blocked actions visibly with reasons and prevents execution', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderProductActions([
      {
        ...runPackageAction('blocked-run', 'Run blocked package'),
        enabled: false,
        disabled_reason: 'Execution is disabled until planning is approved.',
        blocked_reason: 'Plan approval is blocked by required review.',
      },
    ]);

    const button = rtlScreen.getByRole('button', { name: 'Run blocked package' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(rtlScreen.getByText('Execution is disabled until planning is approved.')).toBeTruthy();
    expect(rtlScreen.getByText('Plan approval is blocked by required review.')).toBeTruthy();

    await user.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('executes command actions with actor context and does not navigate when a target exists', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderProductActions([runPackageAction('run-package', 'Run package')], { actorId: 'actor-product-action' });

    await user.click(rtlScreen.getByRole('button', { name: 'Run package' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/execution-packages/package-product-action/run',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-product-action' }),
        }),
      ),
    );
    expect(rtlScreen.getByTestId('location-pathname').textContent).toBe('/work-items/wi-1');
    expect(rtlScreen.getByRole('link', { name: 'Open Run package' }).getAttribute('href')).toBe('/packages/package-product-action');
  });

  it('renders navigate actions as links using the backend target href directly', () => {
    renderProductActions([
      {
        id: 'open-direct-target',
        lane_id: 'requirements',
        priority: 'primary',
        label: 'Open direct target',
        enabled: true,
        kind: 'navigate',
        target: {
          kind: 'object',
          object_type: 'work_item',
          object_id: 'wi-target',
          href: '/work-items/wi-target?lane=requirements#next',
        },
      },
    ]);

    expect(rtlScreen.getByRole('link', { name: 'Open direct target' }).getAttribute('href')).toBe(
      '/work-items/wi-target?lane=requirements#next',
    );
  });

  it('shows command failures inline near the action', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'Run package failed product check.' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    renderProductActions([runPackageAction('run-package', 'Run package')]);

    await user.click(rtlScreen.getByRole('button', { name: 'Run package' }));

    expect(await rtlScreen.findByText('Run package failed product check.')).toBeTruthy();
  });
});

function renderProductActions(actions: ProductAction[], options: { actorId?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ActorProvider value={options.actorId ? { actorId: options.actorId } : undefined}>
        <MemoryRouter initialEntries={['/work-items/wi-1']}>
          <ProductActionList actions={actions} projectId="project-web-product" />
          <LocationProbe />
        </MemoryRouter>
      </ActorProvider>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-pathname">{location.pathname}</output>;
}

function runPackageAction(id: string, label: string): ProductAction {
  return {
    id,
    lane_id: 'requirements',
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
