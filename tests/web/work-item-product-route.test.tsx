// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen as rtlScreen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import WorkItemDetailRoute from '../../apps/web/src/app/routes/work-items/$workItemId';
import { ProductActionList } from '../../apps/web/src/features/product-actions/product-action-list';
import { WorkItemNextActions } from '../../apps/web/src/features/work-items/work-item-next-actions';
import { ActorProvider } from '../../apps/web/src/shared/context/actor-context';
import type { ProductAction } from '../../apps/web/src/shared/api/types';
import { renderRoute } from './router-test-utils';
import {
  cockpitFixtureWithDegradedRunSource,
  cockpitFixtureWithManagerCommandAction,
  deliveryReadiness,
  executionPackage,
  initiativeWithoutPackagesCockpitFixture,
  plan,
  productActionFixtures,
  reviewPacket,
  runSession,
  spec,
  workItem,
  workItemKindCockpitFixtures,
} from './fixtures/product-data';

describe('Work Item product route', () => {
  it('renders the typed Delivery Cockpit from Work Item readiness', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=execution-owner');
    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    expect(screen.getAllByText('Integration Readiness').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Quality Gate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Release Readiness').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Execution Owner/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Spec ready/i }).getAttribute('href')).toBe('#delivery-stage-spec');
    expect(screen.getByRole('link', { name: /Plan ready/i }).getAttribute('href')).toBe('#delivery-stage-plan');
    expect(document.getElementById('delivery-stage-spec')).toBeTruthy();
    expect(document.getElementById('delivery-stage-plan')).toBeTruthy();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(expect.stringContaining('/query/work-items/wi-1/actions'), expect.anything());
    expect(screen.queryByRole('button', { name: ['Update', 'brief'].join(' ') })).toBeNull();
    expect(screen.queryByRole('button', { name: ['Attach', 'evidence'].join(' ') })).toBeNull();
    expect(screen.queryByText(`${'Available after a draft'} exists.`)).toBeNull();
    expect(screen.queryByText(new RegExp(`Pending command ${'wir'}${'ing'}`, 'i'))).toBeNull();
    expect(screen.queryByText(new RegExp(`${'wir'}${'ing'}`, 'i'))).toBeNull();
  });

  it('uses cockpit readiness as the Work Item action source', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=reviewer');

    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    expect(screen.getAllByText(/Reviewer/i).length).toBeGreaterThan(0);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/query/work-item-cockpit/wi-1?lane=reviewer',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(expect.stringContaining('/query/work-items/wi-1/actions'), expect.anything());
  });

  it('renders the Work Item next actions rail as a presentational component', () => {
    render(
      <WorkItemNextActions
        actions={[]}
        activeLane="requirements"
        projectId="project-web-product"
        workItemId="wi-1"
      />,
    );

    expect(rtlScreen.getByText('No actions for Requirements lane.')).toBeTruthy();
  });

  it('labels empty Work Item action states by lane', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=requirements');

    expect(await screen.findByRole('link', { name: 'Open work item' })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/query/work-item-cockpit/wi-1?lane=requirements',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([
    ['requirement', workItemKindCockpitFixtures.requirement, /Requirement/i],
    ['bug', workItemKindCockpitFixtures.bug, /Bug/i],
    ['tech debt', workItemKindCockpitFixtures.techDebt, /Tech Debt/i],
    ['initiative', workItemKindCockpitFixtures.initiative, /Initiative/i],
  ])('renders a kind-specific typed brief for %s work items', async (_label, cockpit, expectedKind) => {
    const lane = cockpit.delivery_readiness.active_lane;
    const screen = await renderRoute(`/work-items/${cockpit.work_item.id}?lane=${lane}`, {
      apiOverrides: {
        [`GET /query/work-item-cockpit/${cockpit.work_item.id}?lane=${lane}`]: cockpit,
      },
    });

    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    expect(screen.getByText(cockpit.work_item.title)).toBeTruthy();
    expect(screen.getAllByText(expectedKind).length).toBeGreaterThan(0);
  });

  it('renders Initiative breakdown without release-ready copy when no packages exist', async () => {
    const cockpit = initiativeWithoutPackagesCockpitFixture;
    const screen = await renderRoute(`/work-items/${cockpit.work_item.id}?lane=initiatives`, {
      apiOverrides: {
        [`GET /query/work-item-cockpit/${cockpit.work_item.id}?lane=initiatives`]: cockpit,
      },
    });

    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    expect(screen.getByText(/Initiative breakdown/i)).toBeTruthy();
    expect(screen.getByText(/Child-work aggregation unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/Ready for release/i)).toBeNull();
  });

  it('hardens manager lane actions by converting mutating commands to drill-down links', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=manager', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1?lane=manager': cockpitFixtureWithManagerCommandAction,
      },
    });

    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Run package/i })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Open package/i }).length).toBeGreaterThan(0);
  });

  it('renders degraded delivery readiness without release-ready copy', async () => {
    const screen = await renderRoute('/work-items/wi-1?lane=execution-owner', {
      apiOverrides: {
        'GET /query/work-item-cockpit/wi-1?lane=execution-owner': cockpitFixtureWithDegradedRunSource,
      },
    });

    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    expect(screen.getByText(/Delivery readiness degraded/i)).toBeTruthy();
    expect(screen.getByText(/run_sessions/i)).toBeTruthy();
    expect(screen.queryByText(/Ready for release/i)).toBeNull();
  });

  it('executes non-manager cockpit command actions from the delivery action rail', async () => {
    const user = userEvent.setup();
    const commandAction = productActionFixtures.commandTargetFollowUp;
    const screen = await renderRoute(`/work-items/${workItem.id}?lane=execution-owner`, {
      actorId: 'actor-cockpit-command',
      apiOverrides: {
        [`GET /query/work-item-cockpit/${workItem.id}?lane=execution-owner`]: {
          work_item: workItem,
          current_spec: spec,
          current_plan: plan,
          packages: [executionPackage],
          run_sessions: [runSession],
          review_packets: [reviewPacket],
          delivery_readiness: deliveryReadiness(workItem, [commandAction], 'execution-owner'),
        },
        [`POST /execution-packages/${executionPackage.id}/run`]: {},
      },
    });

    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Run package/i }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/execution-packages/${executionPackage.id}/run`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-cockpit-command' }),
        }),
      ),
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
