import type { INestApplication } from '@nestjs/common';
import type { BoundaryAnswerRecord, BoundaryDecisionRecord, BoundaryQuestionRecord, DeliveryRepository } from '@forgeloop/db';
import type {
  BoundarySummary,
  BoundarySummaryRevision,
  BrainstormingSession,
  ContextManifest,
  Decision,
  DevelopmentPlan,
  DevelopmentPlanItem,
  DevelopmentPlanItemRevision,
  DevelopmentPlanSourceLink,
  Plan,
  PlanRevision,
  Spec,
  SpecRevision,
  WorkItem,
} from '@forgeloop/domain';

import { ControlPlaneRuntimeService } from '../../apps/control-plane-api/src/modules/core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';

type ArtifactStatus = 'draft' | 'in_review' | 'approved';
type GateState = 'not_submitted' | 'awaiting_approval' | 'approved' | 'changes_requested';

export type ItemScopedArtifactSeed = {
  workItem: WorkItem;
  developmentPlan: DevelopmentPlan;
  item: DevelopmentPlanItem;
  boundary: BoundarySummary;
  spec: Spec;
  specRevision: SpecRevision;
  plan?: Plan;
  planRevision?: PlanRevision;
};

type SeedOptions = {
  repository?: DeliveryRepository;
  actorId?: string;
  reviewerActorId?: string;
  itemReviewerActorId?: string;
  specStatus?: ArtifactStatus;
  specGateState?: GateState;
  specDecision?: Decision['decision'];
  specDecisionSummary?: string;
  includePlan?: boolean;
  planStatus?: ArtifactStatus;
  planGateState?: GateState;
  planDecision?: Decision['decision'];
  planDecisionSummary?: string;
};

const defaultActorId = 'actor-owner';
const defaultReviewerActorId = 'actor-reviewer';

export async function seedItemScopedSpecPlan(
  app: INestApplication,
  workItemId: string,
  options: SeedOptions = {},
): Promise<ItemScopedArtifactSeed> {
  const repository = options.repository ?? (app.get(DELIVERY_REPOSITORY) as DeliveryRepository);
  const runtime = app.get(ControlPlaneRuntimeService);
  const actorId = options.actorId ?? defaultActorId;
  const reviewerActorId = options.reviewerActorId ?? defaultReviewerActorId;
  const itemReviewerActorId = options.itemReviewerActorId ?? reviewerActorId;
  const now = runtime.now();
  const workItem = requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
  const sourceRef = { type: workItem.kind, id: workItem.id, title: workItem.title } as const;
  const specStatus = options.specStatus ?? 'approved';
  const executionPlanStatus = options.includePlan === false ? 'missing' : (options.planStatus ?? 'approved');

  const developmentPlan: DevelopmentPlan = {
    id: runtime.id('development-plan'),
    revision_id: runtime.id('development-plan-revision'),
    project_id: workItem.project_id,
    title: `Development plan for ${workItem.title}`,
    status: 'draft',
    source_refs: [sourceRef],
    items: [],
    created_at: now,
    updated_at: now,
  };
  await repository.saveDevelopmentPlan(developmentPlan);
  const sourceLink: DevelopmentPlanSourceLink = {
    id: runtime.id('development-plan-source-link'),
    development_plan_id: developmentPlan.id,
    source_ref: sourceRef,
    link_type: 'primary',
    created_by_actor_id: actorId,
    created_at: now,
  };
  await repository.saveDevelopmentPlanSourceLink(sourceLink);
  await repository.saveDevelopmentPlanRevision({
    id: developmentPlan.revision_id,
    development_plan_id: developmentPlan.id,
    revision_number: 1,
    title: developmentPlan.title,
    status: developmentPlan.status,
    source_refs: developmentPlan.source_refs,
    item_refs: [],
    change_reason: 'item_scoped_fixture_created',
    actor_id: actorId,
    created_at: now,
  });

  const item: DevelopmentPlanItem = {
    id: runtime.id('development-plan-item'),
    revision_id: runtime.id('development-plan-item-revision'),
    development_plan_id: developmentPlan.id,
    source_ref: sourceRef,
    title: `Implement ${workItem.title}`,
    summary: workItem.goal,
    responsible_role: 'tech_lead',
    driver_actor_id: actorId,
    reviewer_actor_id: itemReviewerActorId,
    leader_actor_id: itemReviewerActorId,
    leader_delegate_actor_ids: actorId === itemReviewerActorId ? [] : [actorId],
    risk: workItem.risk === 'high' ? 'high' : workItem.risk === 'low' ? 'low' : 'medium',
    dependency_hints: [],
    affected_surfaces: ['tests'],
    boundary_status: 'approved',
    spec_status: specStatus,
    execution_plan_status: executionPlanStatus,
    execution_status: 'not_started',
    review_status: 'not_started',
    qa_handoff_status: 'not_started',
    release_impact: 'release_scoped',
    next_action: options.includePlan === false ? 'generate_execution_plan' : 'start_execution',
    created_at: now,
    updated_at: now,
  };
  await repository.saveDevelopmentPlanItem(item);
  const itemRevisionChangeReason =
    executionPlanStatus === 'approved'
      ? 'execution_plan_approved'
      : specStatus === 'approved' && options.includePlan === false
        ? 'spec_approved'
        : 'item_scoped_fixture_created';
  const itemRevision: DevelopmentPlanItemRevision = {
    id: item.revision_id,
    development_plan_item_id: item.id,
    development_plan_id: developmentPlan.id,
    revision_number: 1,
    snapshot: item,
    change_reason: itemRevisionChangeReason,
    edited_by_actor_id: actorId,
    created_at: now,
  };
  await repository.saveDevelopmentPlanItemRevision(itemRevision);

  const contextManifest = await saveContextManifest(repository, runtime, workItem, developmentPlan, item, actorId, now);
  const { boundary, session } = await saveApprovedBoundary(repository, runtime, developmentPlan, item, contextManifest, actorId, now);
  await repository.saveBrainstormingSession({ ...session, boundary_summary_id: boundary.id });

  const spec = await saveSpec(repository, runtime, workItem, item, boundary, contextManifest, reviewerActorId, options, now);
  const specRevision = requireFound(await repository.getSpecRevision(spec.current_revision_id!), `SpecRevision ${spec.current_revision_id}`);
  await repository.saveWorkItem({
    ...workItem,
    current_spec_id: spec.id,
    current_spec_revision_id: spec.current_revision_id,
    updated_at: now,
  });
  if (options.specDecision !== undefined) {
    await saveDecision(repository, runtime, 'spec', spec.id, reviewerActorId, options.specDecision, options.specDecisionSummary, now);
  }

  if (options.includePlan === false) {
    return { workItem, developmentPlan, item, boundary, spec, specRevision };
  }

  const { plan, planRevision } = await savePlan(repository, runtime, workItem, item, specRevision, reviewerActorId, options, now);
  await repository.saveWorkItem({
    ...workItem,
    current_spec_id: spec.id,
    current_spec_revision_id: spec.current_revision_id,
    current_plan_id: plan.id,
    current_plan_revision_id: plan.current_revision_id,
    updated_at: now,
  });
  if (options.planDecision !== undefined) {
    await saveDecision(repository, runtime, 'plan', plan.id, reviewerActorId, options.planDecision, options.planDecisionSummary, now);
  }

  return { workItem, developmentPlan, item, boundary, spec, specRevision, plan, planRevision };
}

async function saveContextManifest(
  repository: DeliveryRepository,
  runtime: ControlPlaneRuntimeService,
  workItem: WorkItem,
  developmentPlan: DevelopmentPlan,
  item: DevelopmentPlanItem,
  actorId: string,
  now: string,
): Promise<ContextManifest> {
  const manifest: ContextManifest = {
    id: runtime.id('context-manifest'),
    revision_id: runtime.id('context-manifest-revision'),
    source_ref: item.source_ref,
    project_id: workItem.project_id,
    development_plan_id: developmentPlan.id,
    development_plan_revision_id: developmentPlan.revision_id,
    development_plan_item_id: item.id,
    development_plan_item_revision_id: item.revision_id,
    actor_guidance: actorId,
    sources: [{ type: 'development_plan_item', ref: item.id, digest: item.revision_id }],
    generated_at: now,
    runtime_identity: 'test:item-scoped-artifact-fixtures',
    created_at: now,
    updated_at: now,
  };
  await repository.saveContextManifest(manifest);
  return manifest;
}

async function saveApprovedBoundary(
  repository: DeliveryRepository,
  runtime: ControlPlaneRuntimeService,
  developmentPlan: DevelopmentPlan,
  item: DevelopmentPlanItem,
  contextManifest: ContextManifest,
  actorId: string,
  now: string,
): Promise<{ session: BrainstormingSession; boundary: BoundarySummary }> {
  const roundId = runtime.id('boundary-round');
  const boundarySummaryId = runtime.id('boundary-summary');
  const boundarySummaryRevisionId = runtime.id('boundary-summary-revision');
  const question = {
    id: runtime.id('brainstorming-question'),
    round_id: roundId,
    text: 'What is the Development Plan Item boundary?',
    author_id: actorId,
    created_at: now,
    status: 'resolved' as const,
    required: true,
    answered_by_answer_id: runtime.id('brainstorming-answer'),
  };
  const answer = {
    id: question.answered_by_answer_id,
    question_id: question.id,
    round_id: roundId,
    text: 'The fixture is scoped to this Development Plan Item.',
    actor_id: actorId,
    actor_role: 'leader' as const,
    created_at: now,
  };
  const decision = {
    id: runtime.id('brainstorming-decision'),
    round_id: roundId,
    text: 'Generate artifacts only through the item boundary.',
    actor_id: actorId,
    actor_role: 'leader' as const,
    source: 'leader' as const,
    state: 'accepted' as const,
    rationale: 'Legacy direct Work Item artifact creation is retired.',
    created_at: now,
  };
  const session: BrainstormingSession = {
    id: runtime.id('brainstorming-session'),
    revision_id: runtime.id('brainstorming-session-revision'),
    source_ref: item.source_ref,
    development_plan_id: developmentPlan.id,
    development_plan_revision_id: developmentPlan.revision_id,
    development_plan_item_id: item.id,
    development_plan_item_revision_id: item.revision_id,
    leader_actor_id: item.leader_actor_id ?? item.reviewer_actor_id ?? actorId,
    leader_delegate_actor_ids: item.leader_delegate_actor_ids,
    context_manifest_id: contextManifest.id,
    context_manifest_revision_id: contextManifest.revision_id,
    status: 'approved',
    current_round_id: roundId,
    latest_summary_revision_id: boundarySummaryRevisionId,
    approved_summary_revision_id: boundarySummaryRevisionId,
    questions: [question],
    answers: [answer],
    decisions: [decision],
    approval_state: 'approved',
    boundary_summary_id: boundarySummaryId,
    approver_actor_id: actorId,
    approved_at: now,
    closed_at: now,
    created_at: now,
    updated_at: now,
  };
  await repository.saveBrainstormingSession(session);
  await repository.saveBoundaryRound({
    id: roundId,
    session_id: session.id,
    session_revision_id: session.revision_id,
    round_number: 1,
    trigger: 'start',
    status: 'terminal',
    created_at: now,
    updated_at: now,
  });
  const questionRecord: BoundaryQuestionRecord = { ...question, session_id: session.id, sequence: 1 };
  const answerRecord: BoundaryAnswerRecord = { ...answer, session_id: session.id, sequence: 1 };
  const decisionRecord: BoundaryDecisionRecord = { ...decision, session_id: session.id, sequence: 1 };
  await repository.saveBoundaryQuestion(questionRecord);
  await repository.saveBoundaryAnswer(answerRecord);
  await repository.saveBoundaryDecision(decisionRecord);

  const boundary: BoundarySummary = {
    id: boundarySummaryId,
    revision_id: boundarySummaryRevisionId,
    brainstorming_session_id: session.id,
    brainstorming_session_revision_id: session.revision_id,
    development_plan_id: developmentPlan.id,
    development_plan_item_id: item.id,
    development_plan_item_revision_id: item.revision_id,
    source_ref: item.source_ref,
    summary: 'Approved item-scoped fixture boundary.',
    approved_by_actor_id: actorId,
    approved_at: now,
    created_at: now,
    updated_at: now,
  };
  await repository.saveBoundarySummary(boundary);
  const boundaryRevision: BoundarySummaryRevision = {
    id: boundary.revision_id,
    boundary_summary_id: boundary.id,
    session_id: session.id,
    session_revision_id: session.revision_id,
    source_round_id: roundId,
    development_plan_id: developmentPlan.id,
    development_plan_item_id: item.id,
    development_plan_item_revision_id: item.revision_id,
    revision_number: 1,
    status: 'approved',
    summary_markdown: boundary.summary,
    confirmed_scope: ['Generate artifacts only through this Development Plan Item boundary.'],
    confirmed_out_of_scope: ['Legacy direct Work Item artifact creation.'],
    accepted_assumptions: [],
    open_risks: [],
    validation_expectations: ['Item-scoped artifact queries resolve approved boundary context.'],
    question_answer_snapshot: [{ question_id: question.id, answer_id: answer.id, text: answer.text }],
    decision_snapshot: [{ decision_id: decision.id, text: decision.text, rationale: decision.rationale }],
    decision_count: 1,
    context_manifest_id: contextManifest.id,
    context_manifest_revision_id: contextManifest.revision_id,
    approved_by_actor_id: actorId,
    approved_at: now,
    created_at: now,
  };
  await repository.saveBoundarySummaryRevision(boundaryRevision);
  await repository.appendObjectEvent({
    id: runtime.id('object-event'),
    object_type: 'development_plan_item',
    object_id: item.id,
    event_type: 'development_plan_item_boundary_approved',
    actor_id: actorId,
    metadata: { boundary_summary_id: boundary.id },
    created_at: now,
  });

  return { session, boundary };
}

async function saveSpec(
  repository: DeliveryRepository,
  runtime: ControlPlaneRuntimeService,
  workItem: WorkItem,
  item: DevelopmentPlanItem,
  boundary: BoundarySummary,
  contextManifest: ContextManifest,
  reviewerActorId: string,
  options: SeedOptions,
  now: string,
): Promise<Spec> {
  const status = options.specStatus ?? 'approved';
  const specId = runtime.id('spec');
  const revisionId = runtime.id('spec-revision');
  const spec: Spec = {
    id: specId,
    work_item_id: workItem.id,
    development_plan_item_id: item.id,
    boundary_summary_id: boundary.id,
    context_manifest_id: contextManifest.id,
    entity_type: 'spec',
    status,
    editing_state: 'idle',
    gate_state: options.specGateState ?? gateStateForStatus(status),
    resolution: status === 'approved' ? 'approved' : 'none',
    current_revision_id: revisionId,
    ...(status === 'approved'
      ? { approved_revision_id: revisionId, approved_at: now, approved_by_actor_id: reviewerActorId }
      : {}),
    created_at: now,
    updated_at: now,
  };
  const revision: SpecRevision = {
    id: revisionId,
    spec_id: specId,
    work_item_id: workItem.id,
    development_plan_item_id: item.id,
    boundary_summary_id: boundary.id,
    context_manifest_id: contextManifest.id,
    revision_number: 1,
    summary: `Spec for ${workItem.title}`,
    content: `Deliver ${workItem.goal}`,
    background: workItem.goal,
    goals: [workItem.goal],
    scope_in: [`Deliver ${workItem.title}`],
    scope_out: ['Legacy direct Work Item artifact creation'],
    acceptance_criteria: [...workItem.success_criteria],
    risk_notes: [workItem.risk],
    test_strategy_summary: `Validate ${workItem.title}.`,
    structured_document: { boundary_summary_revision_id: boundary.revision_id },
    qa_owner_actor_id: item.reviewer_actor_id ?? reviewerActorId,
    testability_note: `QA/Test Owner reviewed ${workItem.title} for item-scoped execution.`,
    risk_scenarios: item.dependency_hints.length > 0 ? item.dependency_hints : [`${workItem.risk} risk validation path`],
    author_actor_id: options.actorId ?? defaultActorId,
    artifact_refs: [],
    created_at: now,
  };
  await repository.saveSpec(spec);
  await repository.saveSpecRevision(revision);
  return spec;
}

async function savePlan(
  repository: DeliveryRepository,
  runtime: ControlPlaneRuntimeService,
  workItem: WorkItem,
  item: DevelopmentPlanItem,
  specRevision: SpecRevision,
  reviewerActorId: string,
  options: SeedOptions,
  now: string,
): Promise<{ plan: Plan; planRevision: PlanRevision }> {
  const status = options.planStatus ?? 'approved';
  const planId = runtime.id('plan');
  const revisionId = runtime.id('plan-revision');
  const plan: Plan = {
    id: planId,
    work_item_id: workItem.id,
    development_plan_item_id: item.id,
    entity_type: 'plan',
    status,
    editing_state: 'idle',
    gate_state: options.planGateState ?? gateStateForStatus(status),
    resolution: status === 'approved' ? 'approved' : 'none',
    current_revision_id: revisionId,
    ...(status === 'approved'
      ? { approved_revision_id: revisionId, approved_at: now, approved_by_actor_id: reviewerActorId }
      : {}),
    created_at: now,
    updated_at: now,
  };
  const planRevision: PlanRevision = {
    id: revisionId,
    plan_id: planId,
    work_item_id: workItem.id,
    based_on_spec_revision_id: specRevision.id,
    revision_number: 1,
    summary: `Execution plan for ${workItem.title}`,
    content: `Implement approved spec revision ${specRevision.id}.`,
    implementation_summary: `Deliver ${workItem.title}.`,
    split_strategy: 'One execution package.',
    dependency_order: ['api-package'],
    test_matrix: ['pnpm test tests/api'],
    risk_mitigations: [workItem.risk],
    rollback_notes: 'Revert the execution package changes.',
    author_actor_id: options.actorId ?? defaultActorId,
    artifact_refs: [],
    created_at: now,
  };
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);
  return { plan, planRevision };
}

async function saveDecision(
  repository: DeliveryRepository,
  runtime: ControlPlaneRuntimeService,
  objectType: 'spec' | 'plan',
  objectId: string,
  actorId: string,
  decision: Decision['decision'],
  summary: string | undefined,
  now: string,
) {
  await repository.saveDecision({
    id: runtime.id('decision'),
    object_type: objectType,
    object_id: objectId,
    actor_id: actorId,
    decision,
    summary: summary ?? (decision === 'approved' ? `${objectType} approved.` : `${objectType} changes requested.`),
    created_at: now,
  });
}

const gateStateForStatus = (status: ArtifactStatus): GateState => {
  if (status === 'approved') return 'approved';
  if (status === 'in_review') return 'awaiting_approval';
  return 'not_submitted';
};

function requireFound<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} not found`);
  }
  return value;
}
