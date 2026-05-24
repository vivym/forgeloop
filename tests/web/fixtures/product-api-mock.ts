import { vi } from 'vitest';

import {
  actorId,
  boardCards,
  boundarySummary,
  brainstormingSession,
  bugDetail,
  bugListResponse,
  codeReviewHandoff,
  deliveryReadiness,
  developmentPlan,
  developmentPlanItem,
  execution,
  executionPackage,
  executionPlan,
  executionPlanRevision,
  initiativeDetail,
  initiativeListResponse,
  myWorkQueueResponse,
  plan,
  planRevision,
  productLaneFixtureItemsByLane,
  projectId,
  qaHandoff,
  release,
  releaseReadinessDetail,
  requirementDetail,
  requirementListResponse,
  reviewPacket,
  runSession,
  spec,
  specRevision,
  techDebtDetail,
  techDebtListResponse,
  timeline,
  workItem,
} from './product-data';
import type { ProductLaneId, ProductLaneItem, ProductLaneResponse } from '@forgeloop/contracts';

const { development_plan_id: _developmentPlanItemLegacyPlanId, ...developmentPlanItemProjection } = developmentPlanItem;
void _developmentPlanItemLegacyPlanId;

export type ProductApiMockHandler = (request: { body?: unknown; input: RequestInfo | URL; init?: RequestInit; key: string }) => unknown | Promise<unknown>;
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
      object_type: 'execution',
      object_id: execution.id,
      href: `/executions/${execution.id}`,
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
    type: 'execution',
    id: execution.id,
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
  related: [{ type: 'requirement', id: workItem.id, title: workItem.title }],
  revision_state: {
    current_revision_id: executionPackage.plan_revision_id,
  },
  counts: {},
  updated_at: executionPackage.updated_at ?? '2026-05-18T00:00:00.000Z',
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
          waiting_package_refs: [{ type: 'execution', id: execution.id, title: executionPackage.objective }],
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
  [`GET /query/my-work?project_id=${projectId}`]: myWorkQueueResponse,
  [`GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`]: myWorkQueueResponse,
  [`GET /query/dashboard?project_id=${projectId}`]: {
    project_id: projectId,
    sections: [
      { id: 'flow-health', label: 'Flow Health', value: 1, metrics: [{ label: 'Development Plan Items', value: 1 }] },
      { id: 'blocked-work', label: 'Blocked Work', value: 0, metrics: [] },
      { id: 'aging', label: 'Aging', value: 0, metrics: [] },
      { id: 'risk-concentration', label: 'Risk Concentration', value: 1, metrics: [] },
      { id: 'role-load', label: 'Role Load', value: 1, metrics: [] },
      { id: 'release-confidence', label: 'Release Confidence', value: 1, metrics: [] },
    ],
    next_actions: [{ id: 'continue-execution', label: 'Continue execution', href: `/executions/${execution.id}` }],
    report_links: [{ id: 'execution-continuation', label: 'Execution continuation', href: '/reports/execution-continuation' }],
    degraded_sources: [],
  },
  [`GET /query/development-plans?project_id=${projectId}`]: {
    items: [
      {
        id: developmentPlan.id,
        object_ref: { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
        title: developmentPlan.title,
        status: developmentPlan.status,
        source_refs: developmentPlan.source_refs,
        item_count: developmentPlan.items.length,
        blocked_count: 0,
        href: `/development-plans/${developmentPlan.id}`,
        updated_at: developmentPlan.updated_at,
      },
    ],
    degraded_sources: [],
  },
  [`GET /query/development-plans/${developmentPlan.id}`]: {
    ...developmentPlan,
    object_ref: { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
    source_links: [],
    revisions: [],
    items: [
      {
        id: developmentPlanItem.id,
        object_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        title: developmentPlanItem.title,
        responsible_role: developmentPlanItem.responsible_role,
        driver_actor_id: developmentPlanItem.driver_actor_id,
        reviewer_actor_id: developmentPlanItem.reviewer_actor_id,
        risk: developmentPlanItem.risk,
        boundary_status: developmentPlanItem.boundary_status,
        spec_status: developmentPlanItem.spec_status,
        execution_plan_status: developmentPlanItem.execution_plan_status,
        execution_status: developmentPlanItem.execution_status,
        review_status: developmentPlanItem.review_status,
        qa_handoff_status: developmentPlanItem.qa_handoff_status,
        next_action: developmentPlanItem.next_action,
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      },
    ],
    href: `/development-plans/${developmentPlan.id}`,
  },
  [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: {
    ...developmentPlanItemProjection,
    object_ref: {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
    development_plan_ref: { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
    source_ref: developmentPlan.source_refs[0],
    revisions: [],
    boundary_summary_revisions: [{
      ...boundarySummary,
      id: boundarySummary.revision_id,
      boundary_summary_id: boundarySummary.id,
      revision_number: 1,
      summary_markdown: boundarySummary.summary_markdown,
      decision_count: brainstormingSession.decisions.length,
      decision_snapshot: brainstormingSession.decisions,
    }],
    specs: [{ id: spec.id, artifact_type: 'spec', title: specRevision.summary, current_revision_id: spec.current_revision_id, approved_revision_id: spec.approved_revision_id }],
    execution_plans: [{ id: executionPlanRevision.execution_plan_id, artifact_type: 'execution_plan', title: executionPlanRevision.summary, current_revision_id: executionPlan.current_revision_id, approved_revision_id: executionPlan.approved_revision_id }],
    executions: [{ id: execution.id, title: execution.ref.title, status: execution.status }],
    qa_handoffs: [{ id: qaHandoff.id, title: qaHandoff.ref.title, status: qaHandoff.status }],
    compare_links: {
      item_revisions_href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/revisions/compare`,
      boundary_summary_revisions_href: `/boundary-summaries/${boundarySummary.id}/revisions/compare`,
    },
    href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
  },
  [`GET /development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/revisions`]: [
    { id: developmentPlanItem.revision_id, development_plan_item_id: developmentPlanItem.id, revision_number: 1, snapshot: developmentPlanItem },
  ],
  [`GET /boundary-summaries/${boundarySummary.id}/revisions`]: [
    {
      ...boundarySummary,
      id: boundarySummary.revision_id,
      boundary_summary_id: boundarySummary.id,
      revision_number: 1,
      summary_markdown: boundarySummary.summary_markdown,
      decision_count: brainstormingSession.decisions.length,
      decision_snapshot: brainstormingSession.decisions,
    },
  ],
  [`GET /query/specs-execution-plans?project_id=${projectId}`]: {
    items: [
      {
        id: 'spec-needs-generation',
        artifact_type: 'spec',
        title: 'Spec needs generation',
        status: 'missing',
        gate_state: 'needs_generation',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        reviewer_actor_id: 'actor-tech-lead',
        age_label: '2h',
        risk: developmentPlanItem.risk,
        next_action: 'Generate Spec from approved boundary.',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`,
        updated_at: spec.updated_at,
      },
      {
        id: executionPlanRevision.execution_plan_id,
        artifact_type: 'execution_plan',
        title: 'Execution Plan needs review',
        status: 'in_review',
        gate_state: 'awaiting_review',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        reviewer_actor_id: 'actor-reviewer',
        age_label: '45m',
        risk: developmentPlanItem.risk,
        next_action: 'Review Execution Plan before execution.',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution-plan`,
        updated_at: executionPlan.created_at,
      },
    ],
    degraded_sources: [],
  },
  [`GET /query/specs-execution-plans?project_id=${projectId}&limit=100`]: {
    items: [
      {
        id: 'spec-needs-generation',
        artifact_type: 'spec',
        title: 'Spec needs generation',
        status: 'missing',
        gate_state: 'needs_generation',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        reviewer_actor_id: 'actor-tech-lead',
        age_label: '2h',
        risk: developmentPlanItem.risk,
        next_action: 'Generate Spec from approved boundary.',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`,
        updated_at: spec.updated_at,
      },
      {
        id: executionPlanRevision.execution_plan_id,
        artifact_type: 'execution_plan',
        title: 'Execution Plan needs review',
        status: 'in_review',
        gate_state: 'awaiting_review',
        source_ref: developmentPlan.source_refs[0],
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        reviewer_actor_id: 'actor-reviewer',
        age_label: '45m',
        risk: developmentPlanItem.risk,
        next_action: 'Review Execution Plan before execution.',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution-plan`,
        updated_at: executionPlan.created_at,
      },
    ],
    degraded_sources: [],
  },
  [`GET /query/executions?project_id=${projectId}`]: {
    items: [{ ...execution, title: execution.ref.title, href: `/executions/${execution.id}`, last_event_at: execution.updated_at }],
    degraded_sources: [],
  },
  [`GET /query/executions?project_id=${projectId}&limit=100`]: {
    items: [{ ...execution, title: execution.ref.title, href: `/executions/${execution.id}`, last_event_at: execution.updated_at }],
    degraded_sources: [],
  },
  [`GET /query/executions/${execution.id}`]: execution,
  [`GET /query/code-review-handoffs?project_id=${projectId}`]: {
    items: [{ ...codeReviewHandoff, title: codeReviewHandoff.ref.title, href: `/executions/${execution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/code-review-handoffs?project_id=${projectId}&limit=100`]: {
    items: [{ ...codeReviewHandoff, title: codeReviewHandoff.ref.title, href: `/executions/${execution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
    items: [{ ...codeReviewHandoff, title: codeReviewHandoff.ref.title, href: `/executions/${execution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/qa-handoffs?project_id=${projectId}`]: {
    items: [{ ...qaHandoff, title: qaHandoff.ref.title, href: `/executions/${execution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/qa-handoffs?project_id=${projectId}&limit=100`]: {
    items: [{ ...qaHandoff, title: qaHandoff.ref.title, href: `/executions/${execution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
    items: [{ ...qaHandoff, title: qaHandoff.ref.title, href: `/executions/${execution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/requirements?project_id=${projectId}`]: requirementListResponse,
  [`GET /query/requirements?project_id=${projectId}&limit=100`]: requirementListResponse,
  'GET /query/requirements/req-1': requirementDetail,
  [`GET /query/initiatives?project_id=${projectId}`]: initiativeListResponse,
  [`GET /query/initiatives?project_id=${projectId}&limit=100`]: initiativeListResponse,
  'GET /query/initiatives/init-1': initiativeDetail,
  [`GET /query/tech-debt?project_id=${projectId}`]: techDebtListResponse,
  [`GET /query/tech-debt?project_id=${projectId}&limit=100`]: techDebtListResponse,
  'GET /query/tech-debt/td-1': techDebtDetail,
  [`GET /query/bugs?project_id=${projectId}`]: bugListResponse,
  [`GET /query/bugs?project_id=${projectId}&limit=100`]: bugListResponse,
  'GET /query/bugs/bug-1': bugDetail,
  [`GET /query/board?project_id=${projectId}&limit=100`]: { items: boardCards },
  [`GET /query/reports/development-plan-throughput?project_id=${projectId}&limit=100`]: {
    id: 'development-plan-throughput',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    degraded_sources: [],
  },
  [`GET /query/reports/quality-bug-escape?project_id=${projectId}&limit=100`]: {
    id: 'quality-bug-escape',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    degraded_sources: [],
  },
  [`GET /query/reports/release-readiness?project_id=${projectId}&limit=100`]: {
    id: 'release-readiness',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    degraded_sources: [],
  },
  [`GET /query/reports/execution-outcomes?project_id=${projectId}&limit=100`]: {
    id: 'execution-outcomes',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    degraded_sources: [],
  },
  [`GET /query/reports/execution-continuation?project_id=${projectId}&limit=100`]: {
    id: 'execution-continuation',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    degraded_sources: [],
  },
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
  [`GET /releases?project_id=${projectId}`]: { releases: [release] },
  [`GET /releases?project_id=${projectId}&limit=100`]: { releases: [release] },
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
  'POST /development-plans': developmentPlan,
  'POST /development-plans/generate-draft': {
    development_plan: developmentPlan,
    revision: { id: developmentPlan.revision_id, development_plan_id: developmentPlan.id, revision_number: 1 },
  },
  [`POST /development-plans/${developmentPlan.id}/items`]: developmentPlanItem,
  [`POST /development-plans/${developmentPlan.id}/regenerate-draft`]: {
    development_plan: developmentPlan,
    revision: { id: 'development-plan-revision-regenerated', development_plan_id: developmentPlan.id, revision_number: 2 },
  },
  [`POST /source-objects/requirement/req-1/development-plans/${developmentPlan.id}/link`]: {
    id: 'development-plan-source-link-web-product',
    development_plan_id: developmentPlan.id,
    source_ref: developmentPlan.source_refs[0],
  },
  [`POST /development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/brainstorming-sessions`]: brainstormingSession,
  [`POST /brainstorming-sessions/${brainstormingSession.id}/answers`]: brainstormingSession.answers[0],
  [`POST /brainstorming-sessions/${brainstormingSession.id}/decisions`]: brainstormingSession.decisions[0],
  [`POST /brainstorming-sessions/${brainstormingSession.id}/approve-boundary`]: {
    session: brainstormingSession,
    boundary_summary: boundarySummary,
  },
  'POST /development-plans/development-plan-web-product/items/development-plan-item-web-product/spec/generate-draft': cockpitSpecRevisionFor(
    specRevision,
    workItem,
  ),
  'GET /development-plans/development-plan-web-product/items/development-plan-item-web-product/spec/revisions/compare?base_revision_id=spec-revision-web-product&compare_revision_id=spec-revision-web-product': {
    base_revision_id: specRevision.id,
    compare_revision_id: specRevision.id,
    changed_fields: [],
  },
  'POST /development-plans/development-plan-route/items/development-plan-item-route/spec/generate-draft': {
    ...cockpitSpecRevisionFor(specRevision, routeWorkItem),
    id: 'spec-revision-route',
    spec_id: routeSpec.id,
  },
  'POST /development-plans/development-plan-web-product/items/development-plan-item-web-product/execution-plan/generate-draft': {
    id: 'execution-plan-revision-web-product',
    execution_plan_id: 'execution-plan-web-product',
    development_plan_item_id: 'development-plan-item-web-product',
    based_on_spec_revision_id: specRevision.id,
    revision_number: 1,
    summary: planRevision.summary,
    content: planRevision.content,
    created_at: planRevision.created_at,
  },
  'GET /development-plans/development-plan-web-product/items/development-plan-item-web-product/execution-plan/revisions/compare?base_revision_id=execution-plan-revision-web-product&compare_revision_id=execution-plan-revision-web-product': {
    base_revision_id: executionPlanRevision.id,
    compare_revision_id: executionPlanRevision.id,
    changed_fields: [],
  },
  'POST /development-plans/development-plan-route/items/development-plan-item-route/execution-plan/generate-draft': {
    id: 'execution-plan-revision-route',
    execution_plan_id: 'execution-plan-route',
    development_plan_item_id: 'development-plan-item-route',
    based_on_spec_revision_id: specRevision.id,
    revision_number: 1,
    summary: planRevision.summary,
    content: planRevision.content,
    created_at: planRevision.created_at,
  },
  [`POST /development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution/start`]: execution,
  [`POST /executions/${execution.id}/continue`]: { ...execution, status: 'running' },
  [`POST /executions/${execution.id}/interrupt`]: { ...execution, status: 'interrupted' },
  [`POST /executions/${execution.id}/ready-for-code-review`]: codeReviewHandoff,
  [`POST /code-review-handoffs/${codeReviewHandoff.id}/approve`]: { ...codeReviewHandoff, status: 'approved' },
  [`POST /code-review-handoffs/${codeReviewHandoff.id}/request-changes`]: { ...codeReviewHandoff, status: 'changes_requested' },
  [`POST /code-review-handoffs/${codeReviewHandoff.id}/audited-exception`]: {
    ...codeReviewHandoff,
    audited_exception: {
      actor_id: 'actor-reviewer',
      reason: 'Fixture exception',
      risk: 'low',
      rollback_plan: 'Revert fixture changes.',
      created_at: '2026-05-18T00:30:00.000Z',
    },
  },
  [`POST /code-review-handoffs/${codeReviewHandoff.id}/qa-handoff`]: qaHandoff,
  [`POST /qa-handoffs/${qaHandoff.id}/block`]: { ...qaHandoff, status: 'blocked' },
  [`POST /qa-handoffs/${qaHandoff.id}/accept`]: { ...qaHandoff, status: 'accepted' },
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
  [`GET /query/releases/${release.id}/readiness?project_id=${projectId}`]: releaseReadinessDetail,
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
