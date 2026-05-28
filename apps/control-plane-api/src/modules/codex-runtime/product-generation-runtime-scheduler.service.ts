import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeJobInputDigest,
  codexRuntimeNetworkPolicyDigest,
  codexWorkspaceAcquisitionDigest,
  normalizeCodexRuntimeNetworkPolicy,
  type AutomationActionRun,
  type CodexGenerationTaskKind,
  type CodexGenerationWorkloadV1,
  type CodexRuntimeJob,
  type ContextManifest,
} from '@forgeloop/domain';
import type { CreateOrReplayAutomationActionRunInput, DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';

const generationRuntimeProfileEnv = 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID';
const generationCredentialBindingEnv = 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID';
const runtimeJobTtlMs = 10 * 60 * 1000;
const claimTtlMs = runtimeJobTtlMs + 60 * 1000;

const optionalEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const stableUuid = (input: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const isoAfter = (now: string, durationMs: number): string => new Date(Date.parse(now) + durationMs).toISOString();

const networkProviderConfigDigest = (revision: Parameters<typeof normalizeCodexRuntimeNetworkPolicy>[0]): string | undefined => {
  const networkPolicy = normalizeCodexRuntimeNetworkPolicy(revision);
  return networkPolicy.mode === 'egress_allowlist' && networkPolicy.provider === 'docker_network_proxy'
    ? networkPolicy.provider_config.provider_config_digest
    : undefined;
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
  | 'worker_id'
  | 'launch_lease_id'
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
  }): Promise<ProductGenerationRuntimeScheduleResult> {
    const repository = input.repository ?? this.defaultRepository;
    const now = this.runtime.now();
    const repoIds = this.canonicalRepoIds(input.repo_ids);
    const actionRun = await repository.createOrReplayAutomationActionRun({
      ...input.action_run,
      now,
    });
    const claimToken = codexCanonicalDigest({
      kind: 'product_generation_action_claim',
      action_run_id: actionRun.id,
      idempotency_key: actionRun.idempotency_key,
    });
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
      claim_token: claimToken,
      locked_until: isoAfter(now, claimTtlMs),
      now,
    });
    const existingRuntimeJob = await this.findRuntimeJobForAction(repository, claimed, input.task_kind);
    if (claimed.claim_token === undefined) {
      if (existingRuntimeJob !== undefined) {
        return { action_run: this.redactActionClaim(claimed), runtime_job: this.publicRuntimeJob(existingRuntimeJob) };
      }
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
      now,
    });
    return { action_run: this.redactActionClaim(claimed), runtime_job: this.publicRuntimeJob(runtimeJob) };
  }

  async replay(input: {
    repository?: DeliveryRepository;
    action_run_id: string;
    runtime_job_id: string;
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
      runtimeJob.target_id !== actionRun.id
    ) {
      return undefined;
    }
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
      worker_id: job.worker_id,
      launch_lease_id: job.launch_lease_id,
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

  private findRuntimeJobForAction(
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
    const existingRuntimeJob = await input.repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
    const workerId =
      existingRuntimeJob?.worker_id ??
      (
        await input.repository.findAvailableCodexWorker({
          project_id: input.projectId,
          ...(repoId === undefined ? {} : { repo_id: repoId }),
          target_kind: 'generation',
          docker_image_digest: profileRevision.docker_image_digest,
          network_policy_digest: codexRuntimeNetworkPolicyDigest(profileRevision.network_policy),
          ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
          now: input.now,
        })
      )?.id;
    if (workerId === undefined) {
      throw new ForbiddenException('Codex worker unavailable for product generation runtime job');
    }
    const actionClaimToken = input.actionRun.claim_token;
    if (actionClaimToken === undefined) {
      throw new ForbiddenException('Product generation action claim is not active');
    }
    const jobCreatedAt = input.actionRun.claimed_at ?? input.actionRun.started_at ?? input.actionRun.created_at ?? input.now;
    const jobExpiresAt = isoAfter(jobCreatedAt, runtimeJobTtlMs);
    const signedContextRef = `artifact://codex-runtime-jobs/${runtimeJobId}/workload/signed-context`;
    const signedContextDigest = codexCanonicalDigest(input.signedContextJson);
    const workload: CodexGenerationWorkloadV1 = {
      schema_version: 'codex_generation_workload.v1',
      runtime_job_id: runtimeJobId,
      action_run_id: input.actionRun.id,
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
      expires_at: jobExpiresAt,
      now: input.now,
    });
    return result.runtime_job;
  }
}
