import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  validateCodexLaunchTargetKind,
  validateCodexRuntimeProfileRevision,
  type CodexCredentialBinding,
  type CodexCredentialBindingVersion,
  type CodexLaunchTarget,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type CodexRuntimeScope,
  type CodexRuntimeTargetKind,
} from '@forgeloop/domain';
import type { CodexLaunchFenceSnapshot, DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type {
  CodexRuntimeStatusQuery,
  CreateCodexCredentialDto,
  CreateCodexLaunchLeaseDto,
  CreateCodexRuntimeProfileDto,
  CreateCodexWorkerBootstrapTokenDto,
  HeartbeatCodexWorkerDto,
  MaterializeCodexLaunchLeaseDto,
  RecoverStaleCodexWorkersDto,
  RegisterCodexWorkerDto,
  RevokeCodexLaunchLeaseDto,
  TerminalizeCodexLaunchLeaseDto,
} from './codex-runtime.dto';

const unsafeDbCredentialStoreEnv = 'FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE';

const unsafeEvidenceTerms = [
  'secret',
  'token',
  'auth',
  'api_key',
  'password',
  'raw_prompt',
  'raw_codex_log',
  'container_id',
  'socket_path',
  'host_path',
];

const nowIso = (): string => process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();

const unsafeDbCredentialStoreEnabled = (): boolean => process.env[unsafeDbCredentialStoreEnv] === '1';

const requireUnsafeDbCredentialStore = (): void => {
  if (!unsafeDbCredentialStoreEnabled()) {
    throw new ForbiddenException(`${unsafeDbCredentialStoreEnv}=1 is required for unsafe_db Codex credential material`);
  }
};

const actorScopeMatchesTarget = (automationScope: string, projectId: string, repoId?: string): boolean => {
  if (repoId !== undefined) {
    return automationScope === `repo:${projectId}:${repoId}`;
  }
  return automationScope === `project:${projectId}` || automationScope.startsWith(`repo:${projectId}:`);
};

const networkProviderConfigDigest = (revision: CodexRuntimeProfileRevision): string | undefined =>
  revision.network_policy.mode === 'docker_network_proxy'
    ? revision.network_policy.provider_config.provider_config_digest
    : undefined;

const hasUnsafeEvidence = (value: unknown): boolean => {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return unsafeEvidenceTerms.some((term) => lower.includes(term));
  }
  if (Array.isArray(value)) {
    return value.some(hasUnsafeEvidence);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
      const lowerKey = key.toLowerCase();
      return unsafeEvidenceTerms.some((term) => lowerKey.includes(term)) || hasUnsafeEvidence(entry);
    });
  }
  return false;
};

const publicCredentialVersion = (version: CodexCredentialBindingVersion): CodexCredentialBindingVersion => ({
  id: version.id,
  binding_id: version.binding_id,
  version_number: version.version_number,
  status: version.status,
  payload_digest: version.payload_digest,
  created_by_actor_id: version.created_by_actor_id,
  created_at: version.created_at,
});

@Injectable()
export class CodexRuntimeService {
  private readonly leaseFences = new Map<string, CodexLaunchFenceSnapshot>();
  private readonly leaseCredentialProviders = new Map<string, string>();

  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async createProfile(input: CreateCodexRuntimeProfileDto) {
    const revision = validateCodexRuntimeProfileRevision(input.revision as unknown as CodexRuntimeProfileRevision);
    const profileRevision = await this.repository.createCodexRuntimeProfileWithRevision({
      profile: input.profile as CodexRuntimeProfile,
      revision,
    });
    return { profile_revision: profileRevision };
  }

  async createCredential(input: CreateCodexCredentialDto) {
    if (input.binding.provider === 'unsafe_db') {
      requireUnsafeDbCredentialStore();
    }
    const version = await this.repository.createCodexCredentialBindingWithVersion({
      binding: input.binding as CodexCredentialBinding,
      version: input.version as CodexCredentialBindingVersion,
      secret_payload_json: input.secret_payload_json,
    });
    return {
      credential_binding: input.binding,
      credential_binding_version: publicCredentialVersion(version),
    };
  }

  async createWorkerBootstrapToken(input: CreateCodexWorkerBootstrapTokenDto) {
    const token = await this.repository.createCodexWorkerBootstrapToken({
      id: input.id,
      worker_identity: input.worker_identity,
      bootstrap_token_hash: input.bootstrap_token_hash,
      bootstrap_token_version: input.bootstrap_token_version,
      status: input.status ?? 'active',
      allowed_scopes_json: input.allowed_scopes_json as readonly CodexRuntimeScope[],
      allowed_capabilities_json: input.allowed_capabilities_json,
      created_by_actor_id: input.created_by_actor_id,
      created_at: input.created_at ?? nowIso(),
      expires_at: input.expires_at,
      ...(input.revoked_at === undefined ? {} : { revoked_at: input.revoked_at }),
    });
    return { bootstrap_token: token };
  }

  getStatus(query: CodexRuntimeStatusQuery) {
    return this.repository.getCodexRuntimeStatus({
      project_id: query.project_id,
      ...(query.repo_id === undefined ? {} : { repo_id: query.repo_id }),
      target_kind: query.target_kind,
      ...(query.runtime_profile_id === undefined ? {} : { runtime_profile_id: query.runtime_profile_id }),
      ...(query.credential_binding_id === undefined ? {} : { credential_binding_id: query.credential_binding_id }),
      now: nowIso(),
    });
  }

  recoverStaleWorkers(input: RecoverStaleCodexWorkersDto) {
    return this.repository.recoverStaleCodexWorkerLeases({
      stale_before: input.stale_before,
      now: input.now ?? nowIso(),
      ...(input.worker_id === undefined ? {} : { worker_id: input.worker_id }),
      reason_code: input.reason_code,
    });
  }

  async registerWorker(input: RegisterCodexWorkerDto) {
    const worker = await this.repository.upsertCodexWorkerRegistration({
      worker_id: input.worker_id,
      worker_identity: input.worker_identity,
      version: input.version,
      bootstrap_token_hash: codexCredentialPayloadDigest(input.bootstrap_token),
      bootstrap_token_version: input.bootstrap_token_version,
      session_token: input.session_token,
      status: input.status,
      control_channel_status: input.control_channel_status,
      allowed_scopes: input.allowed_scopes as readonly CodexRuntimeScope[],
      capabilities: input.capabilities as readonly CodexRuntimeTargetKind[],
      docker_image_digests: input.docker_image_digests,
      network_policy_digests: input.network_policy_digests,
      ...(input.network_provider_config_digests === undefined
        ? {}
        : { network_provider_config_digests: input.network_provider_config_digests }),
      host_worker_uid: input.host_worker_uid,
      host_worker_gid: input.host_worker_gid,
      lease_count: input.lease_count,
      max_concurrency: input.max_concurrency,
      ...(input.labels === undefined ? {} : { labels: input.labels }),
      session_public_key_id: input.session_public_key_id,
      session_public_key_algorithm: input.session_public_key_algorithm,
      session_public_key_material: input.session_public_key_material,
      session_public_key_expires_at: input.session_public_key_expires_at,
      now: nowIso(),
    });
    return { worker, session_token: input.session_token };
  }

  heartbeatWorker(workerId: string, input: HeartbeatCodexWorkerDto) {
    return this.repository
      .heartbeatCodexWorker({
        worker_id: workerId,
        session_token: input.session_token,
        nonce: input.nonce,
        nonce_timestamp: input.nonce_timestamp,
        status: input.status,
        control_channel_status: input.control_channel_status,
        active_lease_count: input.active_lease_count,
        capabilities: input.capabilities as readonly CodexRuntimeTargetKind[],
        now: nowIso(),
      })
      .then((worker) => ({ worker }));
  }

  async createLaunchLease(input: CreateCodexLaunchLeaseDto) {
    validateCodexLaunchTargetKind(input.target.target_type, input.target.target_kind);
    const now = nowIso();
    const revision = await this.repository.getActiveCodexRuntimeProfileRevision({
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
      target_kind: input.target.target_kind,
      now,
    });
    if (revision === undefined || revision.id !== input.runtime_profile_revision_id) {
      throw new BadRequestException('Codex runtime profile revision fence was rejected');
    }

    const credential = await this.repository.getCodexCredentialBindingPublic(input.credential_binding_id);
    if (
      credential === undefined ||
      credential.active_version_id !== input.credential_binding_version_id ||
      credential.active_payload_digest !== input.credential_payload_digest
    ) {
      throw new BadRequestException('Codex credential binding fence was rejected');
    }

    const fence = await this.launchFenceFor(input, now);
    const target: CodexLaunchTarget = {
      target_type: input.target.target_type,
      target_id: input.target.target_id,
      target_kind: input.target.target_kind,
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
    };
    const providerConfigDigest = networkProviderConfigDigest(revision);
    const lease = await this.repository.createOrReplayCodexLaunchLease({
      id: input.id,
      lease_request_id: input.lease_request_id,
      target,
      worker_id: input.worker_id,
      runtime_profile_revision_id: input.runtime_profile_revision_id,
      runtime_profile_digest: revision.profile_digest,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      credential_payload_digest: input.credential_payload_digest,
      docker_image_digest: revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(revision.network_policy),
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      launch_token: input.launch_token,
      ...(input.action_type === undefined ? {} : { action_type: input.action_type }),
      ...(input.action_attempt === undefined ? {} : { action_attempt: input.action_attempt }),
      ...(fence.action_claim_token_hash === undefined ? {} : { action_claim_token_hash: fence.action_claim_token_hash }),
      ...(fence.precondition_fingerprint === undefined ? {} : { precondition_fingerprint: fence.precondition_fingerprint }),
      ...(input.execution_package_id === undefined ? {} : { execution_package_id: input.execution_package_id }),
      ...(fence.run_worker_lease_id === undefined ? {} : { run_worker_lease_id: fence.run_worker_lease_id }),
      ...(fence.run_worker_lease_token_hash === undefined ? {} : { run_worker_lease_token_hash: fence.run_worker_lease_token_hash }),
      ...(input.run_session_status === undefined ? {} : { run_session_status: input.run_session_status }),
      ...(input.run_session_updated_at === undefined ? {} : { run_session_updated_at: input.run_session_updated_at }),
      ...(input.execution_package_version === undefined ? {} : { execution_package_version: input.execution_package_version }),
      expires_at: input.expires_at,
      now,
    });

    this.leaseFences.set(lease.id, fence);
    this.leaseCredentialProviders.set(lease.id, credential.provider);
    return { lease, launch_token: lease.lease_token };
  }

  revokeLaunchLease(leaseId: string, input: RevokeCodexLaunchLeaseDto) {
    return this.repository.revokeCodexLaunchLease({
      lease_id: leaseId,
      reason_code: input.reason_code,
      idempotency_key: input.idempotency_key,
      now: nowIso(),
    });
  }

  async materializeLaunchLease(workerId: string, leaseId: string, input: MaterializeCodexLaunchLeaseDto) {
    const provider = this.leaseCredentialProviders.get(leaseId);
    if ((provider === undefined || provider === 'unsafe_db') && !unsafeDbCredentialStoreEnabled()) {
      requireUnsafeDbCredentialStore();
    }
    const activeFence = this.leaseFences.get(leaseId);
    const materialized = await this.repository.materializeCodexLaunchLease({
      lease_id: leaseId,
      worker_id: workerId,
      launch_token: input.launch_token,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      materialization_request_hash: input.materialization_request_hash,
      ...(activeFence === undefined ? {} : { active_fence: activeFence }),
      now: nowIso(),
    });
    this.leaseFences.delete(leaseId);
    this.leaseCredentialProviders.delete(leaseId);
    return {
      launch_target: materialized.launch_target,
      runtime_profile: {
        id: materialized.profile_revision.id,
        profile_id: materialized.profile_revision.profile_id,
        profile_digest: materialized.profile_revision.profile_digest,
        target_kind: materialized.profile_revision.target_kind,
        source_access_mode: materialized.profile_revision.source_access_mode,
        docker_image_digest: materialized.profile_revision.docker_image_digest,
        network_policy: materialized.profile_revision.network_policy,
      },
      credentials: materialized.resolved_credentials.map((credential) => ({
        binding_id: credential.binding_id,
        binding_version_id: credential.binding_version_id,
        payload_digest: credential.payload_digest,
        secret_payload_json: credential.payload,
      })),
      lease_id: materialized.lease_id,
      materialized_at: materialized.materialized_at,
    };
  }

  terminalizeLaunchLease(workerId: string, leaseId: string, input: TerminalizeCodexLaunchLeaseDto) {
    if (input.evidence_summary !== undefined && hasUnsafeEvidence(input.evidence_summary)) {
      throw new BadRequestException('Codex launch terminal evidence summary cannot include raw secrets, tokens, paths, or logs');
    }
    return this.repository.terminalizeCodexLaunchLease({
      lease_id: leaseId,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      terminal_status: input.terminal_status,
      reason_code: input.reason_code,
      ...(input.evidence_summary === undefined ? {} : { evidence_summary: input.evidence_summary }),
      ...(input.runtime_job_id === undefined ? {} : { runtime_job_id: input.runtime_job_id }),
      idempotency_key: input.idempotency_key,
      now: nowIso(),
    });
  }

  private async launchFenceFor(input: CreateCodexLaunchLeaseDto, now: string): Promise<CodexLaunchFenceSnapshot> {
    if (input.target.target_kind === 'generation') {
      if (input.action_claim_token === undefined || input.action_attempt === undefined || input.precondition_fingerprint === undefined) {
        throw new UnauthorizedException('Generation launch leases require an active action claim fence');
      }
      const actionRun = await this.repository.getClaimedAutomationActionRun({
        id: input.target.target_id,
        claim_token: input.action_claim_token,
      });
      if (
        actionRun.attempt !== input.action_attempt ||
        actionRun.precondition_fingerprint !== input.precondition_fingerprint ||
        (input.action_type !== undefined && actionRun.action_type !== input.action_type) ||
        !actorScopeMatchesTarget(actionRun.automation_scope, input.target.project_id, input.target.repo_id)
      ) {
        throw new ForbiddenException('Generation launch lease action claim fence was rejected');
      }
      return {
        action_claim_token_hash: codexCredentialPayloadDigest(input.action_claim_token),
        precondition_fingerprint: input.precondition_fingerprint,
      };
    }

    if (input.run_worker_lease_token === undefined || input.run_session_id === undefined) {
      throw new UnauthorizedException('Run execution launch leases require an active run worker lease fence');
    }
    await this.repository.assertActiveRunWorkerLease(input.run_session_id, input.worker_id, input.run_worker_lease_token, now);
    return {
      run_worker_lease_id: input.run_worker_lease_id ?? input.run_session_id,
      run_worker_lease_token_hash: codexCredentialPayloadDigest(input.run_worker_lease_token),
      ...(input.run_session_status === undefined ? {} : { run_session_status: input.run_session_status }),
      ...(input.run_session_updated_at === undefined ? {} : { run_session_updated_at: input.run_session_updated_at }),
      ...(input.execution_package_version === undefined ? {} : { execution_package_version: input.execution_package_version }),
    };
  }
}
