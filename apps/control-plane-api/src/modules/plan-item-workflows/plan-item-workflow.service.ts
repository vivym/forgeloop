import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  assertPlanItemWorkflowTransitionAllowed,
  assertWorkflowActorAuthorized,
  codexSessionPublicProjection,
  type BoundarySummaryRevision,
  type CodexSession,
  type DevelopmentPlanItem,
  type ExecutionPlanRevision,
  type PlanItemWorkflow,
  type SpecRevision,
  type WorkflowManualDecision,
} from '@forgeloop/domain';
import type { PlanItemWorkflowStatus, WorkflowTransitionEvidenceObjectType } from '@forgeloop/contracts';
import type { ApplyPlanItemWorkflowTransitionInput, DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type {
  ApproveImplementationPlanAndMarkExecutionReadyDto,
  ManualDecisionBodyDto,
  RequestWorkflowChangesDto,
  StartBrainstormingWorkflowDto,
  WorkflowTransitionCommandDto,
} from './plan-item-workflow.dto';

type WorkflowAction = Parameters<typeof assertWorkflowActorAuthorized>[1];
type TransitionCheckInput = Parameters<typeof assertPlanItemWorkflowTransitionAllowed>[0];
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

@Injectable()
export class PlanItemWorkflowService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async startBrainstorming(developmentPlanId: string, itemId: string, dto: StartBrainstormingWorkflowDto) {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const now = this.now();
        const item = await this.requirePlanItemBelongsToPlan(repository, developmentPlanId, itemId);
        this.assertActorCanStartWorkflowItem(item, dto.actor_id);
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

        return this.toPublicWorkflowDto(updated, created.session);
      }),
    );
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
        const updated = await this.applyTransition(repository, workflow, dto, session.id, this.now());
        return this.toPublicWorkflowDto(updated, session);
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
    return this.performManualDecisionTransition(workflowId, transitionInput);
  }

  async requestImplementationPlanChanges(workflowId: string, input: RequestWorkflowChangesDto) {
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
    return this.performManualDecisionTransition(workflowId, transitionInput);
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
      lockedRepository.withDeliveryTransaction(async (repository) => {
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
      }),
    );
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
    const updated = await this.applyTransition(repository, workflow, dto, session.id, now);
    return this.toPublicWorkflowDto(updated, session);
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
    const record = {
      id: randomUUID(),
      workflow_id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      codex_session_id: workflow.active_codex_session_id,
      approved_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id,
      approved_spec_revision_id: workflow.active_spec_doc_revision_id,
      approved_implementation_plan_revision_id: workflow.active_implementation_plan_doc_revision_id,
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
    if (dto.codex_session_turn_id !== undefined) transition.codex_session_turn_id = dto.codex_session_turn_id;
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

  private assertActorCanStartWorkflowItem(item: DevelopmentPlanItem, actorId: string) {
    const actorContext: Parameters<typeof assertWorkflowActorAuthorized>[2] = {
      actor_id: actorId,
      development_plan_item: this.workflowActorPlanItem(item),
    };
    assertWorkflowActorAuthorized({ development_plan_item_id: item.id }, 'start_brainstorming', actorContext);
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

  private toPublicWorkflowDto(workflow: PlanItemWorkflow, session: CodexSession) {
    return {
      id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      status: workflow.status,
      active_codex_session_id: session.id,
      active_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id,
      active_spec_doc_revision_id: workflow.active_spec_doc_revision_id,
      active_implementation_plan_doc_revision_id: workflow.active_implementation_plan_doc_revision_id,
      execution_package_id: workflow.execution_package_id,
      session: codexSessionPublicProjection(session),
      created_at: workflow.created_at,
      updated_at: workflow.updated_at,
    };
  }

  private now() {
    return new Date().toISOString();
  }
}
