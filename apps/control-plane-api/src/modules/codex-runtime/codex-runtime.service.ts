import { randomBytes } from 'node:crypto';

import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  normalizeCodexRuntimeNetworkPolicy,
  validateCodexLaunchTargetKind,
  validateCodexDockerRuntimeEvidence,
  validateCodexRuntimeProfileRevision,
  type CodexCredentialBinding,
  type CodexCredentialBindingVersion,
  type CodexLaunchTarget,
  type CodexRuntimeNetworkPolicy,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type CodexRuntimeScope,
  type CodexRuntimeTargetKind,
  type CodexPublicBlockerCode,
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
const workerSessionReplayWindowMs = 5 * 60 * 1000;

type ActiveLaunchFence =
  | {
      kind: 'generation';
      target_id: string;
      action_claim_token: string;
      action_type?: string;
      action_attempt: number;
      precondition_fingerprint: string;
      project_id: string;
      repo_id?: string;
      snapshot: CodexLaunchFenceSnapshot;
    }
  | {
      kind: 'run_execution';
      run_session_id: string;
      worker_id: string;
      run_worker_lease_token: string;
      execution_package_id: string;
      run_session_status: string;
      run_session_updated_at: string;
      execution_package_version: number;
      snapshot: CodexLaunchFenceSnapshot;
    };

const nowIso = (): string => process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();

const launchLeaseTtlMs = 10 * 60 * 1000;
const workerSessionTtlMs = 15 * 60 * 1000;

const boundedFutureIso = (now: string, requestedExpiresAt: string, maxTtlMs: number, label: string): string => {
  const nowMs = Date.parse(now);
  const requestedMs = Date.parse(requestedExpiresAt);
  const expiresMs = Math.min(nowMs + maxTtlMs, requestedMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(requestedMs) || expiresMs <= nowMs) {
    throw new BadRequestException(`${label} expiry was rejected`);
  }
  return new Date(expiresMs).toISOString();
};

const boundedWorkerSessionExpiresAt = (now: string, publicKeyExpiresAt: string): string => {
  return boundedFutureIso(now, publicKeyExpiresAt, workerSessionTtlMs, 'Worker session');
};

const boundedLaunchLeaseExpiresAt = (now: string, requestedExpiresAt: string): string =>
  boundedFutureIso(now, requestedExpiresAt, launchLeaseTtlMs, 'Codex launch lease');

const unsafeDbCredentialStoreEnabled = (): boolean => process.env[unsafeDbCredentialStoreEnv] === '1';

const requireUnsafeDbCredentialStore = (): void => {
  if (!unsafeDbCredentialStoreEnabled()) {
    throw new ForbiddenException(`${unsafeDbCredentialStoreEnv}=1 is required for unsafe_db Codex credential material`);
  }
};

const generateWorkerSessionToken = (): string => `codex-worker-session-${randomBytes(32).toString('base64url')}`;

const materializedNetworkPolicy = (policy: CodexRuntimeNetworkPolicy) => {
  return normalizeCodexRuntimeNetworkPolicy(policy);
};

const actorScopeMatchesTarget = (automationScope: string, projectId: string, repoId?: string): boolean => {
  if (repoId !== undefined) {
    return automationScope === `repo:${projectId}:${repoId}`;
  }
  return automationScope === `project:${projectId}` || automationScope.startsWith(`repo:${projectId}:`);
};

const networkProviderConfigDigest = (revision: CodexRuntimeProfileRevision): string | undefined => {
  const networkPolicy = normalizeCodexRuntimeNetworkPolicy(revision.network_policy);
  return networkPolicy.mode === 'egress_allowlist' && networkPolicy.provider === 'docker_network_proxy'
    ? networkPolicy.provider_config.provider_config_digest
    : undefined;
};

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
const rawPathEndpointOrContainerPattern = /(^\/|https?:\/\/|^unix:|\.sock$|^[A-Fa-f0-9]{12,64}$)/;
const startupFailureEvidenceKeys = new Set([
  'runtime_profile_id',
  'runtime_profile_revision_id',
  'runtime_profile_digest',
  'runtime_target_kind',
  'source_access_mode',
  'environment',
  'launch_lease_id',
  'worker_id',
  'docker_image_digest',
  'network_policy_digest',
  'app_server_attempted',
  'selected_execution_mode',
  'startup_blocker_code',
]);
const startupFailureBlockerCodes = new Set<CodexPublicBlockerCode>([
  'codex_worker_unavailable',
  'codex_worker_docker_policy_unavailable',
  'codex_worker_docker_unavailable',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_app_server_unavailable',
  'codex_docker_runtime_evidence_unsafe',
  'codex_runtime_profile_invalid',
]);

const isStartupFailureEvidenceSummary = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const evidence = value as Record<string, unknown>;
  if (evidence.app_server_attempted !== true || evidence.selected_execution_mode !== 'app_server') {
    return false;
  }
  if (typeof evidence.startup_blocker_code !== 'string' || !startupFailureBlockerCodes.has(evidence.startup_blocker_code as CodexPublicBlockerCode)) {
    return false;
  }
  for (const [key, entry] of Object.entries(evidence)) {
    if (!startupFailureEvidenceKeys.has(key)) {
      return false;
    }
    if (key === 'app_server_attempted') {
      continue;
    }
    if (typeof entry !== 'string') {
      return false;
    }
    if (key.endsWith('_digest')) {
      if (!sha256DigestPattern.test(entry)) {
        return false;
      }
    } else if (rawPathEndpointOrContainerPattern.test(entry)) {
      return false;
    }
  }
  return true;
};

const assertPublicSafeTerminalEvidence = (evidence: Record<string, unknown>): void => {
  try {
    validateCodexDockerRuntimeEvidence(evidence);
    return;
  } catch {
    if (isStartupFailureEvidenceSummary(evidence)) {
      return;
    }
    throw new BadRequestException('Codex launch terminal evidence summary cannot include raw secrets, tokens, paths, or logs');
  }
};

const assertFreshWorkerNonceTimestamp = (nonceTimestamp: string, now: string): void => {
  const nonceMs = Date.parse(nonceTimestamp);
  const nowMs = Date.parse(now);
  if (Number.isNaN(nonceMs) || Number.isNaN(nowMs) || Math.abs(nowMs - nonceMs) > workerSessionReplayWindowMs) {
    throw new UnauthorizedException('Codex worker session nonce timestamp is stale or invalid');
  }
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
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async createProfile(input: CreateCodexRuntimeProfileDto) {
    const revision = validateCodexRuntimeProfileRevision(input.revision as unknown as CodexRuntimeProfileRevision, {
      strictRealDogfood: true,
    });
    const profileRevision = await this.repository.createCodexRuntimeProfileWithRevision({
      profile: input.profile as CodexRuntimeProfile,
      revision,
    });
    return { profile_revision: profileRevision };
  }

  async createCredential(input: CreateCodexCredentialDto) {
    requireUnsafeDbCredentialStore();
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
    const sessionToken = generateWorkerSessionToken();
    const now = nowIso();
    const sessionExpiresAt = boundedWorkerSessionExpiresAt(now, input.session_public_key_expires_at);
    const worker = await this.repository.upsertCodexWorkerRegistration({
      worker_id: input.worker_id,
      worker_identity: input.worker_identity,
      version: input.version,
      bootstrap_token_hash: codexCredentialPayloadDigest(input.bootstrap_token),
      bootstrap_token_version: input.bootstrap_token_version,
      session_token: sessionToken,
      session_expires_at: sessionExpiresAt,
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
      now,
    });
    return { worker, session_token: sessionToken, session_expires_at: sessionExpiresAt };
  }

  heartbeatWorker(workerId: string, input: HeartbeatCodexWorkerDto) {
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
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
        now,
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
      credential.profile_id !== revision.profile_id ||
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
      launch_attempt: input.launch_attempt,
      worker_id: input.worker_id,
      runtime_profile_revision_id: input.runtime_profile_revision_id,
      runtime_profile_digest: revision.profile_digest,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      credential_payload_digest: input.credential_payload_digest,
      docker_image_digest: revision.docker_image_digest,
      network_policy_digest: codexRuntimeNetworkPolicyDigest(revision.network_policy),
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      launch_token: input.launch_token,
      ...(input.action_type === undefined ? {} : { action_type: input.action_type }),
      ...(input.action_attempt === undefined ? {} : { action_attempt: input.action_attempt }),
      ...(fence.snapshot.action_claim_token_hash === undefined ? {} : { action_claim_token_hash: fence.snapshot.action_claim_token_hash }),
      ...(fence.snapshot.precondition_fingerprint === undefined ? {} : { precondition_fingerprint: fence.snapshot.precondition_fingerprint }),
      ...(input.execution_package_id === undefined ? {} : { execution_package_id: input.execution_package_id }),
      ...(fence.snapshot.run_worker_lease_id === undefined ? {} : { run_worker_lease_id: fence.snapshot.run_worker_lease_id }),
      ...(fence.snapshot.run_worker_lease_token_hash === undefined
        ? {}
        : { run_worker_lease_token_hash: fence.snapshot.run_worker_lease_token_hash }),
      ...(input.run_session_status === undefined ? {} : { run_session_status: input.run_session_status }),
      ...(input.run_session_updated_at === undefined ? {} : { run_session_updated_at: input.run_session_updated_at }),
      ...(input.execution_package_version === undefined ? {} : { execution_package_version: input.execution_package_version }),
      expires_at: boundedLaunchLeaseExpiresAt(now, input.expires_at),
      now,
    });

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
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    requireUnsafeDbCredentialStore();
    const materialized = await this.repository.materializeCodexLaunchLease({
      lease_id: leaseId,
      worker_id: workerId,
      launch_token: input.launch_token,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      materialization_request_hash: input.materialization_request_hash,
      now,
    });
    const credential = materialized.resolved_credentials[0];
    if (credential === undefined) {
      throw new ForbiddenException('Codex launch lease credential material is unavailable');
    }
    return {
      launch_target: materialized.launch_target,
      runtime_profile: {
        profile_id: materialized.profile_revision.profile_id,
        revision_id: materialized.profile_revision.id,
        profile_digest: materialized.profile_revision.profile_digest,
        target_kind: materialized.profile_revision.target_kind,
        source_access_mode: materialized.profile_revision.source_access_mode,
        environment: materialized.profile_revision.environment,
        docker_image: materialized.profile_revision.docker_image,
        docker_image_digest: materialized.profile_revision.docker_image_digest,
        codex_config_toml: materialized.profile_revision.codex_config_toml,
        codex_config_digest: materialized.profile_revision.codex_config_digest,
        expected_effective_config_digest: materialized.profile_revision.expected_effective_config_digest,
        effective_config_assertions: materialized.profile_revision.effective_config_assertions,
        app_server_required: materialized.profile_revision.app_server_required,
        resource_limits: materialized.profile_revision.resource_limits,
        docker_policy: materialized.profile_revision.docker_policy,
        network_policy: materializedNetworkPolicy(materialized.profile_revision.network_policy),
      },
      credential: {
        binding_id: credential.binding_id,
        version_id: credential.binding_version_id,
        secret_payload_kind: 'codex_auth_json',
        secret_payload_digest: credential.payload_digest,
        secret_payload_json: credential.payload,
      },
      lease_id: materialized.lease_id,
      expires_at: materialized.expires_at,
      materialized_at: materialized.materialized_at,
    };
  }

  terminalizeLaunchLease(workerId: string, leaseId: string, input: TerminalizeCodexLaunchLeaseDto) {
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    if (input.evidence_summary !== undefined) {
      assertPublicSafeTerminalEvidence(input.evidence_summary);
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
      now,
    });
  }

  private async launchFenceFor(input: CreateCodexLaunchLeaseDto, now: string): Promise<ActiveLaunchFence> {
    if (input.target.target_kind === 'generation') {
      if (input.action_claim_token === undefined || input.action_attempt === undefined || input.precondition_fingerprint === undefined) {
        throw new UnauthorizedException('Generation launch leases require an active action claim fence');
      }
      const actionRun = await this.getClaimedActionFence(input.target.target_id, input.action_claim_token, now);
      if (
        actionRun.attempt !== input.action_attempt ||
        actionRun.precondition_fingerprint !== input.precondition_fingerprint ||
        (input.action_type !== undefined && actionRun.action_type !== input.action_type) ||
        !actorScopeMatchesTarget(actionRun.automation_scope, input.target.project_id, input.target.repo_id)
      ) {
        throw new ForbiddenException('Generation launch lease action claim fence was rejected');
      }
      return {
        kind: 'generation',
        target_id: input.target.target_id,
        action_claim_token: input.action_claim_token,
        ...(input.action_type === undefined ? {} : { action_type: input.action_type }),
        action_attempt: input.action_attempt,
        precondition_fingerprint: input.precondition_fingerprint,
        project_id: input.target.project_id,
        ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
        snapshot: {
          action_claim_token_hash: codexCredentialPayloadDigest(input.action_claim_token),
          precondition_fingerprint: input.precondition_fingerprint,
        },
      };
    }

    if (
      input.run_worker_lease_token === undefined ||
      input.run_session_id === undefined ||
      input.run_worker_lease_id === undefined ||
      input.execution_package_id === undefined ||
      input.run_session_status === undefined ||
      input.run_session_updated_at === undefined ||
      input.execution_package_version === undefined
    ) {
      throw new UnauthorizedException('Run execution launch leases require an active run worker lease fence');
    }
    const activeRunLease = await this.repository.getRunWorkerLease(input.run_session_id);
    if (
      activeRunLease === undefined ||
      activeRunLease.status !== 'active' ||
      activeRunLease.lease_token !== input.run_worker_lease_token ||
      activeRunLease.expires_at <= now
    ) {
      throw new ForbiddenException('Run execution launch lease worker fence was rejected');
    }
    if (input.run_worker_lease_id !== activeRunLease.id) {
      throw new ForbiddenException('Run execution launch lease worker fence was rejected');
    }
    const target: CodexLaunchTarget = {
      target_type: input.target.target_type,
      target_id: input.target.target_id,
      target_kind: input.target.target_kind,
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
    };
    await this.assertRunSessionFence(
      target,
      input.run_session_id,
      input.execution_package_id,
      input.run_session_status,
      input.run_session_updated_at,
      input.execution_package_version,
    );
    return {
      kind: 'run_execution',
      run_session_id: input.run_session_id,
      worker_id: input.worker_id,
      run_worker_lease_token: input.run_worker_lease_token,
      execution_package_id: input.execution_package_id,
      run_session_status: input.run_session_status,
      run_session_updated_at: input.run_session_updated_at,
      execution_package_version: input.execution_package_version,
      snapshot: {
        run_worker_lease_id: activeRunLease.id,
        run_worker_lease_token_hash: codexCredentialPayloadDigest(input.run_worker_lease_token),
        run_session_status: input.run_session_status,
        run_session_updated_at: input.run_session_updated_at,
        execution_package_version: input.execution_package_version,
      },
    };
  }

  private async getClaimedActionFence(id: string, claimToken: string, now: string) {
    try {
      const actionRun = await this.repository.getClaimedAutomationActionRun({ id, claim_token: claimToken });
      if (actionRun.locked_until === undefined || actionRun.locked_until <= now) {
        throw new Error('stale action claim');
      }
      return actionRun;
    } catch {
      throw new ForbiddenException('Generation launch lease action claim fence was rejected');
    }
  }

  private async assertRunSessionFence(
    target: CodexLaunchTarget,
    runSessionId: string,
    executionPackageId: string,
    expectedStatus: string,
    expectedUpdatedAt: string,
    executionPackageVersion: number,
  ): Promise<void> {
    const runSession = await this.repository.getRunSession(runSessionId);
    const executionPackage = await this.repository.getExecutionPackage(executionPackageId);
    if (
      target.target_id !== runSessionId ||
      runSession === undefined ||
      runSession.execution_package_id !== executionPackageId ||
      runSession.status !== expectedStatus ||
      runSession.updated_at !== expectedUpdatedAt ||
      executionPackage === undefined ||
      executionPackage.project_id !== target.project_id ||
      executionPackage.repo_id !== target.repo_id ||
      executionPackage.version !== executionPackageVersion
    ) {
      throw new ForbiddenException('Run execution launch lease run session fence was rejected');
    }
  }
}
