import type {
  DeliveryStageId,
  ProductAction,
  ProductLaneId,
  ProductLaneItem,
  WorkItemCockpitResponse,
  WorkItemDeliveryReadiness,
} from '@forgeloop/contracts';

export const projectId = 'project-web-product';
export const actorId = 'actor-owner';

export const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Product operators need deterministic route-backed product data.',
  desired_outcome: 'Web route tests exercise Product Lane and Work Item flows without live APIs.',
  acceptance_criteria: ['API hooks resolve deterministic fixtures', 'Product Lane labels expose domain queues'],
  in_scope: ['Shared API hooks', 'Route test fixtures'],
} as const;

export const workItem = {
  id: 'work-item-web-product',
  project_id: projectId,
  kind: 'requirement',
  title: 'Ship route-backed product lane',
  goal: 'Provide deterministic product data for web route tests.',
  success_criteria: ['API hooks resolve deterministic fixtures', 'Product Lane labels expose domain queues'],
  priority: 'P0',
  risk: 'medium',
  driver_actor_id: actorId,
  intake_context: requirementIntakeContext,
  phase: 'triage',
  activity_state: 'active',
  gate_state: 'open',
  resolution: 'unresolved',
  current_spec_id: 'spec-web-product',
  current_plan_id: 'plan-web-product',
  created_at: '2026-05-18T00:00:00.000Z',
  updated_at: '2026-05-18T00:00:00.000Z',
};

export const spec = {
  id: 'spec-web-product',
  work_item_id: workItem.id,
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'locked',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'spec-revision-web-product',
  approved_revision_id: 'spec-revision-web-product',
  approved_at: '2026-05-18T00:10:00.000Z',
  approved_by_actor_id: 'actor-reviewer',
  created_at: '2026-05-18T00:05:00.000Z',
  updated_at: '2026-05-18T00:10:00.000Z',
};

export const specRevision = {
  id: 'spec-revision-web-product',
  spec_id: spec.id,
  work_item_id: workItem.id,
  revision_number: 1,
  summary: 'Route-backed Product Lane spec',
  content: 'The web Product Lane reads product data through shared API hooks.',
  background: 'Task 4 establishes shared clients, query keys, and contexts.',
  goals: ['Centralize product API reads', 'Keep product copy lane-safe'],
  scope_in: ['Shared API hooks', 'Route test fixtures'],
  scope_out: ['Route shell navigation'],
  acceptance_criteria: ['Query keys are stable', 'Fixtures need no live API'],
  risk_notes: ['Backend actor ids remain internal'],
  test_strategy_summary: 'Vitest covers query keys and lane mapping behavior.',
  created_at: '2026-05-18T00:06:00.000Z',
};

export const plan = {
  id: 'plan-web-product',
  work_item_id: workItem.id,
  entity_type: 'plan',
  status: 'approved',
  editing_state: 'locked',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'plan-revision-web-product',
  approved_revision_id: 'plan-revision-web-product',
  approved_at: '2026-05-18T00:18:00.000Z',
  approved_by_actor_id: 'actor-reviewer',
  created_at: '2026-05-18T00:12:00.000Z',
  updated_at: '2026-05-18T00:18:00.000Z',
};

export const planRevision = {
  id: 'plan-revision-web-product',
  plan_id: plan.id,
  work_item_id: workItem.id,
  revision_number: 1,
  summary: 'Add shared API product foundation',
  content: 'Create shared API clients, hooks, contexts, and deterministic fixtures.',
  implementation_summary: 'Move current API clients into shared/api and consume canonical Product Lane DTOs.',
  split_strategy: 'Foundation-only task with no route shell work.',
  dependency_order: ['shared/api', 'shared/context', 'tests/web/fixtures'],
  test_matrix: ['pnpm vitest run tests/web/api-hooks.test.tsx', 'pnpm --filter @forgeloop/web typecheck'],
  risk_mitigations: ['Keep route fixtures aligned with ProductAction contracts'],
  rollback_notes: 'Revert shared API foundation commit if route tasks need to pause.',
  created_at: '2026-05-18T00:13:00.000Z',
};

export const executionPackage = {
  id: 'package-web-product',
  work_item_id: workItem.id,
  spec_id: spec.id,
  spec_revision_id: specRevision.id,
  plan_id: plan.id,
  plan_revision_id: planRevision.id,
  project_id: projectId,
  repo_id: 'forgeloop',
  objective: 'Add route-backed product API foundation',
  owner_actor_id: 'actor-execution-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'ready',
  activity_state: 'active',
  gate_state: 'open',
  resolution: 'unresolved',
  required_checks: [
    {
      check_id: 'web-typecheck',
      display_name: 'Web typecheck',
      command: 'pnpm --filter @forgeloop/web typecheck',
      timeout_seconds: 600,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['diff', 'check_output'],
  allowed_paths: ['apps/web/src/shared/**', 'tests/web/**'],
  forbidden_paths: ['apps/control-plane-api/**'],
  version: 1,
  last_run_session_id: 'run-web-product',
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
};

export const runSession = {
  id: 'run-web-product',
  execution_package_id: executionPackage.id,
  requested_by_actor_id: executionPackage.owner_actor_id,
  status: 'succeeded',
  executor_type: 'mock',
  changed_files: [{ repo_id: 'forgeloop', path: 'apps/web/src/shared/api/hooks.ts', change_kind: 'added' }],
  check_results: [
    {
      check_id: 'web-typecheck',
      command: 'pnpm --filter @forgeloop/web typecheck',
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 12,
      blocks_review: true,
    },
  ],
  artifacts: [
    {
      kind: 'diff',
      name: 'shared-api-foundation.diff',
      content_type: 'text/x-diff',
      storage_uri: 's3://forgeloop-product-fixtures/shared-api-foundation.diff',
    },
  ],
  summary: 'Shared product API foundation passed deterministic checks.',
  created_at: '2026-05-18T00:24:00.000Z',
  updated_at: '2026-05-18T00:25:00.000Z',
  started_at: '2026-05-18T00:24:00.000Z',
  finished_at: '2026-05-18T00:25:00.000Z',
};

export const reviewPacket = {
  id: 'review-web-product',
  run_session_id: runSession.id,
  execution_package_id: executionPackage.id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  status: 'completed',
  decision: 'approved',
  summary: 'Shared product API foundation is ready for route tests.',
  changed_files: runSession.changed_files,
  check_result_summary: 'All required product checks passed.',
  self_review: {
    status: 'succeeded',
    summary: 'No live API dependency remains in the test fixtures.',
    spec_plan_alignment: 'Aligned',
    test_assessment: 'Focused hook and state checks pass.',
    risk_notes: ['Product Lane fixtures remain contract-shaped'],
    follow_up_questions: [],
  },
  risk_notes: ['Keep deleted queue identifiers out of product navigation labels'],
  reviewed_by_actor_id: executionPackage.reviewer_actor_id,
  reviewed_at: '2026-05-18T00:30:00.000Z',
  created_at: '2026-05-18T00:28:00.000Z',
  updated_at: '2026-05-18T00:30:00.000Z',
};

export const release = {
  id: 'release-web-product',
  org_id: 'org-web-product',
  project_id: projectId,
  title: 'Web product UI architecture foundation',
  scope_summary: 'Shared product API hooks and deterministic route fixtures.',
  release_owner_actor_id: 'actor-release-owner',
  release_type: 'standard',
  phase: 'approval',
  activity_state: 'active',
  gate_state: 'open',
  resolution: 'unresolved',
  work_item_ids: [workItem.id],
  execution_package_ids: [executionPackage.id],
  rollout_strategy: 'Use in route tests before production pages are ready.',
  rollback_plan: 'Remove route test fixture usage and restore direct mocks.',
  observation_plan: 'Watch route tests for missing API fixture coverage.',
  created_by_actor_id: actorId,
  updated_by_actor_id: actorId,
  created_at: '2026-05-18T00:35:00.000Z',
  updated_at: '2026-05-18T00:36:00.000Z',
};

export const timeline = [
  {
    id: 'timeline-web-product-1',
    source: 'fixture',
    object_type: 'work_item',
    object_id: workItem.id,
    summary: 'Created shared product API foundation work item.',
    created_at: workItem.created_at,
  payload: { project_id: projectId },
  },
];

const fixtureUpdatedAt = '2026-05-18T00:40:00.000Z';

export const productActionFixtures = {
  navigate: {
    id: 'open-fixture-work-item',
    lane_id: 'requirements',
    priority: 'primary',
    label: 'Open work item',
    enabled: true,
    kind: 'navigate',
    target: {
      kind: 'object',
      object_type: 'work_item',
      object_id: workItem.id,
      href: `/work-items/${workItem.id}`,
    },
  },
  command: {
    id: 'draft-fixture-spec',
    lane_id: 'spec-approver',
    priority: 'secondary',
    label: 'Generate spec draft',
    enabled: true,
    kind: 'command',
    command: {
      type: 'generate_spec_draft',
      object_type: 'spec',
      object_id: spec.id,
      work_item_id: workItem.id,
      spec_id: spec.id,
    },
    target: {
      kind: 'object',
      object_type: 'spec',
      object_id: spec.id,
      href: `/specs/${spec.id}`,
    },
  },
  disabled: {
    id: 'execution-waiting-on-plan',
    lane_id: 'execution-owner',
    priority: 'secondary',
    label: 'Mark package ready',
    enabled: false,
    disabled_reason: 'Plan approval is required before execution can start.',
    kind: 'command',
    command: {
      type: 'mark_package_ready',
      object_type: 'execution_package',
      object_id: executionPackage.id,
      work_item_id: workItem.id,
      package_id: executionPackage.id,
      expected_package_version: executionPackage.version,
    },
    target: {
      kind: 'object',
      object_type: 'execution_package',
      object_id: executionPackage.id,
      href: `/packages/${executionPackage.id}`,
    },
  },
  blocked: {
    id: 'blocked-release-review',
    lane_id: 'release-owner',
    priority: 'primary',
    label: 'Open release',
    enabled: false,
    disabled_reason: 'Release approval is waiting on validation.',
    blocked_reason: 'QA acceptance has not been acknowledged.',
    kind: 'navigate',
    target: {
      kind: 'object',
      object_type: 'release',
      object_id: release.id,
      href: `/releases/${release.id}`,
    },
  },
  targetLane: {
    id: 'open-reviewer-lane',
    lane_id: 'manager',
    priority: 'secondary',
    label: 'Open reviewer lane',
    enabled: true,
    kind: 'navigate',
    target: {
      kind: 'lane',
      lane_id: 'reviewer',
      href: `/lanes/reviewer?project_id=${projectId}`,
    },
  },
  commandTargetFollowUp: {
    id: 'run-fixture-package',
    lane_id: 'execution-owner',
    priority: 'primary',
    label: 'Run package',
    description: 'Run the package and keep the package detail available as the follow-up target.',
    enabled: true,
    kind: 'command',
    command: {
      type: 'run_package',
      object_type: 'execution_package',
      object_id: executionPackage.id,
      work_item_id: workItem.id,
      package_id: executionPackage.id,
    },
    target: {
      kind: 'object',
      object_type: 'execution_package',
      object_id: executionPackage.id,
      href: `/packages/${executionPackage.id}`,
    },
  },
} satisfies Record<string, ProductAction>;

const deliveryStageLabels = {
  spec: 'Spec',
  plan: 'Plan',
  packages: 'Packages',
  execution: 'Execution',
  review: 'Review',
  integration_readiness: 'Integration Readiness',
  quality_gate: 'Quality Gate',
  release_readiness: 'Release Readiness',
} satisfies Record<DeliveryStageId, string>;

const deliveryStageOwnerLanes = {
  spec: 'spec-approver',
  plan: 'spec-approver',
  packages: 'execution-owner',
  execution: 'execution-owner',
  review: 'reviewer',
  integration_readiness: 'qa-test-owner',
  quality_gate: 'qa-test-owner',
  release_readiness: 'release-owner',
} satisfies Record<DeliveryStageId, ProductLaneId>;

const deliveryStageIds = Object.keys(deliveryStageLabels) as DeliveryStageId[];

export function deliveryReadiness(
  item: Pick<WorkItemCockpitResponse['work_item'], 'id' | 'kind'>,
  actions: readonly ProductAction[] = [],
  activeLane: ProductLaneId = 'requirements',
  overrides: Partial<
    Pick<WorkItemDeliveryReadiness, 'overall_state' | 'stages' | 'blockers' | 'evidence' | 'degraded_sources'>
  > = {},
): WorkItemDeliveryReadiness {
  const stages =
    overrides.stages ??
    deliveryStageIds.map((id) => ({
      id,
      label: deliveryStageLabels[id],
      state: id === 'integration_readiness' ? 'not_applicable' : 'ready',
      owner_lane: deliveryStageOwnerLanes[id],
      object_refs: [],
      blockers: [],
      evidence_refs: [],
    }));

  return {
    work_item_id: item.id,
    work_item_kind: item.kind as WorkItemDeliveryReadiness['work_item_kind'],
    active_lane: activeLane,
    overall_state: overrides.overall_state ?? 'in_progress',
    stages,
    blockers: overrides.blockers ?? [],
    evidence: overrides.evidence ?? [],
    next_actions: [...actions],
    degraded_sources: overrides.degraded_sources ?? [],
    generated_at: fixtureUpdatedAt,
  };
}

const baseCockpitFixture = (
  item: WorkItemCockpitResponse['work_item'],
  readiness: WorkItemDeliveryReadiness,
): WorkItemCockpitResponse => ({
  work_item: item,
  current_spec: { ...spec, work_item_id: item.id },
  current_plan: { ...plan, work_item_id: item.id },
  packages: [{ ...executionPackage, work_item_id: item.id }],
  run_sessions: [runSession],
  review_packets: [reviewPacket],
  delivery_readiness: readiness,
});

const workItemKindFixture = (
  id: string,
  kind: WorkItemCockpitResponse['work_item']['kind'],
  title: string,
  lane: ProductLaneId,
): WorkItemCockpitResponse => {
  const item = {
    ...workItem,
    id,
    kind,
    title,
    intake_context:
      kind === 'bug'
        ? {
            type: 'bug',
            impact_summary: title,
            observed_behavior: 'The route shows a failing state.',
            expected_behavior: 'The route shows the expected product state.',
            reproduction_steps: ['Open the route'],
            affected_environment: 'Web test fixture',
            verification_path: 'Route test passes',
          }
        : kind === 'tech_debt'
          ? {
              type: 'tech_debt',
              current_pain: title,
              desired_invariant: 'Fixture duplication is reduced.',
              affected_modules: ['tests/web/fixtures'],
              behavior_preservation: 'Existing route behavior is preserved.',
              validation_strategy: 'Focused Web tests pass.',
            }
          : kind === 'initiative'
            ? {
                type: 'initiative',
                business_outcome: title,
                scope_narrative: 'Coordinate related Web product work.',
                success_metrics: ['Related work is visible'],
              }
            : requirementIntakeContext,
    phase: kind === 'bug' ? 'validation' : 'planning',
    risk: kind === 'bug' ? 'high' : 'medium',
  } as WorkItemCockpitResponse['work_item'];

  return baseCockpitFixture(item, deliveryReadiness(item, [], lane));
};

export const workItemKindCockpitFixtures = {
  requirement: workItemKindFixture(
    'wi-fixture-requirement',
    'requirement',
    'Clarify release readiness requirements',
    'requirements',
  ),
  bug: workItemKindFixture('wi-fixture-bug', 'bug', 'Fix release validation failure', 'bugs'),
  techDebt: workItemKindFixture(
    'wi-fixture-tech-debt',
    'tech_debt',
    'Reduce route fixture duplication',
    'tech-debt',
  ),
  initiative: workItemKindFixture(
    'wi-fixture-initiative',
    'initiative',
    'Launch product lane reporting',
    'initiatives',
  ),
} satisfies Record<string, WorkItemCockpitResponse>;

const initiativeWithoutPackagesWorkItem = {
  ...workItem,
  id: 'wi-initiative-without-packages',
  kind: 'initiative',
  title: 'Launch product lane reporting',
  goal: 'Coordinate child work before execution packages exist.',
  success_criteria: ['Child work is identified', 'Readiness can be aggregated'],
  intake_context: {
    type: 'initiative',
    business_outcome: 'Launch product lane reporting across related child work.',
    scope_narrative: 'Coordinate child work before execution packages exist.',
    success_metrics: ['Child work is identified', 'Readiness can be aggregated'],
  },
  phase: 'planning',
} as WorkItemCockpitResponse['work_item'];

export const initiativeWithoutPackagesCockpitFixture: WorkItemCockpitResponse = {
  work_item: initiativeWithoutPackagesWorkItem,
  current_spec: null,
  current_plan: null,
  packages: [],
  run_sessions: [],
  review_packets: [],
  delivery_readiness: deliveryReadiness(initiativeWithoutPackagesWorkItem, [], 'initiatives', {
    overall_state: 'blocked',
    stages: deliveryStageIds.map((id) => ({
      id,
      label: deliveryStageLabels[id],
      state: id === 'spec' || id === 'plan' ? 'missing' : 'blocked',
      owner_lane: deliveryStageOwnerLanes[id],
      object_refs: [],
      blockers:
        id === 'packages'
          ? [
              {
                id: 'initiative-child-readiness-unavailable',
                label: 'Child-work aggregation unavailable',
                stage_id: 'packages',
                owner_lane: 'initiatives',
                severity: 'blocking',
              },
            ]
          : [],
      evidence_refs: [],
    })),
  }),
};

const managerCommandAction = {
  ...productActionFixtures.commandTargetFollowUp,
  id: 'manager-bad-run-command',
  command: {
    ...productActionFixtures.commandTargetFollowUp.command,
    work_item_id: workItem.id,
  },
} satisfies ProductAction;

export const cockpitFixtureWithManagerCommandAction: WorkItemCockpitResponse = baseCockpitFixture(
  workItem as WorkItemCockpitResponse['work_item'],
  deliveryReadiness(workItem as WorkItemCockpitResponse['work_item'], [managerCommandAction], 'manager'),
);

const degradedExecutionBlocker = {
  id: 'run-sessions-degraded',
  code: 'run_sessions_unavailable',
  label: 'Execution evidence is unavailable because run sessions could not be loaded.',
  stage_id: 'execution',
  owner_lane: 'execution-owner',
  severity: 'blocking',
} satisfies WorkItemDeliveryReadiness['blockers'][number];

export const cockpitFixtureWithDegradedRunSource: WorkItemCockpitResponse = baseCockpitFixture(
  workItem as WorkItemCockpitResponse['work_item'],
  deliveryReadiness(workItem as WorkItemCockpitResponse['work_item'], [], 'execution-owner', {
    overall_state: 'blocked',
    degraded_sources: ['run_sessions'],
    blockers: [degradedExecutionBlocker],
    stages: deliveryStageIds.map((id) => ({
      id,
      label: deliveryStageLabels[id],
      state: id === 'execution' ? 'blocked' : id === 'release_readiness' ? 'blocked' : 'ready',
      owner_lane: deliveryStageOwnerLanes[id],
      object_refs: [],
      blockers: id === 'execution' ? [degradedExecutionBlocker] : [],
      evidence_refs: [],
    })),
  }),
);

const workItemLaneItem = (
  laneId: Extract<ProductLaneId, 'requirements' | 'bugs' | 'tech-debt' | 'initiatives'>,
  id: string,
  kind: 'requirement' | 'bug' | 'tech_debt' | 'initiative',
  title: string,
): ProductLaneItem => ({
  id,
  title,
  object: { type: 'work_item', id },
  kind,
  phase: kind === 'bug' ? 'validation' : 'planning',
  status: 'active',
  gate_state: 'open',
  resolution: 'unresolved',
  risk: kind === 'bug' ? 'high' : 'medium',
  driver_actor_id: workItem.driver_actor_id,
  updated_at: fixtureUpdatedAt,
  actions: [
    {
      ...productActionFixtures.navigate,
      id: `open-${id}`,
      lane_id: laneId,
      target: {
        kind: 'object',
        object_type: 'work_item',
        object_id: id,
        href: `/work-items/${id}`,
      },
    },
  ],
});

export const workItemKindLaneItems = [
  workItemLaneItem('requirements', 'wi-fixture-requirement', 'requirement', 'Clarify release readiness requirements'),
  workItemLaneItem('bugs', 'wi-fixture-bug', 'bug', 'Fix release validation failure'),
  workItemLaneItem('tech-debt', 'wi-fixture-tech-debt', 'tech_debt', 'Reduce route fixture duplication'),
  workItemLaneItem('initiatives', 'wi-fixture-initiative', 'initiative', 'Launch product lane reporting'),
] satisfies ProductLaneItem[];

export const functionalLaneItems = [
  {
    id: 'spec-approval-fixture',
    title: 'Approve Product Lane spec',
    object: { type: 'spec', id: spec.id },
    parent: { type: 'work_item', id: workItem.id, title: workItem.title },
    status: spec.status,
    gate_state: spec.gate_state,
    resolution: spec.resolution,
    updated_at: spec.updated_at,
    actions: [productActionFixtures.command],
  },
  {
    id: 'execution-owner-fixture',
    title: executionPackage.objective,
    object: { type: 'execution_package', id: executionPackage.id },
    parent: { type: 'work_item', id: workItem.id, title: workItem.title },
    phase: executionPackage.phase,
    status: executionPackage.activity_state,
    gate_state: executionPackage.gate_state,
    resolution: executionPackage.resolution,
    risk: workItem.risk,
    updated_at: executionPackage.updated_at,
    actions: [productActionFixtures.commandTargetFollowUp, productActionFixtures.disabled],
  },
  {
    id: 'reviewer-fixture',
    title: reviewPacket.summary,
    object: { type: 'review_packet', id: reviewPacket.id },
    parent: { type: 'execution_package', id: executionPackage.id, title: executionPackage.objective },
    status: reviewPacket.status,
    updated_at: reviewPacket.updated_at,
    actions: [
      {
        ...productActionFixtures.navigate,
        id: 'open-review-packet',
        lane_id: 'reviewer',
        label: 'Open review packet',
        target: {
          kind: 'object',
          object_type: 'review_packet',
          object_id: reviewPacket.id,
          href: `/reviews/${reviewPacket.id}`,
        },
      },
    ],
  },
  {
    id: 'qa-owner-fixture',
    title: 'Acknowledge QA acceptance',
    object: { type: 'execution_package', id: executionPackage.id },
    parent: { type: 'work_item', id: workItem.id, title: workItem.title },
    phase: 'test_acceptance',
    status: 'active',
    gate_state: 'open',
    resolution: 'unresolved',
    risk: 'medium',
    updated_at: fixtureUpdatedAt,
    actions: [
      {
        ...productActionFixtures.navigate,
        id: 'open-qa-package',
        lane_id: 'qa-test-owner',
        label: 'Open QA package',
        target: {
          kind: 'object',
          object_type: 'execution_package',
          object_id: executionPackage.id,
          href: `/packages/${executionPackage.id}`,
        },
      },
    ],
  },
  {
    id: 'release-owner-fixture',
    title: release.title,
    object: { type: 'release', id: release.id },
    status: release.activity_state,
    gate_state: release.gate_state,
    resolution: release.resolution,
    risk: 'medium',
    updated_at: release.updated_at,
    actions: [productActionFixtures.blocked],
  },
  {
    id: 'manager-summary-fixture',
    title: 'Delivery health summary',
    object: { type: 'lane_summary', id: 'manager-summary-fixture', lane_id: 'manager' },
    status: 'active',
    risk: 'medium',
    updated_at: fixtureUpdatedAt,
    actions: [productActionFixtures.targetLane],
  },
] satisfies ProductLaneItem[];

export const productLaneFixtureItemsByLane = {
  requirements: [workItemKindLaneItems[0]],
  bugs: [workItemKindLaneItems[1]],
  'tech-debt': [workItemKindLaneItems[2]],
  initiatives: [workItemKindLaneItems[3]],
  'spec-approver': [functionalLaneItems[0]],
  'execution-owner': [functionalLaneItems[1]],
  reviewer: [functionalLaneItems[2]],
  'qa-test-owner': [functionalLaneItems[3]],
  'release-owner': [functionalLaneItems[4]],
  manager: [functionalLaneItems[5]],
} satisfies Record<ProductLaneId, ProductLaneItem[]>;
