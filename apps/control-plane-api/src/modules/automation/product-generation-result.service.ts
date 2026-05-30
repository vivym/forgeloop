import { Inject, Injectable } from '@nestjs/common';
import {
  validateBoundaryRoundRuntimeResult,
  validateGeneratedExecutionPlanRevision,
  validateGeneratedSpecRevision,
} from '@forgeloop/codex-runtime';
import {
  codexCanonicalDigest,
  DomainError,
  validateCodexRuntimeJobTerminalResult,
  type AutomationActionRun,
  type CodexGenerationRuntimeJobResult,
  type CodexRuntimeJob,
} from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';

import { BrainstormingService } from '../brainstorming/brainstorming.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { SpecPlanService } from '../spec-plan/spec-plan.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

@Injectable()
export class ProductGenerationResultService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(BrainstormingService) private readonly brainstormingService: BrainstormingService,
    @Inject(SpecPlanService) private readonly specPlanService: SpecPlanService,
  ) {}

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

    let outcome: ProductGenerationResultApplyOutcome;
    switch (terminalResult.task_kind) {
      case 'boundary_brainstorming_round': {
        const generatedPayload = await this.resolveGeneratedPayload(input.runtimeJobId, terminalResult);
        if (generatedPayload === undefined) {
          outcome = { applied: false, reason: 'unsupported_generated_payload_ref' };
          break;
        }
        const generated = this.validatePayload(() => validateBoundaryRoundRuntimeResult(generatedPayload));
        if (generated === undefined) {
          outcome = { applied: false, reason: 'public_unsafe_payload' };
          break;
        }
        outcome = await this.brainstormingService.applyBoundaryRoundRuntimeResult({
          actionRun,
          runtime_job_id: input.runtimeJobId,
          generated,
        });
        break;
      }
      case 'development_plan_item_spec_revision': {
        const generatedPayload = await this.resolveGeneratedPayload(input.runtimeJobId, terminalResult);
        if (generatedPayload === undefined) {
          outcome = { applied: false, reason: 'unsupported_generated_payload_ref' };
          break;
        }
        const generated = this.validatePayload(() => validateGeneratedSpecRevision(generatedPayload));
        if (generated === undefined) {
          outcome = { applied: false, reason: 'public_unsafe_payload' };
          break;
        }
        const result = await this.specPlanService.writeGeneratedItemSpecRevision({
          actionRun,
          runtime_job_id: input.runtimeJobId,
          generated,
        });
        outcome = result.applied ? { applied: true } : result;
        break;
      }
      case 'development_plan_item_execution_plan_revision': {
        const generatedPayload = await this.resolveGeneratedPayload(input.runtimeJobId, terminalResult);
        if (generatedPayload === undefined) {
          outcome = { applied: false, reason: 'unsupported_generated_payload_ref' };
          break;
        }
        const generated = this.validatePayload(() => validateGeneratedExecutionPlanRevision(generatedPayload));
        if (generated === undefined) {
          outcome = { applied: false, reason: 'public_unsafe_payload' };
          break;
        }
        const result = await this.specPlanService.writeGeneratedItemImplementationPlanRevision({
          actionRun,
          runtime_job_id: input.runtimeJobId,
          generated,
        });
        outcome = result.applied ? { applied: true } : result;
        break;
      }
      default:
        outcome = { applied: false, reason: 'legacy_generation_task_kind' };
    }
    return this.completeProductActionIfOwned(actionRun, outcome);
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
    const ref = this.generatedPayloadArtifactRef(terminalResult.generated_payload, terminalResult.generated_payload_digest);
    if (ref === undefined) {
      return undefined;
    }
    const artifact = (await this.repository.listCodexRuntimeJobArtifacts({ runtime_job_id: runtimeJobId })).find(
      (candidate) =>
        candidate.kind === 'generated_payload' &&
        candidate.content_type === 'application/json' &&
        candidate.digest === terminalResult.generated_payload_digest &&
        candidate.internal_ref === ref.internal_ref,
    );
    const generatedPayload = artifact?.metadata_json.generated_payload;
    if (!isRecord(generatedPayload) || codexCanonicalDigest(generatedPayload) !== terminalResult.generated_payload_digest) {
      return undefined;
    }
    return generatedPayload;
  }

  private generatedPayloadArtifactRef(
    payload: Record<string, unknown>,
    expectedDigest: string,
  ): { internal_ref: string } | undefined {
    if (!isRecord(payload.artifact)) {
      return undefined;
    }
    const artifact = payload.artifact;
    if (
      artifact.kind !== 'generated_payload' ||
      artifact.content_type !== 'application/json' ||
      artifact.digest !== expectedDigest ||
      typeof artifact.internal_ref !== 'string'
    ) {
      return undefined;
    }
    return { internal_ref: artifact.internal_ref };
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
