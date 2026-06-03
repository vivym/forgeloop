import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DomainError,
  assertPlanItemWorkflowTransitionAllowed,
  assertQueuedActionCanRun,
  assertWorkflowMessageAllowed,
  assertWorkflowActorAuthorized,
  buildPlanItemWorkflowQueuedActionIdempotencyKey,
  codexCanonicalDigest,
  codexSessionPublicProjection,
  mapQueuedActionKindToTurnIntent,
  planItemWorkflowPublicProjection,
  type BrainstormingSession,
  type BoundarySummaryRevision,
  type CodexSession,
  type CodexSessionTurn,
  type DevelopmentPlanItem,
  type ExecutionPlanRevision,
  type PlanItemWorkflow,
  type PlanItemWorkflowQueuedAction,
  type RunSession,
  type SpecRevision,
  type WorkflowPersistenceRefs,
  type WorkflowManualDecision,
} from '@forgeloop/domain';
import type {
  PlanItemWorkflowReadiness,
  PlanItemWorkflowQueuedActionKind,
  PlanItemWorkflowStatus,
  RunOperatorCommandResponse,
  WorkflowTransitionEvidenceObjectType,
} from '@forgeloop/contracts';
import type { ApplyPlanItemWorkflowTransitionInput, DeliveryRepository } from '@forgeloop/db';

import type { ActorContext } from '../auth/actor-context';
import { BrainstormingService } from '../brainstorming/brainstorming.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { RegenerateArtifactDraftCommandDto, RunControlDto, RunInputDto } from '../delivery/dto';
import { ExecutionsService } from '../executions/executions.service';
import { RunControlService } from '../run-control/run-control.service';
import { SpecPlanService, type ProductGenerationScheduleResult } from '../spec-plan/spec-plan.service';
import type {
  ApproveImplementationPlanAndMarkExecutionReadyDto,
  ApproveWorkflowArtifactRevisionBodyDto,
  EvaluateWorkflowExecutionReadinessBodyDto,
  ForkCodexSessionBodyDto,
  ManualDecisionBodyDto,
  RequestWorkflowArtifactChangesBodyDto,
  RequestWorkflowChangesDto,
  RunQueuedWorkflowActionBodyDto,
  SelectCodexSessionForkBodyDto,
  StartBrainstormingWorkflowDto,
  WorkflowArtifactTypeDto,
  WorkflowActorCommandDto,
  WorkflowBoundaryAnswerBodyDto,
  WorkflowBoundaryContinueBodyDto,
  WorkflowBoundaryDecisionBodyDto,
  WorkflowBoundaryStartCommandDto,
  WorkflowBoundarySummaryChangesBodyDto,
  WorkflowDraftDocumentBodyDto,
  WorkflowMessageCommandBodyDto,
  WorkflowRevisionCommandDto,
  WorkflowTransitionCommandDto,
} from './plan-item-workflow.dto';

type WorkflowAction = Parameters<typeof assertWorkflowActorAuthorized>[1];
type TransitionCheckInput = Parameters<typeof assertPlanItemWorkflowTransitionAllowed>[0];
type PlanItemWorkflowChildContext = {
  workflow_id: string;
  codex_session_id: string;
  codex_session_turn_id?: string;
};
type ManualDecisionTransitionInput = {
  actor_id: string;
  to_status: PlanItemWorkflowStatus;
  manual_decision_kind: WorkflowManualDecision['kind'];
  reason: string;
  related_object_type?: WorkflowTransitionEvidenceObjectType;
  related_object_id?: string;
  selected_codex_session_id?: string;
};
type EvidenceValidationInput = {
  object_type: WorkflowTransitionEvidenceObjectType;
  object_id: string;
  to_status: PlanItemWorkflowStatus;
  actor_id: string;
  manual_decision_kind?: WorkflowManualDecision['kind'];
  supporting?: boolean;
};
type PendingRuntimeGenerationKind = 'spec' | 'implementation_plan';

@Injectable()
export class PlanItemWorkflowService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(BrainstormingService) private readonly brainstorming: BrainstormingService,
    @Inject(SpecPlanService) private readonly specPlan: SpecPlanService,
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
    @Inject(RunControlService) private readonly runControl: RunControlService,
  ) {}

  async startBrainstorming(developmentPlanId: string, itemId: string, dto: StartBrainstormingWorkflowDto) {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const now = this.now();
        const item = await this.requirePlanItemBelongsToPlan(repository, developmentPlanId, itemId);
        const workItem = await repository.getWorkItem(item.source_ref.id);
        this.assertActorCanStartWorkflowItem(item, dto.actor_id, workItem?.driver_actor_id);
        const created = await repository.createPlanItemWorkflowWithInitialSession({
          id: randomUUID(),
          codex_session_id: randomUUID(),
          development_plan_id: item.development_plan_id,
          development_plan_item_id: itemId,
          runtime_profile_id: dto.runtime_profile_id,
          runtime_profile_revision_id: dto.runtime_profile_revision_id,
          credential_binding_id: dto.credential_binding_id,
          credential_binding_version_id: dto.credential_binding_version_id,
          actor_id: dto.actor_id,
          now,
        });
        const decision = await this.createManualDecision(repository, created.workflow, {
          actor_id: dto.actor_id,
          codex_session_id: created.session.id,
          manual_decision_kind: 'start_brainstorming',
          reason: dto.reason,
          created_at: now,
        });
        const updated = await this.applyTransition(repository, created.workflow, {
          actor_id: dto.actor_id,
          to_status: 'brainstorming',
          evidence_object_type: 'manual_decision',
          evidence_object_id: decision.id,
          manual_decision_kind: 'start_brainstorming',
          reason: dto.reason,
        }, created.session.id, now);

        const queuedAction = await this.enqueueWorkflowAction(repository, updated, created.session, {
          kind: 'continue_brainstorming',
          actor_id: dto.actor_id,
        });

        return this.toPublicWorkflowDto(updated, created.session, [queuedAction]);
      }),
    );
  }

  async recordWorkflowMessage(workflowId: string, input: WorkflowMessageCommandBodyDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'submit_document_gate');
        const session = await this.requireActiveSession(repository, workflow);
        const activeActions = await repository.listActivePlanItemWorkflowQueuedActions(workflow.id);
        assertWorkflowMessageAllowed({
          action: input.action,
          workflow_status: workflow.status,
          active_codex_session_id: session.id,
          active_codex_action_count: activeActions.length,
        });

        const now = this.now();
        const messageId = input.client_message_id ?? randomUUID();
        const message = {
          id: messageId,
          workflow_id: workflow.id,
          codex_session_id: session.id,
          actor_id: input.actor_id,
          action: input.action,
          body_markdown: input.body_markdown,
          created_at: now,
        };
        const queuedAction = await this.enqueueWorkflowAction(repository, workflow, session, {
          kind: 'continue_brainstorming',
          actor_id: input.actor_id,
          created_from_message_id: messageId,
        });
        await repository.savePlanItemWorkflowMessage({ ...message, created_queued_action_id: queuedAction.id });
        return this.toPublicWorkflowDto(workflow, session, [queuedAction]);
      }),
    );
  }

  async runQueuedWorkflowAction(workflowId: string, actionId: string, input: RunQueuedWorkflowActionBodyDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'submit_document_gate');
        const session = await this.requireActiveSession(repository, workflow);
        const action = await repository.getPlanItemWorkflowQueuedAction({ workflow_id: workflow.id, action_id: actionId });
        if (action === undefined) {
          throw new DomainError('workflow_action_not_found', `workflow_action_not_found: Queued action ${actionId} was not found`);
        }
        if (action.status !== 'queued') {
          return { workflow: this.toPublicWorkflowDto(workflow, session, [action]), queued_action: action };
        }
        assertQueuedActionCanRun({
          action,
          workflow_id: workflow.id,
          active_codex_session_id: session.id,
          ...(session.latest_capsule_digest === undefined ? {} : { latest_capsule_digest: session.latest_capsule_digest }),
          context_preview_digest: this.contextPreviewDigest(workflow, session, action.kind),
        });
        const { action: queuedAction } = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
          workflow_id: workflow.id,
          action_id: action.id,
          now: this.now(),
        });
        if (!queuedAction.codex_session_turn_id && queuedAction.status === 'running') {
          const turn = await this.createWorkflowChildTurn(
            repository,
            workflow,
            session,
            input.actor_id,
            mapQueuedActionKindToTurnIntent(queuedAction.kind),
            `queued-action:${queuedAction.kind}:${queuedAction.id}`,
          );
          const actionWithTurn = await repository.attachPlanItemWorkflowQueuedActionTurn({
            workflow_id: workflow.id,
            action_id: queuedAction.id,
            codex_session_turn_id: turn.id,
            now: this.now(),
          });
          const handledAction = await this.blockQueuedWorkflowAction(
            repository,
            workflow.id,
            actionWithTurn.id,
            turn.id,
            'workflow_runtime_dispatch_not_configured',
          );
          return { workflow: this.toPublicWorkflowDto(workflow, session, [handledAction]), queued_action: handledAction };
        }
        return { workflow: this.toPublicWorkflowDto(workflow, session, [queuedAction]), queued_action: queuedAction };
      }),
    );
  }

  private blockQueuedWorkflowAction(
    repository: DeliveryRepository,
    workflowId: string,
    actionId: string,
    turnId: string,
    reasonCode: string,
  ): Promise<PlanItemWorkflowQueuedAction> {
    return repository.terminalizePlanItemWorkflowQueuedAction({
      workflow_id: workflowId,
      action_id: actionId,
      status: 'blocked',
      codex_session_turn_id: turnId,
      blocked_reason_code: reasonCode,
      now: this.now(),
    });
  }

  async approveWorkflowArtifactRevision(
    workflowId: string,
    artifactType: WorkflowArtifactTypeDto,
    revisionId: string,
    input: ApproveWorkflowArtifactRevisionBodyDto,
  ) {
    if (artifactType === 'boundary-summary') {
      return this.approveBoundaryArtifactRevision(workflowId, revisionId, input);
    }
    if (artifactType === 'spec-doc') {
      return this.approveSpecArtifactRevision(workflowId, revisionId, input);
    }
    return this.approveImplementationPlanArtifactRevision(workflowId, revisionId, input);
  }

  async requestWorkflowArtifactChanges(
    workflowId: string,
    artifactType: WorkflowArtifactTypeDto,
    revisionId: string,
    input: RequestWorkflowArtifactChangesBodyDto,
  ) {
    return this.requestArtifactChangesWithCascade(workflowId, artifactType, revisionId, input);
  }

  async evaluateExecutionReadiness(workflowId: string, input: EvaluateWorkflowExecutionReadinessBodyDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        if (workflow.status !== 'implementation_plan_review') {
          throw new DomainError('workflow_invalid_transition', 'Execution readiness evaluation requires implementation_plan_review');
        }
        const session = await this.requireActiveSession(repository, workflow);
        const implementationPlanRevision = await this.requireApprovedImplementationPlanRevisionForReadiness(
          repository,
          workflow,
        );
        const workflowWithApprovedPlan: PlanItemWorkflow = {
          ...workflow,
          active_implementation_plan_doc_revision_id: implementationPlanRevision.id,
        };
        const readiness = await this.createExecutionReadinessRecordForApprovedPlan(
          repository,
          workflowWithApprovedPlan,
          input.actor_id,
        );
        const dto: WorkflowTransitionCommandDto = {
          actor_id: input.actor_id,
          to_status: 'execution_ready',
          evidence_object_type: 'execution_readiness_record',
          evidence_object_id: readiness.id,
          supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: implementationPlanRevision.id }],
          reason: input.rationale_markdown,
        };
        await this.validateTransitionEvidence(repository, workflowWithApprovedPlan, dto);
        const updated = await this.applyTransition(repository, workflow, dto, session.id, this.now(), {
          active_implementation_plan_doc_revision_id: implementationPlanRevision.id,
        });
        return this.toPublicWorkflowDto(updated, session, [], {
          readiness: this.readinessProjectionForRecord(readiness),
        });
      }),
    );
  }

  private async approveBoundaryArtifactRevision(
    workflowId: string,
    revisionId: string,
    input: ApproveWorkflowArtifactRevisionBodyDto,
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        if (workflow.status !== 'boundary_review') {
          throw new DomainError('workflow_invalid_transition', 'Boundary Summary approval requires boundary_review');
        }
        const session = await this.requireActiveSession(repository, workflow);
        const revision = await repository.getBoundarySummaryRevisionById(revisionId);
        this.assertOwnedDocumentRevision(workflow, revision, 'Boundary Summary revision');
        if (revision === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary revision does not belong to this workflow/session');
        }
        const boundarySessionId = this.boundarySummaryRevisionSessionId(revision);
        if (boundarySessionId === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary revision is missing its Brainstorming Session owner');
        }
        await this.brainstorming.approveBoundarySummaryRevisionWithRepository(repository, boundarySessionId, revision.id, {
          actor_id: input.actor_id,
          ...(input.decision_markdown === undefined ? {} : { final_decision: input.decision_markdown }),
        });
        const dto: WorkflowTransitionCommandDto = {
          actor_id: input.actor_id,
          to_status: 'spec_generation_queued',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: revision.id,
          reason: input.decision_markdown,
        };
        await this.validateTransitionEvidence(repository, workflow, dto);
        const updated = await this.applyTransition(repository, workflow, dto, session.id, this.now());
        const queuedAction = await this.enqueueWorkflowAction(repository, updated, session, {
          kind: 'generate_spec_doc',
          actor_id: input.actor_id,
          source_revision_id: revision.id,
        });
        return this.toPublicWorkflowDto(updated, session, [queuedAction]);
      }),
    );
  }

  private async approveSpecArtifactRevision(
    workflowId: string,
    revisionId: string,
    input: ApproveWorkflowArtifactRevisionBodyDto,
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        if (workflow.status !== 'spec_review') {
          throw new DomainError('workflow_invalid_transition', 'Spec approval requires spec_review');
        }
        const beforeRevision = await repository.getSpecRevision(revisionId);
        this.assertOwnedDocumentRevision(workflow, beforeRevision, 'Spec revision');
        if (beforeRevision === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Spec revision does not belong to this workflow/session');
        }
        const spec = await repository.getSpec(beforeRevision.spec_id);
        if (spec?.current_revision_id !== revisionId) {
          throw new DomainError('workflow_evidence_not_owned', 'Approved Spec revision is not current for this workflow');
        }
        if (spec.status === 'in_review') {
          await this.specPlan.approveItemSpecWithRepository(
            repository,
            workflow.development_plan_id,
            workflow.development_plan_item_id,
            {
              actor_id: input.actor_id,
              ...(input.decision_markdown === undefined ? {} : { rationale: input.decision_markdown }),
            },
          );
        } else if (
          spec.status !== 'approved' ||
          spec.approved_revision_id !== revisionId ||
          spec.approved_by_actor_id === undefined ||
          spec.approved_at === undefined
        ) {
          throw new DomainError(
            'workflow_evidence_type_invalid',
            'Spec approval requires an in-review or current approved Spec revision',
          );
        }
        const session = await this.requireActiveSession(repository, workflow);
        const dto: WorkflowTransitionCommandDto = {
          actor_id: input.actor_id,
          to_status: 'implementation_plan_generation_queued',
          evidence_object_type: 'spec_revision',
          evidence_object_id: revisionId,
          reason: input.decision_markdown,
        };
        await this.validateTransitionEvidence(repository, workflow, dto);
        const updated = await this.applyTransition(repository, workflow, dto, session.id, this.now());
        const queuedAction = await this.enqueueWorkflowAction(repository, updated, session, {
          kind: 'generate_implementation_plan_doc',
          actor_id: input.actor_id,
          source_revision_id: revisionId,
        });
        return this.toPublicWorkflowDto(updated, session, [queuedAction]);
      }),
    );
  }

  private async approveImplementationPlanArtifactRevision(
    workflowId: string,
    revisionId: string,
    input: ApproveWorkflowArtifactRevisionBodyDto,
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        if (workflow.status !== 'implementation_plan_review') {
          throw new DomainError('workflow_invalid_transition', 'Implementation Plan approval requires implementation_plan_review');
        }
        const revision = await repository.getExecutionPlanRevision(revisionId);
        this.assertOwnedDocumentRevision(workflow, revision, 'Implementation Plan revision');
        if (revision === undefined) {
          throw new DomainError(
            'workflow_evidence_not_owned',
            'Implementation Plan revision does not belong to this workflow/session',
          );
        }
        const executionPlan = await repository.getExecutionPlan(revision.execution_plan_id);
        if (executionPlan?.current_revision_id !== revisionId) {
          throw new DomainError('workflow_evidence_not_owned', 'Approved Implementation Plan revision is not current for this workflow');
        }
        if (executionPlan.status === 'in_review') {
          await this.specPlan.approveItemImplementationPlanDocumentOnlyWithRepository(
            repository,
            workflow.development_plan_id,
            workflow.development_plan_item_id,
            {
              actor_id: input.actor_id,
              ...(input.decision_markdown === undefined ? {} : { rationale: input.decision_markdown }),
            },
          );
        } else if (
          executionPlan.status !== 'approved' ||
          executionPlan.approved_revision_id !== revisionId ||
          executionPlan.approved_by_actor_id === undefined ||
          executionPlan.approved_at === undefined
        ) {
          throw new DomainError(
            'workflow_evidence_type_invalid',
            'Implementation Plan approval requires an in-review or current approved Implementation Plan revision',
          );
        }
        const session = await this.requireActiveSession(repository, workflow);
        return this.toPublicWorkflowDto(workflow, session, [], {
          readiness: this.notEvaluatedReadiness(true),
        });
      }),
    );
  }

  private async requestArtifactChangesWithCascade(
    workflowId: string,
    artifactType: WorkflowArtifactTypeDto,
    revisionId: string,
    input: RequestWorkflowArtifactChangesBodyDto,
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        const session = await this.requireActiveSession(repository, workflow);
        await this.assertNoRunningWorkflowActions(repository, workflow.id);
        await this.validateChangeRequestRevision(repository, workflow, artifactType, revisionId);
        const changeRequestId = randomUUID();
        await repository.savePlanItemWorkflowArtifactChangeRequest({
          id: changeRequestId,
          workflow_id: workflow.id,
          artifact_type: artifactType,
          revision_id: revisionId,
          reason_markdown: input.reason_markdown,
          requested_by_actor_id: input.actor_id,
          created_at: this.now(),
        });
        await this.applyArtifactChangeRequestSideEffects(repository, workflow, artifactType, revisionId, input);
        await repository.markDependentPlanItemWorkflowQueuedActionsStale({
          workflow_id: workflow.id,
          action_kinds: this.dependentActionKindsForChangeRequest(artifactType),
          reason: 'artifact_change_requested',
          now: this.now(),
        });
        const transitionInput = this.changeRequestTransitionForArtifact(
          artifactType,
          revisionId,
          input.actor_id,
          input.reason_markdown,
        );
        const { updated } = await this.performManualDecisionTransitionRecordWithRepository(
          repository,
          workflow,
          transitionInput,
          this.workflowProjectionPatchAfterChangeRequest(artifactType),
        );
        const queuedAction = await this.enqueueWorkflowAction(repository, updated, session, {
          kind: this.revisionActionKindForChangeRequest(artifactType),
          actor_id: input.actor_id,
          source_revision_id: revisionId,
          change_request_id: changeRequestId,
        });
        return this.toPublicWorkflowDto(updated, session, [queuedAction]);
      }),
    );
  }

  private async enqueueWorkflowAction(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    input: {
      kind: PlanItemWorkflowQueuedActionKind;
      actor_id: string;
      source_revision_id?: string;
      change_request_id?: string;
      created_from_message_id?: string;
    },
  ): Promise<PlanItemWorkflowQueuedAction> {
    const now = this.now();
    const contextPreviewDigest = this.contextPreviewDigest(workflow, session, input.kind);
    const action: PlanItemWorkflowQueuedAction = {
      id: randomUUID(),
      workflow_id: workflow.id,
      codex_session_id: session.id,
      kind: input.kind,
      status: 'queued',
      ...(input.source_revision_id === undefined ? {} : { source_revision_id: input.source_revision_id }),
      ...(input.change_request_id === undefined ? {} : { change_request_id: input.change_request_id }),
      ...(input.created_from_message_id === undefined ? {} : { created_from_message_id: input.created_from_message_id }),
      ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
      context_preview_digest: contextPreviewDigest,
      idempotency_key: buildPlanItemWorkflowQueuedActionIdempotencyKey({
        workflow_id: workflow.id,
        kind: input.kind,
        ...(input.source_revision_id === undefined ? {} : { source_revision_id: input.source_revision_id }),
        ...(input.change_request_id === undefined ? {} : { change_request_id: input.change_request_id }),
        context_preview_digest: contextPreviewDigest,
        ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
      }),
      created_by_actor_id: input.actor_id,
      created_at: now,
      updated_at: now,
    };
    return repository.createOrReplayPlanItemWorkflowQueuedAction(action);
  }

  private async validateChangeRequestRevision(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    artifactType: WorkflowArtifactTypeDto,
    revisionId: string,
  ) {
    if (artifactType === 'boundary-summary') {
      const revision = await repository.getBoundarySummaryRevisionById(revisionId);
      this.assertOwnedDocumentRevision(workflow, revision, 'Boundary Summary revision');
      this.assertCurrentArtifactRevision(workflow.active_boundary_summary_revision_id, revisionId, 'Boundary Summary revision');
      if (revision === undefined) {
        throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary revision does not belong to this workflow/session');
      }
      const boundarySummary = await repository.getBoundarySummary(revision.boundary_summary_id);
      if (boundarySummary?.revision_id !== revisionId) {
        throw new DomainError(
          'workflow_evidence_not_current',
          'Boundary Summary revision is not current for its artifact',
          { current_revision_id: boundarySummary?.revision_id ?? null, requested_revision_id: revisionId },
        );
      }
      return;
    }
    if (artifactType === 'spec-doc') {
      const revision = await repository.getSpecRevision(revisionId);
      this.assertOwnedDocumentRevision(workflow, revision, 'Spec revision');
      this.assertCurrentArtifactRevision(workflow.active_spec_doc_revision_id, revisionId, 'Spec revision');
      if (revision === undefined) {
        throw new DomainError('workflow_evidence_not_owned', 'Spec revision does not belong to this workflow/session');
      }
      const spec = await repository.getSpec(revision.spec_id);
      if (spec?.current_revision_id !== revisionId) {
        throw new DomainError(
          'workflow_evidence_not_current',
          'Spec revision is not current for its artifact',
          { current_revision_id: spec?.current_revision_id ?? null, requested_revision_id: revisionId },
        );
      }
      return;
    }
    const revision = await repository.getExecutionPlanRevision(revisionId);
    this.assertOwnedDocumentRevision(workflow, revision, 'Implementation Plan revision');
    this.assertCurrentArtifactRevision(workflow.active_implementation_plan_doc_revision_id, revisionId, 'Implementation Plan revision');
    if (revision === undefined) {
      throw new DomainError('workflow_evidence_not_owned', 'Implementation Plan revision does not belong to this workflow/session');
    }
    const executionPlan = await repository.getExecutionPlan(revision.execution_plan_id);
    if (executionPlan?.current_revision_id !== revisionId) {
      throw new DomainError(
        'workflow_evidence_not_current',
        'Implementation Plan revision is not current for its artifact',
        { current_revision_id: executionPlan?.current_revision_id ?? null, requested_revision_id: revisionId },
      );
    }
  }

  private async applyArtifactChangeRequestSideEffects(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    artifactType: WorkflowArtifactTypeDto,
    revisionId: string,
    input: RequestWorkflowArtifactChangesBodyDto,
  ) {
    if (artifactType === 'boundary-summary') {
      await this.requestBoundarySummaryChangesWithRepository(repository, workflow, revisionId, input);
      return;
    }
    const context = {
      workflow_id: workflow.id,
      codex_session_id: this.requireString(workflow.active_codex_session_id, 'Workflow active session is missing'),
    };
    if (artifactType === 'spec-doc') {
      await this.specPlan.requestItemSpecChangesWithRepository(
        repository,
        workflow.development_plan_id,
        workflow.development_plan_item_id,
        { actor_id: input.actor_id, rationale: input.reason_markdown },
        context,
      );
      return;
    }
    await this.specPlan.requestItemImplementationPlanChangesWithRepository(
      repository,
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      { actor_id: input.actor_id, rationale: input.reason_markdown },
      context,
    );
  }

  private async requestBoundarySummaryChangesWithRepository(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    revisionId: string,
    input: RequestWorkflowArtifactChangesBodyDto,
  ) {
    const revision = await repository.getBoundarySummaryRevisionById(revisionId);
    this.assertOwnedDocumentRevision(workflow, revision, 'Boundary Summary revision');
    if (revision === undefined) {
      throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary revision does not belong to this workflow/session');
    }
    this.assertCurrentArtifactRevision(workflow.active_boundary_summary_revision_id, revisionId, 'Boundary Summary revision');
    const sessionId = this.boundarySummaryRevisionSessionId(revision);
    if (sessionId === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Boundary Summary revision session is missing');
    }
    const session = await repository.getBrainstormingSession(sessionId);
    if (
      session === undefined ||
      session.workflow_id !== workflow.id ||
      session.codex_session_id !== workflow.active_codex_session_id ||
      session.development_plan_item_id !== workflow.development_plan_item_id
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary session does not belong to this workflow/session');
    }
    const now = this.now();
    await repository.updateBoundarySummaryRevision({
      ...revision,
      status: 'superseded',
    } as BoundarySummaryRevision);
    await repository.saveBrainstormingSession({
      ...session,
      revision_id: randomUUID(),
      status: 'changes_requested',
      approval_state: 'changes_requested',
      updated_at: now,
    });
  }

  private changeRequestTransitionForArtifact(
    artifactType: WorkflowArtifactTypeDto,
    revisionId: string,
    actorId: string,
    reason: string,
  ): ManualDecisionTransitionInput {
    if (artifactType === 'boundary-summary') {
      return this.manualDecisionInput({
        actor_id: actorId,
        to_status: 'brainstorming',
        manual_decision_kind: 'change_request',
        reason,
        related_object_type: 'boundary_summary_revision',
        related_object_id: revisionId,
      });
    }
    if (artifactType === 'spec-doc') {
      return this.manualDecisionInput({
        actor_id: actorId,
        to_status: 'spec_generation_queued',
        manual_decision_kind: 'change_request',
        reason,
        related_object_type: 'spec_revision',
        related_object_id: revisionId,
      });
    }
    return this.manualDecisionInput({
      actor_id: actorId,
      to_status: 'implementation_plan_generation_queued',
      manual_decision_kind: 'change_request',
      reason,
      related_object_type: 'implementation_plan_revision',
      related_object_id: revisionId,
    });
  }

  private dependentActionKindsForChangeRequest(artifactType: WorkflowArtifactTypeDto): PlanItemWorkflowQueuedActionKind[] {
    if (artifactType === 'boundary-summary') {
      return ['generate_spec_doc', 'revise_spec_doc', 'generate_implementation_plan_doc', 'revise_implementation_plan_doc'];
    }
    if (artifactType === 'spec-doc') {
      return ['generate_implementation_plan_doc', 'revise_implementation_plan_doc'];
    }
    return ['revise_implementation_plan_doc'];
  }

  private revisionActionKindForChangeRequest(artifactType: WorkflowArtifactTypeDto): PlanItemWorkflowQueuedActionKind {
    if (artifactType === 'boundary-summary') return 'revise_boundary_summary';
    if (artifactType === 'spec-doc') return 'revise_spec_doc';
    return 'revise_implementation_plan_doc';
  }

  private workflowProjectionPatchAfterChangeRequest(
    artifactType: WorkflowArtifactTypeDto,
  ): ApplyPlanItemWorkflowTransitionInput['projection_patch'] {
    if (artifactType === 'boundary-summary') {
      return {
        active_boundary_summary_revision_id: null,
        active_spec_doc_revision_id: null,
        active_implementation_plan_doc_revision_id: null,
        execution_package_id: null,
      };
    }
    if (artifactType === 'spec-doc') {
      return {
        active_spec_doc_revision_id: null,
        active_implementation_plan_doc_revision_id: null,
        execution_package_id: null,
      };
    }
    return {
      active_implementation_plan_doc_revision_id: null,
      execution_package_id: null,
    };
  }

  private async assertNoRunningWorkflowActions(repository: DeliveryRepository, workflowId: string) {
    const activeActions = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
    const runningAction = activeActions.find((action) => action.status === 'running');
    if (runningAction !== undefined) {
      throw new DomainError(
        'workflow_action_already_pending',
        `workflow_action_already_pending: Queued action ${runningAction.id} is running`,
      );
    }
  }

  private contextPreviewDigest(
    workflow: PlanItemWorkflow,
    session: CodexSession,
    actionKind: PlanItemWorkflowQueuedActionKind,
  ): string {
    return codexCanonicalDigest({
      workflow_id: workflow.id,
      codex_session_id: session.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      workflow_status: workflow.status,
      active_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id ?? null,
      active_spec_doc_revision_id: workflow.active_spec_doc_revision_id ?? null,
      active_implementation_plan_doc_revision_id: workflow.active_implementation_plan_doc_revision_id ?? null,
      latest_capsule_digest: session.latest_capsule_digest ?? null,
      action_kind: actionKind,
    });
  }

  async transitionWorkflow(workflowId: string, dto: WorkflowTransitionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, dto.actor_id, this.actionForTransition(workflow.status, dto.to_status));
        const session = await this.requireActiveSession(repository, workflow);
        assertPlanItemWorkflowTransitionAllowed(this.transitionCheck({
          from_status: workflow.status,
          to_status: dto.to_status,
          previous_status: workflow.previous_status,
          evidence_object_type: dto.evidence_object_type,
          manual_decision_kind: dto.manual_decision_kind,
        }));
        await this.validateTransitionEvidence(repository, workflow, dto);
        this.assertGenericTransitionDoesNotBypassDocumentGate(workflow, dto);
        const updated = await this.applyTransition(repository, workflow, dto, session.id, this.now());
        return this.toPublicWorkflowDto(updated, session);
      }),
    );
  }

  async startBoundaryBrainstorming(workflowId: string, input: WorkflowBoundaryStartCommandDto) {
    const childContextInput: Parameters<PlanItemWorkflowService['prepareWorkflowChildContext']>[2] = {
      action: 'start_brainstorming',
      intent: 'continue_brainstorming',
      expectedStatus: 'brainstorming',
      operation: 'boundary-brainstorming',
    };
    const { workflow, session, context } = await this.prepareWorkflowChildContext(workflowId, input.actor_id, childContextInput);
    const result = await this.brainstorming.startBoundaryBrainstorming({
      development_plan_id: workflow.development_plan_id,
      item_id: workflow.development_plan_item_id,
      actor_id: input.actor_id,
      leader_actor_id: input.leader_actor_id,
      leader_delegate_actor_ids: input.leader_delegate_actor_ids,
      initial_leader_context_markdown: input.initial_leader_context_markdown,
      context,
    });
    return { ...result, workflow_id: workflow.id, codex_session_id: session.id, codex_session_turn_id: context.codex_session_turn_id };
  }

  async answerBoundaryQuestion(workflowId: string, sessionId: string, input: WorkflowBoundaryAnswerBodyDto) {
    const context = await this.prepareExistingBoundarySessionContext(workflowId, sessionId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'continue_brainstorming',
      expectedStatus: 'brainstorming',
      operation: 'boundary-answer',
    });
    return this.brainstorming.answerQuestion(sessionId, { ...input, context });
  }

  async recordBoundaryDecision(workflowId: string, sessionId: string, input: WorkflowBoundaryDecisionBodyDto) {
    const context = await this.prepareExistingBoundarySessionContext(workflowId, sessionId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'continue_brainstorming',
      expectedStatus: 'brainstorming',
      operation: 'boundary-decision',
    });
    return this.brainstorming.recordDecision(sessionId, { ...input, context });
  }

  async continueBoundaryBrainstorming(workflowId: string, sessionId: string, input: WorkflowBoundaryContinueBodyDto) {
    const context = await this.prepareExistingBoundarySessionContext(workflowId, sessionId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'continue_brainstorming',
      expectedStatus: 'brainstorming',
      operation: 'boundary-continue',
    });
    return this.brainstorming.continueBoundaryBrainstorming(sessionId, { ...input, context });
  }

  async requestBoundarySummaryChanges(
    workflowId: string,
    sessionId: string,
    revisionId: string,
    input: WorkflowBoundarySummaryChangesBodyDto,
  ) {
    const context = await this.prepareExistingBoundarySessionContext(workflowId, sessionId, input.actor_id, {
      action: 'approve_document_gate',
      intent: 'revise_boundary_summary',
      expectedStatus: 'brainstorming',
      operation: 'boundary-summary-request-changes',
    });
    return this.brainstorming.requestBoundarySummaryChanges(sessionId, revisionId, { ...input, context });
  }

  async submitBoundarySummary(workflowId: string, input: WorkflowRevisionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'submit_document_gate');
        if (workflow.status !== 'brainstorming') {
          throw new DomainError('workflow_invalid_transition', 'Boundary Summary submission requires brainstorming');
        }
        const session = await this.requireActiveSession(repository, workflow);
        const revision = await repository.getBoundarySummaryRevisionById(input.revision_id);
        this.assertOwnedDocumentRevision(workflow, revision, 'Boundary Summary revision');
        const updated = await this.applyTransition(
          repository,
          workflow,
          {
            actor_id: input.actor_id,
            to_status: 'boundary_review',
            evidence_object_type: 'boundary_summary_revision',
            evidence_object_id: input.revision_id,
            reason: input.reason,
          },
          session.id,
          this.now(),
        );
        return this.toPublicWorkflowDto(updated, session);
      }),
    );
  }

  async approveBoundary(workflowId: string, input: WorkflowRevisionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        if (workflow.status !== 'boundary_review') {
          throw new DomainError('workflow_invalid_transition', 'Boundary approval requires boundary_review');
        }
        const session = await this.requireActiveSession(repository, workflow);
        const revision = await repository.getBoundarySummaryRevisionById(input.revision_id);
        this.assertOwnedDocumentRevision(workflow, revision, 'Boundary Summary revision');
        if (revision === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary revision does not belong to this workflow/session');
        }
        const boundarySessionId = this.boundarySummaryRevisionSessionId(revision);
        if (boundarySessionId === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary revision is missing its Brainstorming Session owner');
        }
        await this.brainstorming.approveBoundarySummaryRevisionWithRepository(repository, boundarySessionId, revision.id, {
          actor_id: input.actor_id,
          ...(input.reason === undefined ? {} : { final_decision: input.reason }),
        });
        const dto: WorkflowTransitionCommandDto = {
          actor_id: input.actor_id,
          to_status: 'spec_generation_queued',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: input.revision_id,
          reason: input.reason,
        };
        await this.validateTransitionEvidence(repository, workflow, dto);
        const updated = await this.applyTransition(
          repository,
          workflow,
          dto,
          session.id,
          this.now(),
        );
        return this.toPublicWorkflowDto(updated, session);
      }),
    );
  }

  async generateSpecRevision(workflowId: string, input: WorkflowActorCommandDto) {
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'draft_spec_doc',
      expectedStatus: 'spec_generation_queued',
      operation: 'spec-generate-draft',
    });
    return this.specPlan.generateItemSpecDraft(workflow.development_plan_id, workflow.development_plan_item_id, input, context);
  }

  async generateSpecRevisionRuntime(workflowId: string, input: WorkflowActorCommandDto) {
    const replay = await this.replayPendingRuntimeGeneration(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      expectedStatus: 'spec_generation_queued',
      taskKind: 'spec',
    });
    if (replay !== undefined) {
      return replay.result;
    }
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'draft_spec_doc',
      expectedStatus: 'spec_generation_queued',
      operation: 'spec-runtime-generate',
    });
    return this.specPlan.generateItemSpecRevisionRuntime(
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      input,
      context,
    );
  }

  async regenerateSpecRevision(workflowId: string, input: RegenerateArtifactDraftCommandDto) {
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, this.requireActorId(input.actor_id), {
      action: 'submit_document_gate',
      intent: 'revise_spec_doc',
      expectedStatus: 'spec_generation_queued',
      operation: 'spec-regenerate-draft',
    });
    return this.specPlan.regenerateItemSpecDraft(
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      input,
      context,
    );
  }

  async saveSpecDraft(workflowId: string, input: WorkflowDraftDocumentBodyDto) {
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'revise_spec_doc',
      expectedStatus: 'spec_generation_queued',
      operation: 'spec-save-draft',
    });
    return this.specPlan.saveItemSpecDraft(
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      input.document,
      context,
    );
  }

  async submitSpecRevision(workflowId: string, input: WorkflowRevisionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'submit_document_gate');
        if (workflow.status !== 'spec_generation_queued') {
          throw new DomainError('workflow_invalid_transition', 'Spec submission requires spec_generation_queued');
        }
        const draftRevision = await repository.getSpecRevision(input.revision_id);
        this.assertOwnedDocumentRevision(workflow, draftRevision, 'Spec revision');
        if (draftRevision === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Spec revision does not belong to this workflow/session');
        }
        const spec = await repository.getSpec(draftRevision.spec_id);
        if (spec?.current_revision_id !== input.revision_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Submitted Spec revision is not current for this workflow');
        }
        const submitted = await this.specPlan.submitItemSpecForApprovalWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          input,
        );
        const revisionId = this.requireString(submitted.current_revision_id, 'Submitted Spec current revision is missing');
        if (revisionId !== input.revision_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Submitted Spec current revision does not match route revision');
        }
        const revision = await repository.getSpecRevision(revisionId);
        this.assertOwnedDocumentRevision(workflow, revision, 'Spec revision');
        const session = await this.requireActiveSession(repository, workflow);
        const updated = await this.applyTransition(
          repository,
          workflow,
          {
            actor_id: input.actor_id,
            to_status: 'spec_review',
            evidence_object_type: 'spec_revision',
            evidence_object_id: revisionId,
            reason: input.reason,
          },
          session.id,
          this.now(),
        );
        return this.toPublicWorkflowDto(updated, session);
      }),
    );
  }

  async approveSpec(workflowId: string, input: WorkflowRevisionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        if (workflow.status !== 'spec_review') {
          throw new DomainError('workflow_invalid_transition', 'Spec approval requires spec_review');
        }
        const beforeRevision = await repository.getSpecRevision(input.revision_id);
        this.assertOwnedDocumentRevision(workflow, beforeRevision, 'Spec revision');
        if (beforeRevision === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Spec revision does not belong to this workflow/session');
        }
        const spec = await repository.getSpec(beforeRevision.spec_id);
        if (spec?.current_revision_id !== input.revision_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Approved Spec revision is not current for this workflow');
        }
        await this.specPlan.approveItemSpecWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          input,
        );
        const approvedRevision = await repository.getSpecRevision(input.revision_id);
        this.assertOwnedDocumentRevision(workflow, approvedRevision, 'Spec revision');
        const session = await this.requireActiveSession(repository, workflow);
        const updated = await this.applyTransition(
          repository,
          workflow,
          {
            actor_id: input.actor_id,
            to_status: 'implementation_plan_generation_queued',
            evidence_object_type: 'spec_revision',
            evidence_object_id: input.revision_id,
            reason: input.reason,
          },
          session.id,
          this.now(),
        );
        return this.toPublicWorkflowDto(updated, session);
      }),
    );
  }

  async generateImplementationPlanRevision(workflowId: string, input: WorkflowActorCommandDto) {
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'draft_implementation_plan_doc',
      expectedStatus: 'implementation_plan_generation_queued',
      operation: 'implementation-plan-generate-draft',
    });
    return this.specPlan.generateItemImplementationPlanDraft(
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      input,
      context,
    );
  }

  async generateImplementationPlanRevisionRuntime(workflowId: string, input: WorkflowActorCommandDto) {
    const replay = await this.replayPendingRuntimeGeneration(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      expectedStatus: 'implementation_plan_generation_queued',
      taskKind: 'implementation_plan',
    });
    if (replay !== undefined) {
      return replay.result;
    }
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'draft_implementation_plan_doc',
      expectedStatus: 'implementation_plan_generation_queued',
      operation: 'implementation-plan-runtime-generate',
    });
    return this.specPlan.generateItemImplementationPlanRevisionRuntime(
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      input,
      context,
    );
  }

  async regenerateImplementationPlanRevision(workflowId: string, input: RegenerateArtifactDraftCommandDto) {
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, this.requireActorId(input.actor_id), {
      action: 'submit_document_gate',
      intent: 'revise_implementation_plan_doc',
      expectedStatus: 'implementation_plan_generation_queued',
      operation: 'implementation-plan-regenerate-draft',
    });
    return this.specPlan.regenerateItemImplementationPlanDraft(
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      input,
      context,
    );
  }

  async saveImplementationPlanDraft(workflowId: string, input: WorkflowDraftDocumentBodyDto) {
    const { workflow, context } = await this.prepareWorkflowChildContext(workflowId, input.actor_id, {
      action: 'submit_document_gate',
      intent: 'revise_implementation_plan_doc',
      expectedStatus: 'implementation_plan_generation_queued',
      operation: 'implementation-plan-save-draft',
    });
    return this.specPlan.saveItemImplementationPlanDraft(
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      input.document,
      context,
    );
  }

  async submitImplementationPlanRevision(workflowId: string, input: WorkflowRevisionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'submit_document_gate');
        if (workflow.status !== 'implementation_plan_generation_queued') {
          throw new DomainError('workflow_invalid_transition', 'Implementation Plan submission requires implementation_plan_generation_queued');
        }
        const draftRevision = await repository.getExecutionPlanRevision(input.revision_id);
        this.assertOwnedDocumentRevision(workflow, draftRevision, 'Implementation Plan revision');
        if (draftRevision === undefined) {
          throw new DomainError(
            'workflow_evidence_not_owned',
            'Implementation Plan revision does not belong to this workflow/session',
          );
        }
        const executionPlan = await repository.getExecutionPlan(draftRevision.execution_plan_id);
        if (executionPlan?.current_revision_id !== input.revision_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Submitted Implementation Plan revision is not current for this workflow');
        }
        const submitted = await this.specPlan.submitItemImplementationPlanForApprovalWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          input,
        );
        const revisionId = this.requireString(submitted.current_revision_id, 'Submitted Implementation Plan current revision is missing');
        if (revisionId !== input.revision_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Submitted Implementation Plan current revision does not match route revision');
        }
        const revision = await repository.getExecutionPlanRevision(revisionId);
        this.assertOwnedDocumentRevision(workflow, revision, 'Implementation Plan revision');
        const session = await this.requireActiveSession(repository, workflow);
        const updated = await this.applyTransition(
          repository,
          workflow,
          {
            actor_id: input.actor_id,
            to_status: 'implementation_plan_review',
            evidence_object_type: 'implementation_plan_revision',
            evidence_object_id: revisionId,
            reason: input.reason,
          },
          session.id,
          this.now(),
        );
        return this.toPublicWorkflowDto(updated, session);
      }),
    );
  }

  async approveImplementationPlan(workflowId: string, input: WorkflowRevisionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        if (workflow.status !== 'implementation_plan_review') {
          throw new DomainError('workflow_invalid_transition', 'Implementation Plan approval requires implementation_plan_review');
        }
        const revision = await repository.getExecutionPlanRevision(input.revision_id);
        this.assertOwnedDocumentRevision(workflow, revision, 'Implementation Plan revision');
        if (revision === undefined) {
          throw new DomainError(
            'workflow_evidence_not_owned',
            'Implementation Plan revision does not belong to this workflow/session',
          );
        }
        const executionPlan = await repository.getExecutionPlan(revision.execution_plan_id);
        if (executionPlan?.current_revision_id !== input.revision_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Approved Implementation Plan revision is not current for this workflow');
        }
        await this.specPlan.approveItemImplementationPlanWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          input,
        );
        return this.approveImplementationPlanAndMarkExecutionReadyWithRepository(repository, workflowId, {
          actor_id: input.actor_id,
          approved_implementation_plan_revision_id: input.revision_id,
          reason: input.reason,
        });
      }),
    );
  }

  async requestBoundaryChanges(workflowId: string, input: RequestWorkflowChangesDto) {
    const transitionInput = this.manualDecisionInput({
      actor_id: input.actor_id,
      to_status: 'brainstorming',
      manual_decision_kind: 'change_request',
      reason: input.reason,
    });
    if (input.rejected_revision_id !== undefined) {
      transitionInput.related_object_type = 'boundary_summary_revision';
      transitionInput.related_object_id = input.rejected_revision_id;
    }
    return this.performManualDecisionTransition(workflowId, transitionInput);
  }

  async requestSpecChanges(workflowId: string, input: RequestWorkflowChangesDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        const session = await this.requireActiveSession(repository, workflow);
        await this.specPlan.requestItemSpecChangesWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          { actor_id: input.actor_id, rationale: input.reason },
          { workflow_id: workflow.id, codex_session_id: session.id },
        );
        const transitionInput = this.manualDecisionInput({
          actor_id: input.actor_id,
          to_status: 'spec_generation_queued',
          manual_decision_kind: 'change_request',
          reason: input.reason,
        });
        if (input.rejected_revision_id !== undefined) {
          transitionInput.related_object_type = 'spec_revision';
          transitionInput.related_object_id = input.rejected_revision_id;
        }
        return this.performManualDecisionTransitionWithRepository(repository, workflow, transitionInput);
      }),
    );
  }

  async requestImplementationPlanChanges(workflowId: string, input: RequestWorkflowChangesDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
        const session = await this.requireActiveSession(repository, workflow);
        await this.specPlan.requestItemImplementationPlanChangesWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          { actor_id: input.actor_id, rationale: input.reason },
          { workflow_id: workflow.id, codex_session_id: session.id },
        );
        const transitionInput = this.manualDecisionInput({
          actor_id: input.actor_id,
          to_status: 'implementation_plan_generation_queued',
          manual_decision_kind: 'change_request',
          reason: input.reason,
        });
        if (input.rejected_revision_id !== undefined) {
          transitionInput.related_object_type = 'implementation_plan_revision';
          transitionInput.related_object_id = input.rejected_revision_id;
        }
        return this.performManualDecisionTransitionWithRepository(repository, workflow, transitionInput);
      }),
    );
  }

  async blockWorkflow(workflowId: string, input: ManualDecisionBodyDto) {
    return this.performManualDecisionTransition(workflowId, {
      actor_id: input.actor_id,
      to_status: 'blocked',
      manual_decision_kind: 'block',
      reason: input.reason,
    });
  }

  async recoverWorkflow(workflowId: string, input: ManualDecisionBodyDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        if (
          workflow.status !== 'blocked' ||
          workflow.previous_status === undefined ||
          workflow.previous_status === 'blocked' ||
          workflow.previous_status === 'archived'
        ) {
          throw new DomainError('workflow_invalid_transition', 'Blocked workflow has no recoverable previous status');
        }
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'recover');
        return this.performManualDecisionTransitionWithRepository(repository, workflow, {
          actor_id: input.actor_id,
          to_status: workflow.previous_status,
          manual_decision_kind: 'recover',
          reason: input.reason,
        });
      }),
    );
  }

  async archiveWorkflow(workflowId: string, input: ManualDecisionBodyDto) {
    return this.performManualDecisionTransition(workflowId, {
      actor_id: input.actor_id,
      to_status: 'archived',
      manual_decision_kind: 'archive',
      reason: input.reason,
    });
  }

  async approveImplementationPlanAndMarkExecutionReady(
    workflowId: string,
    input: ApproveImplementationPlanAndMarkExecutionReadyDto,
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction((repository) =>
        this.approveImplementationPlanAndMarkExecutionReadyWithRepository(repository, workflowId, input),
      ),
    );
  }

  async forkCodexSession(workflowId: string, sessionId: string, input: ForkCodexSessionBodyDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'select_fork');
        const parent = await repository.getCodexSession(sessionId);
        if (parent === undefined || parent.owner_id !== workflow.id) {
          throw new DomainError('codex_session_fork_invalid', `codex_session_fork_invalid: Cannot fork Codex session ${sessionId}`);
        }
        const fork = await repository.createCodexSessionFork({
          id: randomUUID(),
          workflow_id: workflow.id,
          parent_session_id: sessionId,
          ...(input.forked_from_turn_id === undefined ? {} : { forked_from_turn_id: input.forked_from_turn_id }),
          ...(input.forked_from_capsule_id === undefined ? {} : { forked_from_capsule_id: input.forked_from_capsule_id }),
          fork_reason: input.reason,
          created_by_actor_id: input.actor_id,
          now: this.now(),
        });
        return codexSessionPublicProjection(fork);
      }),
    );
  }

  async selectActiveCodexSessionFork(
    workflowId: string,
    sessionId: string,
    input: SelectCodexSessionForkBodyDto,
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'select_fork');
        const selected = await repository.getCodexSession(sessionId);
        if (selected === undefined || selected.owner_id !== workflow.id) {
          throw new DomainError('codex_session_fork_invalid', `codex_session_fork_invalid: Cannot select Codex session fork ${sessionId}`);
        }
        const result = await repository.selectActiveCodexSessionFork({
          workflow_id: workflow.id,
          selected_codex_session_id: sessionId,
          manual_decision_id: randomUUID(),
          transition_id: randomUUID(),
          actor_id: input.actor_id,
          reason: input.reason,
          now: this.now(),
        });
        return this.toPublicWorkflowDto(result.workflow, result.selectedSession);
      }),
    );
  }

  async startExecution(workflowId: string, input: WorkflowActorCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'start_execution');
        if (workflow.status !== 'execution_ready') {
          throw new DomainError('workflow_invalid_transition', 'Execution start requires execution_ready');
        }
        const session = await this.requireActiveSession(repository, workflow);
        const turn = await this.createWorkflowChildTurn(repository, workflow, session, input.actor_id, 'execute_plan', 'execution-start');
        const result = await this.executions.startExecutionWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          { actor_id: input.actor_id },
          {
            workflowId: workflow.id,
            codexSessionId: session.id,
            codexSessionTurnId: turn.id,
          },
        );
        const dto: WorkflowTransitionCommandDto = {
          actor_id: input.actor_id,
          to_status: 'execution_running',
          evidence_object_type: 'execution_package',
          evidence_object_id: result.executionPackage.id,
          codex_session_turn_id: turn.id,
          supporting_evidence: [{ object_type: 'run_session', object_id: result.runSessionId }],
        };
        await this.validateTransitionEvidence(repository, workflow, dto);
        const updated = await this.applyTransition(repository, workflow, dto, session.id, this.now());
        return this.toPublicWorkflowDto(updated, session);
      }),
    );
  }

  sendRunInput(
    workflowId: string,
    runSessionId: string,
    input: RunInputDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.withWorkflowRunSessionCommand(workflowId, runSessionId, actorContext, (workflow) =>
      this.runControl.createRunInputCommand(runSessionId, input, actorContext, workflow.id),
    );
  }

  cancelRun(
    workflowId: string,
    runSessionId: string,
    input: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.withWorkflowRunSessionCommand(workflowId, runSessionId, actorContext, (workflow) =>
      this.runControl.createRunCancelCommand(runSessionId, input, actorContext, workflow.id),
    );
  }

  resumeRun(
    workflowId: string,
    runSessionId: string,
    input: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.withWorkflowRunSessionCommand(workflowId, runSessionId, actorContext, (workflow) =>
      this.runControl.createRunResumeCommand(runSessionId, input, actorContext, workflow.id),
    );
  }

  private async withWorkflowRunSessionCommand<T>(
    workflowId: string,
    runSessionId: string,
    actorContext: ActorContext,
    run: (workflow: PlanItemWorkflow, runSession: RunSession) => Promise<T>,
  ): Promise<T> {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        const runSession = await repository.getRunSession(runSessionId);
        if (
          runSession === undefined ||
          runSession.workflow_id !== workflow.id ||
          runSession.codex_session_id !== workflow.active_codex_session_id
        ) {
          throw new NotFoundException(`RunSession ${runSessionId} not found`);
        }
        if (actorContext.authenticatedActorId !== undefined) {
          await this.assertActorCanMutateWorkflow(repository, workflow, actorContext.authenticatedActorId, 'start_execution');
        }
        return run(workflow, runSession);
      }),
    );
  }

  private async approveImplementationPlanAndMarkExecutionReadyWithRepository(
    repository: DeliveryRepository,
    workflowId: string,
    input: ApproveImplementationPlanAndMarkExecutionReadyDto,
  ) {
    const workflow = await this.requireWorkflow(repository, workflowId);
    await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
    if (workflow.status !== 'implementation_plan_review') {
      throw new DomainError('workflow_invalid_transition', 'Implementation Plan approval requires implementation_plan_review');
    }
    const revision = await repository.getExecutionPlanRevision(input.approved_implementation_plan_revision_id);
    if (!this.isOwnedExecutionPlanRevision(workflow, revision)) {
      throw new DomainError(
        'workflow_evidence_not_owned',
        'Approved Implementation Plan revision does not belong to this workflow/session',
      );
    }
    const executionPlan = await repository.getExecutionPlan(revision.execution_plan_id);
    if (
      executionPlan?.approved_revision_id !== revision.id ||
      executionPlan.approved_at === undefined ||
      executionPlan.approved_by_actor_id === undefined
    ) {
      throw new DomainError(
        'workflow_evidence_not_owned',
        'Implementation Plan revision is not approved for execution readiness',
      );
    }
    if (
      workflow.active_boundary_summary_revision_id === undefined ||
      workflow.active_spec_doc_revision_id === undefined ||
      workflow.active_codex_session_id === undefined
    ) {
      throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires active approved document revisions');
    }

    await this.specPlan.projectItemApprovedImplementationPlanForExecutionWithRepository(
      repository,
      workflow.development_plan_id,
      workflow.development_plan_item_id,
      {
        actor_id: input.actor_id,
        approved_implementation_plan_revision_id: revision.id,
        reason: input.reason,
      },
    );

    const workflowWithApprovedPlan: PlanItemWorkflow = {
      ...workflow,
      active_implementation_plan_doc_revision_id: revision.id,
    };
    const readiness = await this.createExecutionReadinessRecordForApprovedPlan(
      repository,
      workflowWithApprovedPlan,
      input.actor_id,
    );
    const dto: WorkflowTransitionCommandDto = {
      actor_id: input.actor_id,
      to_status: 'execution_ready',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: readiness.id,
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: revision.id }],
      reason: input.reason,
    };
    await this.validateTransitionEvidence(repository, workflowWithApprovedPlan, dto);
    const updated = await this.applyTransition(repository, workflow, dto, workflow.active_codex_session_id, this.now(), {
      active_implementation_plan_doc_revision_id: revision.id,
    });
    const session = await this.requireActiveSession(repository, updated);
    return this.toPublicWorkflowDto(updated, session);
  }

  private async performManualDecisionTransition(
    workflowId: string,
    input: ManualDecisionTransitionInput,
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(
          repository,
          workflow,
          input.actor_id,
          this.actionForTransition(workflow.status, input.to_status),
        );
        return this.performManualDecisionTransitionWithRepository(repository, workflow, input);
      }),
    );
  }

  private async performManualDecisionTransitionWithRepository(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    input: ManualDecisionTransitionInput,
  ) {
    const { updated, session } = await this.performManualDecisionTransitionRecordWithRepository(repository, workflow, input);
    return this.toPublicWorkflowDto(updated, session);
  }

  private async performManualDecisionTransitionRecordWithRepository(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    input: ManualDecisionTransitionInput,
    projectionPatch?: ApplyPlanItemWorkflowTransitionInput['projection_patch'],
  ): Promise<{ updated: PlanItemWorkflow; session: CodexSession }> {
    const session = await this.requireActiveSession(repository, workflow);
    const now = this.now();
    const decision = await this.createManualDecision(repository, workflow, {
      ...input,
      codex_session_id: session.id,
      created_at: now,
    });
    const dto: WorkflowTransitionCommandDto = {
      actor_id: input.actor_id,
      to_status: input.to_status,
      evidence_object_type: 'manual_decision',
      evidence_object_id: decision.id,
      manual_decision_kind: input.manual_decision_kind,
      reason: input.reason,
    };
    await this.validateTransitionEvidence(repository, workflow, dto);
    const updated = await this.applyTransition(repository, workflow, dto, session.id, now, projectionPatch);
    return { updated, session };
  }

  private async createManualDecision(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    input: {
      actor_id: string;
      codex_session_id: string;
      manual_decision_kind: WorkflowManualDecision['kind'];
      reason: string;
      related_object_type?: WorkflowTransitionEvidenceObjectType;
      related_object_id?: string;
      selected_codex_session_id?: string;
      created_at: string;
    },
  ) {
    const decision: WorkflowManualDecision = {
      id: randomUUID(),
      workflow_id: workflow.id,
      codex_session_id: input.codex_session_id,
      kind: input.manual_decision_kind,
      reason: input.reason,
      created_by_actor_id: input.actor_id,
      created_at: input.created_at,
    };
    if (input.selected_codex_session_id !== undefined) {
      decision.selected_codex_session_id = input.selected_codex_session_id;
    }
    if (input.related_object_type !== undefined && input.related_object_id !== undefined) {
      decision.related_object_type = input.related_object_type;
      decision.related_object_id = input.related_object_id;
    }
    await repository.saveWorkflowManualDecision(decision);
    return decision;
  }

  private assertGenericTransitionDoesNotBypassDocumentGate(
    workflow: PlanItemWorkflow,
    dto: WorkflowTransitionCommandDto,
  ): void {
    const bypassesDedicatedDocumentRoute =
      (workflow.status === 'brainstorming' &&
        dto.to_status === 'boundary_review' &&
        dto.evidence_object_type === 'boundary_summary_revision') ||
      (workflow.status === 'boundary_review' &&
        dto.to_status === 'spec_generation_queued' &&
        dto.evidence_object_type === 'boundary_summary_revision') ||
      (workflow.status === 'spec_generation_queued' &&
        dto.to_status === 'spec_review' &&
        dto.evidence_object_type === 'spec_revision') ||
      (workflow.status === 'spec_review' &&
        dto.to_status === 'implementation_plan_generation_queued' &&
        dto.evidence_object_type === 'spec_revision') ||
      (workflow.status === 'implementation_plan_generation_queued' &&
        dto.to_status === 'implementation_plan_review' &&
        dto.evidence_object_type === 'implementation_plan_revision') ||
      (workflow.status === 'implementation_plan_review' &&
        dto.to_status === 'execution_ready' &&
        dto.evidence_object_type === 'execution_readiness_record');
    if (bypassesDedicatedDocumentRoute) {
      throw new DomainError(
        'workflow_invalid_transition',
        'workflow_invalid_transition: Document gate transitions must use the dedicated PlanItemWorkflow document routes',
      );
    }
  }

  private async replayPendingRuntimeGeneration(
    workflowId: string,
    actorId: string,
    input: {
      action: WorkflowAction;
      expectedStatus: PlanItemWorkflowStatus;
      taskKind: PendingRuntimeGenerationKind;
    },
  ): Promise<{ result: ProductGenerationScheduleResult } | undefined> {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        if (workflow.status !== input.expectedStatus) {
          return undefined;
        }
        await this.assertActorCanMutateWorkflow(repository, workflow, actorId, input.action);
        const session = await this.requireActiveSession(repository, workflow);
        const context = {
          workflow_id: workflow.id,
          codex_session_id: session.id,
        };
        const result =
          input.taskKind === 'spec'
            ? await this.specPlan.replayScheduledItemSpecRevisionRuntimeWithRepository(
                repository,
                workflow.development_plan_id,
                workflow.development_plan_item_id,
                { actor_id: actorId },
                context,
              )
            : await this.specPlan.replayScheduledItemImplementationPlanRevisionRuntimeWithRepository(
                repository,
                workflow.development_plan_id,
                workflow.development_plan_item_id,
                { actor_id: actorId },
                context,
              );
        if (result !== undefined) {
          return { result };
        }
        return undefined;
      }),
    );
  }

  private transitionCheck(input: {
    from_status: PlanItemWorkflowStatus;
    to_status: PlanItemWorkflowStatus;
    previous_status: PlanItemWorkflowStatus | undefined;
    evidence_object_type: WorkflowTransitionEvidenceObjectType;
    manual_decision_kind: WorkflowManualDecision['kind'] | undefined;
  }): TransitionCheckInput {
    const output: TransitionCheckInput = {
      from_status: input.from_status,
      to_status: input.to_status,
      evidence_object_type: input.evidence_object_type,
    };
    if (input.previous_status !== undefined) output.previous_status = input.previous_status;
    if (input.manual_decision_kind !== undefined) output.manual_decision_kind = input.manual_decision_kind;
    return output;
  }

  private manualDecisionInput(input: {
    actor_id: string;
    to_status: PlanItemWorkflowStatus;
    manual_decision_kind: WorkflowManualDecision['kind'];
    reason: string;
    related_object_type?: WorkflowTransitionEvidenceObjectType;
    related_object_id?: string;
    selected_codex_session_id?: string;
  }): ManualDecisionTransitionInput {
    const output: ManualDecisionTransitionInput = {
      actor_id: input.actor_id,
      to_status: input.to_status,
      manual_decision_kind: input.manual_decision_kind,
      reason: input.reason,
    };
    if (input.related_object_type !== undefined && input.related_object_id !== undefined) {
      output.related_object_type = input.related_object_type;
      output.related_object_id = input.related_object_id;
    }
    if (input.selected_codex_session_id !== undefined) output.selected_codex_session_id = input.selected_codex_session_id;
    return output;
  }

  private evidenceValidationInput(input: {
    object_type: WorkflowTransitionEvidenceObjectType;
    object_id: string;
    to_status: PlanItemWorkflowStatus;
    actor_id: string;
    manual_decision_kind: WorkflowManualDecision['kind'] | undefined;
    supporting?: boolean;
  }): EvidenceValidationInput {
    const output: EvidenceValidationInput = {
      object_type: input.object_type,
      object_id: input.object_id,
      to_status: input.to_status,
      actor_id: input.actor_id,
    };
    if (input.manual_decision_kind !== undefined) output.manual_decision_kind = input.manual_decision_kind;
    if (input.supporting !== undefined) output.supporting = input.supporting;
    return output;
  }

  private async createExecutionReadinessRecordForApprovedPlan(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    actorId: string,
  ) {
    if (
      workflow.active_boundary_summary_revision_id === undefined ||
      workflow.active_spec_doc_revision_id === undefined ||
      workflow.active_implementation_plan_doc_revision_id === undefined ||
      workflow.active_codex_session_id === undefined
    ) {
      throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires active approved document revisions');
    }
    const implementationPlanRevision = await repository.getExecutionPlanRevision(workflow.active_implementation_plan_doc_revision_id);
    const record = {
      id: randomUUID(),
      workflow_id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      codex_session_id: workflow.active_codex_session_id,
      approved_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id,
      approved_spec_revision_id: workflow.active_spec_doc_revision_id,
      approved_implementation_plan_revision_id: workflow.active_implementation_plan_doc_revision_id,
      ...(implementationPlanRevision?.codex_session_turn_id === undefined
        ? {}
        : { codex_session_turn_id: implementationPlanRevision.codex_session_turn_id }),
      readiness_state: 'ready' as const,
      blocker_codes: [],
      supporting_evidence: [
        {
          object_type: 'implementation_plan_revision' as const,
          object_id: workflow.active_implementation_plan_doc_revision_id,
        },
      ],
      created_by_actor_id: actorId,
      created_at: this.now(),
    };
    await repository.saveExecutionReadinessRecord(record);
    return record;
  }

  private async requireApprovedImplementationPlanRevisionForReadiness(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
  ): Promise<ExecutionPlanRevision> {
    const plans = await repository.listExecutionPlansForDevelopmentPlanItem(workflow.development_plan_item_id);
    const approvedPlans = plans
      .filter((plan) => plan.workflow_id === workflow.id && plan.status === 'approved' && plan.approved_revision_id !== undefined)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id));
    const plan = approvedPlans[0];
    if (plan === undefined || plan.approved_revision_id === undefined) {
      throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires an approved Implementation Plan revision');
    }
    const revision = await repository.getExecutionPlanRevision(plan.approved_revision_id);
    if (!this.isOwnedExecutionPlanRevision(workflow, revision)) {
      throw new DomainError(
        'workflow_evidence_not_owned',
        'Approved Implementation Plan revision does not belong to this workflow/session',
      );
    }
    if (
      plan.current_revision_id !== revision.id ||
      plan.approved_by_actor_id === undefined ||
      plan.approved_at === undefined ||
      revision.based_on_spec_revision_id !== workflow.active_spec_doc_revision_id
    ) {
      throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires current approved document revisions');
    }
    return revision;
  }

  private readinessProjectionForRecord(
    record: Awaited<ReturnType<PlanItemWorkflowService['createExecutionReadinessRecordForApprovedPlan']>>,
  ): PlanItemWorkflowReadiness {
    return {
      state: record.readiness_state === 'ready' ? 'ready' : 'blocked',
      can_evaluate: record.readiness_state !== 'ready',
      blocker_codes: record.blocker_codes,
      evaluated_at: record.created_at,
      evidence_digest: codexCanonicalDigest({
        execution_readiness_record_id: record.id,
        workflow_id: record.workflow_id,
        approved_boundary_summary_revision_id: record.approved_boundary_summary_revision_id,
        approved_spec_revision_id: record.approved_spec_revision_id,
        approved_implementation_plan_revision_id: record.approved_implementation_plan_revision_id,
        readiness_state: record.readiness_state,
        blocker_codes: record.blocker_codes,
      }),
    };
  }

  private notEvaluatedReadiness(canEvaluate: boolean): PlanItemWorkflowReadiness {
    return {
      state: 'not_evaluated',
      can_evaluate: canEvaluate,
      blocker_codes: [],
    };
  }

  private async applyTransition(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    dto: WorkflowTransitionCommandDto,
    codexSessionId: string,
    now: string,
    projectionPatch: ApplyPlanItemWorkflowTransitionInput['projection_patch'] = {},
  ) {
    const patch = { ...projectionPatch, ...this.projectionPatchForTransition(workflow, dto) };
    const transition: ApplyPlanItemWorkflowTransitionInput['transition'] = {
      id: randomUUID(),
      workflow_id: workflow.id,
      from_status: workflow.status,
      to_status: dto.to_status,
      actor_id: dto.actor_id,
      evidence_object_type: dto.evidence_object_type,
      evidence_object_id: dto.evidence_object_id,
      codex_session_id: codexSessionId,
      created_at: now,
    };
    if (dto.reason !== undefined) transition.reason = dto.reason;
    if (dto.evidence_digest !== undefined) transition.evidence_digest = dto.evidence_digest;
    if (dto.supporting_evidence !== undefined) transition.supporting_evidence = this.supportingEvidence(dto.supporting_evidence);
    const evidenceTurnId = dto.codex_session_turn_id ?? (await this.codexSessionTurnIdForEvidence(repository, dto));
    if (evidenceTurnId !== undefined) transition.codex_session_turn_id = evidenceTurnId;
    const input: ApplyPlanItemWorkflowTransitionInput = { transition };
    if (Object.keys(patch).length > 0) input.projection_patch = patch;
    return repository.applyPlanItemWorkflowTransition(input);
  }

  private supportingEvidence(input: NonNullable<WorkflowTransitionCommandDto['supporting_evidence']>) {
    return input.map((evidence) => {
      const output: NonNullable<ApplyPlanItemWorkflowTransitionInput['transition']['supporting_evidence']>[number] = {
        object_type: evidence.object_type,
        object_id: evidence.object_id,
      };
      if (evidence.digest !== undefined) output.digest = evidence.digest;
      return output;
    });
  }

  private projectionPatchForTransition(
    workflow: PlanItemWorkflow,
    dto: WorkflowTransitionCommandDto,
  ): ApplyPlanItemWorkflowTransitionInput['projection_patch'] {
    if (workflow.status === 'boundary_review' && dto.to_status === 'spec_generation_queued') {
      return { active_boundary_summary_revision_id: dto.evidence_object_id };
    }
    if (workflow.status === 'spec_review' && dto.to_status === 'implementation_plan_generation_queued') {
      return { active_spec_doc_revision_id: dto.evidence_object_id };
    }
    if (workflow.status === 'execution_ready' && dto.to_status === 'execution_running') {
      return { execution_package_id: dto.evidence_object_id };
    }
    return {};
  }

  private async codexSessionTurnIdForEvidence(
    repository: DeliveryRepository,
    dto: WorkflowTransitionCommandDto,
  ): Promise<string | undefined> {
    switch (dto.evidence_object_type) {
      case 'boundary_summary_revision':
        return this.workflowRefTurnId(await repository.getBoundarySummaryRevisionById(dto.evidence_object_id));
      case 'spec_revision':
        return this.workflowRefTurnId(await repository.getSpecRevision(dto.evidence_object_id));
      case 'implementation_plan_revision':
        return this.workflowRefTurnId(await repository.getExecutionPlanRevision(dto.evidence_object_id));
      case 'execution_readiness_record':
        return this.workflowRefTurnId(await repository.getExecutionReadinessRecord(dto.evidence_object_id));
      case 'execution_package':
        return this.workflowRefTurnId(await repository.getExecutionPackage(dto.evidence_object_id));
      case 'run_session':
        return this.workflowRefTurnId(await repository.getRunSession(dto.evidence_object_id));
      case 'review_packet':
        return this.workflowRefTurnId(await repository.getReviewPacket(dto.evidence_object_id));
      default:
        return undefined;
    }
  }

  private workflowRefTurnId(record: WorkflowPersistenceRefs | undefined): string | undefined {
    return record?.codex_session_turn_id;
  }

  private async validateTransitionEvidence(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    dto: WorkflowTransitionCommandDto,
  ) {
    await this.validateEvidenceOwnership(repository, workflow, this.evidenceValidationInput({
      object_type: dto.evidence_object_type,
      object_id: dto.evidence_object_id,
      to_status: dto.to_status,
      actor_id: dto.actor_id,
      manual_decision_kind: dto.manual_decision_kind,
    }));

    for (const supporting of dto.supporting_evidence ?? []) {
      await this.validateEvidenceOwnership(repository, workflow, this.evidenceValidationInput({
        object_type: supporting.object_type,
        object_id: supporting.object_id,
        to_status: dto.to_status,
        actor_id: dto.actor_id,
        manual_decision_kind: dto.manual_decision_kind,
        supporting: true,
      }));
    }
  }

  private async validateEvidenceOwnership(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    evidence: EvidenceValidationInput,
  ) {
    switch (evidence.object_type) {
      case 'manual_decision': {
        const decision = await repository.getWorkflowManualDecision(evidence.object_id);
        if (
          decision === undefined ||
          decision.workflow_id !== workflow.id ||
          decision.codex_session_id !== workflow.active_codex_session_id ||
          decision.kind !== evidence.manual_decision_kind ||
          decision.created_by_actor_id !== evidence.actor_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Manual decision does not belong to this workflow/session');
        }
        return;
      }
      case 'execution_readiness_record': {
        const record = await repository.getExecutionReadinessRecord(evidence.object_id);
        if (
          record === undefined ||
          record.workflow_id !== workflow.id ||
          record.development_plan_id !== workflow.development_plan_id ||
          record.development_plan_item_id !== workflow.development_plan_item_id ||
          record.codex_session_id !== workflow.active_codex_session_id ||
          record.readiness_state !== 'ready' ||
          record.approved_boundary_summary_revision_id !== workflow.active_boundary_summary_revision_id ||
          record.approved_spec_revision_id !== workflow.active_spec_doc_revision_id ||
          record.approved_implementation_plan_revision_id !== workflow.active_implementation_plan_doc_revision_id ||
          !record.supporting_evidence.some(
            (supporting) =>
              supporting.object_type === 'implementation_plan_revision' &&
              supporting.object_id === workflow.active_implementation_plan_doc_revision_id,
          )
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Execution readiness evidence is not ready for this workflow');
        }
        return;
      }
      case 'boundary_summary_revision': {
        const revision = await repository.getBoundarySummaryRevisionById(evidence.object_id);
        this.assertOwnedDocumentRevision(workflow, revision, 'Boundary Summary revision');
        if (!evidence.supporting && evidence.to_status === 'spec_generation_queued' && this.recordApprovedAt(revision) === undefined) {
          throw new DomainError('workflow_evidence_type_invalid', 'Boundary approval requires an approved Boundary Summary revision');
        }
        return;
      }
      case 'spec_revision': {
        const revision = await repository.getSpecRevision(evidence.object_id);
        this.assertOwnedDocumentRevision(workflow, revision, 'Spec revision');
        if (
          !evidence.supporting &&
          evidence.to_status === 'implementation_plan_generation_queued' &&
          this.recordApprovedAt(revision) === undefined
        ) {
          throw new DomainError('workflow_evidence_type_invalid', 'Spec approval requires an approved Spec revision');
        }
        return;
      }
      case 'implementation_plan_revision': {
        const revision = await repository.getExecutionPlanRevision(evidence.object_id);
        this.assertOwnedDocumentRevision(workflow, revision, 'Implementation Plan revision');
        if (!evidence.supporting && evidence.to_status === 'execution_ready' && revision !== undefined) {
          const executionPlan = await repository.getExecutionPlan(revision.execution_plan_id);
          if (
            executionPlan?.approved_revision_id !== revision.id ||
            executionPlan.approved_at === undefined ||
            executionPlan.approved_by_actor_id === undefined
          ) {
            throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires an approved Implementation Plan revision');
          }
        }
        if (!evidence.supporting && evidence.to_status === 'execution_ready' && revision === undefined) {
          throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires an approved Implementation Plan revision');
        }
        return;
      }
      case 'execution_package': {
        const executionPackage = await repository.getExecutionPackage(evidence.object_id);
        if (
          executionPackage === undefined ||
          executionPackage.development_plan_item_id !== workflow.development_plan_item_id ||
          executionPackage.workflow_id !== workflow.id ||
          executionPackage.codex_session_id !== workflow.active_codex_session_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Execution Package does not belong to this workflow/session');
        }
        return;
      }
      case 'run_session': {
        const runSession = await repository.getRunSession(evidence.object_id);
        if (runSession === undefined || runSession.workflow_id !== workflow.id || runSession.codex_session_id !== workflow.active_codex_session_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Run Session does not belong to this workflow/session');
        }
        return;
      }
      case 'review_packet': {
        const packet = await repository.getReviewPacket(evidence.object_id);
        const executionPackage =
          packet === undefined ? undefined : await repository.getExecutionPackage(packet.execution_package_id);
        if (
          packet === undefined ||
          executionPackage === undefined ||
          packet.workflow_id !== workflow.id ||
          packet.codex_session_id !== workflow.active_codex_session_id ||
          executionPackage.development_plan_item_id !== workflow.development_plan_item_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Review Packet does not belong to this workflow/session');
        }
        return;
      }
      case 'internal_artifact': {
        const artifact = await repository.getInternalArtifactObjectById(evidence.object_id);
        const allowedOwnerIds = new Set(
          [workflow.active_codex_session_id, workflow.execution_package_id].filter((id): id is string => id !== undefined),
        );
        if (artifact === undefined || artifact.deleted_at !== undefined || !allowedOwnerIds.has(artifact.owner_id)) {
          throw new DomainError('workflow_evidence_not_owned', 'Internal artifact does not belong to this workflow');
        }
        return;
      }
      case 'commit':
      case 'pull_request': {
        if (!this.isExecutionSideStatus(workflow.status, evidence.to_status)) {
          throw new DomainError('workflow_evidence_type_invalid', 'Commit and pull request evidence is execution-side only');
        }
        const resolved = await repository.resolveWorkflowRepositoryEvidence({
          evidence_object_type: evidence.object_type,
          evidence_object_id: evidence.object_id,
          workflow_id: workflow.id,
          development_plan_id: workflow.development_plan_id,
          development_plan_item_id: workflow.development_plan_item_id,
        });
        if (resolved === undefined) {
          throw new DomainError('workflow_evidence_not_owned', 'Repository evidence does not resolve to the workflow project repo');
        }
        return;
      }
      default:
        throw new DomainError('workflow_evidence_type_invalid', `Unsupported workflow evidence type ${evidence.object_type}`);
    }
  }

  private assertOwnedDocumentRevision(
    workflow: PlanItemWorkflow,
    revision: BoundarySummaryRevision | SpecRevision | ExecutionPlanRevision | undefined,
    label: string,
  ) {
    if (!this.isOwnedDocumentRevision(workflow, revision)) {
      throw new DomainError('workflow_evidence_not_owned', `${label} does not belong to this workflow/session`);
    }
  }

  private assertCurrentArtifactRevision(activeRevisionId: string | undefined, revisionId: string, label: string) {
    if (activeRevisionId !== revisionId) {
      throw new DomainError(
        'workflow_evidence_not_current',
        `${label} is not the workflow current active revision`,
        { active_revision_id: activeRevisionId ?? null, requested_revision_id: revisionId },
      );
    }
  }

  private isOwnedDocumentRevision(
    workflow: PlanItemWorkflow,
    revision: BoundarySummaryRevision | SpecRevision | ExecutionPlanRevision | undefined,
  ): revision is BoundarySummaryRevision | SpecRevision | ExecutionPlanRevision {
    return (
      revision !== undefined &&
      revision.development_plan_item_id === workflow.development_plan_item_id &&
      revision.workflow_id === workflow.id &&
      revision.codex_session_id === workflow.active_codex_session_id
    );
  }

  private isOwnedExecutionPlanRevision(
    workflow: PlanItemWorkflow,
    revision: ExecutionPlanRevision | undefined,
  ): revision is ExecutionPlanRevision {
    return this.isOwnedDocumentRevision(workflow, revision);
  }

  private boundarySummaryRevisionSessionId(revision: BoundarySummaryRevision): string | undefined {
    const record = revision as BoundarySummaryRevision & { session_id?: string; brainstorming_session_id?: string };
    return record.session_id ?? record.brainstorming_session_id;
  }

  private async requireWorkflow(repository: DeliveryRepository, workflowId: string) {
    const workflow = await repository.getPlanItemWorkflow(workflowId);
    if (workflow === undefined) {
      throw new DomainError('workflow_evidence_missing', `Workflow ${workflowId} does not exist`);
    }
    return workflow;
  }

  private async requireActiveSession(repository: DeliveryRepository, workflow: PlanItemWorkflow) {
    if (workflow.active_codex_session_id === undefined) {
      throw new DomainError('workflow_active_session_missing', `Workflow ${workflow.id} has no active Codex Session`);
    }
    const session = await repository.getCodexSession(workflow.active_codex_session_id);
    if (session === undefined) {
      throw new DomainError('workflow_active_session_missing', `Active Codex Session ${workflow.active_codex_session_id} does not exist`);
    }
    return session;
  }

  private async prepareWorkflowChildContext(
    workflowId: string,
    actorId: string,
    input: {
      action: WorkflowAction;
      intent: CodexSessionTurn['intent'];
      expectedStatus: PlanItemWorkflowStatus;
      operation: string;
    },
  ): Promise<{ workflow: PlanItemWorkflow; session: CodexSession; context: PlanItemWorkflowChildContext }> {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        if (workflow.status !== input.expectedStatus) {
          throw new DomainError(
            'workflow_invalid_transition',
            `${input.operation} requires workflow status ${input.expectedStatus}`,
          );
        }
        if (input.operation === 'boundary-brainstorming' && input.action === 'start_brainstorming') {
          await this.assertActorCanStartBoundaryBrainstorming(repository, workflow, actorId);
        } else {
          await this.assertActorCanMutateWorkflow(repository, workflow, actorId, input.action);
        }
        const session = await this.requireActiveSession(repository, workflow);
        const turn = await this.createWorkflowChildTurn(repository, workflow, session, actorId, input.intent, input.operation);
        return {
          workflow,
          session,
          context: {
            workflow_id: workflow.id,
            codex_session_id: session.id,
            codex_session_turn_id: turn.id,
          },
        };
      }),
    );
  }

  private async prepareExistingBoundarySessionContext(
    workflowId: string,
    sessionId: string,
    actorId: string,
    input: {
      action: WorkflowAction;
      intent: CodexSessionTurn['intent'];
      expectedStatus: PlanItemWorkflowStatus;
      operation: string;
    },
  ): Promise<PlanItemWorkflowChildContext> {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        if (workflow.status !== input.expectedStatus) {
          throw new DomainError(
            'workflow_invalid_transition',
            `${input.operation} requires workflow status ${input.expectedStatus}`,
          );
        }
        const session = await this.requireActiveSession(repository, workflow);
        const brainstormingSession = await repository.getBrainstormingSession(sessionId);
        if (
          brainstormingSession === undefined ||
          brainstormingSession.workflow_id !== workflow.id ||
          brainstormingSession.codex_session_id !== session.id ||
          brainstormingSession.development_plan_item_id !== workflow.development_plan_item_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Boundary Brainstorming Session does not belong to this workflow/session');
        }
        if (!this.workflowBoundaryActorCanMutateSession(brainstormingSession, actorId)) {
          await this.assertActorCanMutateWorkflow(repository, workflow, actorId, input.action);
        }
        const turn = await this.createWorkflowChildTurn(repository, workflow, session, actorId, input.intent, input.operation);
        return {
          workflow_id: workflow.id,
          codex_session_id: session.id,
          codex_session_turn_id: turn.id,
        };
      }),
    );
  }

  private async createWorkflowChildTurn(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    actorId: string,
    intent: CodexSessionTurn['intent'],
    operation: string,
  ): Promise<CodexSessionTurn> {
    const now = this.now();
    const inputDigest = codexCanonicalDigest({
      workflow_id: workflow.id,
      codex_session_id: session.id,
      development_plan_item_id: workflow.development_plan_item_id,
      operation,
      intent,
      actor_id: actorId,
      expected_input_capsule_digest: session.latest_capsule_digest ?? null,
      created_at: now,
    });
    const turn: CodexSessionTurn = {
      id: randomUUID(),
      workflow_id: workflow.id,
      codex_session_id: session.id,
      intent,
      status: 'running',
      input_digest: inputDigest,
      ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
      created_by_actor_id: actorId,
      created_at: now,
      updated_at: now,
    };
    await repository.createCodexSessionTurn(turn);
    return turn;
  }

  private async requirePlanItemBelongsToPlan(repository: DeliveryRepository, developmentPlanId: string, itemId: string) {
    const item = await repository.getDevelopmentPlanItem(itemId);
    if (item === undefined || item.development_plan_id !== developmentPlanId) {
      throw new DomainError(
        'workflow_invalid_transition',
        `Plan Item ${itemId} does not belong to Development Plan ${developmentPlanId}`,
      );
    }
    return item;
  }

  private assertActorCanStartWorkflowItem(item: DevelopmentPlanItem, actorId: string, sourceDriverActorId?: string) {
    const itemWithSourceDriver: DevelopmentPlanItem =
      item.driver_actor_id === undefined && sourceDriverActorId !== undefined
        ? { ...item, driver_actor_id: sourceDriverActorId }
        : item;
    const actorContext: Parameters<typeof assertWorkflowActorAuthorized>[2] = {
      actor_id: actorId,
      development_plan_item: this.workflowActorPlanItem(itemWithSourceDriver),
    };
    assertWorkflowActorAuthorized({ development_plan_item_id: item.id }, 'start_brainstorming', actorContext);
  }

  private async assertActorCanStartBoundaryBrainstorming(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    actorId: string,
  ) {
    const item = await repository.getDevelopmentPlanItem(workflow.development_plan_item_id);
    if (item === undefined) {
      throw new DomainError(
        'workflow_actor_not_authorized',
        `Actor ${actorId} cannot perform start_brainstorming on workflow item ${workflow.development_plan_item_id}`,
      );
    }
    const workItem = await repository.getWorkItem(item.source_ref.id);
    this.assertActorCanStartWorkflowItem(item, actorId, workItem?.driver_actor_id);
  }

  private async assertActorCanMutateWorkflow(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    actorId: string,
    action: WorkflowAction,
  ) {
    const item = await repository.getDevelopmentPlanItem(workflow.development_plan_item_id);
    const actorContext: Parameters<typeof assertWorkflowActorAuthorized>[2] = {
      actor_id: actorId,
    };
    if (item !== undefined) actorContext.development_plan_item = this.workflowActorPlanItem(item);
    const executionOwnerActorId = this.executionOwnerActorId(workflow);
    if (executionOwnerActorId !== undefined) actorContext.execution_owner_actor_id = executionOwnerActorId;
    assertWorkflowActorAuthorized(workflow, action, actorContext);
  }

  private workflowActorPlanItem(item: DevelopmentPlanItem): NonNullable<Parameters<typeof assertWorkflowActorAuthorized>[2]['development_plan_item']> {
    const output: NonNullable<Parameters<typeof assertWorkflowActorAuthorized>[2]['development_plan_item']> = {};
    if (item.driver_actor_id !== undefined) output.driver_actor_id = item.driver_actor_id;
    if (item.reviewer_actor_id !== undefined) output.reviewer_actor_id = item.reviewer_actor_id;
    if (item.leader_actor_id !== undefined) output.leader_actor_id = item.leader_actor_id;
    if (item.leader_delegate_actor_ids !== undefined) output.leader_delegate_actor_ids = item.leader_delegate_actor_ids;
    return output;
  }

  private workflowBoundaryActorCanMutateSession(
    session: Pick<BrainstormingSession, 'id' | 'leader_actor_id' | 'leader_delegate_actor_ids'>,
    actorId: string,
  ) {
    return session.leader_actor_id === actorId || (session.leader_delegate_actor_ids ?? []).includes(actorId);
  }

  private actionForTransition(from: PlanItemWorkflowStatus, to: PlanItemWorkflowStatus): WorkflowAction {
    if (to === 'blocked') return 'block';
    if (from === 'blocked') return 'recover';
    if (to === 'archived') return 'archive';
    if (from === to) return 'select_fork';
    if (to === 'execution_running') return 'start_execution';
    if (to === 'spec_generation_queued' || to === 'implementation_plan_generation_queued' || to === 'execution_ready') {
      return 'approve_document_gate';
    }
    return 'submit_document_gate';
  }

  private recordApprovedAt(record: unknown) {
    return (record as { approved_at?: string; status?: string }).approved_at ?? ((record as { status?: string }).status === 'approved' ? 'approved' : undefined);
  }

  private isExecutionSideStatus(from: PlanItemWorkflowStatus, to: PlanItemWorkflowStatus) {
    return ['execution_ready', 'execution_running', 'code_review', 'qa', 'release_ready'].includes(from) ||
      ['execution_running', 'code_review', 'qa', 'release_ready'].includes(to);
  }

  private executionOwnerActorId(workflow: PlanItemWorkflow) {
    return (workflow as PlanItemWorkflow & { execution_owner_actor_id?: string }).execution_owner_actor_id;
  }

  private requireString(value: string | undefined, message: string): string {
    if (value === undefined) {
      throw new DomainError('workflow_evidence_missing', message);
    }
    return value;
  }

  private requireActorId(value: string | undefined): string {
    if (value === undefined) {
      throw new DomainError('workflow_actor_not_authorized', 'workflow_actor_not_authorized: actor_id is required');
    }
    return value;
  }

  private toPublicWorkflowDto(
    workflow: PlanItemWorkflow,
    session: CodexSession,
    queuedActions: readonly PlanItemWorkflowQueuedAction[] = [],
    options: {
      readiness?: PlanItemWorkflowReadiness;
      blockers?: Parameters<typeof planItemWorkflowPublicProjection>[0]['blockers'];
    } = {},
  ) {
    return planItemWorkflowPublicProjection({
      workflow,
      session,
      queued_actions: queuedActions,
      context_preview: {
        digest: this.contextPreviewDigest(workflow, session, 'continue_brainstorming'),
        ...(session.latest_capsule_digest === undefined ? {} : { capsule_digest: session.latest_capsule_digest }),
        ...(workflow.active_boundary_summary_revision_id === undefined
          ? {}
          : { boundary_summary_revision_id: workflow.active_boundary_summary_revision_id }),
        ...(workflow.active_spec_doc_revision_id === undefined ? {} : { spec_doc_revision_id: workflow.active_spec_doc_revision_id }),
        ...(workflow.active_implementation_plan_doc_revision_id === undefined
          ? {}
          : { implementation_plan_doc_revision_id: workflow.active_implementation_plan_doc_revision_id }),
        queued_action_count: queuedActions.length,
        updated_at: workflow.updated_at,
      },
      ...(options.readiness === undefined ? {} : { readiness: options.readiness }),
      ...(options.blockers === undefined ? {} : { blockers: options.blockers }),
    });
  }

  private now() {
    return new Date().toISOString();
  }
}
