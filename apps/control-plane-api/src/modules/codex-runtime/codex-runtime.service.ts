import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeJobInputDigest,
  codexRuntimeJobArtifactMaxSizeBytes,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  codexWorkspaceAcquisitionDigest,
  buildInternalArtifactRef,
  collectCodexRuntimeJobTerminalArtifactRefs,
  normalizeCodexRuntimeNetworkPolicy,
  runtimeArtifactUploadProofPayload,
  validateCodexLaunchTargetKind,
  validateCodexDockerRuntimeEvidence,
  validateCodexRuntimeJobTerminalResult,
  validateCodexRuntimeProfileRevision,
  type AutomationActionRun,
  type CodexGenerationWorkloadV1,
  type CodexCredentialBinding,
  type CodexCredentialBindingVersion,
  type CodexGenerationRuntimeJobResult,
  type CodexRunExecutionRuntimeJobResult,
  DomainError,
  type CodexLaunchLease,
  type CodexLaunchTarget,
  type CodexLaunchTokenEnvelope,
  type CodexRuntimeJob,
  type CodexRuntimeJobTerminalStatus,
  type CodexRuntimeNetworkPolicy,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type CodexRuntimeScope,
  type CodexRuntimeTargetKind,
  type CodexPublicBlockerCode,
} from '@forgeloop/domain';
import {
  LocalInternalArtifactStore,
  type CodexLaunchFenceSnapshot,
  type DeliveryRepository,
  type PendingWorkspaceBundleReplayInput,
} from '@forgeloop/db';

import { ProductGenerationResultService } from '../automation/product-generation-result.service';
import { DELIVERY_REPOSITORY, INTERNAL_ARTIFACT_STORE_ROOT } from '../core/control-plane-tokens';
import type {
  CodexRuntimeStatusQuery,
  AcceptCodexRuntimeJobDto,
  AppendCodexRuntimeJobEventDto,
  CancelCodexRuntimeJobDto,
  ClaimCodexRuntimeJobEnvelopeDto,
  CodexRuntimeWorkerQueryDto,
  CreateCodexCredentialDto,
  CreateCodexLaunchLeaseDto,
  CreateCodexRuntimeJobArtifactDto,
  CreateCodexRuntimeJobDto,
  CreateCodexRuntimeProfileDto,
  CreateCodexWorkerBootstrapTokenDto,
  HeartbeatCodexWorkerDto,
  ImportCodexCredentialDto,
  ImportCodexRuntimeProfileDto,
  ImportLocalCodexDto,
  AttachCodexSessionRunnerRuntimeJobDto,
  MarkCodexSessionRunnerOwnerDto,
  MaterializeCodexRuntimeJobDto,
  MaterializeCodexLaunchLeaseDto,
  PollCodexRuntimeJobsDto,
  RecoverStaleCodexWorkersDto,
  RecoverStaleCodexRuntimeJobsDto,
  RegisterCodexWorkerDto,
  RenewAutomationActionRunClaimDto,
  RevokeCodexLaunchLeaseDto,
  StartCodexRuntimeJobDto,
  TerminalizeCodexRuntimeJobDto,
  TerminalizeCodexLaunchLeaseDto,
  RefreshCodexWorkerSessionDto,
} from './codex-runtime.dto';

const unsafeDbCredentialStoreEnv = 'FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE';
const workerSessionReplayWindowMs = 5 * 60 * 1000;

const pendingWorkspaceBundleReplayInput = (
  input: CreateCodexRuntimeJobDto['pending_workspace_bundle'],
): PendingWorkspaceBundleReplayInput | undefined => {
  if (input === undefined) {
    return undefined;
  }
  return {
    id: input.id,
    bundle_id: input.bundle_id,
    run_session_id: input.run_session_id,
    execution_package_id: input.execution_package_id,
    pending_artifact_ref: input.pending_artifact_ref,
    ...(input.internal_artifact_object_id === undefined ? {} : { internal_artifact_object_id: input.internal_artifact_object_id }),
    archive_digest: input.archive_digest,
    manifest_digest: input.manifest_digest,
    run_worker_lease_id: input.run_worker_lease_id,
    size_bytes: input.size_bytes,
    workspace_acquisition_digest: input.workspace_acquisition_digest,
    workspace_acquisition_json: input.workspace_acquisition_json,
    expires_at: input.expires_at,
    request_digest: input.request_digest,
    created_at: input.created_at,
  };
};

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
const rawSha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

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

const requireUnsafeDbImportAllowed = (): void => {
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException('unsafe_db Codex credentials are rejected in production');
  }
  requireUnsafeDbCredentialStore();
};

const defaultImportResourceLimits = {
  cpu_ms: 2_000,
  memory_mb: 4096,
  pids: 512,
  fds: 1024,
  workspace_bytes: 2_000_000_000,
  artifact_bytes: 500_000_000,
  timeout_ms: 900_000,
  output_limit_bytes: 2_000_000,
  run_output_limit_bytes: 2_000_000,
};

const defaultImportDockerPolicy = {
  app_server_only: true,
  rootless: true,
  read_only_rootfs: true,
  no_new_privileges: true,
  drop_capabilities: ['ALL'],
};

const importEffectiveConfigAssertions = (targetKind: CodexRuntimeTargetKind): CodexRuntimeProfileRevision['effective_config_assertions'] =>
  targetKind === 'generation'
    ? {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      }
    : {
        target_kind: 'run_execution',
        approval_policy: 'never',
        sandbox_type: 'danger-full-access',
        writable_roots_policy: 'task_workspace_only',
      };

const generateWorkerSessionToken = (): string => `codex-worker-session-${randomBytes(32).toString('base64url')}`;
const deterministicRuntimeArtifactId = (runtimeJobId: string, artifactIdempotencyKey: string): string => {
  const hex = codexCanonicalDigest({ runtime_job_id: runtimeJobId, artifact_idempotency_key: artifactIdempotencyKey }).slice(
    'sha256:'.length,
  );
  const bytes = Buffer.from(hex.slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const uuidHex = bytes.toString('hex');
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
};

const deterministicCodexImportId = (namespace: string, input: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest({ namespace, input }).slice('sha256:'.length);
  const bytes = Buffer.from(hex.slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const uuidHex = bytes.toString('hex');
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
};

const importedProfileIdentity = (
  input: ImportCodexRuntimeProfileDto | ImportLocalCodexDto,
  environment: CodexRuntimeProfileRevision['environment'],
): Record<string, unknown> => ({
  schema_version: 'codex_runtime_profile_import.v1',
  source_kind: 'local_source_label' in input ? 'local_codex_import' : 'profile_import',
  ...('local_source_label' in input ? { source_label: input.local_source_label } : {}),
  environment,
  profile_name: input.profile_name,
  target_kind: input.target_kind,
  project_id: input.project_id,
  ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
  docker_image: input.docker_image,
  docker_image_digest: input.docker_image_digest,
  codex_config_digest: codexCanonicalDigest(input.codex_config_toml),
  expected_effective_config_digest: input.expected_effective_config_digest,
  allowed_scopes: input.allowed_scopes,
  network_policy_digest: codexRuntimeNetworkPolicyDigest(input.network_policy as CodexRuntimeNetworkPolicy),
});

const importedCredentialIdentity = (
  input: Pick<ImportCodexCredentialDto, 'profile_id' | 'project_id' | 'repo_id' | 'purpose' | 'auth_json' | 'provider'>,
): Record<string, unknown> => ({
  schema_version: 'codex_credential_import.v1',
  profile_id: input.profile_id,
  project_id: input.project_id,
  ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
  provider: input.provider,
  purpose: input.purpose,
  credential_payload_digest: codexCredentialPayloadDigest(input.auth_json),
});

const materializedNetworkPolicy = (policy: CodexRuntimeNetworkPolicy) => {
  return normalizeCodexRuntimeNetworkPolicy(policy);
};

const withoutBodyDigest = <T extends { body_digest?: string }>(input: T): Omit<T, 'body_digest'> => {
  const { body_digest: _bodyDigest, ...body } = input;
  return body;
};

const assertWorkerBodyDigest = (input: { body_digest: string }): void => {
  const expected = codexCanonicalDigest(withoutBodyDigest(input));
  if (input.body_digest !== expected) {
    throw new BadRequestException('Codex worker request body digest was rejected');
  }
};

type PublicRuntimeJob = Pick<
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
  | 'accepted_at'
  | 'materializing_at'
  | 'started_at'
  | 'last_event_at'
  | 'cancel_requested_at'
  | 'drain_requested_at'
  | 'terminal_at'
  | 'terminal_status'
  | 'terminal_reason_code'
> & {
  input: {
    input_digest: string;
    schema_version?: unknown;
    output_schema_version?: unknown;
  };
  terminal_result_json?: CodexGenerationRuntimeJobResult | CodexRunExecutionRuntimeJobResult;
  workspace_acquisition?: {
    workspace_acquisition_digest: string;
    schema_version?: unknown;
  };
};

type MaterializeCodexRuntimeJobServiceInput = Omit<MaterializeCodexRuntimeJobDto, 'launch_token'> & {
  launch_token_hash: string;
};

const workerReplayProtection = (method: 'GET' | 'POST', path: string, bodyDigest: string) => ({
  method,
  path,
  body_digest: bodyDigest,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const publicRuntimeJobTerminalResult = (
  result: CodexRuntimeJob['terminal_result_json'],
): PublicRuntimeJob['terminal_result_json'] | undefined => {
  if (result === undefined) {
    return undefined;
  }
  const terminalResult = validateCodexRuntimeJobTerminalResult(result);
  if (
    'codex_session_thread' in terminalResult ||
    'output_capsule' in terminalResult ||
    'output_memory_bundle_ref' in terminalResult ||
    'memory_delta_artifact_ref' in terminalResult ||
    'output_environment_manifest_ref' in terminalResult
  ) {
    const {
      codex_session_thread: _trustedThreadEvidence,
      output_capsule: _trustedOutputCapsule,
      output_memory_bundle_ref: _trustedOutputMemoryBundleRef,
      output_memory_bundle_digest: _trustedOutputMemoryBundleDigest,
      memory_delta_artifact_ref: _trustedMemoryDeltaArtifactRef,
      memory_delta_digest: _trustedMemoryDeltaDigest,
      output_environment_manifest_ref: _trustedOutputEnvironmentManifestRef,
      output_environment_manifest_digest: _trustedOutputEnvironmentManifestDigest,
      ...publicResult
    } = terminalResult;
    return publicResult;
  }
  return terminalResult;
};

const publicRuntimeJob = (job: CodexRuntimeJob): PublicRuntimeJob => {
  const terminalResult = publicRuntimeJobTerminalResult(job.terminal_result_json);
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
    ...(job.accepted_at === undefined ? {} : { accepted_at: job.accepted_at }),
    ...(job.materializing_at === undefined ? {} : { materializing_at: job.materializing_at }),
    ...(job.started_at === undefined ? {} : { started_at: job.started_at }),
    ...(job.last_event_at === undefined ? {} : { last_event_at: job.last_event_at }),
    ...(job.cancel_requested_at === undefined ? {} : { cancel_requested_at: job.cancel_requested_at }),
    ...(job.drain_requested_at === undefined ? {} : { drain_requested_at: job.drain_requested_at }),
    ...(job.terminal_at === undefined ? {} : { terminal_at: job.terminal_at }),
    ...(job.terminal_status === undefined ? {} : { terminal_status: job.terminal_status }),
    ...(job.terminal_reason_code === undefined ? {} : { terminal_reason_code: job.terminal_reason_code }),
    ...(terminalResult === undefined ? {} : { terminal_result_json: terminalResult }),
    input: {
      input_digest: job.input_digest,
      ...(job.input_json.schema_version === undefined ? {} : { schema_version: job.input_json.schema_version }),
      ...(job.input_json.output_schema_version === undefined ? {} : { output_schema_version: job.input_json.output_schema_version }),
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
};

const workerRuntimeJob = (job: CodexRuntimeJob): PublicRuntimeJob & Pick<CodexRuntimeJob, 'workspace_acquisition_json'> => ({
  ...publicRuntimeJob(job),
  ...(job.target_kind === 'run_execution' && job.workspace_acquisition_json !== undefined
    ? { workspace_acquisition_json: job.workspace_acquisition_json }
    : {}),
});

const publicEnvelopeMetadata = (envelope: CodexLaunchTokenEnvelope | undefined) =>
  envelope === undefined
    ? undefined
    : {
        id: envelope.id,
        runtime_job_id: envelope.runtime_job_id,
        launch_lease_id: envelope.launch_lease_id,
        worker_id: envelope.worker_id,
        envelope_digest: envelope.envelope_digest,
        status: envelope.status,
        expires_at: envelope.expires_at,
        created_at: envelope.created_at,
      };

const publicLaunchLeaseStatus = (lease: CodexLaunchLease) => ({
  id: lease.id,
  target: lease.target,
  launch_attempt: lease.launch_attempt,
  profile_revision_id: lease.profile_revision_id,
  ...(lease.worker_id === undefined ? {} : { worker_id: lease.worker_id }),
  status: lease.status,
  created_at: lease.created_at,
  expires_at: lease.expires_at,
  ...(lease.materialized_at === undefined ? {} : { materialized_at: lease.materialized_at }),
  ...(lease.terminal_at === undefined ? {} : { terminal_at: lease.terminal_at }),
  ...(lease.revoked_at === undefined ? {} : { revoked_at: lease.revoked_at }),
  ...(lease.terminal_reason_code === undefined ? {} : { terminal_reason_code: lease.terminal_reason_code }),
  ...(lease.terminal_runtime_job_id === undefined ? {} : { terminal_runtime_job_id: lease.terminal_runtime_job_id }),
});

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
  private readonly internalArtifacts: LocalInternalArtifactStore;

  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(INTERNAL_ARTIFACT_STORE_ROOT) internalArtifactStoreRoot: string,
    @Inject(ProductGenerationResultService)
    private readonly productGenerationResults: ProductGenerationResultService,
  ) {
    this.internalArtifacts = new LocalInternalArtifactStore({
      root: internalArtifactStoreRoot,
      repository,
      requestId: 'codex-runtime-service',
    });
  }

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
    requireUnsafeDbImportAllowed();
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

  async importProfile(input: ImportCodexRuntimeProfileDto) {
    return this.repository.withObjectLock(
      `codex-runtime-profile-import:${codexCanonicalDigest(importedProfileIdentity(input, this.importEnvironment()))}`,
      (repository) => this.persistImportedProfile(input, repository),
    );
  }

  async importCredential(input: ImportCodexCredentialDto) {
    requireUnsafeDbImportAllowed();
    return this.repository.withObjectLock(
      `codex-runtime-credential-import:${codexCanonicalDigest(importedCredentialIdentity(input))}`,
      (repository) => this.persistImportedCredential(input, repository),
    );
  }

  async importLocalCodex(input: ImportLocalCodexDto) {
    requireUnsafeDbImportAllowed();
    const profileImportDigest = codexCanonicalDigest(importedProfileIdentity(input, this.importEnvironment()));
    return this.repository.withObjectLock(`codex-runtime-local-import:${profileImportDigest}`, (repository) =>
      repository.withDeliveryTransaction(async (transactionalRepository) => {
        const profile = await this.persistImportedProfile(input, transactionalRepository);
        const credentialInput = { ...input, profile_id: profile.profile_id, purpose: 'model_provider' as const };
        const credential = await this.persistImportedCredential(credentialInput, transactionalRepository);
        return {
          ...profile,
          ...credential,
          import_source_digest: codexCanonicalDigest({
            kind: 'local_codex_import',
            label: input.local_source_label,
            imported_by_actor_id: input.created_by.actor_id,
          }),
        };
      }),
    );
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

  async heartbeatWorker(workerId: string, input: HeartbeatCodexWorkerDto) {
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const worker = await this.repository.heartbeatCodexWorker({
      worker_id: workerId,
      session_token: input.session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      status: input.status,
      control_channel_status: input.control_channel_status,
      active_lease_count: input.active_lease_count,
      capabilities: input.capabilities as readonly CodexRuntimeTargetKind[],
      now,
    });
    const renewedSessions = [];
    for (const runner of input.codex_session_runners ?? []) {
      const session = await this.repository.renewCodexSessionRunnerOwner({
        session_id: runner.session_id,
        runner_worker_id: workerId,
        runner_launch_lease_id: runner.runner_launch_lease_id,
        runner_runtime_job_id: runner.runner_runtime_job_id,
        runner_expires_at: runner.runner_expires_at,
        now,
      });
      renewedSessions.push({
        id: session.id,
        runner_worker_id: session.runner_worker_id,
        runner_launch_lease_id: session.runner_launch_lease_id,
        runner_runtime_job_id: session.runner_runtime_job_id,
        runner_expires_at: session.runner_expires_at,
      });
    }
    return { worker, codex_session_runners: renewedSessions };
  }

  async refreshWorkerSession(workerId: string, input: RefreshCodexWorkerSessionDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const nextSessionToken = generateWorkerSessionToken();
    const nextSessionExpiresAt = boundedWorkerSessionExpiresAt(now, input.next_session_public_key_expires_at);
    const worker = await this.repository.refreshCodexWorkerSession({
      worker_id: workerId,
      current_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      next_session_token: nextSessionToken,
      next_session_expires_at: nextSessionExpiresAt,
      next_session_public_key_id: input.next_session_public_key_id,
      next_session_public_key_material: input.next_session_public_key_material,
      next_session_public_key_expires_at: input.next_session_public_key_expires_at,
      request_digest: input.body_digest,
      replay_protection: workerReplayProtection('POST', `/internal/codex-workers/${workerId}/session/refresh`, input.body_digest),
      now,
    });
    return { worker, session_token: nextSessionToken, session_expires_at: nextSessionExpiresAt };
  }

  async createRuntimeJob(input: CreateCodexRuntimeJobDto) {
    validateCodexLaunchTargetKind(input.target.target_type, input.target.target_kind);
    const now = nowIso();
    const credential = await this.repository.getCodexCredentialBindingPublic(input.credential_binding_id);
    if (
      credential === undefined ||
      credential.active_version_id !== input.credential_binding_version_id ||
      credential.active_payload_digest !== input.credential_payload_digest
    ) {
      throw new BadRequestException('Codex credential binding fence was rejected');
    }
    const revision = await this.repository.getActiveCodexRuntimeProfileRevision({
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
      target_kind: input.target.target_kind,
      runtime_profile_id: credential.profile_id,
      now,
    });
    if (revision === undefined || revision.id !== input.runtime_profile_revision_id || revision.profile_id !== credential.profile_id) {
      throw new BadRequestException('Codex runtime profile revision fence was rejected');
    }
    const target: CodexLaunchTarget = {
      target_type: input.target.target_type,
      target_id: input.target.target_id,
      target_kind: input.target.target_kind,
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
    };
    const providerConfigDigest = networkProviderConfigDigest(revision);
    const worker = await this.repository.findAvailableCodexWorker({
      project_id: target.project_id,
      ...(target.repo_id === undefined ? {} : { repo_id: target.repo_id }),
      target_kind: target.target_kind,
      docker_image_digest: revision.docker_image_digest,
      network_policy_digest: codexRuntimeNetworkPolicyDigest(revision.network_policy),
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      now,
    });
    if (worker === undefined) {
      throw new ForbiddenException('Codex worker unavailable for runtime job');
    }

    const fence = await this.launchFenceFor(
      {
        ...input,
        id: input.launch_lease_id,
        lease_request_id: input.job_request_id,
        worker_id: worker.id,
        launch_token: 'repository-minted',
      } as CreateCodexLaunchLeaseDto,
      now,
    );
    const inputDigest = codexRuntimeJobInputDigest(input.input_json);
    const workspaceAcquisitionDigest = codexWorkspaceAcquisitionDigest(input.workspace_acquisition_json);
    const pendingWorkspaceBundle = pendingWorkspaceBundleReplayInput(input.pending_workspace_bundle);
    const result = await this.repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
      job_request_id: input.job_request_id,
      target,
      launch_attempt: input.launch_attempt,
      worker_id: worker.id,
      runtime_profile_revision_id: input.runtime_profile_revision_id,
      runtime_profile_digest: revision.profile_digest,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      credential_payload_digest: input.credential_payload_digest,
      docker_image_digest: revision.docker_image_digest,
      network_policy_digest: codexRuntimeNetworkPolicyDigest(revision.network_policy),
      ...(providerConfigDigest === undefined ? {} : { network_provider_config_digest: providerConfigDigest }),
      input_json: input.input_json,
      input_digest: inputDigest,
      ...(input.workspace_acquisition_json === undefined ? {} : { workspace_acquisition_json: input.workspace_acquisition_json }),
      ...(workspaceAcquisitionDigest === undefined ? {} : { workspace_acquisition_digest: workspaceAcquisitionDigest }),
      ...(pendingWorkspaceBundle === undefined ? {} : { pending_workspace_bundle: pendingWorkspaceBundle }),
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
    return {
      runtime_job: publicRuntimeJob(result.runtime_job),
      launch_lease: publicLaunchLeaseStatus(result.launch_lease),
      envelope: publicEnvelopeMetadata(result.envelope),
      replayed: result.replayed,
    };
  }

  async getRuntimeJob(jobId: string) {
    const runtimeJob = await this.repository.getCodexRuntimeJob({ runtime_job_id: jobId });
    if (runtimeJob === undefined) {
      throw new NotFoundException('Codex runtime job not found');
    }
    const artifacts = await this.repository.listCodexRuntimeJobArtifacts({ runtime_job_id: jobId });
    return {
      runtime_job: publicRuntimeJob(runtimeJob),
      envelope: publicEnvelopeMetadata(await this.repository.getCodexRuntimeJobEnvelope({ runtime_job_id: jobId })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        name: artifact.name,
        content_type: artifact.content_type,
        digest: artifact.digest,
        size_bytes: artifact.size_bytes,
        metadata_json: artifact.metadata_json,
        created_at: artifact.created_at,
      })),
    };
  }

  async cancelRuntimeJob(jobId: string, input: CancelCodexRuntimeJobDto) {
    const runtimeJob = await this.repository.cancelCodexRuntimeJob({
      runtime_job_id: jobId,
      reason_code: input.reason_code,
      idempotency_key: input.idempotency_key,
      request_digest: codexCanonicalDigest(input),
      now: nowIso(),
    });
    return { runtime_job: publicRuntimeJob(runtimeJob) };
  }

  recoverStaleRuntimeJobs(input: RecoverStaleCodexRuntimeJobsDto) {
    return this.repository.recoverStaleCodexRuntimeJobs({
      stale_before: input.stale_before,
      now: input.now ?? nowIso(),
      ...(input.worker_id === undefined ? {} : { worker_id: input.worker_id }),
      reason_code: input.reason_code,
    });
  }

  async getLaunchLeasePublicStatus(leaseId: string) {
    const lease = await this.repository.getCodexLaunchLeasePublicStatus({ launch_lease_id: leaseId });
    if (lease === undefined) {
      throw new NotFoundException('Codex launch lease not found');
    }
    return publicLaunchLeaseStatus(lease);
  }

  async renewAutomationActionRunClaim(actionRunId: string, input: RenewAutomationActionRunClaimDto) {
    const now = input.now ?? nowIso();
    let actionRun: AutomationActionRun;
    try {
      actionRun = await this.repository.getClaimedAutomationActionRun({ id: actionRunId, claim_token: input.claim_token });
    } catch {
      throw new ForbiddenException('Automation action claim renewal was rejected');
    }
    const renewed = await this.repository.claimAutomationActionRun({
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
      claim_token: input.claim_token,
      locked_until: input.locked_until,
      now,
    });
    return { action_run: renewed };
  }

  async pollRuntimeJobs(workerId: string, input: PollCodexRuntimeJobsDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const runtimeJobs = await this.repository.pollCodexRuntimeJobs({
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      ...(input.target_kinds === undefined ? {} : { target_kinds: input.target_kinds }),
      limit: input.limit,
      replay_protection: workerReplayProtection('POST', `/internal/codex-workers/${workerId}/runtime-jobs/poll`, input.body_digest),
      now,
    });
    const rows = await Promise.all(
      runtimeJobs.map(async (runtimeJob) => ({
        runtime_job: workerRuntimeJob(runtimeJob),
        envelope: publicEnvelopeMetadata(await this.repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id })),
      })),
    );
    return { runtime_jobs: rows, heartbeat_interval_ms: 15_000, control_poll_interval_ms: 2_000 };
  }

  async acceptRuntimeJob(workerId: string, jobId: string, input: AcceptCodexRuntimeJobDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const runtimeJob = await this.repository.acceptCodexRuntimeJob({
      runtime_job_id: jobId,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      accepted_worker_session_digest: input.accepted_worker_session_digest,
      accepted_session_public_key_id: input.accepted_session_public_key_id,
      accepted_session_epoch: input.accepted_session_epoch,
      idempotency_key: input.accept_idempotency_key,
      request_digest: input.body_digest,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/accepted`,
        input.body_digest,
      ),
      now,
    });
    return { runtime_job: publicRuntimeJob(runtimeJob) };
  }

  async claimRuntimeJobEnvelope(workerId: string, jobId: string, input: ClaimCodexRuntimeJobEnvelopeDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const envelope = await this.repository.claimCodexLaunchTokenEnvelope({
      runtime_job_id: jobId,
      envelope_id: input.envelope_id,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      accepted_worker_session_digest: input.accepted_worker_session_digest,
      key_id: input.accepted_session_public_key_id,
      accepted_session_epoch: input.accepted_session_epoch,
      claim_request_id: input.claim_request_id,
      request_digest: input.body_digest,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/envelope/claim`,
        input.body_digest,
      ),
      now,
    });
    return { envelope };
  }

  async getRuntimeJobWorkload(workerId: string, jobId: string, query: CodexRuntimeWorkerQueryDto) {
    assertWorkerBodyDigest(query);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(query.nonce_timestamp, now);
    const runtimeJob = await this.repository.getCodexRuntimeJobWorkload({
      runtime_job_id: jobId,
      worker_id: workerId,
      worker_session_token: query.worker_session_token,
      nonce: query.nonce,
      nonce_timestamp: query.nonce_timestamp,
      replay_protection: workerReplayProtection('GET', `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/workload`, query.body_digest),
      now,
    });
    const workspaceAcquisition = runtimeJob.workspace_acquisition_json;
    if (runtimeJob.input_json.schema_version !== 'codex_generation_workload.v1') {
      return { workload: runtimeJob.input_json };
    }
    const signedContext =
      workspaceAcquisition?.schema_version === 'codex_generation_workspace_acquisition.v1' &&
      workspaceAcquisition.signed_context_ref === runtimeJob.input_json.signed_context_ref &&
      workspaceAcquisition.signed_context_digest === runtimeJob.input_json.signed_context_digest &&
      isRecord(workspaceAcquisition.signed_context_json) &&
      codexCanonicalDigest(workspaceAcquisition.signed_context_json) === runtimeJob.input_json.signed_context_digest
        ? workspaceAcquisition.signed_context_json
        : undefined;
    if (signedContext === undefined) {
      throw new ForbiddenException('Codex runtime job workload was denied');
    }
    return {
      workload: runtimeJob.input_json,
      signed_context: signedContext,
    };
  }

  async materializeRuntimeJob(workerId: string, jobId: string, input: MaterializeCodexRuntimeJobServiceInput) {
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    requireUnsafeDbCredentialStore();
    const materialized = await this.repository.materializeCodexRuntimeJob({
      runtime_job_id: jobId,
      launch_lease_id: input.launch_lease_id,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      launch_token_hash: input.launch_token_hash,
      accepted_worker_session_digest: input.accepted_worker_session_digest,
      accepted_session_public_key_id: input.accepted_session_public_key_id,
      accepted_session_epoch: input.accepted_session_epoch,
      materialization_request_id: input.materialization_request_id,
      request_digest: input.body_digest,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/materialize`,
        input.body_digest,
      ),
      now,
    });
    return this.publicMaterialization(materialized);
  }

  async startRuntimeJob(workerId: string, jobId: string, input: StartCodexRuntimeJobDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const runtimeJob = await this.repository.startCodexRuntimeJob({
      runtime_job_id: jobId,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      idempotency_key: input.start_idempotency_key,
      request_digest: input.body_digest,
      runtime_evidence_digest: input.runtime_evidence_digest,
      launch_materialization_digest: input.launch_materialization_digest,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/started`,
        input.body_digest,
      ),
      now,
    });
    return { runtime_job: publicRuntimeJob(runtimeJob) };
  }

  async markCodexSessionRunnerOwner(workerId: string, jobId: string, input: MarkCodexSessionRunnerOwnerDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const runtimeJob = await this.requireWorkerRuntimeJob(workerId, jobId);
    if (
      runtimeJob.status !== 'running' ||
      runtimeJob.codex_session_id === undefined ||
      runtimeJob.codex_session_id !== input.session_id ||
      runtimeJob.launch_lease_id !== input.runner_launch_lease_id ||
      runtimeJob.id !== input.runner_runtime_job_id ||
      runtimeJob.runtime_evidence_digest === undefined ||
      runtimeJob.launch_materialization_digest === undefined
    ) {
      throw new BadRequestException('Codex session runner owner was rejected');
    }
    await this.repository.getCodexLaunchLeaseStatus({
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/session-runner/owner`,
        input.body_digest,
      ),
      now,
    });
    const session = await this.repository.markCodexSessionRunnerOwner({
      session_id: input.session_id,
      runner_worker_id: workerId,
      runner_launch_lease_id: input.runner_launch_lease_id,
      runner_runtime_job_id: input.runner_runtime_job_id,
      runner_expires_at: input.runner_expires_at,
      now,
    });
    return {
      session: {
        id: session.id,
        runner_worker_id: session.runner_worker_id,
        runner_launch_lease_id: session.runner_launch_lease_id,
        runner_runtime_job_id: session.runner_runtime_job_id,
        runner_expires_at: session.runner_expires_at,
      },
    };
  }

  async attachCodexSessionRunnerRuntimeJob(workerId: string, jobId: string, input: AttachCodexSessionRunnerRuntimeJobDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const runtimeJob = await this.repository.attachCodexSessionRunnerRuntimeJob({
      session_id: input.session_id,
      runner_launch_lease_id: input.runner_launch_lease_id,
      runner_runtime_job_id: input.runner_runtime_job_id,
      runner_expires_at: input.runner_expires_at,
      attached_runtime_job_id: jobId,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      runtime_evidence_digest: input.runtime_evidence_digest,
      launch_materialization_digest: input.launch_materialization_digest,
      idempotency_key: input.attach_idempotency_key,
      request_digest: input.body_digest,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/session-runner/attach`,
        input.body_digest,
      ),
      now,
    });
    return { runtime_job: publicRuntimeJob(runtimeJob) };
  }

  async appendRuntimeJobEvent(workerId: string, jobId: string, input: AppendCodexRuntimeJobEventDto) {
    assertWorkerBodyDigest(input);
    if (codexCanonicalDigest(input.event_payload_json) !== input.event_payload_digest) {
      throw new BadRequestException('Codex runtime job event payload digest was rejected');
    }
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    const runtimeJob = await this.repository.appendCodexRuntimeJobEvent({
      runtime_job_id: jobId,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      event_id: input.event_id,
      idempotency_key: input.event_idempotency_key,
      event_type: input.event_type,
      event_payload_json: input.event_payload_json,
      request_digest: input.body_digest,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/events`,
        input.body_digest,
      ),
      now,
    });
    return { runtime_job: publicRuntimeJob(runtimeJob) };
  }

  async createRuntimeJobArtifact(workerId: string, jobId: string, input: CreateCodexRuntimeJobArtifactDto) {
    const { body_digest: bodyDigest, ...unsignedMetadata } = input.metadata;
    const expectedBodyDigest = codexCanonicalDigest(
      runtimeArtifactUploadProofPayload({
        method: 'POST',
        path: input.proof_path,
        worker_id: workerId,
        runtime_job_id: jobId,
        metadata: unsignedMetadata,
      }),
    );
    if (bodyDigest !== expectedBodyDigest) {
      throw new BadRequestException('Codex worker request body digest was rejected');
    }
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.metadata.nonce_timestamp, now);
    const artifactId = deterministicRuntimeArtifactId(jobId, input.metadata.artifact_idempotency_key);
    const expectedInternalRef = buildInternalArtifactRef({
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: jobId,
      artifact_id: artifactId,
    });
    const sizeBytes = Number(input.metadata.size_bytes);
    const reservation = {
      runtime_job_id: jobId,
      worker_id: workerId,
      worker_session_token: input.metadata.worker_session_token,
      nonce: input.metadata.nonce,
      nonce_timestamp: input.metadata.nonce_timestamp,
      artifact_id: artifactId,
      artifact_idempotency_key: input.metadata.artifact_idempotency_key,
      kind: input.metadata.kind,
      name: input.metadata.name,
      content_type: input.metadata.content_type,
      digest: input.metadata.digest,
      internal_ref: expectedInternalRef,
      size_bytes: Number.isSafeInteger(sizeBytes) ? sizeBytes : -1,
      metadata_json: input.metadata.metadata_json,
      request_digest: bodyDigest,
      replay_protection: workerReplayProtection(
        'POST',
        input.proof_path,
        bodyDigest,
      ),
      now,
    };
    await this.repository.reserveCodexRuntimeJobArtifactUpload(reservation);
    const stored = await this.internalArtifacts.putObject({
      artifact_id: artifactId,
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: jobId,
      visibility: 'internal',
      content_type: input.metadata.content_type,
      declared_size_bytes: input.metadata.size_bytes,
      declared_artifact_digest: input.metadata.digest,
      idempotency_key: input.metadata.artifact_idempotency_key,
      metadata_json: input.metadata.metadata_json,
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: workerId,
      now,
      max_size_bytes: codexRuntimeJobArtifactMaxSizeBytes,
      bytes: input.bytes,
    });
    const artifact = await this.repository.bindReservedCodexRuntimeJobArtifact({
      ...reservation,
      internal_ref: stored.ref,
      internal_artifact_object_id: stored.id,
      size_bytes: Number(stored.size_bytes),
    });
    return { artifact };
  }

  async downloadWorkspaceBundle(workerId: string, jobId: string, bundleId: string, query: CodexRuntimeWorkerQueryDto) {
    assertWorkerBodyDigest(query);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(query.nonce_timestamp, now);
    const download = await this.repository.getWorkspaceBundleDownloadForRuntimeJob({
      runtime_job_id: jobId,
      bundle_id: bundleId,
      worker_id: workerId,
      worker_session_token: query.worker_session_token,
      nonce: query.nonce,
      nonce_timestamp: query.nonce_timestamp,
      replay_protection: workerReplayProtection(
        'GET',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/workspace-bundle/${bundleId}`,
        query.body_digest,
      ),
      now,
    });
    if (download.internal_artifact_object_id === undefined) {
      if (download.archive_bytes_base64 === undefined) {
        throw new BadRequestException('Workspace bundle bytes were rejected');
      }
      return {
        ...download,
        bytes: Buffer.from(download.archive_bytes_base64, 'base64'),
      };
    }
    const stored = await this.internalArtifacts.getObject(download.archive_ref);
    if (
      stored.artifact.id !== download.internal_artifact_object_id ||
      stored.artifact.kind !== 'workspace_bundle' ||
      stored.artifact.owner_type !== 'run_session' ||
      stored.artifact.ref !== download.archive_ref ||
      stored.artifact.digest !== download.archive_digest ||
      stored.artifact.size_bytes !== String(download.size_bytes) ||
      rawSha256(stored.bytes) !== download.archive_digest
    ) {
      throw new BadRequestException('Workspace bundle bytes were rejected');
    }
    return {
      ...download,
      bytes: Buffer.from(stored.bytes),
    };
  }

  async getRuntimeJobControl(workerId: string, jobId: string, query: CodexRuntimeWorkerQueryDto) {
    assertWorkerBodyDigest(query);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(query.nonce_timestamp, now);
    const runtimeJob = await this.requireWorkerRuntimeJob(workerId, jobId);
    await this.repository.getCodexLaunchLeaseStatus({
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: workerId,
      worker_session_token: query.worker_session_token,
      nonce: query.nonce,
      nonce_timestamp: query.nonce_timestamp,
      replay_protection: workerReplayProtection('GET', `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/control`, query.body_digest),
      now,
    });
    return {
      control: {
        cancel_requested: runtimeJob.cancel_requested_at !== undefined,
        drain_requested: runtimeJob.drain_requested_at !== undefined || runtimeJob.cancel_requested_at !== undefined,
        session_refresh_requested: false,
        shutdown_requested: false,
      },
    };
  }

  async terminalizeRuntimeJob(workerId: string, jobId: string, input: TerminalizeCodexRuntimeJobDto) {
    assertWorkerBodyDigest(input);
    const now = nowIso();
    assertFreshWorkerNonceTimestamp(input.nonce_timestamp, now);
    let terminalResult: ReturnType<typeof validateCodexRuntimeJobTerminalResult> | undefined;
    if (input.terminal_result_json !== undefined) {
      terminalResult = validateCodexRuntimeJobTerminalResult(input.terminal_result_json);
      collectCodexRuntimeJobTerminalArtifactRefs(input.terminal_result_json);
    }
    const runtimeJob = await this.repository.terminalizeCodexRuntimeJob({
      runtime_job_id: jobId,
      launch_lease_id: input.launch_lease_id,
      worker_id: workerId,
      worker_session_token: input.worker_session_token,
      nonce: input.nonce,
      nonce_timestamp: input.nonce_timestamp,
      terminal_status: input.terminal_status,
      reason_code: input.reason_code,
      ...(input.terminal_result_json === undefined ? {} : { terminal_result_json: input.terminal_result_json }),
      idempotency_key: input.terminal_idempotency_key,
      request_digest: input.body_digest,
      replay_protection: workerReplayProtection(
        'POST',
        `/internal/codex-workers/${workerId}/runtime-jobs/${jobId}/terminal`,
        input.body_digest,
      ),
      now,
    });
    if (
      runtimeJob.target_type === 'automation_action_run' &&
      runtimeJob.target_kind === 'generation' &&
      input.terminal_status === 'succeeded' &&
      terminalResult !== undefined &&
      'task_kind' in terminalResult
    ) {
      await this.productGenerationResults.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: runtimeJob.target_id,
        terminalResult: terminalResult as CodexGenerationRuntimeJobResult,
      });
    }
    if (
      runtimeJob.target_type === 'automation_action_run' &&
      runtimeJob.target_kind === 'generation' &&
      input.terminal_status !== 'succeeded'
    ) {
      await this.failProductGenerationActionRunForRuntimeTerminal({
        actionRunId: runtimeJob.target_id,
        runtimeJob,
        terminalStatus: input.terminal_status,
        reasonCode: input.reason_code,
        now,
      });
    }
    return { runtime_job: publicRuntimeJob(runtimeJob) };
  }

  private async failProductGenerationActionRunForRuntimeTerminal(input: {
    actionRunId: string;
    runtimeJob: CodexRuntimeJob;
    terminalStatus: CodexRuntimeJobTerminalStatus;
    reasonCode: string;
    now: string;
  }): Promise<void> {
    await this.terminalizeCodexSessionTurnForFailedRuntimeJob({
      runtimeJob: input.runtimeJob,
      terminalStatus: input.terminalStatus,
      reasonCode: input.reasonCode,
      now: input.now,
    });
    const actionRun = await this.repository.getAutomationActionRun(input.actionRunId);
    if (
      actionRun === undefined ||
      actionRun.status !== 'running' ||
      actionRun.claim_token === undefined ||
      !this.isProductGenerationAction(actionRun.action_type)
    ) {
      return;
    }
    try {
      await this.repository.completeAutomationActionRun({
        id: actionRun.id,
        idempotency_key: actionRun.idempotency_key,
        claim_token: actionRun.claim_token,
        status: input.terminalStatus === 'cancelled' ? 'blocked' : 'failed',
        result_json: {
          product_generation_result: 'runtime_job_failed',
          runtime_job_id: input.runtimeJob.id,
          reason_code: input.reasonCode,
          terminal_status: input.terminalStatus,
        },
        retryable: input.terminalStatus !== 'cancelled' && !this.isCodexSessionRuntimeJob(input.runtimeJob),
        finished_at: input.now,
      });
    } catch (error) {
      if (!(error instanceof DomainError && error.code === 'INVALID_TRANSITION')) {
        throw error;
      }
      const refreshed = await this.repository.getAutomationActionRun(actionRun.id);
      if (refreshed?.status !== 'succeeded' && refreshed?.status !== 'failed' && refreshed?.status !== 'blocked') {
        throw error;
      }
    }
  }

  private async terminalizeCodexSessionTurnForFailedRuntimeJob(input: {
    runtimeJob: CodexRuntimeJob;
    terminalStatus: CodexRuntimeJobTerminalStatus;
    reasonCode: string;
    now: string;
  }): Promise<void> {
    const workload = input.runtimeJob.input_json as Partial<CodexGenerationWorkloadV1>;
    const runtimeContext = workload.codex_session_runtime_context;
    const terminalization = workload.codex_session_terminalization;
    if (runtimeContext === undefined && terminalization === undefined) {
      return;
    }
    if (
      runtimeContext === undefined ||
      terminalization === undefined ||
      runtimeContext.codex_session_id !== input.runtimeJob.codex_session_id ||
      runtimeContext.codex_session_turn_id !== input.runtimeJob.codex_session_turn_id ||
      runtimeContext.lease_id === undefined ||
      runtimeContext.lease_epoch === undefined
    ) {
      throw new DomainError(
        'codex_session_stale_terminalization',
        `codex_session_stale_terminalization: Runtime job ${input.runtimeJob.id} CodexSession terminalization refs are invalid`,
      );
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
        status: input.terminalStatus === 'cancelled' ? 'cancelled' : 'failed',
        ...(runtimeContext.expected_input_capsule_digest === undefined
          ? {}
          : { expected_input_capsule_digest: runtimeContext.expected_input_capsule_digest }),
        failure_code: input.reasonCode,
        now: input.now,
      });
      await this.clearCodexSessionRunnerOwnerForTerminalRuntimeJob({
        sessionId: runtimeContext.codex_session_id,
        runnerLaunchLeaseId: runtimeContext.runner_launch_lease_id ?? input.runtimeJob.launch_lease_id,
        reasonCode: input.reasonCode,
        now: input.now,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'codex_session_stale_terminalization') {
        const turn = await this.repository.getCodexSessionTurn(runtimeContext.codex_session_turn_id);
        if (turn?.status === 'failed' || turn?.status === 'cancelled' || turn?.status === 'succeeded' || turn?.status === 'stale') {
          return;
        }
      }
      throw error;
    }
  }

  private isCodexSessionRuntimeJob(runtimeJob: CodexRuntimeJob): boolean {
    const workload = runtimeJob.input_json as Partial<CodexGenerationWorkloadV1>;
    return workload.codex_session_runtime_context !== undefined || workload.codex_session_terminalization !== undefined;
  }

  private async clearCodexSessionRunnerOwnerForTerminalRuntimeJob(input: {
    sessionId: string;
    runnerLaunchLeaseId?: string;
    reasonCode: string;
    now: string;
  }): Promise<void> {
    if (input.runnerLaunchLeaseId === undefined) {
      return;
    }
    try {
      await this.repository.clearCodexSessionRunnerOwner({
        session_id: input.sessionId,
        runner_launch_lease_id: input.runnerLaunchLeaseId,
        terminal_reason_code: input.reasonCode,
        now: input.now,
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

  private isProductGenerationAction(actionType: string): boolean {
    return (
      actionType === 'run_boundary_brainstorming_round' ||
      actionType === 'generate_development_plan_item_spec_revision' ||
      actionType === 'generate_development_plan_item_implementation_plan_revision'
    );
  }

  async createLaunchLease(input: CreateCodexLaunchLeaseDto) {
    validateCodexLaunchTargetKind(input.target.target_type, input.target.target_kind);
    const now = nowIso();
    const credential = await this.repository.getCodexCredentialBindingPublic(input.credential_binding_id);
    if (
      credential === undefined ||
      credential.active_version_id !== input.credential_binding_version_id ||
      credential.active_payload_digest !== input.credential_payload_digest
    ) {
      throw new BadRequestException('Codex credential binding fence was rejected');
    }
    const revision = await this.repository.getActiveCodexRuntimeProfileRevision({
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
      target_kind: input.target.target_kind,
      runtime_profile_id: credential.profile_id,
      now,
    });
    if (revision === undefined || revision.id !== input.runtime_profile_revision_id || revision.profile_id !== credential.profile_id) {
      throw new BadRequestException('Codex runtime profile revision fence was rejected');
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
    assertWorkerBodyDigest(input);
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
      replay_protection: workerReplayProtection('POST', `/internal/codex-workers/${workerId}/launch-leases/${leaseId}/materialize`, input.body_digest),
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
    assertWorkerBodyDigest(input);
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
      replay_protection: workerReplayProtection('POST', `/internal/codex-workers/${workerId}/launch-leases/${leaseId}/terminal`, input.body_digest),
      now,
    });
  }

  private async persistImportedProfile(
    input: ImportCodexRuntimeProfileDto | ImportLocalCodexDto,
    repository: DeliveryRepository,
  ): Promise<{
    profile_id: string;
    profile_revision_id: string;
    codex_config_digest: string;
    profile_digest: string;
  }> {
    const createdAt = nowIso();
    const environment = this.importEnvironment();
    const identity = importedProfileIdentity(input, environment);
    const profileId = deterministicCodexImportId('codex-runtime-profile-import', identity);
    const preliminaryRevision: CodexRuntimeProfileRevision = {
      id: '00000000-0000-4000-8000-000000000000',
      profile_id: profileId,
      revision_number: 1,
      status: 'active',
      environment,
      docker_image: input.docker_image,
      docker_image_digest: input.docker_image_digest,
      target_kind: input.target_kind,
      source_access_mode: input.target_kind === 'generation' ? 'artifact_only' : 'path_policy_scoped',
      codex_config_toml: input.codex_config_toml,
      codex_config_digest: codexCanonicalDigest(input.codex_config_toml),
      expected_effective_config_digest: input.expected_effective_config_digest,
      effective_config_assertions: importEffectiveConfigAssertions(input.target_kind),
      app_server_required: true,
      allowed_driver_kind: 'app_server',
      network_policy: input.network_policy as CodexRuntimeNetworkPolicy,
      resource_limits: defaultImportResourceLimits,
      docker_policy: defaultImportDockerPolicy,
      allowed_scopes: input.allowed_scopes as readonly CodexRuntimeScope[],
      profile_digest: '',
      created_by_actor_id: input.created_by.actor_id,
      created_at: createdAt,
    };
    const profileDigest = codexRuntimeProfileRevisionDigest(preliminaryRevision);
    const revisionId = deterministicCodexImportId('codex-runtime-profile-import-revision', { profile_id: profileId, profile_digest: profileDigest });
    const revisionWithoutDigest: CodexRuntimeProfileRevision = {
      ...preliminaryRevision,
      id: revisionId,
    };
    const revision = validateCodexRuntimeProfileRevision(
      {
        ...revisionWithoutDigest,
        profile_digest: profileDigest,
      },
      { strictRealDogfood: true },
    );
    const existingRevision = await repository.getActiveCodexRuntimeProfileRevision({
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      target_kind: input.target_kind,
      runtime_profile_id: profileId,
      now: createdAt,
    });
    if (existingRevision !== undefined) {
      if (
        existingRevision.id === revision.id &&
        existingRevision.codex_config_digest === revision.codex_config_digest &&
        existingRevision.profile_digest === revision.profile_digest
      ) {
        return {
          profile_id: profileId,
          profile_revision_id: existingRevision.id,
          codex_config_digest: existingRevision.codex_config_digest,
          profile_digest: existingRevision.profile_digest,
        };
      }
      throw new BadRequestException('Imported Codex runtime profile identity conflicts with existing profile');
    }
    const profileRevision = await repository.createCodexRuntimeProfileWithRevision({
      profile: {
        id: profileId,
        name: input.profile_name,
        environment,
        target_kind: input.target_kind,
        active_revision_id: revisionId,
        created_by_actor_id: input.created_by.actor_id,
        created_at: createdAt,
        updated_at: createdAt,
      },
      revision,
    });
    return {
      profile_id: profileId,
      profile_revision_id: profileRevision.id,
      codex_config_digest: profileRevision.codex_config_digest,
      profile_digest: profileRevision.profile_digest,
    };
  }

  private async persistImportedCredential(
    input: Pick<ImportCodexCredentialDto, 'profile_id' | 'project_id' | 'repo_id' | 'purpose' | 'auth_json' | 'provider' | 'created_by'>,
    repository: DeliveryRepository,
  ): Promise<{
    credential_binding_id: string;
    credential_binding_version_id: string;
    credential_payload_digest: string;
  }> {
    const createdAt = nowIso();
    const payloadDigest = codexCredentialPayloadDigest(input.auth_json);
    const credentialIdentity = importedCredentialIdentity(input);
    const bindingId = deterministicCodexImportId('codex-credential-import-binding', credentialIdentity);
    const versionId = deterministicCodexImportId('codex-credential-import-version', {
      binding_id: bindingId,
      credential_payload_digest: payloadDigest,
    });
    const existingCredential = await repository.getCodexCredentialBindingPublic(bindingId);
    if (existingCredential !== undefined) {
      if (
        existingCredential.profile_id === input.profile_id &&
        existingCredential.project_id === input.project_id &&
        existingCredential.repo_id === input.repo_id &&
        existingCredential.provider === input.provider &&
        existingCredential.purpose === input.purpose &&
        existingCredential.active_version_id === versionId &&
        existingCredential.active_payload_digest === payloadDigest
      ) {
        return {
          credential_binding_id: bindingId,
          credential_binding_version_id: versionId,
          credential_payload_digest: payloadDigest,
        };
      }
      throw new BadRequestException('Imported Codex credential identity conflicts with existing credential');
    }
    const version = await repository.createCodexCredentialBindingWithVersion({
      binding: {
        id: bindingId,
        profile_id: input.profile_id,
        project_id: input.project_id,
        ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
        provider: input.provider,
        purpose: input.purpose,
        active_version_id: versionId,
        created_by_actor_id: input.created_by.actor_id,
        created_at: createdAt,
        updated_at: createdAt,
      },
      version: {
        id: versionId,
        binding_id: bindingId,
        version_number: 1,
        status: 'active',
        payload_digest: payloadDigest,
        created_by_actor_id: input.created_by.actor_id,
        created_at: createdAt,
      },
      secret_payload_json: input.auth_json,
    });
    return {
      credential_binding_id: bindingId,
      credential_binding_version_id: version.id,
      credential_payload_digest: version.payload_digest,
    };
  }

  private importEnvironment(): CodexRuntimeProfileRevision['environment'] {
    return process.env.NODE_ENV === 'test' ? 'test' : 'local_dogfood';
  }

  private async requireWorkerRuntimeJob(workerId: string, jobId: string): Promise<CodexRuntimeJob> {
    const runtimeJob = await this.repository.getCodexRuntimeJob({ runtime_job_id: jobId });
    if (runtimeJob === undefined || runtimeJob.worker_id !== workerId) {
      throw new NotFoundException('Codex runtime job not found');
    }
    return runtimeJob;
  }

  private publicMaterialization(materialized: Awaited<ReturnType<DeliveryRepository['materializeCodexRuntimeJob']>>) {
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
