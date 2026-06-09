import { Inject, Injectable } from '@nestjs/common';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  validateBoundaryRoundRuntimeResult,
  type BoundaryRoundRuntimeResultV1,
  validateGeneratedExecutionPlanRevision,
  validateGeneratedSpecRevision,
  type GeneratedExecutionPlanRevisionV1,
  type GeneratedSpecRevisionV1,
} from '@forgeloop/codex-runtime';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  DomainError,
  assertPlanItemWorkflowTransitionAllowed,
  validateCodexRuntimeJobTerminalResult,
  type AutomationActionRun,
  type BoundarySummaryRevision,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexRuntimeJob,
  type ExecutionPlanRevision,
  type InternalArtifactObject,
  type PlanItemWorkflowQueuedAction,
  type PlanItemWorkflowStatus,
  type PlanItemWorkflowTransition,
  type SpecRevision,
} from '@forgeloop/domain';
import { LocalInternalArtifactStore, type DeliveryRepository } from '@forgeloop/db';

import { BrainstormingService } from '../brainstorming/brainstorming.service';
import { DELIVERY_REPOSITORY, INTERNAL_ARTIFACT_STORE_ROOT } from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { SpecPlanService } from '../spec-plan/spec-plan.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const staleTerminalizationCodes = new Set([
  'codex_session_lease_conflict',
  'codex_session_lease_expired',
  'codex_session_stale_terminalization',
  'codex_runtime_capsule_stale',
  'codex_session_thread_binding_stale',
]);

export type ProductGenerationResultApplyOutcome =
  | { applied: true }
  | {
      applied: false;
      reason:
        | 'legacy_generation_task_kind'
        | 'invalid_precondition'
        | 'stale_precondition_fingerprint'
        | 'public_unsafe_payload'
        | 'unsupported_generated_payload_ref';
    };

type PreparedProductGenerationResult =
  | { prepared: true; task_kind: 'boundary_brainstorming_round'; generated: BoundaryRoundRuntimeResultV1 }
  | { prepared: true; task_kind: 'development_plan_item_spec_revision'; generated: GeneratedSpecRevisionV1 }
  | { prepared: true; task_kind: 'development_plan_item_execution_plan_revision'; generated: GeneratedExecutionPlanRevisionV1 }
  | {
      prepared: false;
      reason:
        | 'legacy_generation_task_kind'
        | 'public_unsafe_payload'
        | 'unsupported_generated_payload_ref';
    };

type AppliedGeneratedArtifact =
  | { object_type: 'boundary_summary_revision'; object_id: string; to_status: Extract<PlanItemWorkflowStatus, 'boundary_review'> }
  | { object_type: 'spec_revision'; object_id: string; to_status: Extract<PlanItemWorkflowStatus, 'spec_review'> }
  | {
      object_type: 'implementation_plan_revision';
      object_id: string;
      to_status: Extract<PlanItemWorkflowStatus, 'implementation_plan_review'>;
    };

type PreparedProductGenerationApplyOutcome =
  | { applied: true; artifact?: AppliedGeneratedArtifact }
  | Extract<ProductGenerationResultApplyOutcome, { applied: false }>;

@Injectable()
export class ProductGenerationResultService {
  private readonly internalArtifacts: LocalInternalArtifactStore;

  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(INTERNAL_ARTIFACT_STORE_ROOT) internalArtifactStoreRoot: string,
    @Inject(BrainstormingService) private readonly brainstormingService: BrainstormingService,
    @Inject(SpecPlanService) private readonly specPlanService: SpecPlanService,
    @Inject(ControlPlaneRuntimeService) private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
  ) {
    this.internalArtifacts = new LocalInternalArtifactStore({
      root: internalArtifactStoreRoot,
      repository: this.repository,
      requestId: 'product-generation-result',
    });
  }

  async handleGenerationRuntimeTerminal(input: {
    runtimeJobId: string;
    actionRunId: string;
    terminalResult: CodexGenerationRuntimeJobResult;
  }): Promise<ProductGenerationResultApplyOutcome> {
    const activeFence = await this.repository.getActiveCodexGenerationActionRunFence({
      runtime_job_id: input.runtimeJobId,
      action_run_id: input.actionRunId,
      now: this.now(),
    });
    if (activeFence === undefined) {
      if (await this.wasProductGenerationResultApplied(input.actionRunId, input.runtimeJobId)) {
        return { applied: true };
      }
      return { applied: false, reason: 'invalid_precondition' };
    }
    const actionRun = activeFence.action_run;
    const storedTerminalResult = this.storedTerminalizedResult(activeFence.runtime_job, input.terminalResult);
    if (storedTerminalResult === 'not_terminal') {
      return { applied: false, reason: 'invalid_precondition' };
    }
    if (storedTerminalResult === 'invalid_terminal_result') {
      return this.completeProductActionIfOwned(actionRun, { applied: false, reason: 'invalid_precondition' });
    }
    const terminalResult = storedTerminalResult;
    const workload = activeFence.runtime_job.input_json;
    if (
      workload.task_kind !== terminalResult.task_kind ||
      workload.prompt_version !== terminalResult.prompt_version ||
      workload.output_schema_version !== terminalResult.output_schema_version
    ) {
      return this.completeProductActionIfOwned(actionRun, { applied: false, reason: 'invalid_precondition' });
    }
    if (!this.runtimeJobActionBindingMatchesActionRun(activeFence.runtime_job, actionRun)) {
      await this.failCodexSessionTurnForRejectedRuntimeResult(activeFence.runtime_job, 'workflow_action_not_runnable');
      return this.completeProductActionIfOwned(actionRun, { applied: false, reason: 'invalid_precondition' });
    }

    const prepared = await this.prepareProductGenerationResult(input.runtimeJobId, terminalResult);
    if (!prepared.prepared) {
      const outcome = { applied: false as const, reason: prepared.reason };
      await this.failCodexSessionTurnForRejectedRuntimeResult(activeFence.runtime_job, outcome.reason);
      return this.completeProductActionIfOwned(actionRun, outcome);
    }
    const terminalizedSession = await this.terminalizeCodexSessionTurnFromRuntimeResult(activeFence.runtime_job, terminalResult);
    if (!terminalizedSession) {
      return this.completeProductActionIfOwned(actionRun, { applied: false, reason: 'invalid_precondition' });
    }
    const outcome = await this.applyPreparedProductGenerationResult(actionRun, input.runtimeJobId, prepared);
    if (!outcome.applied) {
      await this.failCodexSessionTurnForRejectedRuntimeResult(activeFence.runtime_job, outcome.reason);
      await this.failPlanItemWorkflowQueuedActionIfOwned(actionRun, outcome.reason);
      await this.clearCodexSessionRunnerOwnerAfterTerminalResultRejection(activeFence.runtime_job);
      return this.completeProductActionIfOwned(actionRun, outcome);
    }
    await this.completePlanItemWorkflowQueuedActionIfOwned(actionRun, outcome.artifact);
    return this.completeProductActionIfOwned(actionRun, outcome);
  }

  private async prepareProductGenerationResult(
    runtimeJobId: string,
    terminalResult: CodexGenerationRuntimeJobResult,
  ): Promise<PreparedProductGenerationResult> {
    switch (terminalResult.task_kind) {
      case 'boundary_brainstorming_round': {
        const generatedPayload = await this.resolveGeneratedPayload(runtimeJobId, terminalResult);
        if (generatedPayload === undefined) {
          return { prepared: false, reason: 'unsupported_generated_payload_ref' };
        }
        const generated = this.validatePayload(() => validateBoundaryRoundRuntimeResult(generatedPayload));
        if (generated === undefined) {
          return { prepared: false, reason: 'public_unsafe_payload' };
        }
        return { prepared: true, task_kind: terminalResult.task_kind, generated };
      }
      case 'development_plan_item_spec_revision': {
        const generatedPayload = await this.resolveGeneratedPayload(runtimeJobId, terminalResult);
        if (generatedPayload === undefined) {
          return { prepared: false, reason: 'unsupported_generated_payload_ref' };
        }
        const generated = this.validatePayload(() => validateGeneratedSpecRevision(generatedPayload));
        if (generated === undefined) {
          return { prepared: false, reason: 'public_unsafe_payload' };
        }
        return { prepared: true, task_kind: terminalResult.task_kind, generated };
      }
      case 'development_plan_item_execution_plan_revision': {
        const generatedPayload = await this.resolveGeneratedPayload(runtimeJobId, terminalResult);
        if (generatedPayload === undefined) {
          return { prepared: false, reason: 'unsupported_generated_payload_ref' };
        }
        const generated = this.validatePayload(() => validateGeneratedExecutionPlanRevision(generatedPayload));
        if (generated === undefined) {
          return { prepared: false, reason: 'public_unsafe_payload' };
        }
        return { prepared: true, task_kind: terminalResult.task_kind, generated };
      }
      default:
        return { prepared: false, reason: 'legacy_generation_task_kind' };
    }
  }

  private async applyPreparedProductGenerationResult(
    actionRun: AutomationActionRun,
    runtimeJobId: string,
    prepared: Extract<PreparedProductGenerationResult, { prepared: true }>,
  ): Promise<PreparedProductGenerationApplyOutcome> {
    switch (prepared.task_kind) {
      case 'boundary_brainstorming_round': {
        const result = await this.brainstormingService.applyBoundaryRoundRuntimeResult({
          actionRun,
          runtime_job_id: runtimeJobId,
          generated: prepared.generated,
        });
        if (!result.applied) return result;
        return result.revision === undefined
          ? { applied: true }
          : {
              applied: true,
              artifact: {
                object_type: 'boundary_summary_revision',
                object_id: result.revision.id,
                to_status: 'boundary_review',
              },
            };
      }
      case 'development_plan_item_spec_revision': {
        const result = await this.specPlanService.writeGeneratedItemSpecRevision({
          actionRun,
          runtime_job_id: runtimeJobId,
          generated: prepared.generated,
        });
        return result.applied
          ? {
              applied: true,
              artifact: {
                object_type: 'spec_revision',
                object_id: result.revision.id,
                to_status: 'spec_review',
              },
            }
          : result;
      }
      case 'development_plan_item_execution_plan_revision': {
        const result = await this.specPlanService.writeGeneratedItemImplementationPlanRevision({
          actionRun,
          runtime_job_id: runtimeJobId,
          generated: prepared.generated,
        });
        return result.applied
          ? {
              applied: true,
              artifact: {
                object_type: 'implementation_plan_revision',
                object_id: result.revision.id,
                to_status: 'implementation_plan_review',
              },
            }
          : result;
      }
    }
  }

  private storedTerminalizedResult(
    runtimeJob: CodexRuntimeJob,
    suppliedTerminalResult: CodexGenerationRuntimeJobResult,
  ): CodexGenerationRuntimeJobResult | 'not_terminal' | 'invalid_terminal_result' {
    if (
      runtimeJob.status !== 'terminal' ||
      runtimeJob.terminal_status !== 'succeeded' ||
      runtimeJob.terminal_result_json === undefined
    ) {
      return 'not_terminal';
    }
    let storedTerminalResult: ReturnType<typeof validateCodexRuntimeJobTerminalResult>;
    try {
      storedTerminalResult = validateCodexRuntimeJobTerminalResult(runtimeJob.terminal_result_json);
    } catch {
      return 'invalid_terminal_result';
    }
    if (!('generated_payload' in storedTerminalResult)) {
      return 'invalid_terminal_result';
    }
    if (codexCanonicalDigest(storedTerminalResult) !== codexCanonicalDigest(suppliedTerminalResult)) {
      return 'invalid_terminal_result';
    }
    return storedTerminalResult;
  }

  private validatePayload<T>(parse: () => T): T | undefined {
    try {
      return parse();
    } catch {
      return undefined;
    }
  }

  private async terminalizeCodexSessionTurnFromRuntimeResult(
    runtimeJob: CodexRuntimeJob,
    terminalResult: CodexGenerationRuntimeJobResult,
  ): Promise<boolean> {
    const workload = runtimeJob.input_json as Partial<CodexGenerationWorkloadV1>;
    const runtimeContext = workload.codex_session_runtime_context;
    const terminalization = workload.codex_session_terminalization;
    if (runtimeContext === undefined && terminalization === undefined) {
      return true;
    }
    if (
      runtimeContext === undefined ||
      terminalization === undefined ||
      runtimeContext.codex_session_id !== runtimeJob.codex_session_id ||
      runtimeContext.codex_session_turn_id !== runtimeJob.codex_session_turn_id ||
      runtimeContext.lease_id === undefined ||
      runtimeContext.lease_epoch === undefined
    ) {
      return false;
    }
    const threadEvidence = terminalResult.codex_session_thread;
    const outputCapsule = terminalResult.output_capsule;
    if (threadEvidence === undefined) {
      await this.failCodexSessionTurnFromRuntimeResult({
        runtimeJob,
        runtimeContext,
        terminalization,
        reasonCode: 'codex_app_server_thread_id_missing',
      });
      return false;
    }
    if (outputCapsule === undefined) {
      await this.failCodexSessionTurnFromRuntimeResult({
        runtimeJob,
        runtimeContext,
        terminalization,
        reasonCode: 'codex_runtime_capsule_missing',
      });
      return false;
    }
    if (terminalResult.output_memory_bundle_ref === undefined || terminalResult.output_memory_bundle_digest === undefined) {
      await this.failCodexSessionTurnFromRuntimeResult({
        runtimeJob,
        runtimeContext,
        terminalization,
        reasonCode: 'codex_memory_bundle_missing',
      });
      return false;
    }
    if (
      terminalResult.output_environment_manifest_ref === undefined ||
      terminalResult.output_environment_manifest_digest === undefined
    ) {
      await this.failCodexSessionTurnFromRuntimeResult({
        runtimeJob,
        runtimeContext,
        terminalization,
        reasonCode: 'codex_environment_manifest_missing',
      });
      return false;
    }
    try {
      await this.repository.terminalizeCodexSessionTurn({
        session_id: runtimeContext.codex_session_id,
        turn_id: runtimeContext.codex_session_turn_id,
        lease_id: runtimeContext.lease_id,
        lease_token_hash: codexCredentialPayloadDigest(terminalization.lease_token),
        lease_epoch: runtimeContext.lease_epoch,
        worker_id: runtimeContext.worker_id,
        worker_session_digest: runtimeContext.worker_session_digest,
        status: 'succeeded',
        ...(runtimeContext.expected_input_capsule_digest === undefined
          ? {}
          : { expected_input_capsule_digest: runtimeContext.expected_input_capsule_digest }),
        app_server_thread_binding_required: true,
        codex_thread_id: threadEvidence.codex_thread_id,
        codex_thread_id_digest: threadEvidence.codex_thread_id_digest,
        output_capsule: outputCapsule,
        output_memory_bundle_ref: terminalResult.output_memory_bundle_ref,
        output_memory_bundle_digest: terminalResult.output_memory_bundle_digest,
        ...(terminalResult.memory_delta_artifact_ref === undefined
          ? {}
          : { memory_delta_artifact_ref: terminalResult.memory_delta_artifact_ref }),
        ...(terminalResult.memory_delta_digest === undefined ? {} : { memory_delta_digest: terminalResult.memory_delta_digest }),
        output_environment_manifest_ref: terminalResult.output_environment_manifest_ref,
        output_environment_manifest_digest: terminalResult.output_environment_manifest_digest,
        now: this.now(),
      });
      await this.clearCodexSessionRunnerOwnerAfterSuccessfulCompleteTurn(runtimeJob, runtimeContext);
    } catch (error) {
      if (!(error instanceof DomainError) || !staleTerminalizationCodes.has(error.code)) {
        throw error;
      }
      if (await this.codexSessionTurnAlreadyTerminalizedByRuntimeResult(runtimeContext, threadEvidence)) {
        await this.clearCodexSessionRunnerOwnerAfterSuccessfulCompleteTurn(runtimeJob, runtimeContext);
        return true;
      }
      await this.recordStaleCodexSessionTerminalizationAttempt({
        sessionId: runtimeContext.codex_session_id,
        turnId: runtimeContext.codex_session_turn_id,
        leaseId: runtimeContext.lease_id,
        leaseEpoch: runtimeContext.lease_epoch,
        workerId: runtimeContext.worker_id,
        workerSessionDigest: runtimeContext.worker_session_digest,
        ...(runtimeContext.expected_input_capsule_digest === undefined
          ? {}
          : { expectedInputCapsuleDigest: runtimeContext.expected_input_capsule_digest }),
        attemptedCodexThreadIdDigest: threadEvidence.codex_thread_id_digest,
        failureCode: error.code,
      });
      return false;
    }
    return true;
  }

  private async failCodexSessionTurnFromRuntimeResult(input: {
    runtimeJob: CodexRuntimeJob;
    runtimeContext: NonNullable<CodexGenerationWorkloadV1['codex_session_runtime_context']>;
    terminalization: NonNullable<CodexGenerationWorkloadV1['codex_session_terminalization']>;
    reasonCode: string;
  }): Promise<void> {
    const { runtimeJob, runtimeContext, terminalization, reasonCode } = input;
    try {
      await this.repository.terminalizeCodexSessionTurn({
        session_id: runtimeContext.codex_session_id,
        turn_id: runtimeContext.codex_session_turn_id,
        lease_id: runtimeContext.lease_id,
        lease_token_hash: codexCredentialPayloadDigest(terminalization.lease_token),
        lease_epoch: runtimeContext.lease_epoch,
        worker_id: runtimeContext.worker_id,
        worker_session_digest: runtimeContext.worker_session_digest,
        status: 'failed',
        ...(runtimeContext.expected_input_capsule_digest === undefined
          ? {}
          : { expected_input_capsule_digest: runtimeContext.expected_input_capsule_digest }),
        failure_code: reasonCode,
        now: this.now(),
      });
      await this.clearCodexSessionRunnerOwnerAfterTerminalTurn({
        sessionId: runtimeContext.codex_session_id,
        runnerLaunchLeaseId: runtimeContext.runner_launch_lease_id ?? runtimeJob.launch_lease_id,
        reasonCode,
      });
    } catch (error) {
      if (!(error instanceof DomainError) || !staleTerminalizationCodes.has(error.code)) {
        throw error;
      }
      await this.recordStaleCodexSessionTerminalizationAttempt({
        sessionId: runtimeContext.codex_session_id,
        turnId: runtimeContext.codex_session_turn_id,
        leaseId: runtimeContext.lease_id,
        leaseEpoch: runtimeContext.lease_epoch,
        workerId: runtimeContext.worker_id,
        workerSessionDigest: runtimeContext.worker_session_digest,
        ...(runtimeContext.expected_input_capsule_digest === undefined
          ? {}
          : { expectedInputCapsuleDigest: runtimeContext.expected_input_capsule_digest }),
        failureCode: error.code,
      });
    }
  }

  private async failCodexSessionTurnForRejectedRuntimeResult(runtimeJob: CodexRuntimeJob, reasonCode: string): Promise<void> {
    const workload = runtimeJob.input_json as Partial<CodexGenerationWorkloadV1>;
    const runtimeContext = workload.codex_session_runtime_context;
    const terminalization = workload.codex_session_terminalization;
    if (runtimeContext === undefined && terminalization === undefined) {
      return;
    }
    if (
      runtimeContext === undefined ||
      terminalization === undefined ||
      runtimeContext.codex_session_id !== runtimeJob.codex_session_id ||
      runtimeContext.codex_session_turn_id !== runtimeJob.codex_session_turn_id
    ) {
      await this.clearCodexSessionRunnerOwnerAfterTerminalResultRejection(runtimeJob);
      return;
    }
    await this.failCodexSessionTurnFromRuntimeResult({
      runtimeJob,
      runtimeContext,
      terminalization,
      reasonCode,
    });
  }

  private async completePlanItemWorkflowQueuedActionIfOwned(
    actionRun: AutomationActionRun,
    artifact: AppliedGeneratedArtifact | undefined,
  ): Promise<void> {
    const owned = await this.workflowQueuedActionForActionRun(actionRun);
    if (owned === undefined) {
      return;
    }
    const { workflow, action, turn } = owned;
    const capsule = turn.output_capsule_id === undefined ? undefined : await this.repository.getCodexRuntimeCapsule(turn.output_capsule_id);
    if (turn.status !== 'succeeded' || capsule === undefined || turn.output_capsule_digest !== capsule.digest) {
      await this.terminalizeWorkflowActionBestEffort(action, 'blocked', 'codex_runtime_capsule_missing');
      return;
    }

    if (artifact !== undefined && workflow.status !== artifact.to_status) {
      await this.applyPlanItemWorkflowRuntimeResultTransition({
        workflow_id: workflow.id,
        from_status: workflow.status,
        to_status: artifact.to_status,
        actor_id: action.created_by_actor_id,
        codex_session_id: action.codex_session_id,
        codex_session_turn_id: turn.id,
        evidence_object_type: artifact.object_type,
        evidence_object_id: artifact.object_id,
      });
    }

    await this.repository.terminalizePlanItemWorkflowQueuedAction({
      workflow_id: action.workflow_id,
      action_id: action.id,
      status: 'succeeded',
      codex_session_turn_id: turn.id,
      output_capsule_id: capsule.id,
      output_capsule_digest: capsule.digest,
      output_capsule_sequence: capsule.sequence,
      ...(turn.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: turn.codex_thread_id_digest }),
      now: this.now(),
    });
  }

  private async failPlanItemWorkflowQueuedActionIfOwned(actionRun: AutomationActionRun, reasonCode: string): Promise<void> {
    const owned = await this.workflowQueuedActionForActionRun(actionRun);
    if (owned === undefined) {
      return;
    }
    await this.terminalizeWorkflowActionBestEffort(owned.action, 'failed', reasonCode);
  }

  private async workflowQueuedActionForActionRun(actionRun: AutomationActionRun): Promise<
    | {
        workflow: NonNullable<Awaited<ReturnType<DeliveryRepository['getPlanItemWorkflow']>>>;
        action: PlanItemWorkflowQueuedAction;
        turn: NonNullable<Awaited<ReturnType<DeliveryRepository['getCodexSessionTurn']>>>;
      }
    | undefined
  > {
    if (
      actionRun.workflow_id === undefined ||
      actionRun.codex_session_id === undefined ||
      actionRun.codex_session_turn_id === undefined
    ) {
      return undefined;
    }
    const [workflow, turn, actions] = await Promise.all([
      this.repository.getPlanItemWorkflow(actionRun.workflow_id),
      this.repository.getCodexSessionTurn(actionRun.codex_session_turn_id),
      this.repository.listPlanItemWorkflowQueuedActions(actionRun.workflow_id),
    ]);
    if (
      workflow === undefined ||
      turn === undefined ||
      workflow.active_codex_session_id !== actionRun.codex_session_id ||
      turn.workflow_id !== actionRun.workflow_id ||
      turn.codex_session_id !== actionRun.codex_session_id
    ) {
      return undefined;
    }
    const planItemWorkflowActionId = this.planItemWorkflowActionIdForActionRun(actionRun);
    if (planItemWorkflowActionId === undefined) {
      return undefined;
    }
    const action = actions.find(
      (candidate) =>
        candidate.id === planItemWorkflowActionId &&
        candidate.status === 'running' &&
        candidate.codex_session_id === actionRun.codex_session_id &&
        candidate.codex_session_turn_id === actionRun.codex_session_turn_id,
    );
    return action === undefined ? undefined : { workflow, action, turn };
  }

  private planItemWorkflowActionIdForActionRun(actionRun: AutomationActionRun): string | undefined {
    const value = actionRun.action_input_json.plan_item_workflow_action_id;
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private runtimeJobActionBindingMatchesActionRun(runtimeJob: CodexRuntimeJob, actionRun: AutomationActionRun): boolean {
    if (runtimeJob.target_type !== 'automation_action_run' || runtimeJob.target_id !== actionRun.id) {
      return false;
    }
    const workload = runtimeJob.input_json as Partial<CodexGenerationWorkloadV1>;
    return workload.action_run_id === actionRun.id;
  }

  private async applyPlanItemWorkflowRuntimeResultTransition(input: {
    workflow_id: string;
    from_status: PlanItemWorkflowStatus;
    to_status: PlanItemWorkflowStatus;
    actor_id: string;
    codex_session_id: string;
    codex_session_turn_id: string;
    evidence_object_type: AppliedGeneratedArtifact['object_type'];
    evidence_object_id: string;
  }): Promise<void> {
    const now = this.now();
    const transition: PlanItemWorkflowTransition = {
      id: randomUUID(),
      workflow_id: input.workflow_id,
      from_status: input.from_status,
      to_status: input.to_status,
      actor_id: input.actor_id,
      evidence_object_type: input.evidence_object_type,
      evidence_object_id: input.evidence_object_id,
      codex_session_id: input.codex_session_id,
      codex_session_turn_id: input.codex_session_turn_id,
      reason: `Runtime generated ${input.evidence_object_type}.`,
      created_at: now,
    };
    assertPlanItemWorkflowTransitionAllowed(transition);
    await this.repository.applyPlanItemWorkflowTransition({
      transition,
      projection_patch: this.workflowProjectionPatchForArtifact(input.evidence_object_type, input.evidence_object_id),
    });
  }

  private workflowProjectionPatchForArtifact(
    objectType: AppliedGeneratedArtifact['object_type'],
    objectId: string,
  ): NonNullable<Parameters<DeliveryRepository['applyPlanItemWorkflowTransition']>[0]['projection_patch']> {
    if (objectType === 'boundary_summary_revision') {
      return { active_boundary_summary_revision_id: objectId };
    }
    if (objectType === 'spec_revision') {
      return { active_spec_doc_revision_id: objectId };
    }
    return { active_implementation_plan_doc_revision_id: objectId };
  }

  private async terminalizeWorkflowActionBestEffort(
    action: PlanItemWorkflowQueuedAction,
    status: 'failed' | 'blocked',
    reasonCode: string,
  ): Promise<void> {
    try {
      await this.repository.terminalizePlanItemWorkflowQueuedAction({
        workflow_id: action.workflow_id,
        action_id: action.id,
        status,
        ...(action.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: action.codex_session_turn_id }),
        blocked_reason_code: reasonCode,
        now: this.now(),
      });
    } catch (error) {
      if (!(error instanceof DomainError && error.code === 'workflow_invalid_transition')) {
        throw error;
      }
    }
  }

  private async clearCodexSessionRunnerOwnerAfterSuccessfulCompleteTurn(
    runtimeJob: CodexRuntimeJob,
    runtimeContext: NonNullable<CodexGenerationWorkloadV1['codex_session_runtime_context']>,
  ): Promise<void> {
    if (runtimeContext.turn_group_status !== 'complete') {
      return;
    }
    await this.clearCodexSessionRunnerOwnerAfterTerminalTurn({
      sessionId: runtimeContext.codex_session_id,
      runnerLaunchLeaseId: runtimeContext.runner_launch_lease_id ?? runtimeJob.launch_lease_id,
      reasonCode: 'codex_runtime_job_succeeded',
    });
  }

  private async clearCodexSessionRunnerOwnerAfterTerminalResultRejection(runtimeJob: CodexRuntimeJob): Promise<void> {
    const workload = runtimeJob.input_json as Partial<CodexGenerationWorkloadV1>;
    const runtimeContext = workload.codex_session_runtime_context;
    if (runtimeContext === undefined) {
      return;
    }
    await this.clearCodexSessionRunnerOwnerAfterTerminalTurn({
      sessionId: runtimeContext.codex_session_id,
      runnerLaunchLeaseId: runtimeContext.runner_launch_lease_id ?? runtimeJob.launch_lease_id,
      reasonCode: 'codex_runtime_job_unavailable',
    });
  }

  private async clearCodexSessionRunnerOwnerAfterTerminalTurn(input: {
    sessionId: string;
    runnerLaunchLeaseId?: string;
    reasonCode: string;
  }): Promise<void> {
    if (input.runnerLaunchLeaseId === undefined) {
      return;
    }
    try {
      await this.repository.clearCodexSessionRunnerOwner({
        session_id: input.sessionId,
        runner_launch_lease_id: input.runnerLaunchLeaseId,
        terminal_reason_code: input.reasonCode,
        now: this.now(),
      });
    } catch (error) {
      const session = await this.repository.getCodexSession(input.sessionId);
      if (
        error instanceof DomainError &&
        error.code === 'codex_session_runner_unavailable' &&
        session !== undefined &&
        session.runner_launch_lease_id === undefined &&
        session.runner_runtime_job_id === undefined &&
        session.runner_worker_id === undefined
      ) {
        return;
      }
      throw error;
    }
  }

  private async codexSessionTurnAlreadyTerminalizedByRuntimeResult(
    runtimeContext: NonNullable<CodexGenerationWorkloadV1['codex_session_runtime_context']>,
    threadEvidence: NonNullable<CodexGenerationRuntimeJobResult['codex_session_thread']>,
  ): Promise<boolean> {
    const [session, turn] = await Promise.all([
      this.repository.getCodexSession(runtimeContext.codex_session_id),
      this.repository.getCodexSessionTurn(runtimeContext.codex_session_turn_id),
    ]);
    return (
      session?.id === runtimeContext.codex_session_id &&
      session.codex_thread_id_digest === threadEvidence.codex_thread_id_digest &&
      turn?.id === runtimeContext.codex_session_turn_id &&
      turn.codex_session_id === runtimeContext.codex_session_id &&
      turn.status === 'succeeded' &&
      turn.lease_id === runtimeContext.lease_id &&
      turn.lease_epoch === runtimeContext.lease_epoch &&
      turn.codex_thread_id_digest === threadEvidence.codex_thread_id_digest
    );
  }

  private async recordStaleCodexSessionTerminalizationAttempt(input: {
    sessionId: string;
    turnId: string;
    leaseId: string;
    leaseEpoch: number;
    workerId: string;
    workerSessionDigest: string;
    expectedInputCapsuleDigest?: string;
    attemptedCodexThreadIdDigest?: string;
    failureCode: string;
  }): Promise<void> {
    await this.repository.withObjectLock(`codex-session:${input.sessionId}`, (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(async (repository) => {
        const now = this.now();
        const turn = await repository.getCodexSessionTurn(input.turnId);
        const safeTurn = turn !== undefined && turn.codex_session_id === input.sessionId ? turn : undefined;
        await repository.saveStaleCodexSessionTerminalizationAttempt({
          id: this.controlPlaneRuntime.id('codex-session-stale-terminalization'),
          codex_session_id: input.sessionId,
          ...(safeTurn === undefined ? {} : { codex_session_turn_id: safeTurn.id }),
          lease_id: input.leaseId,
          lease_epoch: input.leaseEpoch,
          worker_id: input.workerId,
          worker_session_digest: input.workerSessionDigest,
          ...(input.expectedInputCapsuleDigest === undefined
            ? {}
            : { expected_input_capsule_digest: input.expectedInputCapsuleDigest }),
          ...(input.attemptedCodexThreadIdDigest === undefined
            ? {}
            : { attempted_codex_thread_id_digest: input.attemptedCodexThreadIdDigest }),
          failure_code: input.failureCode,
          created_at: now,
        });
        if (safeTurn !== undefined) {
          await repository.markCodexSessionTurnStale({ session_id: input.sessionId, turn_id: safeTurn.id, now });
        }
      }),
    );
  }

  private generatedPayloadIsArtifactRef(payload: Record<string, unknown>): boolean {
    return payload.schema_version === 'generated_payload_ref.v1';
  }

  private async resolveGeneratedPayload(
    runtimeJobId: string,
    terminalResult: CodexGenerationRuntimeJobResult,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.generatedPayloadIsArtifactRef(terminalResult.generated_payload)) {
      return terminalResult.generated_payload;
    }
    const ref = this.generatedPayloadArtifactRef(terminalResult.generated_payload);
    if (ref === undefined) {
      return undefined;
    }
    const artifact = await this.repository.getCodexRuntimeJobArtifactByInternalRef({
      runtime_job_id: runtimeJobId,
      internal_ref: ref.internal_ref,
    });
    if (
      artifact === undefined ||
      artifact.kind !== 'generated_payload' ||
      artifact.content_type !== 'application/json' ||
      artifact.digest !== ref.digest
    ) {
      return undefined;
    }
    const stored = await this.readGeneratedPayloadArtifact(artifact.internal_ref);
    if (
      stored === undefined ||
      stored.artifact.id !== artifact.internal_artifact_object_id ||
      stored.artifact.digest !== artifact.digest ||
      stored.artifact.content_type !== artifact.content_type ||
      stored.artifact.size_bytes !== String(artifact.size_bytes)
    ) {
      return undefined;
    }
    const generatedPayload = stored.payload;
    if (codexCanonicalDigest(generatedPayload) !== terminalResult.generated_payload_digest) {
      return undefined;
    }
    return generatedPayload;
  }

  private generatedPayloadArtifactRef(
    payload: Record<string, unknown>,
  ): { internal_ref: string; digest: string } | undefined {
    if (!isRecord(payload.artifact)) {
      return undefined;
    }
    const artifact = payload.artifact;
    if (
      artifact.kind !== 'generated_payload' ||
      artifact.content_type !== 'application/json' ||
      typeof artifact.digest !== 'string' ||
      typeof artifact.internal_ref !== 'string'
    ) {
      return undefined;
    }
    return { internal_ref: artifact.internal_ref, digest: artifact.digest };
  }

  private async readGeneratedPayloadArtifact(
    internalRef: string,
  ): Promise<{ artifact: InternalArtifactObject; payload: Record<string, unknown> } | undefined> {
    try {
      const stored = await this.internalArtifacts.getObject(internalRef);
      const parsed: unknown = JSON.parse(Buffer.from(stored.bytes).toString('utf8'));
      if (!isRecord(parsed)) {
        return undefined;
      }
      return { artifact: stored.artifact, payload: parsed };
    } catch {
      return undefined;
    }
  }

  private now(): string {
    return process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();
  }

  private async completeProductActionIfOwned(
    actionRun: AutomationActionRun,
    outcome: ProductGenerationResultApplyOutcome,
  ): Promise<ProductGenerationResultApplyOutcome> {
    if (!this.isProductGenerationAction(actionRun.action_type) || actionRun.claim_token === undefined) {
      return outcome;
    }
    const current = await this.repository.getAutomationActionRun(actionRun.id);
    if (current?.status !== 'running' || current.claim_token !== actionRun.claim_token) {
      return outcome;
    }
    try {
      await this.repository.completeAutomationActionRun({
        id: current.id,
        idempotency_key: current.idempotency_key,
        claim_token: current.claim_token,
        status: outcome.applied ? 'succeeded' : 'failed',
        result_json: {
          product_generation_result: outcome.applied ? 'applied' : outcome.reason,
        },
        retryable: false,
        finished_at: this.now(),
      });
    } catch (error) {
      if (!(error instanceof DomainError && error.code === 'INVALID_TRANSITION')) {
        throw error;
      }
      const refreshed = await this.repository.getAutomationActionRun(actionRun.id);
      if (refreshed?.status !== 'succeeded' && refreshed?.status !== 'failed') {
        throw error;
      }
    }
    return outcome;
  }

  private isProductGenerationAction(actionType: string): boolean {
    return (
      actionType === 'run_boundary_brainstorming_round' ||
      actionType === 'generate_development_plan_item_spec_revision' ||
      actionType === 'generate_development_plan_item_implementation_plan_revision'
    );
  }

  private async wasProductGenerationResultApplied(actionRunId: string, runtimeJobId: string): Promise<boolean> {
    return (await this.repository.listObjectEvents(actionRunId, 'automation_action_run')).some(
      (event) => event.event_type === 'product_generation_result_applied' && event.metadata.runtime_job_id === runtimeJobId,
    );
  }
}
