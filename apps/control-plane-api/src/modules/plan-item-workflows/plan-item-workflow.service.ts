import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  assertPlanItemWorkflowTransitionAllowed,
  assertWorkflowActorAuthorized,
  codexCanonicalDigest,
  codexSessionPublicProjection,
  type BrainstormingSession,
  type BoundarySummaryRevision,
  type CodexSession,
  type CodexSessionTurn,
  type DevelopmentPlanItem,
  type ExecutionPlanRevision,
  type PlanItemWorkflow,
  type SpecRevision,
  type WorkflowPersistenceRefs,
  type WorkflowManualDecision,
} from '@forgeloop/domain';
import type { PlanItemWorkflowStatus, WorkflowTransitionEvidenceObjectType } from '@forgeloop/contracts';
import type { ApplyPlanItemWorkflowTransitionInput, DeliveryRepository } from '@forgeloop/db';

import { BrainstormingService } from '../brainstorming/brainstorming.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { RegenerateArtifactDraftCommandDto } from '../delivery/dto';
import { ExecutionsService } from '../executions/executions.service';
import { SpecPlanService } from '../spec-plan/spec-plan.service';
import type {
  ApproveImplementationPlanAndMarkExecutionReadyDto,
  ForkCodexSessionBodyDto,
  ManualDecisionBodyDto,
  RequestWorkflowChangesDto,
  SelectCodexSessionForkBodyDto,
  StartBrainstormingWorkflowDto,
  WorkflowActorCommandDto,
  WorkflowBoundaryAnswerBodyDto,
  WorkflowBoundaryContinueBodyDto,
  WorkflowBoundaryDecisionBodyDto,
  WorkflowBoundaryStartCommandDto,
  WorkflowBoundarySummaryChangesBodyDto,
  WorkflowDraftDocumentBodyDto,
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

@Injectable()
export class PlanItemWorkflowService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(BrainstormingService) private readonly brainstorming: BrainstormingService,
    @Inject(SpecPlanService) private readonly specPlan: SpecPlanService,
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
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

  async startBoundaryBrainstorming(workflowId: string, input: WorkflowBoundaryStartCommandDto) {
    const childContextInput: Parameters<PlanItemWorkflowService['prepareWorkflowChildContext']>[2] = {
      action: 'submit_document_gate',
      intent: 'continue_brainstorming',
      expectedStatus: 'brainstorming',
      operation: 'boundary-brainstorming',
    };
    if (input.leader_actor_id !== undefined || input.leader_delegate_actor_ids !== undefined) {
      childContextInput.developmentPlanItemPatch = {
        leader_actor_id: input.leader_actor_id,
        leader_delegate_actor_ids: input.leader_delegate_actor_ids,
      };
    }
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
        await this.specPlan.requestItemSpecChangesWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          { actor_id: input.actor_id, rationale: input.reason },
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
        await this.specPlan.requestItemImplementationPlanChangesWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          { actor_id: input.actor_id, rationale: input.reason },
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
          ...(input.forked_from_snapshot_id === undefined ? {} : { forked_from_snapshot_id: input.forked_from_snapshot_id }),
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
      developmentPlanItemPatch?: {
        leader_actor_id?: string | undefined;
        leader_delegate_actor_ids?: string[] | undefined;
      };
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
        await this.assertActorCanMutateWorkflow(repository, workflow, actorId, input.action, input.developmentPlanItemPatch);
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
      expected_previous_snapshot_digest: session.latest_snapshot_digest ?? null,
      created_at: now,
    });
    const turn: CodexSessionTurn = {
      id: randomUUID(),
      workflow_id: workflow.id,
      codex_session_id: session.id,
      intent,
      status: 'running',
      input_digest: inputDigest,
      ...(session.latest_snapshot_digest === undefined ? {} : { expected_previous_snapshot_digest: session.latest_snapshot_digest }),
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

  private async assertActorCanMutateWorkflow(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    actorId: string,
    action: WorkflowAction,
    developmentPlanItemPatch?: {
      leader_actor_id?: string | undefined;
      leader_delegate_actor_ids?: string[] | undefined;
    },
  ) {
    const item = await repository.getDevelopmentPlanItem(workflow.development_plan_item_id);
    const actorContext: Parameters<typeof assertWorkflowActorAuthorized>[2] = {
      actor_id: actorId,
    };
    if (item !== undefined) actorContext.development_plan_item = this.workflowActorPlanItem(item, developmentPlanItemPatch);
    const executionOwnerActorId = this.executionOwnerActorId(workflow);
    if (executionOwnerActorId !== undefined) actorContext.execution_owner_actor_id = executionOwnerActorId;
    assertWorkflowActorAuthorized(workflow, action, actorContext);
  }

  private workflowActorPlanItem(
    item: DevelopmentPlanItem,
    patch?: {
      leader_actor_id?: string | undefined;
      leader_delegate_actor_ids?: string[] | undefined;
    },
  ): NonNullable<Parameters<typeof assertWorkflowActorAuthorized>[2]['development_plan_item']> {
    const output: NonNullable<Parameters<typeof assertWorkflowActorAuthorized>[2]['development_plan_item']> = {};
    if (item.driver_actor_id !== undefined) output.driver_actor_id = item.driver_actor_id;
    if (item.reviewer_actor_id !== undefined) output.reviewer_actor_id = item.reviewer_actor_id;
    const leaderActorId = patch?.leader_actor_id ?? item.leader_actor_id;
    const leaderDelegateActorIds = patch?.leader_delegate_actor_ids ?? item.leader_delegate_actor_ids;
    if (leaderActorId !== undefined) output.leader_actor_id = leaderActorId;
    if (leaderDelegateActorIds !== undefined) output.leader_delegate_actor_ids = leaderDelegateActorIds;
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
