import { vi } from 'vitest';

import {
  actorId,
  executionPackage,
  plan,
  planRevision,
  projectId,
  release,
  reviewPacket,
  runSession,
  spec,
  specRevision,
  timeline,
  workItem,
} from './product-data';

export type ProductApiMockHandler = (request: { input: RequestInfo | URL; init?: RequestInit; key: string }) => unknown | Promise<unknown>;
export type ProductApiResponseMap = Record<string, unknown | ProductApiMockHandler>;

const routeWorkItem = {
  ...workItem,
  id: 'wi-1',
  title: 'Improve release cockpit',
  goal: 'Improve release readiness visibility.',
  success_criteria: ['Planning artifacts are visible', 'Validation path is visible'],
  phase: 'planning',
};

const routeSpec = {
  ...spec,
  work_item_id: routeWorkItem.id,
};

const routePlan = {
  ...plan,
  work_item_id: routeWorkItem.id,
};

const routeExecutionPackage = {
  ...executionPackage,
  work_item_id: routeWorkItem.id,
  objective: 'Improve release cockpit planning flow',
};

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
    type: 'work_item',
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
  owner_actor_id: executionPackage.owner_actor_id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  qa_owner_actor_id: executionPackage.qa_owner_actor_id,
  parent: {
    type: 'work_item',
    id: workItem.id,
    title: workItem.title,
  },
  related: [{ type: 'run_session', id: runSession.id, title: runSession.summary }],
  revision_state: {
    current_revision_id: executionPackage.plan_revision_id,
  },
  package_state: {
    work_item_id: executionPackage.work_item_id,
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
  owner_actor_id: runSession.requested_by_actor_id,
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
  [`GET /query/pipeline?project_id=${projectId}`]: [workItem],
  [`GET /work-items?project_id=${projectId}`]: [workItem],
  [`GET /query/workbenches/intake?project_id=${projectId}`]: {
    summary: { role: 'intake', project_id: projectId, actor_id: actorId, total: 1 },
    items: [
      {
        ...routeWorkItem,
        object: { type: 'work_item', id: routeWorkItem.id, title: routeWorkItem.title },
        package_state: { work_item_id: routeWorkItem.id, surface_type: 'release_cockpit' },
        actions: [
          { label: 'Open cockpit', method: 'GET', path: `/query/work-item-cockpit/${routeWorkItem.id}`, enabled: true },
          { label: 'Edit work item', method: 'PATCH', path: `/work-items/${routeWorkItem.id}`, enabled: false },
          { label: 'Create spec', method: 'POST', path: `/work-items/${routeWorkItem.id}/specs`, enabled: true },
        ],
      },
    ],
  },
  [`GET /query/specs?project_id=${projectId}`]: {
    items: [productListItem(spec, workItem, 'spec')],
    degraded_sources: [],
  },
  [`GET /query/specs?project_id=${projectId}&limit=100`]: {
    items: [productListItem(spec, workItem, 'spec')],
    degraded_sources: [],
  },
  [`GET /specs/${spec.id}`]: spec,
  [`GET /specs/${spec.id}/revisions`]: [specRevision],
  [`GET /query/plans?project_id=${projectId}`]: {
    items: [productListItem(plan, workItem, 'plan')],
    degraded_sources: [],
  },
  [`GET /query/plans?project_id=${projectId}&limit=100`]: {
    items: [productListItem(plan, workItem, 'plan')],
    degraded_sources: [],
  },
  [`GET /plans/${plan.id}`]: plan,
  [`GET /plans/${plan.id}/revisions`]: [planRevision],
  [`GET /query/execution-packages?project_id=${projectId}&limit=100`]: {
    items: [packageListItem],
    degraded_sources: [],
  },
  [`GET /query/runs?project_id=${projectId}&limit=100`]: {
    items: [runListItem],
    degraded_sources: [],
  },
  [`GET /execution-packages/${executionPackage.id}`]: executionPackage,
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
  [`GET /query/reviews?project_id=${projectId}`]: [reviewPacket],
  [`GET /query/reviews/${reviewPacket.id}`]: reviewPacket,
  [`GET /query/releases?project_id=${projectId}`]: { releases: [release] },
  [`GET /query/work-item-cockpit/${workItem.id}`]: {
    work_item: workItem,
    current_spec: spec,
    current_plan: plan,
    packages: [executionPackage],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    next_actions: ['open_work_item'],
    completion_state: { fixture: true },
  },
  [`GET /query/work-item-cockpit/${routeWorkItem.id}`]: {
    work_item: routeWorkItem,
    current_spec: routeSpec,
    current_plan: routePlan,
    packages: [routeExecutionPackage],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    next_actions: ['open_work_item'],
    completion_state: { fixture: true },
  },
  [`POST /work-items/${routeWorkItem.id}/specs`]: routeSpec,
  [`POST /work-items/${routeWorkItem.id}/plans`]: routePlan,
  [`POST /specs/${spec.id}/generate-draft`]: specRevision,
  [`POST /specs/${routeSpec.id}/generate-draft`]: {
    ...specRevision,
    id: 'spec-revision-route',
    spec_id: routeSpec.id,
    work_item_id: routeWorkItem.id,
  },
  [`POST /plans/${plan.id}/generate-draft`]: planRevision,
  [`POST /plans/${routePlan.id}/generate-draft`]: {
    ...planRevision,
    id: 'plan-revision-route',
    plan_id: routePlan.id,
    work_item_id: routeWorkItem.id,
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
    payload: { work_item_id: workItem.id },
  })),
  [`GET /query/replay/plan/${plan.id}`]: timeline.map((entry) => ({
    ...entry,
    object_type: 'plan',
    object_id: plan.id,
    summary: 'Plan planning state updated.',
    payload: { work_item_id: workItem.id },
  })),
  [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
  [`GET /query/replay/review_packet/${reviewPacket.id}`]: timeline,
  [`GET /query/replay/release/${release.id}`]: timeline,
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
