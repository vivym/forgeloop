// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductLaneId, WorkItemKind } from '@forgeloop/contracts';

import { renderRoute } from './router-test-utils';
import { deliveryReadiness, projectId, workItem } from './fixtures/product-data';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

type RouteScreen = Awaited<ReturnType<typeof renderRoute>>;
type User = ReturnType<typeof userEvent.setup>;

const createdWorkItem = (id: string, kind: WorkItemKind, intake_context: Record<string, unknown>) => ({
  ...workItem,
  id,
  kind,
  title: `${kind} created`,
  goal: `${kind} goal`,
  success_criteria: [`${kind} criterion`],
  risk: kind === 'bug' ? 'high' : 'medium',
  driver_actor_id: 'actor-driver',
  intake_context,
});

const cockpitResponse = (item: ReturnType<typeof createdWorkItem>, lane: ProductLaneId) => ({
  work_item: item,
  current_spec: null,
  current_plan: null,
  packages: [],
  run_sessions: [],
  review_packets: [],
  delivery_readiness: deliveryReadiness(item, [], lane),
});

describe('Work Item typed intake form', () => {
  it('renders Requirement intake by default with Driver context and no legacy owner form copy', async () => {
    const screen = await renderRoute('/work-items/new', { actorId: 'actor-driver', projectId });

    expect(screen.getByRole('heading', { name: 'New Work Item' })).toBeTruthy();
    expect(screen.getByText('Driver')).toBeTruthy();
    expect(screen.getByText('Signed-in driver')).toBeTruthy();
    expect(screen.getByLabelText('Stakeholder problem')).toBeTruthy();
    expect(screen.getByLabelText('Desired outcome')).toBeTruthy();
    expect(screen.getByLabelText('Acceptance criteria')).toBeTruthy();
    expect(screen.getByLabelText('In scope')).toBeTruthy();
    expect(screen.queryByLabelText('Owner')).toBeNull();
    expect(screen.queryByLabelText('owner_actor_id')).toBeNull();
    expect(screen.queryByLabelText('Goal')).toBeNull();
    expect(screen.queryByLabelText('Success criteria')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Owner/);
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('switches to Bug fields and applies the Bug risk default', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/work-items/new', { actorId: 'actor-driver', projectId });

    await user.selectOptions(screen.getByLabelText('Kind'), 'bug');

    expect(screen.getByLabelText('Impact summary')).toBeTruthy();
    expect(screen.getByLabelText('Observed behavior')).toBeTruthy();
    expect(screen.getByLabelText('Expected behavior')).toBeTruthy();
    expect(screen.getByLabelText('Reproduction steps')).toBeTruthy();
    expect(screen.queryByLabelText('Stakeholder problem')).toBeNull();
    expect((screen.getByLabelText('Risk') as HTMLInputElement).value).toBe('high');
  });

  it('shows field-specific errors for empty required list fields', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/work-items/new', { actorId: 'actor-driver', projectId });

    await user.type(screen.getByLabelText('Title'), 'Capture release readiness');
    await user.type(screen.getByLabelText('Stakeholder problem'), 'Release managers cannot see readiness.');
    await user.type(screen.getByLabelText('Desired outcome'), 'Readiness is visible before approval.');
    await user.click(screen.getByRole('button', { name: 'Create Work Item' }));

    expect(await screen.findByText('Acceptance criteria is required.')).toBeTruthy();
    expect(screen.getByText('In scope is required.')).toBeTruthy();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('http://localhost:3000/work-items', expect.objectContaining({ method: 'POST' }));
  });

  it.each([
    {
      kind: 'requirement',
      lane: 'requirements',
      fill: async (screen: RouteScreen, user: User) => {
        await user.type(screen.getByLabelText('Stakeholder problem'), ' Release managers cannot see readiness. ');
        await user.type(screen.getByLabelText('Desired outcome'), ' Readiness is visible before approval. ');
        await user.type(screen.getByLabelText('Acceptance criteria'), ' Planning artifacts are visible\nValidation path is visible ');
        await user.type(screen.getByLabelText('In scope'), ' Work Item cockpit\nLane links ');
      },
      expectedContext: {
        type: 'requirement',
        stakeholder_problem: 'Release managers cannot see readiness.',
        desired_outcome: 'Readiness is visible before approval.',
        acceptance_criteria: ['Planning artifacts are visible', 'Validation path is visible'],
        in_scope: ['Work Item cockpit', 'Lane links'],
      },
      expectedGoal: 'Release managers cannot see readiness.; desired outcome: Readiness is visible before approval.',
      expectedCriteria: ['Planning artifacts are visible', 'Validation path is visible'],
    },
    {
      kind: 'bug',
      lane: 'bugs',
      fill: async (screen: RouteScreen, user: User) => {
        await user.type(screen.getByLabelText('Impact summary'), ' Checkout fails for signed-in users. ');
        await user.type(screen.getByLabelText('Observed behavior'), ' Submit returns an error toast. ');
        await user.type(screen.getByLabelText('Expected behavior'), ' Order is created or validation is shown. ');
        await user.type(screen.getByLabelText('Reproduction steps'), ' Sign in\nAdd item to cart\nSubmit checkout ');
        await user.type(screen.getByLabelText('Affected environment'), ' Production web ');
        await user.type(screen.getByLabelText('Verification path'), ' Regression test for checkout submit ');
      },
      expectedContext: {
        type: 'bug',
        impact_summary: 'Checkout fails for signed-in users.',
        observed_behavior: 'Submit returns an error toast.',
        expected_behavior: 'Order is created or validation is shown.',
        reproduction_steps: ['Sign in', 'Add item to cart', 'Submit checkout'],
        affected_environment: 'Production web',
        verification_path: 'Regression test for checkout submit',
      },
      expectedGoal:
        'Checkout fails for signed-in users.; observed behavior: Submit returns an error toast.; expected behavior: Order is created or validation is shown.',
      expectedCriteria: ['Order is created or validation is shown.', 'Regression test for checkout submit'],
    },
    {
      kind: 'tech_debt',
      lane: 'tech-debt',
      fill: async (screen: RouteScreen, user: User) => {
        await user.type(screen.getByLabelText('Current pain'), ' Route fixtures duplicate lane data. ');
        await user.type(screen.getByLabelText('Desired invariant'), ' One fixture builder owns lane rows. ');
        await user.type(screen.getByLabelText('Affected modules'), ' tests/web/fixtures\nproduct lanes ');
        await user.type(screen.getByLabelText('Behavior preservation'), ' Existing lane tests keep passing. ');
        await user.type(screen.getByLabelText('Validation strategy'), ' Focused route and API hook tests. ');
      },
      expectedContext: {
        type: 'tech_debt',
        current_pain: 'Route fixtures duplicate lane data.',
        desired_invariant: 'One fixture builder owns lane rows.',
        affected_modules: ['tests/web/fixtures', 'product lanes'],
        behavior_preservation: 'Existing lane tests keep passing.',
        validation_strategy: 'Focused route and API hook tests.',
      },
      expectedGoal: 'Route fixtures duplicate lane data.; desired invariant: One fixture builder owns lane rows.',
      expectedCriteria: ['One fixture builder owns lane rows.', 'Focused route and API hook tests.'],
    },
    {
      kind: 'initiative',
      lane: 'initiatives',
      fill: async (screen: RouteScreen, user: User) => {
        await user.type(screen.getByLabelText('Business outcome'), ' Product lanes become the operating surface. ');
        await user.type(screen.getByLabelText('Scope narrative'), ' Coordinate typed intake and lane filtering. ');
        await user.type(screen.getByLabelText('Success metrics'), ' Driver filters adopted\nTyped intake creates valid work ');
      },
      expectedContext: {
        type: 'initiative',
        business_outcome: 'Product lanes become the operating surface.',
        scope_narrative: 'Coordinate typed intake and lane filtering.',
        success_metrics: ['Driver filters adopted', 'Typed intake creates valid work'],
      },
      expectedGoal:
        'Product lanes become the operating surface.; scope: Coordinate typed intake and lane filtering.',
      expectedCriteria: ['Driver filters adopted', 'Typed intake creates valid work'],
    },
  ] as const)('submits valid $kind intake with driver context and navigates to the default lane', async (caseData) => {
    const user = userEvent.setup();
    const created = createdWorkItem(`wi-created-${caseData.kind}`, caseData.kind, caseData.expectedContext);
    const screen = await renderRoute('/work-items/new', {
      actorId: 'actor-driver',
      projectId,
      apiOverrides: {
        'POST /work-items': created,
        [`GET /query/work-item-cockpit/${created.id}?lane=${caseData.lane}`]: cockpitResponse(created, caseData.lane),
      },
    });

    await user.selectOptions(screen.getByLabelText('Kind'), caseData.kind);
    await user.type(screen.getByLabelText('Title'), ` ${caseData.kind} created `);
    await caseData.fill(screen, user);
    await user.click(screen.getByRole('button', { name: 'Create Work Item' }));

    const postCall = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url) === 'http://localhost:3000/work-items' && init?.method === 'POST');
    expect(postCall).toBeDefined();
    const payload = JSON.parse(String(postCall?.[1]?.body));
    expect(payload).toMatchObject({
      project_id: projectId,
      kind: caseData.kind,
      title: `${caseData.kind} created`,
      goal: caseData.expectedGoal,
      success_criteria: caseData.expectedCriteria,
      risk: caseData.kind === 'bug' ? 'high' : 'medium',
      driver_actor_id: 'actor-driver',
      intake_context: caseData.expectedContext,
    });
    expect(payload).not.toHaveProperty('owner_actor_id');
    expect(await screen.findByRole('heading', { name: /Delivery Cockpit/i })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/work-item-cockpit/${created.id}?lane=${caseData.lane}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
