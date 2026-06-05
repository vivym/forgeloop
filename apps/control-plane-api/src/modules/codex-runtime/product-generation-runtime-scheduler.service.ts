import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeJobInputDigest,
  codexRuntimeNetworkPolicyDigest,
  codexWorkspaceAcquisitionDigest,
  DomainError,
  normalizeCodexRuntimeNetworkPolicy,
  type AutomationActionRun,
  type CodexGenerationTaskKind,
  type CodexSessionRuntimeContextV1,
  type CodexSessionTerminalizationV1,
  type CodexGenerationWorkloadV1,
  type CodexSession,
  type CodexSessionTurn,
  type CodexRuntimeJob,
  type ContextManifest,
} from '@forgeloop/domain';
import type { CreateOrReplayAutomationActionRunInput, DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import type { WorkflowChildContext } from '../brainstorming/brainstorming.service';

const generationRuntimeProfileEnv = 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID';
const generationCredentialBindingEnv = 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID';
const runtimeJobTtlMs = 10 * 60 * 1000;
const claimTtlMs = runtimeJobTtlMs + 60 * 1000;

const optionalEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

export const productGenerationRuntimeNowIso = (): string => process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();

const stableUuid = (input: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const isoAfter = (now: string, durationMs: number): string => new Date(Date.parse(now) + durationMs).toISOString();

const sessionLeaseToken = (input: Record<string, unknown>): string => codexCanonicalDigest({ kind: 'codex_session_lease_token', ...input });

const networkProviderConfigDigest = (revision: Parameters<typeof normalizeCodexRuntimeNetworkPolicy>[0]): string | undefined => {
  const networkPolicy = normalizeCodexRuntimeNetworkPolicy(revision);
  return networkPolicy.mode === 'egress_allowlist' && networkPolicy.provider === 'docker_network_proxy'
    ? networkPolicy.provider_config.provider_config_digest
    : undefined;
};

type CodexSessionSchedulingContext = {
  workflow_id: string;
  session: CodexSession;
  turn: CodexSessionTurn;
  continuation: CodexSessionRuntimeContextV1['continuation'];
  turn_group_status: CodexSessionRuntimeContextV1['turn_group_status'];
  required_worker_id?: string;
  runner_runtime_job_id?: string;
  runner_launch_lease_id?: string;
};

const generationCredentialIsUsable = async (
  repository: DeliveryRepository,
  input: {
    credential_binding_id: string;
    profile_id: string;
    project_id: string;
    repo_id?: string;
    now: string;
  },
): Promise<boolean> => {
  const credential = await repository.getCodexCredentialBindingPublic(input.credential_binding_id);
  return (
    credential !== undefined &&
    credential.profile_id === input.profile_id &&
    credential.project_id === input.project_id &&
    credential.purpose === 'model_provider' &&
    credential.active_version_id !== undefined &&
    credential.active_payload_digest !== undefined &&
    (credential.repo_id === undefined || credential.repo_id === input.repo_id)
  );
};

export type ProductGenerationRuntimeScheduleResult = {
  action_run: AutomationActionRun;
  runtime_job: PublicProductGenerationRuntimeJob;
};

export type PublicProductGenerationRuntimeJob = Pick<
  CodexRuntimeJob,
  | 'id'
  | 'target_type'
  | 'target_id'
  | 'target_kind'
  | 'project_id'
  | 'repo_id'
  | 'launch_attempt'
  | 'status'
  | 'input_digest'
  | 'created_at'
  | 'updated_at'
  | 'expires_at'
> & {
  input: {
    input_digest: string;
    schema_version?: unknown;
  };
  workspace_acquisition?: {
    workspace_acquisition_digest: string;
    schema_version?: unknown;
  };
};

@Injectable()
export class ProductGenerationRuntimeSchedulerService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly defaultRepository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
  ) {}

  async schedule(input: {
    repository?: DeliveryRepository;
    action_run: CreateOrReplayAutomationActionRunInput;
    task_kind: Extract<
      CodexGenerationTaskKind,
      'boundary_brainstorming_round' | 'development_plan_item_spec_revision' | 'development_plan_item_execution_plan_revision'
    >;
    prompt_version: string;
    output_schema_version: string;
    context_manifest: ContextManifest;
    signed_context_json: Record<string, unknown>;
    project_id: string;
    repo_ids: string[];
    policy_digests?: Record<string, string> | undefined;
    context?: WorkflowChildContext | undefined;
    codex_session_turn_group_status?: CodexSessionRuntimeContextV1['turn_group_status'];
  }): Promise<ProductGenerationRuntimeScheduleResult> {
    const repository = input.repository ?? this.defaultRepository;
    const now = productGenerationRuntimeNowIso();
    const repoIds = this.canonicalRepoIds(input.repo_ids);
    const actionRun = await repository.createOrReplayAutomationActionRun({
      ...input.action_run,
      now,
    });
    this.assertWorkflowContextMatchesActionRun(input.context, actionRun);
    const claimToken = codexCanonicalDigest({
      kind: 'product_generation_action_claim',
      action_run_id: actionRun.id,
      idempotency_key: actionRun.idempotency_key,
    });
    const actionRunForCurrentRequest = this.actionRunWithCurrentRequestWorkflowRefs(actionRun, input.action_run);
    const claimed = await repository.claimAutomationActionRun({
      id: actionRun.id,
      action_type: actionRun.action_type,
      target_object_type: actionRun.target_object_type,
      target_object_id: actionRun.target_object_id,
      ...(actionRun.target_revision_id === undefined ? {} : { target_revision_id: actionRun.target_revision_id }),
      ...(actionRun.target_version === undefined ? {} : { target_version: actionRun.target_version }),
      target_status: actionRun.target_status,
      idempotency_key: actionRun.idempotency_key,
      automation_scope: actionRun.automation_scope,
      automation_settings_version: actionRun.automation_settings_version,
      capability_fingerprint: actionRun.capability_fingerprint,
      precondition_fingerprint: actionRun.precondition_fingerprint,
      action_input_json: actionRun.action_input_json,
      ...(actionRunForCurrentRequest.workflow_id === undefined ? {} : { workflow_id: actionRunForCurrentRequest.workflow_id }),
      ...(actionRunForCurrentRequest.codex_session_id === undefined ? {} : { codex_session_id: actionRunForCurrentRequest.codex_session_id }),
      ...(actionRunForCurrentRequest.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: actionRunForCurrentRequest.codex_session_turn_id }),
      claim_token: claimToken,
      locked_until: isoAfter(now, claimTtlMs),
      now,
    });
    this.assertWorkflowContextMatchesActionRun(input.context, claimed);
    const existingRuntimeJob = await this.runtimeJobForAction(repository, claimed, input.task_kind);
    if (existingRuntimeJob !== undefined) {
      if (this.existingRuntimeJobCanBeReplayed(existingRuntimeJob, now)) {
        return { action_run: this.redactActionClaim(claimed), runtime_job: this.publicRuntimeJob(existingRuntimeJob) };
      }
      await repository.completeAutomationActionRun({
        id: claimed.id,
        idempotency_key: claimed.idempotency_key,
        claim_token: claimToken,
        status: 'failed',
        result_json: {
          product_generation_result: 'runtime_job_failed',
          runtime_job_id: existingRuntimeJob.id,
          reason_code: 'codex_runtime_job_expired',
        },
        retryable: true,
        next_attempt_at: now,
        finished_at: now,
      });
      const retryClaimed = await repository.claimAutomationActionRun({
        id: actionRun.id,
        action_type: actionRun.action_type,
        target_object_type: actionRun.target_object_type,
        target_object_id: actionRun.target_object_id,
        ...(actionRun.target_revision_id === undefined ? {} : { target_revision_id: actionRun.target_revision_id }),
        ...(actionRun.target_version === undefined ? {} : { target_version: actionRun.target_version }),
        target_status: actionRun.target_status,
        idempotency_key: actionRun.idempotency_key,
        automation_scope: actionRun.automation_scope,
        automation_settings_version: actionRun.automation_settings_version,
        capability_fingerprint: actionRun.capability_fingerprint,
        precondition_fingerprint: actionRun.precondition_fingerprint,
        action_input_json: actionRun.action_input_json,
        ...(actionRunForCurrentRequest.workflow_id === undefined ? {} : { workflow_id: actionRunForCurrentRequest.workflow_id }),
        ...(actionRunForCurrentRequest.codex_session_id === undefined ? {} : { codex_session_id: actionRunForCurrentRequest.codex_session_id }),
        ...(actionRunForCurrentRequest.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: actionRunForCurrentRequest.codex_session_turn_id }),
        claim_token: claimToken,
        locked_until: isoAfter(now, claimTtlMs),
        now,
      });
      this.assertWorkflowContextMatchesActionRun(input.context, retryClaimed);
      const runtimeJob = await this.createRuntimeJob({
        repository,
        actionRun: retryClaimed,
        taskKind: input.task_kind,
        promptVersion: input.prompt_version,
        outputSchemaVersion: input.output_schema_version,
        contextManifest: input.context_manifest,
        signedContextJson: input.signed_context_json,
        projectId: input.project_id,
        repoIds,
        policyDigests: input.policy_digests ?? {},
        context: input.context,
        ...(input.codex_session_turn_group_status === undefined
          ? {}
          : { codexSessionTurnGroupStatus: input.codex_session_turn_group_status }),
        now,
      });
      return { action_run: this.redactActionClaim(retryClaimed), runtime_job: this.publicRuntimeJob(runtimeJob) };
    }
    if (claimed.claim_token === undefined) {
      throw new ForbiddenException('Product generation action claim is not active');
    }
    const runtimeJob = await this.createRuntimeJob({
      repository,
      actionRun: claimed,
      taskKind: input.task_kind,
      promptVersion: input.prompt_version,
      outputSchemaVersion: input.output_schema_version,
      contextManifest: input.context_manifest,
      signedContextJson: input.signed_context_json,
      projectId: input.project_id,
      repoIds,
      policyDigests: input.policy_digests ?? {},
      context: input.context,
      ...(input.codex_session_turn_group_status === undefined
        ? {}
        : { codexSessionTurnGroupStatus: input.codex_session_turn_group_status }),
      now,
    });
    return { action_run: this.redactActionClaim(claimed), runtime_job: this.publicRuntimeJob(runtimeJob) };
  }

  private existingRuntimeJobCanBeReplayed(runtimeJob: CodexRuntimeJob, now: string): boolean {
    return runtimeJob.status === 'terminal' || runtimeJob.expires_at > now;
  }

  private actionRunWithCurrentRequestWorkflowRefs(
    actionRun: AutomationActionRun,
    request: CreateOrReplayAutomationActionRunInput,
  ): AutomationActionRun {
    const workflowOwned = actionRun.workflow_id !== undefined || actionRun.codex_session_id !== undefined || request.workflow_id !== undefined || request.codex_session_id !== undefined;
    if (!workflowOwned) {
      return actionRun;
    }
    return {
      ...actionRun,
      ...(request.workflow_id === undefined ? {} : { workflow_id: request.workflow_id }),
      ...(request.codex_session_id === undefined ? {} : { codex_session_id: request.codex_session_id }),
      ...(request.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: request.codex_session_turn_id }),
    };
  }

  async replay(input: {
    repository?: DeliveryRepository;
    action_run_id: string;
    runtime_job_id: string;
    context?: WorkflowChildContext;
  }): Promise<ProductGenerationRuntimeScheduleResult | undefined> {
    const repository = input.repository ?? this.defaultRepository;
    const [actionRun, runtimeJob] = await Promise.all([
      repository.getAutomationActionRun(input.action_run_id),
      repository.getCodexRuntimeJob({ runtime_job_id: input.runtime_job_id }),
    ]);
    if (
      actionRun === undefined ||
      runtimeJob === undefined ||
      runtimeJob.target_type !== 'automation_action_run' ||
      runtimeJob.target_kind !== 'generation' ||
      runtimeJob.target_id !== actionRun.id ||
      !this.existingRuntimeJobCanBeReplayed(runtimeJob, productGenerationRuntimeNowIso())
    ) {
      return undefined;
    }
    this.assertWorkflowContextMatchesActionRun(input.context, actionRun);
    return { action_run: this.redactActionClaim(actionRun), runtime_job: this.publicRuntimeJob(runtimeJob) };
  }

  private redactActionClaim(actionRun: AutomationActionRun): AutomationActionRun {
    const {
      claim_token: _claimToken,
      locked_until: _lockedUntil,
      last_heartbeat_at: _lastHeartbeatAt,
      ...redacted
    } = actionRun;
    return redacted;
  }

  private publicRuntimeJob(job: CodexRuntimeJob): PublicProductGenerationRuntimeJob {
    return {
      id: job.id,
      target_type: job.target_type,
      target_id: job.target_id,
      target_kind: job.target_kind,
      project_id: job.project_id,
      ...(job.repo_id === undefined ? {} : { repo_id: job.repo_id }),
      launch_attempt: job.launch_attempt,
      status: job.status,
      input_digest: job.input_digest,
      created_at: job.created_at,
      updated_at: job.updated_at,
      expires_at: job.expires_at,
      input: {
        input_digest: job.input_digest,
        ...(job.input_json.schema_version === undefined ? {} : { schema_version: job.input_json.schema_version }),
      },
      ...(job.workspace_acquisition_digest === undefined
        ? {}
        : {
            workspace_acquisition: {
              workspace_acquisition_digest: job.workspace_acquisition_digest,
              ...(job.workspace_acquisition_json?.schema_version === undefined
                ? {}
                : { schema_version: job.workspace_acquisition_json.schema_version }),
            },
          }),
    };
  }

  private canonicalRepoIds(repoIds: readonly string[]): string[] {
    return [...new Set(repoIds)].sort();
  }

  private runtimeJobIdForAction(actionRun: AutomationActionRun, taskKind: CodexGenerationTaskKind): string {
    return stableUuid({
      kind: 'product_generation_runtime_job',
      action_run_id: actionRun.id,
      action_attempt: actionRun.attempt,
      task_kind: taskKind,
    });
  }

  runtimeJobForAction(
    repository: DeliveryRepository,
    actionRun: AutomationActionRun,
    taskKind: CodexGenerationTaskKind,
  ): Promise<CodexRuntimeJob | undefined> {
    return repository.getCodexRuntimeJob({ runtime_job_id: this.runtimeJobIdForAction(actionRun, taskKind) });
  }

  private async createRuntimeJob(input: {
    repository: DeliveryRepository;
    actionRun: AutomationActionRun;
    taskKind: CodexGenerationTaskKind;
    promptVersion: string;
    outputSchemaVersion: string;
    contextManifest: ContextManifest;
    signedContextJson: Record<string, unknown>;
    projectId: string;
    repoIds: string[];
    policyDigests: Record<string, string>;
    context?: WorkflowChildContext | undefined;
    codexSessionTurnGroupStatus?: CodexSessionRuntimeContextV1['turn_group_status'];
    now: string;
  }): Promise<CodexRuntimeJob> {
    const repoIds = this.canonicalRepoIds(input.repoIds);
    const repoId = repoIds[0];
    const configuredRuntimeProfileId = optionalEnv(generationRuntimeProfileEnv);
    const configuredCredentialBindingId = optionalEnv(generationCredentialBindingEnv);
    let profileRevision = await input.repository.getActiveCodexRuntimeProfileRevision({
      project_id: input.projectId,
      ...(repoId === undefined ? {} : { repo_id: repoId }),
      target_kind: 'generation',
      ...(configuredRuntimeProfileId === undefined ? {} : { runtime_profile_id: configuredRuntimeProfileId }),
      now: input.now,
    });
    if (profileRevision === undefined) {
      profileRevision = await input.repository.getActiveCodexRuntimeProfileRevision({
        project_id: input.projectId,
        ...(repoId === undefined ? {} : { repo_id: repoId }),
        target_kind: 'generation',
        now: input.now,
      });
    }
    if (profileRevision === undefined) {
      throw new BadRequestException(`Codex generation runtime profile is not available: ${generationRuntimeProfileEnv}`);
    }

    const configuredCredentialUsable =
      configuredCredentialBindingId === undefined
        ? false
        : await generationCredentialIsUsable(input.repository, {
            credential_binding_id: configuredCredentialBindingId,
            profile_id: profileRevision.profile_id,
            project_id: input.projectId,
            ...(repoId === undefined ? {} : { repo_id: repoId }),
            now: input.now,
          });
    const credentialBindingId =
      configuredCredentialUsable && configuredCredentialBindingId !== undefined
        ? configuredCredentialBindingId
        : (
            await input.repository.listCodexCredentialBindingReadinessCandidates({
              project_id: input.projectId,
              ...(repoId === undefined ? {} : { repo_id: repoId }),
              runtime_profile_id: profileRevision.profile_id,
              target_kind: 'generation',
              now: input.now,
            })
          ).find((candidate) => candidate.purpose === 'model_provider')?.id;
    if (credentialBindingId === undefined) {
      throw new BadRequestException(`Codex generation credential binding is not configured: ${generationCredentialBindingEnv}`);
    }
    const credential = await input.repository.getCodexCredentialBindingPublic(credentialBindingId);
    if (
      credential === undefined ||
      credential.profile_id !== profileRevision.profile_id ||
      credential.project_id !== input.projectId ||
      credential.purpose !== 'model_provider' ||
      credential.active_version_id === undefined ||
      credential.active_payload_digest === undefined ||
      (credential.repo_id !== undefined && credential.repo_id !== repoId)
    ) {
      throw new BadRequestException('Codex generation credential binding fence was rejected');
    }
    const providerConfigDigest = networkProviderConfigDigest(profileRevision.network_policy);
    const runtimeJobId = this.runtimeJobIdForAction(input.actionRun, input.taskKind);
    const actionClaimToken = input.actionRun.claim_token;
    if (actionClaimToken === undefined) {
      throw new ForbiddenException('Product generation action claim is not active');
    }
    const codexSessionScheduling = await this.deriveCodexSessionSchedulingContext({
      repository: input.repository,
      actionRun: input.actionRun,
      ...(input.codexSessionTurnGroupStatus === undefined
        ? {}
        : { requestedTurnGroupStatus: input.codexSessionTurnGroupStatus }),
      now: input.now,
    });
    const workerTarget = {
      project_id: input.projectId,
      ...(repoId === undefined ? {} : { repo_id: repoId }),
      target_kind: 'generation' as const,
      docker_image_digest: profileRevision.docker_image_digest,
      network_policy_digest: codexRuntimeNetworkPolicyDigest(profileRevision.network_policy),
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      now: input.now,
    };
    const worker =
      codexSessionScheduling?.required_worker_id === undefined
        ? await input.repository.findAvailableCodexWorker(workerTarget)
        : await input.repository.findCodexWorkerForSessionRunner({
            ...workerTarget,
            worker_id: codexSessionScheduling.required_worker_id,
          });
    const workerId = worker?.id;
    if (workerId === undefined) {
      if (codexSessionScheduling !== undefined) {
        await this.failCodexSessionProductGenerationBeforeRuntimeJob({
          repository: input.repository,
          actionRun: input.actionRun,
          sessionId: codexSessionScheduling.session.id,
          turnId: codexSessionScheduling.turn.id,
          ...(codexSessionScheduling.turn.expected_input_capsule_digest === undefined
            ? {}
            : { expectedInputCapsuleDigest: codexSessionScheduling.turn.expected_input_capsule_digest }),
          workerId: codexSessionScheduling.required_worker_id ?? 'codex-session-worker-unavailable',
          now: input.now,
          reasonCode: 'codex_session_runner_unavailable',
        });
        throw new DomainError(
          'codex_session_runner_unavailable',
          `codex_session_runner_unavailable: Codex session ${codexSessionScheduling.session.id} runner worker is unavailable`,
        );
      }
      throw new ForbiddenException('Codex worker unavailable for product generation runtime job');
    }
    const codexSessionRuntime =
      codexSessionScheduling === undefined
        ? undefined
        : await this.deriveCodexSessionRuntime({
            repository: input.repository,
            scheduling: codexSessionScheduling,
            actionRun: input.actionRun,
            runtimeJobId,
            workerId,
            now: input.now,
          });
    const jobCreatedAt = input.actionRun.claimed_at ?? input.actionRun.started_at ?? input.actionRun.created_at ?? input.now;
    const jobExpiresAt = isoAfter(jobCreatedAt, runtimeJobTtlMs);
    const signedContextRef = `artifact://codex-runtime-jobs/${runtimeJobId}/workload/signed-context`;
    const signedContextDigest = codexCanonicalDigest(input.signedContextJson);
    const workload: CodexGenerationWorkloadV1 = {
      schema_version: 'codex_generation_workload.v1',
      runtime_job_id: runtimeJobId,
      action_run_id: input.actionRun.id,
      ...(input.context?.plan_item_workflow_action_id === undefined
        ? {}
        : { plan_item_workflow_action_id: input.context.plan_item_workflow_action_id }),
      task_kind: input.taskKind,
      prompt_version: input.promptVersion,
      output_schema_version: input.outputSchemaVersion,
      signed_context_ref: signedContextRef,
      signed_context_digest: signedContextDigest,
      prompt_template_digest: codexCanonicalDigest({
        task_kind: input.taskKind,
        prompt_version: input.promptVersion,
        output_schema_version: input.outputSchemaVersion,
      }),
      created_at: jobCreatedAt,
      expires_at: jobExpiresAt,
      ...(codexSessionRuntime === undefined
        ? {}
        : {
            codex_session_runtime_context: codexSessionRuntime.runtime_context,
            codex_session_terminalization: codexSessionRuntime.terminalization,
          }),
    };
    const workloadJson: Record<string, unknown> = { ...workload };
    const workspaceAcquisition = {
      schema_version: 'codex_generation_workspace_acquisition.v1',
      signed_context_ref: signedContextRef,
      signed_context_digest: signedContextDigest,
      signed_context_json: input.signedContextJson,
      repo_ids: repoIds,
      policy_digests: input.policyDigests,
    };
    const workspaceAcquisitionDigest = codexWorkspaceAcquisitionDigest(workspaceAcquisition);
    if (workspaceAcquisitionDigest === undefined) {
      throw new BadRequestException('Codex generation workspace acquisition digest is unavailable');
    }
    const result = await input.repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
      runtime_job_id: runtimeJobId,
      launch_lease_id: stableUuid({ kind: 'product_generation_launch_lease', runtime_job_id: runtimeJobId }),
      envelope_id: stableUuid({ kind: 'product_generation_launch_envelope', runtime_job_id: runtimeJobId }),
      job_request_id: `product-generation:${input.actionRun.id}:${input.actionRun.attempt}:${input.taskKind}`,
      target: {
        target_type: 'automation_action_run',
        target_id: input.actionRun.id,
        target_kind: 'generation',
        project_id: input.projectId,
        ...(repoId === undefined ? {} : { repo_id: repoId }),
      },
      launch_attempt: input.actionRun.attempt,
      worker_id: workerId,
      runtime_profile_revision_id: profileRevision.id,
      runtime_profile_digest: profileRevision.profile_digest,
      credential_binding_id: credential.id,
      credential_binding_version_id: credential.active_version_id,
      credential_payload_digest: credential.active_payload_digest,
      docker_image_digest: profileRevision.docker_image_digest,
      network_policy_digest: codexRuntimeNetworkPolicyDigest(profileRevision.network_policy),
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      input_json: workloadJson,
      input_digest: codexRuntimeJobInputDigest(workloadJson),
      workspace_acquisition_json: workspaceAcquisition,
      workspace_acquisition_digest: workspaceAcquisitionDigest,
      action_type: input.actionRun.action_type,
      action_attempt: input.actionRun.attempt,
      action_claim_token_hash: codexCredentialPayloadDigest(actionClaimToken),
      precondition_fingerprint: input.actionRun.precondition_fingerprint,
      ...(input.actionRun.workflow_id === undefined
        ? {}
        : { workflow_id: input.actionRun.workflow_id, codex_session_id: input.actionRun.codex_session_id }),
      ...(input.actionRun.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: input.actionRun.codex_session_turn_id }),
      expires_at: jobExpiresAt,
      now: input.now,
    });
    return result.runtime_job;
  }

  private async deriveCodexSessionSchedulingContext(input: {
    repository: DeliveryRepository;
    actionRun: AutomationActionRun;
    requestedTurnGroupStatus?: CodexSessionRuntimeContextV1['turn_group_status'];
    now: string;
  }): Promise<CodexSessionSchedulingContext | undefined> {
    const { workflow_id: workflowId, codex_session_id: sessionId, codex_session_turn_id: turnId } = input.actionRun;
    if (workflowId === undefined && sessionId === undefined && turnId === undefined) {
      return undefined;
    }
    if (workflowId === undefined || sessionId === undefined || turnId === undefined) {
      throw new DomainError(
        'workflow_legacy_entrypoint_disabled',
        'workflow_legacy_entrypoint_disabled: CodexSession generation refs must be complete',
      );
    }
    const [session, turn] = await Promise.all([
      input.repository.getCodexSession(sessionId),
      input.repository.getCodexSessionTurn(turnId),
    ]);
    if (session === undefined || turn === undefined || turn.codex_session_id !== session.id || turn.workflow_id !== workflowId) {
      throw new DomainError(
        'workflow_legacy_entrypoint_disabled',
        'workflow_legacy_entrypoint_disabled: CodexSession generation turn must match action run refs',
      );
    }
    const hasThreadId = session.codex_thread_id !== undefined;
    const hasThreadDigest = session.codex_thread_id_digest !== undefined;
    if (hasThreadId !== hasThreadDigest) {
      await this.failCodexSessionProductGenerationBeforeRuntimeJob({
        repository: input.repository,
        actionRun: input.actionRun,
        sessionId,
        turnId,
        ...(turn.expected_input_capsule_digest === undefined
          ? {}
          : { expectedInputCapsuleDigest: turn.expected_input_capsule_digest }),
        workerId: session.runner_worker_id ?? 'codex-session-thread-binding-partial',
        now: input.now,
        reasonCode: 'codex_session_thread_binding_partial',
      });
      throw new DomainError(
        'codex_session_thread_binding_partial',
        `codex_session_thread_binding_partial: Codex session ${session.id} has a partial thread binding`,
      );
    }

    const continuation: CodexSessionRuntimeContextV1['continuation'] =
      hasThreadId && hasThreadDigest
        ? {
            kind: 'resume_thread',
            codex_thread_id: session.codex_thread_id as string,
            codex_thread_id_digest: session.codex_thread_id_digest as string,
          }
        : { kind: 'start_thread' };
    if (continuation.kind === 'resume_thread') {
      const missingContinuationReason =
        session.latest_capsule_id === undefined || session.latest_capsule_digest === undefined
          ? 'codex_runtime_capsule_missing'
          : session.latest_memory_bundle_ref === undefined || session.latest_memory_bundle_digest === undefined
            ? 'codex_memory_bundle_missing'
            : session.latest_environment_manifest_ref === undefined || session.latest_environment_manifest_digest === undefined
              ? 'codex_environment_manifest_missing'
              : undefined;
      if (missingContinuationReason !== undefined) {
        await this.failCodexSessionProductGenerationBeforeRuntimeJob({
          repository: input.repository,
          actionRun: input.actionRun,
          sessionId,
          turnId,
          ...(turn.expected_input_capsule_digest === undefined
            ? {}
            : { expectedInputCapsuleDigest: turn.expected_input_capsule_digest }),
          workerId: session.runner_worker_id ?? 'codex-session-continuation-input-missing',
          now: input.now,
          reasonCode: missingContinuationReason,
        });
        throw new DomainError(
          missingContinuationReason,
          `${missingContinuationReason}: Codex session ${session.id} resume continuation inputs are unavailable`,
        );
      }
      const liveRunnerOwner =
        session.runner_worker_id !== undefined &&
        session.runner_runtime_job_id !== undefined &&
        session.runner_launch_lease_id !== undefined &&
        session.runner_expires_at !== undefined &&
        session.runner_expires_at > input.now
          ? {
              required_worker_id: session.runner_worker_id,
              runner_runtime_job_id: session.runner_runtime_job_id,
              runner_launch_lease_id: session.runner_launch_lease_id,
            }
          : undefined;
      return {
        workflow_id: workflowId,
        session,
        turn,
        continuation,
        turn_group_status: this.deriveTurnGroupStatus({
          actionRun: input.actionRun,
          turn,
          ...(input.requestedTurnGroupStatus === undefined ? {} : { requested: input.requestedTurnGroupStatus }),
        }),
        ...(liveRunnerOwner === undefined ? {} : liveRunnerOwner),
      };
    }
    return {
      workflow_id: workflowId,
      session,
      turn,
      continuation,
      turn_group_status: this.deriveTurnGroupStatus({
        actionRun: input.actionRun,
        turn,
        ...(input.requestedTurnGroupStatus === undefined ? {} : { requested: input.requestedTurnGroupStatus }),
      }),
    };
  }

  private async deriveCodexSessionRuntime(input: {
    repository: DeliveryRepository;
    scheduling: CodexSessionSchedulingContext;
    actionRun: AutomationActionRun;
    runtimeJobId: string;
    workerId: string;
    now: string;
  }): Promise<{
    worker_id: string;
    runtime_context: CodexSessionRuntimeContextV1;
    terminalization: CodexSessionTerminalizationV1;
  }> {
    const { session, turn, continuation } = input.scheduling;
    const leaseToken = sessionLeaseToken({
      action_run_id: input.actionRun.id,
      runtime_job_id: input.runtimeJobId,
      codex_session_id: session.id,
      codex_session_turn_id: turn.id,
      attempt: input.actionRun.attempt,
    });
    const workerSessionDigest = await input.repository.getCodexWorkerSessionDigest(input.workerId);
    if (workerSessionDigest === undefined) {
      await this.failCodexSessionProductGenerationBeforeRuntimeJob({
        repository: input.repository,
        actionRun: input.actionRun,
        sessionId: session.id,
        turnId: turn.id,
        ...(turn.expected_input_capsule_digest === undefined
          ? {}
          : { expectedInputCapsuleDigest: turn.expected_input_capsule_digest }),
        workerId: input.workerId,
        now: input.now,
        reasonCode: 'codex_session_runner_unavailable',
      });
      throw new DomainError(
        'codex_session_runner_unavailable',
        `codex_session_runner_unavailable: Codex worker ${input.workerId} session digest is unavailable`,
      );
    }
    const claimed = await input.repository.claimCodexSessionLease({
      session_id: session.id,
      workflow_id: input.scheduling.workflow_id,
      lease_id: stableUuid({ kind: 'product_generation_codex_session_lease', runtime_job_id: input.runtimeJobId }),
      lease_token_hash: codexCredentialPayloadDigest(leaseToken),
      worker_id: input.workerId,
      worker_session_digest: workerSessionDigest,
      ...(turn.expected_input_capsule_digest === undefined
        ? {}
        : { expected_input_capsule_digest: turn.expected_input_capsule_digest }),
      now: input.now,
      expires_at: isoAfter(input.now, runtimeJobTtlMs),
    });
    return {
      worker_id: input.workerId,
      runtime_context: {
        schema_version: 'codex_session_runtime_context.v1',
        codex_session_id: session.id,
        codex_session_turn_id: turn.id,
        lease_id: claimed.lease.id,
        lease_epoch: claimed.lease.lease_epoch,
        worker_id: input.workerId,
        worker_session_digest: claimed.lease.worker_session_digest,
        ...(turn.expected_input_capsule_digest === undefined
          ? {}
          : { expected_input_capsule_digest: turn.expected_input_capsule_digest }),
        ...(input.scheduling.runner_runtime_job_id === undefined
          ? {}
          : { runner_runtime_job_id: input.scheduling.runner_runtime_job_id }),
        ...(input.scheduling.runner_launch_lease_id === undefined
          ? {}
          : { runner_launch_lease_id: input.scheduling.runner_launch_lease_id }),
        turn_group_status: input.scheduling.turn_group_status,
        continuation,
      },
      terminalization: {
        schema_version: 'codex_session_terminalization.v1',
        lease_token: leaseToken,
        codex_session_id: session.id,
        codex_session_turn_id: turn.id,
        ...(turn.expected_input_capsule_digest === undefined
          ? {}
          : { expected_input_capsule_digest: turn.expected_input_capsule_digest }),
        ...(turn.input_capsule_id === undefined ? {} : { input_capsule_id: turn.input_capsule_id }),
        ...(turn.input_capsule_digest === undefined ? {} : { input_capsule_digest: turn.input_capsule_digest }),
        ...(turn.input_capsule_id === undefined
          ? {}
          : { input_capsule_ref: `artifact://internal/codex_runtime_capsule/codex_session/${session.id}/${turn.input_capsule_id}` }),
        ...(turn.base_memory_bundle_ref === undefined ? {} : { base_memory_bundle_ref: turn.base_memory_bundle_ref }),
        ...(turn.base_memory_bundle_digest === undefined ? {} : { base_memory_bundle_digest: turn.base_memory_bundle_digest }),
        ...(turn.input_memory_bundle_ref === undefined ? {} : { input_memory_bundle_ref: turn.input_memory_bundle_ref }),
        ...(turn.input_memory_bundle_digest === undefined ? {} : { input_memory_bundle_digest: turn.input_memory_bundle_digest }),
        ...(turn.input_environment_manifest_ref === undefined ? {} : { input_environment_manifest_ref: turn.input_environment_manifest_ref }),
        ...(turn.input_environment_manifest_digest === undefined
          ? {}
          : { input_environment_manifest_digest: turn.input_environment_manifest_digest }),
      },
    };
  }

  private async failCodexSessionProductGenerationBeforeRuntimeJob(input: {
    repository: DeliveryRepository;
    actionRun: AutomationActionRun;
    sessionId: string;
    turnId: string;
    expectedInputCapsuleDigest?: string;
    workerId: string;
    now: string;
    reasonCode: string;
  }): Promise<void> {
    if (input.actionRun.claim_token === undefined) {
      return;
    }
    const leaseToken = sessionLeaseToken({
      action_run_id: input.actionRun.id,
      codex_session_id: input.sessionId,
      codex_session_turn_id: input.turnId,
      reason_code: input.reasonCode,
    });
    const workerSessionDigest = codexCredentialPayloadDigest({
      worker_id: input.workerId,
      action_run_id: input.actionRun.id,
      reason_code: input.reasonCode,
    });
    const claimed = await input.repository.claimCodexSessionLease({
      session_id: input.sessionId,
      workflow_id: input.actionRun.workflow_id as string,
      lease_id: stableUuid({ kind: 'failed_product_generation_codex_session_lease', action_run_id: input.actionRun.id }),
      lease_token_hash: codexCredentialPayloadDigest(leaseToken),
      worker_id: input.workerId,
      worker_session_digest: workerSessionDigest,
      ...(input.expectedInputCapsuleDigest === undefined
        ? {}
        : { expected_input_capsule_digest: input.expectedInputCapsuleDigest }),
      now: input.now,
      expires_at: isoAfter(input.now, runtimeJobTtlMs),
    });
    await input.repository.terminalizeCodexSessionTurn({
      session_id: input.sessionId,
      turn_id: input.turnId,
      lease_id: claimed.lease.id,
      lease_token_hash: claimed.lease.lease_token_hash,
      lease_epoch: claimed.lease.lease_epoch,
      worker_id: claimed.lease.worker_id,
      worker_session_digest: claimed.lease.worker_session_digest,
      status: 'failed',
      ...(input.expectedInputCapsuleDigest === undefined
        ? {}
        : { expected_input_capsule_digest: input.expectedInputCapsuleDigest }),
      failure_code: input.reasonCode,
      now: input.now,
    });
    await input.repository.completeAutomationActionRun({
      id: input.actionRun.id,
      idempotency_key: input.actionRun.idempotency_key,
      claim_token: input.actionRun.claim_token,
      status: 'failed',
      result_json: {
        product_generation_result: 'runtime_job_failed',
        reason_code: input.reasonCode,
      },
      retryable: true,
      finished_at: input.now,
    });
  }

  private deriveTurnGroupStatus(input: {
    actionRun: AutomationActionRun;
    turn: CodexSessionTurn;
    requested?: CodexSessionRuntimeContextV1['turn_group_status'];
  }): CodexSessionRuntimeContextV1['turn_group_status'] {
    if (input.requested !== undefined) {
      return input.requested;
    }
    if (input.turn.intent === 'execute_plan' || input.turn.intent === 'continue_execution' || input.turn.intent === 'address_review_feedback') {
      return 'complete';
    }
    return 'intermediate';
  }

  private assertWorkflowContextMatchesActionRun(
    context: WorkflowChildContext | undefined,
    actionRun: AutomationActionRun,
  ): void {
    const hasWorkflowRefs =
      actionRun.workflow_id !== undefined ||
      actionRun.codex_session_id !== undefined ||
      actionRun.codex_session_turn_id !== undefined ||
      context !== undefined;
    if (!hasWorkflowRefs) {
      return;
    }
    const refsComplete =
      actionRun.workflow_id !== undefined &&
      actionRun.codex_session_id !== undefined &&
      actionRun.codex_session_turn_id !== undefined &&
      context?.workflow_id !== undefined &&
      context.codex_session_id !== undefined &&
      context.codex_session_turn_id !== undefined;
    if (
      refsComplete &&
      actionRun.workflow_id === context.workflow_id &&
      actionRun.codex_session_id === context.codex_session_id &&
      actionRun.codex_session_turn_id === context.codex_session_turn_id &&
      (context.plan_item_workflow_action_id === undefined ||
        actionRun.action_input_json.plan_item_workflow_action_id === context.plan_item_workflow_action_id)
    ) {
      return;
    }
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      'workflow_legacy_entrypoint_disabled: Product generation runtime refs must match the claimed PlanItemWorkflow action run',
    );
  }
}
