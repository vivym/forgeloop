import type {
  DeliveryStageId,
  ProductAction,
  ProductLaneId,
  ProductLaneItem,
  WorkItemCockpitResponse,
  WorkItemDeliveryReadiness,
} from '@forgeloop/contracts';

export const productWorkspacePreviewSeedId = 'project-product-workspace-preview';
export const projectId = productWorkspacePreviewSeedId;
export const actorId = 'actor-owner';

export const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Product operators need the workspace to explain what is ready, blocked, and owned without falling back to generic delivery pages.',
  desired_outcome: 'Every planning input route opens with route-backed planning, execution, review, QA, and release context.',
  acceptance_criteria: ['Typed document routes use deterministic fixture data', 'Plan Item gates expose eligible next actions only'],
  in_scope: ['Typed document workspaces', 'Development Plan routes', 'Plan Item gate fixtures'],
} as const;

export const workItem = {
  id: 'req-product-workspace-clarity',
  project_id: projectId,
  kind: 'requirement',
  title: 'Product workspace clarity and route-backed context',
  goal: 'Make the product workspace explain current delivery state from typed planning inputs through release readiness.',
  success_criteria: ['Typed document context is visible', 'Plan Item generation and gate state stay item-scoped'],
  priority: 'critical',
  risk: 'medium',
  driver_actor_id: actorId,
  intake_context: requirementIntakeContext,
  phase: 'triage',
  activity_state: 'active',
  gate_state: 'open',
  resolution: 'unresolved',
  current_spec_id: 'spec-cockpit-command-center',
  current_plan_id: 'plan-requirements-database-view',
  created_at: '2026-05-18T00:00:00.000Z',
  updated_at: '2026-05-18T00:00:00.000Z',
};

export const spec = {
  id: 'spec-cockpit-command-center',
  work_item_id: workItem.id,
  scope_ref: { type: 'requirement', id: workItem.id, title: workItem.title },
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'locked',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'specrev-cockpit-command-center-v1',
  approved_revision_id: 'specrev-cockpit-command-center-v1',
  approved_at: '2026-05-18T00:10:00.000Z',
  approved_by_actor_id: 'actor-reviewer',
  created_at: '2026-05-18T00:05:00.000Z',
  updated_at: '2026-05-18T00:10:00.000Z',
};

export const specRevision = {
  id: 'specrev-cockpit-command-center-v1',
  spec_id: spec.id,
  work_item_id: workItem.id,
  revision_number: 1,
  summary: 'Cockpit operational command center Spec',
  content: 'The Cockpit should act as an operational command center for AI-native project management.',
  background: 'The product workspace rebuild replaces generic route shells with purpose-built surfaces.',
  goals: ['Expose operational state density', 'Keep command paths Plan Item governed'],
  scope_in: ['Cockpit information architecture', 'Review-ready fixture data'],
  scope_out: ['Route shell navigation'],
  acceptance_criteria: ['Query keys are stable', 'Fixtures need no live API'],
  risk_notes: ['Backend actor ids remain internal'],
  test_strategy_summary: 'Vitest covers query keys and lane mapping behavior.',
  created_at: '2026-05-18T00:06:00.000Z',
};

export const plan = {
  id: 'plan-requirements-database-view',
  work_item_id: workItem.id,
  scope_ref: { type: 'requirement', id: workItem.id, title: workItem.title },
  entity_type: 'plan',
  status: 'approved',
  editing_state: 'locked',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'planrev-requirements-database-view-v1',
  approved_revision_id: 'planrev-requirements-database-view-v1',
  approved_at: '2026-05-18T00:18:00.000Z',
  approved_by_actor_id: 'actor-reviewer',
  created_at: '2026-05-18T00:12:00.000Z',
  updated_at: '2026-05-18T00:18:00.000Z',
};

export const planRevision = {
  id: 'planrev-requirements-database-view-v1',
  plan_id: plan.id,
  work_item_id: workItem.id,
  revision_number: 1,
  summary: 'Requirements database view Implementation Plan Doc',
  content: 'Replace the Requirements list with a database view that keeps Plan Item governance visible.',
  implementation_summary: 'Use canonical planning input rows with fixture-backed evidence and generation links.',
  split_strategy: 'Database view task with no cockpit layout migration.',
  dependency_order: ['tests/web/fixtures', 'apps/web/src/features/requirements'],
  test_matrix: ['pnpm vitest run tests/web/api-hooks.test.tsx', 'pnpm --filter @forgeloop/web typecheck'],
  risk_mitigations: ['Keep route fixtures aligned with ProductAction contracts'],
  rollback_notes: 'Revert shared API foundation commit if route tasks need to pause.',
  created_at: '2026-05-18T00:13:00.000Z',
};

const developmentPlanItemBase = {
  development_plan_id: 'dp-product-workspace-core-surface-redesign',
  driver_actor_id: actorId,
  responsible_role: 'developer',
  reviewer_actor_id: 'actor-reviewer',
  risk: 'medium',
  release_impact: 'release_scoped',
  updated_at: '2026-05-18T00:19:00.000Z',
} as const;

export const cockpitCommandCenterItem = {
  ...developmentPlanItemBase,
  id: 'dpi-cockpit-command-center',
  revision_id: 'dpirev-cockpit-command-center-v1',
  title: 'Rebuild Cockpit into operational command center',
  summary: 'Replace generic cockpit composition with operational delivery, review, and risk signals.',
  dependency_hints: ['Cockpit route contract is canonical'],
  affected_surfaces: ['apps/web/src/features/cockpit'],
  boundary_status: 'approved',
  spec_status: 'in_review',
  implementation_plan_status: 'missing',
  execution_status: 'not_started',
  review_status: 'changes_requested',
  qa_handoff_status: 'missing',
  next_action: 'Resolve Spec review comments on Cockpit layout density.',
} as const;

export const requirementsDatabaseViewItem = {
  ...developmentPlanItemBase,
  id: 'dpi-requirements-database-view',
  revision_id: 'dpirev-requirements-database-view-v1',
  title: 'Replace Requirements list with database view',
  summary: 'Turn Requirements into a document-workspace database with generation and evidence affordances.',
  dependency_hints: ['Plan Item governed generation flow must stay visible'],
  affected_surfaces: ['apps/web/src/features/requirements'],
  boundary_status: 'approved',
  spec_status: 'approved',
  implementation_plan_status: 'approved',
  execution_status: 'ready',
  review_status: 'missing',
  qa_handoff_status: 'pending',
  next_action: 'Use the approved Implementation Plan Doc to start database view implementation.',
} as const;

export const productWorkspacePreviewItem = {
  ...developmentPlanItemBase,
  id: 'dpi-product-workspace-preview-state',
  revision_id: 'dpirev-product-workspace-preview-state-v1',
  title: 'Seed product workspace state for visual review',
  summary: 'Seed deterministic product workspace data for visual route review.',
  dependency_hints: ['Task 1 route contracts are committed'],
  affected_surfaces: ['tests/web/fixtures', 'tests/e2e/helpers'],
  boundary_status: 'approved',
  spec_status: 'approved',
  implementation_plan_status: 'approved',
  execution_status: 'running',
  review_status: 'in_review',
  qa_handoff_status: 'pending',
  next_action: 'Resume the execution with seeded product workspace data.',
} as const;

export const developmentPlanTableInspectorItem = {
  ...developmentPlanItemBase,
  id: 'dpi-development-plan-table-inspector',
  revision_id: 'dpirev-development-plan-table-inspector-v1',
  title: 'Rewrite Development Plan table and inspector',
  summary: 'Replace the generic table detail with a dense plan table and inspector workflow.',
  dependency_hints: ['Preview workspace data must include blocked boundary state'],
  affected_surfaces: ['apps/web/src/features/development-plans'],
  boundary_status: 'changes_requested',
  spec_status: 'blocked',
  implementation_plan_status: 'blocked',
  execution_status: 'not_started',
  review_status: 'missing',
  qa_handoff_status: 'missing',
  next_action: 'Unblock the Plan Item boundary before authoring documents.',
} as const;

export const developmentPlanItemsById = {
  'dpi-cockpit-command-center': cockpitCommandCenterItem,
  'dpi-requirements-database-view': requirementsDatabaseViewItem,
  'dpi-product-workspace-preview-state': productWorkspacePreviewItem,
  'dpi-development-plan-table-inspector': developmentPlanTableInspectorItem,
} as const;

export const developmentPlanItem = productWorkspacePreviewItem;

export const developmentPlan = {
  id: developmentPlanItem.development_plan_id,
  revision_id: 'dprev-product-workspace-core-surface-redesign-v1',
  title: 'Product workspace core surface redesign',
  status: 'active',
  source_refs: [{ type: 'requirement', id: workItem.id, title: workItem.title }],
  items: Object.values(developmentPlanItemsById),
  created_at: '2026-05-18T00:11:00.000Z',
  updated_at: '2026-05-18T00:19:00.000Z',
} as const;

export const additionalDevelopmentPlanItems = [
  {
    ...developmentPlanItemBase,
    id: 'dpi-typed-document-boundary',
    revision_id: 'dpirev-typed-document-boundary-v1',
    title: 'Define typed document workspace boundaries',
    summary: 'Lock Requirement, Initiative, Bug, and Tech Debt routes to typed document workspaces.',
    dependency_hints: ['Typed document projections are expanded'],
    affected_surfaces: ['apps/web/src/features/project-management'],
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'approved',
    execution_status: 'completed',
    review_status: 'approved',
    qa_handoff_status: 'accepted',
    next_action: 'Keep source workspace routes aligned with canonical route contract.',
  },
  {
    ...developmentPlanItemBase,
    id: 'dpi-plan-item-gate-eligibility',
    revision_id: 'dpirev-plan-item-gate-eligibility-v1',
    title: 'Enforce Plan Item action eligibility',
    summary: 'Disable execution until boundary, Spec, Implementation Plan Doc, QA, and package evidence are present.',
    dependency_hints: ['Bug reproduction is linked'],
    affected_surfaces: ['apps/web/src/features/development-plans/plan-item-gates.tsx'],
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'in_review',
    execution_status: 'blocked',
    review_status: 'changes_requested',
    qa_handoff_status: 'blocked',
    next_action: 'Resolve action eligibility review changes before execution.',
  },
  {
    ...developmentPlanItemBase,
    id: 'dpi-qa-shift-left-strategy',
    revision_id: 'dpirev-qa-shift-left-strategy-v1',
    title: 'Expose QA strategy before Implementation Plan Doc authoring',
    summary: 'Make QA owner participation visible before release-impacting execution starts.',
    dependency_hints: ['Release-impacting Plan Items require QA strategy'],
    affected_surfaces: ['apps/web/src/features/qa'],
    boundary_status: 'approved',
    spec_status: 'in_review',
    implementation_plan_status: 'missing',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'pending',
    next_action: 'Review Spec test strategy with QA owner.',
  },
  {
    ...developmentPlanItemBase,
    development_plan_id: 'dp-release-risk-closure',
    id: 'dpi-release-blocker-closure',
    revision_id: 'dpirev-release-blocker-closure-v1',
    title: 'Close release blocker evidence',
    summary: 'Collect QA and observation evidence required for release readiness.',
    dependency_hints: ['Release readiness remains disabled while QA is blocked'],
    affected_surfaces: ['apps/web/src/features/releases'],
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'approved',
    execution_status: 'interrupted',
    review_status: 'approved',
    qa_handoff_status: 'blocked',
    next_action: 'Resume interrupted execution after QA owner resolves blocker.',
  },
] as const;

export const releaseRiskClosureDevelopmentPlan = {
  id: 'dp-release-risk-closure',
  revision_id: 'dprev-release-risk-closure-v1',
  title: 'Release risk closure',
  status: 'active',
  source_refs: [{ type: 'requirement', id: 'req-release-readiness', title: 'Release readiness blocks on missing evidence' }],
  items: [additionalDevelopmentPlanItems[3]],
  created_at: '2026-05-18T00:34:00.000Z',
  updated_at: '2026-05-18T00:39:00.000Z',
} as const;

export const productWorkspaceDevelopmentPlanItems = [
  ...developmentPlan.items,
  ...additionalDevelopmentPlanItems,
] as const;

export const productWorkspaceDevelopmentPlans = [
  { ...developmentPlan, items: productWorkspaceDevelopmentPlanItems.filter((item) => item.development_plan_id === developmentPlan.id) },
  releaseRiskClosureDevelopmentPlan,
] as const;

export const brainstormingSession = {
  id: 'brainstorming-session-product-workspace-preview',
  revision_id: 'brainstorming-session-revision-product-workspace-preview',
  source_ref: developmentPlan.source_refs[0],
  development_plan_id: developmentPlan.id,
  development_plan_item_id: developmentPlanItem.id,
  development_plan_item_revision_id: developmentPlanItem.revision_id,
  context_manifest_id: 'context-manifest-product-workspace-preview',
  context_manifest_revision_id: 'context-manifest-revision-product-workspace-preview',
  questions: [
    {
      id: 'brainstorming-question-product-workspace-preview',
      text: 'Which product workspace states must be visible in the product workspace preview?',
      author_id: 'actor-tech-lead',
      created_at: '2026-05-18T00:14:00.000Z',
      status: 'answered',
    },
  ],
  answers: [
    {
      id: 'brainstorming-answer-product-workspace-preview',
      question_id: 'brainstorming-question-product-workspace-preview',
      text: 'Show planning inputs, four Plan Items, running execution, review, QA, release, and delivery risk.',
      actor_id: actorId,
      created_at: '2026-05-18T00:15:00.000Z',
    },
  ],
  decisions: [
    {
      id: 'brainstorming-decision-product-workspace-preview',
      text: 'Development Plan Item remains the product execution boundary.',
      actor_id: 'actor-tech-lead',
      rationale: 'The visual review needs seeded state across Spec, Implementation Plan Doc, execution, review, QA, and release.',
      created_at: '2026-05-18T00:16:00.000Z',
    },
  ],
  approval_state: 'approved',
  boundary_summary_id: 'boundary-summary-product-workspace-preview',
  approver_actor_id: 'actor-tech-lead',
  approved_at: '2026-05-18T00:17:00.000Z',
} as const;

export const boundarySummary = {
  id: brainstormingSession.boundary_summary_id,
  revision_id: 'boundary-summary-revision-product-workspace-preview',
  brainstorming_session_id: brainstormingSession.id,
  brainstorming_session_revision_id: brainstormingSession.revision_id,
  development_plan_id: developmentPlan.id,
  development_plan_item_id: developmentPlanItem.id,
  development_plan_item_revision_id: developmentPlanItem.revision_id,
  source_ref: brainstormingSession.source_ref,
  summary: 'Seed the product workspace preview with item-scoped states and review evidence.',
  summary_markdown: 'Seed the product workspace preview with item-scoped states and review evidence.',
  approved_by_actor_id: brainstormingSession.approver_actor_id,
  approved_at: brainstormingSession.approved_at,
} as const;

export const executionPlan = {
  id: 'implementation-plan-doc-requirements-database-view',
  development_plan_item_id: requirementsDatabaseViewItem.id,
  status: 'approved',
  current_revision_id: 'planrev-requirements-database-view-v1',
  approved_revision_id: 'planrev-requirements-database-view-v1',
  approved_by_actor_id: 'actor-tech-lead',
  approved_at: '2026-05-18T00:18:00.000Z',
  created_at: '2026-05-18T00:17:30.000Z',
  updated_at: '2026-05-18T00:18:00.000Z',
} as const;

export const executionPlanRevision = {
  id: 'planrev-requirements-database-view-v1',
  implementation_plan_id: 'implementation-plan-doc-requirements-database-view',
  development_plan_item_id: requirementsDatabaseViewItem.id,
  based_on_spec_revision_id: specRevision.id,
  revision_number: 1,
  summary: 'Requirements database view Implementation Plan Doc',
  content: 'Implement the Requirements database view using Plan Item governed document-workspace data.',
  created_at: '2026-05-18T00:17:40.000Z',
} as const;

export const execution = {
  id: 'exec-product-workspace-preview-active',
  development_plan_item_id: developmentPlanItem.id,
  implementation_plan_revision_id: executionPlanRevision.id,
  approved_spec_revision_id: specRevision.id,
  title: 'Codex worker is rebuilding product workspace preview data',
  ref: { type: 'execution', id: 'exec-product-workspace-preview-active', title: 'Codex worker is rebuilding product workspace preview data' },
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: developmentPlanItem.id,
    development_plan_id: developmentPlan.id,
    title: developmentPlanItem.title,
  },
  implementation_plan_revision_ref: {
    type: 'implementation_plan_revision',
    id: executionPlanRevision.id,
    implementation_plan_id: executionPlan.id,
    title: executionPlanRevision.summary,
  },
  approved_spec_revision_ref: { type: 'spec_revision', id: specRevision.id, spec_id: spec.id, title: specRevision.summary },
  status: 'running',
  worker_state: 'running',
  current_step: 'Seeding deterministic product workspace fixture data',
  source_ref: developmentPlan.source_refs[0],
  evidence_refs: [{ type: 'execution', id: 'evidence-exec-product-workspace-checks', title: 'Product workspace preview fixture checks' }],
  runtime_evidence_refs: [{ type: 'execution_package', id: 'pkg-product-workspace-preview-v1', title: 'Seed product workspace state execution boundary' }],
  pr_refs: [{ id: 'pr-product-workspace-preview', title: 'Product workspace preview data PR' }],
  diff_refs: [{ id: 'diff-product-workspace-preview', title: 'Product workspace fixture diff' }],
  test_evidence_refs: [{ id: 'test-product-workspace-preview', title: 'Focused product workspace tests' }],
  interrupt_history: [{ at: '2026-05-18T00:21:00.000Z', reason: 'Paused for review checkpoint' }],
  continuation_history: [{ at: '2026-05-18T00:22:00.000Z', summary: 'Continued after checkpoint' }],
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
} as const;

export const interruptedExecution = {
  ...execution,
  id: 'exec-release-risk-closure-interrupted',
  development_plan_item_id: 'dpi-release-blocker-closure',
  title: 'Release risk closure execution paused for QA evidence',
  ref: { type: 'execution', id: 'exec-release-risk-closure-interrupted', title: 'Release risk closure execution paused for QA evidence' },
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: 'dpi-release-blocker-closure',
    development_plan_id: 'dp-release-risk-closure',
    title: 'Close release blocker evidence',
  },
  status: 'interrupted',
  worker_state: 'interrupted',
  current_step: 'Waiting for blocked QA handoff evidence before release readiness can proceed',
  evidence_refs: [{ type: 'execution', id: 'evidence-release-risk-paused', title: 'Release risk closure pause evidence' }],
  interrupt_history: [{ at: '2026-05-18T00:33:00.000Z', reason: 'Blocked QA handoff requires owner decision' }],
  continuation_history: [],
  updated_at: '2026-05-18T00:33:00.000Z',
} as const;

export const codeReviewHandoff = {
  id: 'review-cockpit-requested-changes',
  title: 'Requested changes on Cockpit layout density',
  ref: { type: 'code_review_handoff', id: 'review-cockpit-requested-changes', title: 'Requested changes on Cockpit layout density' },
  execution_id: execution.id,
  development_plan_item_id: cockpitCommandCenterItem.id,
  implementation_plan_revision_id: executionPlanRevision.id,
  reviewer_actor_id: 'actor-reviewer',
  status: 'changes_requested',
  summary: 'Cockpit layout density needs tighter information hierarchy before visual review approval.',
  changed_surfaces: ['apps/web/src/features/cockpit', 'tests/web/fixtures'],
  verification_evidence_refs: [{ type: 'execution', id: execution.id, title: execution.ref.title }],
  comments: ['Density and hierarchy are not yet sufficient for the command center review target.'],
  changes_requested: ['Reduce vertical sprawl in Cockpit command sections.'],
  created_at: '2026-05-18T00:28:00.000Z',
  updated_at: '2026-05-18T00:30:00.000Z',
} as const;

export const qaHandoff = {
  id: 'qa-requirements-authoring-mdx',
  title: 'QA pending MDX image insertion acceptance',
  ref: { type: 'qa_handoff', id: 'qa-requirements-authoring-mdx', title: 'QA pending MDX image insertion acceptance' },
  code_review_handoff_id: codeReviewHandoff.id,
  execution_id: execution.id,
  source_ref: developmentPlan.source_refs[0],
  development_plan_item_id: requirementsDatabaseViewItem.id,
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: requirementsDatabaseViewItem.id,
    development_plan_id: developmentPlan.id,
    title: requirementsDatabaseViewItem.title,
  },
  approved_spec_revision_ref: { type: 'spec_revision', id: specRevision.id, spec_id: spec.id, title: specRevision.summary },
  approved_implementation_plan_revision_ref: execution.implementation_plan_revision_ref,
  status: 'pending',
  acceptance_criteria: ['MDX image insertion acceptance is visible from Requirements authoring'],
  test_strategy: 'Run fixture and route smoke tests for the Requirements database view.',
  verification_evidence_refs: [{ type: 'execution', id: execution.id, title: execution.ref.title }],
  known_risks: [],
  changed_surfaces: codeReviewHandoff.changed_surfaces,
  release_impact: requirementsDatabaseViewItem.release_impact,
  created_at: '2026-05-18T00:31:00.000Z',
  updated_at: '2026-05-18T00:31:00.000Z',
} as const;

export const blockedQaHandoff = {
  ...qaHandoff,
  id: 'qa-release-blocker-evidence',
  title: 'QA blocked release evidence acceptance',
  ref: { type: 'qa_handoff', id: 'qa-release-blocker-evidence', title: 'QA blocked release evidence acceptance' },
  execution_id: interruptedExecution.id,
  development_plan_item_id: 'dpi-release-blocker-closure',
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: 'dpi-release-blocker-closure',
    development_plan_id: 'dp-release-risk-closure',
    title: 'Close release blocker evidence',
  },
  status: 'blocked',
  acceptance_criteria: ['Release blocker evidence includes QA owner sign-off and observation plan'],
  test_strategy: 'Block release readiness until QA owner accepts the release-risk closure evidence.',
  known_risks: ['Release readiness would overstate confidence without QA sign-off.'],
  release_impact: 'release_scoped',
  updated_at: '2026-05-18T00:34:00.000Z',
} as const;

export const executionPackage = {
  id: 'pkg-product-workspace-preview-v1',
  task_id: 'task-1',
  work_item_id: workItem.id,
  scope_ref: { type: 'requirement', id: workItem.id, title: workItem.title },
  spec_id: spec.id,
  spec_revision_id: specRevision.id,
  plan_id: plan.id,
  plan_revision_id: planRevision.id,
  project_id: projectId,
  repo_id: 'forgeloop',
  objective: 'Seed product workspace state execution boundary',
  owner_actor_id: 'actor-execution-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'ready',
  activity_state: 'idle',
  gate_state: 'not_submitted',
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
  allowed_paths: ['tests/web/fixtures/**', 'tests/e2e/helpers/**', 'scripts/**'],
  forbidden_paths: ['apps/control-plane-api/**'],
  version: 1,
  last_run_session_id: 'run-product-workspace-preview',
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
};

export const runSession = {
  id: 'run-product-workspace-preview',
  execution_package_id: executionPackage.id,
  requested_by_actor_id: executionPackage.owner_actor_id,
  status: 'succeeded',
  executor_type: 'mock',
  changed_files: [{ repo_id: 'forgeloop', path: 'tests/web/fixtures/product-data.ts', change_kind: 'modified' }],
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
  summary: 'Product workspace preview visual review data passed deterministic checks.',
  created_at: '2026-05-18T00:24:00.000Z',
  updated_at: '2026-05-18T00:25:00.000Z',
  started_at: '2026-05-18T00:24:00.000Z',
  finished_at: '2026-05-18T00:25:00.000Z',
};

export const reviewPacket = {
  id: codeReviewHandoff.id,
  run_session_id: runSession.id,
  execution_package_id: executionPackage.id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  status: 'completed',
  decision: 'changes_requested',
  summary: codeReviewHandoff.title,
  changed_files: runSession.changed_files,
  check_result_summary: 'All required product checks passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Product workspace preview data is seeded, with Cockpit density still under review.',
    spec_plan_alignment: 'Aligned',
    test_assessment: 'Focused hook and state checks pass.',
    risk_notes: ['Product Lane fixtures remain contract-shaped'],
    follow_up_questions: [],
  },
  risk_notes: ['Generic ProductPage debt still blocks the final workspace redesign review'],
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
  id: 'rel-product-workspace-preview',
  org_id: 'org-product-workspace-preview',
  project_id: projectId,
  title: 'Product workspace preview release',
  scope_summary: 'Seeded planning inputs, Plan Items, execution, review, QA, and release data for product workspace visual review.',
  release_owner_actor_id: 'actor-release-owner',
  release_type: 'standard',
  phase: 'approval',
  activity_state: 'active',
  gate_state: 'open',
  resolution: 'unresolved',
  work_item_ids: [workItem.id, 'bug-plan-item-action-eligibility', 'td-retire-generic-product-page'],
  execution_package_ids: [executionPackage.id],
  rollout_strategy: 'Use seeded data for product workspace visual review before UI layout migrations.',
  rollback_plan: 'Revert the seeded fixture data and preview script.',
  observation_plan: 'Watch visual route screenshots for generic template debt.',
  created_by_actor_id: actorId,
  updated_by_actor_id: actorId,
  created_at: '2026-05-18T00:35:00.000Z',
  updated_at: '2026-05-18T00:36:00.000Z',
};

export const timeline = [
  {
    id: 'timeline-product-workspace-preview-1',
    source: 'fixture',
    object_type: 'requirement',
    object_id: workItem.id,
    summary: 'Created product workspace clarity requirement.',
    created_at: workItem.created_at,
    payload: { project_id: projectId },
  },
];

export const requirementListItem = {
  id: workItem.id,
  ref: { type: 'requirement', id: workItem.id, title: workItem.title },
  title: workItem.title,
  status: 'planning/active/open',
  priority: 'high',
  risk: 'medium',
  driver_actor_id: actorId,
  planning_coverage: { development_plan_count: 1, plan_item_count: 1, uncovered: false },
  downstream_gate_summary: {
    current_gate_counts: { boundary: 0, spec: 0, implementation_plan_doc: 0, execution: 1, code_review: 0, qa: 0, release: 0 },
    blocker_count: 0,
  },
  last_meaningful_update_at: '2026-05-18T01:00:00.000Z',
  next_action: 'Open governed Plan Item',
  release_refs: [{ type: 'release', id: release.id, title: release.title }],
  updated_at: '2026-05-18T01:00:00.000Z',
} as const;

const attachmentRef = ({
  id,
  owner_object_id,
  owner_object_type,
  title,
}: {
  id: string;
  owner_object_id: string;
  owner_object_type: 'bug' | 'initiative' | 'requirement' | 'tech_debt';
  title: string;
}) => ({
  id,
  owner_object_type,
  owner_object_id,
  linked_object_refs: [],
  filename: `${id}.md`,
  content_type: 'text/markdown',
  size_bytes: 128,
  checksum_sha256: 'a'.repeat(64),
  uploaded_by_actor_id: actorId,
  created_at: '2026-05-18T01:00:00.000Z',
  evidence_category: 'document',
  caption: title,
  alt_text: title,
  visibility: 'object',
  safety_status: 'passed',
  reference_status: 'active',
}) as const;

export const requirementDetail = {
  id: requirementListItem.id,
  ref: requirementListItem.ref,
  title: requirementListItem.title,
  status: requirementListItem.status,
  priority: requirementListItem.priority,
  risk: requirementListItem.risk,
  driver_actor_id: requirementListItem.driver_actor_id,
  planning_coverage: requirementListItem.planning_coverage,
  downstream_gate_summary: requirementListItem.downstream_gate_summary,
  last_meaningful_update_at: requirementListItem.last_meaningful_update_at,
  next_action: requirementListItem.next_action,
  release_refs: requirementListItem.release_refs,
  updated_at: requirementListItem.updated_at,
  narrative_markdown: [
    'Product workspace clarity must be visible before teams can trust gate actions.',
    '',
    '![Requirement workspace route density](attachment://att-requirement-flow-image)',
  ].join('\n'),
  linked_development_plans: [{ type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title }],
  linked_plan_items: [
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
  evidence_refs: [{ type: 'attachment', id: 'att-requirement-flow-image', title: 'Plan Item generation flow' }],
  attachment_refs: [
    attachmentRef({
      id: 'att-requirement-flow-image',
      owner_object_type: 'requirement',
      owner_object_id: requirementListItem.id,
      title: 'Plan Item generation flow',
    }),
  ],
  audit: { created_at: '2026-05-18T00:00:00.000Z', updated_at: '2026-05-18T01:00:00.000Z', updated_by_actor_id: actorId },
  relationship_refs: [
    { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
  stakeholder_problem: requirementIntakeContext.stakeholder_problem,
  desired_outcome: requirementIntakeContext.desired_outcome,
  acceptance_criteria_summary: requirementIntakeContext.acceptance_criteria.join(' '),
  scope_summary: {
    in_scope: requirementIntakeContext.in_scope.join(', '),
    out_of_scope: 'External issue tracker sync',
  },
} as const;

export const initiativeListItem = {
  id: 'init-product-workspace-redesign',
  ref: { type: 'initiative', id: 'init-product-workspace-redesign', title: 'Product workspace redesign rollout' },
  title: 'Product workspace redesign rollout',
  status: 'planning/active/open',
  priority: 'high',
  risk: 'medium',
  driver_actor_id: actorId,
  planning_coverage: { development_plan_count: 1, plan_item_count: 1, uncovered: false },
  downstream_gate_summary: requirementListItem.downstream_gate_summary,
  last_meaningful_update_at: '2026-05-18T01:01:00.000Z',
  next_action: 'Review workspace redesign Development Plan',
  release_refs: [{ type: 'release', id: release.id, title: release.title }],
  business_outcome: 'Coordinate the product workspace redesign across typed document, Plan Item gate, QA, and release routes.',
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
  planning_coverage: initiativeListItem.planning_coverage,
  downstream_gate_summary: initiativeListItem.downstream_gate_summary,
  last_meaningful_update_at: initiativeListItem.last_meaningful_update_at,
  next_action: initiativeListItem.next_action,
  release_refs: initiativeListItem.release_refs,
  updated_at: initiativeListItem.updated_at,
  narrative_markdown: 'Coordinate the product workspace redesign so planning inputs, Development Plans, Plan Items, execution, review, QA, and release routes read as one delivery system.',
  linked_development_plans: [{ type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title }],
  linked_plan_items: [
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
  evidence_refs: [{ type: 'attachment', id: 'att-init-product-workspace-redesign', title: 'Product workspace redesign evidence' }],
  attachment_refs: [
    attachmentRef({
      id: 'att-init-product-workspace-redesign',
      owner_object_type: 'initiative',
      owner_object_id: initiativeListItem.id,
      title: 'Product workspace redesign evidence',
    }),
  ],
  audit: { created_at: '2026-05-18T01:01:00.000Z', updated_at: '2026-05-18T01:01:00.000Z', updated_by_actor_id: actorId },
  business_outcome: initiativeListItem.business_outcome,
  child_refs: [{ type: 'requirement', id: requirementListItem.id }],
  relationship_refs: [],
  milestone_intent: 'Product workspace preview readiness',
  release_coverage: release.title,
} as const;

export const techDebtListItem = {
  id: 'td-retire-generic-product-page',
  ref: { type: 'tech_debt', id: 'td-retire-generic-product-page', title: 'Retire generic ProductPage visual fallback' },
  title: 'Retire generic ProductPage visual fallback',
  status: 'planning/active/open',
  priority: 'medium',
  risk: 'medium',
  driver_actor_id: actorId,
  planning_coverage: { development_plan_count: 1, plan_item_count: 1, uncovered: false },
  downstream_gate_summary: requirementListItem.downstream_gate_summary,
  last_meaningful_update_at: '2026-05-18T01:02:00.000Z',
  next_action: 'Remove generic visual fallback from core routes',
  release_refs: [{ type: 'release', id: release.id, title: release.title }],
  affected_modules: ['apps/web/src/features/product-surfaces', 'apps/web/src/shared/layout'],
  risk_rationale: 'Generic ProductPage composition prevents route-specific density and visual hierarchy.',
  updated_at: '2026-05-18T01:02:00.000Z',
} as const;

export const techDebtDetail = {
  ...techDebtListItem,
  narrative_markdown: 'Generic ProductPage composition prevents product-specific density, gate context, and route-level visual hierarchy.',
  linked_development_plans: [{ type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title }],
  linked_plan_items: [
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
  evidence_refs: [{ type: 'attachment', id: 'att-td-retire-generic-product-page', title: 'Generic ProductPage retirement evidence' }],
  attachment_refs: [
    attachmentRef({
      id: 'att-td-retire-generic-product-page',
      owner_object_type: 'tech_debt',
      owner_object_id: techDebtListItem.id,
      title: 'Generic ProductPage retirement evidence',
    }),
  ],
  audit: { created_at: '2026-05-18T01:02:00.000Z', updated_at: '2026-05-18T01:02:00.000Z', updated_by_actor_id: actorId },
  validation_strategy: 'Focused route tests and visual screenshot review.',
  remediation_intent: 'Replace shared page-template visual decisions with typed workspace shells.',
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
  id: 'bug-plan-item-action-eligibility',
  ref: { type: 'bug', id: 'bug-plan-item-action-eligibility', title: 'Plan Item action eligibility exposes premature execution' },
  title: 'Plan Item action eligibility exposes premature execution',
  status: 'validation/active/open',
  priority: 'critical',
  risk: 'high',
  driver_actor_id: actorId,
  planning_coverage: { development_plan_count: 1, plan_item_count: 1, uncovered: false },
  downstream_gate_summary: {
    current_gate_counts: { boundary: 0, spec: 0, implementation_plan_doc: 0, execution: 0, code_review: 1, qa: 0, release: 0 },
    blocker_count: 1,
  },
  last_meaningful_update_at: '2026-05-18T01:04:00.000Z',
  next_action: 'Block execution action until gate evidence is complete',
  release_refs: [{ type: 'release', id: release.id, title: release.title }],
  severity: 'high',
  affected_surfaces: ['Plan Item Gate', 'Execution'],
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
  planning_coverage: bugListItem.planning_coverage,
  downstream_gate_summary: bugListItem.downstream_gate_summary,
  last_meaningful_update_at: bugListItem.last_meaningful_update_at,
  next_action: bugListItem.next_action,
  release_refs: bugListItem.release_refs,
  updated_at: bugListItem.updated_at,
  narrative_markdown: 'Plan Item actions must stay disabled until boundary, Spec, Implementation Plan Doc, QA participation, and internal package evidence are complete.',
  linked_development_plans: [{ type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title }],
  linked_plan_items: [
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
  evidence_refs: [{ type: 'attachment', id: 'att-bug-action-eligibility', title: 'Premature action eligibility reproduction' }],
  attachment_refs: [
    attachmentRef({
      id: 'att-bug-action-eligibility',
      owner_object_type: 'bug',
      owner_object_id: bugListItem.id,
      title: 'Premature action eligibility reproduction',
    }),
  ],
  audit: { created_at: '2026-05-18T01:04:00.000Z', updated_at: '2026-05-18T01:04:00.000Z', updated_by_actor_id: actorId },
  observed_behavior: 'The Plan Item route exposes execution affordances before all gate evidence is approved.',
  expected_behavior: 'Execution actions remain disabled until boundary, Spec, Implementation Plan Doc, QA strategy, and package evidence are complete.',
  reproduction_steps: ['Open the Plan Item gate route', 'Inspect the execution action before QA participation is recorded'],
  severity: bugListItem.severity,
  affected_surfaces: bugListItem.affected_surfaces,
  relationship_refs: [
    {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
  ],
} as const;

const requirementListItemFor = ({
  id,
  title,
  next_action,
  priority = 'high',
  risk = 'medium',
  planItemCount = 2,
  blockerCount = 0,
}: {
  id: string;
  title: string;
  next_action: string;
  priority?: 'critical' | 'high' | 'medium';
  risk?: 'low' | 'medium' | 'high' | 'critical';
  planItemCount?: number;
  blockerCount?: number;
}) => ({
  id,
  ref: { type: 'requirement', id, title },
  title,
  status: 'planning/active/open',
  priority,
  risk,
  driver_actor_id: actorId,
  planning_coverage: { development_plan_count: 1, plan_item_count: planItemCount, uncovered: false },
  downstream_gate_summary: {
    current_gate_counts: { boundary: 1, spec: 1, implementation_plan_doc: 1, execution: 1, code_review: 1, qa: 1, release: 0 },
    blocker_count: blockerCount,
  },
  last_meaningful_update_at: '2026-05-18T01:06:00.000Z',
  next_action,
  release_refs: [{ type: 'release', id: release.id, title: release.title }],
  updated_at: '2026-05-18T01:06:00.000Z',
}) as const;

export const aiNativeDeliveryFlowRequirement = requirementListItemFor({
  id: 'req-ai-native-delivery-flow',
  title: 'AI-native delivery flow from source to release',
  next_action: 'Review Plan Item gate sequence coverage',
  planItemCount: 3,
});

export const qaShiftLeftRequirement = requirementListItemFor({
  id: 'req-qa-shift-left',
  title: 'Shift-left QA participation before execution',
  next_action: 'Confirm QA strategy appears before execution start',
  priority: 'critical',
  risk: 'high',
  blockerCount: 1,
});

export const releaseReadinessRequirement = requirementListItemFor({
  id: 'req-release-readiness',
  title: 'Release readiness blocks on missing evidence',
  next_action: 'Close release blocker evidence',
  priority: 'critical',
  risk: 'high',
  planItemCount: 2,
  blockerCount: 1,
});

const requirementDetailFor = (
  item: typeof aiNativeDeliveryFlowRequirement | typeof qaShiftLeftRequirement | typeof releaseReadinessRequirement,
  narrative_markdown: string,
) => ({
  ...item,
  narrative_markdown,
  linked_development_plans: [{ type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title }],
  linked_plan_items: developmentPlan.items.slice(0, 2).map((planItem) => ({
    type: 'development_plan_item',
    id: planItem.id,
    development_plan_id: developmentPlan.id,
    title: planItem.title,
  })),
  evidence_refs: [{ type: 'attachment', id: `att-${item.id}`, title: `${item.title} evidence` }],
  attachment_refs: [
    attachmentRef({
      id: `att-${item.id}`,
      owner_object_type: 'requirement',
      owner_object_id: item.id,
      title: `${item.title} evidence`,
    }),
  ],
  audit: { created_at: '2026-05-18T01:06:00.000Z', updated_at: '2026-05-18T01:06:00.000Z', updated_by_actor_id: actorId },
  relationship_refs: [{ type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title }],
  stakeholder_problem: `${item.title} needs visible ownership and gate context.`,
  desired_outcome: item.next_action,
  acceptance_criteria_summary: 'Workspace routes show deterministic planning, gate, execution, QA, and release signals.',
  scope_summary: {
    in_scope: 'Seeded product workspace route coverage',
    out_of_scope: 'External tracker synchronization',
  },
}) as const;

export const aiNativeDeliveryFlowRequirementDetail = requirementDetailFor(
  aiNativeDeliveryFlowRequirement,
  'The AI-native delivery flow keeps Development Plan and Plan Item gates as the visible bridge between planning inputs and execution.',
);

export const qaShiftLeftRequirementDetail = requirementDetailFor(
  qaShiftLeftRequirement,
  'QA participation must appear before Implementation Plan Doc authoring can be considered complete for release-impacting work.',
);

export const releaseReadinessRequirementDetail = requirementDetailFor(
  releaseReadinessRequirement,
  'Release readiness remains disabled until review, package run, QA, and observation evidence are present.',
);

export const boardCards = [
  {
    id: `board:${requirementListItem.id}`,
    object_ref: { type: 'requirement', id: requirementListItem.id, title: requirementListItem.title },
    title: requirementListItem.title,
    column_id: 'planning',
    status: requirementListItem.status,
    priority: requirementListItem.priority,
    risk: requirementListItem.risk,
    driver_actor_id: requirementListItem.driver_actor_id,
    blocked: false,
    href: `/requirements/${requirementListItem.id}`,
  },
  {
    id: `board:${initiativeListItem.id}`,
    object_ref: { type: 'initiative', id: initiativeListItem.id, title: initiativeListItem.title },
    title: initiativeListItem.title,
    column_id: 'planning',
    status: initiativeListItem.status,
    priority: initiativeListItem.priority,
    risk: initiativeListItem.risk,
    driver_actor_id: initiativeListItem.driver_actor_id,
    blocked: false,
    href: `/initiatives/${initiativeListItem.id}`,
  },
  {
    id: `board:${techDebtListItem.id}`,
    object_ref: { type: 'tech_debt', id: techDebtListItem.id, title: techDebtListItem.title },
    title: techDebtListItem.title,
    column_id: 'planning',
    status: techDebtListItem.status,
    priority: techDebtListItem.priority,
    risk: techDebtListItem.risk,
    driver_actor_id: techDebtListItem.driver_actor_id,
    blocked: false,
    href: `/tech-debt/${techDebtListItem.id}`,
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
    id: `board:${bugListItem.id}`,
    object_ref: { type: 'bug', id: bugListItem.id, title: bugListItem.title },
    title: bugListItem.title,
    column_id: 'validation',
    status: bugListItem.status,
    priority: bugListItem.priority,
    risk: bugListItem.risk,
    driver_actor_id: bugListItem.driver_actor_id,
    blocked: true,
    href: `/bugs/${bugListItem.id}`,
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
    id: `board:${release.id}`,
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
      requirement_id: `qa:${bugListItem.id}`,
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
      requirement_id: `observation:${release.id}`,
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

export const documentEvidenceRefs = {
  requirement: [
    { type: 'attachment', id: 'att-requirement-flow-image', title: 'Plan Item generation flow' },
  ],
  initiative: [
    { type: 'attachment', id: 'att-init-product-workspace-redesign', title: 'Product workspace redesign evidence' },
  ],
  techDebt: [
    { type: 'attachment', id: 'att-td-retire-generic-product-page', title: 'Generic ProductPage retirement evidence' },
  ],
  bug: [
    { type: 'attachment', id: 'att-bug-action-eligibility', title: 'Premature action eligibility reproduction' },
  ],
} as const;

export const releaseEvidenceRefs = [
  { type: 'release_evidence', id: 'release-evidence-review', title: 'Code review approval evidence' },
  { type: 'release_evidence', id: 'release-evidence-package-run', title: 'Package run evidence' },
] as const;

export const requirementListResponse = {
  items: [requirementListItem, aiNativeDeliveryFlowRequirement, qaShiftLeftRequirement, releaseReadinessRequirement],
  degraded_sources: [],
} as const;
export const initiativeListResponse = { items: [initiativeListItem], degraded_sources: [] } as const;
export const techDebtListResponse = { items: [techDebtListItem], degraded_sources: [] } as const;
export const bugListResponse = { items: [bugListItem], degraded_sources: [] } as const;

export const productWorkspacePreviewScenario = {
  requirements: [
    requirementDetail,
    aiNativeDeliveryFlowRequirementDetail,
    qaShiftLeftRequirementDetail,
    releaseReadinessRequirementDetail,
  ],
  initiatives: [initiativeDetail],
  bugs: [bugDetail],
  techDebt: [techDebtDetail],
  developmentPlans: productWorkspaceDevelopmentPlans,
  developmentPlanItems: productWorkspaceDevelopmentPlanItems,
  executions: [execution, interruptedExecution],
  codeReviews: [codeReviewHandoff],
  qaHandoffs: [qaHandoff, blockedQaHandoff],
  releases: [release],
  releaseReadiness: releaseReadinessDetail,
} as const;

export const myWorkQueueResponse = {
  items: [
    {
      id: `product:${requirementListItem.id}`,
      object_ref: { type: 'requirement', id: requirementListItem.id },
      title: requirementListItem.title,
      attention_reason: 'product_attention',
      expected_action: 'Clarify Plan Item generation governance',
      actor_id: actorId,
      href: `/requirements/${requirementListItem.id}`,
    },
    {
      id: `tech-lead:${initiativeListItem.id}`,
      object_ref: { type: 'initiative', id: initiativeListItem.id },
      title: initiativeListItem.title,
      attention_reason: 'tech_lead_attention',
      expected_action: 'Review rollout technical breakdown',
      actor_id: actorId,
      href: `/initiatives/${initiativeListItem.id}`,
    },
    {
      id: `developer:${developmentPlanItem.id}`,
      object_ref: {
        type: 'development_plan_item',
        id: developmentPlanItem.id,
        development_plan_id: developmentPlan.id,
      },
      title: developmentPlanItem.title,
      attention_reason: 'developer_attention',
      expected_action: 'Open Development Plan Item',
      actor_id: actorId,
      href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    },
    {
      id: `qa:${bugListItem.id}`,
      object_ref: { type: 'bug', id: bugListItem.id },
      title: bugListItem.title,
      attention_reason: 'qa_attention',
      expected_action: 'Verify continuation context reproduction',
      actor_id: actorId,
      href: `/bugs/${bugListItem.id}`,
    },
    {
      id: `release-owner:${release.id}`,
      object_ref: { type: 'release', id: release.id },
      title: 'Release readiness decision',
      attention_reason: 'release_owner_attention',
      expected_action: 'Review rollout blockers',
      actor_id: 'actor-release-owner',
      href: `/releases/${release.id}`,
    },
    {
      id: `manager:${techDebtListItem.id}`,
      object_ref: { type: 'tech_debt', id: techDebtListItem.id },
      title: techDebtListItem.title,
      attention_reason: 'manager_attention',
      expected_action: 'Review delivery risk',
      actor_id: actorId,
      href: `/tech-debt/${techDebtListItem.id}`,
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
  executionGateNavigation: {
    id: 'open-fixture-execution-gate',
    lane_id: 'execution-owner',
    priority: 'primary',
    label: 'Open execution gate',
    description: 'Open the workflow-owned execution gate for this package.',
    enabled: true,
    kind: 'navigate',
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
    actions: [productActionFixtures.executionGateNavigation, productActionFixtures.disabled],
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

export const reportLinks = [
  'development-plan-throughput',
  'brainstorming-bottlenecks',
  'spec-review-aging',
  'implementation-plan-doc-review-aging',
  'execution-continuation',
  'execution-outcomes',
  'code-review',
  'qa-handoff-readiness',
  'release-readiness',
  'quality-bug-escape',
].map((id) => ({ id, href: `/reports/${id}` }));

export const reportFixtures = {
  delivery: {
    id: 'report-delivery-risk',
    title: 'Delivery risk: workspace redesign blocked by generic template debt',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    groups: [
      {
        id: 'workspace_surface_blocked',
        count: 1,
        items: [{ type: 'tech_debt', id: techDebtListItem.id, title: techDebtListItem.title }],
      },
      {
        id: 'running_execution',
        count: 1,
        items: [{ type: 'execution', id: execution.id, title: execution.ref.title }],
      },
    ],
    links: reportLinks,
    degraded_sources: [],
  },
  developmentPlanThroughput: {
    id: 'development-plan-throughput',
    title: 'Development Plan Throughput',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    groups: [
      { id: 'draft_or_active', count: developmentPlan.items.length, items: [execution.development_plan_item_ref] },
      { id: 'approved_items', count: developmentPlan.items.filter((item) => item.implementation_plan_status === 'approved').length, items: [execution.development_plan_item_ref] },
    ],
    links: reportLinks,
    degraded_sources: [],
  },
  qualityBugEscape: {
    id: 'quality-bug-escape',
    title: 'Quality Bug Escape',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    groups: [
      { id: 'escaped_bugs', count: 1, items: [{ type: 'bug', id: bugListItem.id, title: bugListItem.title }] },
      { id: 'qa_blockers', count: 0, items: [] },
    ],
    links: reportLinks,
    degraded_sources: [],
  },
  releaseReadiness: {
    id: 'release-readiness',
    title: 'Release Readiness',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    groups: [
      { id: 'planned_releases', count: 1, items: [{ type: 'release', id: release.id, title: release.title }] },
      { id: 'release_blocking_items', count: 0, items: [] },
    ],
    links: reportLinks,
    degraded_sources: [],
  },
  executionOutcomes: {
    id: 'execution-outcomes',
    title: 'Execution Outcomes',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    groups: [
      { id: 'succeeded', count: 1, items: [{ type: 'execution', id: execution.id, title: execution.ref.title }] },
      { id: 'failed', count: 0, items: [] },
    ],
    links: reportLinks,
    degraded_sources: [],
  },
  executionContinuation: {
    id: 'execution-continuation',
    title: 'Execution Continuation',
    project_id: projectId,
    generated_at: '2026-05-18T01:05:00.000Z',
    groups: [
      { id: 'interrupted_or_resumable', count: 0, items: [] },
      { id: 'running', count: execution.status === 'running' ? 1 : 0, items: [{ type: 'execution', id: execution.id, title: execution.ref.title }] },
    ],
    links: reportLinks,
    degraded_sources: [],
  },
} as const;

export const productDynamicRouteFixtureManifest = [
  {
    family: 'document-workspace',
    route: `/requirements/${requirementDetail.id}`,
    objectType: 'requirement',
    objectId: requirementDetail.id,
    fixture: 'requirementDetail',
    evidenceFixture: 'documentEvidenceRefs.requirement',
  },
  {
    family: 'document-workspace',
    route: `/initiatives/${initiativeDetail.id}`,
    objectType: 'initiative',
    objectId: initiativeDetail.id,
    fixture: 'initiativeDetail',
    evidenceFixture: 'documentEvidenceRefs.initiative',
  },
  {
    family: 'document-workspace',
    route: `/bugs/${bugDetail.id}`,
    objectType: 'bug',
    objectId: bugDetail.id,
    fixture: 'bugDetail',
    evidenceFixture: 'documentEvidenceRefs.bug',
  },
  {
    family: 'document-workspace',
    route: `/tech-debt/${techDebtDetail.id}`,
    objectType: 'tech_debt',
    objectId: techDebtDetail.id,
    fixture: 'techDebtDetail',
    evidenceFixture: 'documentEvidenceRefs.techDebt',
  },
  {
    family: 'document-evidence',
    route: `/requirements/${requirementDetail.id}/evidence`,
    objectType: 'requirement',
    objectId: requirementDetail.id,
    fixture: 'requirementDetail.evidence_refs',
  },
  {
    family: 'document-evidence',
    route: `/initiatives/${initiativeDetail.id}/evidence`,
    objectType: 'initiative',
    objectId: initiativeDetail.id,
    fixture: 'initiativeDetail.evidence_refs',
  },
  {
    family: 'document-evidence',
    route: `/bugs/${bugDetail.id}/evidence`,
    objectType: 'bug',
    objectId: bugDetail.id,
    fixture: 'bugDetail.evidence_refs',
  },
  {
    family: 'document-evidence',
    route: `/tech-debt/${techDebtDetail.id}/evidence`,
    objectType: 'tech_debt',
    objectId: techDebtDetail.id,
    fixture: 'techDebtDetail.evidence_refs',
  },
  {
    family: 'planning-table',
    route: `/development-plans/${developmentPlan.id}`,
    objectType: 'development_plan',
    objectId: developmentPlan.id,
    fixture: 'developmentPlan',
  },
  {
    family: 'gate-flow',
    route: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    objectType: 'development_plan_item',
    objectId: developmentPlanItem.id,
    fixture: 'developmentPlanItem',
  },
  {
    family: 'execution-supervision',
    route: `/executions/${execution.id}`,
    objectType: 'execution',
    objectId: execution.id,
    fixture: 'execution',
  },
  {
    family: 'release-readiness',
    route: `/releases/${release.id}`,
    objectType: 'release',
    objectId: release.id,
    fixture: 'release',
  },
  {
    family: 'release-evidence',
    route: `/releases/${release.id}/evidence`,
    objectType: 'release',
    objectId: release.id,
    fixture: 'releaseEvidenceRefs',
  },
] as const;
