import { Inject, Injectable } from '@nestjs/common';
import { Buffer } from 'node:buffer';
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
  validateCodexRuntimeJobTerminalResult,
  type AutomationActionRun,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexRuntimeJob,
  type InternalArtifactObject,
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
  'codex_session_snapshot_stale',
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
      await this.clearCodexSessionRunnerOwnerAfterTerminalResultRejection(activeFence.runtime_job);
      return this.completeProductActionIfOwned(actionRun, outcome);
    }
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
  ): Promise<ProductGenerationResultApplyOutcome> {
    switch (prepared.task_kind) {
      case 'boundary_brainstorming_round':
        return this.brainstormingService.applyBoundaryRoundRuntimeResult({
          actionRun,
          runtime_job_id: runtimeJobId,
          generated: prepared.generated,
        });
      case 'development_plan_item_spec_revision': {
        const result = await this.specPlanService.writeGeneratedItemSpecRevision({
          actionRun,
          runtime_job_id: runtimeJobId,
          generated: prepared.generated,
        });
        return result.applied ? { applied: true } : result;
      }
      case 'development_plan_item_execution_plan_revision': {
        const result = await this.specPlanService.writeGeneratedItemImplementationPlanRevision({
          actionRun,
          runtime_job_id: runtimeJobId,
          generated: prepared.generated,
        });
        return result.applied ? { applied: true } : result;
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
    if (threadEvidence === undefined) {
      await this.failCodexSessionTurnFromRuntimeResult({
        runtimeJob,
        runtimeContext,
        terminalization,
        reasonCode: 'codex_app_server_thread_id_missing',
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
        ...(runtimeContext.expected_previous_snapshot_digest === undefined
          ? {}
          : { expected_previous_snapshot_digest: runtimeContext.expected_previous_snapshot_digest }),
        app_server_thread_binding_required: true,
        codex_thread_id: threadEvidence.codex_thread_id,
        codex_thread_id_digest: threadEvidence.codex_thread_id_digest,
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
        ...(runtimeContext.expected_previous_snapshot_digest === undefined
          ? {}
          : { expectedPreviousSnapshotDigest: runtimeContext.expected_previous_snapshot_digest }),
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
        ...(runtimeContext.expected_previous_snapshot_digest === undefined
          ? {}
          : { expected_previous_snapshot_digest: runtimeContext.expected_previous_snapshot_digest }),
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
        ...(runtimeContext.expected_previous_snapshot_digest === undefined
          ? {}
          : { expectedPreviousSnapshotDigest: runtimeContext.expected_previous_snapshot_digest }),
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
    expectedPreviousSnapshotDigest?: string;
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
          ...(input.expectedPreviousSnapshotDigest === undefined
            ? {}
            : { expected_previous_snapshot_digest: input.expectedPreviousSnapshotDigest }),
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
