import { vi } from 'vitest';

import {
  actorId,
  bugDetail,
  bugListResponse,
  deliveryReadiness,
  executionPackage,
  initiativeDetail,
  initiativeListResponse,
  myWorkQueueResponse,
  plan,
  planRevision,
  productLaneFixtureItemsByLane,
  projectId,
  release,
  requirementDetail,
  requirementListResponse,
  reviewPacket,
  runSession,
  spec,
  specRevision,
  taskDetail,
  taskListResponse,
  techDebtDetail,
  techDebtListResponse,
  timeline,
  workItem,
} from './product-data';
import type { ProductLaneId, ProductLaneItem, ProductLaneResponse } from '@forgeloop/contracts';

export type ProductApiMockHandler = (request: { input: RequestInfo | URL; init?: RequestInit; key: string }) => unknown | Promise<unknown>;
export type ProductApiResponseMap = Record<string, unknown | ProductApiMockHandler>;

const routeWorkItem = {
  ...workItem,
  id: 'wi-1',
  title: 'Improve release cockpit',
  goal: 'Improve release readiness visibility.',
  success_criteria: ['Planning artifacts are visible', 'Validation path is visible'],
  intake_context: {
    type: 'requirement',
    stakeholder_problem: 'Release readiness is hard to inspect.',
    desired_outcome: 'Planning artifacts and validation path are visible.',
    acceptance_criteria: ['Planning artifacts are visible', 'Validation path is visible'],
    in_scope: ['Release cockpit'],
  },
  phase: 'planning',
};

const routeSpec = {
  ...spec,
  work_item_id: routeWorkItem.id,
  scope_ref: { type: routeWorkItem.kind, id: routeWorkItem.id, title: routeWorkItem.title },
};

const routePlan = {
  ...plan,
  work_item_id: routeWorkItem.id,
  scope_ref: { type: routeWorkItem.kind, id: routeWorkItem.id, title: routeWorkItem.title },
};

const routeExecutionPackage = {
  ...executionPackage,
  work_item_id: routeWorkItem.id,
  scope_ref: { type: routeWorkItem.kind, id: routeWorkItem.id, title: routeWorkItem.title },
  objective: 'Improve release cockpit planning flow',
};

const scopeRefForItem = (item: Pick<typeof workItem, 'id' | 'kind' | 'title'>) => ({
  type: item.kind,
  id: item.id,
  title: item.title,
});

const cockpitSpecFor = (artifact: typeof spec, item: Pick<typeof workItem, 'id' | 'kind' | 'title'>) => {
  const { work_item_id: _workItemId, ...publicSpec } = artifact;
  return { ...publicSpec, scope_ref: scopeRefForItem(item) };
};

const cockpitPlanFor = (artifact: typeof plan, item: Pick<typeof workItem, 'id' | 'kind' | 'title'>) => {
  const { work_item_id: _workItemId, ...publicPlan } = artifact;
  return { ...publicPlan, scope_ref: scopeRefForItem(item) };
};

const cockpitSpecRevisionFor = (revision: typeof specRevision, item: Pick<typeof workItem, 'id' | 'kind' | 'title'>) => {
  const { work_item_id: _workItemId, ...publicRevision } = revision;
  return { ...publicRevision, scope_ref: scopeRefForItem(item) };
};

const cockpitPlanRevisionFor = (revision: typeof planRevision, item: Pick<typeof workItem, 'id' | 'kind' | 'title'>) => {
  const { work_item_id: _workItemId, ...publicRevision } = revision;
  return { ...publicRevision, scope_ref: scopeRefForItem(item) };
};

const cockpitPackageFor = (
  item: Pick<typeof workItem, 'id' | 'kind' | 'title'>,
  executionPackageLike: typeof executionPackage,
) => {
  const { task_id: _taskId, work_item_id: _workItemId, ...publicPackage } = executionPackageLike;
  return { ...publicPackage, scope_ref: scopeRefForItem(item) };
};

const routeProductActions = [
  {
    id: 'open-route-work-item',
    lane_id: 'requirements',
    priority: 'primary',
    label: 'Open requirement',
    enabled: true,
    kind: 'navigate',
    target: {
      kind: 'object',
      object_type: 'requirement',
      object_id: routeWorkItem.id,
      href: `/requirements/${routeWorkItem.id}`,
    },
  },
  {
    id: 'run-route-package',
    lane_id: 'requirements',
    priority: 'secondary',
    label: 'Run package',
    description: 'Run the linked package from this lane.',
    enabled: true,
    kind: 'command',
    command: {
      type: 'run_package',
      object_type: 'execution_package',
      object_id: routeExecutionPackage.id,
      scope_ref: { type: 'requirement', id: routeWorkItem.id },
      package_id: routeExecutionPackage.id,
    },
    target: {
      kind: 'object',
      object_type: 'execution_package',
      object_id: routeExecutionPackage.id,
      href: `/tasks/${routeExecutionPackage.task_id}/packages/${routeExecutionPackage.id}`,
    },
  },
] as const;

const routeProductLaneItem = {
  id: routeWorkItem.id,
  title: routeWorkItem.title,
  object: { type: 'requirement', id: routeWorkItem.id },
  kind: routeWorkItem.kind,
  phase: routeWorkItem.phase,
  status: routeWorkItem.activity_state,
  gate_state: routeWorkItem.gate_state,
  resolution: routeWorkItem.resolution,
  risk: routeWorkItem.risk,
  driver_actor_id: routeWorkItem.driver_actor_id,
  updated_at: routeWorkItem.updated_at ?? '2026-05-18T00:00:00.000Z',
  actions: routeProductActions,
};

const productLaneMetadata = {
  requirements: { label: 'Requirements', description: 'Requirement intake and planning progression.' },
  bugs: { label: 'Bugs', description: 'Bug triage, repair planning, verification, and regression follow-up.' },
  'tech-debt': { label: 'Tech Debt', description: 'Debt scoping, refactor planning, risk control, and validation.' },
  initiatives: { label: 'Initiatives', description: 'Strategic work intake and requirement breakdown readiness.' },
  'spec-approver': { label: 'Spec Approver', description: 'Spec and Plan approval attention.' },
  'execution-owner': { label: 'Execution Owner', description: 'Package readiness, runs, and package blockers.' },
  reviewer: { label: 'Reviewer', description: 'Review packet decisions and evidence gaps.' },
  'qa-test-owner': { label: 'QA / Test Owner', description: 'Test strategy gaps, QA gates, and acceptance.' },
  'release-owner': { label: 'Release Owner', description: 'Release readiness, blockers, and gates.' },
  manager: { label: 'Manager', description: 'Read-only delivery health and bottleneck drill-down.' },
} satisfies Record<ProductLaneId, { label: string; description: string }>;

const productLaneResponse = (laneId: ProductLaneId, unsupportedFilters: string[] = []): ProductLaneResponse => {
  const baseItems = laneId === 'requirements' ? [routeProductLaneItem] : [];
  const items = [...baseItems, ...productLaneFixtureItemsByLane[laneId]].map((item) => itemForLane(item, laneId));
  const blocked = items.filter((item) => item.actions.some((action) => action.blocked_reason !== undefined)).length;
  const highRisk = items.filter((item) => item.risk === 'high').length;
  const metadata = productLaneMetadata[laneId];

  return {
    lane_id: laneId,
    label: metadata.label,
    description: metadata.description,
    unsupported_filters: unsupportedFilters,
    summary: { total: items.length, blocked, high_risk: highRisk, stale: 0 },
    items,
  };
};

const itemForLane = (item: ProductLaneItem, laneId: ProductLaneId): ProductLaneItem => ({
  ...item,
  actions: item.actions.map((action) => ({ ...action, lane_id: laneId })),
});

const routeTimeline = timeline.map((entry) => ({
  ...entry,
  object_id: routeWorkItem.id,
  summary: 'Created release cockpit improvement work item.',
}));

const productListItem = (
  artifact: typeof spec | typeof plan,
  parent = workItem,
  objectType: 'spec' | 'plan' = artifact.entity_type,
) => ({
  id: artifact.id,
  object: {
    type: objectType,
    id: artifact.id,
    title: `${parent.title} ${objectType === 'spec' ? 'Spec' : 'Plan'}`,
  },
  title: `${parent.title} ${objectType === 'spec' ? 'Spec' : 'Plan'}`,
  status: artifact.status,
  gate_state: artifact.gate_state,
  resolution: artifact.resolution,
  parent: {
    type: parent.kind,
    id: parent.id,
    title: parent.title,
  },
  related: [],
  revision_state: {
    current_revision_id: artifact.current_revision_id,
    revision_number: 1,
  },
  counts: {},
  updated_at: artifact.updated_at ?? '2026-05-18T00:00:00.000Z',
});

const packageListItem = {
  id: executionPackage.id,
  object: {
    type: 'execution_package',
    id: executionPackage.id,
    title: executionPackage.objective,
  },
  title: executionPackage.objective,
  phase: executionPackage.phase,
  risk: workItem.risk,
  execution_owner_actor_id: executionPackage.owner_actor_id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  qa_owner_actor_id: executionPackage.qa_owner_actor_id,
  parent: {
    type: workItem.kind,
    id: workItem.id,
    title: workItem.title,
  },
  related: [{ type: 'run_session', id: runSession.id, title: runSession.summary }],
  revision_state: {
    current_revision_id: executionPackage.plan_revision_id,
  },
  package_state: {
    scope_ref: { type: workItem.kind, id: workItem.id, title: workItem.title },
    spec_revision_id: executionPackage.spec_revision_id,
    plan_revision_id: executionPackage.plan_revision_id,
    surface_type: 'web',
    last_run_session_id: executionPackage.last_run_session_id,
  },
  counts: {},
  updated_at: executionPackage.updated_at ?? '2026-05-18T00:00:00.000Z',
};

const runListItem = {
  id: runSession.id,
  object: {
    type: 'run_session',
    id: runSession.id,
    title: runSession.summary,
  },
  title: runSession.summary ?? runSession.id,
  status: runSession.status,
  execution_owner_actor_id: runSession.requested_by_actor_id,
  parent: {
    type: 'execution_package',
    id: executionPackage.id,
    title: executionPackage.objective,
  },
  related: [],
  revision_state: {},
  run_state: {
    execution_package_id: runSession.execution_package_id,
    executor_type: runSession.executor_type,
    started_at: runSession.started_at,
    finished_at: runSession.finished_at,
  },
  counts: {},
  updated_at: runSession.updated_at ?? '2026-05-18T00:00:00.000Z',
};

export const defaultProductApiResponses: ProductApiResponseMap = {
  [`GET /query/pipeline?project_id=${projectId}`]: {
    stages: [
      {
        id: 'intake',
        label: 'Intake',
        item_count: 1,
        blocked_count: 0,
        high_risk_count: 0,
        stale_count: 0,
        representative_items: [
          {
            id: workItem.id,
            object: { type: workItem.kind, id: workItem.id, title: workItem.title },
            title: workItem.title,
            status: workItem.activity_state,
            phase: workItem.phase,
            gate_state: workItem.gate_state,
            resolution: workItem.resolution,
            risk: workItem.risk,
            driver_actor_id: workItem.driver_actor_id,
            related: [],
            counts: {},
            updated_at: workItem.updated_at ?? '2026-05-18T00:00:00.000Z',
          },
        ],
        degraded: false,
      },
      { id: 'spec_plan', label: 'Spec & Plan', item_count: 1, blocked_count: 0, high_risk_count: 0, stale_count: 0, representative_items: [productListItem(spec, workItem, 'spec')], degraded: false },
      { id: 'execution', label: 'Execution', item_count: 1, blocked_count: 0, high_risk_count: 0, stale_count: 0, representative_items: [packageListItem], degraded: false },
      { id: 'review', label: 'Review', item_count: 1, blocked_count: 0, high_risk_count: 0, stale_count: 0, representative_items: [], degraded: false },
      {
        id: 'integration_validation',
        label: 'Integration Validation',
        item_count: 1,
        blocked_count: 1,
        high_risk_count: 0,
        stale_count: 0,
        stale_hint: 'Stale/SLA calculation is not available yet for this stage.',
        representative_items: [packageListItem],
        degraded: true,
        integration_readiness: {
          readiness_status: 'Blocked by package dependencies.',
          dependency_blockers: ['Release cockpit frontend waits on contract fixture parity.'],
          contract_mock_readiness: ['Release cockpit: product API mocks aligned for list/detail routes.'],
          environment_requirements: ['Web build and route smoke must pass before cross-end validation.'],
          waiting_package_refs: [{ type: 'execution_package', id: executionPackage.id, title: executionPackage.objective }],
        },
      },
      {
        id: 'test_acceptance',
        label: 'Test Acceptance',
        item_count: 1,
        blocked_count: 0,
        high_risk_count: 0,
        stale_count: 0,
        representative_items: [packageListItem],
        degraded: true,
        test_acceptance: {
          qa_owner_queues: [{ qa_owner_actor_id: executionPackage.qa_owner_actor_id, item_count: 1 }],
          test_strategy_gaps: ['Visual smoke still needs populated route screenshots.'],
          acceptance_criteria_state: 'Acceptance criteria mapped to Web route smoke and axe checks.',
          quality_gates: ['Web typecheck', 'Web build', 'Product route smoke'],
          regression_coverage_gaps: ['No mobile regression screenshot reviewed yet.'],
          release_blocking_issues: ['Release approval waits for test acceptance acknowledgement.'],
        },
      },
      { id: 'release', label: 'Release', item_count: 1, blocked_count: 0, high_risk_count: 0, stale_count: 0, representative_items: [], degraded: false },
      { id: 'observation', label: 'Observation', item_count: 0, blocked_count: 0, high_risk_count: 0, stale_count: 0, representative_items: [], degraded: true },
    ],
    degraded_sources: ['pipeline:stale_filter_not_available'],
  },
  [`GET /work-items?project_id=${projectId}`]: [workItem],
  [`GET /query/work-items?project_id=${projectId}&limit=100`]: {
    items: [
      {
        id: workItem.id,
        object: { type: workItem.kind, id: workItem.id, title: workItem.title },
        title: workItem.title,
        status: workItem.activity_state,
        phase: workItem.phase,
        gate_state: workItem.gate_state,
        resolution: workItem.resolution,
        risk: workItem.risk,
        driver_actor_id: workItem.driver_actor_id,
        related: [],
        counts: {},
        updated_at: workItem.updated_at ?? '2026-05-18T00:00:00.000Z',
      },
    ],
    degraded_sources: [],
  },
  [`GET /query/my-work?project_id=${projectId}`]: myWorkQueueResponse,
  [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: myWorkQueueResponse,
  [`GET /query/requirements?project_id=${projectId}`]: requirementListResponse,
  [`GET /query/requirements?project_id=${projectId}&limit=100`]: requirementListResponse,
  'GET /query/requirements/req-1': requirementDetail,
  [`GET /query/initiatives?project_id=${projectId}`]: initiativeListResponse,
  [`GET /query/initiatives?project_id=${projectId}&limit=100`]: initiativeListResponse,
  'GET /query/initiatives/init-1': initiativeDetail,
  [`GET /query/tech-debt?project_id=${projectId}`]: techDebtListResponse,
  [`GET /query/tech-debt?project_id=${projectId}&limit=100`]: techDebtListResponse,
  'GET /query/tech-debt/td-1': techDebtDetail,
  [`GET /query/tasks?project_id=${projectId}`]: taskListResponse,
  [`GET /query/tasks?project_id=${projectId}&limit=100`]: taskListResponse,
  'GET /query/tasks/task-1': taskDetail,
  [`GET /query/bugs?project_id=${projectId}`]: bugListResponse,
  [`GET /query/bugs?project_id=${projectId}&limit=100`]: bugListResponse,
  'GET /query/bugs/bug-1': bugDetail,
  [`GET /query/product-lanes/requirements?project_id=${projectId}`]: productLaneResponse('requirements'),
  [`GET /query/product-lanes/requirements?project_id=${projectId}&driver_actor_id=actor-driver`]:
    productLaneResponse('requirements'),
  [`GET /query/product-lanes/requirements?project_id=${projectId}&status=active&blocked=true`]:
    productLaneResponse('requirements'),
  [`GET /query/product-lanes/requirements?project_id=${projectId}&driver_actor_id=actor-driver&status=active&blocked=true`]:
    productLaneResponse('requirements'),
  [`GET /query/product-lanes/requirements?project_id=${projectId}&phase=planning`]: productLaneResponse(
    'requirements',
    ['phase'],
  ),
  [`GET /query/product-lanes/bugs?project_id=${projectId}`]: productLaneResponse('bugs'),
  [`GET /query/product-lanes/tech-debt?project_id=${projectId}`]: productLaneResponse('tech-debt'),
  [`GET /query/product-lanes/initiatives?project_id=${projectId}`]: productLaneResponse('initiatives'),
  [`GET /query/product-lanes/spec-approver?project_id=${projectId}`]: productLaneResponse('spec-approver'),
  [`GET /query/product-lanes/execution-owner?project_id=${projectId}`]: productLaneResponse('execution-owner'),
  [`GET /query/product-lanes/reviewer?project_id=${projectId}`]: productLaneResponse('reviewer'),
  [`GET /query/product-lanes/qa-test-owner?project_id=${projectId}`]: productLaneResponse('qa-test-owner'),
  [`GET /query/product-lanes/release-owner?project_id=${projectId}`]: productLaneResponse('release-owner'),
  [`GET /query/product-lanes/manager?project_id=${projectId}`]: productLaneResponse('manager'),
  [`GET /query/specs?project_id=${projectId}`]: {
    items: [productListItem(spec, workItem, 'spec')],
    degraded_sources: [],
  },
  [`GET /query/specs?project_id=${projectId}&limit=100`]: {
    items: [productListItem(spec, workItem, 'spec')],
    degraded_sources: [],
  },
  [`GET /specs/${spec.id}`]: cockpitSpecFor(spec, workItem),
  [`GET /specs/${spec.id}/revisions`]: [cockpitSpecRevisionFor(specRevision, workItem)],
  [`GET /query/plans?project_id=${projectId}`]: {
    items: [productListItem(plan, workItem, 'plan')],
    degraded_sources: [],
  },
  [`GET /query/plans?project_id=${projectId}&limit=100`]: {
    items: [productListItem(plan, workItem, 'plan')],
    degraded_sources: [],
  },
  [`GET /plans/${plan.id}`]: cockpitPlanFor(plan, workItem),
  [`GET /plans/${plan.id}/revisions`]: [cockpitPlanRevisionFor(planRevision, workItem)],
  [`GET /query/execution-packages?project_id=${projectId}&limit=100`]: {
    items: [packageListItem],
    degraded_sources: [],
  },
  [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
    executor_type: 'local_codex',
    target_kind: 'run_execution',
    state: 'ready',
    blockers: [],
    generated_at: '2026-05-18T00:23:00.000Z',
  },
  [`GET /query/tasks/${executionPackage.task_id}/packages/${executionPackage.id}`]: {
    object_ref: { type: 'execution_package', id: executionPackage.id },
    task_ref: { type: 'task', id: executionPackage.task_id },
    href: `/tasks/${executionPackage.task_id}/packages/${executionPackage.id}`,
    package: cockpitPackageFor(workItem, executionPackage),
  },
  [`GET /query/runs?project_id=${projectId}&limit=100`]: {
    items: [runListItem],
    degraded_sources: [],
  },
  [`GET /query/tasks/${executionPackage.task_id}/runs/${runSession.id}`]: {
    object_ref: { type: 'run_session', id: runSession.id },
    task_ref: { type: 'task', id: executionPackage.task_id },
    package_ref: { type: 'execution_package', id: executionPackage.id },
    href: `/tasks/${executionPackage.task_id}/runs/${runSession.id}`,
    run_session: runSession,
  },
  [`GET /execution-packages/${executionPackage.id}`]: cockpitPackageFor(workItem, executionPackage),
  [`GET /run-sessions/${runSession.id}`]: runSession,
  [`GET /run-sessions/${runSession.id}/events`]: {
    events: [
      {
        id: 'event-web-product-1',
        run_session_id: runSession.id,
        sequence: 1,
        cursor: '0000000001',
        event_type: 'agent_message',
        source: 'fixture',
        visibility: 'public',
        summary: 'Shared product API foundation passed deterministic checks.',
        payload: { message: 'Shared product API foundation passed deterministic checks.' },
        created_at: '2026-05-18T00:24:30.000Z',
      },
    ],
    next_cursor: '0000000001',
    has_more: false,
  },
  [`POST /run-sessions/${runSession.id}/events/stream-token`]: {
    token: 'stream-token-web-product',
    expires_at: '2026-05-18T00:30:00.000Z',
  },
  [`GET /query/review-packets?project_id=${projectId}&limit=100`]: {
    items: [
      {
        id: reviewPacket.id,
        object: { type: 'review_packet', id: reviewPacket.id, title: reviewPacket.summary },
        title: reviewPacket.summary,
        status: reviewPacket.status,
        risk: workItem.risk,
        reviewer_actor_id: reviewPacket.reviewer_actor_id,
        parent: { type: 'execution_package', id: executionPackage.id, title: executionPackage.objective },
        related: [{ type: 'run_session', id: runSession.id, title: runSession.summary }],
        revision_state: {},
        review_state: {
          execution_package_id: executionPackage.id,
          run_session_id: runSession.id,
          decision: reviewPacket.decision,
          changed_file_count: reviewPacket.changed_files.length,
        },
        counts: {},
        updated_at: reviewPacket.updated_at,
      },
    ],
    degraded_sources: [],
  },
  [`GET /query/reviews?project_id=${projectId}`]: [reviewPacket],
  [`GET /query/reviews/${reviewPacket.id}`]: reviewPacket,
  [`GET /query/tasks/${executionPackage.task_id}/reviews/${reviewPacket.id}`]: {
    object_ref: { type: 'review_packet', id: reviewPacket.id },
    task_ref: { type: 'task', id: executionPackage.task_id },
    package_ref: { type: 'execution_package', id: executionPackage.id },
    href: `/tasks/${executionPackage.task_id}/reviews/${reviewPacket.id}`,
    review_packet: reviewPacket,
  },
  [`POST /review-packets/${reviewPacket.id}/approve`]: {
    review_packet_id: reviewPacket.id,
    status: 'completed',
    decision: 'approved',
    recorded_at: '2026-05-18T00:31:00.000Z',
  },
  [`POST /review-packets/${reviewPacket.id}/request-changes`]: {
    review_packet_id: reviewPacket.id,
    status: 'completed',
    decision: 'changes_requested',
    recorded_at: '2026-05-18T00:31:00.000Z',
  },
  [`GET /query/releases?project_id=${projectId}`]: { releases: [release] },
  [`GET /query/releases?project_id=${projectId}&limit=100`]: { releases: [release] },
  'POST /releases': {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`GET /query/work-item-cockpit/${workItem.id}`]: {
    item: workItem,
    current_spec: cockpitSpecFor(spec, workItem),
    current_plan: cockpitPlanFor(plan, workItem),
    packages: [cockpitPackageFor(workItem, executionPackage)],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    delivery_readiness: deliveryReadiness(workItem),
  },
  [`GET /query/work-item-cockpit/${workItem.id}?lane=reviewer`]: {
    item: workItem,
    current_spec: cockpitSpecFor(spec, workItem),
    current_plan: cockpitPlanFor(plan, workItem),
    packages: [cockpitPackageFor(workItem, executionPackage)],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    delivery_readiness: deliveryReadiness(workItem, [], 'reviewer'),
  },
  [`GET /query/work-item-cockpit/${workItem.id}?lane=execution-owner`]: {
    item: workItem,
    current_spec: cockpitSpecFor(spec, workItem),
    current_plan: cockpitPlanFor(plan, workItem),
    packages: [cockpitPackageFor(workItem, executionPackage)],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    delivery_readiness: deliveryReadiness(workItem, [], 'execution-owner'),
  },
  [`GET /query/work-item-cockpit/${routeWorkItem.id}`]: {
    item: routeWorkItem,
    current_spec: cockpitSpecFor(routeSpec, routeWorkItem),
    current_plan: cockpitPlanFor(routePlan, routeWorkItem),
    packages: [cockpitPackageFor(routeWorkItem, routeExecutionPackage)],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    delivery_readiness: deliveryReadiness(routeWorkItem),
  },
  [`GET /query/work-item-cockpit/${routeWorkItem.id}?lane=requirements`]: {
    item: routeWorkItem,
    current_spec: cockpitSpecFor(routeSpec, routeWorkItem),
    current_plan: cockpitPlanFor(routePlan, routeWorkItem),
    packages: [cockpitPackageFor(routeWorkItem, routeExecutionPackage)],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    delivery_readiness: deliveryReadiness(routeWorkItem, routeProductActions, 'requirements'),
  },
  [`GET /query/work-item-cockpit/${routeWorkItem.id}?lane=reviewer`]: {
    item: routeWorkItem,
    current_spec: cockpitSpecFor(routeSpec, routeWorkItem),
    current_plan: cockpitPlanFor(routePlan, routeWorkItem),
    packages: [cockpitPackageFor(routeWorkItem, routeExecutionPackage)],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    delivery_readiness: deliveryReadiness(routeWorkItem, [], 'reviewer'),
  },
  [`GET /query/work-item-cockpit/${routeWorkItem.id}?lane=execution-owner`]: {
    item: routeWorkItem,
    current_spec: cockpitSpecFor(routeSpec, routeWorkItem),
    current_plan: cockpitPlanFor(routePlan, routeWorkItem),
    packages: [cockpitPackageFor(routeWorkItem, routeExecutionPackage)],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    delivery_readiness: deliveryReadiness(routeWorkItem, [], 'execution-owner'),
  },
  [`POST /work-items/${routeWorkItem.id}/specs`]: cockpitSpecFor(routeSpec, routeWorkItem),
  [`POST /work-items/${routeWorkItem.id}/plans`]: cockpitPlanFor(routePlan, routeWorkItem),
  [`POST /specs/${spec.id}/generate-draft`]: cockpitSpecRevisionFor(specRevision, workItem),
  [`POST /specs/${routeSpec.id}/generate-draft`]: {
    ...cockpitSpecRevisionFor(specRevision, routeWorkItem),
    id: 'spec-revision-route',
    spec_id: routeSpec.id,
  },
  [`POST /plans/${plan.id}/generate-draft`]: cockpitPlanRevisionFor(planRevision, workItem),
  [`POST /plans/${routePlan.id}/generate-draft`]: {
    ...cockpitPlanRevisionFor(planRevision, routeWorkItem),
    id: 'plan-revision-route',
    plan_id: routePlan.id,
  },
  [`GET /query/release-cockpit/${release.id}`]: {
    release,
    work_items: [workItem],
    execution_packages: [executionPackage],
    latest_run_sessions: [runSession],
    current_review_packets: [reviewPacket],
    evidences: [],
    observations: [],
    decisions: [],
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    risk_summary: {
      structural_blocker_count: 0,
      risk_blocker_count: 0,
      evidence_blocker_count: 0,
      planning_blocker_count: 0,
      redacted_or_stale_evidence_count: 0,
      failed_or_missing_check_count: 0,
      packages_not_ready_count: 0,
      release_can_proceed_without_override: true,
      release_can_proceed_with_override: true,
      release_cannot_proceed: false,
    },
    checklist: [{ id: 'fixture-ready', label: 'Fixture release ready', status: 'passed', blocker_codes: [] }],
    next_actions: ['submit_for_approval'],
  },
  [`GET /query/replay/work_item/${workItem.id}`]: timeline,
  [`GET /query/replay/work_item/${routeWorkItem.id}`]: routeTimeline,
  [`GET /query/replay/spec/${spec.id}`]: timeline.map((entry) => ({
    ...entry,
    object_type: 'spec',
    object_id: spec.id,
    summary: 'Spec planning state updated.',
    payload: { scope_ref: scopeRefForItem(workItem) },
  })),
  [`GET /query/replay/plan/${plan.id}`]: timeline.map((entry) => ({
    ...entry,
    object_type: 'plan',
    object_id: plan.id,
    summary: 'Plan planning state updated.',
    payload: { scope_ref: scopeRefForItem(workItem) },
  })),
  [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
  [`GET /query/replay/review_packet/${reviewPacket.id}`]: timeline,
  [`GET /query/replay/release/${release.id}`]: timeline,
  [`POST /releases/${release.id}/work-items/${workItem.id}`]: {
    release_id: release.id,
    object_type: 'work_item',
    object_id: workItem.id,
    linked: true,
  },
  [`DELETE /releases/${release.id}/work-items/${workItem.id}`]: {
    release_id: release.id,
    object_type: 'work_item',
    object_id: workItem.id,
    linked: false,
  },
  [`POST /releases/${release.id}/execution-packages/${executionPackage.id}`]: {
    release_id: release.id,
    object_type: 'execution_package',
    object_id: executionPackage.id,
    linked: true,
  },
  [`DELETE /releases/${release.id}/execution-packages/${executionPackage.id}`]: {
    release_id: release.id,
    object_type: 'execution_package',
    object_id: executionPackage.id,
    linked: false,
  },
  [`POST /releases/${release.id}/submit-for-approval`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`POST /releases/${release.id}/approve`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`POST /releases/${release.id}/test-acceptance/acknowledge`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`POST /releases/${release.id}/override-approve`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`POST /releases/${release.id}/request-changes`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`POST /releases/${release.id}/start-observing`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`POST /releases/${release.id}/close`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  [`POST /releases/${release.id}/evidences`]: {
    release,
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    decision_intents: [],
    next_actions: [],
  },
  'POST /tasks': {
    id: 'task-created',
    object_ref: { type: 'task', id: 'task-created' },
    title: 'Developer task',
    stale_state: 'current',
    package_generation_eligible: false,
    href: '/tasks/task-created',
  },
};

export function installProductApiMock(overrides: ProductApiResponseMap = {}) {
  const responses = { ...defaultProductApiResponses, ...overrides };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'http://localhost');
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const key = `${method} ${url.pathname}${url.search}`;

    if (Object.prototype.hasOwnProperty.call(responses, key)) {
      const response = responses[key];
      const body = typeof response === 'function' ? await response({ input, init, key }) : response;
      if (body instanceof Response) {
        return body;
      }
      return jsonResponse(body, 200);
    }

    return jsonResponse({ message: `Unhandled product API request: ${key}` }, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
