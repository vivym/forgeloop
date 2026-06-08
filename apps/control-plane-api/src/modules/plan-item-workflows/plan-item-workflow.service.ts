import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  assertReviewPacketEvidenceRefsAreSafe,
  assertPlanItemWorkflowTransitionAllowed,
  assertQueuedActionCanRun,
  assertWorkflowMessageAllowed,
  assertWorkflowActorAuthorized,
  buildPlanItemWorkflowQueuedActionIdempotencyKey,
  codexRuntimeJobIsActive,
  codexCredentialPayloadDigest,
  codexCanonicalDigest,
  codexRuntimeJobInputDigest,
  codexRuntimeNetworkPolicyDigest,
  codexWorkspaceAcquisitionDigest,
  mapQueuedActionKindToTurnIntent,
  planItemWorkflowPublicProjection,
  reviewPacketInputDigest,
  transitionRunSession,
  type BrainstormingSession,
  type BoundaryAnswer,
  type BoundaryDecision,
  type BoundaryQuestion,
  type BoundarySummary,
  type BoundarySummaryRevision,
  type CodexSession,
  type CodexSessionLease,
  type CodexSessionTurn,
  type CodexLaunchLease,
  type CodexRunExecutionWorkloadV1,
  type CodexRuntimeCapsule,
  type CodexRuntimeJob,
  type CodexWorkerRegistration,
  type CommandIdempotencyRecord,
  type ContextManifest,
  type DevelopmentPlanItem,
  type DomainErrorCode,
  type ExecutionPlanDocument,
  type ExecutionPlanRevision,
  type ExecutionPackage,
  type ExecutionContinuationLineage,
  type ExecutionReadinessRecord,
  type RunRuntimeMetadata,
  type RunSession,
  type Spec,
  type PlanItemWorkflow,
  type PlanItemWorkflowQueuedAction,
  type ReviewPacket,
  type ReviewPacketEvidenceRef,
  type ReviewResponse,
  type RunCommand,
  type RunWorkerLease,
  type SpecRevision,
  type WorkflowPersistenceRefs,
  type WorkflowManualDecision,
  transitionExecutionPackage,
  validateExecutionPackage,
  validateCodexRunExecutionWorkload,
  type CodexCredentialBindingPublic,
  type CodexRuntimeProfileRevision,
} from '@forgeloop/domain';
import {
  createWorkspaceBundleArchive,
  createWorkspaceBundleManifest,
  workspaceBundleArchiveDigest,
  workspaceBundleManifestDigest,
} from '@forgeloop/codex-worker-runtime';
import { runSpecSchema, type ArtifactKind, type RequiredCheckSpec, type RunSpec } from '@forgeloop/contracts';
import type {
  PlanItemWorkflowExecutionRunSummary,
  PlanItemWorkflowAttemptHistory,
  PlanItemWorkflowRecoveryOption,
  PlanItemWorkflowPublicDto,
  PlanItemWorkflowReadiness,
  PlanItemWorkflowQueuedActionKind,
  PlanItemWorkflowStatus,
  WorkflowTransitionEvidenceObjectType,
} from '@forgeloop/contracts';
import { LocalInternalArtifactStore, type ApplyPlanItemWorkflowTransitionInput, type DeliveryRepository } from '@forgeloop/db';
import { buildRunSpec, loadRunContext } from '@forgeloop/workflow';

import type { ActorContext } from '../auth/actor-context';
import { BrainstormingService } from '../brainstorming/brainstorming.service';
import { DELIVERY_REPOSITORY, INTERNAL_ARTIFACT_STORE_ROOT } from '../core/control-plane-tokens';
import { executionPackageActorFields } from '../execution-packages/execution-package-actor-fields';
import { SpecPlanService, type ProductGenerationScheduleResult } from '../spec-plan/spec-plan.service';
import { ProductGenerationRuntimeSchedulerService } from '../codex-runtime/product-generation-runtime-scheduler.service';
import type {
  ApproveWorkflowArtifactRevisionBodyDto,
  ContinueWorkflowExecutionBodyDto,
  EvaluateWorkflowExecutionReadinessBodyDto,
  RequestWorkflowArtifactChangesBodyDto,
  RequestWorkflowReviewFixBodyDto,
  RespondToWorkflowReviewBodyDto,
  RunQueuedWorkflowActionBodyDto,
  StartBrainstormingWorkflowDto,
  StartWorkflowExecutionBodyDto,
  WorkflowArtifactTypeDto,
  WorkflowMessageCommandBodyDto,
} from './plan-item-workflow.dto';

type WorkflowAction = Parameters<typeof assertWorkflowActorAuthorized>[1];
type TransitionCheckInput = Parameters<typeof assertPlanItemWorkflowTransitionAllowed>[0];
type WorkflowTransitionCommandDto = {
  actor_id: string;
  to_status: PlanItemWorkflowStatus;
  evidence_object_type: WorkflowTransitionEvidenceObjectType;
  evidence_object_id: string;
  reason?: string | undefined;
  manual_decision_kind?: WorkflowManualDecision['kind'] | undefined;
  codex_session_turn_id?: string | undefined;
  evidence_digest?: string | undefined;
  supporting_evidence?: Array<{
    object_type: WorkflowTransitionEvidenceObjectType;
    object_id: string;
    digest?: string | undefined;
  }> | undefined;
};
type ExecutionReadinessBlockerCode =
  | 'boundary_summary_revision_missing'
  | 'spec_doc_revision_missing'
  | 'implementation_plan_doc_revision_missing'
  | 'codex_session_missing'
  | 'development_plan_item_revision_not_current'
  | 'boundary_summary_revision_not_current'
  | 'spec_doc_revision_not_current'
  | 'implementation_plan_doc_revision_not_current'
  | 'spec_doc_acceptance_criteria_missing'
  | 'spec_doc_test_strategy_missing'
  | 'spec_doc_testability_missing'
  | 'implementation_plan_validation_strategy_missing'
  | 'codex_session_not_ready'
  | 'codex_session_capsule_lineage_missing'
  | 'codex_session_latest_turn_missing'
  | 'codex_session_latest_turn_not_succeeded'
  | 'codex_session_latest_turn_output_mismatch'
  | 'workflow_action_pending'
  | 'run_session_exists'
  | 'execution_package_boundary_missing';

const reviewFixBaseRequestedArtifacts: ArtifactKind[] = ['diff', 'changed_files', 'check_output', 'execution_summary'];
type ExecutionPackageBoundaryResult = {
  readiness: ExecutionReadinessRecord;
  executionPackage?: ExecutionPackage;
};
type PlanItemWorkflowChildContext = {
  workflow_id: string;
  codex_session_id: string;
  codex_session_turn_id?: string;
  plan_item_workflow_action_id?: string;
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
type StartWorkflowRuntimeBinding = {
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
};
type StartWorkflowExecutionRuntimeBinding = StartWorkflowRuntimeBinding & {
  runtime_profile_digest: string;
  environment: CodexRuntimeProfileRevision['environment'];
  credential_payload_digest: string;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  worker: CodexWorkerRegistration;
};
type WorkflowExecutionInputContinuity = {
  input_memory_bundle_ref: string;
  input_memory_bundle_digest: string;
  input_environment_manifest_ref: string;
  input_environment_manifest_digest: string;
};
type WorkflowExecutionPayload = {
  packagePrompt: string;
  executionContext: Record<string, unknown>;
};
type WorkflowExecutionStartLineage = {
  workflow: PlanItemWorkflow;
  session: CodexSession;
  executionPackage: ExecutionPackage;
  runSessionId: string;
  runtimeJobId?: string;
  executionTurnId?: string;
  inputCapsuleDigest?: string;
  repoBindingId?: string;
  credentialBindingId?: string;
  credentialBindingVersionId?: string;
  workspaceBundleDigest?: string;
  codexThreadIdDigest?: string;
  status: string;
};
type ContinuationDecision =
  | {
      mode: 'existing_job_input';
      runSession: RunSession;
      runtimeJob: CodexRuntimeJob;
      codexSessionLease: CodexSessionLease;
      runWorkerLease: RunWorkerLease;
      launchLease: CodexLaunchLease;
    }
  | {
      mode: 'replay_current_continuation';
      runSession: RunSession;
      runtimeJob: CodexRuntimeJob;
      codexSessionLease: CodexSessionLease;
      runWorkerLease: RunWorkerLease;
      launchLease: CodexLaunchLease;
    }
  | {
      mode: 'relaunch_after_fencing';
      runSession: RunSession;
      previousRuntimeJob: CodexRuntimeJob;
      previousCodexSessionLease: CodexSessionLease;
      previousRunWorkerLease?: RunWorkerLease;
      cancelRecovery?: boolean;
    }
  | { mode: 'reject'; code: DomainErrorCode };

const runtimeNetworkProviderConfigDigest = (revision: CodexRuntimeProfileRevision): string | undefined => {
  const policy = revision.network_policy;
  return policy.mode === 'egress_allowlist' && policy.provider === 'docker_network_proxy'
    ? policy.provider_config.provider_config_digest
    : undefined;
};

const stableUuid = (scope: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest(scope).replace(/^sha256:/, '');
  const version = `4${hex.slice(13, 16)}`;
  const variant = `${((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
};

@Injectable()
export class PlanItemWorkflowService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(INTERNAL_ARTIFACT_STORE_ROOT) private readonly internalArtifactStoreRoot: string,
    @Inject(BrainstormingService) private readonly brainstorming: BrainstormingService,
    @Inject(SpecPlanService) private readonly specPlan: SpecPlanService,
    @Inject(ProductGenerationRuntimeSchedulerService) private readonly productGenerationRuntime: ProductGenerationRuntimeSchedulerService,
  ) {}

  async startBrainstorming(developmentPlanId: string, itemId: string, dto: StartBrainstormingWorkflowDto) {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const now = this.now();
        const item = await this.requirePlanItemBelongsToPlan(repository, developmentPlanId, itemId);
        const workItem = await repository.getWorkItem(item.source_ref.id);
        this.assertActorCanStartWorkflowItem(item, dto.actor_id, workItem?.driver_actor_id);
        const runtimeBinding = await this.resolveActiveGenerationRuntimeBinding(repository, item, now);
        const created = await repository.createPlanItemWorkflowWithInitialSession({
          id: randomUUID(),
          codex_session_id: randomUUID(),
          development_plan_id: item.development_plan_id,
          development_plan_item_id: itemId,
          runtime_profile_id: runtimeBinding.runtime_profile_id,
          runtime_profile_revision_id: runtimeBinding.runtime_profile_revision_id,
          credential_binding_id: runtimeBinding.credential_binding_id,
          credential_binding_version_id: runtimeBinding.credential_binding_version_id,
          actor_id: dto.actor_id,
          now,
        });
        const decision = await this.createManualDecision(repository, created.workflow, {
          actor_id: dto.actor_id,
          codex_session_id: created.session.id,
          manual_decision_kind: 'start_brainstorming',
          reason: dto.reason ?? 'Start Plan Item workflow.',
          created_at: now,
        });
        const updated = await this.applyTransition(repository, created.workflow, {
          actor_id: dto.actor_id,
          to_status: 'brainstorming',
          evidence_object_type: 'manual_decision',
          evidence_object_id: decision.id,
          manual_decision_kind: 'start_brainstorming',
          reason: dto.reason ?? 'Start Plan Item workflow.',
        }, created.session.id, now);

        const queuedAction = await this.enqueueWorkflowAction(repository, updated, created.session, {
          kind: 'continue_brainstorming',
          actor_id: dto.actor_id,
        });

        return this.toPublicWorkflowDtoWithRepository(repository, updated, created.session, [queuedAction]);
      }),
    );
  }

  private async resolveActiveGenerationRuntimeBinding(
    repository: DeliveryRepository,
    item: DevelopmentPlanItem,
    now: string,
    explicit?: StartWorkflowRuntimeBinding,
  ): Promise<StartWorkflowRuntimeBinding> {
    const plan = await repository.getDevelopmentPlan(item.development_plan_id);
    if (plan === undefined) {
      throw new DomainError('workflow_evidence_missing', `Development Plan ${item.development_plan_id} is missing`);
    }
    const profileRevision = await repository.getActiveCodexRuntimeProfileRevision({
      project_id: plan.project_id,
      target_kind: 'generation',
      ...(explicit?.runtime_profile_id === undefined ? {} : { runtime_profile_id: explicit.runtime_profile_id }),
      now,
    });
    if (profileRevision === undefined) {
      throw new DomainError(
        'workflow_runtime_binding_unavailable',
        'workflow_runtime_binding_unavailable: Active generation runtime profile is unavailable',
      );
    }
    if (explicit !== undefined && profileRevision.id !== explicit.runtime_profile_revision_id) {
      throw new DomainError(
        'workflow_runtime_binding_unavailable',
        'workflow_runtime_binding_unavailable: Generation runtime profile revision fence was rejected',
      );
    }

    const credential = await this.resolveGenerationModelCredential(repository, {
      project_id: plan.project_id,
      profileRevision,
      ...(explicit?.credential_binding_id === undefined ? {} : { credential_binding_id: explicit.credential_binding_id }),
      now,
    });
    if (credential === undefined) {
      throw new DomainError(
        'workflow_runtime_binding_unavailable',
        'workflow_runtime_binding_unavailable: Generation model credential binding is unavailable',
      );
    }
    if (explicit !== undefined && credential.active_version_id !== explicit.credential_binding_version_id) {
      throw new DomainError(
        'workflow_runtime_binding_unavailable',
        'workflow_runtime_binding_unavailable: Generation credential binding version fence was rejected',
      );
    }
    if (credential.active_version_id === undefined) {
      throw new DomainError(
        'workflow_runtime_binding_unavailable',
        'workflow_runtime_binding_unavailable: Generation credential binding active version is unavailable',
      );
    }
    return {
      runtime_profile_id: profileRevision.profile_id,
      runtime_profile_revision_id: profileRevision.id,
      credential_binding_id: credential.id,
      credential_binding_version_id: credential.active_version_id,
    };
  }

  private async resolveGenerationModelCredential(
    repository: DeliveryRepository,
    input: {
      project_id: string;
      profileRevision: CodexRuntimeProfileRevision;
      credential_binding_id?: string;
      now: string;
    },
  ): Promise<CodexCredentialBindingPublic | undefined> {
    if (input.credential_binding_id !== undefined) {
      const credential = await repository.getCodexCredentialBindingPublic(input.credential_binding_id);
      if (
        credential === undefined ||
        credential.project_id !== input.project_id ||
        credential.profile_id !== input.profileRevision.profile_id ||
        credential.purpose !== 'model_provider' ||
        credential.active_version_id === undefined ||
        credential.active_payload_digest === undefined
      ) {
        return undefined;
      }
      return credential;
    }
    const candidates = await repository.listCodexCredentialBindingReadinessCandidates({
      project_id: input.project_id,
      runtime_profile_id: input.profileRevision.profile_id,
      target_kind: 'generation',
      now: input.now,
    });
    const candidate = candidates.find((value) => value.purpose === 'model_provider');
    if (candidate === undefined) {
      return undefined;
    }
    return this.resolveGenerationModelCredential(repository, {
      project_id: input.project_id,
      profileRevision: input.profileRevision,
      credential_binding_id: candidate.id,
      now: input.now,
    });
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
        const messageId = randomUUID();
        const message = {
          id: messageId,
          workflow_id: workflow.id,
          codex_session_id: session.id,
          actor_id: input.actor_id,
          action: input.action,
          body_markdown: input.body_markdown,
          ...(input.client_message_id === undefined ? {} : { client_message_id: input.client_message_id }),
          created_at: now,
        };
        await repository.savePlanItemWorkflowMessage(message);
        const queuedAction = await this.enqueueWorkflowAction(repository, workflow, session, {
          kind: 'continue_brainstorming',
          actor_id: input.actor_id,
          created_from_message_id: messageId,
        });
        await repository.attachPlanItemWorkflowMessageQueuedAction({
          workflow_id: workflow.id,
          message_id: messageId,
          queued_action_id: queuedAction.id,
        });
        return this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [queuedAction]);
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
        if (action.status === 'stale') {
          throw new DomainError(
            'workflow_action_not_runnable',
            `workflow_action_not_runnable: Queued action ${actionId} is stale`,
          );
        }
        if (action.status !== 'queued') {
          const publicWorkflow = await this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [action]);
          return { workflow: publicWorkflow, queued_action: this.publicQueuedAction(publicWorkflow, action.id) };
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
          if (actionWithTurn.kind === 'respond_to_review' || this.shouldUseRuntimeGenerationBridge()) {
            await this.scheduleQueuedActionRuntimeGeneration(repository, workflow, session, actionWithTurn, turn, input.actor_id);
            const publicWorkflow = await this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [actionWithTurn]);
            return {
              workflow: publicWorkflow,
              queued_action: this.publicQueuedAction(publicWorkflow, actionWithTurn.id),
            };
          }
          const handled = await this.runDeterministicQueuedActionHandler(
            repository,
            workflow,
            session,
            actionWithTurn,
            turn,
            input.actor_id,
          );
          const publicWorkflow = await this.toPublicWorkflowDtoWithRepository(
            repository,
            handled.workflow,
            handled.session,
            handled.queued_actions ?? [handled.action],
          );
          return {
            workflow: publicWorkflow,
            queued_action: this.publicQueuedAction(publicWorkflow, handled.action.id),
          };
        }
        const publicWorkflow = await this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [queuedAction]);
        return { workflow: publicWorkflow, queued_action: this.publicQueuedAction(publicWorkflow, queuedAction.id) };
      }),
    );
  }

  private shouldUseRuntimeGenerationBridge(): boolean {
    return (
      process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE === 'runtime' ||
      process.env.FORGELOOP_REAL_RUNTIME_ACCEPTANCE === '1'
    );
  }

  private async scheduleQueuedActionRuntimeGeneration(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    action: PlanItemWorkflowQueuedAction,
    turn: CodexSessionTurn,
    actorId: string,
  ): Promise<void> {
    const context = {
      workflow_id: workflow.id,
      codex_session_id: session.id,
      codex_session_turn_id: turn.id,
      plan_item_workflow_action_id: action.id,
    };
    switch (action.kind) {
      case 'continue_brainstorming':
      case 'generate_boundary_summary':
      case 'revise_boundary_summary': {
        const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);
        const manifest = await this.ensureDeterministicContextManifest(repository, workflow, item, actorId);
        const brainstormingSession = await this.ensureBrainstormingSessionForWorkflow(repository, workflow, item, manifest, actorId);
        if (action.kind === 'revise_boundary_summary') {
          const sourceRevisionId = action.source_revision_id ?? workflow.active_boundary_summary_revision_id;
          if (sourceRevisionId === undefined) {
            throw new DomainError('workflow_evidence_missing', 'Boundary Summary revision action requires a source revision');
          }
          const revision = await repository.getBoundarySummaryRevisionById(sourceRevisionId);
          this.assertOwnedDocumentRevision(workflow, revision, 'Boundary Summary revision');
          await this.brainstorming.requestBoundarySummaryChangesWithRepository(repository, brainstormingSession.id, sourceRevisionId, {
            actor_id: actorId,
            feedback_markdown: 'Revise the Boundary Summary according to the workflow change request.',
            context,
          });
          return;
        }
        await this.brainstorming.continueBoundaryBrainstormingWithRepository(repository, brainstormingSession.id, {
          actor_id: actorId,
          leader_input_markdown:
            action.kind === 'generate_boundary_summary'
              ? 'Generate the Boundary Summary for review.'
              : 'Continue the Boundary Brainstorming turn for this Plan Item Workflow.',
          context,
        });
        return;
      }
      case 'generate_spec_doc':
      case 'revise_spec_doc':
        await this.specPlan.generateItemSpecRevisionRuntimeWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          { actor_id: actorId },
          context,
        );
        return;
      case 'generate_implementation_plan_doc':
      case 'revise_implementation_plan_doc':
        await this.specPlan.generateItemImplementationPlanRevisionRuntimeWithRepository(
          repository,
          workflow.development_plan_id,
          workflow.development_plan_item_id,
          { actor_id: actorId },
          context,
        );
        return;
      case 'respond_to_review': {
        const reviewContext = await this.reviewResponseRuntimeContext(repository, workflow, action);
        await this.productGenerationRuntime.schedulePlanItemWorkflowReviewResponse({
          repository,
          action,
          review_packet_id: reviewContext.review_packet_id,
          review_packet_digest: reviewContext.review_packet_digest,
          previous_run_session_id: reviewContext.previous_run_session_id,
          prompt_version: 'review-response:v1',
          context_manifest: reviewContext.context_manifest,
          signed_context_json: reviewContext.signed_context_json,
          project_id: reviewContext.project_id,
          repo_ids: reviewContext.repo_id === undefined ? [] : [reviewContext.repo_id],
        });
        return;
      }
      case 'continue_execution':
      case 'request_fix':
        throw new DomainError(
          'workflow_action_not_runnable',
          `workflow_action_not_runnable: ${action.kind} must run through its dedicated workflow command`,
        );
    }
  }

  private async reviewResponseRuntimeContext(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    action: PlanItemWorkflowQueuedAction,
    options: {
      expected_review_packet_id?: string;
      expected_review_packet_digest?: string;
      response_prompt_markdown?: string;
    } = {},
  ): Promise<{
    review_packet_id: string;
    review_packet_digest: string;
    previous_run_session_id: string;
    context_manifest: ContextManifest;
    signed_context_json: Record<string, unknown>;
    project_id: string;
    repo_id?: string;
  }> {
    const executionPackageId = this.requireString(workflow.execution_package_id, 'Workflow execution package is missing');
    const executionPackage = await repository.getExecutionPackage(executionPackageId);
    if (
      executionPackage === undefined ||
      executionPackage.workflow_id !== workflow.id ||
      executionPackage.codex_session_id !== workflow.active_codex_session_id
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution Package does not belong to this workflow/session');
    }
    const packageVersion = executionPackage.execution_package_version ?? executionPackage.version;
    const previousRunSessionId = this.requireString(
      executionPackage.last_run_session_id,
      'Execution Package previous run session is missing',
    );
    const approvedSpecRevisionId = this.requireString(workflow.active_spec_doc_revision_id, 'Workflow approved Spec Doc is missing');
    const approvedPlanRevisionId = this.requireString(
      workflow.active_implementation_plan_doc_revision_id,
      'Workflow approved Implementation Plan Doc is missing',
    );
    const currentReviewPacket = await this.requireCurrentReviewPacketForWorkflow(repository, workflow, {
      previous_run_session_id: previousRunSessionId,
      execution_package_version: packageVersion,
      approved_spec_revision_id: approvedSpecRevisionId,
      approved_implementation_plan_revision_id: approvedPlanRevisionId,
      ...(options.expected_review_packet_id === undefined
        ? {}
        : { expected_review_packet_id: options.expected_review_packet_id }),
      ...(options.expected_review_packet_digest === undefined
        ? {}
        : { expected_review_packet_digest: options.expected_review_packet_digest }),
      command_kind: 'respond_to_review',
    });
    const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);
    const contextManifest = await this.ensureDeterministicContextManifest(repository, workflow, item, action.created_by_actor_id);
    return {
      review_packet_id: currentReviewPacket.packet.id,
      review_packet_digest: currentReviewPacket.digest,
      previous_run_session_id: previousRunSessionId,
      context_manifest: contextManifest,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      signed_context_json: {
        schema_version: 'review_response_context.v1',
        plan_item_workflow_id: workflow.id,
        plan_item_workflow_action_id: action.id,
        review_packet_id: currentReviewPacket.packet.id,
        review_packet_digest: currentReviewPacket.digest,
        previous_run_session_id: previousRunSessionId,
        execution_package_id: executionPackage.id,
        execution_package_version: packageVersion,
        approved_spec_revision_id: approvedSpecRevisionId,
        approved_implementation_plan_revision_id: approvedPlanRevisionId,
        changed_files: currentReviewPacket.packet.changed_files,
        check_result_summary: currentReviewPacket.packet.check_result_summary,
        risk_notes: currentReviewPacket.packet.risk_notes,
        ...(options.response_prompt_markdown === undefined ? {} : { response_prompt_markdown: options.response_prompt_markdown }),
        evidence_refs: currentReviewPacket.evidenceRefs.map((ref) => ({
          id: ref.id,
          ref_kind: ref.ref_kind,
          display_text: ref.display_text,
          digest: ref.digest,
          ...(ref.url === undefined ? {} : { url: ref.url }),
          ...(ref.internal_object_ref === undefined ? {} : { internal_object_ref: ref.internal_object_ref }),
        })),
      },
    };
  }

  private async requireCurrentReviewPacketForWorkflow(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    input: {
      previous_run_session_id: string;
      execution_package_version: number;
      approved_spec_revision_id: string;
      approved_implementation_plan_revision_id: string;
      expected_review_packet_id?: string;
      expected_review_packet_digest?: string;
      command_kind: 'respond_to_review' | 'request_fix';
    },
  ): Promise<{ packet: ReviewPacket; evidenceRefs: ReviewPacketEvidenceRef[]; digest: string }> {
    const executionPackageId = this.requireString(workflow.execution_package_id, 'Workflow execution package is missing');
    const packet = await repository.findCurrentReviewPacketForWorkflow({
      workflow_id: workflow.id,
      execution_package_id: executionPackageId,
      execution_package_version: input.execution_package_version,
      previous_run_session_id: input.previous_run_session_id,
      approved_spec_revision_id: input.approved_spec_revision_id,
      approved_implementation_plan_revision_id: input.approved_implementation_plan_revision_id,
      ...(input.expected_review_packet_id === undefined ? {} : { expected_review_packet_id: input.expected_review_packet_id }),
      allowed_statuses: input.command_kind === 'respond_to_review' ? ['ready', 'in_review', 'completed'] : ['completed'],
      allowed_completed_decisions: ['changes_requested'],
    });
    if (packet === undefined) {
      throw new DomainError('workflow_review_packet_not_current', 'Current Review Packet is missing');
    }
    const evidenceRefs = await repository.listReviewPacketEvidenceRefs(packet.id);
    assertReviewPacketEvidenceRefsAreSafe(packet, evidenceRefs);
    const digest = reviewPacketInputDigest({
      packet,
      evidence_refs: evidenceRefs,
      previous_run_session_id: input.previous_run_session_id,
      execution_package_id: executionPackageId,
      execution_package_version: input.execution_package_version,
      approved_spec_revision_id: input.approved_spec_revision_id,
      approved_implementation_plan_revision_id: input.approved_implementation_plan_revision_id,
    });
    if (packet.current_digest !== undefined && packet.current_digest !== digest) {
      throw new DomainError('workflow_review_packet_digest_mismatch', 'Current Review Packet stored digest is stale');
    }
    if (input.expected_review_packet_digest !== undefined && digest !== input.expected_review_packet_digest) {
      throw new DomainError('workflow_review_packet_digest_mismatch', 'Current Review Packet digest does not match request');
    }
    return { packet, evidenceRefs, digest };
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

  private async runDeterministicQueuedActionHandler(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    action: PlanItemWorkflowQueuedAction,
    turn: CodexSessionTurn,
    actorId: string,
  ): Promise<{
    workflow: PlanItemWorkflow;
    session: CodexSession;
    action: PlanItemWorkflowQueuedAction;
    queued_actions?: PlanItemWorkflowQueuedAction[];
  }> {
    if (action.kind === 'continue_brainstorming') {
      const terminal = await this.succeedDeterministicQueuedAction(repository, workflow, session, action, turn);
      if (action.created_from_message_id === undefined) {
        return { workflow, session: terminal.session, action: terminal.action };
      }
      const queueInput: Parameters<PlanItemWorkflowService['enqueueWorkflowAction']>[3] = {
        kind: 'generate_boundary_summary',
        actor_id: actorId,
      };
      queueInput.created_from_message_id = action.created_from_message_id;
      const queuedBoundary = await this.enqueueWorkflowAction(repository, workflow, terminal.session, queueInput);
      return { workflow, session: terminal.session, action: terminal.action, queued_actions: [terminal.action, queuedBoundary] };
    }

    if (action.kind === 'generate_boundary_summary' || action.kind === 'revise_boundary_summary') {
      const revision = await this.writeDeterministicBoundarySummaryRevision(repository, workflow, action, turn, actorId);
      const updated = await this.applyTransition(
        repository,
        workflow,
        {
          actor_id: actorId,
          to_status: 'boundary_review',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: revision.id,
          codex_session_turn_id: turn.id,
          reason: `Deterministic ${action.kind} run completed.`,
        },
        session.id,
        this.now(),
        { active_boundary_summary_revision_id: revision.id },
      );
      const terminal = await this.succeedDeterministicQueuedAction(repository, updated, session, action, turn, {
        output_object_type: 'boundary_summary_revision',
        output_object_id: revision.id,
      });
      return { workflow: updated, session: terminal.session, action: terminal.action };
    }

    if (action.kind === 'generate_spec_doc' || action.kind === 'revise_spec_doc') {
      const revision = await this.writeDeterministicSpecRevision(repository, workflow, action, turn, actorId);
      const updated = await this.applyTransition(
        repository,
        workflow,
        {
          actor_id: actorId,
          to_status: 'spec_review',
          evidence_object_type: 'spec_revision',
          evidence_object_id: revision.id,
          codex_session_turn_id: turn.id,
          reason: `Deterministic ${action.kind} run completed.`,
        },
        session.id,
        this.now(),
        { active_spec_doc_revision_id: revision.id },
      );
      const terminal = await this.succeedDeterministicQueuedAction(repository, updated, session, action, turn, {
        output_object_type: 'spec_revision',
        output_object_id: revision.id,
      });
      return { workflow: updated, session: terminal.session, action: terminal.action };
    }

    if (action.kind === 'respond_to_review' || action.kind === 'continue_execution' || action.kind === 'request_fix') {
      throw new DomainError(
        'workflow_action_not_runnable',
        `workflow_action_not_runnable: ${action.kind} must run through its dedicated runtime path`,
      );
    }

    const revision = await this.writeDeterministicImplementationPlanRevision(repository, workflow, action, turn, actorId);
    const updated = await this.applyTransition(
      repository,
      workflow,
      {
        actor_id: actorId,
        to_status: 'implementation_plan_review',
        evidence_object_type: 'implementation_plan_revision',
        evidence_object_id: revision.id,
        codex_session_turn_id: turn.id,
        reason: `Deterministic ${action.kind} run completed.`,
      },
      session.id,
      this.now(),
      { active_implementation_plan_doc_revision_id: revision.id },
    );
    const terminal = await this.succeedDeterministicQueuedAction(repository, updated, session, action, turn, {
      output_object_type: 'implementation_plan_revision',
      output_object_id: revision.id,
    });
    return { workflow: updated, session: terminal.session, action: terminal.action };
  }

  private async succeedDeterministicQueuedAction(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    action: PlanItemWorkflowQueuedAction,
    turn: CodexSessionTurn,
    output: {
      output_object_type?: WorkflowTransitionEvidenceObjectType;
      output_object_id?: string;
    } = {},
  ): Promise<{ session: CodexSession; turn: CodexSessionTurn; action: PlanItemWorkflowQueuedAction }> {
    const now = this.now();
    const workerId = workflow.created_by_actor_id;
    const workerSessionDigest = codexCanonicalDigest({ kind: 'deterministic_plan_item_workflow_worker', workflow_id: workflow.id });
    const leaseTokenHash = codexCanonicalDigest({ kind: 'deterministic_plan_item_workflow_lease_token', action_id: action.id });
    const lease = await repository.claimCodexSessionLease({
      session_id: session.id,
      workflow_id: workflow.id,
      lease_id: randomUUID(),
      lease_token_hash: leaseTokenHash,
      worker_id: workerId,
      worker_session_digest: workerSessionDigest,
      ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
      now,
      expires_at: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    const latestActionSequence = (await repository.listPlanItemWorkflowQueuedActions(workflow.id)).reduce(
      (maxSequence, candidate) => Math.max(maxSequence, candidate.output_capsule_sequence ?? 0),
      0,
    );
    const capsule = this.deterministicOutputCapsule(
      session,
      turn.id,
      action.id,
      latestActionSequence + 1,
      workflow.created_by_actor_id,
      now,
    );
    const terminal = await repository.terminalizeCodexSessionTurn({
      session_id: session.id,
      turn_id: turn.id,
      lease_id: lease.lease.id,
      lease_token_hash: leaseTokenHash,
      lease_epoch: lease.lease.lease_epoch,
      worker_id: workerId,
      worker_session_digest: workerSessionDigest,
      status: 'succeeded',
      ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
      output_capsule: capsule,
      output_memory_bundle_ref: `artifact://plan-item-workflow/${workflow.id}/actions/${action.id}/memory`,
      output_memory_bundle_digest: codexCanonicalDigest({ kind: 'deterministic_memory_bundle', action_id: action.id }),
      output_environment_manifest_ref: `artifact://plan-item-workflow/${workflow.id}/actions/${action.id}/environment`,
      output_environment_manifest_digest: codexCanonicalDigest({ kind: 'deterministic_environment_manifest', action_id: action.id }),
      codex_thread_id: `deterministic-thread:${session.id}`,
      codex_thread_id_digest: capsule.codex_thread_id_digest,
      ...output,
      now,
    });
    const terminalAction = await repository.terminalizePlanItemWorkflowQueuedAction({
      workflow_id: workflow.id,
      action_id: action.id,
      status: 'succeeded',
      codex_session_turn_id: turn.id,
      output_capsule_id: capsule.id,
      output_capsule_digest: capsule.digest,
      output_capsule_sequence: capsule.sequence,
      codex_thread_id_digest: capsule.codex_thread_id_digest,
      now,
    });
    return { session: terminal.session, turn: terminal.turn, action: terminalAction };
  }

  private deterministicOutputCapsule(
    session: CodexSession,
    turnId: string,
    actionId: string,
    sequence: number,
    actorId: string,
    now: string,
  ) {
    const digestInput = { kind: 'deterministic_plan_item_workflow_capsule', session_id: session.id, turn_id: turnId, action_id: actionId };
    const capsuleId = randomUUID();
    return {
      id: capsuleId,
      codex_session_id: session.id,
      created_from_turn_id: turnId,
      sequence,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${session.id}/${capsuleId}`,
      digest: codexCanonicalDigest(digestInput),
      size_bytes: '0',
      manifest_digest: codexCanonicalDigest({ ...digestInput, part: 'manifest' }),
      thread_state_digest: codexCanonicalDigest({ ...digestInput, part: 'thread' }),
      memory_state_digest: codexCanonicalDigest({ ...digestInput, part: 'memory' }),
      environment_manifest_digest: codexCanonicalDigest({ ...digestInput, part: 'environment' }),
      codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: `deterministic-thread:${session.id}` }),
      codex_cli_version: 'deterministic-plan-item-workflow',
      app_server_protocol_digest: codexCanonicalDigest({ ...digestInput, part: 'app_server_protocol' }),
      runtime_profile_revision_id: session.runtime_profile_revision_id,
      trusted_runtime_manifest_digest: codexCanonicalDigest({ ...digestInput, part: 'trusted_runtime' }),
      credential_binding_lineage_digest: codexCanonicalDigest({ ...digestInput, part: 'credential_lineage' }),
      created_by_actor_id: actorId,
      created_at: now,
    };
  }

  private async writeDeterministicBoundarySummaryRevision(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    action: PlanItemWorkflowQueuedAction,
    turn: CodexSessionTurn,
    actorId: string,
  ): Promise<BoundarySummaryRevision> {
    const now = this.now();
    const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);
    const manifest = await this.ensureDeterministicContextManifest(repository, workflow, item, actorId);
    const session = await this.ensureBrainstormingSessionForWorkflow(repository, workflow, item, manifest, actorId);
    const existingRounds = await repository.listBoundaryRounds(session.id);
    const roundId = randomUUID();
    await repository.saveBoundaryRound({
      id: roundId,
      session_id: session.id,
      session_revision_id: session.revision_id,
      round_number: existingRounds.length + 1,
      trigger: action.kind === 'revise_boundary_summary' ? 'leader_revision_request' : 'summary_proposal',
      ai_output_markdown: 'Deterministic Boundary Summary proposal generated from the workflow conversation.',
      codex_session_turn_id: turn.id,
      status: 'summary_proposed',
      created_at: now,
      updated_at: now,
    });
    const answerId = randomUUID();
    const question: BoundaryQuestion = {
      id: randomUUID(),
      text: 'What is the approved deterministic workflow boundary?',
      author_id: 'ai',
      created_at: now,
      status: 'answered',
      required: true,
      answered_by_answer_id: answerId,
      round_id: roundId,
    };
    const answer: BoundaryAnswer = {
      id: answerId,
      question_id: question.id,
      round_id: roundId,
      text: 'The boundary is the Plan Item Workflow product loop through Execution Ready; execution itself is out of scope.',
      actor_id: actorId,
      actor_role: 'leader',
      created_at: now,
    };
    const decision: BoundaryDecision = {
      id: randomUUID(),
      round_id: roundId,
      text: 'Use queued action runs as the only Codex-producing entry point.',
      actor_id: actorId,
      actor_role: 'leader',
      source: 'leader',
      state: 'accepted',
      rationale: 'This preserves one PlanItemWorkflow and one active CodexSession as the product loop.',
      created_at: now,
    };
    await repository.saveBoundaryQuestion({ ...question, session_id: session.id, sequence: 1 });
    await repository.saveBoundaryAnswer({ ...answer, session_id: session.id, sequence: 1 });
    await repository.saveBoundaryDecision({ ...decision, session_id: session.id, sequence: 1 });

    const summaryId = session.boundary_summary_id ?? randomUUID();
    const revisions = await repository.listBoundarySummaryRevisions(summaryId);
    const revisionId = randomUUID();
    const summaryMarkdown = [
      '# Boundary Summary',
      '',
      'The Plan Item Workflow owns Brainstorming, Spec Doc, Implementation Plan Doc, and Execution Ready evaluation.',
      '',
      'Execution worker handoff, RunSession creation, PRs, and code-review fix loops remain out of scope for this wave.',
    ].join('\n');
    if ((await repository.getBoundarySummary(summaryId)) === undefined) {
      const summary: BoundarySummary = {
        id: summaryId,
        revision_id: revisionId,
        brainstorming_session_id: session.id,
        brainstorming_session_revision_id: session.revision_id,
        development_plan_id: workflow.development_plan_id,
        development_plan_item_id: workflow.development_plan_item_id,
        development_plan_item_revision_id: item.revision_id,
        source_ref: item.source_ref,
        summary: summaryMarkdown,
        created_at: now,
        updated_at: now,
      };
      await repository.saveBoundarySummary(summary);
    }
    const revision: BoundarySummaryRevision = {
      id: revisionId,
      boundary_summary_id: summaryId,
      session_id: session.id,
      session_revision_id: session.revision_id,
      source_round_id: roundId,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      development_plan_item_revision_id: item.revision_id,
      workflow_id: workflow.id,
      codex_session_id: workflow.active_codex_session_id,
      codex_session_turn_id: turn.id,
      revision_number: revisions.length + 1,
      status: 'proposed',
      summary_markdown: summaryMarkdown,
      confirmed_scope: ['PlanItemWorkflow chat-first product loop', 'Queued action generation gates', 'Execution Ready evaluation'],
      confirmed_out_of_scope: ['Execution worker start', 'RunSession creation', 'PR and code review automation'],
      accepted_assumptions: ['A deterministic fake runtime can validate the Wave 5 product loop locally.'],
      open_risks: ['Real Codex runtime dispatch remains a credentialed dogfood path.'],
      validation_expectations: ['API workflow tests pass', 'Dogfood script proves the queued loop'],
      question_answer_snapshot: [{ question_id: question.id, answer_id: answer.id, text: answer.text }],
      decision_snapshot: [{ decision_id: decision.id, text: decision.text, rationale: decision.rationale }],
      context_manifest_id: manifest.id,
      context_manifest_revision_id: manifest.revision_id,
      created_at: now,
    } as BoundarySummaryRevision;
    await repository.saveBoundarySummaryRevision(revision);
    await repository.saveBrainstormingSession({
      ...session,
      revision_id: randomUUID(),
      status: 'summary_proposed',
      current_round_id: roundId,
      latest_summary_revision_id: revision.id,
      questions: [question],
      answers: [answer],
      decisions: [decision],
      approval_state: 'ready_for_approval',
      boundary_summary_id: summaryId,
      updated_at: now,
    });
    await repository.saveBoundarySummary({
      id: summaryId,
      revision_id: revision.id,
      brainstorming_session_id: session.id,
      brainstorming_session_revision_id: session.revision_id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      development_plan_item_revision_id: item.revision_id,
      source_ref: item.source_ref,
      summary: summaryMarkdown,
      created_at: now,
      updated_at: now,
    });
    return revision;
  }

  private async writeDeterministicSpecRevision(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    action: PlanItemWorkflowQueuedAction,
    turn: CodexSessionTurn,
    actorId: string,
  ): Promise<SpecRevision> {
    const now = this.now();
    const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);
    const activeSessionId = this.requireString(workflow.active_codex_session_id, 'Workflow active session is missing');
    const workItem = await repository.getWorkItem(item.source_ref.id);
    if (workItem === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Spec generation requires the source Work Item');
    }
    const manifest = await this.ensureDeterministicContextManifest(repository, workflow, item, actorId);
    let boundarySummaryId: string;
    let sourceBoundarySummaryRevisionId: string;
    let existingSpec: Spec | undefined;
    if (action.kind === 'revise_spec_doc') {
      const sourceSpecRevisionId = action.source_revision_id ?? workflow.active_spec_doc_revision_id;
      if (sourceSpecRevisionId === undefined) {
        throw new DomainError('workflow_evidence_missing', 'Spec revision requires the requested Spec revision');
      }
      const sourceSpecRevision = await repository.getSpecRevision(sourceSpecRevisionId);
      this.assertOwnedDocumentRevision(workflow, sourceSpecRevision, 'Spec revision');
      boundarySummaryId = this.requireString(sourceSpecRevision?.boundary_summary_id, 'Spec revision is missing its Boundary Summary');
      sourceBoundarySummaryRevisionId = this.requireString(
        workflow.active_boundary_summary_revision_id,
        'Spec revision requires the workflow Boundary Summary revision',
      );
      existingSpec = sourceSpecRevision === undefined ? undefined : await repository.getSpec(sourceSpecRevision.spec_id);
      if (
        existingSpec === undefined ||
        existingSpec.workflow_id !== workflow.id ||
        existingSpec.development_plan_item_id !== item.id
      ) {
        throw new DomainError('workflow_evidence_not_owned', 'Spec does not belong to this workflow/session');
      }
    } else {
      const boundaryRevisionId = action.source_revision_id ?? workflow.active_boundary_summary_revision_id;
      if (boundaryRevisionId === undefined) {
        throw new DomainError('workflow_evidence_missing', 'Spec generation requires an approved Boundary Summary revision');
      }
      const boundaryRevision = await repository.getBoundarySummaryRevisionById(boundaryRevisionId);
      this.assertOwnedDocumentRevision(workflow, boundaryRevision, 'Boundary Summary revision');
      boundarySummaryId = this.requireString(boundaryRevision?.boundary_summary_id, 'Boundary Summary revision is missing');
      sourceBoundarySummaryRevisionId = boundaryRevisionId;
      existingSpec = await this.findWorkflowSpec(repository, workflow.id, item.id);
    }
    const spec: Spec =
      existingSpec ??
      {
        id: randomUUID(),
        work_item_id: workItem.id,
        development_plan_item_id: item.id,
        workflow_id: workflow.id,
        boundary_summary_id: boundarySummaryId,
        context_manifest_id: manifest.id,
        entity_type: 'spec',
        status: 'draft',
        editing_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
        created_at: now,
        updated_at: now,
      };
    const revisions = await repository.listSpecRevisions(spec.id);
    const revision: SpecRevision = {
      id: randomUUID(),
      spec_id: spec.id,
      work_item_id: workItem.id,
      development_plan_item_id: item.id,
      development_plan_item_revision_id: item.revision_id,
      workflow_id: workflow.id,
      codex_session_id: activeSessionId,
      codex_session_turn_id: turn.id,
      boundary_summary_id: boundarySummaryId,
      context_manifest_id: manifest.id,
      revision_number: revisions.length + 1,
      summary: 'Deterministic Spec Doc for the Plan Item Workflow product loop.',
      content: [
        '# Spec Doc',
        '',
        'Implement the Plan Item Workflow as the only public Superpowers product loop entry point.',
        '',
        'Generated artifacts must stay attached to the same workflow and Codex session.',
      ].join('\n'),
      background: 'The product loop must align with Superpowers brainstorming -> spec -> plan semantics.',
      goals: ['Generate workflow-owned artifacts through queued action runs only.'],
      scope_in: ['PlanItemWorkflow queued action run', 'Artifact review gates', 'Execution readiness evaluation'],
      scope_out: ['Execution worker start', 'RunSession creation'],
      acceptance_criteria: ['Queued action run creates a Spec revision', 'Workflow moves to Spec review', 'No RunSession is created'],
      risk_notes: ['Real runtime dispatch is separately dogfooded.'],
      test_strategy_summary: 'Run API workflow tests and dogfood script.',
      qa_owner_actor_id: item.reviewer_actor_id ?? actorId,
      testability_note: 'QA validates the workflow reaches review without direct generation routes.',
      structured_document: {
        generated_by: 'deterministic_plan_item_workflow_queued_action',
        action_id: action.id,
        boundary_summary_revision_id: sourceBoundarySummaryRevisionId,
      },
      author_actor_id: actorId,
      artifact_refs: [],
      created_at: now,
    };
    await repository.saveSpec({ ...spec, status: 'in_review', gate_state: 'awaiting_approval', current_revision_id: revision.id, updated_at: now });
    await repository.saveSpecRevision(revision);
    await repository.saveWorkItem({ ...workItem, current_spec_id: spec.id, current_spec_revision_id: revision.id, updated_at: now });
    await repository.saveDevelopmentPlanItem({ ...item, spec_status: 'in_review', updated_at: now });
    return revision;
  }

  private async writeDeterministicImplementationPlanRevision(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    action: PlanItemWorkflowQueuedAction,
    turn: CodexSessionTurn,
    actorId: string,
  ): Promise<ExecutionPlanRevision> {
    const now = this.now();
    const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);
    const activeSessionId = this.requireString(workflow.active_codex_session_id, 'Workflow active session is missing');
    let existingPlan: ExecutionPlanDocument | undefined;
    let specRevisionId: string | undefined;
    if (action.kind === 'revise_implementation_plan_doc') {
      const sourcePlanRevisionId = action.source_revision_id ?? workflow.active_implementation_plan_doc_revision_id;
      if (sourcePlanRevisionId === undefined) {
        throw new DomainError('workflow_evidence_missing', 'Implementation Plan revision requires the requested Implementation Plan revision');
      }
      const sourcePlanRevision = await repository.getExecutionPlanRevision(sourcePlanRevisionId);
      this.assertOwnedDocumentRevision(workflow, sourcePlanRevision, 'Implementation Plan revision');
      specRevisionId = sourcePlanRevision?.based_on_spec_revision_id ?? workflow.active_spec_doc_revision_id;
      existingPlan = sourcePlanRevision === undefined ? undefined : await repository.getExecutionPlan(sourcePlanRevision.execution_plan_id);
      if (
        existingPlan === undefined ||
        existingPlan.workflow_id !== workflow.id ||
        existingPlan.development_plan_item_id !== item.id
      ) {
        throw new DomainError('workflow_evidence_not_owned', 'Implementation Plan does not belong to this workflow/session');
      }
    } else {
      specRevisionId = action.source_revision_id ?? workflow.active_spec_doc_revision_id;
      existingPlan = (await repository.listExecutionPlansForDevelopmentPlanItem(item.id)).find(
        (candidate) => candidate.workflow_id === workflow.id,
      );
    }
    if (specRevisionId === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Implementation Plan generation requires an approved Spec revision');
    }
    const specRevision = await repository.getSpecRevision(specRevisionId);
    this.assertOwnedDocumentRevision(workflow, specRevision, 'Spec revision');
    const executionPlan: ExecutionPlanDocument =
      existingPlan ??
      {
        id: randomUUID(),
        development_plan_item_id: item.id,
        workflow_id: workflow.id,
        status: 'draft',
        created_at: now,
        updated_at: now,
      };
    const revisions = await repository.listExecutionPlanRevisions(executionPlan.id);
    const revision: ExecutionPlanRevision = {
      id: randomUUID(),
      execution_plan_id: executionPlan.id,
      development_plan_item_id: item.id,
      development_plan_item_revision_id: item.revision_id,
      workflow_id: workflow.id,
      codex_session_id: activeSessionId,
      codex_session_turn_id: turn.id,
      based_on_spec_revision_id: specRevisionId,
      revision_number: revisions.length + 1,
      summary: 'Deterministic Implementation Plan Doc for the Plan Item Workflow product loop.',
      content: [
        '# Implementation Plan Doc',
        '',
        '1. Keep PlanItemWorkflow as the product source of truth.',
        '2. Run generation only from durable queued actions.',
        '3. Evaluate readiness without starting execution.',
      ].join('\n'),
      structured_document: {
        generated_by: 'deterministic_plan_item_workflow_queued_action',
        action_id: action.id,
        based_on_spec_revision_id: specRevisionId,
        validation_strategy: ['API workflow tests', 'dogfood script'],
        allowed_paths: ['apps/control-plane-api', 'apps/web', 'packages/db', 'packages/domain'],
        forbidden_paths: ['execution worker start', 'run session creation'],
        required_checks: ['pnpm vitest run tests/api/plan-item-workflows.test.ts'],
        handoff_criteria: ['Execution readiness evaluation reports ready only after approved artifacts and capsule lineage exist.'],
      },
      author_actor_id: actorId,
      created_at: now,
    };
    await repository.saveExecutionPlan({ ...executionPlan, status: 'in_review', current_revision_id: revision.id, updated_at: now });
    await repository.saveExecutionPlanRevision(revision);
    await repository.appendObjectEvent({
      id: randomUUID(),
      object_type: 'development_plan_item',
      object_id: item.id,
      event_type: 'item_implementation_plan_draft_generated',
      actor_id: actorId,
      metadata: {
        implementation_plan_id: executionPlan.id,
        implementation_plan_revision_id: revision.id,
        workflow_id: workflow.id,
        codex_session_id: activeSessionId,
      },
      created_at: now,
    });
    await repository.saveDevelopmentPlanItem({ ...item, implementation_plan_status: 'in_review', updated_at: now });
    return revision;
  }

  private async ensureDeterministicContextManifest(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    item: DevelopmentPlanItem,
    actorId: string,
  ): Promise<ContextManifest> {
    const now = this.now();
    const manifest: ContextManifest = {
      id: randomUUID(),
      revision_id: randomUUID(),
      source_ref: item.source_ref,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: item.id,
      development_plan_item_revision_id: item.revision_id,
      sources: [
        { type: 'development_plan_item', ref: item.id, digest: item.revision_id },
        { type: 'actor_guidance', ref: actorId, digest: `${actorId.length}` },
      ],
      generated_at: now,
      runtime_identity: 'deterministic_plan_item_workflow_queued_action',
      created_at: now,
      updated_at: now,
    };
    await repository.saveContextManifest(manifest);
    return manifest;
  }

  private async ensureBrainstormingSessionForWorkflow(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    item: DevelopmentPlanItem,
    manifest: ContextManifest,
    actorId: string,
  ): Promise<BrainstormingSession> {
    const existingRevisionId = workflow.active_boundary_summary_revision_id;
    if (existingRevisionId !== undefined) {
      const revision = await repository.getBoundarySummaryRevisionById(existingRevisionId);
      const existingSessionId = revision === undefined ? undefined : this.boundarySummaryRevisionSessionId(revision);
      const existing = existingSessionId === undefined ? undefined : await repository.getBrainstormingSession(existingSessionId);
      if (existing !== undefined) return existing;
    }
    const now = this.now();
    const activeSessionId = this.requireString(workflow.active_codex_session_id, 'Workflow active session is missing');
    const session: BrainstormingSession = {
      id: randomUUID(),
      revision_id: randomUUID(),
      source_ref: item.source_ref,
      development_plan_id: workflow.development_plan_id,
      development_plan_revision_id: workflow.development_plan_id,
      development_plan_item_id: item.id,
      development_plan_item_revision_id: item.revision_id,
      context_manifest_id: manifest.id,
      context_manifest_revision_id: manifest.revision_id,
      leader_actor_id: actorId,
      leader_delegate_actor_ids: [],
      status: 'waiting_for_leader',
      questions: [],
      answers: [],
      decisions: [],
      approval_state: 'questions_open',
      workflow_id: workflow.id,
      codex_session_id: activeSessionId,
      created_at: now,
      updated_at: now,
    };
    await repository.saveBrainstormingSession(session);
    return session;
  }

  private async findWorkflowSpec(repository: DeliveryRepository, workflowId: string, itemId: string): Promise<Spec | undefined> {
    return (await repository.listSpecs()).find(
      (candidate) => candidate.workflow_id === workflowId && candidate.development_plan_item_id === itemId,
    );
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
    const result = await this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
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
        const { readiness, executionPackage } = await this.createExecutionReadinessRecordForApprovedPlan(
          repository,
          workflowWithApprovedPlan,
          input.actor_id,
        );
        if (readiness.readiness_state !== 'ready') {
          return {
            blocked: true as const,
            readiness,
          };
        }
        const dto: WorkflowTransitionCommandDto = {
          actor_id: input.actor_id,
          to_status: 'execution_ready',
          evidence_object_type: 'execution_readiness_record',
          evidence_object_id: readiness.id,
          supporting_evidence: [
            { object_type: 'implementation_plan_revision', object_id: implementationPlanRevision.id },
            ...(executionPackage === undefined
              ? []
              : [{ object_type: 'execution_package' as const, object_id: executionPackage.id }]),
          ],
          reason: input.rationale_markdown,
        };
        await this.validateTransitionEvidence(repository, workflowWithApprovedPlan, dto);
        const updated = await this.applyTransition(repository, workflow, dto, session.id, this.now(), {
          active_implementation_plan_doc_revision_id: implementationPlanRevision.id,
          ...(executionPackage === undefined ? {} : { execution_package_id: executionPackage.id }),
        });
        return this.toPublicWorkflowDtoWithRepository(repository, updated, session, [], {
          readiness: this.readinessProjectionForRecord(readiness),
        });
      }),
    );
    if ('blocked' in result) {
      throw new DomainError('workflow_execution_readiness_blocked', 'Execution readiness evaluation is blocked', {
        blocker_codes: result.readiness.blocker_codes,
        readiness: this.readinessProjectionForRecord(result.readiness),
      });
    }
    return result;
  }

  async startExecution(workflowId: string, input: StartWorkflowExecutionBodyDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'start_execution');
        const session = await this.requireActiveSession(repository, workflow);

        if (workflow.status === 'execution_running') {
          return {
            status_code: 200,
            workflow: await this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [], {
              execution_run_summary: await this.requireExistingExecutionRunSummary(repository, workflow, session),
            }),
          };
        }
        if (workflow.status !== 'execution_ready') {
          throw new DomainError('workflow_invalid_transition', 'Execution start requires execution_ready');
        }

        const now = this.now();
        const executionPackage = await this.requireWorkflowExecutionPackageReady(repository, workflow, session);
        const readiness = await this.requireCurrentExecutionReadinessRecord(repository, workflow, executionPackage);
        const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);
        await this.requireCurrentPlanItemRevisionForExecutionStart(repository, workflow, session, item, executionPackage, readiness);
        const workItem = await repository.getWorkItem(item.source_ref.id);
        if (workItem === undefined || workItem.project_id !== executionPackage.project_id || workItem.id !== executionPackage.work_item_id) {
          throw new DomainError('workflow_evidence_not_owned', 'Execution package Work Item linkage is stale');
        }
        const project = await repository.getProject(executionPackage.project_id);
        if (project === undefined || project.org_id === undefined) {
          throw new DomainError('workflow_evidence_missing', 'Execution start requires a project');
        }
        const projectRepo = (await repository.listProjectRepos(project.id)).find(
          (candidate) => candidate.repo_id === executionPackage.repo_id && candidate.status === 'active',
        );
        if (projectRepo === undefined) {
          throw new DomainError('workflow_evidence_missing', 'Execution start requires an active project repository');
        }
        if (session.status !== 'idle' || session.role !== 'active' || session.active_lease_id !== undefined) {
          throw new DomainError('workflow_invalid_transition', 'Execution start requires an idle active Codex Session');
        }
        const inputCapsule = await this.requireLatestExecutionInputCapsule(repository, session);
        const inputContinuity = this.requireExecutionInputContinuity(session);
        const runtimeBinding = await this.resolveActiveExecutionRuntimeBinding(repository, executionPackage, now);
        const runtimeExpiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
        const workerSessionDigest = await repository.getCodexWorkerSessionDigest(runtimeBinding.worker.id);
        if (workerSessionDigest === undefined) {
          throw new DomainError('workflow_runtime_binding_unavailable', 'Execution worker session digest is unavailable');
        }
        const commandClaimToken = randomUUID();
        const commandPrecondition = this.workflowExecutionStartPrecondition({
          workflow,
          item,
          readiness,
          executionPackage,
          session,
          inputCapsuleDigest: inputCapsule.digest,
          inputContinuity,
          runtimeBinding,
          workerSessionDigest,
        });
        const commandClaim = await repository.claimCommandIdempotency({
          id: randomUUID(),
          command_name: 'plan_item_workflow_execution_start',
          idempotency_key: `plan-item-workflow:${workflow.id}:execution:start:${input.idempotency_key ?? codexCanonicalDigest(commandPrecondition)}`,
          target_object_type: 'plan_item_workflow',
          target_object_id: workflow.id,
          target_revision_id: readiness.id,
          target_version: executionPackage.version,
          precondition_json: commandPrecondition,
          precondition_fingerprint: codexCanonicalDigest(commandPrecondition),
          actor_scope: `actor:${input.actor_id}`,
          claim_token: commandClaimToken,
          locked_until: runtimeExpiresAt,
          now,
        });
        if (commandClaim.status !== 'running' || commandClaim.claim_token !== commandClaimToken) {
          throw new DomainError('workflow_execution_recovery_required', 'Execution start command replay requires existing lineage recovery');
        }
        const executionTurn = await this.createWorkflowChildTurn(
          repository,
          workflow,
          session,
          input.actor_id,
          'execute_plan',
          `start-execution:${executionPackage.id}:${readiness.id}:${input.idempotency_key ?? 'default'}`,
        );
        const runSessionId = randomUUID();
        const runtimeJobId = randomUUID();
        const launchLeaseId = randomUUID();
        const envelopeId = randomUUID();
        const jobRequestId = input.idempotency_key ?? codexCanonicalDigest({
          kind: 'plan_item_workflow_execution_start',
          workflow_id: workflow.id,
          codex_session_id: session.id,
          input_capsule_digest: inputCapsule.digest,
          execution_package_id: executionPackage.id,
        });
        const leaseToken = `codex-session-execution:${randomUUID()}`;
        const runWorkerLeaseToken = `run-worker-execution:${randomUUID()}`;

        const readyPackage =
          executionPackage.phase === 'ready'
            ? executionPackage
            : transitionExecutionPackage(executionPackage, { type: 'mark_ready', at: now });
        const queuedPackage = transitionExecutionPackage(readyPackage, { type: 'run', run_session_id: runSessionId, at: now });
        const runningPackage = transitionExecutionPackage(queuedPackage, { type: 'workflow_start', at: now });
        const runSession = transitionRunSession(undefined, {
          type: 'create',
          id: runSessionId,
          execution_package_id: runningPackage.id,
          requested_by_actor_id: input.actor_id,
          executor_type: 'local_codex',
          at: now,
        });
        await repository.saveExecutionPackage(runningPackage);
        await repository.saveRunSession({
          ...runSession,
          workflow_id: workflow.id,
          codex_session_id: session.id,
          codex_session_turn_id: executionTurn.id,
          executor_type: 'local_codex',
        });
        const runSpec = buildRunSpec(await loadRunContext(repository, runSessionId), {
          defaultExecutorType: 'local_codex',
          workflowOnly: false,
        });
        const workflowExecutionPayload = this.workflowExecutionPayload(runningPackage, this.workflowExecutionRemoteRunSpec(runSpec));
        const workspaceBundle = this.workflowExecutionWorkspaceBundle(now, workflowExecutionPayload);
        await repository.saveRunSession({
          ...runSession,
          workflow_id: workflow.id,
          codex_session_id: session.id,
          codex_session_turn_id: executionTurn.id,
          executor_type: 'local_codex',
          run_spec: runSpec,
          runtime_metadata: {
            durability_mode: 'durable',
            driver_kind: 'app_server',
            driver_status: 'not_started',
            recovery_attempt_count: 0,
            effective_dangerous_mode: 'confirmed',
            runtime_profile_id: runtimeBinding.runtime_profile_id,
            runtime_profile_revision_id: runtimeBinding.runtime_profile_revision_id,
            runtime_profile_digest: runtimeBinding.runtime_profile_digest,
            runtime_target_kind: 'run_execution',
            source_access_mode: 'path_policy_scoped',
            environment: runtimeBinding.environment,
            credential_binding_id: runtimeBinding.credential_binding_id,
            credential_binding_version_id: runtimeBinding.credential_binding_version_id,
            credential_payload_digest: runtimeBinding.credential_payload_digest,
            docker_image_digest: runtimeBinding.docker_image_digest,
            network_policy_digest: runtimeBinding.network_policy_digest,
            remote_runtime_job_id: runtimeJobId,
            remote_runtime_job_created: true,
            remote_workspace_bundle_digest: workspaceBundle.archive_digest,
          },
        });
        const runWorkerLease = await repository.claimRunWorkerLease({
          run_session_id: runSessionId,
          worker_id: runtimeBinding.worker.id,
          lease_token: runWorkerLeaseToken,
          now,
          expires_at: new Date(Date.parse(now) + 10 * 60_000).toISOString(),
        });
        const codexLease = await repository.claimCodexSessionLease({
          session_id: session.id,
          workflow_id: workflow.id,
          lease_id: randomUUID(),
          lease_token_hash: codexCredentialPayloadDigest(leaseToken),
          worker_id: runtimeBinding.worker.id,
          worker_session_digest: workerSessionDigest,
          expected_input_capsule_digest: inputCapsule.digest,
          input_capsule_id: inputCapsule.id,
          input_capsule_digest: inputCapsule.digest,
          ...(session.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: session.base_memory_bundle_ref }),
          ...(session.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: session.base_memory_bundle_digest }),
          ...inputContinuity,
          now,
          expires_at: new Date(Date.parse(now) + 10 * 60_000).toISOString(),
        });

        const pendingWorkspaceBundleRef = `artifact://internal/workspace_bundle/run_session/${runSessionId}/${workspaceBundle.id}`;
        const workspaceAcquisition = {
          schema_version: 'workspace_bundle_acquisition.v1' as const,
          bundle_id: workspaceBundle.id,
          archive_ref: pendingWorkspaceBundleRef,
          archive_digest: workspaceBundle.archive_digest,
          manifest_digest: workspaceBundle.manifest_digest,
          size_bytes: workspaceBundle.bytes.byteLength,
          expires_at: runtimeExpiresAt,
        };
        const workspaceAcquisitionDigest = this.requireString(
          codexWorkspaceAcquisitionDigest(workspaceAcquisition),
          'Workspace acquisition digest missing',
        );
        const workload: CodexRunExecutionWorkloadV1 = validateCodexRunExecutionWorkload({
          schema_version: 'codex_run_execution_workload.v1',
          runtime_job_id: runtimeJobId,
          plan_item_workflow_id: workflow.id,
          development_plan_id: workflow.development_plan_id,
          development_plan_item_id: workflow.development_plan_item_id,
          run_session_id: runSessionId,
          execution_package_id: runningPackage.id,
          execution_package_version: runningPackage.version,
          workspace_bundle_id: workspaceBundle.id,
          workspace_bundle_digest: workspaceBundle.archive_digest,
          package_prompt_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/package-prompt`,
          package_prompt_digest: codexCanonicalDigest(workflowExecutionPayload.packagePrompt),
          execution_context_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/execution-context`,
          execution_context_digest: codexCanonicalDigest(workflowExecutionPayload.executionContext),
          path_policy_digest: codexCanonicalDigest({
            allowed_paths: runningPackage.allowed_paths,
            forbidden_paths: runningPackage.forbidden_paths,
            source_mutation_policy: runningPackage.source_mutation_policy,
          }),
          required_checks_digest: codexCanonicalDigest(runningPackage.required_checks),
          output_schema_version: 'codex_run_execution_result.v1',
          created_at: now,
          expires_at: runtimeExpiresAt,
          workspace_acquisition_json: workspaceAcquisition,
          codex_session_runtime_context: {
            schema_version: 'codex_session_runtime_context.v1',
            codex_session_id: session.id,
            codex_session_turn_id: executionTurn.id,
            lease_id: launchLeaseId,
            lease_epoch: codexLease.lease.lease_epoch,
            worker_id: runtimeBinding.worker.id,
            worker_session_digest: workerSessionDigest,
            expected_input_capsule_digest: inputCapsule.digest,
            turn_group_status: 'complete',
            continuation: {
              kind: 'resume_thread',
              codex_thread_id: this.requireString(session.codex_thread_id, 'Execution start requires a Codex thread id'),
              codex_thread_id_digest: this.requireString(
                session.codex_thread_id_digest,
                'Execution start requires a Codex thread id digest',
              ),
            },
          },
          codex_session_terminalization: {
            schema_version: 'codex_session_terminalization.v1',
            lease_token: leaseToken,
            codex_session_lease_id: codexLease.lease.id,
            codex_session_lease_epoch: codexLease.lease.lease_epoch,
            codex_session_worker_id: runtimeBinding.worker.id,
            codex_session_worker_session_digest: workerSessionDigest,
            codex_session_id: session.id,
            codex_session_turn_id: executionTurn.id,
            expected_input_capsule_digest: inputCapsule.digest,
            input_capsule_id: inputCapsule.id,
            input_capsule_ref: inputCapsule.artifact_ref,
            input_capsule_digest: inputCapsule.digest,
            ...(session.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: session.base_memory_bundle_ref }),
            ...(session.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: session.base_memory_bundle_digest }),
            ...inputContinuity,
          },
        });
        await this.writeWorkflowExecutionStartAudit(repository, {
          workflow,
          session,
          executionPackage: runningPackage,
          runSessionId,
          runtimeJobId,
          executionTurnId: executionTurn.id,
          inputCapsuleDigest: inputCapsule.digest,
          repoBindingId: projectRepo.id,
          credentialBindingId: runtimeBinding.credential_binding_id,
          credentialBindingVersionId: runtimeBinding.credential_binding_version_id,
          workspaceBundleDigest: workspaceBundle.archive_digest,
          codexThreadIdDigest: this.requireString(session.codex_thread_id_digest, 'Execution start requires a Codex thread id digest'),
          status: runSession.status,
        }, input.actor_id, readiness.id, now);
        const transitionInput: WorkflowTransitionCommandDto = {
          actor_id: input.actor_id,
          to_status: 'execution_running',
          evidence_object_type: 'execution_package',
          evidence_object_id: runningPackage.id,
          codex_session_turn_id: executionTurn.id,
          supporting_evidence: [{ object_type: 'run_session', object_id: runSessionId }],
          reason: input.rationale_markdown,
        };
        await this.validateTransitionEvidence(repository, workflow, transitionInput);
        const workspaceBundleArtifact = await new LocalInternalArtifactStore({
          root: this.internalArtifactStoreRoot,
          repository,
          requestId: `plan-item-workflow-execution-${workflow.id}`,
        }).putObject({
          artifact_id: workspaceBundle.id,
          kind: 'workspace_bundle',
          owner_type: 'run_session',
          owner_id: runSessionId,
          visibility: 'internal',
          content_type: 'application/vnd.forgeloop.workspace-bundle',
          declared_size_bytes: String(workspaceBundle.bytes.byteLength),
          declared_artifact_digest: workspaceBundle.archive_digest,
          idempotency_key: workspaceBundle.id,
          metadata_json: {
            manifest_digest: workspaceBundle.manifest_digest,
            execution_package_id: runningPackage.id,
            run_worker_lease_id: runWorkerLease.id,
            workspace_acquisition_digest: workspaceAcquisitionDigest,
          },
          created_by_actor_type: 'system',
          created_by_actor_id: input.actor_id,
          now,
          max_size_bytes: 100 * 1024 * 1024,
          bytes: workspaceBundle.bytes,
        });
        const pendingWorkspaceBundle = {
          id: randomUUID(),
          bundle_id: workspaceBundle.id,
          run_session_id: runSessionId,
          execution_package_id: runningPackage.id,
          pending_artifact_ref: pendingWorkspaceBundleRef,
          internal_artifact_object_id: workspaceBundleArtifact.id,
          archive_digest: workspaceBundle.archive_digest,
          manifest_digest: workspaceBundle.manifest_digest,
          run_worker_lease_id: runWorkerLease.id,
          size_bytes: workspaceBundle.bytes.byteLength,
          workspace_acquisition_digest: workspaceAcquisitionDigest,
          workspace_acquisition_json: workspaceAcquisition,
          expires_at: runtimeExpiresAt,
          request_digest: codexCanonicalDigest({
            runtime_job_id: runtimeJobId,
            workspace_bundle_id: workspaceBundle.id,
            archive_digest: workspaceBundle.archive_digest,
            internal_artifact_object_id: workspaceBundleArtifact.id,
          }),
          created_at: now,
        };
        await repository.createPendingWorkspaceBundleArtifact(pendingWorkspaceBundle);
        await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
          runtime_job_id: runtimeJobId,
          launch_lease_id: launchLeaseId,
          envelope_id: envelopeId,
          job_request_id: jobRequestId,
          target: {
            target_type: 'run_session',
            target_id: runSessionId,
            target_kind: 'run_execution',
            project_id: runningPackage.project_id,
            repo_id: runningPackage.repo_id,
          },
          launch_attempt: 1,
          worker_id: runtimeBinding.worker.id,
          runtime_profile_revision_id: runtimeBinding.runtime_profile_revision_id,
          runtime_profile_digest: runtimeBinding.runtime_profile_digest,
          credential_binding_id: runtimeBinding.credential_binding_id,
          credential_binding_version_id: runtimeBinding.credential_binding_version_id,
          credential_payload_digest: runtimeBinding.credential_payload_digest,
          docker_image_digest: runtimeBinding.docker_image_digest,
          network_policy_digest: runtimeBinding.network_policy_digest,
          ...(runtimeBinding.network_provider_config_digest === undefined
            ? {}
            : { network_provider_config_digest: runtimeBinding.network_provider_config_digest }),
          input_json: workload as unknown as Record<string, unknown>,
          input_digest: codexRuntimeJobInputDigest(workload),
          workspace_acquisition_json: workspaceAcquisition,
          workspace_acquisition_digest: workspaceAcquisitionDigest,
          pending_workspace_bundle: pendingWorkspaceBundle,
          execution_package_id: runningPackage.id,
          run_worker_lease_id: runWorkerLease.id,
          run_worker_lease_token_hash: codexCredentialPayloadDigest(runWorkerLeaseToken),
          run_session_status: runSession.status,
          run_session_updated_at: runSession.updated_at,
          execution_package_version: runningPackage.version,
          workflow_id: workflow.id,
          codex_session_id: session.id,
          codex_session_turn_id: executionTurn.id,
          expires_at: runtimeExpiresAt,
          now,
        });
        const updated = await this.applyTransition(
          repository,
          workflow,
          transitionInput,
          session.id,
          now,
        );
        await repository.completeCommandIdempotency({
          idempotency_key: commandClaim.idempotency_key,
          claim_token: commandClaimToken,
          result_json: {
            workflow_id: updated.id,
            readiness_record_id: readiness.id,
            execution_package_id: runningPackage.id,
            run_session_id: runSessionId,
            runtime_job_id: runtimeJobId,
            codex_session_id: session.id,
            codex_session_turn_id: executionTurn.id,
            input_capsule_digest: inputCapsule.digest,
            workspace_bundle_digest: workspaceBundle.archive_digest,
            codex_thread_id_digest: this.requireString(session.codex_thread_id_digest, 'Execution start requires a Codex thread id digest'),
          },
          finished_at: now,
        });
        const runningSession = await repository.getCodexSession(session.id);
        return {
          status_code: 201,
          workflow: await this.toPublicWorkflowDtoWithRepository(repository, updated, runningSession ?? codexLease.session, [], {
            execution_run_summary: this.executionRunSummary({
              workflow: updated,
              session: runningSession ?? codexLease.session,
              executionPackage: runningPackage,
              runSessionId,
              runtimeJobId,
              executionTurnId: executionTurn.id,
              inputCapsuleDigest: inputCapsule.digest,
              workspaceBundleDigest: workspaceBundle.archive_digest,
              codexThreadIdDigest: this.requireString(session.codex_thread_id_digest, 'Execution start requires a Codex thread id digest'),
              status: runSession.status,
            }),
          }),
        };
      }),
    );
  }

  async continueExecution(workflowId: string, input: ContinueWorkflowExecutionBodyDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'start_execution');
        if (workflow.status !== 'execution_running') {
          throw new DomainError('workflow_invalid_transition', 'Execution continuation requires execution_running');
        }
        const session = await this.requireActiveSession(repository, workflow);
        const executionPackage = this.requireFound(
          await repository.getExecutionPackage(this.requireString(workflow.execution_package_id, 'Workflow execution package is missing')),
          `ExecutionPackage ${workflow.execution_package_id}`,
        );
        const runSession = this.requireFound(
          await repository.findActiveRunSessionForPackage(executionPackage.id),
          `active RunSession for ExecutionPackage ${executionPackage.id}`,
        );
        const runtimeJob = this.requireFound(
          await repository.getCodexRuntimeJob({
            runtime_job_id: this.requireString(runSession.runtime_metadata?.remote_runtime_job_id, 'Workflow execution runtime job is missing'),
          }),
          `CodexRuntimeJob ${runSession.runtime_metadata?.remote_runtime_job_id}`,
        );

        const decision = await this.classifyExecutionContinuation(repository, {
          workflow,
          session,
          executionPackage,
          runSession,
          runtimeJob,
          input,
        });
        if (decision.mode === 'reject') {
          throw new DomainError(decision.code, `${decision.code}: Workflow execution cannot continue from its current state`);
        }

        const action = await this.createAndClaimContinueExecutionAction(repository, workflow, session, input, decision.mode);
        if (action.status === 'succeeded') {
          const currentRunSession = this.requireFound(
            await repository.getRunSession(runSession.id),
            `RunSession ${runSession.id}`,
          );
          const currentRuntimeJobId = this.requireString(
            currentRunSession.runtime_metadata?.remote_runtime_job_id,
            'Workflow execution runtime job is missing',
          );
          return this.continuedExecutionProjection(repository, workflow, session, executionPackage, currentRunSession, currentRuntimeJobId);
        }
        if (decision.mode === 'existing_job_input') {
          return this.completeExistingJobInputContinuation(repository, workflow, session, executionPackage, action, decision, input);
        }
        if (decision.mode === 'replay_current_continuation') {
          return this.completeReplayCurrentContinuation(repository, workflow, session, executionPackage, action, decision);
        }
        return this.completeRelaunchAfterFencingContinuation(repository, workflow, session, executionPackage, action, decision, input);
      }),
    );
  }

  async respondToReview(workflowId: string, input: RespondToWorkflowReviewBodyDto): Promise<PlanItemWorkflowPublicDto> {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'submit_document_gate');
        if (workflow.status !== 'code_review') {
          throw new DomainError('workflow_invalid_transition', 'Review response requires code_review');
        }
        const session = await this.requireActiveSession(repository, workflow);
        const replayAction = await this.respondToReviewReplayActionOrThrow(repository, workflow, session, input);
        if (replayAction !== undefined && replayAction.status !== 'queued') {
          return this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [replayAction]);
        }
        if (replayAction === undefined) {
          this.assertCodexSessionIdleForReviewCommand(session);
        }
        const action =
          replayAction ?? (await this.createOrReplayRespondToReviewAction(repository, workflow, session, input));
        const runningAction =
          action.status === 'queued'
            ? await this.claimReviewCommandAction(repository, workflow, session, action)
            : action;
        const actionWithTurn =
          runningAction.codex_session_turn_id === undefined
            ? await this.attachReviewCommandTurn(repository, workflow, session, runningAction, input.actor_id)
            : runningAction;
        const reviewContext = await this.reviewResponseRuntimeContext(repository, workflow, actionWithTurn, {
          expected_review_packet_id: input.expected_review_packet_id,
          expected_review_packet_digest: input.expected_review_packet_digest,
          ...(input.response_prompt_markdown === undefined ? {} : { response_prompt_markdown: input.response_prompt_markdown }),
        });
        await this.productGenerationRuntime.schedulePlanItemWorkflowReviewResponse({
          repository,
          action: actionWithTurn,
          review_packet_id: reviewContext.review_packet_id,
          review_packet_digest: reviewContext.review_packet_digest,
          previous_run_session_id: reviewContext.previous_run_session_id,
          prompt_version: 'review-response:v1',
          context_manifest: reviewContext.context_manifest,
          signed_context_json: reviewContext.signed_context_json,
          project_id: reviewContext.project_id,
          repo_ids: reviewContext.repo_id === undefined ? [] : [reviewContext.repo_id],
        });
        const persistedAction =
          (await repository.getPlanItemWorkflowQueuedAction({ workflow_id: workflow.id, action_id: actionWithTurn.id })) ??
          actionWithTurn;
        const persistedSession = (await repository.getCodexSession(session.id)) ?? session;
        return this.toPublicWorkflowDtoWithRepository(repository, workflow, persistedSession, [persistedAction]);
      }),
    );
  }

  async requestReviewFix(
    workflowId: string,
    input: RequestWorkflowReviewFixBodyDto,
  ): Promise<{ status_code: number; workflow: PlanItemWorkflowPublicDto }> {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const workflow = await this.requireWorkflow(repository, workflowId);
        await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'start_execution');
        const session = await this.requireActiveSession(repository, workflow);

        const executionPackageId = this.requireString(workflow.execution_package_id, 'Workflow execution package is missing');
        const executionPackage = this.requireFound(
          await repository.getExecutionPackage(executionPackageId),
          `ExecutionPackage ${executionPackageId}`,
        );
        this.assertReviewFixExecutionPackageOwned(workflow, session, executionPackage);
        const commandIdempotencyKey = this.reviewFixCommandIdempotencyKey(workflow, session, executionPackage, input);
        const existingCommand = await repository.getCommandIdempotency(commandIdempotencyKey);
        if (existingCommand !== undefined) {
          this.assertReviewFixCommandReplayMatchesInput(existingCommand, workflow, session, executionPackage, input);
        }
        const existingReplay = await this.replayReviewFixCommandResult(repository, workflow.id, existingCommand);
        if (existingReplay !== undefined) {
          return { status_code: 200, workflow: existingReplay };
        }
        if (workflow.status !== 'code_review') {
          throw new DomainError('workflow_invalid_transition', 'Review fix requires code_review');
        }
        this.assertCodexSessionIdleForReviewCommand(session);
        await this.assertNoActiveWorkflowActions(repository, workflow.id);

        const packageVersion = executionPackage.execution_package_version ?? executionPackage.version;
        const previousRunSessionId = this.requireString(
          executionPackage.last_run_session_id,
          'Execution Package previous run session is missing',
        );
        const approvedSpecRevisionId = this.requireString(workflow.active_spec_doc_revision_id, 'Workflow approved Spec Doc is missing');
        const approvedPlanRevisionId = this.requireString(
          workflow.active_implementation_plan_doc_revision_id,
          'Workflow approved Implementation Plan Doc is missing',
        );
        const currentReviewPacket = await this.requireCurrentReviewPacketForWorkflow(repository, workflow, {
          previous_run_session_id: previousRunSessionId,
          execution_package_version: packageVersion,
          approved_spec_revision_id: approvedSpecRevisionId,
          approved_implementation_plan_revision_id: approvedPlanRevisionId,
          expected_review_packet_id: input.expected_review_packet_id,
          expected_review_packet_digest: input.expected_review_packet_digest,
          command_kind: 'request_fix',
        });
        if (currentReviewPacket.packet.status !== 'completed' || currentReviewPacket.packet.decision !== 'changes_requested') {
          throw new DomainError('workflow_review_packet_not_current', 'Review fix requires completed changes_requested Review Packet');
        }
        if (currentReviewPacket.packet.requested_changes.length === 0) {
          throw new DomainError('workflow_review_packet_not_current', 'Review fix requires requested changes');
        }
        const previousRunSession = this.requireFound(
          await repository.getRunSession(currentReviewPacket.packet.run_session_id),
          `RunSession ${currentReviewPacket.packet.run_session_id}`,
        );
        this.assertReviewFixPreviousRunOwned(workflow, session, executionPackage, previousRunSession);
        if (previousRunSession.id !== previousRunSessionId || !this.isTerminalRunSession(previousRunSession)) {
          throw new DomainError('workflow_invalid_transition', 'Review fix requires a terminal previous run session');
        }
        const { inputCapsule, inputContinuity } = await this.requireLatestExecutionContinuationInputs(repository, workflow, session);
        const now = this.now();
        const runtimeBinding = await this.resolveActiveExecutionRuntimeBinding(repository, executionPackage, now);
        const workerSessionDigest = await repository.getCodexWorkerSessionDigest(runtimeBinding.worker.id);
        if (workerSessionDigest === undefined) {
          throw new DomainError('workflow_runtime_binding_unavailable', 'Execution worker session digest is unavailable');
        }
        const commandClaimToken = randomUUID();
        const commandClaim = await this.claimReviewFixCommandIdempotency(repository, {
          workflow,
          session,
          input,
          executionPackage,
          packageVersion,
          previousRunSessionId,
          currentReviewPacketDigest: currentReviewPacket.digest,
          approvedSpecRevisionId,
          approvedPlanRevisionId,
          inputCapsuleDigest: inputCapsule.digest,
          inputContinuity,
          runtimeBinding,
          workerSessionDigest,
          idempotencyKey: commandIdempotencyKey,
          claimToken: commandClaimToken,
        });
        try {
          const result = await this.startReviewFixExecution(repository, {
            workflow,
            session,
            executionPackage,
            previousRunSession,
            currentReviewPacket,
            inputCapsule,
            inputContinuity,
            runtimeBinding,
            workerSessionDigest,
            actorId: input.actor_id,
            ...(input.fix_instruction_markdown === undefined ? {} : { fixInstructionMarkdown: input.fix_instruction_markdown }),
          });
          await repository.completeCommandIdempotency({
            idempotency_key: commandClaim.idempotency_key,
            claim_token: commandClaimToken,
            result_json: {
              workflow_id: result.workflow.id,
              execution_package_id: result.executionPackage.id,
              run_session_id: result.runSession.id,
              runtime_job_id: result.runtimeJob.id,
              codex_session_id: result.session.id,
              codex_session_turn_id: result.turn.id,
              input_capsule_digest: result.inputCapsuleDigest,
              workspace_bundle_digest: result.workspaceBundleDigest,
              codex_thread_id_digest: this.requireString(
                result.session.codex_thread_id_digest,
                'Review fix requires a Codex thread id digest',
              ),
            },
            finished_at: this.now(),
          });
          return {
            status_code: 201,
            workflow: await this.toPublicWorkflowDtoWithRepository(repository, result.workflow, result.session, [], {
              execution_run_summary: this.executionRunSummary({
                workflow: result.workflow,
                session: result.session,
                executionPackage: result.executionPackage,
                runSessionId: result.runSession.id,
                runtimeJobId: result.runtimeJob.id,
                executionTurnId: result.turn.id,
                inputCapsuleDigest: result.inputCapsuleDigest,
                workspaceBundleDigest: result.workspaceBundleDigest,
                codexThreadIdDigest: this.requireString(
                  result.session.codex_thread_id_digest,
                  'Review fix requires a Codex thread id digest',
                ),
                status: result.runSession.status,
              }),
            }),
          };
        } catch (error) {
          await this.blockReviewFixCommandIdempotencyAfterError(repository, commandClaim, commandClaimToken, error);
          throw error;
        }
      }),
    );
  }

  private async claimReviewFixCommandIdempotency(
    repository: DeliveryRepository,
    input: {
      workflow: PlanItemWorkflow;
      session: CodexSession;
      input: RequestWorkflowReviewFixBodyDto;
      executionPackage: ExecutionPackage;
      packageVersion: number;
      previousRunSessionId: string;
      currentReviewPacketDigest: string;
      approvedSpecRevisionId: string;
      approvedPlanRevisionId: string;
      inputCapsuleDigest: string;
      inputContinuity: WorkflowExecutionInputContinuity;
      runtimeBinding: StartWorkflowExecutionRuntimeBinding;
      workerSessionDigest: string;
      idempotencyKey: string;
      claimToken: string;
    },
  ): Promise<CommandIdempotencyRecord> {
    const now = this.now();
    const runtimeExpiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
    const precondition = this.reviewFixCommandPrecondition(input);
    try {
      return await repository.claimCommandIdempotency({
        id: randomUUID(),
        command_name: 'plan_item_workflow_review_fix',
        idempotency_key: input.idempotencyKey,
        target_object_type: 'plan_item_workflow',
        target_object_id: input.workflow.id,
        target_revision_id: input.input.expected_review_packet_id,
        target_version: input.executionPackage.version,
        precondition_json: precondition,
        precondition_fingerprint: codexCanonicalDigest(precondition),
        actor_scope: `actor:${input.input.actor_id}`,
        claim_token: input.claimToken,
        locked_until: runtimeExpiresAt,
        now,
      });
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === 'INVALID_TRANSITION' &&
        error.message.includes('already has an active claim')
      ) {
        throw new DomainError('workflow_action_already_pending', `workflow_action_already_pending: ${error.message}`);
      }
      throw error;
    }
  }

  private reviewFixCommandIdempotencyKey(
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
    input: RequestWorkflowReviewFixBodyDto,
  ): string {
    const keyMaterial = input.idempotency_key ?? codexCanonicalDigest({
      kind: 'plan_item_workflow_review_fix_command',
      workflow_id: workflow.id,
      codex_session_id: session.id,
      execution_package_id: executionPackage.id,
      expected_review_packet_id: input.expected_review_packet_id,
      expected_review_packet_digest: input.expected_review_packet_digest,
      fix_instruction_markdown: input.fix_instruction_markdown ?? null,
    });
    return `plan-item-workflow:${workflow.id}:code-review:request-fix:${keyMaterial}`;
  }

  private reviewFixCommandPrecondition(input: {
    workflow: PlanItemWorkflow;
    session: CodexSession;
    input: RequestWorkflowReviewFixBodyDto;
    executionPackage: ExecutionPackage;
    packageVersion: number;
    previousRunSessionId: string;
    currentReviewPacketDigest: string;
    approvedSpecRevisionId: string;
    approvedPlanRevisionId: string;
    inputCapsuleDigest: string;
    inputContinuity: WorkflowExecutionInputContinuity;
    runtimeBinding: StartWorkflowExecutionRuntimeBinding;
    workerSessionDigest: string;
  }): Record<string, unknown> {
    return {
      schema_version: 'plan_item_workflow_review_fix_command_precondition.v1',
      workflow_id: input.workflow.id,
      codex_session_id: input.session.id,
      expected_review_packet_id: input.input.expected_review_packet_id,
      expected_review_packet_digest: input.input.expected_review_packet_digest,
      current_review_packet_digest: input.currentReviewPacketDigest,
      fix_instruction_markdown: input.input.fix_instruction_markdown ?? null,
      execution_package_id: input.executionPackage.id,
      execution_package_record_version: input.executionPackage.version,
      execution_package_version: input.packageVersion,
      execution_package_manifest_digest: input.executionPackage.manifest_digest ?? null,
      path_policy_digest: codexCanonicalDigest({
        allowed_paths: input.executionPackage.allowed_paths,
        forbidden_paths: input.executionPackage.forbidden_paths,
        source_mutation_policy: input.executionPackage.source_mutation_policy,
      }),
      required_checks_digest: codexCanonicalDigest(input.executionPackage.required_checks),
      previous_run_session_id: input.previousRunSessionId,
      approved_spec_revision_id: input.approvedSpecRevisionId,
      approved_implementation_plan_revision_id: input.approvedPlanRevisionId,
      input_capsule_digest: input.inputCapsuleDigest,
      input_memory_bundle_digest: input.inputContinuity.input_memory_bundle_digest,
      input_environment_manifest_digest: input.inputContinuity.input_environment_manifest_digest,
      runtime_profile_id: input.runtimeBinding.runtime_profile_id,
      runtime_profile_revision_id: input.runtimeBinding.runtime_profile_revision_id,
      runtime_profile_digest: input.runtimeBinding.runtime_profile_digest,
      credential_binding_id: input.runtimeBinding.credential_binding_id,
      credential_binding_version_id: input.runtimeBinding.credential_binding_version_id,
      credential_payload_digest: input.runtimeBinding.credential_payload_digest,
      docker_image_digest: input.runtimeBinding.docker_image_digest,
      network_policy_digest: input.runtimeBinding.network_policy_digest,
      network_provider_config_digest: input.runtimeBinding.network_provider_config_digest ?? null,
      worker_id: input.runtimeBinding.worker.id,
      worker_session_digest: input.workerSessionDigest,
    };
  }

  private assertReviewFixCommandReplayMatchesInput(
    claim: CommandIdempotencyRecord,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
    input: RequestWorkflowReviewFixBodyDto,
  ): void {
    const precondition = claim.precondition_json;
    const mismatched =
      precondition === undefined ||
      claim.command_name !== 'plan_item_workflow_review_fix' ||
      claim.target_object_type !== 'plan_item_workflow' ||
      claim.target_object_id !== workflow.id ||
      claim.target_revision_id !== input.expected_review_packet_id ||
      claim.actor_scope !== `actor:${input.actor_id}` ||
      precondition.schema_version !== 'plan_item_workflow_review_fix_command_precondition.v1' ||
      precondition.workflow_id !== workflow.id ||
      precondition.codex_session_id !== session.id ||
      precondition.execution_package_id !== executionPackage.id ||
      precondition.expected_review_packet_id !== input.expected_review_packet_id ||
      precondition.expected_review_packet_digest !== input.expected_review_packet_digest ||
      precondition.fix_instruction_markdown !== (input.fix_instruction_markdown ?? null);
    if (mismatched) {
      throw new DomainError('workflow_execution_recovery_required', 'Review fix command replay precondition changed');
    }
  }

  private async replayReviewFixCommandResult(
    repository: DeliveryRepository,
    workflowId: string,
    claim: CommandIdempotencyRecord | undefined,
  ): Promise<PlanItemWorkflowPublicDto | undefined> {
    if (claim === undefined) {
      return undefined;
    }
    if (claim.status === 'running') {
      return undefined;
    }
    const result = claim.result_json;
    if (claim.status !== 'succeeded' || result === undefined) {
      throw new DomainError('workflow_execution_recovery_required', 'Review fix command replay requires a completed result');
    }
    const workflow = this.requireFound(await repository.getPlanItemWorkflow(workflowId), `PlanItemWorkflow ${workflowId}`);
    const sessionId = this.commandResultString(result, 'codex_session_id', 'Review fix replay requires a Codex Session id');
    const executionPackageId = this.commandResultString(
      result,
      'execution_package_id',
      'Review fix replay requires an Execution Package id',
    );
    const runSessionId = this.commandResultString(result, 'run_session_id', 'Review fix replay requires a RunSession id');
    const runtimeJobId = this.commandResultString(result, 'runtime_job_id', 'Review fix replay requires a runtime job id');
    const executionTurnId = this.commandResultString(result, 'codex_session_turn_id', 'Review fix replay requires an execution turn id');
    const inputCapsuleDigest = this.commandResultString(result, 'input_capsule_digest', 'Review fix replay requires input capsule digest');
    const workspaceBundleDigest = this.commandResultString(
      result,
      'workspace_bundle_digest',
      'Review fix replay requires workspace bundle digest',
    );
    const codexThreadIdDigest = this.commandResultString(
      result,
      'codex_thread_id_digest',
      'Review fix replay requires Codex thread digest',
    );
    const [session, executionPackage, runSession, runtimeJob] = await Promise.all([
      repository.getCodexSession(sessionId),
      repository.getExecutionPackage(executionPackageId),
      repository.getRunSession(runSessionId),
      repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId }),
    ]);
    if (
      session === undefined ||
      executionPackage === undefined ||
      runSession === undefined ||
      runtimeJob === undefined ||
      runSession.workflow_id !== workflow.id ||
      runSession.codex_session_id !== session.id ||
      runtimeJob.workflow_id !== workflow.id ||
      runtimeJob.codex_session_id !== session.id ||
      runtimeJob.target_id !== runSession.id ||
      runtimeJob.target_kind !== 'run_execution'
    ) {
      throw new DomainError('workflow_execution_recovery_required', 'Review fix command replay lineage is incomplete');
    }
    return this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [], {
      execution_run_summary: this.executionRunSummary({
        workflow,
        session,
        executionPackage,
        runSessionId,
        runtimeJobId,
        executionTurnId,
        inputCapsuleDigest,
        workspaceBundleDigest,
        codexThreadIdDigest,
        status: runSession.status,
      }),
    });
  }

  private commandResultString(result: Record<string, unknown>, key: string, message: string): string {
    return this.requireString(typeof result[key] === 'string' ? result[key] : undefined, message);
  }

  private async blockReviewFixCommandIdempotencyAfterError(
    repository: DeliveryRepository,
    claim: CommandIdempotencyRecord,
    claimToken: string,
    error: unknown,
  ): Promise<void> {
    if (claim.status !== 'running' || claim.claim_token !== claimToken) {
      return;
    }
    try {
      await repository.blockCommandIdempotency({
        idempotency_key: claim.idempotency_key,
        claim_token: claimToken,
        result_json: {
          error_code: error instanceof DomainError ? error.code : 'unknown_error',
          error_message: error instanceof Error ? error.message : String(error),
        },
        finished_at: this.now(),
      });
    } catch {
      // Preserve the original domain error; failed claim cleanup is secondary.
    }
  }

  private assertReviewFixExecutionPackageOwned(
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
  ): void {
    if (
      executionPackage.workflow_id !== workflow.id ||
      executionPackage.development_plan_item_id !== workflow.development_plan_item_id ||
      executionPackage.codex_session_id !== session.id ||
      executionPackage.spec_revision_id !== workflow.active_spec_doc_revision_id ||
      executionPackage.execution_plan_revision_id !== workflow.active_implementation_plan_doc_revision_id ||
      executionPackage.deleted_at !== undefined ||
      executionPackage.archived_at !== undefined
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution Package does not belong to this workflow/session');
    }
  }

  private assertReviewFixPreviousRunOwned(
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
    previousRunSession: RunSession,
  ): void {
    if (
      previousRunSession.workflow_id !== workflow.id ||
      previousRunSession.codex_session_id !== session.id ||
      previousRunSession.execution_package_id !== executionPackage.id
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Previous RunSession does not belong to this workflow/session/package');
    }
  }

  private assertCodexSessionIdleForReviewCommand(session: CodexSession): void {
    if (session.status !== 'idle' || session.role !== 'active' || session.active_lease_id !== undefined) {
      throw new DomainError('workflow_invalid_transition', 'Review command requires an idle active Codex Session');
    }
  }

  private async assertNoActiveWorkflowActions(repository: DeliveryRepository, workflowId: string): Promise<void> {
    const [activeAction] = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
    if (activeAction !== undefined) {
      throw new DomainError(
        'workflow_action_already_pending',
        `workflow_action_already_pending: Queued action ${activeAction.id} is ${activeAction.status}`,
      );
    }
  }

  private async createOrReplayRespondToReviewAction(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    input: RespondToWorkflowReviewBodyDto,
  ): Promise<PlanItemWorkflowQueuedAction> {
    const contextPreviewDigest = this.contextPreviewDigest(workflow, session, 'respond_to_review');
    const idempotencyKey = this.respondToReviewActionIdempotencyKey(workflow, session, input);
    await this.assertNoActiveWorkflowActions(repository, workflow.id);
    const now = this.now();
    return repository.createOrReplayPlanItemWorkflowQueuedAction({
      id: randomUUID(),
      workflow_id: workflow.id,
      codex_session_id: session.id,
      kind: 'respond_to_review',
      status: 'queued',
      ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
      context_preview_digest: contextPreviewDigest,
      idempotency_key: idempotencyKey,
      created_by_actor_id: input.actor_id,
      created_at: now,
      updated_at: now,
    });
  }

  private respondToReviewActionIdempotencyKey(
    workflow: PlanItemWorkflow,
    session: CodexSession,
    input: RespondToWorkflowReviewBodyDto,
  ): string {
    return codexCanonicalDigest({
      kind: 'plan_item_workflow_respond_to_review_command',
      workflow_id: workflow.id,
      codex_session_id: session.id,
      expected_review_packet_id: input.expected_review_packet_id,
      expected_review_packet_digest: input.expected_review_packet_digest,
      response_prompt_markdown: input.response_prompt_markdown ?? null,
      request_idempotency_key: input.idempotency_key ?? null,
    });
  }

  private async respondToReviewReplayActionOrThrow(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    input: RespondToWorkflowReviewBodyDto,
  ): Promise<PlanItemWorkflowQueuedAction | undefined> {
    const idempotencyKey = this.respondToReviewActionIdempotencyKey(workflow, session, input);
    const activeActions = await repository.listActivePlanItemWorkflowQueuedActions(workflow.id);
    const replayableAction = activeActions.find(
      (action) =>
        action.idempotency_key === idempotencyKey &&
        action.kind === 'respond_to_review' &&
        action.codex_session_id === session.id,
    );
    if (replayableAction !== undefined) {
      return replayableAction;
    }
    const historicalReplayAction = (await repository.listPlanItemWorkflowQueuedActions(workflow.id)).find(
      (action) =>
        action.idempotency_key === idempotencyKey &&
        action.kind === 'respond_to_review' &&
        action.codex_session_id === session.id,
    );
    if (historicalReplayAction !== undefined) {
      return historicalReplayAction;
    }
    const [conflictingAction] = activeActions;
    if (conflictingAction !== undefined) {
      throw new DomainError(
        'workflow_action_already_pending',
        `workflow_action_already_pending: Queued action ${conflictingAction.id} is ${conflictingAction.status}`,
      );
    }
    return undefined;
  }

  private async claimReviewCommandAction(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    action: PlanItemWorkflowQueuedAction,
  ): Promise<PlanItemWorkflowQueuedAction> {
    assertQueuedActionCanRun({
      action,
      workflow_id: workflow.id,
      active_codex_session_id: session.id,
      ...(session.latest_capsule_digest === undefined ? {} : { latest_capsule_digest: session.latest_capsule_digest }),
      context_preview_digest: this.contextPreviewDigest(workflow, session, action.kind),
    });
    return (
      await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
        workflow_id: workflow.id,
        action_id: action.id,
        now: this.now(),
      })
    ).action;
  }

  private async attachReviewCommandTurn(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    action: PlanItemWorkflowQueuedAction,
    actorId: string,
  ): Promise<PlanItemWorkflowQueuedAction> {
    const turn = await this.createWorkflowChildTurn(
      repository,
      workflow,
      session,
      actorId,
      mapQueuedActionKindToTurnIntent(action.kind),
      `queued-action:${action.kind}:${action.id}`,
    );
    return repository.attachPlanItemWorkflowQueuedActionTurn({
      workflow_id: workflow.id,
      action_id: action.id,
      codex_session_turn_id: turn.id,
      now: this.now(),
    });
  }

  private isTerminalRunSession(runSession: RunSession): boolean {
    return ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(runSession.status);
  }

  private reviewFixSucceededReviewResponse(input: {
    response: ReviewResponse | undefined;
    workflow: PlanItemWorkflow;
    session: CodexSession;
    currentReviewPacket: ReviewPacket;
    previousRunSession: RunSession;
  }): ReviewResponse | undefined {
    const { response, workflow, session, currentReviewPacket, previousRunSession } = input;
    if (
      response === undefined ||
      response.status !== 'succeeded' ||
      response.workflow_id !== workflow.id ||
      response.codex_session_id !== session.id ||
      response.review_packet_id !== currentReviewPacket.id ||
      response.previous_run_session_id !== previousRunSession.id
    ) {
      return undefined;
    }
    return response;
  }

  private async startReviewFixExecution(
    repository: DeliveryRepository,
    input: {
      workflow: PlanItemWorkflow;
      session: CodexSession;
      executionPackage: ExecutionPackage;
      previousRunSession: RunSession;
      currentReviewPacket: { packet: ReviewPacket; evidenceRefs: ReviewPacketEvidenceRef[]; digest: string };
      inputCapsule: CodexRuntimeCapsule;
      inputContinuity: WorkflowExecutionInputContinuity;
      runtimeBinding: StartWorkflowExecutionRuntimeBinding;
      workerSessionDigest: string;
      actorId: string;
      fixInstructionMarkdown?: string;
    },
  ): Promise<{
    workflow: PlanItemWorkflow;
    session: CodexSession;
    executionPackage: ExecutionPackage;
    turn: CodexSessionTurn;
    runSession: RunSession;
    runtimeJob: CodexRuntimeJob;
    inputCapsuleDigest: string;
    workspaceBundleDigest: string;
  }> {
    const {
      workflow,
      session,
      executionPackage,
      previousRunSession,
      currentReviewPacket,
      inputCapsule,
      inputContinuity,
      runtimeBinding,
      workerSessionDigest,
      actorId,
    } = input;
    const now = this.now();
    const runtimeExpiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
    const executionTurn = await this.createWorkflowChildTurn(
      repository,
      workflow,
      session,
      actorId,
      'fix_review_feedback',
      `request-review-fix:${currentReviewPacket.packet.id}:${input.fixInstructionMarkdown ?? 'default'}`,
    );
    const runSessionId = randomUUID();
    const runtimeJobId = randomUUID();
    const launchLeaseId = randomUUID();
    const envelopeId = randomUUID();
    const leaseToken = `codex-session-review-fix:${randomUUID()}`;
    const runWorkerLeaseToken = `run-worker-review-fix:${randomUUID()}`;
    const packageVersionForReview = executionPackage.execution_package_version ?? executionPackage.version;
    const queuedPackage =
      executionPackage.phase === 'ready'
        ? transitionExecutionPackage(executionPackage, { type: 'run', run_session_id: runSessionId, at: now })
        : transitionExecutionPackage(executionPackage, {
            type: 'force_rerun',
            run_session_id: runSessionId,
            has_open_review_packet: true,
            at: now,
          });
    const runningPackage = transitionExecutionPackage(queuedPackage, { type: 'workflow_start', at: now });
    const pathPolicyDigest = codexCanonicalDigest({
      allowed_paths: runningPackage.allowed_paths,
      forbidden_paths: runningPackage.forbidden_paths,
      source_mutation_policy: runningPackage.source_mutation_policy,
    });
    const latestReviewResponse = await repository.getLatestReviewResponseForWorkflow(workflow.id);
    const reviewResponseForFix = this.reviewFixSucceededReviewResponse({
      response: latestReviewResponse,
      workflow,
      session,
      currentReviewPacket: currentReviewPacket.packet,
      previousRunSession,
    });
    const reviewResponseIds = reviewResponseForFix === undefined ? [] : [reviewResponseForFix.id];
    const reviewContext: RunSpec['review_context'] = {
      latest_decision: 'changes_requested',
      review_packet_id: currentReviewPacket.packet.id,
      review_packet_digest: currentReviewPacket.digest,
      previous_run_session_id: previousRunSession.id,
      approved_spec_revision_id: this.requireString(workflow.active_spec_doc_revision_id, 'Workflow approved Spec Doc is missing'),
      approved_implementation_plan_revision_id: this.requireString(
        workflow.active_implementation_plan_doc_revision_id,
        'Workflow approved Implementation Plan Doc is missing',
      ),
      execution_package_id: runningPackage.id,
      execution_package_version: packageVersionForReview,
      path_policy_digest: pathPolicyDigest,
      required_checks: runningPackage.required_checks.map((check) => ({ ...check })),
      evidence_refs: [...currentReviewPacket.evidenceRefs]
        .sort((left, right) => left.digest.localeCompare(right.digest) || left.id.localeCompare(right.id))
        .map((ref) => ({
          id: ref.id,
          ref_kind: ref.ref_kind,
          display_text: ref.display_text,
          digest: ref.digest,
        })),
      review_response_ids: reviewResponseIds,
      requested_changes: currentReviewPacket.packet.requested_changes.map((change) => ({ ...change })),
    };
    const signedContextJson = {
      schema_version: 'review_fix_context.v1',
      plan_item_workflow_id: workflow.id,
      review_packet_id: currentReviewPacket.packet.id,
      review_packet_digest: currentReviewPacket.digest,
      review_packet_summary: currentReviewPacket.packet.summary,
      risk_notes: currentReviewPacket.packet.risk_notes,
      requested_changes: reviewContext.requested_changes,
      evidence_refs: reviewContext.evidence_refs,
      review_response_ids: reviewContext.review_response_ids,
      previous_run_session_id: previousRunSession.id,
      previous_run_session_status: previousRunSession.status,
      previous_run_session_summary: previousRunSession.summary ?? null,
      approved_spec_revision_id: reviewContext.approved_spec_revision_id,
      approved_implementation_plan_revision_id: reviewContext.approved_implementation_plan_revision_id,
      execution_package_id: runningPackage.id,
      execution_package_version: packageVersionForReview,
      path_policy_digest: pathPolicyDigest,
      required_checks: reviewContext.required_checks,
      check_strategy: runningPackage.required_checks.map((check) => ({
        check_id: check.check_id,
        command: check.command,
        blocks_review: check.blocks_review,
      })),
      ...(input.fixInstructionMarkdown === undefined ? {} : { fix_instruction_markdown: input.fixInstructionMarkdown }),
    };
    const runSession = transitionRunSession(undefined, {
      type: 'create',
      id: runSessionId,
      execution_package_id: runningPackage.id,
      requested_by_actor_id: actorId,
      executor_type: 'local_codex',
      at: now,
    });
    await repository.saveExecutionPackage(runningPackage);
    await repository.saveRunSession({
      ...runSession,
      workflow_id: workflow.id,
      codex_session_id: session.id,
      codex_session_turn_id: executionTurn.id,
      executor_type: 'local_codex',
    });
    const runContext = await loadRunContext(repository, runSessionId);
    const runSpec = runSpecSchema.parse({
      run_session_id: runSessionId,
      execution_package_id: runningPackage.id,
      project_id: runningPackage.project_id,
      expected_package_version: runningPackage.version,
      work_item_id: runningPackage.work_item_id,
      spec_revision_id: runContext.specRevision.id,
      plan_revision_id: runContext.planRevision.id,
      executor_type: 'local_codex',
      repo: {
        repo_id: runContext.projectRepo.repo_id,
        local_path: runContext.projectRepo.local_path,
        base_branch: runContext.projectRepo.default_branch,
        base_commit_sha: runContext.projectRepo.base_commit_sha,
      },
      objective: runningPackage.objective,
      context: {
        spec_revision_summary: runContext.specRevision.summary,
        plan_revision_summary: runContext.planRevision.summary,
        package_instructions: runningPackage.objective,
        required_checks: runningPackage.required_checks.map((check) => ({ ...check })),
      },
      review_context: reviewContext,
      workflow_only: previousRunSession.run_spec?.workflow_only ?? false,
      source_mutation_policy: runningPackage.source_mutation_policy,
      allowed_paths: [...runningPackage.allowed_paths],
      forbidden_paths: [...runningPackage.forbidden_paths],
      required_checks: runningPackage.required_checks.map((check) => ({ ...check })),
      artifact_policy: {
        requested_artifacts: [...new Set([...runningPackage.required_artifact_kinds, ...reviewFixBaseRequestedArtifacts])],
      },
      timeout_seconds: previousRunSession.run_spec?.timeout_seconds ?? 3600,
      idempotency_key: runSessionId,
    });
    await repository.saveRunSession({
      ...runSession,
      workflow_id: workflow.id,
      codex_session_id: session.id,
      codex_session_turn_id: executionTurn.id,
      executor_type: 'local_codex',
      run_spec: runSpec,
    });
    await repository.saveRunSessionAttemptLineage({
      run_session_id: runSessionId,
      workflow_id: workflow.id,
      codex_session_id: session.id,
      attempt_kind: 'review_fix',
      previous_run_session_id: previousRunSession.id,
      previous_review_packet_id: currentReviewPacket.packet.id,
      ...(reviewResponseForFix === undefined ? {} : { review_response_id: reviewResponseForFix.id }),
      created_by_actor_id: actorId,
      created_at: now,
    });
    const workflowExecutionPayload = this.workflowExecutionPayload(runningPackage, this.workflowExecutionRemoteRunSpec(runSpec));
    const workspaceBundle = this.workflowExecutionWorkspaceBundle(now, workflowExecutionPayload);
    await repository.saveRunSession({
      ...runSession,
      workflow_id: workflow.id,
      codex_session_id: session.id,
      codex_session_turn_id: executionTurn.id,
      executor_type: 'local_codex',
      run_spec: runSpec,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'not_started',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
        runtime_profile_id: runtimeBinding.runtime_profile_id,
        runtime_profile_revision_id: runtimeBinding.runtime_profile_revision_id,
        runtime_profile_digest: runtimeBinding.runtime_profile_digest,
        runtime_target_kind: 'run_execution',
        source_access_mode: 'path_policy_scoped',
        environment: runtimeBinding.environment,
        credential_binding_id: runtimeBinding.credential_binding_id,
        credential_binding_version_id: runtimeBinding.credential_binding_version_id,
        credential_payload_digest: runtimeBinding.credential_payload_digest,
        launch_lease_id: launchLeaseId,
        docker_image_digest: runtimeBinding.docker_image_digest,
        network_policy_digest: runtimeBinding.network_policy_digest,
        ...(runtimeBinding.network_provider_config_digest === undefined
          ? {}
          : { network_provider_config_digest: runtimeBinding.network_provider_config_digest }),
        remote_runtime_job_id: runtimeJobId,
        remote_runtime_job_created: true,
        remote_workspace_bundle_digest: workspaceBundle.archive_digest,
        remote_workspace_manifest_digest: workspaceBundle.manifest_digest,
        remote_workspace_bundle_size_bytes: workspaceBundle.bytes.byteLength,
        remote_workspace_bundle_expires_at: runtimeExpiresAt,
      },
    });
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: runSessionId,
      worker_id: runtimeBinding.worker.id,
      lease_token: runWorkerLeaseToken,
      now,
      expires_at: runtimeExpiresAt,
    });
    const codexLease = await repository.claimCodexSessionLease({
      session_id: session.id,
      workflow_id: workflow.id,
      lease_id: randomUUID(),
      lease_token_hash: codexCredentialPayloadDigest(leaseToken),
      worker_id: runtimeBinding.worker.id,
      worker_session_digest: workerSessionDigest,
      expected_input_capsule_digest: inputCapsule.digest,
      input_capsule_id: inputCapsule.id,
      input_capsule_digest: inputCapsule.digest,
      ...(session.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: session.base_memory_bundle_ref }),
      ...(session.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: session.base_memory_bundle_digest }),
      ...inputContinuity,
      now,
      expires_at: runtimeExpiresAt,
    });
    const pendingWorkspaceBundleRef = `artifact://internal/workspace_bundle/run_session/${runSessionId}/${workspaceBundle.id}`;
    const workspaceAcquisition = {
      schema_version: 'workspace_bundle_acquisition.v1' as const,
      bundle_id: workspaceBundle.id,
      archive_ref: pendingWorkspaceBundleRef,
      archive_digest: workspaceBundle.archive_digest,
      manifest_digest: workspaceBundle.manifest_digest,
      size_bytes: workspaceBundle.bytes.byteLength,
      expires_at: runtimeExpiresAt,
    };
    const workspaceAcquisitionDigest = this.requireString(
      codexWorkspaceAcquisitionDigest(workspaceAcquisition),
      'Workspace acquisition digest missing',
    );
    const workload: CodexRunExecutionWorkloadV1 = validateCodexRunExecutionWorkload({
      schema_version: 'codex_run_execution_workload.v1',
      runtime_job_id: runtimeJobId,
      plan_item_workflow_id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      run_session_id: runSessionId,
      execution_package_id: runningPackage.id,
      execution_package_version: runningPackage.version,
      workspace_bundle_id: workspaceBundle.id,
      workspace_bundle_digest: workspaceBundle.archive_digest,
      package_prompt_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/package-prompt`,
      package_prompt_digest: codexCanonicalDigest(workflowExecutionPayload.packagePrompt),
      execution_context_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/execution-context`,
      execution_context_digest: codexCanonicalDigest(workflowExecutionPayload.executionContext),
      path_policy_digest: pathPolicyDigest,
      required_checks_digest: codexCanonicalDigest(runningPackage.required_checks),
      previous_run_session_id: previousRunSession.id,
      previous_review_packet_id: currentReviewPacket.packet.id,
      review_packet_digest: currentReviewPacket.digest,
      signed_context_json: signedContextJson,
      output_schema_version: 'codex_run_execution_result.v1',
      created_at: now,
      expires_at: runtimeExpiresAt,
      workspace_acquisition_json: workspaceAcquisition,
      codex_session_runtime_context: {
        schema_version: 'codex_session_runtime_context.v1',
        codex_session_id: session.id,
        codex_session_turn_id: executionTurn.id,
        lease_id: launchLeaseId,
        lease_epoch: codexLease.lease.lease_epoch,
        worker_id: runtimeBinding.worker.id,
        worker_session_digest: workerSessionDigest,
        expected_input_capsule_digest: inputCapsule.digest,
        turn_group_status: 'complete',
        continuation: {
          kind: 'resume_thread',
          codex_thread_id: this.requireString(session.codex_thread_id, 'Review fix requires a Codex thread id'),
          codex_thread_id_digest: this.requireString(session.codex_thread_id_digest, 'Review fix requires a Codex thread id digest'),
        },
      },
      codex_session_terminalization: {
        schema_version: 'codex_session_terminalization.v1',
        lease_token: leaseToken,
        codex_session_lease_id: codexLease.lease.id,
        codex_session_lease_epoch: codexLease.lease.lease_epoch,
        codex_session_worker_id: runtimeBinding.worker.id,
        codex_session_worker_session_digest: workerSessionDigest,
        codex_session_id: session.id,
        codex_session_turn_id: executionTurn.id,
        expected_input_capsule_digest: inputCapsule.digest,
        input_capsule_id: inputCapsule.id,
        input_capsule_ref: inputCapsule.artifact_ref,
        input_capsule_digest: inputCapsule.digest,
        ...(session.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: session.base_memory_bundle_ref }),
        ...(session.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: session.base_memory_bundle_digest }),
        ...inputContinuity,
      },
    });
    const workspaceBundleArtifact = await new LocalInternalArtifactStore({
      root: this.internalArtifactStoreRoot,
      repository,
      requestId: `plan-item-workflow-review-fix-${workflow.id}`,
    }).putObject({
      artifact_id: workspaceBundle.id,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: runSessionId,
      visibility: 'internal',
      content_type: 'application/vnd.forgeloop.workspace-bundle',
      declared_size_bytes: String(workspaceBundle.bytes.byteLength),
      declared_artifact_digest: workspaceBundle.archive_digest,
      idempotency_key: workspaceBundle.id,
      metadata_json: {
        manifest_digest: workspaceBundle.manifest_digest,
        execution_package_id: runningPackage.id,
        run_worker_lease_id: runWorkerLease.id,
        workspace_acquisition_digest: workspaceAcquisitionDigest,
        review_packet_id: currentReviewPacket.packet.id,
        review_packet_digest: currentReviewPacket.digest,
        signed_context_digest: codexCanonicalDigest(signedContextJson),
      },
      created_by_actor_type: 'system',
      created_by_actor_id: actorId,
      now,
      max_size_bytes: 100 * 1024 * 1024,
      bytes: workspaceBundle.bytes,
    });
    const pendingWorkspaceBundle = {
      id: randomUUID(),
      bundle_id: workspaceBundle.id,
      run_session_id: runSessionId,
      execution_package_id: runningPackage.id,
      pending_artifact_ref: pendingWorkspaceBundleRef,
      internal_artifact_object_id: workspaceBundleArtifact.id,
      archive_digest: workspaceBundle.archive_digest,
      manifest_digest: workspaceBundle.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: workspaceBundle.bytes.byteLength,
      workspace_acquisition_digest: workspaceAcquisitionDigest,
      workspace_acquisition_json: workspaceAcquisition,
      expires_at: runtimeExpiresAt,
      request_digest: codexCanonicalDigest({
        runtime_job_id: runtimeJobId,
        workspace_bundle_id: workspaceBundle.id,
        archive_digest: workspaceBundle.archive_digest,
        internal_artifact_object_id: workspaceBundleArtifact.id,
      }),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingWorkspaceBundle);
    const runtimeJobResult = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
      runtime_job_id: runtimeJobId,
      launch_lease_id: launchLeaseId,
      envelope_id: envelopeId,
      job_request_id: codexCanonicalDigest({
        kind: 'plan_item_workflow_review_fix',
        workflow_id: workflow.id,
        run_session_id: runSessionId,
        previous_run_session_id: previousRunSession.id,
        previous_review_packet_id: currentReviewPacket.packet.id,
      }),
      target: {
        target_type: 'run_session',
        target_id: runSessionId,
        target_kind: 'run_execution',
        project_id: runningPackage.project_id,
        repo_id: runningPackage.repo_id,
      },
      launch_attempt: 1,
      worker_id: runtimeBinding.worker.id,
      runtime_profile_revision_id: runtimeBinding.runtime_profile_revision_id,
      runtime_profile_digest: runtimeBinding.runtime_profile_digest,
      credential_binding_id: runtimeBinding.credential_binding_id,
      credential_binding_version_id: runtimeBinding.credential_binding_version_id,
      credential_payload_digest: runtimeBinding.credential_payload_digest,
      docker_image_digest: runtimeBinding.docker_image_digest,
      network_policy_digest: runtimeBinding.network_policy_digest,
      ...(runtimeBinding.network_provider_config_digest === undefined
        ? {}
        : { network_provider_config_digest: runtimeBinding.network_provider_config_digest }),
      input_json: workload as unknown as Record<string, unknown>,
      input_digest: codexRuntimeJobInputDigest(workload),
      workspace_acquisition_json: workspaceAcquisition,
      workspace_acquisition_digest: workspaceAcquisitionDigest,
      pending_workspace_bundle: pendingWorkspaceBundle,
      execution_package_id: runningPackage.id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token_hash: codexCredentialPayloadDigest(runWorkerLeaseToken),
      run_session_status: runSession.status,
      run_session_updated_at: runSession.updated_at,
      execution_package_version: runningPackage.version,
      workflow_id: workflow.id,
      codex_session_id: session.id,
      codex_session_turn_id: executionTurn.id,
      expires_at: runtimeExpiresAt,
      now,
    });
    await this.writeWorkflowExecutionStartAudit(repository, {
      workflow,
      session,
      executionPackage: runningPackage,
      runSessionId,
      runtimeJobId,
      executionTurnId: executionTurn.id,
      inputCapsuleDigest: inputCapsule.digest,
      repoBindingId: runContext.projectRepo.id,
      credentialBindingId: runtimeBinding.credential_binding_id,
      credentialBindingVersionId: runtimeBinding.credential_binding_version_id,
      workspaceBundleDigest: workspaceBundle.archive_digest,
      codexThreadIdDigest: this.requireString(session.codex_thread_id_digest, 'Review fix requires a Codex thread id digest'),
      status: runSession.status,
    }, actorId, `review-packet:${currentReviewPacket.packet.id}`, now);
    const transitionInput: WorkflowTransitionCommandDto = {
      actor_id: actorId,
      to_status: 'execution_running',
      evidence_object_type: 'run_session',
      evidence_object_id: runSessionId,
      codex_session_turn_id: executionTurn.id,
      supporting_evidence: [{ object_type: 'review_packet', object_id: currentReviewPacket.packet.id, digest: currentReviewPacket.digest }],
      reason: 'Review fix execution requested.',
    };
    await this.validateTransitionEvidence(repository, workflow, transitionInput);
    const updatedWorkflow = await this.applyTransition(repository, workflow, transitionInput, session.id, now);
    const persistedRunSession = this.requireFound(await repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const persistedSession = (await repository.getCodexSession(session.id)) ?? codexLease.session ?? session;
    return {
      workflow: updatedWorkflow,
      session: persistedSession,
      executionPackage: runningPackage,
      turn: executionTurn,
      runSession: persistedRunSession,
      runtimeJob: runtimeJobResult.runtime_job,
      inputCapsuleDigest: inputCapsule.digest,
      workspaceBundleDigest: workspaceBundle.archive_digest,
    };
  }

  private async classifyExecutionContinuation(
    repository: DeliveryRepository,
    input: {
      workflow: PlanItemWorkflow;
      session: CodexSession;
      executionPackage: ExecutionPackage;
      runSession: RunSession;
      runtimeJob: CodexRuntimeJob;
      input: ContinueWorkflowExecutionBodyDto;
    },
  ): Promise<ContinuationDecision> {
    const { workflow, session, executionPackage, runSession, runtimeJob } = input;
    if (!this.workflowExecutionRuntimeTargetMatches({ workflow, session, executionPackage, runSession, runtimeJob })) {
      return { mode: 'reject', code: 'workflow_execution_recovery_required' };
    }
    const now = this.now();
    const codexSessionLease = await this.resolveRuntimeJobCodexSessionLeaseForContinuation(repository, session, runtimeJob);
    const runWorkerLease = await repository.getRunWorkerLease(runSession.id);
    const launchLease = await repository.getCodexLaunchLeasePublicStatus({ launch_lease_id: runtimeJob.launch_lease_id });
    const runtimeJobActive = codexRuntimeJobIsActive(runtimeJob);
    const activeRuntimeJobLineageValid =
      this.runtimeJobInputCapsuleDigestMatchesSession(runtimeJob, session) &&
      (await this.runtimeJobTurnIsRunning(repository, runSession, runtimeJob));
    const leasesActive =
      codexSessionLease !== undefined &&
      this.codexSessionLeaseIsActive(codexSessionLease, session, runtimeJob, now) &&
      runWorkerLease !== undefined &&
      this.runWorkerLeaseIsActive(runWorkerLease, runtimeJob, now) &&
      launchLease !== undefined &&
      this.codexLaunchLeaseIsActive(launchLease, runtimeJob, now);

    if (runSession.status === 'waiting_for_input') {
      if (runtimeJob.status === 'running' && leasesActive && activeRuntimeJobLineageValid) {
        return { mode: 'existing_job_input', runSession, runtimeJob, codexSessionLease, runWorkerLease, launchLease };
      }
      if (runtimeJob.status === 'running' && leasesActive) {
        return { mode: 'reject', code: 'workflow_execution_recovery_required' };
      }
      return { mode: 'reject', code: 'workflow_execution_not_ready_for_input' };
    }

    if (runSession.status === 'resuming') {
      if (runtimeJobActive && leasesActive && activeRuntimeJobLineageValid) {
        return { mode: 'replay_current_continuation', runSession, runtimeJob, codexSessionLease, runWorkerLease, launchLease };
      }
      if (runtimeJobActive && leasesActive) {
        return { mode: 'reject', code: 'workflow_execution_recovery_required' };
      }
      const previousCodexSessionLease = await this.recoverExpiredCodexSessionLeaseForContinuation(repository, {
        workflow,
        session,
        lease: codexSessionLease,
        now,
      });
      if (
        runtimeJob.status === 'terminal' &&
        previousCodexSessionLease !== undefined &&
        this.runWorkerLeaseIsRecoverable(runWorkerLease, now)
      ) {
        return {
          mode: 'relaunch_after_fencing',
          runSession,
          previousRuntimeJob: runtimeJob,
          previousCodexSessionLease,
          ...(runWorkerLease === undefined ? {} : { previousRunWorkerLease: runWorkerLease }),
        };
      }
      return { mode: 'reject', code: 'workflow_execution_recovery_required' };
    }

    if (runSession.status === 'stalled') {
      if (runtimeJob.status !== 'terminal') {
        return { mode: 'reject', code: 'workflow_execution_writer_still_active' };
      }
      const previousCodexSessionLease = await this.recoverExpiredCodexSessionLeaseForContinuation(repository, {
        workflow,
        session,
        lease: codexSessionLease,
        now,
      });
      if (previousCodexSessionLease === undefined) {
        return { mode: 'reject', code: 'workflow_execution_writer_still_active' };
      }
      if (!this.runWorkerLeaseIsRecoverable(runWorkerLease, now)) {
        return { mode: 'reject', code: 'workflow_execution_writer_still_active' };
      }
      return {
        mode: 'relaunch_after_fencing',
        runSession,
        previousRuntimeJob: runtimeJob,
        previousCodexSessionLease,
        ...(runWorkerLease === undefined ? {} : { previousRunWorkerLease: runWorkerLease }),
      };
    }

    if (runSession.status === 'cancel_requested') {
      if (
        input.input.cancel_recovery_decision !== 'recover_instead_of_accept_cancel' ||
        input.input.cancel_recovery_confirmation_phrase !== 'recover cancelled execution'
      ) {
        return { mode: 'reject', code: 'workflow_execution_cancel_pending' };
      }
      const turn =
        runSession.codex_session_turn_id === undefined ? undefined : await repository.getCodexSessionTurn(runSession.codex_session_turn_id);
      if (
        runtimeJobActive ||
        (codexSessionLease !== undefined && this.codexSessionLeaseCanStillTerminalize(codexSessionLease, session, runtimeJob, now)) ||
        (runWorkerLease !== undefined && this.runWorkerLeaseIsActive(runWorkerLease, runtimeJob, now)) ||
        (launchLease !== undefined && this.codexLaunchLeaseIsActive(launchLease, runtimeJob, now)) ||
        (turn?.status !== 'cancelled' && turn?.status !== 'stale')
      ) {
        return { mode: 'reject', code: 'workflow_execution_cancel_pending' };
      }
      const previousCodexSessionLease = await this.recoverExpiredCodexSessionLeaseForContinuation(repository, {
        workflow,
        session,
        lease: codexSessionLease,
        now,
      });
      if (
        runtimeJob.status !== 'terminal' ||
        previousCodexSessionLease === undefined ||
        !this.runWorkerLeaseIsRecoverable(runWorkerLease, now)
      ) {
        return { mode: 'reject', code: 'workflow_execution_cancel_pending' };
      }
      return {
        mode: 'relaunch_after_fencing',
        runSession,
        previousRuntimeJob: runtimeJob,
        previousCodexSessionLease,
        ...(runWorkerLease === undefined ? {} : { previousRunWorkerLease: runWorkerLease }),
        cancelRecovery: true,
      };
    }

    return { mode: 'reject', code: 'workflow_execution_not_ready_for_input' };
  }

  private workflowExecutionRuntimeTargetMatches(input: {
    workflow: PlanItemWorkflow;
    session: CodexSession;
    executionPackage: ExecutionPackage;
    runSession: RunSession;
    runtimeJob: CodexRuntimeJob;
  }): boolean {
    const { workflow, session, executionPackage, runSession, runtimeJob } = input;
    let workload: ReturnType<typeof validateCodexRunExecutionWorkload>;
    try {
      workload = validateCodexRunExecutionWorkload(runtimeJob.input_json);
    } catch {
      return false;
    }
    const workloadInputCapsuleDigest = workload.codex_session_runtime_context.expected_input_capsule_digest;
    return (
      workloadInputCapsuleDigest !== undefined &&
      runtimeJob.input_digest === codexRuntimeJobInputDigest(workload) &&
      runSession.execution_package_id === executionPackage.id &&
      runSession.workflow_id === workflow.id &&
      runSession.codex_session_id === session.id &&
      runSession.codex_session_turn_id !== undefined &&
      runtimeJob.target_type === 'run_session' &&
      runtimeJob.target_id === runSession.id &&
      runtimeJob.target_kind === 'run_execution' &&
      runtimeJob.workflow_id === workflow.id &&
      runtimeJob.codex_session_id === session.id &&
      runtimeJob.codex_session_turn_id === runSession.codex_session_turn_id &&
      runtimeJob.repo_id === executionPackage.repo_id &&
      workload.runtime_job_id === runtimeJob.id &&
      workload.plan_item_workflow_id === workflow.id &&
      workload.development_plan_id === workflow.development_plan_id &&
      workload.development_plan_item_id === workflow.development_plan_item_id &&
      workload.run_session_id === runSession.id &&
      workload.execution_package_id === executionPackage.id &&
      workload.execution_package_version === executionPackage.version &&
      workload.workspace_bundle_digest === runSession.runtime_metadata?.remote_workspace_bundle_digest &&
      workload.codex_session_runtime_context.codex_session_id === session.id &&
      workload.codex_session_runtime_context.codex_session_turn_id === runSession.codex_session_turn_id &&
      workload.codex_session_runtime_context.continuation.codex_thread_id_digest === session.codex_thread_id_digest &&
      workload.codex_session_terminalization.codex_session_id === session.id &&
      workload.codex_session_terminalization.codex_session_turn_id === runSession.codex_session_turn_id &&
      workload.codex_session_terminalization.expected_input_capsule_digest === workloadInputCapsuleDigest &&
      workload.codex_session_terminalization.input_capsule_digest === workloadInputCapsuleDigest
    );
  }

  private requireRuntimeJobInputCapsuleDigest(runtimeJob: CodexRuntimeJob, message: string): string {
    const workload = validateCodexRunExecutionWorkload(runtimeJob.input_json);
    return this.requireString(workload.codex_session_runtime_context.expected_input_capsule_digest, message);
  }

  private runtimeJobInputCapsuleDigestMatchesSession(runtimeJob: CodexRuntimeJob, session: CodexSession): boolean {
    try {
      return this.requireRuntimeJobInputCapsuleDigest(runtimeJob, 'Runtime input capsule digest is missing') === session.latest_capsule_digest;
    } catch {
      return false;
    }
  }

  private async runtimeJobTurnIsRunning(
    repository: DeliveryRepository,
    runSession: RunSession,
    runtimeJob: CodexRuntimeJob,
  ): Promise<boolean> {
    const turnId = runSession.codex_session_turn_id;
    if (turnId === undefined || runtimeJob.codex_session_turn_id !== turnId) {
      return false;
    }
    const turn = await repository.getCodexSessionTurn(turnId);
    return turn !== undefined && turn.status === 'running';
  }

  private async resolveRuntimeJobCodexSessionLeaseForContinuation(
    repository: DeliveryRepository,
    session: CodexSession,
    runtimeJob: CodexRuntimeJob,
  ): Promise<CodexSessionLease | undefined> {
    const activeLease = session.active_lease_id === undefined ? undefined : await repository.getCodexSessionLease(session.active_lease_id);
    if (activeLease !== undefined && activeLease.worker_id === runtimeJob.worker_id) {
      return activeLease;
    }
    let workload: ReturnType<typeof validateCodexRunExecutionWorkload>;
    try {
      workload = validateCodexRunExecutionWorkload(runtimeJob.input_json);
    } catch {
      return activeLease;
    }
    const workloadLease = await repository.getCodexSessionLease(workload.codex_session_terminalization.codex_session_lease_id);
    return workloadLease ?? activeLease;
  }

  private codexSessionLeaseIsActive(
    lease: CodexSessionLease,
    session: CodexSession,
    runtimeJob: CodexRuntimeJob,
    now: string,
  ): boolean {
    return this.codexSessionLeaseCanStillTerminalize(lease, session, runtimeJob, now);
  }

  private codexSessionLeaseCanStillTerminalize(
    lease: CodexSessionLease,
    session: CodexSession,
    runtimeJob: CodexRuntimeJob,
    now: string,
  ): boolean {
    return (
      lease.status === 'active' &&
      lease.expires_at > now &&
      lease.codex_session_id === session.id &&
      session.active_lease_id === lease.id &&
      lease.worker_id === runtimeJob.worker_id &&
      this.codexSessionLeaseWorkerSessionDigestMatchesRuntimeJob(lease, runtimeJob)
    );
  }

  private codexSessionLeaseWorkerSessionDigestMatchesRuntimeJob(
    lease: CodexSessionLease,
    runtimeJob: CodexRuntimeJob,
  ): boolean {
    try {
      const workload = validateCodexRunExecutionWorkload(runtimeJob.input_json);
      return (
        lease.worker_session_digest === workload.codex_session_runtime_context.worker_session_digest &&
        lease.worker_session_digest === workload.codex_session_terminalization.codex_session_worker_session_digest
      );
    } catch {
      return false;
    }
  }

  private runWorkerLeaseIsActive(lease: RunWorkerLease, runtimeJob: CodexRuntimeJob, now: string): boolean {
    return lease.status === 'active' && lease.expires_at > now && lease.worker_id === runtimeJob.worker_id;
  }

  private codexLaunchLeaseIsActive(lease: CodexLaunchLease, runtimeJob: CodexRuntimeJob, now: string): boolean {
    return (
      lease.id === runtimeJob.launch_lease_id &&
      lease.worker_id === runtimeJob.worker_id &&
      lease.expires_at > now &&
      (lease.status === 'active' || lease.status === 'materialized')
    );
  }

  private codexSessionLeaseIsRecoverable(lease: CodexSessionLease, session: CodexSession): boolean {
    return (
      lease.codex_session_id === session.id &&
      (lease.status === 'released' || lease.status === 'expired' || lease.status === 'fenced' || lease.status === 'stale')
    );
  }

  private runWorkerLeaseIsRecoverable(lease: RunWorkerLease | undefined, now: string): boolean {
    return lease === undefined || lease.status === 'released' || lease.status === 'expired' || lease.expires_at <= now;
  }

  private async recoverExpiredCodexSessionLeaseForContinuation(
    repository: DeliveryRepository,
    input: {
      workflow: PlanItemWorkflow;
      session: CodexSession;
      lease: CodexSessionLease | undefined;
      now: string;
    },
  ): Promise<CodexSessionLease | undefined> {
    const { workflow, session, lease, now } = input;
    if (lease === undefined) {
      return undefined;
    }
    if (this.codexSessionLeaseIsRecoverable(lease, session)) {
      return lease;
    }
    if (
      lease.status !== 'active' ||
      lease.expires_at > now ||
      lease.codex_session_id !== session.id ||
      session.active_lease_id !== lease.id
    ) {
      return undefined;
    }
    try {
      const recovered = await repository.recoverCodexSessionLeaseForClaim({
        session_id: session.id,
        workflow_id: workflow.id,
        lease_id: lease.id,
        lease_token_hash: lease.lease_token_hash,
        worker_id: lease.worker_id,
        worker_session_digest: lease.worker_session_digest,
        lease_epoch: lease.lease_epoch,
        ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
        ...(session.latest_capsule_id === undefined ? {} : { input_capsule_id: session.latest_capsule_id }),
        ...(session.latest_capsule_digest === undefined ? {} : { input_capsule_digest: session.latest_capsule_digest }),
        ...(session.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: session.base_memory_bundle_ref }),
        ...(session.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: session.base_memory_bundle_digest }),
        ...(session.latest_memory_bundle_ref === undefined ? {} : { input_memory_bundle_ref: session.latest_memory_bundle_ref }),
        ...(session.latest_memory_bundle_digest === undefined ? {} : { input_memory_bundle_digest: session.latest_memory_bundle_digest }),
        ...(session.latest_environment_manifest_ref === undefined
          ? {}
          : { input_environment_manifest_ref: session.latest_environment_manifest_ref }),
        ...(session.latest_environment_manifest_digest === undefined
          ? {}
          : { input_environment_manifest_digest: session.latest_environment_manifest_digest }),
        now,
      });
      return recovered.lease;
    } catch (error) {
      if (error instanceof DomainError) {
        return undefined;
      }
      throw error;
    }
  }

  private async createAndClaimContinueExecutionAction(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    input: ContinueWorkflowExecutionBodyDto,
    mode: ContinuationDecision['mode'],
  ): Promise<PlanItemWorkflowQueuedAction> {
    const now = this.now();
    const contextPreviewDigest = codexCanonicalDigest({
      schema_version: 'continue_execution_context_preview.v1',
      workflow_id: workflow.id,
      codex_session_id: session.id,
      workflow_status: workflow.status,
      mode,
      expected_input_capsule_digest: session.latest_capsule_digest ?? null,
      input_markdown_digest: input.input_markdown === undefined ? null : codexCanonicalDigest(input.input_markdown),
      cancel_recovery_decision: input.cancel_recovery_decision ?? null,
    });
    const requestDigest = codexCanonicalDigest({
      schema_version: 'continue_execution_request.v1',
      workflow_id: workflow.id,
      actor_id: input.actor_id,
      expected_input_capsule_digest: session.latest_capsule_digest ?? null,
      input_markdown_digest: input.input_markdown === undefined ? null : codexCanonicalDigest(input.input_markdown),
      cancel_recovery_decision: input.cancel_recovery_decision ?? null,
      cancel_recovery_confirmation_phrase: input.cancel_recovery_confirmation_phrase ?? null,
    });
    const idempotencyKey = codexCanonicalDigest({
      schema_version: 'continue_execution_idempotency.v2',
      workflow_id: workflow.id,
      actor_id: input.actor_id,
      client_idempotency_key: input.idempotency_key ?? requestDigest,
      request_digest: requestDigest,
    });
    const existingAction = (await repository.listPlanItemWorkflowQueuedActions(workflow.id)).find(
      (candidate) => candidate.kind === 'continue_execution' && candidate.idempotency_key === idempotencyKey,
    );
    if (existingAction !== undefined) {
      if (existingAction.status === 'stale' || existingAction.status === 'cancelled' || existingAction.status === 'failed') {
        throw new DomainError(
          'workflow_action_not_runnable',
          `workflow_action_not_runnable: Continue execution action ${existingAction.id} is ${existingAction.status}`,
        );
      }
      if (existingAction.status !== 'queued' && existingAction.status !== 'running') {
        return existingAction;
      }
      const claimedExisting = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
        workflow_id: workflow.id,
        action_id: existingAction.id,
        now,
      });
      return claimedExisting.action;
    }
    const action = await repository.createOrReplayPlanItemWorkflowQueuedAction({
      id: randomUUID(),
      workflow_id: workflow.id,
      codex_session_id: session.id,
      kind: 'continue_execution',
      status: 'queued',
      ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
      context_preview_digest: contextPreviewDigest,
      idempotency_key: idempotencyKey,
      created_by_actor_id: input.actor_id,
      created_at: now,
      updated_at: now,
    });
    const claimed = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
      workflow_id: workflow.id,
      action_id: action.id,
      now,
    });
    return claimed.action;
  }

  private async completeExistingJobInputContinuation(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
    action: PlanItemWorkflowQueuedAction,
    decision: Extract<ContinuationDecision, { mode: 'existing_job_input' }>,
    input: ContinueWorkflowExecutionBodyDto,
  ): Promise<PlanItemWorkflowPublicDto> {
    const now = this.now();
    const updatedRunSession = transitionRunSession(decision.runSession, { type: 'resume_requested', at: now });
    const runtimeMetadata = this.requireRunRuntimeMetadata(updatedRunSession, 'Execution continuation requires runtime metadata');
    await repository.saveRunSession({
      ...updatedRunSession,
      runtime_metadata: {
        ...runtimeMetadata,
        driver_status: 'active',
      },
    });
    const currentRunWorkerLease = await repository.getRunWorkerLease(decision.runSession.id);
    if (
      currentRunWorkerLease === undefined ||
      !this.runWorkerLeaseIsActive(currentRunWorkerLease, decision.runtimeJob, now) ||
      currentRunWorkerLease.id !== decision.runWorkerLease.id
    ) {
      throw new DomainError('workflow_execution_writer_still_active', 'Workflow execution writer lease changed before input continuation');
    }
    const command: RunCommand = {
      id: randomUUID(),
      run_session_id: decision.runSession.id,
      command_type: 'input',
      status: 'pending',
      actor_id: input.actor_id,
      payload: {
        schema_version: 'plan_item_workflow_continue_execution_input.v1',
        workflow_id: workflow.id,
        queued_action_id: action.id,
        message: input.input_markdown ?? 'Continue execution.',
        input_markdown: input.input_markdown ?? 'Continue execution.',
      },
      ...(decision.runSession.codex_session_turn_id === undefined ? {} : { target_turn_id: decision.runSession.codex_session_turn_id }),
      created_at: now,
      updated_at: now,
    };
    await repository.supersedePendingRunCommands(decision.runSession.id, ['input'], now);
    await repository.saveRunCommand(command);
    await this.persistContinuationLineageAndTerminalAction(repository, workflow, session, action, {
      runSession: updatedRunSession,
      continuationKind: 'existing_job_input',
      previousRuntimeJobId: decision.runtimeJob.id,
      previousCapsuleDigest: this.requireRuntimeJobInputCapsuleDigest(
        decision.runtimeJob,
        'Execution continuation requires previous runtime input capsule digest',
      ),
      expectedInputCapsuleDigest: this.requireString(session.latest_capsule_digest, 'Execution continuation requires a latest capsule digest'),
      previousCodexSessionLeaseId: decision.codexSessionLease.id,
      previousRunWorkerLeaseId: decision.runWorkerLease.id,
      ...(decision.runSession.codex_session_turn_id === undefined ? {} : { codexSessionTurnId: decision.runSession.codex_session_turn_id }),
      actorId: input.actor_id,
      eventPayload: { mode: 'existing_job_input', run_command_id: command.id, runtime_job_id: decision.runtimeJob.id },
      now,
    });
    return this.continuedExecutionProjection(repository, workflow, session, executionPackage, updatedRunSession, decision.runtimeJob.id);
  }

  private async completeReplayCurrentContinuation(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
    action: PlanItemWorkflowQueuedAction,
    decision: Extract<ContinuationDecision, { mode: 'replay_current_continuation' }>,
  ): Promise<PlanItemWorkflowPublicDto> {
    const now = this.now();
    await this.persistContinuationLineageAndTerminalAction(repository, workflow, session, action, {
      runSession: decision.runSession,
      continuationKind: 'replay_current_continuation',
      previousRuntimeJobId: decision.runtimeJob.id,
      previousCapsuleDigest: this.requireRuntimeJobInputCapsuleDigest(
        decision.runtimeJob,
        'Execution continuation requires previous runtime input capsule digest',
      ),
      expectedInputCapsuleDigest: this.requireString(session.latest_capsule_digest, 'Execution continuation requires a latest capsule digest'),
      previousCodexSessionLeaseId: decision.codexSessionLease.id,
      previousRunWorkerLeaseId: decision.runWorkerLease.id,
      ...(decision.runSession.codex_session_turn_id === undefined ? {} : { codexSessionTurnId: decision.runSession.codex_session_turn_id }),
      actorId: action.created_by_actor_id,
      eventPayload: { mode: 'replay_current_continuation', runtime_job_id: decision.runtimeJob.id },
      now,
    });
    return this.continuedExecutionProjection(repository, workflow, session, executionPackage, decision.runSession, decision.runtimeJob.id);
  }

  private async completeRelaunchAfterFencingContinuation(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
    action: PlanItemWorkflowQueuedAction,
    decision: Extract<ContinuationDecision, { mode: 'relaunch_after_fencing' }>,
    input: ContinueWorkflowExecutionBodyDto,
  ): Promise<PlanItemWorkflowPublicDto> {
    const scheduled = await this.scheduleContinuationRelaunchRuntimeJob(repository, {
      workflow,
      session,
      executionPackage,
      action,
      runSession: decision.runSession,
      previousRuntimeJob: decision.previousRuntimeJob,
      actorId: input.actor_id,
      cancelRecovery: decision.cancelRecovery === true,
    });
    await this.persistContinuationLineageAndTerminalAction(repository, workflow, scheduled.session, action, {
      runSession: scheduled.runSession,
      continuationKind: 'relaunch_after_fencing',
      previousRuntimeJobId: decision.previousRuntimeJob.id,
      newRuntimeJobId: scheduled.runtimeJob.id,
      previousCapsuleDigest: this.requireRuntimeJobInputCapsuleDigest(
        decision.previousRuntimeJob,
        'Execution continuation requires previous runtime input capsule digest',
      ),
      expectedInputCapsuleDigest: this.requireString(scheduled.session.latest_capsule_digest, 'Execution continuation requires a latest capsule digest'),
      previousCodexSessionLeaseId: decision.previousCodexSessionLease.id,
      ...(decision.previousRunWorkerLease?.id === undefined ? {} : { previousRunWorkerLeaseId: decision.previousRunWorkerLease.id }),
      codexSessionTurnId: scheduled.turn.id,
      actorId: input.actor_id,
      eventPayload: {
        mode: 'relaunch_after_fencing',
        previous_runtime_job_id: decision.previousRuntimeJob.id,
        new_runtime_job_id: scheduled.runtimeJob.id,
        cancel_recovery: decision.cancelRecovery === true,
        cancel_recovery_decision: input.cancel_recovery_decision ?? null,
      },
      now: scheduled.now,
    });
    return this.continuedExecutionProjection(
      repository,
      workflow,
      scheduled.session,
      executionPackage,
      scheduled.runSession,
      scheduled.runtimeJob.id,
    );
  }

  private requireRunRuntimeMetadata(runSession: RunSession, message: string): RunRuntimeMetadata {
    if (runSession.runtime_metadata === undefined) {
      throw new DomainError('workflow_evidence_missing', message);
    }
    return runSession.runtime_metadata;
  }

  private async persistContinuationLineageAndTerminalAction(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    action: PlanItemWorkflowQueuedAction,
    input: {
      runSession: RunSession;
      continuationKind: ExecutionContinuationLineage['continuation_kind'];
      previousRuntimeJobId: string;
      newRuntimeJobId?: string;
      previousCapsuleDigest: string;
      expectedInputCapsuleDigest: string;
      previousCodexSessionLeaseId: string;
      previousRunWorkerLeaseId?: string;
      codexSessionTurnId?: string;
      actorId: string;
      eventPayload: Record<string, unknown>;
      now: string;
    },
  ): Promise<void> {
    const lineageId = stableUuid({
      schema_version: 'execution_continuation_lineage_id.v1',
      workflow_id: workflow.id,
      run_session_id: input.runSession.id,
      queued_action_id: action.id,
      continuation_kind: input.continuationKind,
      previous_runtime_job_id: input.previousRuntimeJobId,
      new_runtime_job_id: input.newRuntimeJobId ?? null,
    });
    await repository.saveExecutionContinuationLineage({
      id: lineageId,
      workflow_id: workflow.id,
      run_session_id: input.runSession.id,
      codex_session_id: session.id,
      queued_action_id: action.id,
      continuation_kind: input.continuationKind,
      previous_runtime_job_id: input.previousRuntimeJobId,
      ...(input.newRuntimeJobId === undefined ? {} : { new_runtime_job_id: input.newRuntimeJobId }),
      ...(input.codexSessionTurnId === undefined ? {} : { codex_session_turn_id: input.codexSessionTurnId }),
      previous_capsule_digest: input.previousCapsuleDigest,
      expected_input_capsule_digest: input.expectedInputCapsuleDigest,
      previous_codex_session_lease_id: input.previousCodexSessionLeaseId,
      ...(input.previousRunWorkerLeaseId === undefined ? {} : { previous_run_worker_lease_id: input.previousRunWorkerLeaseId }),
      created_by_actor_id: input.actorId,
      created_at: input.now,
    });

    if (action.status === 'running') {
      await repository.terminalizePlanItemWorkflowQueuedAction({
        workflow_id: workflow.id,
        action_id: action.id,
        status: 'succeeded',
        ...(input.codexSessionTurnId === undefined ? {} : { codex_session_turn_id: input.codexSessionTurnId }),
        now: input.now,
      });
    } else if (action.status !== 'succeeded') {
      throw new DomainError(
        'workflow_action_not_runnable',
        `workflow_action_not_runnable: Plan Item Workflow queued action ${action.id} is not running`,
      );
    }

    const eventId = stableUuid({
      schema_version: 'execution_continuation_event_id.v1',
      workflow_id: workflow.id,
      queued_action_id: action.id,
      lineage_id: lineageId,
    });
    const existingEvents = await repository.listObjectEvents(workflow.id, 'plan_item_workflow');
    if (!existingEvents.some((event) => event.id === eventId)) {
      await repository.appendObjectEvent({
        id: eventId,
        object_type: 'plan_item_workflow',
        object_id: workflow.id,
        event_type: 'workflow_execution_continued',
        actor_type: 'human',
        actor_id: input.actorId,
        payload: {
          schema_version: 'plan_item_workflow_execution_continued.v1',
          continuation_kind: input.continuationKind,
          queued_action_id: action.id,
          lineage_id: lineageId,
          run_session_id: input.runSession.id,
          ...input.eventPayload,
        },
        metadata: {
          codex_session_id: session.id,
          ...(input.codexSessionTurnId === undefined ? {} : { codex_session_turn_id: input.codexSessionTurnId }),
          previous_runtime_job_id: input.previousRuntimeJobId,
          ...(input.newRuntimeJobId === undefined ? {} : { new_runtime_job_id: input.newRuntimeJobId }),
          previous_capsule_digest: input.previousCapsuleDigest,
          expected_input_capsule_digest: input.expectedInputCapsuleDigest,
        },
        created_at: input.now,
      });
    }
  }

  private continuedExecutionProjection(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    executionPackage: ExecutionPackage,
    runSession: RunSession,
    runtimeJobId: string,
  ): Promise<PlanItemWorkflowPublicDto> {
    return this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [], {
      execution_run_summary: this.executionRunSummary({
        workflow,
        session,
        executionPackage,
        runSessionId: runSession.id,
        runtimeJobId,
        ...(runSession.codex_session_turn_id === undefined ? {} : { executionTurnId: runSession.codex_session_turn_id }),
        ...(session.latest_capsule_digest === undefined ? {} : { inputCapsuleDigest: session.latest_capsule_digest }),
        ...(runSession.runtime_metadata?.remote_workspace_bundle_digest === undefined
          ? {}
          : { workspaceBundleDigest: runSession.runtime_metadata.remote_workspace_bundle_digest }),
        ...(session.codex_thread_id_digest === undefined ? {} : { codexThreadIdDigest: session.codex_thread_id_digest }),
        status: runSession.status,
      }),
    });
  }

  private async scheduleContinuationRelaunchRuntimeJob(
    repository: DeliveryRepository,
    input: {
      workflow: PlanItemWorkflow;
      session: CodexSession;
      executionPackage: ExecutionPackage;
      action: PlanItemWorkflowQueuedAction;
      runSession: RunSession;
      previousRuntimeJob: CodexRuntimeJob;
      actorId: string;
      cancelRecovery: boolean;
    },
  ): Promise<{
      session: CodexSession;
      turn: CodexSessionTurn;
      runSession: RunSession;
      runtimeJob: CodexRuntimeJob;
      now: string;
    }> {
    const { workflow, session, executionPackage, action, runSession, previousRuntimeJob, actorId } = input;
    if (previousRuntimeJob.status !== 'terminal') {
      throw new DomainError('workflow_execution_writer_still_active', 'Execution continuation relaunch requires terminal previous runtime job');
    }
    const now = this.now();
    const inputCapsule = await this.requireLatestExecutionInputCapsule(repository, session);
    const inputContinuity = this.requireExecutionInputContinuity(session);
    const runtimeBinding = await this.resolveActiveExecutionRuntimeBinding(repository, executionPackage, now);
    const runtimeExpiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
    const workerSessionDigest = await repository.getCodexWorkerSessionDigest(runtimeBinding.worker.id);
    if (workerSessionDigest === undefined) {
      throw new DomainError('workflow_runtime_binding_unavailable', 'Execution worker session digest is unavailable');
    }
    const executionTurn = await this.createWorkflowChildTurn(
      repository,
      workflow,
      session,
      actorId,
      'continue_execution',
      `continue-execution:${runSession.id}:${action.id}`,
    );
    const sessionWithTurn = (await repository.getCodexSession(session.id)) ?? session;
    const runtimeJobId = randomUUID();
    const launchLeaseId = randomUUID();
    const envelopeId = randomUUID();
    const leaseToken = `codex-session-execution-continuation:${randomUUID()}`;
    const runWorkerLeaseToken = `run-worker-execution-continuation:${randomUUID()}`;
    const runSpec = buildRunSpec(await loadRunContext(repository, runSession.id), {
      defaultExecutorType: 'local_codex',
      workflowOnly: false,
    });
    const workflowExecutionPayload = this.workflowExecutionPayload(executionPackage, this.workflowExecutionRemoteRunSpec(runSpec));
    const workspaceBundle = this.workflowExecutionWorkspaceBundle(now, workflowExecutionPayload);
    const resumedRunSession = transitionRunSession(runSession, { type: 'resume_requested', at: now });
    const runtimeMetadata = this.requireRunRuntimeMetadata(runSession, 'Execution continuation relaunch requires runtime metadata');
    const runSessionWithRuntime: RunSession = {
      ...resumedRunSession,
      codex_session_id: session.id,
      codex_session_turn_id: executionTurn.id,
      executor_type: 'local_codex',
      run_spec: runSpec,
      runtime_metadata: {
        ...runtimeMetadata,
        driver_kind: 'app_server',
        driver_status: 'not_started',
        recovery_attempt_count: runtimeMetadata.recovery_attempt_count + 1,
        effective_dangerous_mode: 'confirmed',
        runtime_profile_id: runtimeBinding.runtime_profile_id,
        runtime_profile_revision_id: runtimeBinding.runtime_profile_revision_id,
        runtime_profile_digest: runtimeBinding.runtime_profile_digest,
        runtime_target_kind: 'run_execution',
        source_access_mode: 'path_policy_scoped',
        environment: runtimeBinding.environment,
        credential_binding_id: runtimeBinding.credential_binding_id,
        credential_binding_version_id: runtimeBinding.credential_binding_version_id,
        credential_payload_digest: runtimeBinding.credential_payload_digest,
        launch_lease_id: launchLeaseId,
        docker_image_digest: runtimeBinding.docker_image_digest,
        network_policy_digest: runtimeBinding.network_policy_digest,
        ...(runtimeBinding.network_provider_config_digest === undefined
          ? {}
          : { network_provider_config_digest: runtimeBinding.network_provider_config_digest }),
        remote_runtime_job_id: runtimeJobId,
        remote_runtime_job_created: true,
        remote_workspace_bundle_digest: workspaceBundle.archive_digest,
        remote_workspace_manifest_digest: workspaceBundle.manifest_digest,
        remote_workspace_bundle_size_bytes: workspaceBundle.bytes.byteLength,
        remote_workspace_bundle_expires_at: runtimeExpiresAt,
      },
    };
    await repository.saveRunSession(runSessionWithRuntime);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: runtimeBinding.worker.id,
      lease_token: runWorkerLeaseToken,
      now,
      expires_at: runtimeExpiresAt,
    });
    const codexLease = await repository.claimCodexSessionLease({
      session_id: session.id,
      workflow_id: workflow.id,
      lease_id: randomUUID(),
      lease_token_hash: codexCredentialPayloadDigest(leaseToken),
      worker_id: runtimeBinding.worker.id,
      worker_session_digest: workerSessionDigest,
      expected_input_capsule_digest: inputCapsule.digest,
      input_capsule_id: inputCapsule.id,
      input_capsule_digest: inputCapsule.digest,
      ...(session.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: session.base_memory_bundle_ref }),
      ...(session.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: session.base_memory_bundle_digest }),
      ...inputContinuity,
      now,
      expires_at: runtimeExpiresAt,
    });
    const pendingWorkspaceBundleRef = `artifact://internal/workspace_bundle/run_session/${runSession.id}/${workspaceBundle.id}`;
    const workspaceAcquisition = {
      schema_version: 'workspace_bundle_acquisition.v1' as const,
      bundle_id: workspaceBundle.id,
      archive_ref: pendingWorkspaceBundleRef,
      archive_digest: workspaceBundle.archive_digest,
      manifest_digest: workspaceBundle.manifest_digest,
      size_bytes: workspaceBundle.bytes.byteLength,
      expires_at: runtimeExpiresAt,
    };
    const workspaceAcquisitionDigest = this.requireString(
      codexWorkspaceAcquisitionDigest(workspaceAcquisition),
      'Workspace acquisition digest missing',
    );
    const workload: CodexRunExecutionWorkloadV1 = validateCodexRunExecutionWorkload({
      schema_version: 'codex_run_execution_workload.v1',
      runtime_job_id: runtimeJobId,
      plan_item_workflow_id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
      workspace_bundle_id: workspaceBundle.id,
      workspace_bundle_digest: workspaceBundle.archive_digest,
      package_prompt_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/package-prompt`,
      package_prompt_digest: codexCanonicalDigest(workflowExecutionPayload.packagePrompt),
      execution_context_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/execution-context`,
      execution_context_digest: codexCanonicalDigest(workflowExecutionPayload.executionContext),
      path_policy_digest: codexCanonicalDigest({
        allowed_paths: executionPackage.allowed_paths,
        forbidden_paths: executionPackage.forbidden_paths,
        source_mutation_policy: executionPackage.source_mutation_policy,
      }),
      required_checks_digest: codexCanonicalDigest(executionPackage.required_checks),
      output_schema_version: 'codex_run_execution_result.v1',
      created_at: now,
      expires_at: runtimeExpiresAt,
      workspace_acquisition_json: workspaceAcquisition,
      codex_session_runtime_context: {
        schema_version: 'codex_session_runtime_context.v1',
        codex_session_id: session.id,
        codex_session_turn_id: executionTurn.id,
        lease_id: launchLeaseId,
        lease_epoch: codexLease.lease.lease_epoch,
        worker_id: runtimeBinding.worker.id,
        worker_session_digest: workerSessionDigest,
        expected_input_capsule_digest: inputCapsule.digest,
        turn_group_status: 'complete',
        continuation: {
          kind: 'resume_thread',
          codex_thread_id: this.requireString(session.codex_thread_id, 'Execution continuation requires a Codex thread id'),
          codex_thread_id_digest: this.requireString(
            session.codex_thread_id_digest,
            'Execution continuation requires a Codex thread id digest',
          ),
        },
      },
      codex_session_terminalization: {
        schema_version: 'codex_session_terminalization.v1',
        lease_token: leaseToken,
        codex_session_lease_id: codexLease.lease.id,
        codex_session_lease_epoch: codexLease.lease.lease_epoch,
        codex_session_worker_id: runtimeBinding.worker.id,
        codex_session_worker_session_digest: workerSessionDigest,
        codex_session_id: session.id,
        codex_session_turn_id: executionTurn.id,
        expected_input_capsule_digest: inputCapsule.digest,
        input_capsule_id: inputCapsule.id,
        input_capsule_ref: inputCapsule.artifact_ref,
        input_capsule_digest: inputCapsule.digest,
        ...(session.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: session.base_memory_bundle_ref }),
        ...(session.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: session.base_memory_bundle_digest }),
        ...inputContinuity,
      },
    });
    const workspaceBundleArtifact = await new LocalInternalArtifactStore({
      root: this.internalArtifactStoreRoot,
      repository,
      requestId: `plan-item-workflow-execution-continuation-${workflow.id}`,
    }).putObject({
      artifact_id: workspaceBundle.id,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: runSession.id,
      visibility: 'internal',
      content_type: 'application/vnd.forgeloop.workspace-bundle',
      declared_size_bytes: String(workspaceBundle.bytes.byteLength),
      declared_artifact_digest: workspaceBundle.archive_digest,
      idempotency_key: workspaceBundle.id,
      metadata_json: {
        manifest_digest: workspaceBundle.manifest_digest,
        execution_package_id: executionPackage.id,
        run_worker_lease_id: runWorkerLease.id,
        workspace_acquisition_digest: workspaceAcquisitionDigest,
        previous_runtime_job_id: previousRuntimeJob.id,
        continuation_action_id: action.id,
        cancel_recovery: input.cancelRecovery,
      },
      created_by_actor_type: 'system',
      created_by_actor_id: actorId,
      now,
      max_size_bytes: 100 * 1024 * 1024,
      bytes: workspaceBundle.bytes,
    });
    const pendingWorkspaceBundle = {
      id: randomUUID(),
      bundle_id: workspaceBundle.id,
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      pending_artifact_ref: pendingWorkspaceBundleRef,
      internal_artifact_object_id: workspaceBundleArtifact.id,
      archive_digest: workspaceBundle.archive_digest,
      manifest_digest: workspaceBundle.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: workspaceBundle.bytes.byteLength,
      workspace_acquisition_digest: workspaceAcquisitionDigest,
      workspace_acquisition_json: workspaceAcquisition,
      expires_at: runtimeExpiresAt,
      request_digest: codexCanonicalDigest({
        runtime_job_id: runtimeJobId,
        workspace_bundle_id: workspaceBundle.id,
        archive_digest: workspaceBundle.archive_digest,
        internal_artifact_object_id: workspaceBundleArtifact.id,
      }),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingWorkspaceBundle);
    const runtimeJobResult = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
      runtime_job_id: runtimeJobId,
      launch_lease_id: launchLeaseId,
      envelope_id: envelopeId,
      job_request_id: codexCanonicalDigest({
        kind: 'plan_item_workflow_execution_continue',
        workflow_id: workflow.id,
        run_session_id: runSession.id,
        queued_action_id: action.id,
        previous_runtime_job_id: previousRuntimeJob.id,
      }),
      target: {
        target_type: 'run_session',
        target_id: runSession.id,
        target_kind: 'run_execution',
        project_id: executionPackage.project_id,
        repo_id: executionPackage.repo_id,
      },
      launch_attempt: previousRuntimeJob.launch_attempt + 1,
      worker_id: runtimeBinding.worker.id,
      runtime_profile_revision_id: runtimeBinding.runtime_profile_revision_id,
      runtime_profile_digest: runtimeBinding.runtime_profile_digest,
      credential_binding_id: runtimeBinding.credential_binding_id,
      credential_binding_version_id: runtimeBinding.credential_binding_version_id,
      credential_payload_digest: runtimeBinding.credential_payload_digest,
      docker_image_digest: runtimeBinding.docker_image_digest,
      network_policy_digest: runtimeBinding.network_policy_digest,
      ...(runtimeBinding.network_provider_config_digest === undefined
        ? {}
        : { network_provider_config_digest: runtimeBinding.network_provider_config_digest }),
      input_json: workload as unknown as Record<string, unknown>,
      input_digest: codexRuntimeJobInputDigest(workload),
      workspace_acquisition_json: workspaceAcquisition,
      workspace_acquisition_digest: workspaceAcquisitionDigest,
      pending_workspace_bundle: pendingWorkspaceBundle,
      execution_package_id: executionPackage.id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token_hash: codexCredentialPayloadDigest(runWorkerLeaseToken),
      run_session_status: runSessionWithRuntime.status,
      run_session_updated_at: runSessionWithRuntime.updated_at,
      execution_package_version: executionPackage.version,
      workflow_id: workflow.id,
      codex_session_id: session.id,
      codex_session_turn_id: executionTurn.id,
      expires_at: runtimeExpiresAt,
      now,
    });
    const persistedRunSession = this.requireFound(await repository.getRunSession(runSession.id), `RunSession ${runSession.id}`);
    return {
      session: (await repository.getCodexSession(session.id)) ?? codexLease.session ?? sessionWithTurn,
      turn: executionTurn,
      runSession: persistedRunSession,
      runtimeJob: runtimeJobResult.runtime_job,
      now,
    };
  }

  private async requireExistingExecutionRunSummary(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
  ): Promise<PlanItemWorkflowExecutionRunSummary> {
    const executionPackageId = this.requireString(workflow.execution_package_id, 'Workflow execution package is missing');
    const executionPackage = this.requireFound(
      await repository.getExecutionPackage(executionPackageId),
      `ExecutionPackage ${executionPackageId}`,
    );
    const runSession = await repository.findActiveRunSessionForPackage(executionPackage.id);
    const runtimeJobId =
      runSession === undefined
        ? undefined
        : this.requireString(runSession.runtime_metadata?.remote_runtime_job_id, 'Workflow execution runtime job is missing');
    const runtimeJob =
      runtimeJobId === undefined ? undefined : await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
    if (
      runSession === undefined ||
      runtimeJob === undefined ||
      !this.workflowExecutionRuntimeLineageMatches({ workflow, session, executionPackage, runSession, runtimeJob })
    ) {
      throw new DomainError('workflow_execution_recovery_required', 'Workflow execution lineage is incomplete');
    }
    const existingRuntimeJobId = this.requireString(runtimeJobId, 'Workflow execution runtime job is missing');
    const executionTurnId = this.requireString(runSession.codex_session_turn_id, 'Workflow execution turn is missing');
    const inputCapsuleDigest = this.requireString(session.latest_capsule_digest, 'Workflow execution capsule digest is missing');
    const workspaceBundleDigest = this.requireString(
      runSession.runtime_metadata?.remote_workspace_bundle_digest,
      'Workflow execution workspace bundle digest is missing',
    );
    const codexThreadIdDigest = this.requireString(session.codex_thread_id_digest, 'Workflow execution thread digest is missing');
    return this.executionRunSummary({
      workflow,
      session,
      executionPackage,
      runSessionId: runSession.id,
      runtimeJobId: existingRuntimeJobId,
      executionTurnId,
      inputCapsuleDigest,
      workspaceBundleDigest,
      codexThreadIdDigest,
      status: runSession.status,
    });
  }

  private async requireWorkflowExecutionPackageReady(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
  ): Promise<ExecutionPackage> {
    const executionPackageId = this.requireString(workflow.execution_package_id, 'Execution readiness has no Execution Package');
    const executionPackage = await repository.getExecutionPackage(executionPackageId);
    if (
      executionPackage === undefined ||
      executionPackage.workflow_id !== workflow.id ||
      executionPackage.development_plan_item_id !== workflow.development_plan_item_id ||
      executionPackage.codex_session_id !== session.id ||
      executionPackage.spec_revision_id !== workflow.active_spec_doc_revision_id ||
      executionPackage.plan_revision_id !== workflow.active_implementation_plan_doc_revision_id ||
      executionPackage.execution_plan_id === undefined ||
      executionPackage.execution_plan_revision_id !== workflow.active_implementation_plan_doc_revision_id ||
      executionPackage.activity_state !== 'idle' ||
      executionPackage.gate_state !== 'not_submitted' ||
      executionPackage.current_run_session_id !== undefined ||
      executionPackage.last_run_session_id !== undefined ||
      executionPackage.deleted_at !== undefined ||
      (executionPackage.phase !== 'draft' && executionPackage.phase !== 'ready')
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution Package is not reusable for this workflow execution');
    }
    return executionPackage;
  }

  private workflowExecutionRuntimeLineageMatches(input: {
    workflow: PlanItemWorkflow;
    session: CodexSession;
    executionPackage: ExecutionPackage;
    runSession: RunSession;
    runtimeJob: CodexRuntimeJob;
  }): boolean {
    const { workflow, session, executionPackage, runSession, runtimeJob } = input;
    if (
      runtimeJob.status === 'terminal' ||
      runSession.execution_package_id !== executionPackage.id ||
      runSession.workflow_id !== workflow.id ||
      runSession.codex_session_id !== session.id ||
      runSession.codex_session_turn_id === undefined ||
      runtimeJob.target_type !== 'run_session' ||
      runtimeJob.target_id !== runSession.id ||
      runtimeJob.target_kind !== 'run_execution' ||
      runtimeJob.workflow_id !== workflow.id ||
      runtimeJob.codex_session_id !== session.id ||
      runtimeJob.codex_session_turn_id !== runSession.codex_session_turn_id ||
      runtimeJob.repo_id !== executionPackage.repo_id
    ) {
      return false;
    }
    let workload: ReturnType<typeof validateCodexRunExecutionWorkload>;
    try {
      workload = validateCodexRunExecutionWorkload(runtimeJob.input_json);
    } catch {
      return false;
    }
    return (
      runtimeJob.input_digest === codexRuntimeJobInputDigest(workload) &&
      workload.runtime_job_id === runtimeJob.id &&
      workload.plan_item_workflow_id === workflow.id &&
      workload.development_plan_id === workflow.development_plan_id &&
      workload.development_plan_item_id === workflow.development_plan_item_id &&
      workload.run_session_id === runSession.id &&
      workload.execution_package_id === executionPackage.id &&
      workload.execution_package_version === executionPackage.version &&
      workload.workspace_bundle_digest === runSession.runtime_metadata?.remote_workspace_bundle_digest &&
      workload.codex_session_runtime_context.codex_session_id === session.id &&
      workload.codex_session_runtime_context.codex_session_turn_id === runSession.codex_session_turn_id &&
      workload.codex_session_runtime_context.expected_input_capsule_digest === session.latest_capsule_digest &&
      workload.codex_session_runtime_context.continuation.codex_thread_id_digest === session.codex_thread_id_digest &&
      workload.codex_session_terminalization.codex_session_id === session.id &&
      workload.codex_session_terminalization.codex_session_turn_id === runSession.codex_session_turn_id &&
      workload.codex_session_terminalization.input_capsule_digest === session.latest_capsule_digest &&
      workload.codex_session_terminalization.input_memory_bundle_digest === session.latest_memory_bundle_digest &&
      workload.codex_session_terminalization.input_environment_manifest_digest === session.latest_environment_manifest_digest
    );
  }

  private async requireCurrentPlanItemRevisionForExecutionStart(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    item: DevelopmentPlanItem,
    executionPackage: ExecutionPackage,
    readiness: ExecutionReadinessRecord,
  ): Promise<ExecutionPlanRevision> {
    const implementationPlanRevisionId = this.requireString(
      workflow.active_implementation_plan_doc_revision_id,
      'Execution start requires an active Implementation Plan revision',
    );
    const implementationPlanRevision = await repository.getExecutionPlanRevision(implementationPlanRevisionId);
    const boundaryRevisionId = this.requireString(
      workflow.active_boundary_summary_revision_id,
      'Execution start requires an active Boundary Summary revision',
    );
    const specRevisionId = this.requireString(workflow.active_spec_doc_revision_id, 'Execution start requires an active Spec revision');
    const boundaryRevision = await repository.getBoundarySummaryRevisionById(boundaryRevisionId);
    const specRevision = await repository.getSpecRevision(specRevisionId);
    if (!this.isOwnedDocumentRevision(workflow, boundaryRevision) || !this.isOwnedDocumentRevision(workflow, specRevision)) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution start document revisions do not belong to this workflow/session');
    }
    if (!this.isOwnedExecutionPlanRevision(workflow, implementationPlanRevision)) {
      throw new DomainError(
        'workflow_evidence_not_owned',
        'Execution start Implementation Plan revision does not belong to this workflow/session',
      );
    }
    if (
      executionPackage.execution_plan_id !== implementationPlanRevision.execution_plan_id ||
      executionPackage.execution_plan_revision_id !== implementationPlanRevision.id ||
      executionPackage.plan_revision_id !== implementationPlanRevision.id
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution Package Implementation Plan linkage is stale');
    }
    if (
      !(await this.artifactsMatchCurrentPlanItemPlanningContent(repository, item, [
        boundaryRevision.development_plan_item_revision_id,
        specRevision.development_plan_item_revision_id,
        implementationPlanRevision.development_plan_item_revision_id,
      ]))
    ) {
      throw new DomainError('workflow_execution_readiness_blocked', 'Execution start requires current Plan Item revision evidence', {
        blocker_codes: ['development_plan_item_revision_not_current'],
      });
    }
    const metadata = this.requireWorkflowExecutionPackageReadinessMetadata(executionPackage);
    const currentPackagePolicyDigest = this.workflowExecutionPackagePolicyDigestFromPackage({
      workflow,
      item,
      executionPackage,
      metadata,
    });
    const planItemPlanningDigest = this.planItemPlanningContentDigest(item);
    if (
      metadata.readiness_record_id !== readiness.id ||
      metadata.plan_item_planning_digest !== planItemPlanningDigest ||
      metadata.boundary_summary_revision_id !== workflow.active_boundary_summary_revision_id ||
      metadata.spec_revision_id !== workflow.active_spec_doc_revision_id ||
      metadata.implementation_plan_revision_id !== implementationPlanRevision.id ||
      metadata.implementation_plan_turn_id !== implementationPlanRevision.codex_session_turn_id ||
      currentPackagePolicyDigest !== executionPackage.manifest_digest ||
      metadata.package_policy_digest !== executionPackage.manifest_digest ||
      metadata.workspace_policy_digest !== this.workflowExecutionWorkspacePolicyDigest(metadata.package_policy_digest)
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution Package readiness metadata is stale');
    }
    await this.requireImplementationPlanProvenanceTurn(repository, workflow, session.id, implementationPlanRevision);
    return implementationPlanRevision;
  }

  private async requireCurrentExecutionReadinessRecord(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    executionPackage: ExecutionPackage,
  ): Promise<ExecutionReadinessRecord> {
    const transitions = await repository.listPlanItemWorkflowTransitions(workflow.id);
    const transition = transitions
      .slice()
      .reverse()
      .find(
        (candidate) =>
          candidate.to_status === 'execution_ready' && candidate.evidence_object_type === 'execution_readiness_record',
      );
    const record =
      transition === undefined ? undefined : await repository.getExecutionReadinessRecord(transition.evidence_object_id);
    if (
      record === undefined ||
      record.invalidated_at !== undefined ||
      record.workflow_id !== workflow.id ||
      record.codex_session_id !== workflow.active_codex_session_id ||
      record.readiness_state !== 'ready' ||
      record.approved_boundary_summary_revision_id !== workflow.active_boundary_summary_revision_id ||
      record.approved_spec_revision_id !== workflow.active_spec_doc_revision_id ||
      record.approved_implementation_plan_revision_id !== workflow.active_implementation_plan_doc_revision_id ||
      !record.supporting_evidence.some(
        (evidence) => evidence.object_type === 'execution_package' && evidence.object_id === executionPackage.id,
      )
    ) {
      throw new DomainError('workflow_execution_readiness_blocked', 'Execution readiness record is stale');
    }
    return record;
  }

  private async requireLatestExecutionInputCapsule(repository: DeliveryRepository, session: CodexSession) {
    const capsuleId = this.requireString(session.latest_capsule_id, 'Execution start requires a latest Codex capsule');
    const capsuleDigest = this.requireString(session.latest_capsule_digest, 'Execution start requires a latest Codex capsule digest');
    const capsule = await repository.getCodexRuntimeCapsule(capsuleId);
    if (
      capsule === undefined ||
      capsule.codex_session_id !== session.id ||
      capsule.digest !== capsuleDigest ||
      capsule.codex_thread_id_digest !== session.codex_thread_id_digest
    ) {
      throw new DomainError('codex_runtime_capsule_stale', 'Execution input capsule is stale');
    }
    return capsule;
  }

  private async requireLatestExecutionContinuationInputs(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
  ): Promise<{
    inputCapsule: CodexRuntimeCapsule;
    inputContinuity: WorkflowExecutionInputContinuity;
  }> {
    const inputCapsule = await this.requireLatestExecutionInputCapsule(repository, session);
    const inputContinuity = this.requireExecutionInputContinuity(session);
    const producerTurn = await repository.getCodexSessionTurn(inputCapsule.created_from_turn_id);
    if (
      producerTurn === undefined ||
      producerTurn.workflow_id !== workflow.id ||
      producerTurn.codex_session_id !== session.id ||
      producerTurn.status !== 'succeeded' ||
      producerTurn.output_capsule_id !== inputCapsule.id ||
      producerTurn.output_capsule_digest !== inputCapsule.digest ||
      producerTurn.output_memory_bundle_ref !== inputContinuity.input_memory_bundle_ref ||
      producerTurn.output_memory_bundle_digest !== inputContinuity.input_memory_bundle_digest ||
      producerTurn.output_environment_manifest_ref !== inputContinuity.input_environment_manifest_ref ||
      producerTurn.output_environment_manifest_digest !== inputContinuity.input_environment_manifest_digest
    ) {
      throw new DomainError('codex_runtime_capsule_stale', 'Execution input capsule lineage is stale');
    }
    return { inputCapsule, inputContinuity };
  }

  private async resolveActiveExecutionRuntimeBinding(
    repository: DeliveryRepository,
    executionPackage: ExecutionPackage,
    now: string,
  ): Promise<StartWorkflowExecutionRuntimeBinding> {
    const profileRevision = await repository.getActiveCodexRuntimeProfileRevision({
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      target_kind: 'run_execution',
      now,
    });
    if (profileRevision === undefined) {
      throw new DomainError('workflow_runtime_binding_unavailable', 'Active run execution runtime profile is unavailable');
    }
    const candidates = await repository.listCodexCredentialBindingReadinessCandidates({
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      runtime_profile_id: profileRevision.profile_id,
      target_kind: 'run_execution',
      now,
    });
    const candidate = this.selectRunExecutionModelCredentialBinding(candidates, executionPackage.repo_id);
    const credential = await repository.resolveCodexCredentialForLaunch({
      credential_binding_id: candidate.id,
      target_kind: 'run_execution',
      runtime_profile_id: profileRevision.profile_id,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      now,
    });
    if (credential === undefined) {
      throw new DomainError('workflow_runtime_binding_unavailable', 'Run execution credential binding is unavailable');
    }
    const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(profileRevision.network_policy);
    const providerConfigDigest = runtimeNetworkProviderConfigDigest(profileRevision);
    const worker = await repository.findAvailableCodexWorker({
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      target_kind: 'run_execution',
      docker_image_digest: profileRevision.docker_image_digest,
      network_policy_digest: networkPolicyDigest,
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      now,
    });
    if (worker === undefined) {
      throw new DomainError('workflow_runtime_binding_unavailable', 'Run execution worker is unavailable');
    }
    return {
      runtime_profile_id: profileRevision.profile_id,
      runtime_profile_revision_id: profileRevision.id,
      runtime_profile_digest: profileRevision.profile_digest,
      environment: profileRevision.environment,
      credential_binding_id: credential.binding_id,
      credential_binding_version_id: credential.binding_version_id,
      credential_payload_digest: credential.payload_digest,
      docker_image_digest: profileRevision.docker_image_digest,
      network_policy_digest: networkPolicyDigest,
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      worker,
    };
  }

  private selectRunExecutionModelCredentialBinding(
    candidates: readonly { id: string; purpose: string; repo_id?: string }[],
    repoId: string,
  ): { id: string } {
    const modelProviderCandidates = candidates.filter((value) => value.purpose === 'model_provider');
    const repoScopedCandidates = modelProviderCandidates.filter((value) => value.repo_id === repoId);
    const projectScopedCandidates = modelProviderCandidates.filter((value) => value.repo_id === undefined);
    const selectedPool = repoScopedCandidates.length > 0 ? repoScopedCandidates : projectScopedCandidates;
    if (selectedPool.length !== 1) {
      throw new DomainError('workflow_runtime_binding_unavailable', 'Run execution credential binding is unavailable');
    }
    return selectedPool[0]!;
  }

  private workflowExecutionRemoteRunSpec(runSpec: RunSpec): RunSpec {
    return {
      ...runSpec,
      repo: {
        ...runSpec.repo,
        local_path: '/workspace',
      },
    };
  }

  private workflowExecutionPayload(executionPackage: ExecutionPackage, remoteRunSpec: RunSpec): WorkflowExecutionPayload {
    const packagePrompt = [
      `Objective: ${executionPackage.objective}`,
      '',
      `Package instructions: ${remoteRunSpec.context.package_instructions}`,
    ].join('\n');

    return {
      packagePrompt,
      executionContext: {
        schema_version: 'codex_run_execution_context.v1',
        run_spec: remoteRunSpec,
      },
    };
  }

  private workflowExecutionWorkspaceBundle(
    now: string,
    payload: WorkflowExecutionPayload,
  ): { id: string; bytes: Buffer; archive_digest: string; manifest_digest: string } {
    const id = randomUUID();
    const files = [
      {
        path: '.forgeloop/codex-runtime/package-prompt.txt',
        content: payload.packagePrompt,
      },
      {
        path: '.forgeloop/codex-runtime/execution-context.json',
        content: JSON.stringify(payload.executionContext),
      },
    ];
    const manifest = createWorkspaceBundleManifest({
      bundleId: id,
      createdAt: now,
      allowedPaths: ['**'],
      forbiddenPaths: ['.git/**', 'node_modules/**'],
      files,
    });
    const bytes = createWorkspaceBundleArchive({ manifest, files });
    return {
      id,
      bytes,
      archive_digest: workspaceBundleArchiveDigest(bytes),
      manifest_digest: workspaceBundleManifestDigest(manifest),
    };
  }

  private requireExecutionInputContinuity(session: CodexSession): WorkflowExecutionInputContinuity {
    return {
      input_memory_bundle_ref: this.requireSessionArtifactRef(
        session.latest_memory_bundle_ref,
        'Execution start requires a latest Codex memory bundle',
      ),
      input_memory_bundle_digest: this.requireSha256Digest(
        session.latest_memory_bundle_digest,
        'Execution start requires a latest Codex memory bundle digest',
      ),
      input_environment_manifest_ref: this.requireSessionArtifactRef(
        session.latest_environment_manifest_ref,
        'Execution start requires a latest Codex environment manifest',
      ),
      input_environment_manifest_digest: this.requireSha256Digest(
        session.latest_environment_manifest_digest,
        'Execution start requires a latest Codex environment manifest digest',
      ),
    };
  }

  private workflowExecutionStartPrecondition(input: {
    workflow: PlanItemWorkflow;
    item: DevelopmentPlanItem;
    readiness: ExecutionReadinessRecord;
    executionPackage: ExecutionPackage;
    session: CodexSession;
    inputCapsuleDigest: string;
    inputContinuity: WorkflowExecutionInputContinuity;
    runtimeBinding: StartWorkflowExecutionRuntimeBinding;
    workerSessionDigest: string;
  }): Record<string, unknown> {
    return {
      schema_version: 'plan_item_workflow_execution_start_precondition.v1',
      workflow_id: input.workflow.id,
      workflow_status: input.workflow.status,
      development_plan_id: input.workflow.development_plan_id,
      development_plan_item_id: input.workflow.development_plan_item_id,
      plan_item_planning_digest: this.planItemPlanningContentDigest(input.item),
      readiness_record_id: input.readiness.id,
      approved_boundary_summary_revision_id: input.workflow.active_boundary_summary_revision_id,
      approved_spec_revision_id: input.workflow.active_spec_doc_revision_id,
      approved_implementation_plan_revision_id: input.workflow.active_implementation_plan_doc_revision_id,
      execution_package_id: input.executionPackage.id,
      execution_package_version: input.executionPackage.version,
      execution_package_policy_digest: input.executionPackage.manifest_digest,
      codex_session_id: input.session.id,
      input_capsule_digest: input.inputCapsuleDigest,
      input_memory_bundle_digest: input.inputContinuity.input_memory_bundle_digest,
      input_environment_manifest_digest: input.inputContinuity.input_environment_manifest_digest,
      codex_thread_id_digest: input.session.codex_thread_id_digest,
      runtime_profile_revision_id: input.runtimeBinding.runtime_profile_revision_id,
      runtime_profile_digest: input.runtimeBinding.runtime_profile_digest,
      runtime_environment: input.runtimeBinding.environment,
      credential_binding_id: input.runtimeBinding.credential_binding_id,
      credential_binding_version_id: input.runtimeBinding.credential_binding_version_id,
      credential_payload_digest: input.runtimeBinding.credential_payload_digest,
      worker_id: input.runtimeBinding.worker.id,
      worker_session_digest: input.workerSessionDigest,
    };
  }

  private requireSessionArtifactRef(value: string | undefined, message: string): string {
    const ref = this.requireString(value, message);
    if (!ref.startsWith('artifact://')) {
      throw new DomainError('workflow_evidence_missing', message);
    }
    return ref;
  }

  private requireSha256Digest(value: string | undefined, message: string): string {
    const digest = this.requireString(value, message);
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new DomainError('workflow_evidence_missing', message);
    }
    return digest;
  }

  private requireWorkflowExecutionPackageReadinessMetadata(executionPackage: ExecutionPackage): {
    readiness_record_id: string;
    plan_item_revision_id: string;
    plan_item_planning_digest: string;
    boundary_summary_revision_id: string;
    spec_revision_id: string;
    implementation_plan_revision_id: string;
    implementation_plan_turn_id: string;
    package_policy_digest: string;
    workspace_policy_digest: string;
  } {
    const metadata = executionPackage.integration_readiness;
    if (metadata === undefined) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution Package readiness metadata is missing');
    }
    const requireMetadataString = (key: string): string => {
      const value = metadata[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new DomainError('workflow_evidence_not_owned', 'Execution Package readiness metadata is incomplete');
      }
      return value;
    };
    const implementationPlanTurnId = requireMetadataString('implementation_plan_turn_id');
    return {
      readiness_record_id: requireMetadataString('readiness_record_id'),
      plan_item_revision_id: requireMetadataString('plan_item_revision_id'),
      plan_item_planning_digest: requireMetadataString('plan_item_planning_digest'),
      boundary_summary_revision_id: requireMetadataString('boundary_summary_revision_id'),
      spec_revision_id: requireMetadataString('spec_revision_id'),
      implementation_plan_revision_id: requireMetadataString('implementation_plan_revision_id'),
      implementation_plan_turn_id: implementationPlanTurnId,
      package_policy_digest: requireMetadataString('package_policy_digest'),
      workspace_policy_digest: requireMetadataString('workspace_policy_digest'),
    };
  }

  private async requireImplementationPlanProvenanceTurn(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    codexSessionId: string,
    implementationPlanRevision: ExecutionPlanRevision,
  ): Promise<string> {
    const turnId = implementationPlanRevision.codex_session_turn_id;
    if (turnId === undefined || turnId.trim().length === 0) {
      throw new DomainError(
        'workflow_evidence_not_owned',
        'Execution Package requires immutable Implementation Plan Codex turn provenance',
      );
    }
    const turn = await repository.getCodexSessionTurn(turnId);
    if (
      turn === undefined ||
      turn.workflow_id !== workflow.id ||
      turn.codex_session_id !== codexSessionId ||
      turn.output_object_type !== 'implementation_plan_revision' ||
      turn.output_object_id !== implementationPlanRevision.id
    ) {
      throw new DomainError(
        'workflow_evidence_not_owned',
        'Execution Package Implementation Plan Codex turn provenance does not belong to this workflow',
      );
    }
    return turnId;
  }

  private async writeWorkflowExecutionStartAudit(
    repository: DeliveryRepository,
    lineage: WorkflowExecutionStartLineage,
    actorId: string,
    readinessRecordId: string,
    now: string,
  ): Promise<void> {
    await repository.saveTraceEvent({
      id: randomUUID(),
      event_type: 'workflow_execution_started',
      subject_type: 'plan_item_workflow',
      subject_id: lineage.workflow.id,
      actor_id: actorId,
      summary: 'Workflow execution start accepted.',
      payload: {
        workflow_id: lineage.workflow.id,
        plan_item_id: lineage.workflow.development_plan_item_id,
        development_plan_id: lineage.workflow.development_plan_id,
        execution_package_id: lineage.executionPackage.id,
        execution_package_version: lineage.executionPackage.version,
        readiness_record_id: readinessRecordId,
        codex_session_id: lineage.session.id,
        ...(lineage.executionTurnId === undefined ? {} : { codex_session_turn_id: lineage.executionTurnId }),
        run_session_id: lineage.runSessionId,
        ...(lineage.runtimeJobId === undefined ? {} : { runtime_job_id: lineage.runtimeJobId }),
        repo_binding_id: lineage.repoBindingId ?? lineage.executionPackage.repo_id,
        credential_binding_id: this.requireString(lineage.credentialBindingId, 'Execution runtime credential binding is missing'),
        credential_binding_version_id: this.requireString(
          lineage.credentialBindingVersionId,
          'Execution runtime credential binding version is missing',
        ),
        ...(lineage.workspaceBundleDigest === undefined ? {} : { workspace_bundle_digest: lineage.workspaceBundleDigest }),
        input_capsule_digest: lineage.inputCapsuleDigest,
        codex_thread_id_digest: lineage.codexThreadIdDigest,
      },
      created_at: now,
    });
  }

  private executionRunSummary(input: WorkflowExecutionStartLineage): PlanItemWorkflowExecutionRunSummary {
    return {
      run_session_id: input.runSessionId,
      status: input.status,
      execution_package_version: input.executionPackage.version,
      ...(input.inputCapsuleDigest === undefined ? {} : { input_capsule_digest: input.inputCapsuleDigest }),
      ...(input.workspaceBundleDigest === undefined ? {} : { workspace_bundle_digest: input.workspaceBundleDigest }),
      ...(input.codexThreadIdDigest === undefined ? {} : { codex_thread_id_digest: input.codexThreadIdDigest }),
      updated_at: input.workflow.updated_at,
    };
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
        return this.toPublicWorkflowDtoWithRepository(repository, updated, session, [queuedAction]);
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
        return this.toPublicWorkflowDtoWithRepository(repository, updated, session, [queuedAction]);
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
        return this.toPublicWorkflowDtoWithRepository(repository, workflow, session, [], {
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
        await this.validateChangeRequestRevision(repository, workflow, artifactType, revisionId);
        await this.assertNoConflictingWorkflowActionsForChangeRequest(repository, workflow.id, artifactType);
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
        await repository.invalidateExecutionReadinessRecordsForWorkflow({
          workflow_id: workflow.id,
          reason: 'artifact_change_requested',
          now: this.now(),
        });
        await this.archiveExecutionReadyPackageEvidenceForChangeRequest(repository, workflow);
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
        return this.toPublicWorkflowDtoWithRepository(repository, updated, session, [queuedAction]);
      }),
    );
  }

  private async archiveExecutionReadyPackageEvidenceForChangeRequest(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
  ): Promise<void> {
    if (workflow.execution_package_id === undefined) {
      return;
    }
    const executionPackage = await repository.getExecutionPackage(workflow.execution_package_id);
    if (
      executionPackage === undefined ||
      executionPackage.workflow_id !== workflow.id ||
      executionPackage.development_plan_item_id !== workflow.development_plan_item_id ||
      executionPackage.current_run_session_id !== undefined ||
      executionPackage.last_run_session_id !== undefined ||
      executionPackage.deleted_at !== undefined ||
      executionPackage.phase === 'archived'
    ) {
      return;
    }
    const now = this.now();
    await repository.saveExecutionPackage({
      ...executionPackage,
      phase: 'archived',
      activity_state: 'idle',
      archived_at: now,
      updated_at: now,
    });
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
    if (artifactType === 'spec-doc') {
      await this.requestWorkflowSpecChangesWithRepository(repository, workflow, revisionId);
      return;
    }
    await this.requestWorkflowImplementationPlanChangesWithRepository(repository, workflow, revisionId);
  }

  private async requestWorkflowSpecChangesWithRepository(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    revisionId: string,
  ): Promise<void> {
    const revision = await repository.getSpecRevision(revisionId);
    this.assertOwnedDocumentRevision(workflow, revision, 'Spec revision');
    this.assertCurrentArtifactRevision(workflow.active_spec_doc_revision_id, revisionId, 'Spec revision');
    if (revision === undefined) {
      throw new DomainError('workflow_evidence_not_owned', 'Spec revision does not belong to this workflow/session');
    }
    const spec = await repository.getSpec(revision.spec_id);
    if (spec === undefined || spec.workflow_id !== workflow.id || spec.development_plan_item_id !== workflow.development_plan_item_id) {
      throw new DomainError('workflow_evidence_not_owned', 'Spec does not belong to this workflow/session');
    }
    await repository.saveSpec({
      ...spec,
      status: 'draft',
      editing_state: 'idle',
      gate_state: 'changes_requested',
      resolution: 'none',
      updated_at: this.now(),
    });
    const item = await repository.getDevelopmentPlanItem(workflow.development_plan_item_id);
    if (item !== undefined) {
      await repository.saveDevelopmentPlanItem({
        ...item,
        spec_status: 'changes_requested',
        implementation_plan_status: 'missing',
        next_action: 'revise_spec',
        updated_at: this.now(),
      });
    }
  }

  private async requestWorkflowImplementationPlanChangesWithRepository(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    revisionId: string,
  ): Promise<void> {
    const revision = await repository.getExecutionPlanRevision(revisionId);
    this.assertOwnedDocumentRevision(workflow, revision, 'Implementation Plan revision');
    this.assertCurrentArtifactRevision(workflow.active_implementation_plan_doc_revision_id, revisionId, 'Implementation Plan revision');
    if (revision === undefined) {
      throw new DomainError('workflow_evidence_not_owned', 'Implementation Plan revision does not belong to this workflow/session');
    }
    const executionPlan = await repository.getExecutionPlan(revision.execution_plan_id);
    if (
      executionPlan === undefined ||
      executionPlan.workflow_id !== workflow.id ||
      executionPlan.development_plan_item_id !== workflow.development_plan_item_id
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Implementation Plan does not belong to this workflow/session');
    }
    await repository.saveExecutionPlan({
      ...executionPlan,
      status: 'changes_requested',
      updated_at: this.now(),
    });
    const item = await repository.getDevelopmentPlanItem(workflow.development_plan_item_id);
    if (item !== undefined) {
      await repository.saveDevelopmentPlanItem({
        ...item,
        implementation_plan_status: 'changes_requested',
        next_action: 'revise_implementation_plan',
        updated_at: this.now(),
      });
    }
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

  private async assertNoConflictingWorkflowActionsForChangeRequest(
    repository: DeliveryRepository,
    workflowId: string,
    artifactType: WorkflowArtifactTypeDto,
  ) {
    const activeActions = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
    if (artifactType === 'implementation-plan-doc') {
      const pendingAction = activeActions.find((action) => action.status === 'queued' || action.status === 'running');
      if (pendingAction !== undefined) {
        throw new DomainError(
          'workflow_action_already_pending',
          `workflow_action_already_pending: Queued action ${pendingAction.id} is ${pendingAction.status}`,
        );
      }
      return;
    }
    const dependentKinds = new Set(this.dependentActionKindsForChangeRequest(artifactType));
    const pendingAction = activeActions.find(
      (action) =>
        action.status === 'running' ||
        (action.status === 'queued' && !dependentKinds.has(action.kind)),
    );
    if (pendingAction !== undefined) {
      throw new DomainError(
        'workflow_action_already_pending',
        `workflow_action_already_pending: Queued action ${pendingAction.id} is ${pendingAction.status}`,
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
    return this.toPublicWorkflowDtoWithRepository(repository, updated, session);
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
  ): Promise<ExecutionPackageBoundaryResult> {
    const blockers: ExecutionReadinessBlockerCode[] = [];
    const addBlocker = (code: ExecutionReadinessBlockerCode): void => {
      if (!blockers.includes(code)) blockers.push(code);
    };

    if (workflow.active_boundary_summary_revision_id === undefined) addBlocker('boundary_summary_revision_missing');
    if (workflow.active_spec_doc_revision_id === undefined) addBlocker('spec_doc_revision_missing');
    if (workflow.active_implementation_plan_doc_revision_id === undefined) addBlocker('implementation_plan_doc_revision_missing');
    if (workflow.active_codex_session_id === undefined) addBlocker('codex_session_missing');

    if (
      workflow.active_boundary_summary_revision_id === undefined ||
      workflow.active_spec_doc_revision_id === undefined ||
      workflow.active_implementation_plan_doc_revision_id === undefined ||
      workflow.active_codex_session_id === undefined
    ) {
      throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires active approved document revisions');
    }

    const boundaryRevision = await repository.getBoundarySummaryRevisionById(workflow.active_boundary_summary_revision_id);
    const specRevision = await repository.getSpecRevision(workflow.active_spec_doc_revision_id);
    const implementationPlanRevision = await repository.getExecutionPlanRevision(workflow.active_implementation_plan_doc_revision_id);
    const session = await repository.getCodexSession(workflow.active_codex_session_id);
    const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);

    if (!this.isOwnedDocumentRevision(workflow, boundaryRevision)) addBlocker('boundary_summary_revision_not_current');
    if (!this.isOwnedDocumentRevision(workflow, specRevision)) addBlocker('spec_doc_revision_not_current');
    if (!this.isOwnedExecutionPlanRevision(workflow, implementationPlanRevision)) {
      addBlocker('implementation_plan_doc_revision_not_current');
    }
    if (
      !(await this.artifactsMatchCurrentPlanItemPlanningContent(repository, item, [
        boundaryRevision?.development_plan_item_revision_id,
        specRevision?.development_plan_item_revision_id,
        implementationPlanRevision?.development_plan_item_revision_id,
      ]))
    ) {
      addBlocker('development_plan_item_revision_not_current');
    }

    if (boundaryRevision !== undefined) {
      const boundarySummary = await repository.getBoundarySummary(boundaryRevision.boundary_summary_id);
      if (
        boundarySummary?.revision_id !== boundaryRevision.id ||
        boundaryRevision.approved_by_actor_id === undefined ||
        boundaryRevision.approved_at === undefined
      ) {
        addBlocker('boundary_summary_revision_not_current');
      }
    }

    if (specRevision !== undefined) {
      const spec = await repository.getSpec(specRevision.spec_id);
      if (
        spec?.current_revision_id !== specRevision.id ||
        spec.approved_revision_id !== specRevision.id ||
        spec.approved_by_actor_id === undefined ||
        spec.approved_at === undefined
      ) {
        addBlocker('spec_doc_revision_not_current');
      }
      if (specRevision.acceptance_criteria.length === 0) addBlocker('spec_doc_acceptance_criteria_missing');
      if (specRevision.test_strategy_summary.trim().length === 0) addBlocker('spec_doc_test_strategy_missing');
      if (
        specRevision.qa_owner_actor_id === undefined ||
        specRevision.testability_note === undefined ||
        specRevision.testability_note.trim().length === 0
      ) {
        addBlocker('spec_doc_testability_missing');
      }
    }

    if (implementationPlanRevision !== undefined) {
      const executionPlan = await repository.getExecutionPlan(implementationPlanRevision.execution_plan_id);
      if (
        executionPlan?.current_revision_id !== implementationPlanRevision.id ||
        executionPlan.approved_revision_id !== implementationPlanRevision.id ||
        executionPlan.approved_by_actor_id === undefined ||
        executionPlan.approved_at === undefined ||
        implementationPlanRevision.based_on_spec_revision_id !== workflow.active_spec_doc_revision_id
      ) {
        addBlocker('implementation_plan_doc_revision_not_current');
      }
      if (!this.implementationPlanRevisionHasReadinessEvidence(implementationPlanRevision)) {
        addBlocker('implementation_plan_validation_strategy_missing');
      }
    }

    if (session === undefined) {
      addBlocker('codex_session_missing');
    } else {
      if (session.role !== 'active' || session.status !== 'idle' || session.active_lease_id !== undefined) {
        addBlocker('codex_session_not_ready');
      }
      if (session.latest_capsule_id === undefined || session.latest_capsule_digest === undefined || session.latest_turn_id === undefined) {
        addBlocker('codex_session_capsule_lineage_missing');
      }
      const latestTurn = session.latest_turn_id === undefined ? undefined : await repository.getCodexSessionTurn(session.latest_turn_id);
      if (latestTurn === undefined) {
        addBlocker('codex_session_latest_turn_missing');
      } else {
        if (latestTurn.workflow_id !== workflow.id || latestTurn.codex_session_id !== session.id || latestTurn.status !== 'succeeded') {
          addBlocker('codex_session_latest_turn_not_succeeded');
        }
        if (
          latestTurn.output_capsule_id === undefined ||
          latestTurn.output_capsule_digest === undefined ||
          latestTurn.output_capsule_id !== session.latest_capsule_id ||
          latestTurn.output_capsule_digest !== session.latest_capsule_digest ||
          implementationPlanRevision?.codex_session_turn_id !== latestTurn.id
        ) {
          addBlocker('codex_session_latest_turn_output_mismatch');
        }
      }
    }

    const activeActions = await repository.listActivePlanItemWorkflowQueuedActions(workflow.id);
    if (activeActions.length > 0) addBlocker('workflow_action_pending');

    const runSessions = await repository.listRunSessions();
    if (
      runSessions.some(
        (runSession) => runSession.workflow_id === workflow.id || runSession.codex_session_id === workflow.active_codex_session_id,
      )
    ) {
      addBlocker('run_session_exists');
    }

    const readinessRecordId = randomUUID();
    let executionPackage: ExecutionPackage | undefined;
    if (blockers.length === 0) {
      try {
        executionPackage = await this.ensureExecutionPackageBoundaryForReadiness(
          repository,
          workflow,
          implementationPlanRevision,
          specRevision,
          actorId,
          readinessRecordId,
        );
      } catch {
        addBlocker('execution_package_boundary_missing');
      }
    }

    const record = {
      id: readinessRecordId,
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
      readiness_state: blockers.length === 0 ? 'ready' as const : 'not_ready' as const,
      blocker_codes: blockers,
      supporting_evidence: [
        {
          object_type: 'implementation_plan_revision' as const,
          object_id: workflow.active_implementation_plan_doc_revision_id,
        },
        ...(executionPackage === undefined
          ? []
          : [
              {
                object_type: 'execution_package' as const,
                object_id: executionPackage.id,
              },
            ]),
      ],
      created_by_actor_id: actorId,
      created_at: this.now(),
    };
    await repository.saveExecutionReadinessRecord(record);
    return { readiness: record, ...(executionPackage === undefined ? {} : { executionPackage }) };
  }

  private implementationPlanRevisionHasReadinessEvidence(revision: ExecutionPlanRevision): boolean {
    const structuredDocument = revision.structured_document;
    if (structuredDocument === undefined) {
      const content = revision.content.toLowerCase();
      return content.includes('validation') && content.includes('handoff');
    }
    const hasNonEmptyStringArray = (key: string) => {
      const value = structuredDocument[key];
      return Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
    };
    return (
      hasNonEmptyStringArray('validation_strategy') &&
      (hasNonEmptyStringArray('required_checks') || this.requiredChecksFromStructuredDocument(structuredDocument) !== undefined) &&
      hasNonEmptyStringArray('handoff_criteria')
    );
  }

  private async artifactsMatchCurrentPlanItemPlanningContent(
    repository: DeliveryRepository,
    item: DevelopmentPlanItem,
    artifactPlanItemRevisionIds: Array<string | undefined>,
  ): Promise<boolean> {
    const revisions = await repository.listDevelopmentPlanItemRevisions(item.id);
    for (const revisionId of artifactPlanItemRevisionIds) {
      if (revisionId === undefined) return false;
      const revision = revisions.find((candidate) => candidate.id === revisionId);
      if (revision === undefined) return false;
      if (this.planItemPlanningContentDigest(revision.snapshot) !== this.planItemPlanningContentDigest(item)) return false;
    }
    return true;
  }

  private planItemPlanningContentDigest(item: DevelopmentPlanItem): string {
    return codexCanonicalDigest({
      source_ref: item.source_ref,
      title: item.title,
      summary: item.summary,
      driver_actor_id: item.driver_actor_id,
      responsible_role: item.responsible_role,
      reviewer_actor_id: item.reviewer_actor_id,
      leader_actor_id: item.leader_actor_id,
      leader_delegate_actor_ids: item.leader_delegate_actor_ids,
      risk: item.risk,
      dependency_hints: item.dependency_hints,
      affected_surfaces: item.affected_surfaces,
      release_impact: item.release_impact,
    });
  }

  private async ensureExecutionPackageBoundaryForReadiness(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    implementationPlanRevision: ExecutionPlanRevision | undefined,
    specRevision: SpecRevision | undefined,
    actorId: string,
    readinessRecordId: string,
  ): Promise<ExecutionPackage> {
    if (implementationPlanRevision === undefined || specRevision === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Execution readiness requires approved Spec and Implementation Plan revisions');
    }
    const codexSessionId = workflow.active_codex_session_id;
    if (codexSessionId === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Execution readiness requires an active Codex Session');
    }
    const item = await this.requirePlanItemBelongsToPlan(repository, workflow.development_plan_id, workflow.development_plan_item_id);
    const workItem = await repository.getWorkItem(item.source_ref.id);
    if (workItem === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Execution readiness requires the Plan Item source Work Item');
    }
    const project = await repository.getProject(workItem.project_id);
    if (project === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Execution readiness requires the source Work Item project');
    }
    const repo = (await repository.listProjectRepos(project.id)).find((candidate) => candidate.status === 'active');
    if (repo === undefined) {
      throw new DomainError('workflow_evidence_missing', 'Execution readiness requires an active project repository');
    }
    const spec = await repository.getSpec(specRevision.spec_id);
    if (
      spec === undefined ||
      spec.workflow_id !== workflow.id ||
      spec.development_plan_item_id !== workflow.development_plan_item_id
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution readiness Spec does not belong to this workflow');
    }
    const executionPlan = await repository.getExecutionPlan(implementationPlanRevision.execution_plan_id);
    if (
      executionPlan === undefined ||
      executionPlan.workflow_id !== workflow.id ||
      executionPlan.development_plan_item_id !== workflow.development_plan_item_id
    ) {
      throw new DomainError('workflow_evidence_not_owned', 'Execution readiness Implementation Plan does not belong to this workflow');
    }
    const policy = this.packageBoundaryPolicyForReadiness(item, implementationPlanRevision);
    const packageAssigneeActorId = item.driver_actor_id ?? workItem.driver_actor_id ?? actorId;
    const packageActorFields = executionPackageActorFields({
      assignee_actor_id: packageAssigneeActorId,
      reviewer_actor_id: item.reviewer_actor_id ?? item.leader_actor_id ?? actorId,
      qa_owner_actor_id: specRevision.qa_owner_actor_id ?? item.reviewer_actor_id ?? actorId,
    });
    const packagePolicyDigest = this.workflowExecutionPackagePolicyDigest({
      workflow,
      item,
      workItemId: workItem.id,
      specId: spec.id,
      specRevision,
      executionPlanId: executionPlan.id,
      implementationPlanRevision,
      projectId: project.id,
      repoId: repo.repo_id,
      policy,
      packageActorFields,
      readinessRecordId,
    });
    const implementationPlanProvenanceTurnId = await this.requireImplementationPlanProvenanceTurn(
      repository,
      workflow,
      codexSessionId,
      implementationPlanRevision,
    );
    const readinessMetadata = {
      schema_version: 'plan_item_workflow_execution_package_readiness.v1',
      readiness_record_id: readinessRecordId,
      plan_item_revision_id: item.revision_id,
      plan_item_planning_digest: this.planItemPlanningContentDigest(item),
      boundary_summary_revision_id: this.requireString(
        workflow.active_boundary_summary_revision_id,
        'Execution readiness requires an active Boundary Summary revision',
      ),
      spec_revision_id: specRevision.id,
      implementation_plan_revision_id: implementationPlanRevision.id,
      implementation_plan_turn_id: implementationPlanProvenanceTurnId,
      package_policy_digest: packagePolicyDigest,
      workspace_policy_digest: this.workflowExecutionWorkspacePolicyDigest(packagePolicyDigest),
    };
    const existing =
      workflow.execution_package_id === undefined ? undefined : await repository.getExecutionPackage(workflow.execution_package_id);
    if (
      existing !== undefined &&
      existing.development_plan_item_id === workflow.development_plan_item_id &&
      existing.workflow_id === workflow.id &&
      existing.codex_session_id === codexSessionId &&
      existing.spec_revision_id === specRevision.id &&
      existing.plan_revision_id === implementationPlanRevision.id &&
      existing.execution_plan_id === executionPlan.id &&
      existing.execution_plan_revision_id === implementationPlanRevision.id &&
      existing.codex_session_turn_id === implementationPlanProvenanceTurnId &&
      existing.manifest_digest === packagePolicyDigest &&
      codexCanonicalDigest(existing.integration_readiness) === codexCanonicalDigest(readinessMetadata) &&
      existing.objective === policy.objective &&
      JSON.stringify(existing.required_checks) === JSON.stringify(policy.required_checks) &&
      JSON.stringify(existing.required_artifact_kinds) === JSON.stringify(['execution_summary']) &&
      JSON.stringify(existing.allowed_paths) === JSON.stringify(policy.allowed_paths) &&
      JSON.stringify(existing.forbidden_paths) === JSON.stringify(policy.forbidden_paths) &&
      existing.source_mutation_policy === 'path_policy_scoped' &&
      existing.owner_actor_id === packageActorFields.owner_actor_id &&
      existing.reviewer_actor_id === packageActorFields.reviewer_actor_id &&
      existing.qa_owner_actor_id === packageActorFields.qa_owner_actor_id &&
      existing.phase === 'draft' &&
      existing.activity_state === 'idle' &&
      existing.gate_state === 'not_submitted' &&
      existing.current_run_session_id === undefined &&
      existing.last_run_session_id === undefined
    ) {
      return existing;
    }

    const createdAt = this.now();
    const generated = transitionExecutionPackage(undefined, {
      type: 'generate_package',
      id: randomUUID(),
      work_item_id: workItem.id,
      spec_id: spec.id,
      spec_revision_id: specRevision.id,
      plan_id: executionPlan.id,
      plan_revision_id: implementationPlanRevision.id,
      project_id: project.id,
      repo_id: repo.repo_id,
      objective: policy.objective,
      ...packageActorFields,
      required_checks: policy.required_checks,
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: policy.allowed_paths,
      forbidden_paths: policy.forbidden_paths,
      source_mutation_policy: 'path_policy_scoped',
      at: createdAt,
    });
    const executionPackage: ExecutionPackage = {
      ...generated,
      development_plan_item_id: item.id,
      workflow_id: workflow.id,
      codex_session_id: codexSessionId,
      codex_session_turn_id: implementationPlanProvenanceTurnId,
      execution_plan_id: executionPlan.id,
      execution_plan_revision_id: implementationPlanRevision.id,
      execution_package_set_id: `plan-item-workflow-readiness:${item.id}:${implementationPlanRevision.id}`,
      generation_key: 'plan-item-workflow-readiness',
      package_key: 'default-boundary-package',
      sequence: 0,
      manifest_digest: packagePolicyDigest,
      required_test_gates: [],
      integration_readiness: readinessMetadata,
    };
    validateExecutionPackage(project, executionPackage);
    await repository.saveExecutionPackage(executionPackage);
    return executionPackage;
  }

  private workflowExecutionPackagePolicyDigest(input: {
    workflow: PlanItemWorkflow;
    item: DevelopmentPlanItem;
    workItemId: string;
    specId: string;
    specRevision: SpecRevision;
    executionPlanId: string;
    implementationPlanRevision: ExecutionPlanRevision;
    projectId: string;
    repoId: string;
    policy: Pick<ExecutionPackage, 'objective' | 'required_checks' | 'allowed_paths' | 'forbidden_paths'>;
    packageActorFields: Pick<ExecutionPackage, 'owner_actor_id' | 'reviewer_actor_id' | 'qa_owner_actor_id'>;
    readinessRecordId: string;
  }): string {
    return codexCanonicalDigest({
      schema_version: 'plan_item_workflow_execution_package_policy.v1',
      workflow_id: input.workflow.id,
      codex_session_id: input.workflow.active_codex_session_id,
      readiness_record_id: input.readinessRecordId,
      development_plan_id: input.workflow.development_plan_id,
      development_plan_item_id: input.item.id,
      plan_item_planning_digest: this.planItemPlanningContentDigest(input.item),
      work_item_id: input.workItemId,
      project_id: input.projectId,
      repo_id: input.repoId,
      spec_id: input.specId,
      spec_revision_id: input.specRevision.id,
      implementation_plan_id: input.executionPlanId,
      implementation_plan_revision_id: input.implementationPlanRevision.id,
      implementation_plan_turn_id: input.implementationPlanRevision.codex_session_turn_id,
      objective: input.policy.objective,
      driver_actor_id: input.packageActorFields.owner_actor_id,
      reviewer_actor_id: input.packageActorFields.reviewer_actor_id,
      qa_owner_actor_id: input.packageActorFields.qa_owner_actor_id,
      required_checks: input.policy.required_checks,
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: input.policy.allowed_paths,
      forbidden_paths: input.policy.forbidden_paths,
      source_mutation_policy: 'path_policy_scoped',
    });
  }

  private workflowExecutionPackagePolicyDigestFromPackage(input: {
    workflow: PlanItemWorkflow;
    item: DevelopmentPlanItem;
    executionPackage: ExecutionPackage;
    metadata: {
      readiness_record_id: string;
      implementation_plan_turn_id: string;
    };
  }): string {
    return codexCanonicalDigest({
      schema_version: 'plan_item_workflow_execution_package_policy.v1',
      workflow_id: input.workflow.id,
      codex_session_id: input.workflow.active_codex_session_id,
      readiness_record_id: input.metadata.readiness_record_id,
      development_plan_id: input.workflow.development_plan_id,
      development_plan_item_id: input.item.id,
      plan_item_planning_digest: this.planItemPlanningContentDigest(input.item),
      work_item_id: input.executionPackage.work_item_id,
      project_id: input.executionPackage.project_id,
      repo_id: input.executionPackage.repo_id,
      spec_id: input.executionPackage.spec_id,
      spec_revision_id: input.executionPackage.spec_revision_id,
      implementation_plan_id: input.executionPackage.plan_id,
      implementation_plan_revision_id: input.executionPackage.plan_revision_id,
      implementation_plan_turn_id: input.metadata.implementation_plan_turn_id,
      objective: input.executionPackage.objective,
      driver_actor_id: input.executionPackage.owner_actor_id,
      reviewer_actor_id: input.executionPackage.reviewer_actor_id,
      qa_owner_actor_id: input.executionPackage.qa_owner_actor_id,
      required_checks: input.executionPackage.required_checks,
      required_artifact_kinds: input.executionPackage.required_artifact_kinds,
      allowed_paths: input.executionPackage.allowed_paths,
      forbidden_paths: input.executionPackage.forbidden_paths,
      source_mutation_policy: input.executionPackage.source_mutation_policy,
    });
  }

  private workflowExecutionWorkspacePolicyDigest(packagePolicyDigest: string): string {
    return codexCanonicalDigest({
      schema_version: 'plan_item_workflow_execution_workspace_policy.v1',
      package_policy_digest: packagePolicyDigest,
    });
  }

  private packageBoundaryPolicyForReadiness(
    item: DevelopmentPlanItem,
    revision: ExecutionPlanRevision,
  ): Pick<ExecutionPackage, 'objective' | 'required_checks' | 'allowed_paths' | 'forbidden_paths'> {
    const structuredDocument = revision.structured_document;
    const requiredChecks = this.requiredChecksFromStructuredDocument(structuredDocument) ?? [
      {
        check_id: 'focused',
        display_name: 'Focused verification',
        command: 'pnpm test',
        timeout_seconds: 120,
        blocks_review: true,
      },
    ];
    const allowedPaths = this.stringArrayStructuredField(structuredDocument, 'allowed_paths') ?? this.allowedPathsFromAffectedSurfaces(item);
    const forbiddenPaths = this.stringArrayStructuredField(structuredDocument, 'forbidden_paths') ?? ['.git/**'];
    return {
      objective: revision.summary.trim().length > 0 ? revision.summary : `Execution boundary for Plan Item ${item.id}`,
      required_checks: requiredChecks,
      allowed_paths: allowedPaths,
      forbidden_paths: forbiddenPaths,
    };
  }

  private requiredChecksFromStructuredDocument(structuredDocument: Record<string, unknown> | undefined): RequiredCheckSpec[] | undefined {
    const value = structuredDocument?.required_checks;
    if (!Array.isArray(value)) return undefined;
    const checks: RequiredCheckSpec[] = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
      const record = entry as Record<string, unknown>;
      const checkId = typeof record.check_id === 'string' ? record.check_id.trim() : '';
      const command = typeof record.command === 'string' ? record.command.trim() : '';
      if (checkId.length === 0 || command.length === 0) return undefined;
      checks.push({
        check_id: checkId,
        display_name: typeof record.display_name === 'string' && record.display_name.trim().length > 0
          ? record.display_name.trim()
          : checkId,
        command,
        timeout_seconds: Number.isInteger(record.timeout_seconds) && Number(record.timeout_seconds) > 0
          ? Number(record.timeout_seconds)
          : 120,
        blocks_review: typeof record.blocks_review === 'boolean' ? record.blocks_review : true,
      });
    }
    return checks.length === 0 ? undefined : checks;
  }

  private stringArrayStructuredField(structuredDocument: Record<string, unknown> | undefined, key: string): string[] | undefined {
    const value = structuredDocument?.[key];
    if (!Array.isArray(value)) return undefined;
    const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
    return entries.length === 0 ? undefined : entries;
  }

  private allowedPathsFromAffectedSurfaces(item: DevelopmentPlanItem): string[] {
    const mapped = item.affected_surfaces.flatMap((surface) => this.allowedPathsForAffectedSurface(surface));
    return [...new Set([...mapped, 'tests/**'])];
  }

  private allowedPathsForAffectedSurface(surface: string): string[] {
    const normalized = surface.trim().replace(/^\/+/, '');
    if (normalized.length === 0) return [];
    if (normalized.includes('/') || normalized.includes('*') || /\.[a-z0-9]+$/i.test(normalized)) {
      return [normalized.includes('*') || /\.[a-z0-9]+$/i.test(normalized) ? normalized : `${normalized.replace(/\/+$/, '')}/**`];
    }
    const aliases: Record<string, string[]> = {
      'control-plane-api': ['apps/control-plane-api/**'],
      api: ['apps/control-plane-api/**'],
      web: ['apps/web/**'],
      db: ['packages/db/**'],
      domain: ['packages/domain/**'],
      contracts: ['packages/contracts/**'],
      scripts: ['scripts/**'],
    };
    return aliases[normalized] ?? [`${normalized}/**`];
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

  private readinessProjectionForRecord(record: ExecutionReadinessRecord): PlanItemWorkflowReadiness {
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
        const executionPackageSupport = record?.supporting_evidence.find(
          (supporting) => supporting.object_type === 'execution_package',
        );
        const executionPackage =
          executionPackageSupport === undefined ? undefined : await repository.getExecutionPackage(executionPackageSupport.object_id);
        if (
          record === undefined ||
          executionPackageSupport === undefined ||
          executionPackage === undefined ||
          record.invalidated_at !== undefined ||
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
          ) ||
          executionPackage.development_plan_item_id !== workflow.development_plan_item_id ||
          executionPackage.workflow_id !== workflow.id ||
          executionPackage.codex_session_id !== workflow.active_codex_session_id ||
          executionPackage.phase !== 'draft' ||
          executionPackage.activity_state !== 'idle' ||
          executionPackage.gate_state !== 'not_submitted' ||
          executionPackage.current_run_session_id !== undefined ||
          executionPackage.last_run_session_id !== undefined
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
        const spec = revision === undefined ? undefined : await repository.getSpec(revision.spec_id);
        if (
          !evidence.supporting &&
          evidence.to_status === 'implementation_plan_generation_queued' &&
          (spec === undefined ||
            spec.approved_revision_id !== revision?.id ||
            spec.approved_at === undefined ||
            spec.approved_by_actor_id === undefined)
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

  private requireFound<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
      throw new DomainError('workflow_evidence_missing', `${label} is missing`);
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
      execution_run_summary?: PlanItemWorkflowExecutionRunSummary;
      attempt_history?: PlanItemWorkflowAttemptHistory[];
      latest_review_response?: PlanItemWorkflowPublicDto['latest_review_response'];
      recovery_options?: PlanItemWorkflowRecoveryOption[];
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
      ...(options.execution_run_summary === undefined ? {} : { execution_run_summary: options.execution_run_summary }),
      ...(options.attempt_history === undefined ? {} : { attempt_history: options.attempt_history }),
      ...(options.latest_review_response === undefined ? {} : { latest_review_response: options.latest_review_response }),
      ...(options.recovery_options === undefined ? {} : { recovery_options: options.recovery_options }),
      ...(options.blockers === undefined ? {} : { blockers: options.blockers }),
    });
  }

  private async toPublicWorkflowDtoWithRepository(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    session: CodexSession,
    queuedActions: readonly PlanItemWorkflowQueuedAction[] = [],
    options: {
      readiness?: PlanItemWorkflowReadiness;
      execution_run_summary?: PlanItemWorkflowExecutionRunSummary;
      blockers?: Parameters<typeof planItemWorkflowPublicProjection>[0]['blockers'];
    } = {},
  ): Promise<PlanItemWorkflowPublicDto> {
    const [attemptHistory, latestReviewResponse] = await Promise.all([
      this.workflowAttemptHistory(repository, workflow.id),
      this.workflowLatestReviewResponse(repository, workflow.id),
    ]);
    return this.toPublicWorkflowDto(workflow, session, queuedActions, {
      ...options,
      attempt_history: attemptHistory,
      ...(latestReviewResponse === undefined ? {} : { latest_review_response: latestReviewResponse }),
      recovery_options: this.workflowRecoveryOptions(workflow),
    });
  }

  private async workflowAttemptHistory(
    repository: DeliveryRepository,
    workflowId: string,
  ): Promise<PlanItemWorkflowAttemptHistory[]> {
    const [attempts, continuations] = await Promise.all([
      repository.listRunSessionAttemptLineage(workflowId),
      repository.listExecutionContinuationLineage(workflowId),
    ]);
    return Promise.all(
      attempts.map(async (attempt) => {
        const runSession = await repository.getRunSession(attempt.run_session_id);
        return {
          run_session_id: attempt.run_session_id,
          attempt_kind: attempt.attempt_kind,
          ...(attempt.previous_run_session_id === undefined ? {} : { previous_run_session_id: attempt.previous_run_session_id }),
          ...(attempt.previous_review_packet_id === undefined ? {} : { previous_review_packet_id: attempt.previous_review_packet_id }),
          status: runSession?.status ?? 'unknown',
          continuation_events: continuations
            .filter((continuation) => continuation.run_session_id === attempt.run_session_id)
            .map((continuation) => ({
              queued_action_id: continuation.queued_action_id,
              continuation_kind: continuation.continuation_kind,
              created_at: continuation.created_at,
            })),
          created_at: attempt.created_at,
          updated_at: runSession?.updated_at ?? attempt.created_at,
        };
      }),
    );
  }

  private async workflowLatestReviewResponse(
    repository: DeliveryRepository,
    workflowId: string,
  ): Promise<PlanItemWorkflowPublicDto['latest_review_response'] | undefined> {
    const response = await repository.getLatestReviewResponseForWorkflow(workflowId);
    if (response === undefined) {
      return undefined;
    }
    return {
      id: response.id,
      review_packet_id: response.review_packet_id,
      previous_run_session_id: response.previous_run_session_id,
      status: response.status,
      created_at: response.created_at,
    };
  }

  private workflowRecoveryOptions(workflow: PlanItemWorkflow): PlanItemWorkflowRecoveryOption[] {
    const canContinueSameSession = workflow.status === 'execution_running';
    const canAbandonNewSession = workflow.status === 'blocked';
    return [
      {
        action_id: 'continue_same_session',
        enabled: canContinueSameSession,
        ...(canContinueSameSession
          ? {}
          : {
              blocker_code: 'workflow_execution_not_active',
              warning_copy: 'There is no active interrupted execution to continue.',
            }),
        required_confirmation_kind: 'none',
      },
      {
        action_id: 'abandon_new_session',
        enabled: canAbandonNewSession,
        ...(canAbandonNewSession
          ? {}
          : {
              blocker_code: 'workflow_not_blocked',
              warning_copy: 'Abandon and start a new session is only available for blocked workflows.',
            }),
        required_confirmation_kind: 'typed_phrase',
      },
      {
        action_id: 'archive_workflow',
        enabled: workflow.status !== 'archived',
        ...(workflow.status === 'archived'
          ? {
              blocker_code: 'workflow_already_archived',
              warning_copy: 'The workflow is already archived.',
            }
          : {}),
        required_confirmation_kind: 'typed_phrase',
      },
      {
        action_id: 'fork_unavailable',
        enabled: false,
        blocker_code: 'workflow_fork_not_implemented',
        warning_copy: 'Fork recovery is outside this wave.',
        required_confirmation_kind: 'none',
      },
    ];
  }

  private publicQueuedAction(workflow: PlanItemWorkflowPublicDto, actionId: string) {
    const action = workflow.queued_actions.find((candidate) => candidate.id === actionId);
    if (action === undefined) {
      throw new DomainError('workflow_action_not_found', `workflow_action_not_found: Queued action ${actionId} is not visible`);
    }
    return action;
  }

  private now() {
    return new Date().toISOString();
  }
}
