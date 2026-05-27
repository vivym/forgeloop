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
  developmentPlanItemsById,
  execution,
  executionPackage,
  executionPlan,
  executionPlanRevision,
  interruptedExecution,
  initiativeDetail,
  initiativeListResponse,
  myWorkQueueResponse,
  plan,
  planRevision,
  productDynamicRouteFixtureManifest,
  productLaneFixtureItemsByLane,
  productWorkspaceDevelopmentPlanItems,
  productWorkspaceDevelopmentPlans,
  projectId,
  blockedQaHandoff,
  qaHandoff,
  release,
  releaseEvidenceRefs,
  releaseReadinessDetail,
  requirementDetail,
  requirementListResponse,
  reportFixtures,
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

const developmentPlanItemProjectionFor = <T extends { development_plan_id: string }>(item: T) => {
  const { development_plan_id: _developmentPlanItemPlanId, ...projection } = item;
  void _developmentPlanItemPlanId;
  return projection;
};

export type ProductApiMockHandler = (request: { body?: unknown; input: RequestInfo | URL; init?: RequestInit; key: string }) => unknown | Promise<unknown>;
export type ProductApiResponseMap = Record<string, unknown | ProductApiMockHandler>;

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
  return { ...publicRevision, scope_ref: scopeRefForItem(item), attachment_refs: [] };
};

const itemExecutionPlanRevisionFor = (revision: typeof executionPlanRevision) => ({
  ...revision,
  attachment_refs: [],
});

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
    id: 'open-product-workspace-requirement',
    lane_id: 'requirements',
    priority: 'primary',
    label: 'Open requirement',
    enabled: true,
    kind: 'navigate',
    target: {
      kind: 'object',
      object_type: 'requirement',
      object_id: workItem.id,
      href: `/requirements/${workItem.id}`,
    },
  },
  {
    id: 'open-product-workspace-plan-item',
    lane_id: 'requirements',
    priority: 'secondary',
    label: 'Open Plan Item gate',
    description: 'Continue through the governed Plan Item gate.',
    enabled: true,
    kind: 'navigate',
    target: {
      kind: 'object',
      object_type: 'development_plan_item',
      object_id: developmentPlanItem.id,
      href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    },
  },
] as const;

const routeProductLaneItem = {
  id: workItem.id,
  title: workItem.title,
  object: { type: 'requirement', id: workItem.id },
  kind: workItem.kind,
  phase: workItem.phase,
  status: workItem.activity_state,
  gate_state: workItem.gate_state,
  resolution: workItem.resolution,
  risk: workItem.risk,
  driver_actor_id: workItem.driver_actor_id,
  updated_at: workItem.updated_at ?? '2026-05-18T00:00:00.000Z',
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

const developmentPlanItemRows = productWorkspaceDevelopmentPlanItems.map((item) => ({
  id: item.id,
  object_ref: {
    type: 'development_plan_item',
    id: item.id,
    development_plan_id: item.development_plan_id,
    title: item.title,
  },
  development_plan_ref: {
    id: item.development_plan_id,
    title: productWorkspaceDevelopmentPlans.find((plan) => plan.id === item.development_plan_id)?.title ?? developmentPlan.title,
  },
  title: item.title,
  responsible_role: item.responsible_role,
  driver_actor_id: item.driver_actor_id,
  reviewer_actor_id: item.reviewer_actor_id,
  risk: item.risk,
  boundary_status: item.boundary_status,
  spec_status: item.spec_status,
  execution_plan_status: item.execution_plan_status,
  execution_status: item.execution_status,
  review_status: item.review_status,
  qa_handoff_status: item.qa_handoff_status,
  next_action: item.next_action,
  href: `/development-plans/${item.development_plan_id}/items/${item.id}`,
}));

const developmentPlanItemResponseFor = (item: (typeof developmentPlan.items)[number]) => ({
  ...developmentPlanItemProjectionFor(item),
  object_ref: {
    type: 'development_plan_item',
    id: item.id,
    development_plan_id: developmentPlan.id,
    title: item.title,
  },
  development_plan_ref: {
    type: 'development_plan',
    id: item.development_plan_id,
    title: productWorkspaceDevelopmentPlans.find((plan) => plan.id === item.development_plan_id)?.title ?? developmentPlan.title,
  },
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
  code_review_handoffs: [{ id: codeReviewHandoff.id, title: codeReviewHandoff.ref.title, status: codeReviewHandoff.status }],
  qa_handoffs: [{ id: qaHandoff.id, title: qaHandoff.ref.title, status: qaHandoff.status }],
  compare_links: {
    item_revisions_href: `/development-plans/${developmentPlan.id}/items/${item.id}/revisions/compare`,
    boundary_summary_revisions_href: `/boundary-summaries/${boundarySummary.id}/revisions/compare`,
  },
  href: `/development-plans/${item.development_plan_id}/items/${item.id}`,
});

const developmentPlanItemResponses = Object.fromEntries(
  productWorkspaceDevelopmentPlanItems.map((item) => [
    `GET /query/development-plans/${item.development_plan_id}/items/${item.id}`,
    developmentPlanItemResponseFor(item),
  ]),
);

const developmentPlanItemRevisionResponses = Object.fromEntries(
  productWorkspaceDevelopmentPlanItems.map((item) => [
    `GET /development-plans/${item.development_plan_id}/items/${item.id}/revisions`,
    [{ id: item.revision_id, development_plan_item_id: item.id, revision_number: 1, snapshot: item }],
  ]),
);

const developmentPlanItemSpecCompareResponses = Object.fromEntries(
  productWorkspaceDevelopmentPlanItems.map((item) => [
    `GET /development-plans/${item.development_plan_id}/items/${item.id}/spec/revisions/compare?base_revision_id=${specRevision.id}&compare_revision_id=${specRevision.id}`,
    {
      base_revision_id: specRevision.id,
      compare_revision_id: specRevision.id,
      summary: 'No Spec revision changes in seeded product workspace data.',
      changed_sections: [],
    },
  ]),
);

const developmentPlanItemExecutionPlanCompareResponses = Object.fromEntries(
  productWorkspaceDevelopmentPlanItems.map((item) => [
    `GET /development-plans/${item.development_plan_id}/items/${item.id}/execution-plan/revisions/compare?base_revision_id=${executionPlanRevision.id}&compare_revision_id=${executionPlanRevision.id}`,
    {
      base_revision_id: executionPlanRevision.id,
      compare_revision_id: executionPlanRevision.id,
      summary: 'No Execution Plan revision changes in seeded product workspace data.',
      changed_sections: [],
    },
  ]),
);

const executionDetailResponse = (() => {
  const { title: _title, ...detail } = execution;
  void _title;
  return detail;
})();

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
    report_links: [{ id: 'execution-continuation', label: 'Execution continuation', href: '/reports/delivery' }],
    degraded_sources: [],
  },
  [`GET /query/development-plans?project_id=${projectId}`]: {
    items: productWorkspaceDevelopmentPlans.map((plan) => ({
      id: plan.id,
      object_ref: { type: 'development_plan', id: plan.id, title: plan.title },
      title: plan.title,
      status: plan.status,
      source_refs: plan.source_refs,
      item_count: plan.items.length,
      blocked_count: plan.items.filter((item) => item.boundary_status === 'changes_requested' || item.spec_status === 'blocked' || item.execution_plan_status === 'blocked' || item.qa_handoff_status === 'blocked').length,
      responsible_role: plan.items[0]?.responsible_role ?? developmentPlanItem.responsible_role,
      responsible_roles: [...new Set(plan.items.map((item) => item.responsible_role))],
      gate_state: 'execution',
      gate_states: ['boundary', 'spec', 'execution_plan', 'execution', 'review', 'qa'],
      risk: plan.items[0]?.risk ?? developmentPlanItem.risk,
      risks: [...new Set(plan.items.map((item) => item.risk))],
      href: `/development-plans/${plan.id}`,
      updated_at: plan.updated_at,
    })),
    degraded_sources: [],
  },
  [`GET /query/development-plans/${developmentPlan.id}`]: {
    ...developmentPlan,
    object_ref: { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
    source_links: [],
    revisions: [],
    items: developmentPlanItemRows.filter((item) => item.development_plan_ref.id === developmentPlan.id),
    href: `/development-plans/${developmentPlan.id}`,
  },
  ...Object.fromEntries(productWorkspaceDevelopmentPlans.filter((plan) => plan.id !== developmentPlan.id).map((plan) => [
    `GET /query/development-plans/${plan.id}`,
    {
      ...plan,
      object_ref: { type: 'development_plan', id: plan.id, title: plan.title },
      source_links: [],
      revisions: [],
      items: developmentPlanItemRows.filter((item) => item.development_plan_ref.id === plan.id),
      href: `/development-plans/${plan.id}`,
    },
  ])),
  ...developmentPlanItemResponses,
  ...developmentPlanItemRevisionResponses,
  ...developmentPlanItemSpecCompareResponses,
  ...developmentPlanItemExecutionPlanCompareResponses,
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
    items: [execution, interruptedExecution].map((item) => ({ ...item, title: item.ref.title, href: `/executions/${item.id}`, last_event_at: item.updated_at })),
    degraded_sources: [],
  },
  [`GET /query/executions?project_id=${projectId}&limit=100`]: {
    items: [execution, interruptedExecution].map((item) => ({ ...item, title: item.ref.title, href: `/executions/${item.id}`, last_event_at: item.updated_at })),
    degraded_sources: [],
  },
  [`GET /query/executions/${execution.id}`]: executionDetailResponse,
  [`GET /query/executions/${interruptedExecution.id}`]: (() => {
    const { title: _title, ...detail } = interruptedExecution;
    void _title;
    return detail;
  })(),
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
    items: [
      { ...qaHandoff, title: qaHandoff.ref.title, href: `/executions/${execution.id}` },
      { ...blockedQaHandoff, title: blockedQaHandoff.ref.title, href: `/executions/${interruptedExecution.id}` },
    ],
    degraded_sources: [],
  },
  [`GET /query/qa-handoffs?project_id=${projectId}&limit=100`]: {
    items: [
      { ...qaHandoff, title: qaHandoff.ref.title, href: `/executions/${execution.id}` },
      { ...blockedQaHandoff, title: blockedQaHandoff.ref.title, href: `/executions/${interruptedExecution.id}` },
    ],
    degraded_sources: [],
  },
  [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
    items: [{ ...qaHandoff, title: qaHandoff.ref.title, href: `/executions/${execution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${interruptedExecution.id}&limit=100`]: {
    items: [{ ...blockedQaHandoff, title: blockedQaHandoff.ref.title, href: `/executions/${interruptedExecution.id}` }],
    degraded_sources: [],
  },
  [`GET /query/requirements?project_id=${projectId}`]: requirementListResponse,
  [`GET /query/requirements?project_id=${projectId}&limit=100`]: requirementListResponse,
  [`GET /query/requirements/${requirementDetail.id}`]: requirementDetail,
  [`GET /query/initiatives?project_id=${projectId}`]: initiativeListResponse,
  [`GET /query/initiatives?project_id=${projectId}&limit=100`]: initiativeListResponse,
  [`GET /query/initiatives/${initiativeDetail.id}`]: initiativeDetail,
  [`GET /query/tech-debt?project_id=${projectId}`]: techDebtListResponse,
  [`GET /query/tech-debt?project_id=${projectId}&limit=100`]: techDebtListResponse,
  [`GET /query/tech-debt/${techDebtDetail.id}`]: techDebtDetail,
  [`GET /query/bugs?project_id=${projectId}`]: bugListResponse,
  [`GET /query/bugs?project_id=${projectId}&limit=100`]: bugListResponse,
  [`GET /query/bugs/${bugDetail.id}`]: bugDetail,
  [`GET /query/board?project_id=${projectId}&limit=100`]: { items: boardCards },
  [`GET /query/reports?project_id=${projectId}&report=replay`]: () =>
    new Response(JSON.stringify({ message: 'Replay report is dev-only in product workspace rebuild.' }), { status: 404 }),
  [`GET /query/reports/delivery?project_id=${projectId}&limit=100`]: reportFixtures.delivery,
  [`GET /query/reports/development-plan-throughput?project_id=${projectId}&limit=100`]: {
    ...reportFixtures.developmentPlanThroughput,
  },
  [`GET /query/reports/quality-bug-escape?project_id=${projectId}&limit=100`]: reportFixtures.qualityBugEscape,
  [`GET /query/reports/release-readiness?project_id=${projectId}&limit=100`]: reportFixtures.releaseReadiness,
  [`GET /query/reports/execution-outcomes?project_id=${projectId}&limit=100`]: reportFixtures.executionOutcomes,
  [`GET /query/reports/execution-continuation?project_id=${projectId}&limit=100`]: reportFixtures.executionContinuation,
  [`GET /query/product-fixture-manifest?project_id=${projectId}`]: { items: productDynamicRouteFixtureManifest },
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
        id: 'event-product-workspace-preview-1',
        run_session_id: runSession.id,
        sequence: 1,
        cursor: '0000000001',
        event_type: 'agent_message',
        source: 'fixture',
        visibility: 'public',
        summary: 'Product workspace preview visual review data passed deterministic checks.',
        payload: { message: 'Product workspace preview visual review data passed deterministic checks.' },
        created_at: '2026-05-18T00:24:30.000Z',
      },
    ],
    next_cursor: '0000000001',
    has_more: false,
  },
  [`POST /run-sessions/${runSession.id}/events/stream-token`]: {
    token: 'stream-token-product-workspace-preview',
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
  'POST /development-plans/generate-draft': { ...developmentPlan, generation_state: 'draft_generated' },
  [`POST /development-plans/${developmentPlan.id}/items`]: developmentPlanItem,
  [`POST /development-plans/${developmentPlan.id}/regenerate-draft`]: { ...developmentPlan, revision_id: 'development-plan-revision-regenerated', generation_state: 'draft_regenerated' },
  [`GET /spec-revisions/${specRevision.id}`]: cockpitSpecRevisionFor(specRevision, workItem),
  [`GET /execution-plan-revisions/${executionPlanRevision.id}`]: itemExecutionPlanRevisionFor(executionPlanRevision),
  ...Object.fromEntries(
    developmentPlan.items.map((item) => [
      `PATCH /development-plans/${developmentPlan.id}/items/${item.id}/spec/draft`,
      ({ init }: Parameters<ProductApiMockHandler>[0]) => ({
        ...cockpitSpecRevisionFor(specRevision, workItem),
        id: `specrev-${item.id}-saved`,
        content: requestBody(init).markdown ?? specRevision.content,
      }),
    ]),
  ),
  ...Object.fromEntries(
    developmentPlan.items.map((item) => [
      `PATCH /development-plans/${developmentPlan.id}/items/${item.id}/execution-plan/draft`,
      ({ init }: Parameters<ProductApiMockHandler>[0]) => ({
        ...itemExecutionPlanRevisionFor(executionPlanRevision),
        id: `planrev-${item.id}-saved`,
        content: requestBody(init).markdown ?? executionPlanRevision.content,
      }),
    ]),
  ),
  [`POST /source-objects/requirement/${requirementDetail.id}/development-plans/${developmentPlan.id}/link`]: {
    id: 'development-plan-source-link-product-workspace-preview',
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
  [`POST /development-plans/${developmentPlan.id}/items/${developmentPlanItemsById['dpi-cockpit-command-center'].id}/spec/generate-draft`]: cockpitSpecRevisionFor(
    specRevision,
    workItem,
  ),
  [`GET /development-plans/${developmentPlan.id}/items/${developmentPlanItemsById['dpi-cockpit-command-center'].id}/spec/revisions/compare?base_revision_id=${specRevision.id}&compare_revision_id=${specRevision.id}`]: {
    base_revision_id: specRevision.id,
    compare_revision_id: specRevision.id,
    changed_fields: [],
  },
  [`POST /development-plans/${developmentPlan.id}/items/${developmentPlanItemsById['dpi-requirements-database-view'].id}/execution-plan/generate-draft`]: {
    id: executionPlanRevision.id,
    execution_plan_id: executionPlan.id,
    development_plan_item_id: developmentPlanItemsById['dpi-requirements-database-view'].id,
    based_on_spec_revision_id: specRevision.id,
    revision_number: 1,
    summary: planRevision.summary,
    content: planRevision.content,
    created_at: planRevision.created_at,
  },
  [`GET /development-plans/${developmentPlan.id}/items/${developmentPlanItemsById['dpi-requirements-database-view'].id}/execution-plan/revisions/compare?base_revision_id=${executionPlanRevision.id}&compare_revision_id=${executionPlanRevision.id}`]: {
    base_revision_id: executionPlanRevision.id,
    compare_revision_id: executionPlanRevision.id,
    changed_fields: [],
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
    evidences: releaseEvidenceRefs,
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

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  try {
    const parsed = JSON.parse(init.body);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

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
