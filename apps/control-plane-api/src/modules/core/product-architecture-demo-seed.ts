import type { DeliveryRepository } from '@forgeloop/db';
import type {
  Actor,
  CodeReviewHandoff,
  DevelopmentPlan,
  DevelopmentPlanItem,
  DevelopmentPlanItemRevision,
  DevelopmentPlanRevision,
  DevelopmentPlanSourceLink,
  Execution,
  ExecutionPackage,
  ExecutionPlanDocument,
  ExecutionPlanRevision,
  Organization,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  QaHandoff,
  Release,
  ReleaseEvidence,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '@forgeloop/domain';

export const productArchitectureDemoSeedId = 'project-product-architecture-demo';

const now = '2026-05-18T00:00:00.000Z';
const orgId = 'org-product-architecture-preview';
const ownerActorId = 'actor-owner';
const reviewerActorId = 'actor-reviewer';
const techLeadActorId = 'actor-tech-lead';
const qaActorId = 'actor-qa';
const releaseOwnerActorId = 'actor-release-owner';
const executionOwnerActorId = 'actor-execution-owner';
const repoId = 'forgeloop';
const developmentPlanId = 'dp-product-architecture-visual-rebuild';

export async function seedProductArchitectureDemoRepository(repository: DeliveryRepository): Promise<void> {
  await repository.saveOrganization(organization);
  for (const actor of actors) {
    await repository.saveActor(actor);
  }
  await repository.saveProject(project);
  await repository.saveProjectRepo(projectRepo);

  for (const workItem of sourceObjects) {
    await repository.saveWorkItem(workItem);
  }

  await repository.saveDevelopmentPlan(developmentPlan);
  await repository.saveDevelopmentPlanRevision(developmentPlanRevision);
  for (const sourceLink of developmentPlanSourceLinks) {
    await repository.saveDevelopmentPlanSourceLink(sourceLink);
  }
  for (const item of developmentPlanItems) {
    await repository.saveDevelopmentPlanItem(item);
    await repository.saveDevelopmentPlanItemRevision(developmentPlanItemRevision(item));
  }

  await repository.saveSpec(spec);
  await repository.saveSpecRevision(specRevision);
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);
  await repository.saveExecutionPlan(executionPlan);
  await repository.saveExecutionPlanRevision(executionPlanRevision);
  await repository.saveExecutionPackage(executionPackage);
  await repository.saveRunSession(runSession);
  await repository.saveReviewPacket(reviewPacket);
  await repository.saveExecution(execution);
  await repository.saveCodeReviewHandoff(codeReviewHandoff);
  await repository.saveQaHandoff(qaHandoff);
  await repository.saveRelease(release);
  for (const evidence of releaseEvidences) {
    await repository.saveReleaseEvidence(evidence);
  }
}

const organization = {
  id: orgId,
  name: 'ForgeLoop Product Architecture Preview',
  created_at: now,
  updated_at: now,
} satisfies Organization;

const actors = [
  actor(ownerActorId, 'Product Owner', 'owner@example.test'),
  actor(reviewerActorId, 'Reviewer', 'reviewer@example.test'),
  actor(techLeadActorId, 'Tech Lead', 'tech-lead@example.test'),
  actor(qaActorId, 'QA Owner', 'qa@example.test'),
  actor(releaseOwnerActorId, 'Release Owner', 'release-owner@example.test'),
  actor(executionOwnerActorId, 'Execution Owner', 'execution-owner@example.test'),
] satisfies Actor[];

const project = {
  id: productArchitectureDemoSeedId,
  org_id: orgId,
  key: 'PRODUCT-ARCH',
  name: 'ForgeLoop product architecture demo',
  repo_ids: [repoId],
  created_at: now,
  updated_at: '2026-05-18T00:40:00.000Z',
} satisfies Project;

const projectRepo = {
  id: 'project-repo-product-architecture',
  repo_id: repoId,
  org_id: orgId,
  project_id: productArchitectureDemoSeedId,
  name: 'forgeloop',
  status: 'active',
  local_path: process.cwd(),
  default_branch: 'main',
  base_commit_sha: 'product-architecture-demo',
  created_at: now,
  updated_at: now,
} satisfies ProjectRepo;

const sourceObjects = [
  sourceWorkItem({
    id: 'req-plan-item-governance',
    kind: 'requirement',
    title: 'Plan Item governed Spec and Execution Plan generation',
    narrative:
      'Product teams need a governed path from source object to Development Plan Item, brainstorming, Spec, Execution Plan, execution, review, QA, and release.',
    priority: 'P0',
    risk: 'medium',
    phase: 'spec',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Spec and Execution Plan generation needs a governed Plan Item boundary.',
      desired_outcome: 'The team can review the full source object to Plan Item to execution flow.',
      acceptance_criteria: ['Plan Item generation flow is visible in seeded screenshots.'],
      in_scope: ['Plan Item governance', 'Spec generation', 'Execution Plan generation'],
      out_of_scope: ['Top-level Task route', 'Direct source object execution'],
    },
    current_spec_id: 'spec-cockpit-command-center',
    current_spec_revision_id: 'specrev-cockpit-command-center-v1',
    current_plan_id: 'plan-requirements-database-view',
    current_plan_revision_id: 'planrev-requirements-database-view-v1',
    current_release_id: 'rel-product-architecture-preview',
    updated_at: '2026-05-18T01:00:00.000Z',
  }),
  sourceWorkItem({
    id: 'init-ai-native-rollout',
    kind: 'initiative',
    title: 'AI-native project management rollout',
    narrative:
      'Coordinate AI-native project management surfaces across source objects, Plan Items, execution, and release.',
    priority: 'P1',
    risk: 'medium',
    phase: 'triage',
    intake_context: {
      type: 'initiative',
      business_outcome: 'Coordinate the product architecture rebuild rollout.',
      scope_narrative: 'Coordinate product architecture visual rebuild work.',
      success_metrics: ['Seeded route screenshots show product-quality state'],
      milestone_intent: 'Product architecture preview readiness',
    },
    current_release_id: 'rel-product-architecture-preview',
    updated_at: '2026-05-18T01:01:00.000Z',
  }),
  sourceWorkItem({
    id: 'td-retire-workspace-page-template',
    kind: 'tech_debt',
    title: 'Retire generic WorkspacePage visual template',
    narrative: 'Generic WorkspacePage composition prevents product-specific density and visual hierarchy.',
    priority: 'P2',
    risk: 'medium',
    phase: 'plan',
    intake_context: {
      type: 'tech_debt',
      current_pain: 'Generic WorkspacePage composition prevents product-specific density and visual hierarchy.',
      desired_invariant: 'Product routes no longer share a generic first-viewport template.',
      affected_modules: ['apps/web/src/shared/layout', 'apps/web/src/features/product-surfaces'],
      behavior_preservation: 'Canonical route behavior is preserved.',
      validation_strategy: 'Visual route geometry and screenshot gates pass.',
    },
    current_release_id: 'rel-product-architecture-preview',
    updated_at: '2026-05-18T01:02:00.000Z',
  }),
  sourceWorkItem({
    id: 'bug-execution-review-context',
    kind: 'bug',
    title: 'Execution continuation loses review context',
    narrative: 'Continuation must preserve the review context needed by the execution owner and reviewer.',
    priority: 'P0',
    risk: 'high',
    phase: 'execution',
    intake_context: {
      type: 'bug',
      impact_summary: 'Continuation loses review context.',
      observed_behavior: 'Execution continuation opens without the prior review context.',
      expected_behavior: 'Execution continuation preserves the review context and pending decisions.',
      reproduction_steps: ['Open the execution detail', 'Continue the running execution after review feedback'],
      affected_environment: 'Product architecture preview',
      verification_path: 'Seeded route screenshot review',
    },
    current_release_id: 'rel-product-architecture-preview',
    updated_at: '2026-05-18T01:04:00.000Z',
  }),
] satisfies WorkItem[];

const sourceRef = {
  type: 'requirement',
  id: 'req-plan-item-governance',
  title: 'Plan Item governed Spec and Execution Plan generation',
} as const;

const developmentPlanItems = [
  planItem({
    id: 'dpi-cockpit-command-center',
    revision_id: 'dpirev-cockpit-command-center-v1',
    title: 'Rebuild Cockpit into operational command center',
    summary: 'Replace generic cockpit composition with operational delivery, review, and risk signals.',
    affected_surfaces: ['apps/web/src/features/cockpit'],
    boundary_status: 'approved',
    spec_status: 'in_review',
    execution_plan_status: 'missing',
    execution_status: 'not_started',
    review_status: 'changes_requested',
    qa_handoff_status: 'missing',
    next_action: 'Resolve Spec review comments on Cockpit layout density.',
  }),
  planItem({
    id: 'dpi-requirements-database-view',
    revision_id: 'dpirev-requirements-database-view-v1',
    title: 'Replace Requirements list with database view',
    summary: 'Turn Requirements into a source-object database with generation and evidence affordances.',
    affected_surfaces: ['apps/web/src/features/requirements'],
    boundary_status: 'approved',
    spec_status: 'approved',
    execution_plan_status: 'approved',
    execution_status: 'ready',
    review_status: 'missing',
    qa_handoff_status: 'in_review',
    next_action: 'Use the approved Execution Plan to start database view implementation.',
  }),
  planItem({
    id: 'dpi-demo-seed-visual-review',
    revision_id: 'dpirev-demo-seed-visual-review-v1',
    title: 'Seed demo project state for visual review',
    summary: 'Seed deterministic product architecture data for visual route review.',
    affected_surfaces: ['tests/web/fixtures', 'tests/e2e/helpers', 'scripts'],
    boundary_status: 'approved',
    spec_status: 'approved',
    execution_plan_status: 'approved',
    execution_status: 'running',
    review_status: 'in_review',
    qa_handoff_status: 'in_review',
    next_action: 'Resume the execution with seeded visual review data.',
  }),
  planItem({
    id: 'dpi-development-plan-table-inspector',
    revision_id: 'dpirev-development-plan-table-inspector-v1',
    title: 'Rewrite Development Plan table and inspector',
    summary: 'Replace the generic table detail with a dense plan table and inspector workflow.',
    affected_surfaces: ['apps/web/src/features/development-plans'],
    boundary_status: 'changes_requested',
    spec_status: 'blocked',
    execution_plan_status: 'blocked',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'missing',
    next_action: 'Unblock the Plan Item boundary before authoring documents.',
  }),
] satisfies DevelopmentPlanItem[];

const developmentPlan = {
  id: developmentPlanId,
  project_id: productArchitectureDemoSeedId,
  revision_id: 'dprev-product-architecture-visual-rebuild-v1',
  title: 'Project architecture and visual rebuild',
  status: 'active',
  source_refs: [sourceRef],
  items: developmentPlanItems,
  created_at: '2026-05-18T00:11:00.000Z',
  updated_at: '2026-05-18T00:19:00.000Z',
} satisfies DevelopmentPlan;

const developmentPlanRevision = {
  id: developmentPlan.revision_id,
  development_plan_id: developmentPlan.id,
  revision_number: 1,
  title: developmentPlan.title,
  status: developmentPlan.status,
  source_refs: developmentPlan.source_refs,
  item_refs: developmentPlanItems.map((item) => ({
    id: item.id,
    revision_id: item.revision_id,
    title: item.title,
    boundary_status: item.boundary_status,
    spec_status: item.spec_status,
    execution_plan_status: item.execution_plan_status,
    execution_status: item.execution_status,
  })),
  generation_state: 'draft_generated',
  change_reason: 'Seed product architecture preview data.',
  actor_id: techLeadActorId,
  created_at: '2026-05-18T00:19:00.000Z',
} satisfies DevelopmentPlanRevision;

const developmentPlanSourceLinks = [
  {
    id: 'dpsl-product-architecture-requirement',
    development_plan_id: developmentPlanId,
    source_ref: sourceRef,
    link_type: 'primary',
    rationale: 'Requirement owns the product architecture preview development plan.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:11:00.000Z',
  },
] satisfies DevelopmentPlanSourceLink[];

const spec = {
  id: 'spec-cockpit-command-center',
  work_item_id: 'req-plan-item-governance',
  development_plan_item_id: 'dpi-cockpit-command-center',
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'specrev-cockpit-command-center-v1',
  approved_revision_id: 'specrev-cockpit-command-center-v1',
  approved_at: '2026-05-18T00:10:00.000Z',
  approved_by_actor_id: techLeadActorId,
  created_at: '2026-05-18T00:05:00.000Z',
  updated_at: '2026-05-18T00:10:00.000Z',
} satisfies Spec;

const specRevision = {
  id: 'specrev-cockpit-command-center-v1',
  spec_id: spec.id,
  work_item_id: spec.work_item_id,
  development_plan_item_id: spec.development_plan_item_id,
  revision_number: 1,
  summary: 'Cockpit operational command center Spec',
  content: 'The Cockpit should act as an operational command center for AI-native project management.',
  background: 'The product architecture rebuild replaces generic route shells with purpose-built surfaces.',
  goals: ['Expose operational state density', 'Keep command paths Plan Item governed'],
  scope_in: ['Cockpit information architecture', 'Review-ready fixture data'],
  scope_out: ['Route shell navigation'],
  acceptance_criteria: ['Query keys are stable', 'Fixtures need no live API'],
  risk_notes: ['Backend actor ids remain internal'],
  test_strategy_summary: 'Vitest covers query keys and lane mapping behavior.',
  author_actor_id: techLeadActorId,
  artifact_refs: [],
  created_at: '2026-05-18T00:06:00.000Z',
} satisfies SpecRevision;

const plan = {
  id: 'plan-requirements-database-view',
  work_item_id: 'req-plan-item-governance',
  development_plan_item_id: 'dpi-requirements-database-view',
  entity_type: 'plan',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'planrev-requirements-database-view-v1',
  approved_revision_id: 'planrev-requirements-database-view-v1',
  approved_at: '2026-05-18T00:18:00.000Z',
  approved_by_actor_id: techLeadActorId,
  created_at: '2026-05-18T00:12:00.000Z',
  updated_at: '2026-05-18T00:18:00.000Z',
} satisfies Plan;

const planRevision = {
  id: 'planrev-requirements-database-view-v1',
  plan_id: plan.id,
  work_item_id: plan.work_item_id,
  based_on_spec_revision_id: specRevision.id,
  revision_number: 1,
  summary: 'Requirements database view Execution Plan',
  content: 'Replace the Requirements list with a database view that keeps Plan Item governance visible.',
  implementation_summary: 'Use canonical source object rows with fixture-backed evidence and generation links.',
  split_strategy: 'Database view task with no cockpit layout migration.',
  dependency_order: ['tests/web/fixtures', 'apps/web/src/features/requirements'],
  test_matrix: ['pnpm vitest run tests/web/api-hooks.test.tsx', 'pnpm --filter @forgeloop/web typecheck'],
  risk_mitigations: ['Keep route fixtures aligned with ProductAction contracts'],
  rollback_notes: 'Revert shared API foundation commit if route tasks need to pause.',
  author_actor_id: techLeadActorId,
  artifact_refs: [],
  created_at: '2026-05-18T00:13:00.000Z',
} satisfies PlanRevision;

const executionPlan = {
  id: 'execution-plan-requirements-database-view',
  development_plan_item_id: 'dpi-requirements-database-view',
  status: 'approved',
  current_revision_id: 'planrev-requirements-database-view-v1',
  approved_revision_id: 'planrev-requirements-database-view-v1',
  approved_by_actor_id: techLeadActorId,
  approved_at: '2026-05-18T00:18:00.000Z',
  created_at: '2026-05-18T00:17:30.000Z',
  updated_at: '2026-05-18T00:18:00.000Z',
} satisfies ExecutionPlanDocument;

const executionPlanRevision = {
  id: 'planrev-requirements-database-view-v1',
  execution_plan_id: executionPlan.id,
  development_plan_item_id: executionPlan.development_plan_item_id,
  based_on_spec_revision_id: specRevision.id,
  revision_number: 1,
  summary: 'Requirements database view Execution Plan',
  content: 'Implement the Requirements database view using Plan Item governed source-object data.',
  author_actor_id: techLeadActorId,
  created_at: '2026-05-18T00:17:40.000Z',
} satisfies ExecutionPlanRevision;

const executionPackage = {
  id: 'pkg-demo-seed-visual-review-v1',
  work_item_id: 'req-plan-item-governance',
  development_plan_item_id: 'dpi-demo-seed-visual-review',
  execution_id: 'exec-demo-seed-visual-review',
  spec_id: spec.id,
  spec_revision_id: specRevision.id,
  execution_plan_id: executionPlan.id,
  execution_plan_revision_id: executionPlanRevision.id,
  plan_id: plan.id,
  plan_revision_id: planRevision.id,
  project_id: productArchitectureDemoSeedId,
  repo_id: repoId,
  objective: 'Seed demo project state execution boundary',
  owner_actor_id: executionOwnerActorId,
  reviewer_actor_id: reviewerActorId,
  qa_owner_actor_id: qaActorId,
  phase: 'review',
  activity_state: 'idle',
  gate_state: 'awaiting_human_review',
  resolution: 'none',
  required_checks: [
    {
      check_id: 'web-typecheck',
      display_name: 'Web typecheck',
      command: 'pnpm --filter @forgeloop/web typecheck',
      timeout_seconds: 600,
      blocks_review: true,
    },
  ],
  required_test_gates: [],
  required_artifact_kinds: ['diff', 'check_output'],
  allowed_paths: ['tests/web/fixtures/**', 'tests/e2e/helpers/**', 'scripts/**'],
  forbidden_paths: ['apps/control-plane-api/**'],
  source_mutation_policy: 'path_policy_scoped',
  version: 1,
  last_run_session_id: 'run-demo-seed-visual-review',
  current_run_session_id: 'run-demo-seed-visual-review',
  current_review_packet_id: 'review-cockpit-requested-changes',
  current_release_id: 'rel-product-architecture-preview',
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
} satisfies ExecutionPackage;

const runSession = {
  id: 'run-demo-seed-visual-review',
  execution_package_id: executionPackage.id,
  requested_by_actor_id: executionPackage.owner_actor_id,
  status: 'succeeded',
  executor_type: 'mock',
  changed_files: [{ repo_id: repoId, path: 'tests/web/fixtures/product-data.ts', change_kind: 'modified' }],
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
      name: 'product-architecture-demo-seed.diff',
      content_type: 'text/x-diff',
      storage_uri: 'memory://product-architecture-demo-seed.diff',
    },
  ],
  log_refs: [],
  summary: 'Demo seed visual review data passed deterministic checks.',
  created_at: '2026-05-18T00:24:00.000Z',
  updated_at: '2026-05-18T00:25:00.000Z',
  started_at: '2026-05-18T00:24:00.000Z',
  finished_at: '2026-05-18T00:25:00.000Z',
} satisfies RunSession;

const reviewPacket = {
  id: 'review-cockpit-requested-changes',
  run_session_id: runSession.id,
  execution_package_id: executionPackage.id,
  reviewer_actor_id: reviewerActorId,
  spec_revision_id: specRevision.id,
  plan_revision_id: planRevision.id,
  status: 'completed',
  decision: 'changes_requested',
  summary: 'Requested changes on Cockpit layout density',
  changed_files: runSession.changed_files,
  check_result_summary: 'All required product checks passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Product architecture demo data is seeded, with Cockpit density still under review.',
    spec_plan_alignment: 'Aligned with the approved product architecture preview documents.',
    test_assessment: 'Focused hook and state checks pass.',
    risk_notes: ['Product Lane fixtures remain contract-shaped'],
    follow_up_questions: [],
  },
  risk_notes: ['Generic WorkspacePage debt still blocks the final visual rebuild review'],
  requested_changes: [
    {
      title: 'Tighten Cockpit information hierarchy',
      description: 'Reduce vertical sprawl in Cockpit command sections.',
      severity: 'major',
      suggested_validation: 'Review desktop and mobile Cockpit screenshots.',
    },
  ],
  reviewed_by_actor_id: reviewerActorId,
  reviewed_at: '2026-05-18T00:30:00.000Z',
  completed_at: '2026-05-18T00:30:00.000Z',
  created_at: '2026-05-18T00:28:00.000Z',
  updated_at: '2026-05-18T00:30:00.000Z',
} satisfies ReviewPacket;

const execution = {
  id: 'exec-demo-seed-visual-review',
  development_plan_item_id: 'dpi-demo-seed-visual-review',
  execution_plan_revision_id: executionPlanRevision.id,
  approved_spec_revision_id: specRevision.id,
  approved_spec_revision_ref: { type: 'spec_revision', id: specRevision.id, spec_id: spec.id, title: specRevision.summary },
  ref: { type: 'execution', id: 'exec-demo-seed-visual-review', title: 'Codex worker is seeding visual review data' },
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: 'dpi-demo-seed-visual-review',
    development_plan_id: developmentPlanId,
    title: 'Seed demo project state for visual review',
  },
  execution_plan_revision_ref: {
    type: 'execution_plan_revision',
    id: executionPlanRevision.id,
    execution_plan_id: executionPlan.id,
    title: executionPlanRevision.summary,
  },
  status: 'running',
  worker_state: 'running',
  current_step: 'Seeding deterministic product architecture fixture data',
  source_ref: sourceRef,
  evidence_refs: [{ type: 'execution', id: 'evidence-exec-demo-seed-checks', title: 'Demo seed fixture checks' }],
  runtime_evidence_refs: [{ type: 'execution_package', id: executionPackage.id, title: executionPackage.objective }],
  pr_refs: [{ id: 'pr-product-architecture-preview', title: 'Product architecture preview data PR' }],
  diff_refs: [{ id: 'diff-demo-seed-visual-review', title: 'Demo seed fixture diff' }],
  test_evidence_refs: [{ id: 'test-demo-seed-visual-review', title: 'Focused demo seed tests' }],
  interrupt_history: [{ at: '2026-05-18T00:21:00.000Z', reason: 'Paused for review checkpoint' }],
  continuation_history: [{ at: '2026-05-18T00:22:00.000Z', summary: 'Continued after checkpoint' }],
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
} satisfies Execution;

const codeReviewHandoff = {
  id: 'review-cockpit-requested-changes',
  ref: { type: 'code_review_handoff', id: 'review-cockpit-requested-changes', title: 'Requested changes on Cockpit layout density' },
  execution_id: execution.id,
  development_plan_item_id: 'dpi-cockpit-command-center',
  execution_plan_revision_id: executionPlanRevision.id,
  reviewer_actor_id: reviewerActorId,
  status: 'changes_requested',
  summary: 'Cockpit layout density needs tighter information hierarchy before visual review approval.',
  changed_surfaces: ['apps/web/src/features/cockpit', 'tests/web/fixtures'],
  verification_evidence_refs: [{ type: 'execution', id: execution.id, title: execution.ref.title }],
  created_at: '2026-05-18T00:28:00.000Z',
  updated_at: '2026-05-18T00:30:00.000Z',
} satisfies CodeReviewHandoff;

const qaHandoff = {
  id: 'qa-requirements-authoring-mdx',
  ref: { type: 'qa_handoff', id: 'qa-requirements-authoring-mdx', title: 'QA pending MDX image insertion acceptance' },
  code_review_handoff_id: codeReviewHandoff.id,
  execution_id: execution.id,
  source_ref: sourceRef,
  development_plan_item_id: 'dpi-requirements-database-view',
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: 'dpi-requirements-database-view',
    development_plan_id: developmentPlanId,
    title: 'Replace Requirements list with database view',
  },
  approved_spec_revision_ref: { type: 'spec_revision', id: specRevision.id, spec_id: spec.id, title: specRevision.summary },
  approved_execution_plan_revision_ref: execution.execution_plan_revision_ref,
  status: 'pending',
  acceptance_criteria: ['MDX image insertion acceptance is visible from Requirements authoring'],
  test_strategy: 'Run fixture and route smoke tests for the Requirements database view.',
  verification_evidence_refs: [{ type: 'execution', id: execution.id, title: execution.ref.title }],
  known_risks: [],
  changed_surfaces: codeReviewHandoff.changed_surfaces,
  release_impact: 'release_scoped',
  created_at: '2026-05-18T00:31:00.000Z',
  updated_at: '2026-05-18T00:31:00.000Z',
} satisfies QaHandoff;

const release = {
  id: 'rel-product-architecture-preview',
  org_id: orgId,
  project_id: productArchitectureDemoSeedId,
  title: 'Product architecture preview release',
  scope_summary: 'Seeded source objects, Plan Items, execution, review, QA, and release data for visual review.',
  release_owner_actor_id: releaseOwnerActorId,
  release_type: 'standard',
  phase: 'approval',
  activity_state: 'idle',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  work_item_ids: ['req-plan-item-governance', 'bug-execution-review-context', 'td-retire-workspace-page-template'],
  execution_package_ids: [executionPackage.id],
  rollout_strategy: 'Use seeded data for product architecture visual review before UI layout migrations.',
  rollback_plan: 'Revert the seeded fixture data and preview script.',
  observation_plan: 'Watch visual route screenshots for generic template debt.',
  extra: {
    project_management_scope_refs: [
      sourceRef,
      { type: 'development_plan_item', id: 'dpi-demo-seed-visual-review', development_plan_id: developmentPlanId, title: 'Seed demo project state for visual review' },
      { type: 'bug', id: 'bug-execution-review-context', title: 'Execution continuation loses review context' },
    ],
    current_spec_revision_id: specRevision.id,
    current_plan_revision_id: planRevision.id,
  },
  created_by_actor_id: ownerActorId,
  updated_by_actor_id: ownerActorId,
  created_at: '2026-05-18T00:35:00.000Z',
  updated_at: '2026-05-18T00:36:00.000Z',
} satisfies Release;

const releaseEvidences = [
  releaseEvidence({
    id: 'release-evidence-review',
    evidence_type: 'review_packet',
    summary: 'Code review captured Cockpit density changes requested.',
    object_ref: {
      object_type: 'review_packet',
      object_id: reviewPacket.id,
      relationship: 'blocks',
    },
    extra: {
      scope_ref: { type: 'development_plan_item', id: 'dpi-demo-seed-visual-review', development_plan_id: developmentPlanId, title: 'Seed demo project state for visual review' },
      authority_type: 'code_review_handoff_approval',
      status: 'approved',
      code_review_handoff_id: codeReviewHandoff.id,
      execution_id: execution.id,
      spec_revision_id: specRevision.id,
      plan_revision_id: planRevision.id,
    },
  }),
  releaseEvidence({
    id: 'release-evidence-package-run',
    evidence_type: 'test_report',
    summary: 'Demo seed package run completed with focused checks.',
    object_ref: {
      object_type: 'run_session',
      object_id: runSession.id,
      relationship: 'generated_by',
    },
    extra: {
      scope_ref: { type: 'development_plan_item', id: 'dpi-demo-seed-visual-review', development_plan_id: developmentPlanId, title: 'Seed demo project state for visual review' },
      evidence_type: 'test_acceptance',
      status: 'passed',
      execution_id: execution.id,
      spec_revision_id: specRevision.id,
      plan_revision_id: planRevision.id,
    },
  }),
] satisfies ReleaseEvidence[];

function actor(id: string, displayName: string, email: string): Actor {
  return {
    id,
    org_id: orgId,
    display_name: displayName,
    actor_type: 'human',
    email,
    created_at: now,
    updated_at: now,
  };
}

function sourceWorkItem(input: {
  current_plan_id?: string;
  current_plan_revision_id?: string;
  current_release_id?: string;
  current_spec_id?: string;
  current_spec_revision_id?: string;
  id: string;
  intake_context: WorkItem['intake_context'];
  kind: WorkItem['kind'];
  narrative: string;
  phase: WorkItem['phase'];
  priority: string;
  risk: string;
  title: string;
  updated_at: string;
}): WorkItem {
  return {
    id: input.id,
    project_id: productArchitectureDemoSeedId,
    kind: input.kind,
    title: input.title,
    narrative_markdown: input.narrative,
    goal: `${input.title} is visible in the product architecture review flow.`,
    success_criteria: ['Seeded product data is visible.', 'Plan Item governed flow is reviewable.'],
    priority: input.priority,
    risk: input.risk,
    driver_actor_id: ownerActorId,
    intake_context: input.intake_context,
    phase: input.phase,
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    ...(input.current_spec_id === undefined ? {} : { current_spec_id: input.current_spec_id }),
    ...(input.current_spec_revision_id === undefined ? {} : { current_spec_revision_id: input.current_spec_revision_id }),
    ...(input.current_plan_id === undefined ? {} : { current_plan_id: input.current_plan_id }),
    ...(input.current_plan_revision_id === undefined ? {} : { current_plan_revision_id: input.current_plan_revision_id }),
    ...(input.current_release_id === undefined ? {} : { current_release_id: input.current_release_id }),
    created_at: now,
    updated_at: input.updated_at,
  };
}

function planItem(input: {
  affected_surfaces: string[];
  boundary_status: DevelopmentPlanItem['boundary_status'];
  execution_plan_status: DevelopmentPlanItem['execution_plan_status'];
  execution_status: DevelopmentPlanItem['execution_status'];
  id: string;
  next_action: string;
  qa_handoff_status: DevelopmentPlanItem['qa_handoff_status'];
  review_status: DevelopmentPlanItem['review_status'];
  revision_id: string;
  spec_status: DevelopmentPlanItem['spec_status'];
  summary: string;
  title: string;
}): DevelopmentPlanItem {
  return {
    id: input.id,
    development_plan_id: developmentPlanId,
    revision_id: input.revision_id,
    source_ref: sourceRef,
    title: input.title,
    summary: input.summary,
    driver_actor_id: ownerActorId,
    responsible_role: 'developer',
    reviewer_actor_id: reviewerActorId,
    leader_actor_id: reviewerActorId,
    leader_delegate_actor_ids: [techLeadActorId],
    risk: input.id === 'dpi-development-plan-table-inspector' ? 'high' : 'medium',
    dependency_hints: ['Task 1 route contracts are committed'],
    affected_surfaces: input.affected_surfaces,
    boundary_status: input.boundary_status,
    spec_status: input.spec_status,
    execution_plan_status: input.execution_plan_status,
    execution_status: input.execution_status,
    review_status: input.review_status,
    qa_handoff_status: input.qa_handoff_status,
    release_impact: 'release_scoped',
    next_action: input.next_action,
    created_at: '2026-05-18T00:18:00.000Z',
    updated_at: '2026-05-18T00:19:00.000Z',
  };
}

function developmentPlanItemRevision(item: DevelopmentPlanItem): DevelopmentPlanItemRevision {
  return {
    id: item.revision_id,
    development_plan_item_id: item.id,
    development_plan_id: item.development_plan_id,
    revision_number: 1,
    snapshot: item,
    change_reason: 'Seed product architecture preview item.',
    edited_by_actor_id: techLeadActorId,
    created_at: item.updated_at,
  };
}

function releaseEvidence(input: {
  evidence_type: ReleaseEvidence['evidence_type'];
  extra: Record<string, unknown>;
  id: string;
  object_ref: NonNullable<ReleaseEvidence['object_ref']>;
  summary: string;
}): ReleaseEvidence {
  return {
    id: input.id,
    org_id: orgId,
    project_id: productArchitectureDemoSeedId,
    release_id: release.id,
    title: input.summary,
    evidence_type: input.evidence_type,
    summary: input.summary,
    object_ref: input.object_ref,
    extra: input.extra,
    redacted: false,
    status: 'current',
    visibility: 'internal',
    source_type: 'product_architecture_demo_seed',
    labels: ['product-architecture-demo'],
    created_at: '2026-05-18T00:36:00.000Z',
    created_by_actor_id: ownerActorId,
    updated_at: '2026-05-18T00:36:00.000Z',
    updated_by_actor_id: ownerActorId,
  };
}
