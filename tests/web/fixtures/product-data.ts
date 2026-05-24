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
  scope_ref: { type: 'requirement', id: workItem.id, title: workItem.title },
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
  background: 'The fourth delivery slice establishes shared clients, query keys, and contexts.',
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
  scope_ref: { type: 'requirement', id: workItem.id, title: workItem.title },
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

export const developmentPlanItem = {
  id: 'development-plan-item-web-product',
  development_plan_id: 'development-plan-web-product',
  revision_id: 'development-plan-item-revision-web-product',
  title: 'Build AI-native project management API clients',
  summary: 'Replace legacy execution route clients with Development Plan Item scoped product clients.',
  driver_actor_id: actorId,
  responsible_role: 'developer',
  reviewer_actor_id: 'actor-reviewer',
  risk: 'medium',
  dependency_hints: ['Development Plan contracts are available'],
  affected_surfaces: ['apps/web/src/shared/api', 'tests/web/fixtures'],
  boundary_status: 'approved',
  spec_status: 'approved',
  execution_plan_status: 'approved',
  execution_status: 'running',
  review_status: 'in_review',
  qa_handoff_status: 'pending',
  release_impact: 'release_scoped',
  next_action: 'Supervise execution and prepare review handoff.',
  updated_at: '2026-05-18T00:19:00.000Z',
} as const;

export const developmentPlan = {
  id: developmentPlanItem.development_plan_id,
  revision_id: 'development-plan-revision-web-product',
  title: 'Web product UI architecture foundation plan',
  status: 'active',
  source_refs: [{ type: 'requirement', id: 'req-1', title: 'Checkout requirement' }],
  items: [developmentPlanItem],
  created_at: '2026-05-18T00:11:00.000Z',
  updated_at: '2026-05-18T00:19:00.000Z',
} as const;

export const brainstormingSession = {
  id: 'brainstorming-session-web-product',
  revision_id: 'brainstorming-session-revision-web-product',
  source_ref: { type: 'requirement', id: 'req-1', title: 'Checkout requirement' },
  development_plan_id: developmentPlan.id,
  development_plan_item_id: developmentPlanItem.id,
  development_plan_item_revision_id: developmentPlanItem.revision_id,
  context_manifest_id: 'context-manifest-web-product',
  context_manifest_revision_id: 'context-manifest-revision-web-product',
  questions: [
    {
      id: 'brainstorming-question-web-product',
      text: 'Which legacy product routes must be removed?',
      author_id: 'actor-tech-lead',
      created_at: '2026-05-18T00:14:00.000Z',
      status: 'answered',
    },
  ],
  answers: [
    {
      id: 'brainstorming-answer-web-product',
      question_id: 'brainstorming-question-web-product',
      text: 'Remove public direct-work, direct Spec, and direct Plan routes from the product shell.',
      actor_id: actorId,
      created_at: '2026-05-18T00:15:00.000Z',
    },
  ],
  decisions: [
    {
      id: 'brainstorming-decision-web-product',
      text: 'Development Plan Item is the product execution boundary.',
      actor_id: 'actor-tech-lead',
      rationale: 'The product flow requires boundary brainstorming before spec and execution plan generation.',
      created_at: '2026-05-18T00:16:00.000Z',
    },
  ],
  approval_state: 'approved',
  boundary_summary_id: 'boundary-summary-web-product',
  approver_actor_id: 'actor-tech-lead',
  approved_at: '2026-05-18T00:17:00.000Z',
} as const;

export const boundarySummary = {
  id: brainstormingSession.boundary_summary_id,
  revision_id: 'boundary-summary-revision-web-product',
  brainstorming_session_id: brainstormingSession.id,
  brainstorming_session_revision_id: brainstormingSession.revision_id,
  development_plan_id: developmentPlan.id,
  development_plan_item_id: developmentPlanItem.id,
  development_plan_item_revision_id: developmentPlanItem.revision_id,
  source_ref: brainstormingSession.source_ref,
  summary: 'Replace public legacy direct-work and direct Spec/Plan product surfaces with item-scoped AI-native clients.',
  summary_markdown: 'Replace public legacy direct-work and direct Spec/Plan product surfaces with item-scoped AI-native clients.',
  approved_by_actor_id: brainstormingSession.approver_actor_id,
  approved_at: brainstormingSession.approved_at,
} as const;

export const executionPlan = {
  id: 'execution-plan-web-product',
  development_plan_item_id: developmentPlanItem.id,
  status: 'approved',
  current_revision_id: 'execution-plan-revision-web-product',
  approved_revision_id: 'execution-plan-revision-web-product',
  approved_by_actor_id: 'actor-tech-lead',
  approved_at: '2026-05-18T00:18:00.000Z',
  created_at: '2026-05-18T00:17:30.000Z',
  updated_at: '2026-05-18T00:18:00.000Z',
} as const;

export const executionPlanRevision = {
  id: executionPlan.approved_revision_id,
  execution_plan_id: executionPlan.id,
  development_plan_item_id: developmentPlanItem.id,
  based_on_spec_revision_id: specRevision.id,
  revision_number: 1,
  summary: 'Implement AI-native Web API clients and fixtures.',
  content: 'Add client methods, hooks, query keys, and deterministic AI-native route fixtures.',
  created_at: '2026-05-18T00:17:40.000Z',
} as const;

export const execution = {
  id: 'execution-web-product',
  development_plan_item_id: developmentPlanItem.id,
  execution_plan_revision_id: executionPlanRevision.id,
  ref: { type: 'execution', id: 'execution-web-product', title: 'Execute AI-native Web API client work' },
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: developmentPlanItem.id,
    development_plan_id: developmentPlan.id,
    title: developmentPlanItem.title,
  },
  execution_plan_revision_ref: {
    type: 'execution_plan_revision',
    id: executionPlanRevision.id,
    execution_plan_id: executionPlan.id,
    title: executionPlanRevision.summary,
  },
  status: 'running',
  worker_state: 'running',
  current_step: 'Applying approved Execution Plan',
  source_ref: developmentPlan.source_refs[0],
  evidence_refs: [{ type: 'execution', id: 'execution-web-product', title: 'Execution transcript summary' }],
  runtime_evidence_refs: [{ type: 'execution_package', id: 'package-web-product', title: 'Add route-backed product API foundation' }],
  pr_refs: [{ id: 'pr-web-product', title: 'AI-native Web API clients PR' }],
  diff_refs: [{ id: 'diff-web-product', title: 'Web client diff' }],
  test_evidence_refs: [{ id: 'test-web-product', title: 'Focused route tests' }],
  interrupt_history: [{ at: '2026-05-18T00:21:00.000Z', reason: 'Paused for review checkpoint' }],
  continuation_history: [{ at: '2026-05-18T00:22:00.000Z', summary: 'Continued after checkpoint' }],
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
} as const;

export const codeReviewHandoff = {
  id: 'code-review-handoff-web-product',
  ref: { type: 'code_review_handoff', id: 'code-review-handoff-web-product', title: 'Review AI-native Web API clients' },
  execution_id: execution.id,
  development_plan_item_id: developmentPlanItem.id,
  execution_plan_revision_id: executionPlanRevision.id,
  reviewer_actor_id: 'actor-reviewer',
  status: 'in_review',
  summary: 'Review Web client and fixture migration away from public direct-work routes.',
  changed_surfaces: ['apps/web/src/shared/api', 'tests/web/fixtures'],
  verification_evidence_refs: [{ type: 'execution', id: execution.id, title: execution.ref.title }],
  comments: ['Review API client route coverage.'],
  changes_requested: [],
  created_at: '2026-05-18T00:28:00.000Z',
  updated_at: '2026-05-18T00:30:00.000Z',
} as const;

export const qaHandoff = {
  id: 'qa-handoff-web-product',
  ref: { type: 'qa_handoff', id: 'qa-handoff-web-product', title: 'QA AI-native Web API clients' },
  code_review_handoff_id: codeReviewHandoff.id,
  execution_id: execution.id,
  source_ref: { type: 'requirement', id: 'req-1', title: 'Checkout requirement' },
  development_plan_item_id: developmentPlanItem.id,
  development_plan_item_ref: execution.development_plan_item_ref,
  approved_spec_revision_ref: { type: 'spec_revision', id: specRevision.id, spec_id: spec.id, title: specRevision.summary },
  approved_execution_plan_revision_ref: execution.execution_plan_revision_ref,
  status: 'pending',
  acceptance_criteria: ['Client methods target Development Plan Item scoped endpoints'],
  test_strategy: 'Run Web client contract and route smoke tests.',
  verification_evidence_refs: [{ type: 'execution', id: execution.id, title: execution.ref.title }],
  known_risks: [],
  changed_surfaces: codeReviewHandoff.changed_surfaces,
  release_impact: developmentPlanItem.release_impact,
  created_at: '2026-05-18T00:31:00.000Z',
  updated_at: '2026-05-18T00:31:00.000Z',
} as const;

export const executionPackage = {
  id: 'package-web-product',
  task_id: 'task-1',
  work_item_id: workItem.id,
  scope_ref: { type: 'requirement', id: workItem.id, title: workItem.title },
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

const scopeRefForItem = (item: Pick<WorkItemCockpitResponse['item'], 'id' | 'kind' | 'title'>) => ({
  type: item.kind,
  id: item.id,
  title: item.title,
});

export const cockpitSpecFor = (item: Pick<WorkItemCockpitResponse['item'], 'id' | 'kind' | 'title'>) => {
  const { work_item_id: _workItemId, ...publicSpec } = spec;
  return { ...publicSpec, scope_ref: scopeRefForItem(item) };
};

export const cockpitPlanFor = (item: Pick<WorkItemCockpitResponse['item'], 'id' | 'kind' | 'title'>) => {
  const { work_item_id: _workItemId, ...publicPlan } = plan;
  return { ...publicPlan, scope_ref: scopeRefForItem(item) };
};

export const cockpitPackageFor = (item: Pick<WorkItemCockpitResponse['item'], 'id' | 'kind' | 'title'>) => {
  const { task_id: _taskId, work_item_id: _workItemId, ...publicPackage } = executionPackage;
  return { ...publicPackage, scope_ref: scopeRefForItem(item) };
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
    object_type: 'requirement',
    object_id: workItem.id,
    summary: 'Created shared product API foundation requirement.',
    created_at: workItem.created_at,
    payload: { project_id: projectId },
  },
];

export const requirementListItem = {
  id: 'req-1',
  ref: { type: 'requirement', id: 'req-1' },
  title: 'Checkout requirement',
  status: 'planning/active/open',
  priority: 'P1',
  risk: 'medium',
  driver_actor_id: actorId,
  phase: 'planning',
  updated_at: '2026-05-18T01:00:00.000Z',
} as const;

export const requirementDetail = {
  id: requirementListItem.id,
  ref: requirementListItem.ref,
  title: requirementListItem.title,
  status: requirementListItem.status,
  priority: requirementListItem.priority,
  risk: requirementListItem.risk,
  driver_actor_id: requirementListItem.driver_actor_id,
  updated_at: requirementListItem.updated_at,
  narrative_markdown: 'Checkout validation must block bad payment states before submission.',
  evidence_refs: [],
  attachment_refs: [],
  relationship_refs: [
    { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
  bug_refs: [{ type: 'bug', id: 'bug-1' }],
  release_refs: [{ type: 'release', id: release.id }],
} as const;

export const initiativeListItem = {
  id: 'init-1',
  ref: { type: 'initiative', id: 'init-1' },
  title: 'Checkout reliability initiative',
  status: 'planning/active/open',
  priority: 'P1',
  risk: 'medium',
  driver_actor_id: actorId,
  business_outcome: 'Coordinate checkout reliability.',
  updated_at: '2026-05-18T01:01:00.000Z',
} as const;

export const initiativeDetail = {
  id: initiativeListItem.id,
  ref: initiativeListItem.ref,
  title: initiativeListItem.title,
  status: initiativeListItem.status,
  priority: initiativeListItem.priority,
  risk: initiativeListItem.risk,
  driver_actor_id: initiativeListItem.driver_actor_id,
  updated_at: initiativeListItem.updated_at,
  narrative_markdown: 'Coordinate checkout reliability across requirements, bugs, and task execution.',
  evidence_refs: [],
  attachment_refs: [],
  child_refs: [{ type: 'requirement', id: 'req-1' }],
  relationship_refs: [],
  milestone_intent: 'Checkout validation readiness',
  release_refs: [{ type: 'release', id: release.id }],
} as const;

export const techDebtListItem = {
  id: 'td-1',
  ref: { type: 'tech_debt', id: 'td-1' },
  title: 'Checkout validation debt',
  status: 'planning/active/open',
  priority: 'P2',
  risk: 'medium',
  driver_actor_id: actorId,
  affected_modules: ['apps/web/src/features/checkout'],
  updated_at: '2026-05-18T01:02:00.000Z',
} as const;

export const techDebtDetail = {
  ...techDebtListItem,
  narrative_markdown: 'Validation logic is duplicated between form state and command guards.',
  evidence_refs: [],
  attachment_refs: [],
  validation_strategy: 'Focused route tests and API command tests.',
  relationship_refs: [
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
} as const;

export const bugListItem = {
  id: 'bug-1',
  ref: { type: 'bug', id: 'bug-1' },
  title: 'Checkout regression',
  status: 'validation/active/open',
  priority: 'P0',
  risk: 'high',
  driver_actor_id: actorId,
  severity: 'high',
  updated_at: '2026-05-18T01:04:00.000Z',
} as const;

export const bugDetail = {
  id: bugListItem.id,
  ref: bugListItem.ref,
  title: bugListItem.title,
  status: bugListItem.status,
  priority: bugListItem.priority,
  risk: bugListItem.risk,
  driver_actor_id: bugListItem.driver_actor_id,
  updated_at: bugListItem.updated_at,
  narrative_markdown: 'Regression notes stay in Markdown while reproduction data remains structured.',
  evidence_refs: [],
  attachment_refs: [],
  observed_behavior: 'Checkout accepts invalid cards.',
  expected_behavior: 'Checkout blocks invalid cards.',
  reproduction_steps: ['Open checkout', 'Submit an invalid card'],
  relationship_refs: [
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
} as const;

export const boardCards = [
  {
    id: 'board:req-1',
    object_ref: { type: 'requirement', id: 'req-1', title: requirementListItem.title },
    title: requirementListItem.title,
    column_id: 'planning',
    status: requirementListItem.status,
    priority: requirementListItem.priority,
    risk: requirementListItem.risk,
    driver_actor_id: requirementListItem.driver_actor_id,
    blocked: false,
    href: '/requirements/req-1',
  },
  {
    id: 'board:init-1',
    object_ref: { type: 'initiative', id: 'init-1', title: initiativeListItem.title },
    title: initiativeListItem.title,
    column_id: 'planning',
    status: initiativeListItem.status,
    priority: initiativeListItem.priority,
    risk: initiativeListItem.risk,
    driver_actor_id: initiativeListItem.driver_actor_id,
    blocked: false,
    href: '/initiatives/init-1',
  },
  {
    id: 'board:td-1',
    object_ref: { type: 'tech_debt', id: 'td-1', title: techDebtListItem.title },
    title: techDebtListItem.title,
    column_id: 'planning',
    status: techDebtListItem.status,
    priority: techDebtListItem.priority,
    risk: techDebtListItem.risk,
    driver_actor_id: techDebtListItem.driver_actor_id,
    blocked: false,
    href: '/tech-debt/td-1',
  },
  {
    id: `board:${developmentPlanItem.id}`,
    object_ref: {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
    title: developmentPlanItem.title,
    column_id: 'ready',
    status: developmentPlanItem.execution_status,
    risk: developmentPlanItem.risk,
    driver_actor_id: developmentPlanItem.driver_actor_id,
    blocked: false,
    href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
  },
  {
    id: 'board:bug-1',
    object_ref: { type: 'bug', id: 'bug-1', title: bugListItem.title },
    title: bugListItem.title,
    column_id: 'validation',
    status: bugListItem.status,
    priority: bugListItem.priority,
    risk: bugListItem.risk,
    driver_actor_id: bugListItem.driver_actor_id,
    blocked: true,
    href: '/bugs/bug-1',
  },
  {
    id: `board:${execution.id}`,
    object_ref: execution.ref,
    title: execution.ref.title,
    column_id: 'active',
    status: execution.status,
    blocked: false,
    href: `/executions/${execution.id}`,
  },
  {
    id: 'board:release-web-product',
    object_ref: { type: 'release', id: release.id, title: release.title },
    title: release.title,
    column_id: 'release',
    status: release.phase,
    risk: 'medium',
    blocked: false,
    href: `/releases/${release.id}`,
  },
] as const;

export const releaseReadinessDetail = {
  release_id: release.id,
  scope_refs: [
    { type: 'initiative', id: initiativeListItem.id, title: initiativeListItem.title },
    { type: 'requirement', id: requirementListItem.id, title: requirementListItem.title },
    { type: 'tech_debt', id: techDebtListItem.id, title: techDebtListItem.title },
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
    { type: 'bug', id: bugListItem.id, title: bugListItem.title },
  ],
  required_review_evidence: [
    {
      requirement_id: `review:${developmentPlanItem.id}`,
      scope_ref: {
        type: 'development_plan_item',
        id: developmentPlanItem.id,
        development_plan_id: developmentPlan.id,
        title: developmentPlanItem.title,
      },
      kind: 'review',
      status: 'passed',
      current_spec_revision_id: specRevision.id,
      evidence_spec_revision_id: specRevision.id,
      current_plan_revision_id: planRevision.id,
      evidence_plan_revision_id: planRevision.id,
      evidence_ref: {
        id: 'review-evidence-1',
        authority_type: 'code_review_handoff_approval',
        authority_ref: { type: 'code_review_handoff', id: reviewPacket.id },
        scope_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        status: 'approved',
        required: true,
        code_review_handoff_id: reviewPacket.id,
        execution_id: execution.id,
        spec_revision_id: specRevision.id,
        plan_revision_id: planRevision.id,
        attachment_refs: [],
      },
    },
  ],
  required_test_acceptance_evidence: [
    {
      requirement_id: 'qa:bug-1',
      scope_ref: { type: 'bug', id: bugListItem.id, title: bugListItem.title },
      kind: 'qa_acceptance',
      status: 'missing',
      disabled_reason: {
        code: 'missing_required_test_acceptance',
        message: 'QA acceptance is required before release.',
        target_ref: { type: 'bug', id: bugListItem.id, title: bugListItem.title },
      },
    },
  ],
  package_run_evidence: [
    {
      requirement_id: `package-run:${developmentPlanItem.id}`,
      scope_ref: {
        type: 'development_plan_item',
        id: developmentPlanItem.id,
        development_plan_id: developmentPlan.id,
        title: developmentPlanItem.title,
      },
      kind: 'package_run',
      status: 'passed',
      current_spec_revision_id: specRevision.id,
      evidence_spec_revision_id: specRevision.id,
      current_plan_revision_id: planRevision.id,
      evidence_plan_revision_id: planRevision.id,
      evidence_ref: {
        id: 'package-run-evidence-1',
        scope_ref: {
          type: 'development_plan_item',
          id: developmentPlanItem.id,
          development_plan_id: developmentPlan.id,
          title: developmentPlanItem.title,
        },
        evidence_type: 'package_run',
        status: 'passed',
        required: true,
        execution_ref: { type: 'execution', id: execution.id, title: execution.title },
      },
    },
  ],
  observation_evidence: [
    {
      requirement_id: 'observation:release-web-product',
      scope_ref: { type: 'release', id: release.id, title: release.title },
      kind: 'observation',
      status: 'missing',
      disabled_reason: {
        code: 'missing_observation_evidence',
        message: 'Observation evidence is required before closure.',
        target_ref: { type: 'release', id: release.id, title: release.title },
      },
    },
  ],
  ready: false,
  disabled_reasons: [
    {
      code: 'missing_required_test_acceptance',
      message: 'QA acceptance is required before release.',
      target_ref: { type: 'bug', id: bugListItem.id, title: bugListItem.title },
    },
  ],
} as const;

export const requirementListResponse = { items: [requirementListItem], degraded_sources: [] } as const;
export const initiativeListResponse = { items: [initiativeListItem], degraded_sources: [] } as const;
export const techDebtListResponse = { items: [techDebtListItem], degraded_sources: [] } as const;
export const bugListResponse = { items: [bugListItem], degraded_sources: [] } as const;

export const myWorkQueueResponse = {
  items: [
    {
      id: 'product:req-1',
      object_ref: { type: 'requirement', id: 'req-1' },
      title: 'Checkout requirement',
      attention_reason: 'product_attention',
      expected_action: 'Clarify acceptance criteria',
      actor_id: actorId,
      href: '/requirements/req-1',
    },
    {
      id: 'tech-lead:init-1',
      object_ref: { type: 'initiative', id: 'init-1' },
      title: 'Checkout reliability initiative',
      attention_reason: 'tech_lead_attention',
      expected_action: 'Review technical breakdown',
      actor_id: actorId,
      href: '/initiatives/init-1',
    },
    {
      id: `developer:${developmentPlanItem.id}`,
      object_ref: {
        type: 'development_plan_item',
        id: developmentPlanItem.id,
        development_plan_id: developmentPlan.id,
      },
      title: developmentPlanItem.title,
      attention_reason: 'needs_boundary_approval',
      expected_action: 'Open Development Plan Item',
      actor_id: actorId,
      href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    },
    {
      id: 'qa:bug-1',
      object_ref: { type: 'bug', id: 'bug-1' },
      title: 'Checkout regression',
      attention_reason: 'qa_attention',
      expected_action: 'Verify reproduction',
      actor_id: actorId,
      href: '/bugs/bug-1',
    },
    {
      id: 'release-owner:release-web-product',
      object_ref: { type: 'release', id: release.id },
      title: 'Release readiness decision',
      attention_reason: 'release_owner_attention',
      expected_action: 'Review rollout blockers',
      actor_id: 'actor-release-owner',
      href: `/releases/${release.id}`,
    },
    {
      id: 'manager:td-1',
      object_ref: { type: 'tech_debt', id: 'td-1' },
      title: 'Checkout validation debt',
      attention_reason: 'manager_attention',
      expected_action: 'Review delivery risk',
      actor_id: actorId,
      href: '/tech-debt/td-1',
    },
  ],
  degraded_sources: [],
} as const;

const fixtureUpdatedAt = '2026-05-18T00:40:00.000Z';

export const productActionFixtures = {
  navigate: {
    id: 'open-fixture-work-item',
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
  command: {
    id: 'package-fixture-plan-revision',
    lane_id: 'spec-approver',
    priority: 'secondary',
    label: 'Generate packages',
    enabled: true,
    kind: 'command',
    command: {
      type: 'generate_packages',
      object_type: 'plan_revision',
      object_id: planRevision.id,
      scope_ref: { type: 'requirement', id: workItem.id },
      plan_revision_id: planRevision.id,
    },
    target: {
      kind: 'object',
      object_type: 'plan_revision',
      object_id: planRevision.id,
      href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
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
      scope_ref: { type: 'requirement', id: workItem.id },
      package_id: executionPackage.id,
      expected_package_version: executionPackage.version,
    },
    target: {
      kind: 'object',
      object_type: 'execution',
      object_id: execution.id,
      href: `/executions/${execution.id}`,
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
      kind: 'route',
      href: `/board?lane=reviewer&project_id=${projectId}`,
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
      scope_ref: { type: 'requirement', id: workItem.id },
      package_id: executionPackage.id,
    },
    target: {
      kind: 'object',
      object_type: 'execution',
      object_id: execution.id,
      href: `/executions/${execution.id}`,
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
  item: Pick<WorkItemCockpitResponse['item'], 'id' | 'kind' | 'title'>,
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
    scope_ref: scopeRefForItem(item),
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
  item: WorkItemCockpitResponse['item'],
  readiness: WorkItemDeliveryReadiness,
): WorkItemCockpitResponse => ({
  item,
  current_spec: cockpitSpecFor(item),
  current_plan: cockpitPlanFor(item),
  packages: [cockpitPackageFor(item)],
  run_sessions: [runSession],
  review_packets: [reviewPacket],
  delivery_readiness: readiness,
});

const workItemKindFixture = (
  id: string,
  kind: WorkItemCockpitResponse['item']['kind'],
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
  } as WorkItemCockpitResponse['item'];

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
} as WorkItemCockpitResponse['item'];

export const initiativeWithoutPackagesCockpitFixture: WorkItemCockpitResponse = {
  item: initiativeWithoutPackagesWorkItem,
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
    scope_ref: { type: 'requirement', id: workItem.id },
  },
} satisfies ProductAction;

export const cockpitFixtureWithManagerCommandAction: WorkItemCockpitResponse = baseCockpitFixture(
  workItem as WorkItemCockpitResponse['item'],
  deliveryReadiness(workItem as WorkItemCockpitResponse['item'], [managerCommandAction], 'manager'),
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
  workItem as WorkItemCockpitResponse['item'],
  deliveryReadiness(workItem as WorkItemCockpitResponse['item'], [], 'execution-owner', {
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

const workItemProductHref = (id: string, kind: 'requirement' | 'bug' | 'tech_debt' | 'initiative'): string => {
  switch (kind) {
    case 'requirement':
      return `/requirements/${id}`;
    case 'bug':
      return `/bugs/${id}`;
    case 'tech_debt':
      return `/tech-debt/${id}`;
    case 'initiative':
      return `/initiatives/${id}`;
  }
};

const workItemLaneItem = (
  laneId: Extract<ProductLaneId, 'requirements' | 'bugs' | 'tech-debt' | 'initiatives'>,
  id: string,
  kind: 'requirement' | 'bug' | 'tech_debt' | 'initiative',
  title: string,
): ProductLaneItem => ({
  id,
  title,
  object: { type: kind, id },
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
        object_type: kind,
        object_id: id,
        href: workItemProductHref(id, kind),
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
    parent: { type: 'requirement', id: workItem.id, title: workItem.title },
    status: spec.status,
    gate_state: spec.gate_state,
    resolution: spec.resolution,
    updated_at: spec.updated_at,
    actions: [productActionFixtures.command],
  },
  {
    id: 'execution-owner-fixture',
    title: executionPackage.objective,
    object: { type: 'execution', id: execution.id },
    parent: { type: 'requirement', id: workItem.id, title: workItem.title },
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
    object: { type: 'code_review_handoff', id: codeReviewHandoff.id },
    parent: { type: 'execution', id: execution.id, title: executionPackage.objective },
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
          object_type: 'code_review_handoff',
          object_id: codeReviewHandoff.id,
          href: `/executions/${execution.id}`,
        },
      },
    ],
  },
  {
    id: 'qa-owner-fixture',
    title: 'Acknowledge QA acceptance',
    object: { type: 'execution', id: execution.id },
    parent: { type: 'requirement', id: workItem.id, title: workItem.title },
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
          object_type: 'qa_handoff',
          object_id: qaHandoff.id,
          href: `/executions/${execution.id}`,
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
