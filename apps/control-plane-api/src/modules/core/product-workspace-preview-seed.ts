import type { DeliveryRepository } from '@forgeloop/db';
import type {
  Actor,
  Attachment,
  BoundarySummary,
  BoundarySummaryRevision,
  CodeReviewHandoff,
  CodexRuntimeCapsule,
  CodexSessionTurn,
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
  PlanItemWorkflowQueuedAction,
  PlanItemWorkflowTransition,
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
  WorkflowManualDecision,
  WorkItem,
} from '@forgeloop/domain';
import { buildPlanItemWorkflowQueuedActionIdempotencyKey, codexCanonicalDigest } from '@forgeloop/domain';

export const productWorkspacePreviewSeedId = 'project-product-workspace-preview';

const now = '2026-05-18T00:00:00.000Z';
const orgId = 'org-product-workspace-preview';
const ownerActorId = 'actor-owner';
const reviewerActorId = 'actor-reviewer';
const techLeadActorId = 'actor-tech-lead';
const qaActorId = 'actor-qa';
const releaseOwnerActorId = 'actor-release-owner';
const executionOwnerActorId = 'actor-execution-owner';
const repoId = 'forgeloop';
const developmentPlanId = 'dp-product-workspace-core-surface-redesign';
const releaseRiskClosureDevelopmentPlanId = 'dp-release-risk-closure';

export async function seedProductWorkspacePreviewRepository(repository: DeliveryRepository): Promise<void> {
  await repository.saveOrganization(organization);
  for (const actor of actors) {
    await repository.saveActor(actor);
  }
  await repository.saveProject(project);
  await repository.saveProjectRepo(projectRepo);
  await repository.saveAttachment(requirementFlowAttachment);

  for (const workItem of sourceInputs) {
    await repository.saveWorkItem(workItem);
  }

  for (const plan of developmentPlans) {
    await repository.saveDevelopmentPlan(plan);
  }
  for (const revision of developmentPlanRevisions) {
    await repository.saveDevelopmentPlanRevision(revision);
  }
  for (const link of developmentPlanSourceLinks) {
    await repository.saveDevelopmentPlanSourceLink(link);
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
  await seedPlanItemWorkflowPreview(repository);
  await repository.saveExecutionPackage(executionPackage);
  await repository.saveRunSession(runSession);
  await repository.saveReviewPacket(reviewPacket);
  for (const seededExecution of executions) {
    await repository.saveExecution(seededExecution);
  }
  await repository.saveCodeReviewHandoff(codeReviewHandoff);
  for (const handoff of qaHandoffs) {
    await repository.saveQaHandoff(handoff);
  }
  await repository.saveRelease(release);
  for (const evidence of releaseEvidences) {
    await repository.saveReleaseEvidence(evidence);
  }
}

const organization = {
  id: orgId,
  name: 'ForgeLoop Product Workspace Preview',
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
  id: productWorkspacePreviewSeedId,
  org_id: orgId,
  key: 'PRODUCT-WS',
  name: 'ForgeLoop product workspace preview',
  repo_ids: [repoId],
  created_at: now,
  updated_at: '2026-05-18T00:40:00.000Z',
} satisfies Project;

const projectRepo = {
  id: 'project-repo-product-workspace',
  repo_id: repoId,
  org_id: orgId,
  project_id: productWorkspacePreviewSeedId,
  name: 'forgeloop',
  status: 'active',
  local_path: process.cwd(),
  default_branch: 'main',
  base_commit_sha: 'product-workspace-preview',
  created_at: now,
  updated_at: now,
} satisfies ProjectRepo;

const sourceInputs = [
  sourceWorkItem({
    id: 'req-product-workspace-clarity',
    kind: 'requirement',
    title: 'Product workspace clarity and route-backed context',
    narrative:
      'Product teams need the workspace to explain what is ready, blocked, and owned from typed planning input to release.',
    priority: 'critical',
    risk: 'medium',
    phase: 'spec',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Product operators need route-backed planning, gate, execution, review, QA, and release context.',
      desired_outcome: 'Every planning input route opens with deterministic product workspace context.',
      acceptance_criteria: ['Typed document routes expose planning coverage.', 'Plan Item gates expose eligible next actions only.'],
      in_scope: ['Typed document workspaces', 'Development Plan routes', 'Plan Item gates'],
      out_of_scope: ['Top-level Task route', 'Direct planning input execution'],
    },
    current_spec_id: 'spec-cockpit-command-center',
    current_spec_revision_id: 'specrev-cockpit-command-center-v1',
    current_plan_id: 'plan-requirements-database-view',
    current_plan_revision_id: 'planrev-requirements-database-view-v1',
    current_release_id: 'rel-product-workspace-preview',
    updated_at: '2026-05-18T01:00:00.000Z',
  }),
  sourceWorkItem({
    id: 'req-ai-native-delivery-flow',
    kind: 'requirement',
    title: 'AI-native delivery flow from source to release',
    narrative:
      'The AI-native delivery flow keeps Development Plan and Plan Item gates as the visible bridge between planning inputs and execution.',
    priority: 'high',
    risk: 'medium',
    phase: 'plan',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Leads need planning inputs to move through governed plans instead of direct execution shortcuts.',
      desired_outcome: 'Every delivery path is visible as planning input, Development Plan, Plan Item, Spec, Plan, execution, review, QA, and release.',
      acceptance_criteria: ['Development Plan routes show typed document coverage.', 'Plan Item routes expose gate-specific next actions.'],
      in_scope: ['AI-native delivery flow', 'Development Plan governance', 'Plan Item gate visibility'],
      out_of_scope: ['Structured executable task extraction'],
    },
    current_release_id: 'rel-product-workspace-preview',
    updated_at: '2026-05-18T01:05:00.000Z',
  }),
  sourceWorkItem({
    id: 'req-qa-shift-left',
    kind: 'requirement',
    title: 'Shift-left QA participation before execution',
    narrative:
      'Release-impacting Plan Items need QA strategy and owner participation visible before Implementation Plan Doc authoring is approved.',
    priority: 'critical',
    risk: 'high',
    phase: 'spec',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'QA owners cannot assess release risk if test strategy appears only after execution finishes.',
      desired_outcome: 'Spec review shows QA participation and test strategy before Implementation Plan Doc authoring starts.',
      acceptance_criteria: ['QA strategy is visible on release-impacting Plan Items.', 'Execution remains gated when QA participation is blocked.'],
      in_scope: ['Spec review QA strategy', 'QA owner visibility', 'Release-impacting Plan Item gates'],
      out_of_scope: ['Automated test authoring'],
    },
    current_release_id: 'rel-product-workspace-preview',
    updated_at: '2026-05-18T01:06:00.000Z',
  }),
  sourceWorkItem({
    id: 'req-release-readiness',
    kind: 'requirement',
    title: 'Release readiness blocks on missing evidence',
    narrative:
      'Release owners need readiness to stay disabled while review, QA, or observation evidence is missing or blocked.',
    priority: 'critical',
    risk: 'high',
    phase: 'release',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Release owners need product-safe blockers when required evidence is absent.',
      desired_outcome: 'Release readiness shows a clear blocker until QA and observation evidence are accepted.',
      acceptance_criteria: ['Release readiness is disabled when QA is blocked.', 'Blocked release evidence points back to the Plan Item.'],
      in_scope: ['Release readiness gates', 'QA evidence blockers', 'Plan Item-scoped release evidence'],
      out_of_scope: ['Production deployment automation'],
    },
    current_release_id: 'rel-product-workspace-preview',
    updated_at: '2026-05-18T01:07:00.000Z',
  }),
  sourceWorkItem({
    id: 'init-product-workspace-redesign',
    kind: 'initiative',
    title: 'Product workspace redesign rollout',
    narrative:
      'Coordinate typed document, Development Plan, Plan Item gate, QA, and release route improvements.',
    priority: 'high',
    risk: 'medium',
    phase: 'triage',
    intake_context: {
      type: 'initiative',
      business_outcome: 'Coordinate the product workspace redesign rollout.',
      scope_narrative: 'Coordinate product workspace preview work across all route families.',
      success_metrics: ['Seeded route screenshots show product workspace state'],
      milestone_intent: 'Product workspace preview readiness',
    },
    current_release_id: 'rel-product-workspace-preview',
    updated_at: '2026-05-18T01:01:00.000Z',
  }),
  sourceWorkItem({
    id: 'td-retire-generic-product-page',
    kind: 'tech_debt',
    title: 'Retire generic ProductPage visual fallback',
    narrative: 'Generic ProductPage composition prevents route-specific density, gate context, and visual hierarchy.',
    priority: 'medium',
    risk: 'medium',
    phase: 'plan',
    intake_context: {
      type: 'tech_debt',
      current_pain: 'Generic ProductPage composition prevents route-specific density and gate context.',
      desired_invariant: 'Core product routes use page-family-specific workspace shells.',
      affected_modules: ['apps/web/src/shared/layout', 'apps/web/src/features/product-surfaces'],
      behavior_preservation: 'Canonical route behavior is preserved.',
      validation_strategy: 'Visual route geometry and screenshot gates pass.',
    },
    current_release_id: 'rel-product-workspace-preview',
    updated_at: '2026-05-18T01:02:00.000Z',
  }),
  sourceWorkItem({
    id: 'bug-plan-item-action-eligibility',
    kind: 'bug',
    title: 'Plan Item action eligibility exposes premature execution',
    narrative: 'Plan Item actions must remain disabled until required boundary, Spec, Implementation Plan Doc, QA, and package evidence is present.',
    priority: 'critical',
    risk: 'high',
    phase: 'execution',
    intake_context: {
      type: 'bug',
      impact_summary: 'Plan Item actions can appear available before all gate evidence is complete.',
      observed_behavior: 'The Plan Item route exposes execution affordances before QA participation is recorded.',
      expected_behavior: 'Execution actions remain disabled until all required gate evidence is complete.',
      reproduction_steps: ['Open the Plan Item gate route', 'Inspect execution action eligibility before QA participation'],
      affected_environment: 'Product workspace preview',
      verification_path: 'Seeded route screenshot review',
    },
    current_release_id: 'rel-product-workspace-preview',
    updated_at: '2026-05-18T01:04:00.000Z',
  }),
] satisfies WorkItem[];

const sourceRef = {
  type: 'requirement',
  id: 'req-product-workspace-clarity',
  title: 'Product workspace clarity and route-backed context',
} as const;

const aiNativeDeliveryFlowSourceRef = {
  type: 'requirement',
  id: 'req-ai-native-delivery-flow',
  title: 'AI-native delivery flow from source to release',
} as const;

const qaShiftLeftSourceRef = {
  type: 'requirement',
  id: 'req-qa-shift-left',
  title: 'Shift-left QA participation before execution',
} as const;

const releaseReadinessSourceRef = {
  type: 'requirement',
  id: 'req-release-readiness',
  title: 'Release readiness blocks on missing evidence',
} as const;

const bugSourceRef = {
  type: 'bug',
  id: 'bug-plan-item-action-eligibility',
  title: 'Plan Item action eligibility exposes premature execution',
} as const;

const techDebtSourceRef = {
  type: 'tech_debt',
  id: 'td-retire-generic-product-page',
  title: 'Retire generic ProductPage visual fallback',
} as const;

const requirementFlowAttachment = {
  id: 'att-requirement-flow-image',
  owner_object_type: 'requirement',
  owner_object_id: sourceRef.id,
  linked_object_refs: [
    sourceRef,
    { type: 'development_plan', id: developmentPlanId, title: 'Product workspace core surface redesign' },
  ],
  filename: 'plan-item-generation-flow.png',
  content_type: 'image/png',
  size_bytes: 42784,
  storage_uri: 'memory://product-workspace-preview/plan-item-generation-flow.png',
  checksum_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  uploaded_by_actor_id: ownerActorId,
  created_at: '2026-05-18T01:03:00.000Z',
  evidence_category: 'image',
  caption: 'Development Plan and Plan Item generation flow for product workspace review.',
  alt_text: 'Plan Item generation flow',
  visibility: 'object',
  safety_status: 'passed',
  reference_status: 'active',
} satisfies Attachment;

const primaryDevelopmentPlanItems = [
  planItem({
    id: 'dpi-cockpit-command-center',
    revision_id: 'dpirev-cockpit-command-center-v1',
    title: 'Rebuild Cockpit into operational command center',
    summary: 'Replace generic cockpit composition with operational delivery, review, and risk signals.',
    affected_surfaces: ['apps/web/src/features/cockpit'],
    boundary_status: 'approved',
    spec_status: 'in_review',
    implementation_plan_status: 'missing',
    execution_status: 'not_started',
    review_status: 'changes_requested',
    qa_handoff_status: 'missing',
    next_action: 'Resolve Spec review comments on Cockpit layout density.',
  }),
  planItem({
    id: 'dpi-requirements-database-view',
    revision_id: 'dpirev-requirements-database-view-v1',
    title: 'Replace Requirements list with database view',
    summary: 'Turn Requirements into a document-workspace database with generation and evidence affordances.',
    affected_surfaces: ['apps/web/src/features/requirements'],
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'approved',
    execution_status: 'ready',
    review_status: 'missing',
    qa_handoff_status: 'in_review',
    next_action: 'Use the approved Implementation Plan Doc to start database view implementation.',
  }),
  planItem({
    id: 'dpi-product-workspace-preview-state',
    revision_id: 'dpirev-product-workspace-preview-state-v1',
    title: 'Seed product workspace state for visual review',
    summary: 'Seed deterministic product workspace data for visual route review.',
    affected_surfaces: ['tests/web/fixtures', 'tests/e2e/helpers', 'scripts'],
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'approved',
    execution_status: 'running',
    review_status: 'in_review',
    qa_handoff_status: 'in_review',
    next_action: 'Resume the execution with seeded product workspace data.',
  }),
  planItem({
    id: 'dpi-development-plan-table-inspector',
    revision_id: 'dpirev-development-plan-table-inspector-v1',
    title: 'Rewrite Development Plan table and inspector',
    summary: 'Replace the generic table detail with a dense plan table and inspector workflow.',
    affected_surfaces: ['apps/web/src/features/development-plans'],
    source_ref: techDebtSourceRef,
    boundary_status: 'changes_requested',
    spec_status: 'blocked',
    implementation_plan_status: 'blocked',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'missing',
    next_action: 'Unblock the Plan Item boundary before authoring documents.',
  }),
  planItem({
    id: 'dpi-typed-document-boundary',
    revision_id: 'dpirev-typed-document-boundary-v1',
    title: 'Define typed document workspace boundaries',
    summary: 'Lock Requirement, Initiative, Bug, and Tech Debt routes to typed document workspaces.',
    affected_surfaces: ['apps/web/src/features/project-management'],
    source_ref: aiNativeDeliveryFlowSourceRef,
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'approved',
    execution_status: 'completed',
    review_status: 'approved',
    qa_handoff_status: 'in_review',
    next_action: 'Keep source workspace routes aligned with the canonical route contract.',
  }),
  planItem({
    id: 'dpi-plan-item-gate-eligibility',
    revision_id: 'dpirev-plan-item-gate-eligibility-v1',
    title: 'Enforce Plan Item action eligibility',
    summary: 'Disable execution until boundary, Spec, Implementation Plan Doc, QA, and package evidence are present.',
    affected_surfaces: ['apps/web/src/features/development-plans/plan-item-gates.tsx'],
    source_ref: bugSourceRef,
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'in_review',
    execution_status: 'paused',
    review_status: 'changes_requested',
    qa_handoff_status: 'blocked',
    risk: 'high',
    next_action: 'Resolve action eligibility review changes before execution.',
  }),
  planItem({
    id: 'dpi-qa-shift-left-strategy',
    revision_id: 'dpirev-qa-shift-left-strategy-v1',
    title: 'Expose QA strategy before Implementation Plan Doc authoring',
    summary: 'Make QA owner participation visible before release-impacting execution starts.',
    affected_surfaces: ['apps/web/src/features/qa'],
    source_ref: qaShiftLeftSourceRef,
    boundary_status: 'approved',
    spec_status: 'in_review',
    implementation_plan_status: 'missing',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'in_review',
    risk: 'high',
    next_action: 'Review Spec test strategy with QA owner.',
  }),
] satisfies DevelopmentPlanItem[];

const releaseRiskClosureDevelopmentPlanItems = [
  planItem({
    development_plan_id: releaseRiskClosureDevelopmentPlanId,
    id: 'dpi-release-blocker-closure',
    revision_id: 'dpirev-release-blocker-closure-v1',
    title: 'Close release blocker evidence',
    summary: 'Collect QA and observation evidence required for release readiness.',
    affected_surfaces: ['apps/web/src/features/releases'],
    source_ref: releaseReadinessSourceRef,
    boundary_status: 'approved',
    spec_status: 'approved',
    implementation_plan_status: 'approved',
    execution_status: 'interrupted',
    review_status: 'approved',
    qa_handoff_status: 'blocked',
    release_impact: 'release_blocking',
    risk: 'critical',
    next_action: 'Resume interrupted execution after QA owner resolves blocker.',
  }),
] satisfies DevelopmentPlanItem[];

const developmentPlanItems = [...primaryDevelopmentPlanItems, ...releaseRiskClosureDevelopmentPlanItems] satisfies DevelopmentPlanItem[];

const developmentPlan = {
  id: developmentPlanId,
  project_id: productWorkspacePreviewSeedId,
  revision_id: 'dprev-product-workspace-core-surface-redesign-v1',
  title: 'Product workspace core surface redesign',
  status: 'active',
  source_refs: [sourceRef, aiNativeDeliveryFlowSourceRef, qaShiftLeftSourceRef, bugSourceRef, techDebtSourceRef],
  items: primaryDevelopmentPlanItems,
  created_at: '2026-05-18T00:11:00.000Z',
  updated_at: '2026-05-18T00:19:00.000Z',
} satisfies DevelopmentPlan;

const releaseRiskClosureDevelopmentPlan = {
  id: releaseRiskClosureDevelopmentPlanId,
  project_id: productWorkspacePreviewSeedId,
  revision_id: 'dprev-release-risk-closure-v1',
  title: 'Release risk closure',
  status: 'active',
  source_refs: [releaseReadinessSourceRef],
  items: releaseRiskClosureDevelopmentPlanItems,
  created_at: '2026-05-18T00:34:00.000Z',
  updated_at: '2026-05-18T00:39:00.000Z',
} satisfies DevelopmentPlan;

const developmentPlans = [developmentPlan, releaseRiskClosureDevelopmentPlan] satisfies DevelopmentPlan[];

const developmentPlanRevision = {
  id: developmentPlan.revision_id,
  development_plan_id: developmentPlan.id,
  revision_number: 1,
  title: developmentPlan.title,
  status: developmentPlan.status,
  source_refs: developmentPlan.source_refs,
  item_refs: developmentPlan.items.map((item) => ({
    id: item.id,
    revision_id: item.revision_id,
    title: item.title,
    boundary_status: item.boundary_status,
    spec_status: item.spec_status,
    implementation_plan_status: item.implementation_plan_status,
    execution_status: item.execution_status,
  })),
  generation_state: 'draft_generated',
  change_reason: 'Seed product workspace preview data.',
  actor_id: techLeadActorId,
  created_at: '2026-05-18T00:19:00.000Z',
} satisfies DevelopmentPlanRevision;

const releaseRiskClosureDevelopmentPlanRevision = {
  id: releaseRiskClosureDevelopmentPlan.revision_id,
  development_plan_id: releaseRiskClosureDevelopmentPlan.id,
  revision_number: 1,
  title: releaseRiskClosureDevelopmentPlan.title,
  status: releaseRiskClosureDevelopmentPlan.status,
  source_refs: releaseRiskClosureDevelopmentPlan.source_refs,
  item_refs: releaseRiskClosureDevelopmentPlan.items.map((item) => ({
    id: item.id,
    revision_id: item.revision_id,
    title: item.title,
    boundary_status: item.boundary_status,
    spec_status: item.spec_status,
    implementation_plan_status: item.implementation_plan_status,
    execution_status: item.execution_status,
  })),
  generation_state: 'draft_generated',
  change_reason: 'Seed release-risk closure preview data.',
  actor_id: techLeadActorId,
  created_at: '2026-05-18T00:39:00.000Z',
} satisfies DevelopmentPlanRevision;

const developmentPlanRevisions = [
  developmentPlanRevision,
  releaseRiskClosureDevelopmentPlanRevision,
] satisfies DevelopmentPlanRevision[];

const developmentPlanSourceLinks = [
  {
    id: 'dpsl-product-workspace-requirement',
    development_plan_id: developmentPlanId,
    source_ref: sourceRef,
    link_type: 'primary',
    rationale: 'Requirement owns the product workspace preview Development Plan.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:11:00.000Z',
  },
  {
    id: 'dpsl-ai-native-delivery-flow',
    development_plan_id: developmentPlanId,
    source_ref: aiNativeDeliveryFlowSourceRef,
    link_type: 'related',
    rationale: 'AI-native delivery flow is implemented through the core workspace plan.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:12:00.000Z',
  },
  {
    id: 'dpsl-qa-shift-left',
    development_plan_id: developmentPlanId,
    source_ref: qaShiftLeftSourceRef,
    link_type: 'related',
    rationale: 'QA shift-left visibility is part of the Plan Item gate redesign.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:13:00.000Z',
  },
  {
    id: 'dpsl-plan-item-action-eligibility-bug',
    development_plan_id: developmentPlanId,
    source_ref: bugSourceRef,
    link_type: 'related',
    rationale: 'Action eligibility bug is closed through Plan Item gate enforcement.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:14:00.000Z',
  },
  {
    id: 'dpsl-generic-product-page-tech-debt',
    development_plan_id: developmentPlanId,
    source_ref: techDebtSourceRef,
    link_type: 'related',
    rationale: 'Generic ProductPage debt is removed by page-family shell work.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:15:00.000Z',
  },
  {
    id: 'dpsl-release-readiness-risk-closure',
    development_plan_id: releaseRiskClosureDevelopmentPlanId,
    source_ref: releaseReadinessSourceRef,
    link_type: 'primary',
    rationale: 'Release readiness owns the release-risk closure plan.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:34:00.000Z',
  },
] satisfies DevelopmentPlanSourceLink[];

const spec = {
  id: 'spec-cockpit-command-center',
  work_item_id: 'req-product-workspace-clarity',
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
  background: 'The product workspace rebuild replaces generic route shells with purpose-built surfaces.',
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
  work_item_id: 'req-product-workspace-clarity',
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
  summary: 'Requirements database view Implementation Plan Doc',
  content: 'Replace the Requirements list with a database view that keeps Plan Item governance visible.',
  implementation_summary: 'Use canonical planning input rows with fixture-backed evidence and generation links.',
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
  id: 'implementation-plan-doc-requirements-database-view',
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
  summary: 'Requirements database view Implementation Plan Doc',
  content: 'Implement the Requirements database view using Plan Item governed document-workspace data.',
  author_actor_id: techLeadActorId,
  created_at: '2026-05-18T00:17:40.000Z',
} satisfies ExecutionPlanRevision;

const workflowPreviewIds = {
  workflow: 'workflow-product-workspace-preview',
  codexSession: 'codex-session-product-workspace-preview',
  turn: 'turn-product-workspace-preview-boundary',
  boundarySummary: 'boundary-summary-product-workspace-preview',
  boundaryRevision: 'boundaryrev-product-workspace-preview-v1',
  spec: 'spec-product-workspace-preview-state',
  specRevision: 'specrev-product-workspace-preview-state-v1',
  executionPlan: 'implementation-plan-doc-product-workspace-preview-state',
  executionPlanRevision: 'planrev-product-workspace-preview-state-v1',
  queuedAction: 'action-generate-spec-doc',
  manualDecision: 'decision-product-workspace-start-brainstorming',
  startTransition: 'transition-product-workspace-start-brainstorming',
  boundaryReviewTransition: 'transition-product-workspace-boundary-review',
  transition: 'transition-product-workspace-boundary-approved',
};

const workflowPreviewItemId = 'dpi-product-workspace-preview-state';
const workflowPreviewItemRevisionId = 'dpirev-product-workspace-preview-state-v1';
const workflowPreviewContextDigest = (part: string) =>
  codexCanonicalDigest({ fixture: 'product_workspace_preview_workflow', part });

async function seedPlanItemWorkflowPreview(repository: DeliveryRepository): Promise<void> {
  const existing = await repository.getActivePlanItemWorkflowByItem(workflowPreviewItemId);
  if (existing !== undefined) {
    return;
  }

  const created = await repository.createPlanItemWorkflowWithInitialSession({
    id: workflowPreviewIds.workflow,
    codex_session_id: workflowPreviewIds.codexSession,
    development_plan_id: developmentPlanId,
    development_plan_item_id: workflowPreviewItemId,
    runtime_profile_id: 'runtime-profile-product-workspace-preview',
    runtime_profile_revision_id: 'runtime-profile-revision-product-workspace-preview',
    credential_binding_id: 'credential-binding-product-workspace-preview',
    credential_binding_version_id: 'credential-binding-revision-product-workspace-preview',
    actor_id: techLeadActorId,
    now: '2026-05-18T00:21:00.000Z',
  });

  const turn: CodexSessionTurn = {
    id: workflowPreviewIds.turn,
    workflow_id: created.workflow.id,
    codex_session_id: created.session.id,
    intent: 'draft_boundary_summary',
    status: 'running',
    input_digest: workflowPreviewContextDigest('boundary_input'),
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:21:20.000Z',
    updated_at: '2026-05-18T00:21:40.000Z',
  };
  await repository.createCodexSessionTurn(turn);

  const workerId = techLeadActorId;
  const workerSessionDigest = workflowPreviewContextDigest('worker_session');
  const leaseTokenHash = workflowPreviewContextDigest('lease_token');
  const lease = await repository.claimCodexSessionLease({
    session_id: created.session.id,
    workflow_id: created.workflow.id,
    lease_id: 'lease-product-workspace-preview-boundary',
    lease_token_hash: leaseTokenHash,
    worker_id: workerId,
    worker_session_digest: workerSessionDigest,
    now: '2026-05-18T00:21:30.000Z',
    expires_at: '2026-05-18T00:22:30.000Z',
  });

  const codexThreadId = 'thread-product-workspace-preview';
  const codexThreadIdDigest = workflowPreviewContextDigest('codex_thread');
  const outputCapsule: CodexRuntimeCapsule = {
    id: 'capsule-product-workspace-preview-boundary',
    codex_session_id: created.session.id,
    created_from_turn_id: turn.id,
    sequence: 1,
    artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${created.session.id}/capsule-product-workspace-preview-boundary`,
    digest: workflowPreviewContextDigest('boundary_capsule'),
    size_bytes: '2048',
    manifest_digest: workflowPreviewContextDigest('boundary_capsule_manifest'),
    thread_state_digest: workflowPreviewContextDigest('boundary_thread_state'),
    memory_state_digest: workflowPreviewContextDigest('boundary_memory_state'),
    environment_manifest_digest: workflowPreviewContextDigest('boundary_environment'),
    codex_thread_id_digest: codexThreadIdDigest,
    codex_cli_version: 'codex-preview-fixture',
    app_server_protocol_digest: workflowPreviewContextDigest('app_server_protocol'),
    runtime_profile_revision_id: created.session.runtime_profile_revision_id,
    trusted_runtime_manifest_digest: workflowPreviewContextDigest('trusted_runtime_manifest'),
    credential_binding_lineage_digest: workflowPreviewContextDigest('credential_binding_lineage'),
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:21:40.000Z',
  };
  const terminal = await repository.terminalizeCodexSessionTurn({
    session_id: created.session.id,
    turn_id: turn.id,
    lease_id: lease.lease.id,
    lease_token_hash: leaseTokenHash,
    lease_epoch: lease.lease.lease_epoch,
    worker_id: workerId,
    worker_session_digest: workerSessionDigest,
    status: 'succeeded',
    output_capsule: outputCapsule,
    output_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${created.session.id}/memory-product-workspace-preview`,
    output_memory_bundle_digest: workflowPreviewContextDigest('output_memory_bundle'),
    output_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${created.session.id}/environment-product-workspace-preview`,
    output_environment_manifest_digest: workflowPreviewContextDigest('output_environment_manifest'),
    output_object_type: 'boundary_summary_revision',
    output_object_id: workflowPreviewIds.boundaryRevision,
    app_server_thread_binding_required: true,
    codex_thread_id: codexThreadId,
    codex_thread_id_digest: codexThreadIdDigest,
    now: '2026-05-18T00:21:40.000Z',
  });
  const completedTurn = terminal.turn;
  const latestCapsuleDigest = completedTurn.output_capsule_digest;
  if (latestCapsuleDigest === undefined) {
    throw new Error('Product workspace preview workflow seed requires a terminal boundary turn capsule digest');
  }

  const boundarySummary = {
    id: workflowPreviewIds.boundarySummary,
    revision_id: workflowPreviewIds.boundaryRevision,
    brainstorming_session_id: 'brainstorming-session-product-workspace-preview',
    brainstorming_session_revision_id: 'brainstorming-session-revision-product-workspace-preview',
    development_plan_id: developmentPlanId,
    development_plan_item_id: workflowPreviewItemId,
    development_plan_item_revision_id: workflowPreviewItemRevisionId,
    source_ref: sourceRef,
    summary: 'Generate the Spec Doc from the approved product workspace preview boundary.',
    approved_by_actor_id: techLeadActorId,
    approved_at: '2026-05-18T00:22:00.000Z',
    created_at: '2026-05-18T00:21:45.000Z',
    updated_at: '2026-05-18T00:22:00.000Z',
  } satisfies BoundarySummary;
  await repository.saveBoundarySummary(boundarySummary);

  const boundaryRevision = {
    id: workflowPreviewIds.boundaryRevision,
    boundary_summary_id: boundarySummary.id,
    session_id: boundarySummary.brainstorming_session_id,
    session_revision_id: boundarySummary.brainstorming_session_revision_id,
    source_round_id: 'boundary-round-product-workspace-preview',
    development_plan_id: developmentPlanId,
    development_plan_item_id: workflowPreviewItemId,
    development_plan_item_revision_id: workflowPreviewItemRevisionId,
    revision_number: 1,
    status: 'approved',
    summary_markdown:
      'Approved boundary: drive the Plan Item through the Superpowers product loop with a queued Spec Doc generation action.',
    confirmed_scope: ['Plan Item Workflow workspace', 'Queued Spec Doc generation', 'Public-safe context preview'],
    confirmed_out_of_scope: ['Execution start', 'RunSession creation', 'Raw Codex session exposure'],
    accepted_assumptions: ['Spec and Implementation Plan documents remain markdown artifacts reviewed by humans.'],
    open_risks: ['Visual review still needs real browser verification.'],
    validation_expectations: ['The Plan Item route renders the chat-first workflow workspace from live API data.'],
    question_answer_snapshot: [
      {
        question_id: 'question-product-workspace-boundary',
        answer_id: 'answer-product-workspace-boundary',
        text: 'The product loop should show approved boundary context and the queued Spec Doc action.',
      },
    ],
    decision_snapshot: [
      {
        decision_id: 'decision-product-workspace-boundary',
        text: 'Queue Spec Doc generation instead of exposing direct generation routes.',
        rationale: 'All Codex-producing turns must run through durable queued actions.',
      },
    ],
    context_manifest_id: 'context-manifest-product-workspace-preview',
    context_manifest_revision_id: 'context-manifest-revision-product-workspace-preview',
    approved_by_actor_id: techLeadActorId,
    approved_at: '2026-05-18T00:22:00.000Z',
    created_at: '2026-05-18T00:21:50.000Z',
    workflow_id: created.workflow.id,
    codex_session_id: created.session.id,
    codex_session_turn_id: completedTurn.id,
  } satisfies BoundarySummaryRevision;
  await repository.saveBoundarySummaryRevision(boundaryRevision);

  await repository.saveSpec(workflowPreviewSpec);
  await repository.saveSpecRevision(workflowPreviewSpecRevision);
  await repository.saveExecutionPlan(workflowPreviewExecutionPlan);
  await repository.saveExecutionPlanRevision(workflowPreviewExecutionPlanRevision);

  const manualDecision = {
    id: workflowPreviewIds.manualDecision,
    workflow_id: created.workflow.id,
    codex_session_id: created.session.id,
    kind: 'start_brainstorming',
    reason: 'Seed the product workspace preview workflow from the same public start-brainstorming path.',
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:21:00.000Z',
  } satisfies WorkflowManualDecision;
  await repository.saveWorkflowManualDecision(manualDecision);

  await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: workflowPreviewIds.startTransition,
      workflow_id: created.workflow.id,
      from_status: 'not_started',
      to_status: 'brainstorming',
      actor_id: techLeadActorId,
      reason: 'Seed product workspace preview Brainstorming start.',
      evidence_object_type: 'manual_decision',
      evidence_object_id: manualDecision.id,
      codex_session_id: created.session.id,
      created_at: '2026-05-18T00:21:00.000Z',
    } satisfies PlanItemWorkflowTransition,
  });

  await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: workflowPreviewIds.boundaryReviewTransition,
      workflow_id: created.workflow.id,
      from_status: 'brainstorming',
      to_status: 'boundary_review',
      actor_id: techLeadActorId,
      reason: 'Seed generated boundary review for product workspace preview.',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: boundaryRevision.id,
      codex_session_id: created.session.id,
      codex_session_turn_id: completedTurn.id,
      created_at: '2026-05-18T00:21:55.000Z',
    } satisfies PlanItemWorkflowTransition,
    projection_patch: {
      active_boundary_summary_revision_id: boundaryRevision.id,
    },
  });

  const updatedWorkflow = await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: workflowPreviewIds.transition,
      workflow_id: created.workflow.id,
      from_status: 'boundary_review',
      to_status: 'spec_generation_queued',
      actor_id: techLeadActorId,
      reason: 'Seed approved boundary and queued Spec Doc generation for product workspace preview.',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: boundaryRevision.id,
      codex_session_id: created.session.id,
      codex_session_turn_id: completedTurn.id,
      created_at: '2026-05-18T00:22:00.000Z',
    } satisfies PlanItemWorkflowTransition,
    projection_patch: {
      active_boundary_summary_revision_id: boundaryRevision.id,
    },
  });

  const queuedAction = {
    id: workflowPreviewIds.queuedAction,
    workflow_id: updatedWorkflow.id,
    codex_session_id: created.session.id,
    kind: 'generate_spec_doc',
    status: 'queued',
    source_revision_id: boundaryRevision.id,
    expected_input_capsule_digest: latestCapsuleDigest,
    context_preview_digest: workflowPreviewContextDigest('queued_spec_context'),
    idempotency_key: buildPlanItemWorkflowQueuedActionIdempotencyKey({
      workflow_id: updatedWorkflow.id,
      kind: 'generate_spec_doc',
      source_revision_id: boundaryRevision.id,
      context_preview_digest: workflowPreviewContextDigest('queued_spec_context'),
      expected_input_capsule_digest: latestCapsuleDigest,
    }),
    created_by_actor_id: techLeadActorId,
    created_at: '2026-05-18T00:23:00.000Z',
    updated_at: '2026-05-18T00:23:00.000Z',
  } satisfies PlanItemWorkflowQueuedAction;
  await repository.createOrReplayPlanItemWorkflowQueuedAction(queuedAction);
}

const workflowPreviewSpec = {
  id: workflowPreviewIds.spec,
  work_item_id: 'req-product-workspace-clarity',
  development_plan_item_id: workflowPreviewItemId,
  workflow_id: workflowPreviewIds.workflow,
  boundary_summary_id: workflowPreviewIds.boundarySummary,
  entity_type: 'spec',
  status: 'in_review',
  editing_state: 'idle',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  current_revision_id: workflowPreviewIds.specRevision,
  created_at: '2026-05-18T00:22:30.000Z',
  updated_at: '2026-05-18T00:22:40.000Z',
} satisfies Spec;

const workflowPreviewSpecRevision = {
  id: workflowPreviewIds.specRevision,
  spec_id: workflowPreviewIds.spec,
  work_item_id: workflowPreviewSpec.work_item_id,
  development_plan_item_id: workflowPreviewItemId,
  workflow_id: workflowPreviewIds.workflow,
  codex_session_id: workflowPreviewIds.codexSession,
  codex_session_turn_id: workflowPreviewIds.turn,
  boundary_summary_id: workflowPreviewIds.boundarySummary,
  revision_number: 1,
  summary: 'Product workspace preview Spec Doc',
  content:
    'The Plan Item route must present the Superpowers loop as a chat-first workspace with timeline, conversation, artifacts, and context preview.',
  background: 'The previous route could fall back to the old gate workspace when real seed data lacked an active workflow.',
  goals: ['Show live workflow context', 'Keep generation behind queued actions', 'Avoid raw runtime identifiers in public data'],
  scope_in: ['Plan Item workflow workspace', 'Public-safe artifact rail', 'Queued Spec Doc action'],
  scope_out: ['Execution start', 'RunSession controls'],
  acceptance_criteria: ['The seeded Plan Item renders data-plan-item-workflow-workspace', 'The old gate workspace is not rendered'],
  risk_notes: ['Seed data must stay aligned with the public workflow DTO contract'],
  test_strategy_summary: 'Use focused web tests and browser verification against the live preview seed.',
  author_actor_id: techLeadActorId,
  artifact_refs: [],
  created_at: '2026-05-18T00:22:35.000Z',
} satisfies SpecRevision;

const workflowPreviewExecutionPlan = {
  id: workflowPreviewIds.executionPlan,
  development_plan_item_id: workflowPreviewItemId,
  workflow_id: workflowPreviewIds.workflow,
  status: 'draft',
  current_revision_id: workflowPreviewIds.executionPlanRevision,
  created_at: '2026-05-18T00:22:45.000Z',
  updated_at: '2026-05-18T00:22:50.000Z',
} satisfies ExecutionPlanDocument;

const workflowPreviewExecutionPlanRevision = {
  id: workflowPreviewIds.executionPlanRevision,
  execution_plan_id: workflowPreviewIds.executionPlan,
  development_plan_item_id: workflowPreviewItemId,
  workflow_id: workflowPreviewIds.workflow,
  codex_session_id: workflowPreviewIds.codexSession,
  codex_session_turn_id: workflowPreviewIds.turn,
  based_on_spec_revision_id: workflowPreviewIds.specRevision,
  revision_number: 1,
  summary: 'Product workspace preview Implementation Plan Doc',
  content:
    'Preserve the route contract, drive all generation through queued actions, and verify the first viewport with a real browser.',
  structured_document: {
    steps: ['Seed active workflow data', 'Render chat-first workspace', 'Verify no old gate fallback'],
  },
  author_actor_id: techLeadActorId,
  created_at: '2026-05-18T00:22:48.000Z',
} satisfies ExecutionPlanRevision;

const executionPackage = {
  id: 'pkg-product-workspace-preview-v1',
  work_item_id: 'req-product-workspace-clarity',
  development_plan_item_id: 'dpi-product-workspace-preview-state',
  execution_id: 'exec-product-workspace-preview-active',
  spec_id: spec.id,
  spec_revision_id: specRevision.id,
  execution_plan_id: executionPlan.id,
  execution_plan_revision_id: executionPlanRevision.id,
  plan_id: plan.id,
  plan_revision_id: planRevision.id,
  project_id: productWorkspacePreviewSeedId,
  repo_id: repoId,
  objective: 'Seed product workspace state execution boundary',
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
  last_run_session_id: 'run-product-workspace-preview',
  current_run_session_id: 'run-product-workspace-preview',
  current_review_packet_id: 'review-cockpit-requested-changes',
  current_release_id: 'rel-product-workspace-preview',
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
} satisfies ExecutionPackage;

const runSession = {
  id: 'run-product-workspace-preview',
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
      name: 'product-workspace-preview-seed.diff',
      content_type: 'text/x-diff',
      storage_uri: 'memory://product-workspace-preview-seed.diff',
    },
  ],
  log_refs: [],
  summary: 'Product workspace preview data passed deterministic checks.',
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
    summary: 'Product workspace preview data is seeded, with Cockpit density still under review.',
    spec_plan_alignment: 'Aligned with the approved product workspace preview documents.',
    test_assessment: 'Focused hook and state checks pass.',
    risk_notes: ['Product Lane fixtures remain contract-shaped'],
    follow_up_questions: [],
  },
  risk_notes: ['Generic ProductPage debt still blocks the final workspace visual review'],
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
  id: 'exec-product-workspace-preview-active',
  development_plan_item_id: 'dpi-product-workspace-preview-state',
  implementation_plan_revision_id: executionPlanRevision.id,
  approved_spec_revision_id: specRevision.id,
  approved_spec_revision_ref: { type: 'spec_revision', id: specRevision.id, spec_id: spec.id, title: specRevision.summary },
  ref: { type: 'execution', id: 'exec-product-workspace-preview-active', title: 'Codex worker is rebuilding product workspace preview data' },
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: 'dpi-product-workspace-preview-state',
    development_plan_id: developmentPlanId,
    title: 'Seed product workspace state for visual review',
  },
  implementation_plan_revision_ref: {
    type: 'implementation_plan_revision',
    id: executionPlanRevision.id,
    implementation_plan_id: executionPlan.id,
    title: executionPlanRevision.summary,
  },
  status: 'running',
  worker_state: 'running',
  current_step: 'Seeding deterministic product workspace fixture data',
  source_ref: sourceRef,
  evidence_refs: [{ type: 'execution', id: 'evidence-exec-product-workspace-checks', title: 'Product workspace preview fixture checks' }],
  runtime_evidence_refs: [{ type: 'execution_package', id: executionPackage.id, title: executionPackage.objective }],
  pr_refs: [{ id: 'pr-product-workspace-preview', title: 'Product workspace preview data PR' }],
  diff_refs: [{ id: 'diff-product-workspace-preview', title: 'Product workspace fixture diff' }],
  test_evidence_refs: [{ id: 'test-product-workspace-preview', title: 'Focused product workspace tests' }],
  interrupt_history: [{ at: '2026-05-18T00:21:00.000Z', reason: 'Paused for review checkpoint' }],
  continuation_history: [{ at: '2026-05-18T00:22:00.000Z', summary: 'Continued after checkpoint' }],
  created_at: '2026-05-18T00:20:00.000Z',
  updated_at: '2026-05-18T00:22:00.000Z',
} satisfies Execution;

const interruptedExecution = {
  ...execution,
  id: 'exec-release-risk-closure-interrupted',
  development_plan_item_id: 'dpi-release-blocker-closure',
  ref: {
    type: 'execution',
    id: 'exec-release-risk-closure-interrupted',
    title: 'Release risk closure execution paused for QA evidence',
  },
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: 'dpi-release-blocker-closure',
    development_plan_id: releaseRiskClosureDevelopmentPlanId,
    title: 'Close release blocker evidence',
  },
  status: 'interrupted',
  worker_state: 'interrupted',
  current_step: 'Waiting for blocked QA handoff evidence before release readiness can proceed',
  source_ref: releaseReadinessSourceRef,
  evidence_refs: [{ type: 'execution', id: 'evidence-release-risk-paused', title: 'Release risk closure pause evidence' }],
  interrupt_history: [{ at: '2026-05-18T00:33:00.000Z', reason: 'Blocked QA handoff requires owner decision' }],
  continuation_history: [],
  updated_at: '2026-05-18T00:33:00.000Z',
} satisfies Execution;

const executions = [execution, interruptedExecution] satisfies Execution[];

const codeReviewHandoff = {
  id: 'review-cockpit-requested-changes',
  ref: { type: 'code_review_handoff', id: 'review-cockpit-requested-changes', title: 'Requested changes on Cockpit layout density' },
  execution_id: execution.id,
  development_plan_item_id: 'dpi-cockpit-command-center',
  implementation_plan_revision_id: executionPlanRevision.id,
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
  approved_implementation_plan_revision_ref: execution.implementation_plan_revision_ref,
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

const blockedQaHandoff = {
  ...qaHandoff,
  id: 'qa-release-blocker-evidence',
  ref: {
    type: 'qa_handoff',
    id: 'qa-release-blocker-evidence',
    title: 'QA blocked release evidence acceptance',
  },
  execution_id: interruptedExecution.id,
  source_ref: releaseReadinessSourceRef,
  development_plan_item_id: 'dpi-release-blocker-closure',
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: 'dpi-release-blocker-closure',
    development_plan_id: releaseRiskClosureDevelopmentPlanId,
    title: 'Close release blocker evidence',
  },
  status: 'blocked',
  acceptance_criteria: ['Release blocker evidence includes QA owner sign-off and observation plan'],
  test_strategy: 'Block release readiness until QA owner accepts release-risk closure evidence.',
  verification_evidence_refs: [{ type: 'execution', id: interruptedExecution.id, title: interruptedExecution.ref.title }],
  known_risks: ['Release readiness would overstate confidence without QA sign-off.'],
  changed_surfaces: ['apps/web/src/features/releases', 'apps/web/src/features/qa'],
  release_impact: 'release_blocking',
  blocked_by_actor_id: qaActorId,
  rationale: 'QA cannot accept release evidence until interrupted execution is resumed.',
  updated_at: '2026-05-18T00:34:00.000Z',
} satisfies QaHandoff;

const qaHandoffs = [qaHandoff, blockedQaHandoff] satisfies QaHandoff[];

const release = {
  id: 'rel-product-workspace-preview',
  org_id: orgId,
  project_id: productWorkspacePreviewSeedId,
  title: 'Product workspace preview release',
  scope_summary: 'Seeded planning inputs, Plan Items, execution, review, QA, and release data for product workspace visual review.',
  release_owner_actor_id: releaseOwnerActorId,
  release_type: 'standard',
  phase: 'approval',
  activity_state: 'idle',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  work_item_ids: sourceInputs.map((workItem) => workItem.id),
  execution_package_ids: [executionPackage.id],
  rollout_strategy: 'Use seeded data for product workspace visual review before UI layout migrations.',
  rollback_plan: 'Revert the seeded fixture data and preview script.',
  observation_plan: 'Watch visual route screenshots for generic ProductPage debt.',
  extra: {
    project_management_scope_refs: [
      sourceRef,
      { type: 'development_plan_item', id: 'dpi-product-workspace-preview-state', development_plan_id: developmentPlanId, title: 'Seed product workspace state for visual review' },
      { type: 'bug', id: 'bug-plan-item-action-eligibility', title: 'Plan Item action eligibility exposes premature execution' },
      { type: 'development_plan_item', id: 'dpi-release-blocker-closure', development_plan_id: releaseRiskClosureDevelopmentPlanId, title: 'Close release blocker evidence' },
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
      scope_ref: { type: 'development_plan_item', id: 'dpi-product-workspace-preview-state', development_plan_id: developmentPlanId, title: 'Seed product workspace state for visual review' },
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
    summary: 'Product workspace preview package run completed with focused checks.',
    object_ref: {
      object_type: 'run_session',
      object_id: runSession.id,
      relationship: 'generated_by',
    },
    extra: {
      scope_ref: { type: 'development_plan_item', id: 'dpi-product-workspace-preview-state', development_plan_id: developmentPlanId, title: 'Seed product workspace state for visual review' },
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
    project_id: productWorkspacePreviewSeedId,
    kind: input.kind,
    title: input.title,
    narrative_markdown: input.narrative,
    goal: `${input.title} is visible in the product workspace review flow.`,
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
  development_plan_id?: string;
  implementation_plan_status: DevelopmentPlanItem['implementation_plan_status'];
  execution_status: DevelopmentPlanItem['execution_status'];
  id: string;
  next_action: string;
  qa_handoff_status: DevelopmentPlanItem['qa_handoff_status'];
  release_impact?: DevelopmentPlanItem['release_impact'];
  review_status: DevelopmentPlanItem['review_status'];
  revision_id: string;
  risk?: DevelopmentPlanItem['risk'];
  source_ref?: DevelopmentPlanItem['source_ref'];
  spec_status: DevelopmentPlanItem['spec_status'];
  summary: string;
  title: string;
}): DevelopmentPlanItem {
  return {
    id: input.id,
    development_plan_id: input.development_plan_id ?? developmentPlanId,
    revision_id: input.revision_id,
    source_ref: input.source_ref ?? sourceRef,
    title: input.title,
    summary: input.summary,
    driver_actor_id: ownerActorId,
    responsible_role: 'developer',
    reviewer_actor_id: reviewerActorId,
    leader_actor_id: reviewerActorId,
    leader_delegate_actor_ids: [techLeadActorId],
    risk: input.risk ?? (input.id === 'dpi-development-plan-table-inspector' ? 'high' : 'medium'),
    dependency_hints: ['Task 1 route contracts are committed'],
    affected_surfaces: input.affected_surfaces,
    boundary_status: input.boundary_status,
    spec_status: input.spec_status,
    implementation_plan_status: input.implementation_plan_status,
    execution_status: input.execution_status,
    review_status: input.review_status,
    qa_handoff_status: input.qa_handoff_status,
    release_impact: input.release_impact ?? 'release_scoped',
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
    change_reason: 'Seed product workspace preview item.',
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
    project_id: productWorkspacePreviewSeedId,
    release_id: release.id,
    title: input.summary,
    evidence_type: input.evidence_type,
    summary: input.summary,
    object_ref: input.object_ref,
    extra: input.extra,
    redacted: false,
    status: 'current',
    visibility: 'internal',
    source_type: 'product_workspace_preview_seed',
    labels: ['product-workspace-preview'],
    created_at: '2026-05-18T00:36:00.000Z',
    created_by_actor_id: ownerActorId,
    updated_at: '2026-05-18T00:36:00.000Z',
    updated_by_actor_id: ownerActorId,
  };
}
