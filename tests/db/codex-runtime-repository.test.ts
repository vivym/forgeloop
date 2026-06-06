import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexWorkspaceAcquisitionDigest,
  codexRuntimeProfileRevisionDigest,
  DomainError,
  validateCodexLaunchTargetKind,
  type CodexCredentialBinding,
  type CodexCredentialBindingVersion,
  type CodexDockerNetworkProxyConfig,
  type CodexLaunchLease,
  type CodexLaunchTokenEnvelope,
  type InternalArtifactObject,
  type ExecutionPackage,
  type CodexLaunchLeaseWithToken,
  type CodexLaunchTarget,
  type CodexRuntimeScope,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type RunSession,
} from '../../packages/domain/src/index';

import { InMemoryDeliveryRepository, type CodexLaunchTokenEnvelopeSealer, type DeliveryRepository } from '../../packages/db/src/index';

type CodexRuntimeJobRepositoryContract = Pick<
  DeliveryRepository,
  | 'createOrReplayCodexRuntimeJobWithLeaseAndEnvelope'
  | 'pollCodexRuntimeJobs'
  | 'acceptCodexRuntimeJob'
  | 'claimCodexLaunchTokenEnvelope'
  | 'materializeCodexRuntimeJob'
  | 'startCodexRuntimeJob'
  | 'appendCodexRuntimeJobEvent'
  | 'createCodexRuntimeJobArtifact'
  | 'listCodexRuntimeJobArtifacts'
  | 'cancelCodexRuntimeJob'
  | 'terminalizeCodexRuntimeJob'
  | 'recoverStaleCodexRuntimeJobs'
  | 'getCodexLaunchLeaseStatus'
>;

const assertCodexRuntimeJobRepositoryContract = <T extends CodexRuntimeJobRepositoryContract>() => undefined;

const now = '2026-05-20T00:00:00.000Z';
const later = '2026-05-20T00:01:00.000Z';
const afterRuntimeJobExpiry = '2026-05-20T00:02:00.000Z';
const expiresAt = '2026-05-20T00:10:00.000Z';

const createRepository = (sealer?: CodexLaunchTokenEnvelopeSealer): DeliveryRepository =>
  new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: sealer });
const runtimeMetadata = {
  durability_mode: 'durable',
  recovery_attempt_count: 0,
  effective_dangerous_mode: 'confirmed',
} as const;

const tokenHash = (token: string) => codexCredentialPayloadDigest(token);
const bytesDigest = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fixtureDigest = (char: string) => `sha256:${char.repeat(64)}`;
const workspaceBundleArchiveFixture = (input: { bundle_id: string; created_at?: string; files?: Record<string, string> }) => {
  const files = Object.entries(input.files ?? { 'README.md': 'workspace bundle fixture\n' }).map(([path, content]) => {
    const bytes = Buffer.from(content, 'utf8');
    return {
      path,
      type: 'file',
      digest: bytesDigest(bytes),
      size_bytes: bytes.byteLength,
    };
  });
  const manifest = {
    schema_version: 'workspace_bundle.v1',
    bundle_id: input.bundle_id,
    created_at: input.created_at ?? now,
    allowed_paths: ['**'],
    forbidden_paths: [],
    entries: files.sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type)),
  };
  const archive = Buffer.from(
    JSON.stringify({
      schema_version: 'workspace_bundle_archive.v1',
      manifest,
      entries: Object.entries(input.files ?? { 'README.md': 'workspace bundle fixture\n' })
        .map(([path, content]) => ({
          path,
          type: 'file',
          content_base64: Buffer.from(content, 'utf8').toString('base64'),
        }))
        .sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type)),
    }),
    'utf8',
  );
  return {
    archive,
    archive_digest: bytesDigest(archive),
    manifest_digest: bytesDigest(JSON.stringify(manifest)),
  };
};

const dockerProxyConfig = (): CodexDockerNetworkProxyConfig => {
  const configWithoutDigest = {
    proxy_image: 'ghcr.io/forgeloop/codex-net-proxy',
    proxy_image_digest: `sha256:${'1'.repeat(64)}`,
    self_test_image: 'ghcr.io/forgeloop/codex-net-self-test',
    self_test_image_digest: `sha256:${'2'.repeat(64)}`,
  };

  return {
    ...configWithoutDigest,
    provider_config_digest: codexCanonicalDigest(configWithoutDigest),
  };
};

const dockerProxyNetworkPolicy = () => {
  const allowlistRules = [
    {
      id: 'openai',
      protocol: 'https' as const,
      host: 'api.openai.com',
      purpose: 'model_provider' as const,
    },
  ];
  return {
    mode: 'egress_allowlist' as const,
    provider: 'docker_network_proxy' as const,
    allowlist_rules: allowlistRules,
    provider_config: dockerProxyConfig(),
    egress_allowlist_digest: codexCanonicalDigest({
      provider: 'docker_network_proxy',
      allowlist_rules: allowlistRules,
    }),
    self_test_digest: dockerProxyConfig().self_test_image_digest,
  };
};

const profileRevision = (
  overrides: Partial<CodexRuntimeProfileRevision> = {},
): { profile: CodexRuntimeProfile; revision: CodexRuntimeProfileRevision } => {
  const createdAt = overrides.created_at ?? now;
  const targetKind = overrides.target_kind ?? 'generation';
  const sourceAccessMode = overrides.source_access_mode ?? (targetKind === 'generation' ? 'artifact_only' : 'path_policy_scoped');
  const profile: CodexRuntimeProfile = {
    id: overrides.profile_id ?? `runtime-profile-${targetKind}`,
    name: 'Codex generation docker runtime',
    environment: overrides.environment ?? 'test',
    target_kind: targetKind,
    active_revision_id: overrides.id ?? `runtime-profile-revision-${targetKind}`,
    created_by_actor_id: overrides.created_by_actor_id ?? 'actor-admin',
    created_at: createdAt,
    updated_at: createdAt,
  };
  const codexConfigToml = overrides.codex_config_toml ?? 'model = "gpt-5"\napproval_policy = "never"\n';
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    id: profile.active_revision_id ?? 'runtime-profile-revision-1',
    profile_id: profile.id,
    revision_number: overrides.revision_number ?? 1,
    status: overrides.status ?? 'active',
    environment: profile.environment,
    docker_image: overrides.docker_image ?? 'ghcr.io/forgeloop/codex-runtime',
    docker_image_digest: overrides.docker_image_digest ?? `sha256:${'a'.repeat(64)}`,
    target_kind: profile.target_kind,
    source_access_mode: sourceAccessMode,
    codex_config_toml: codexConfigToml,
    codex_config_digest: overrides.codex_config_digest ?? codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: overrides.expected_effective_config_digest ?? `sha256:${'b'.repeat(64)}`,
    effective_config_assertions:
      overrides.effective_config_assertions ??
      (targetKind === 'generation'
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
          }),
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy:
      overrides.network_policy ?? dockerProxyNetworkPolicy(),
    resource_limits: overrides.resource_limits ?? {
      cpu_ms: 120_000,
      memory_mb: 4096,
      pids: 512,
      fds: 1024,
      workspace_bytes: 2_000_000_000,
      artifact_bytes: 500_000_000,
      timeout_ms: 600_000,
      output_limit_bytes: 1_000_000,
      run_output_limit_bytes: 1_000_000,
    },
    docker_policy: overrides.docker_policy ?? {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: overrides.allowed_scopes ?? [{ project_id: 'project-1', repo_id: 'repo-1' }],
    profile_digest: `sha256:${'c'.repeat(64)}`,
    created_by_actor_id: profile.created_by_actor_id,
    created_at: createdAt,
  };
  const revision = {
    ...revisionWithoutDigest,
    ...overrides,
    profile_digest: codexRuntimeProfileRevisionDigest({ ...revisionWithoutDigest, ...overrides }),
  };

  return { profile, revision };
};

const credential = (
  overrides: Partial<CodexCredentialBinding> = {},
  versionOverrides: Partial<CodexCredentialBindingVersion> = {},
) => {
  const secretPayload = {
    env: {
      OPENAI_API_KEY: 'sk-test-private-key',
    },
    unsafe_db_payload: 'must-stay-private',
  };
  const binding: CodexCredentialBinding = {
    id: overrides.id ?? 'credential-binding-1',
    profile_id: overrides.profile_id ?? 'runtime-profile-generation',
    project_id: overrides.project_id ?? 'project-1',
    repo_id: overrides.repo_id ?? 'repo-1',
    provider: overrides.provider ?? 'unsafe_db',
    purpose: overrides.purpose ?? 'model_provider',
    active_version_id: versionOverrides.id ?? 'credential-version-1',
    created_by_actor_id: overrides.created_by_actor_id ?? 'actor-admin',
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
  const version: CodexCredentialBindingVersion = {
    id: binding.active_version_id ?? 'credential-version-1',
    binding_id: binding.id,
    version_number: versionOverrides.version_number ?? 1,
    status: versionOverrides.status ?? 'active',
    payload_digest: versionOverrides.payload_digest ?? codexCredentialPayloadDigest(secretPayload),
    created_by_actor_id: versionOverrides.created_by_actor_id ?? 'actor-admin',
    created_at: versionOverrides.created_at ?? now,
  };

  return { binding, version, secretPayload };
};

const generationTarget = (overrides: Partial<CodexLaunchTarget> = {}): CodexLaunchTarget => ({
  target_type: overrides.target_type ?? 'automation_action_run',
  target_id: overrides.target_id ?? 'generation-1',
  target_kind: overrides.target_kind ?? 'generation',
  project_id: overrides.project_id ?? 'project-1',
  repo_id: overrides.repo_id ?? 'repo-1',
});

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: overrides.id ?? 'run-session-1',
  execution_package_id: overrides.execution_package_id ?? 'execution-package-1',
  ...(overrides.workflow_id === undefined ? {} : { workflow_id: overrides.workflow_id }),
  ...(overrides.codex_session_id === undefined ? {} : { codex_session_id: overrides.codex_session_id }),
  ...(overrides.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: overrides.codex_session_turn_id }),
  requested_by_actor_id: overrides.requested_by_actor_id ?? 'actor-owner',
  status: overrides.status ?? 'running',
  changed_files: overrides.changed_files ?? [],
  check_results: overrides.check_results ?? [],
  artifacts: overrides.artifacts ?? [],
  log_refs: overrides.log_refs ?? [],
  runtime_metadata: overrides.runtime_metadata ?? runtimeMetadata,
  created_at: overrides.created_at ?? now,
  updated_at: overrides.updated_at ?? now,
  ...(overrides.executor_type !== undefined ? { executor_type: overrides.executor_type } : {}),
  ...(overrides.executor_result !== undefined ? { executor_result: overrides.executor_result } : {}),
  ...(overrides.run_spec !== undefined ? { run_spec: overrides.run_spec } : {}),
  ...(overrides.summary !== undefined ? { summary: overrides.summary } : {}),
  ...(overrides.failure_kind !== undefined ? { failure_kind: overrides.failure_kind } : {}),
  ...(overrides.failure_reason !== undefined ? { failure_reason: overrides.failure_reason } : {}),
  ...(overrides.started_at !== undefined ? { started_at: overrides.started_at } : {}),
  ...(overrides.finished_at !== undefined ? { finished_at: overrides.finished_at } : {}),
});

const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: overrides.id ?? 'execution-package-1',
  work_item_id: overrides.work_item_id ?? 'work-item-1',
  ...(overrides.development_plan_item_id === undefined ? {} : { development_plan_item_id: overrides.development_plan_item_id }),
  ...(overrides.workflow_id === undefined ? {} : { workflow_id: overrides.workflow_id }),
  ...(overrides.codex_session_id === undefined ? {} : { codex_session_id: overrides.codex_session_id }),
  ...(overrides.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: overrides.codex_session_turn_id }),
  spec_id: overrides.spec_id ?? 'spec-1',
  spec_revision_id: overrides.spec_revision_id ?? 'spec-revision-1',
  plan_id: overrides.plan_id ?? 'plan-1',
  plan_revision_id: overrides.plan_revision_id ?? 'plan-revision-1',
  project_id: overrides.project_id ?? 'project-1',
  repo_id: overrides.repo_id ?? 'repo-1',
  objective: overrides.objective ?? 'Implement Codex runtime package execution.',
  owner_actor_id: overrides.owner_actor_id ?? 'actor-owner',
  reviewer_actor_id: overrides.reviewer_actor_id ?? 'actor-reviewer',
  qa_owner_actor_id: overrides.qa_owner_actor_id ?? 'actor-qa',
  phase: overrides.phase ?? 'execution',
  activity_state: overrides.activity_state ?? 'idle',
  gate_state: overrides.gate_state ?? 'not_submitted',
  resolution: overrides.resolution ?? 'none',
  required_checks: overrides.required_checks ?? [],
  required_artifact_kinds: overrides.required_artifact_kinds ?? ['execution_summary'],
  allowed_paths: overrides.allowed_paths ?? ['packages/**'],
  forbidden_paths: overrides.forbidden_paths ?? [],
  source_mutation_policy: overrides.source_mutation_policy ?? 'path_policy_scoped',
  version: overrides.version ?? 1,
  created_at: overrides.created_at ?? now,
  updated_at: overrides.updated_at ?? now,
  ...(overrides.execution_package_set_id !== undefined ? { execution_package_set_id: overrides.execution_package_set_id } : {}),
  ...(overrides.execution_package_version !== undefined ? { execution_package_version: overrides.execution_package_version } : {}),
  ...(overrides.last_run_session_id !== undefined ? { last_run_session_id: overrides.last_run_session_id } : {}),
  ...(overrides.current_run_session_id !== undefined ? { current_run_session_id: overrides.current_run_session_id } : {}),
});

const seedProfileAndCredential = async (repository: DeliveryRepository, targetKind: CodexLaunchTarget['target_kind'] = 'generation') => {
  const { profile, revision } = profileRevision({ target_kind: targetKind });
  const credentialIds =
    targetKind === 'generation'
      ? {}
      : {
          binding: { id: `credential-binding-${targetKind}` },
          version: { id: `credential-version-${targetKind}` },
        };
  const { binding, version, secretPayload } = credential(
    { profile_id: profile.id, ...credentialIds.binding },
    credentialIds.version,
  );

    await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
    await repository.createCodexCredentialBindingWithVersion({
      binding,
      version,
      secret_payload_json: secretPayload,
    });

    return { profile, revision, binding, version, secretPayload };
  };

const heartbeatWorkerForRuntime = async (
  repository: DeliveryRepository,
  input: {
    targetKind: CodexLaunchTarget['target_kind'];
    revision: CodexRuntimeProfileRevision;
    allowedScopes: readonly CodexRuntimeScope[];
  },
) => {
  const workerId = `worker-${input.targetKind}`;
  const sessionToken = `session-token-${input.targetKind}`;
  await repository.createCodexWorkerBootstrapToken({
    id: `bootstrap-token-${input.targetKind}`,
    worker_identity: `local-worker-${input.targetKind}`,
    bootstrap_token_hash: tokenHash(`bootstrap-token-raw-${input.targetKind}`),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: input.allowedScopes,
    allowed_capabilities_json: {
      target_kinds: [input.targetKind],
      docker_image_digests: [input.revision.docker_image_digest],
      network_policy_digests: [codexRuntimeNetworkPolicyDigest(input.revision.network_policy)],
      network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
    },
    created_by_actor_id: 'actor-admin',
    created_at: now,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: `local-worker-${input.targetKind}`,
    version: '0.1.0',
    bootstrap_token_hash: tokenHash(`bootstrap-token-raw-${input.targetKind}`),
    bootstrap_token_version: 1,
    session_token: sessionToken,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: input.allowedScopes,
    capabilities: [input.targetKind],
    docker_image_digests: [input.revision.docker_image_digest],
    network_policy_digests: [codexRuntimeNetworkPolicyDigest(input.revision.network_policy)],
    network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: 0,
    max_concurrency: 2,
    labels: { host: 'test-host' },
    session_public_key_id: `session-key-${input.targetKind}`,
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'public-key-material',
    session_public_key_expires_at: expiresAt,
    now,
  });
  await repository.heartbeatCodexWorker({
    worker_id: workerId,
    session_token: sessionToken,
    nonce: `heartbeat-${input.targetKind}`,
    nonce_timestamp: now,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: [input.targetKind],
    now,
  });
};

const seedWorker = async (
  repository: DeliveryRepository,
  overrides: {
    worker_id?: string;
    worker_identity?: string;
    bootstrap_token_id?: string;
    bootstrap_token_raw?: string;
    session_token?: string;
    session_expires_at?: string;
    session_public_key_expires_at?: string;
    capabilities?: readonly CodexLaunchTarget['target_kind'][];
    allowedScopes?: readonly CodexRuntimeScope[];
    lease_count?: number;
    max_concurrency?: number;
  } = {},
) => {
  const workerId = overrides.worker_id ?? 'worker-1';
  const workerIdentity = overrides.worker_identity ?? (workerId === 'worker-1' ? 'local-worker-1' : `local-${workerId}`);
  const bootstrapTokenId =
    overrides.bootstrap_token_id ?? (workerId === 'worker-1' ? 'bootstrap-token-1' : `bootstrap-token-${workerId}`);
  const bootstrapTokenRaw =
    overrides.bootstrap_token_raw ?? (workerId === 'worker-1' ? 'bootstrap-token-raw' : `bootstrap-token-${workerId}-raw`);
  const sessionToken = overrides.session_token ?? 'session-token-1';
  const capabilities = overrides.capabilities ?? ['generation'];
  const allowedScopes = overrides.allowedScopes ?? [{ project_id: 'project-1', repo_id: 'repo-1' }];
  await repository.createCodexWorkerBootstrapToken({
    id: bootstrapTokenId,
    worker_identity: workerIdentity,
    bootstrap_token_hash: tokenHash(bootstrapTokenRaw),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: allowedScopes,
    allowed_capabilities_json: {
      target_kinds: capabilities,
      docker_image_digests: [`sha256:${'a'.repeat(64)}`],
      network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
      network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
    },
    created_by_actor_id: 'actor-admin',
    created_at: now,
    expires_at: expiresAt,
  });

  return {
    sessionToken,
    worker: await repository.upsertCodexWorkerRegistration({
      worker_id: workerId,
      worker_identity: workerIdentity,
      version: '0.1.0',
      bootstrap_token_hash: tokenHash(bootstrapTokenRaw),
      bootstrap_token_version: 1,
      session_token: sessionToken,
      session_expires_at: overrides.session_expires_at ?? expiresAt,
      status: 'online',
      control_channel_status: 'connected',
      allowed_scopes: allowedScopes,
      capabilities,
      docker_image_digests: [`sha256:${'a'.repeat(64)}`],
      network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
      network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
      host_worker_uid: 501,
      host_worker_gid: 20,
      lease_count: overrides.lease_count ?? 0,
      max_concurrency: overrides.max_concurrency ?? 2,
      labels: { host: 'test-host' },
      session_public_key_id: 'session-key-1',
      session_public_key_algorithm: 'x25519',
      session_public_key_material: 'public-key-material',
      session_public_key_expires_at: overrides.session_public_key_expires_at ?? expiresAt,
      now,
    }),
  };
};

const createLaunchLease = async (
  repository: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexLaunchLease']>[0]> = {},
  workerOverrides: Parameters<typeof seedWorker>[1] = {},
): Promise<CodexLaunchLeaseWithToken> => {
  const target = overrides.target ?? generationTarget();
  const seeded = await seedProfileAndCredential(repository, target.target_kind);
  const { worker, sessionToken } = await seedWorker(repository, { capabilities: [target.target_kind], ...workerOverrides });
  await repository.heartbeatCodexWorker({
    worker_id: worker.id,
    session_token: sessionToken,
    nonce: `launch-heartbeat-${overrides.id ?? 'launch-lease-1'}`,
    nonce_timestamp: now,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: [target.target_kind],
    now,
  });
  const defaultActionClaimToken = 'action-claim-token-1';
  const actionClaimTokenHash = overrides.action_claim_token_hash ?? tokenHash(defaultActionClaimToken);
  if (target.target_kind === 'generation' && actionClaimTokenHash === tokenHash(defaultActionClaimToken)) {
    try {
      await repository.getClaimedAutomationActionRun({ id: target.target_id, claim_token: defaultActionClaimToken });
    } catch {
      await claimGenerationAction(repository, {
        id: target.target_id,
        action_type: overrides.action_type ?? 'codex_generation',
        target_object_id: target.target_id,
        claim_token: defaultActionClaimToken,
        precondition_fingerprint: overrides.precondition_fingerprint ?? 'precondition-1',
      });
    }
  }

  return repository.createOrReplayCodexLaunchLease({
    id: 'launch-lease-1',
    lease_request_id: 'lease-request-1',
    target,
    worker_id: worker.id,
    runtime_profile_revision_id: seeded.revision.id,
    runtime_profile_digest: seeded.revision.profile_digest,
    credential_binding_id: seeded.binding.id,
    credential_binding_version_id: seeded.version.id,
    credential_payload_digest: seeded.version.payload_digest,
    docker_image_digest: seeded.revision.docker_image_digest,
    network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
    network_provider_config_digest: dockerProxyConfig().provider_config_digest,
    launch_token: 'launch-token-1',
    launch_attempt: 1,
    action_type: 'codex_generation',
    action_attempt: 1,
    action_claim_token_hash: tokenHash('action-claim-token-1'),
    precondition_fingerprint: 'precondition-1',
    expires_at: expiresAt,
    now,
    ...overrides,
  });
};

const createEnvelopeSealer = (
  calls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [],
  options: { failFirst?: boolean } = {},
): CodexLaunchTokenEnvelopeSealer => ({
  async sealLaunchTokenEnvelope(input) {
    calls.push(input);
    if (options.failFirst === true && calls.length === 1) {
      throw new Error('seal failed');
    }
    return {
      id: input.envelope_id,
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      worker_id: input.worker_id,
      key_id: input.key_id,
      algorithm: 'x25519-hkdf-sha256-aes-256-gcm',
      ciphertext: `sealed:${input.runtime_job_id}`,
      encryption_nonce: `nonce:${input.envelope_id}`,
      aad_json: {
        runtime_job_id: input.runtime_job_id,
        launch_lease_id: input.launch_lease_id,
        envelope_id: input.envelope_id,
        worker_id: input.worker_id,
        key_id: input.key_id,
        expires_at: input.expires_at,
      },
      aad_digest: codexCanonicalDigest({
        runtime_job_id: input.runtime_job_id,
        launch_lease_id: input.launch_lease_id,
        envelope_id: input.envelope_id,
        worker_id: input.worker_id,
        key_id: input.key_id,
        expires_at: input.expires_at,
      }),
      envelope_digest: tokenHash(`envelope:${input.runtime_job_id}:${input.launch_lease_id}:${input.envelope_id}`),
      expires_at: input.expires_at,
    };
  },
});

const runtimeJobInput = async (
  repository: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexRuntimeJobWithLeaseAndEnvelope']>[0]> = {},
  workerOverrides: Parameters<typeof seedWorker>[1] = {},
): Promise<Parameters<DeliveryRepository['createOrReplayCodexRuntimeJobWithLeaseAndEnvelope']>[0]> => {
  const target = overrides.target ?? generationTarget();
  const seeded = await seedProfileAndCredential(repository, target.target_kind);
  const { worker, sessionToken } = await seedWorker(repository, { capabilities: [target.target_kind], ...workerOverrides });
  await repository.heartbeatCodexWorker({
    worker_id: worker.id,
    session_token: sessionToken,
    nonce: `runtime-job-heartbeat-${overrides.runtime_job_id ?? 'runtime-job-1'}`,
    nonce_timestamp: now,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: [target.target_kind],
    now,
  });
  const defaultActionClaimToken = 'runtime-action-claim-token-1';
  const actionClaimTokenHash = overrides.action_claim_token_hash ?? tokenHash(defaultActionClaimToken);
  if (target.target_kind === 'generation' && actionClaimTokenHash === tokenHash(defaultActionClaimToken)) {
    try {
      await repository.getClaimedAutomationActionRun({ id: target.target_id, claim_token: defaultActionClaimToken });
    } catch {
      await claimGenerationAction(repository, {
        id: target.target_id,
        idempotency_key: `runtime-${target.target_id}-claim-idem`,
        action_type: overrides.action_type ?? 'codex_generation',
        target_object_id: target.target_id,
        claim_token: defaultActionClaimToken,
        precondition_fingerprint: overrides.precondition_fingerprint ?? 'runtime-precondition-1',
      });
    }
  }

  return {
    runtime_job_id: 'runtime-job-1',
    launch_lease_id: 'runtime-launch-lease-1',
    envelope_id: 'runtime-envelope-1',
    job_request_id: 'runtime-job-request-1',
    target,
    launch_attempt: 1,
    worker_id: worker.id,
    runtime_profile_revision_id: seeded.revision.id,
    runtime_profile_digest: seeded.revision.profile_digest,
    credential_binding_id: seeded.binding.id,
    credential_binding_version_id: seeded.version.id,
    credential_payload_digest: seeded.version.payload_digest,
    docker_image_digest: seeded.revision.docker_image_digest,
    network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
    network_provider_config_digest: dockerProxyConfig().provider_config_digest,
    input_json: { task: 'draft spec', public_ref: 'artifact://runtime/input' },
    input_digest: tokenHash('runtime-input-1'),
    workspace_acquisition_json: { bundle_id: 'workspace-bundle-1', archive_ref: 'artifact://runtime/workspace' },
    workspace_acquisition_digest: tokenHash('workspace-acquisition-1'),
    action_type: 'codex_generation',
    action_attempt: 1,
    action_claim_token_hash: tokenHash(defaultActionClaimToken),
    precondition_fingerprint: 'runtime-precondition-1',
    expires_at: expiresAt,
    now,
    ...overrides,
  };
};

const workflowRunExecutionWorkload = (
  overrides: {
    runtime_job_id?: string;
    workflow_id?: string;
    codex_session_id?: string;
    codex_session_turn_id?: string;
    run_session_id?: string;
    execution_package_id?: string;
    execution_package_version?: number;
  } = {},
): Record<string, unknown> => {
  const workflowId = overrides.workflow_id ?? 'workflow-1';
  const codexSessionId = overrides.codex_session_id ?? 'session-1';
  const codexSessionTurnId = overrides.codex_session_turn_id ?? 'turn-1';
  const inputCapsuleDigest = fixtureDigest('1');
  const inputMemoryDigest = fixtureDigest('2');
  const inputEnvironmentDigest = fixtureDigest('3');

  return {
    schema_version: 'codex_run_execution_workload.v1',
    runtime_job_id: overrides.runtime_job_id ?? 'workflow-runtime-job-1',
    plan_item_workflow_id: workflowId,
    development_plan_id: 'development-plan-1',
    development_plan_item_id: 'item-1',
    run_session_id: overrides.run_session_id ?? 'workflow-run-session-1',
    execution_package_id: overrides.execution_package_id ?? 'workflow-execution-package-1',
    execution_package_version: overrides.execution_package_version ?? 1,
    workspace_bundle_id: 'workflow-workspace-bundle-1',
    workspace_bundle_digest: fixtureDigest('4'),
    package_prompt_ref: 'artifact://codex-runtime-jobs/workflow-runtime-job-1/prompt',
    package_prompt_digest: fixtureDigest('5'),
    execution_context_ref: 'artifact://codex-runtime-jobs/workflow-runtime-job-1/context',
    execution_context_digest: fixtureDigest('6'),
    path_policy_digest: fixtureDigest('7'),
    output_schema_version: 'codex_run_execution_result.v1',
    created_at: now,
    expires_at: expiresAt,
    workspace_acquisition_json: {
      manifest_digest: fixtureDigest('8'),
      size_bytes: 128,
    },
    codex_session_runtime_context: {
      schema_version: 'codex_session_runtime_context.v1',
      codex_session_id: codexSessionId,
      codex_session_turn_id: codexSessionTurnId,
      lease_id: 'lease-1',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: tokenHash('session-token-1'),
      expected_input_capsule_digest: inputCapsuleDigest,
      turn_group_status: 'complete',
      continuation: {
        kind: 'resume_thread',
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-1' }),
      },
    },
    codex_session_terminalization: {
      schema_version: 'codex_session_terminalization.v1',
      lease_token: 'lease-token-secret',
      codex_session_id: codexSessionId,
      codex_session_turn_id: codexSessionTurnId,
      expected_input_capsule_digest: inputCapsuleDigest,
      input_capsule_id: 'capsule-1',
      input_capsule_ref: `artifact://internal/codex_runtime_capsule/codex_session/${codexSessionId}/capsule-1`,
      input_capsule_digest: inputCapsuleDigest,
      input_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${codexSessionId}/memory-1`,
      input_memory_bundle_digest: inputMemoryDigest,
      input_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${codexSessionId}/env-1`,
      input_environment_manifest_digest: inputEnvironmentDigest,
    },
  };
};

const workflowRuntimeJobRecords = (repository: DeliveryRepository): Map<string, { job: { input_json: Record<string, unknown> } }> =>
  (repository as unknown as { codexRuntimeJobs: Map<string, { job: { input_json: Record<string, unknown> } }> }).codexRuntimeJobs;

const corruptStoredWorkflowRuntimeJobLineage = (
  repository: DeliveryRepository,
  runtimeJobId: string,
  corruptTurnId = 'turn-different',
) => {
  const records = workflowRuntimeJobRecords(repository);
  const record = records.get(runtimeJobId);
  if (record === undefined) {
    throw new Error(`Expected runtime job ${runtimeJobId}`);
  }
  records.set(runtimeJobId, {
    ...record,
    job: {
      ...record.job,
      input_json: workflowRunExecutionWorkload({
        runtime_job_id: runtimeJobId,
        codex_session_turn_id: corruptTurnId,
      }),
    },
  });
};

const workflowRunExecutionRuntimeJobInput = async (
  repository: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexRuntimeJobWithLeaseAndEnvelope']>[0]> = {},
) => {
  const runtimeJobId = overrides.runtime_job_id ?? 'workflow-runtime-job-1';
  const runSessionId = overrides.target?.target_id ?? 'workflow-run-session-1';
  const executionPackageId = overrides.execution_package_id ?? 'workflow-execution-package-1';
  const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: `pending-bundle-${runtimeJobId}` });
  const run = runSession({
    id: runSessionId,
    execution_package_id: executionPackageId,
    workflow_id: overrides.workflow_id ?? 'workflow-1',
    codex_session_id: overrides.codex_session_id ?? 'session-1',
    codex_session_turn_id: overrides.codex_session_turn_id ?? 'turn-1',
  });
  await repository.saveExecutionPackage({
    ...executionPackage({ id: executionPackageId }),
    workflow_id: run.workflow_id,
    codex_session_id: run.codex_session_id,
    codex_session_turn_id: run.codex_session_turn_id,
    development_plan_item_id: 'item-1',
  });
  await repository.saveRunSession(run);
  const runWorkerLeaseToken = `run-worker-token-${runtimeJobId}`;
  const runWorkerLease = await repository.claimRunWorkerLease({
    run_session_id: run.id,
    worker_id: `run-worker-${runtimeJobId}`,
    lease_token: runWorkerLeaseToken,
    now,
    expires_at: expiresAt,
  });
  const workspaceAcquisitionJson = {
    schema_version: 'workspace_bundle_acquisition.v1',
    bundle_id: `pending-bundle-${runtimeJobId}`,
    archive_ref: `artifact://internal/workspace_bundle/run_session/${run.id}/pending-bundle-${runtimeJobId}`,
    archive_digest: archiveFixture.archive_digest,
    manifest_digest: archiveFixture.manifest_digest,
    size_bytes: archiveFixture.archive.byteLength,
    expires_at: later,
  };
  const pendingBundle = {
    bundle_id: workspaceAcquisitionJson.bundle_id,
    pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
    internal_artifact_object_id: `artifact-object-${runtimeJobId}`,
    archive_digest: workspaceAcquisitionJson.archive_digest,
    manifest_digest: workspaceAcquisitionJson.manifest_digest,
    run_worker_lease_id: runWorkerLease.id,
    size_bytes: archiveFixture.archive.byteLength,
    workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
    workspace_acquisition_json: workspaceAcquisitionJson,
    expires_at: later,
  };
  await createInternalArtifactObject(repository, {
    id: pendingBundle.internal_artifact_object_id,
    artifact_id: pendingBundle.bundle_id,
    ref: pendingBundle.pending_artifact_ref,
    kind: 'workspace_bundle',
    owner_type: 'run_session',
    owner_id: run.id,
    size_bytes: pendingBundle.size_bytes,
    digest: pendingBundle.archive_digest,
    metadata_json: {
      manifest_digest: pendingBundle.manifest_digest,
      execution_package_id: run.execution_package_id,
      run_worker_lease_id: runWorkerLease.id,
    },
  });
  const pendingWorkspaceBundle = {
    ...pendingBundle,
    id: `pending-bundle-row-${runtimeJobId}`,
    run_session_id: run.id,
    execution_package_id: run.execution_package_id,
    request_digest: tokenHash(`pending-workspace-request-${runtimeJobId}`),
    created_at: now,
  };
  await repository.createPendingWorkspaceBundleArtifact(pendingWorkspaceBundle);

  return runtimeJobInput(
    repository,
    {
      runtime_job_id: runtimeJobId,
      launch_lease_id: overrides.launch_lease_id ?? `workflow-launch-lease-${runtimeJobId}`,
      envelope_id: overrides.envelope_id ?? `workflow-envelope-${runtimeJobId}`,
      job_request_id: overrides.job_request_id ?? `workflow-job-request-${runtimeJobId}`,
      target: generationTarget({
        target_type: 'run_session',
        target_kind: 'run_execution',
        target_id: run.id,
      }),
      action_type: undefined,
      action_attempt: undefined,
      action_claim_token_hash: undefined,
      precondition_fingerprint: undefined,
      execution_package_id: run.execution_package_id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token_hash: tokenHash(runWorkerLeaseToken),
      run_session_status: run.status,
      run_session_updated_at: run.updated_at,
      execution_package_version: 1,
      workflow_id: run.workflow_id,
      codex_session_id: run.codex_session_id,
      codex_session_turn_id: run.codex_session_turn_id,
      input_json: workflowRunExecutionWorkload({
        runtime_job_id: runtimeJobId,
        workflow_id: run.workflow_id,
        codex_session_id: run.codex_session_id,
        codex_session_turn_id: run.codex_session_turn_id,
        run_session_id: run.id,
        execution_package_id: run.execution_package_id,
      }),
      input_digest: tokenHash(`workflow-runtime-input-${runtimeJobId}`),
      workspace_acquisition_json: pendingBundle.workspace_acquisition_json,
      workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
      pending_workspace_bundle: pendingWorkspaceBundle,
      ...overrides,
    },
    { capabilities: ['run_execution'], ...(overrides.worker_id === undefined ? {} : { worker_id: overrides.worker_id }) },
  );
};

const createWorkflowRuntimeJobWithCapturedToken = async (
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexRuntimeJobWithLeaseAndEnvelope']>[0]> = {},
) => {
  const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
  const repository = createRepository(createEnvelopeSealer(sealerCalls));
  const input = await workflowRunExecutionRuntimeJobInput(repository, overrides);
  const created = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
  const launchToken = sealerCalls[0]?.plaintext_launch_token;
  if (launchToken === undefined) {
    throw new Error('expected workflow runtime job sealer to capture launch token');
  }
  return { repository, input, created, launchToken, sealerCalls };
};

const runtimeJobArtifactBindings = (repository: DeliveryRepository): Map<string, Record<string, unknown>> =>
  (repository as unknown as { codexRuntimeJobArtifacts: Map<string, Record<string, unknown>> }).codexRuntimeJobArtifacts;
const pendingWorkspaceBundles = (repository: DeliveryRepository): Map<string, Record<string, unknown>> =>
  (repository as unknown as { codexPendingWorkspaceBundles: Map<string, Record<string, unknown>> }).codexPendingWorkspaceBundles;

const createRuntimeJob = async (
  repository: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexRuntimeJobWithLeaseAndEnvelope']>[0]> = {},
  workerOverrides: Parameters<typeof seedWorker>[1] = {},
) => {
  const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
  const input = await runtimeJobInput(repository, overrides, workerOverrides);
  const created = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
  return { input, created, sealerCalls };
};

const createRuntimeJobWithCapturedToken = async (
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexRuntimeJobWithLeaseAndEnvelope']>[0]> = {},
  workerOverrides: Parameters<typeof seedWorker>[1] = {},
) => {
  const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
  const repository = createRepository(createEnvelopeSealer(sealerCalls));
  const input = await runtimeJobInput(repository, overrides, workerOverrides);
  const created = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
  const launchToken = sealerCalls[0]?.plaintext_launch_token;
  if (launchToken === undefined) {
    throw new Error('expected runtime job sealer to capture launch token');
  }
  return { repository, input, created, launchToken, sealerCalls };
};

const acceptRuntimeJob = (
  repository: DeliveryRepository,
  runtimeJobId = 'runtime-job-1',
  patch: Partial<Parameters<DeliveryRepository['acceptCodexRuntimeJob']>[0]> = {},
) =>
  repository.acceptCodexRuntimeJob({
    runtime_job_id: runtimeJobId,
    worker_id: 'worker-1',
    worker_session_token: 'session-token-1',
    nonce: `accept-nonce-${runtimeJobId}`,
    nonce_timestamp: later,
    accepted_worker_session_digest: tokenHash('session-token-1'),
    accepted_session_public_key_id: 'session-key-1',
    accepted_session_epoch: 1,
    idempotency_key: `accept-${runtimeJobId}`,
    request_digest: tokenHash(`accept-request-${runtimeJobId}`),
    now: later,
    ...patch,
  });

const claimRuntimeJobEnvelope = (
  repository: DeliveryRepository,
  runtimeJobId = 'runtime-job-1',
  envelopeId = 'runtime-envelope-1',
  patch: Partial<Parameters<DeliveryRepository['claimCodexLaunchTokenEnvelope']>[0]> = {},
) =>
  repository.claimCodexLaunchTokenEnvelope({
    runtime_job_id: runtimeJobId,
    envelope_id: envelopeId,
    worker_id: 'worker-1',
    worker_session_token: 'session-token-1',
    nonce: `claim-nonce-${runtimeJobId}`,
    nonce_timestamp: later,
    accepted_worker_session_digest: tokenHash('session-token-1'),
    key_id: 'session-key-1',
    accepted_session_epoch: 1,
    claim_request_id: `claim-${runtimeJobId}`,
    request_digest: tokenHash(`claim-request-${runtimeJobId}`),
    now: later,
    ...patch,
  });

const materializeRuntimeJob = (
  repository: DeliveryRepository,
  launchToken: string,
  runtimeJobId = 'runtime-job-1',
  leaseId = 'runtime-launch-lease-1',
  patch: Partial<Parameters<DeliveryRepository['materializeCodexRuntimeJob']>[0]> = {},
) =>
  repository.materializeCodexRuntimeJob({
    runtime_job_id: runtimeJobId,
    launch_lease_id: leaseId,
    worker_id: 'worker-1',
    worker_session_token: 'session-token-1',
    nonce: `materialize-nonce-${runtimeJobId}`,
    nonce_timestamp: later,
    launch_token_hash: tokenHash(launchToken),
    accepted_worker_session_digest: tokenHash('session-token-1'),
    accepted_session_public_key_id: 'session-key-1',
    accepted_session_epoch: 1,
    materialization_request_id: `materialize-${runtimeJobId}`,
    request_digest: tokenHash(`materialize-request-${runtimeJobId}`),
    active_fence: {
      action_claim_token_hash: tokenHash('runtime-action-claim-token-1'),
      precondition_fingerprint: 'runtime-precondition-1',
    },
    now: later,
    ...patch,
  });

const validGenerationTerminalResult = (summary = 'completed') => {
  const generatedPayload = { summary };
  return {
    task_kind: 'spec_draft' as const,
    prompt_version: 'prompt-v1',
    output_schema_version: 'spec-draft.v1',
    generated_payload: generatedPayload,
    generated_payload_digest: codexCanonicalDigest(generatedPayload),
    generation_artifacts: [],
    public_summary: summary,
  };
};

const startRuntimeJob = (
  repository: DeliveryRepository,
  runtimeJobId = 'runtime-job-1',
  patch: Partial<Parameters<DeliveryRepository['startCodexRuntimeJob']>[0]> = {},
) =>
  repository.startCodexRuntimeJob({
    runtime_job_id: runtimeJobId,
    worker_id: 'worker-1',
    worker_session_token: 'session-token-1',
    nonce: `start-nonce-${runtimeJobId}`,
    nonce_timestamp: later,
    idempotency_key: `start-${runtimeJobId}`,
    request_digest: tokenHash(`start-request-${runtimeJobId}`),
    runtime_evidence_digest: tokenHash(`runtime-evidence-${runtimeJobId}`),
    launch_materialization_digest: tokenHash(`launch-materialization-${runtimeJobId}`),
    now: later,
    ...patch,
  });

const terminalizeRuntimeJob = (
  repository: DeliveryRepository,
  runtimeJobId = 'runtime-job-1',
  leaseId = 'runtime-launch-lease-1',
  patch: Partial<Parameters<DeliveryRepository['terminalizeCodexRuntimeJob']>[0]> = {},
) =>
  repository.terminalizeCodexRuntimeJob({
    runtime_job_id: runtimeJobId,
    launch_lease_id: leaseId,
    worker_id: 'worker-1',
    worker_session_token: 'session-token-1',
    nonce: `terminal-nonce-${runtimeJobId}`,
    nonce_timestamp: later,
    terminal_status: 'succeeded',
    reason_code: 'completed',
    terminal_result_json: validGenerationTerminalResult(),
    idempotency_key: `terminal-${runtimeJobId}`,
    request_digest: tokenHash(`terminal-request-${runtimeJobId}`),
    now: later,
    ...patch,
  });

const createRuntimeJobArtifact = (
  repository: DeliveryRepository,
  runtimeJobId = 'runtime-job-1',
  patch: Partial<Parameters<DeliveryRepository['createCodexRuntimeJobArtifact']>[0]> = {},
) => {
  const artifactId = `11111111-1111-4111-8111-${runtimeJobId === 'runtime-job-1' ? '111111111111' : '222222222222'}`;
  const objectId = `33333333-3333-4333-8333-${runtimeJobId === 'runtime-job-1' ? '111111111111' : '222222222222'}`;
  const internalRef = `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${runtimeJobId}/${artifactId}`;
  const base = {
    runtime_job_id: runtimeJobId,
    worker_id: 'worker-1',
    worker_session_token: 'session-token-1',
    nonce: `artifact-nonce-${runtimeJobId}`,
    nonce_timestamp: later,
    artifact_id: artifactId,
    artifact_idempotency_key: `artifact-${runtimeJobId}`,
    kind: 'generated_payload',
    name: 'generated-payload.json',
    content_type: 'application/json',
    digest: tokenHash(`artifact-digest-${runtimeJobId}`),
    internal_ref: internalRef,
    internal_artifact_object_id: objectId,
    size_bytes: 128,
    metadata_json: {},
    request_digest: tokenHash(`artifact-request-${runtimeJobId}`),
    now: later,
    ...patch,
  };
  const object: InternalArtifactObject = {
    id: base.internal_artifact_object_id,
    artifact_id: base.artifact_id,
    ref: base.internal_ref,
    storage_key: `objects/${base.digest.slice('sha256:'.length)}`,
    kind: 'codex_runtime_job_artifact',
    content_type: base.content_type,
    size_bytes: String(base.size_bytes),
    digest: base.digest,
    visibility: 'internal',
    owner_type: 'codex_runtime_job',
    owner_id: base.runtime_job_id,
    idempotency_key: base.artifact_idempotency_key,
    request_digest: base.request_digest,
    metadata_json: base.metadata_json,
    created_by_actor_type: 'codex_worker',
    created_by_actor_id: base.worker_id,
    created_at: base.now,
  };
  return repository.createOrReplayInternalArtifactObject(object).then(() => repository.createCodexRuntimeJobArtifact(base));
};

const createInternalArtifactObject = (
  repository: DeliveryRepository,
  input: {
    id: string;
    artifact_id: string;
    ref: string;
    kind: InternalArtifactObject['kind'];
    owner_type: InternalArtifactObject['owner_type'];
    owner_id: string;
    size_bytes: number;
    digest: string;
    metadata_json?: Record<string, unknown>;
    idempotency_key?: string;
    content_type?: string;
    created_by_actor_type?: InternalArtifactObject['created_by_actor_type'];
    created_by_actor_id?: string;
  },
) =>
  repository.createOrReplayInternalArtifactObject({
    id: input.id,
    artifact_id: input.artifact_id,
    ref: input.ref,
    storage_key: `objects/${input.digest.slice('sha256:'.length)}`,
    kind: input.kind,
    content_type: input.content_type ?? 'application/vnd.forgeloop.workspace-bundle',
    size_bytes: String(input.size_bytes),
    digest: input.digest,
    visibility: 'internal',
    owner_type: input.owner_type,
    owner_id: input.owner_id,
    idempotency_key: input.idempotency_key ?? input.artifact_id,
    request_digest: tokenHash(`internal-object-request:${input.id}`),
    metadata_json: input.metadata_json ?? {},
    created_by_actor_type: input.created_by_actor_type ?? 'run_worker',
    created_by_actor_id: input.created_by_actor_id ?? 'run-worker-1',
    created_at: now,
  });

const runtimeLaunchLeases = (repository: DeliveryRepository): Map<string, { lease: CodexLaunchLease }> =>
  (repository as unknown as { codexLaunchLeases: Map<string, { lease: CodexLaunchLease }> }).codexLaunchLeases;

const runtimeTokenEnvelopes = (repository: DeliveryRepository): Map<string, CodexLaunchTokenEnvelope> =>
  (repository as unknown as { codexLaunchTokenEnvelopes: Map<string, CodexLaunchTokenEnvelope> }).codexLaunchTokenEnvelopes;

const claimGenerationAction = (
  repository: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository['claimAutomationActionRun']>[0]> = {},
) =>
  repository.claimAutomationActionRun({
    id: 'generation-action-1',
    action_type: 'codex_generation',
    target_object_type: 'generation_request',
    target_object_id: 'generation-1',
    target_revision_id: 'spec-revision-1',
    target_status: 'running',
    target_version: 1,
    idempotency_key: 'generation-action-1-idem',
    automation_scope: 'repo:project-1:repo-1',
    automation_settings_version: 1,
    capability_fingerprint: 'capability-codex',
    precondition_fingerprint: 'precondition-1',
    action_input_json: { generation_id: 'generation-1' },
    claim_token: 'generation-action-claim-1',
    locked_until: expiresAt,
    now,
    ...overrides,
  });

describe('codex runtime repository behavior', () => {
  it('creates and reads active profile revisions by target kind and scope', async () => {
    const repository = createRepository();
    const { revision } = await seedProfileAndCredential(repository);

    await expect(
      repository.getActiveCodexRuntimeProfileRevision({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        now,
      }),
    ).resolves.toEqual(revision);

    await expect(
      repository.getActiveCodexRuntimeProfileRevision({
        project_id: 'project-2',
        repo_id: 'repo-2',
        target_kind: 'generation',
        now,
      }),
    ).resolves.toBeUndefined();
  });

  it('creates credential versions and redacts public metadata', async () => {
    const repository = createRepository();
    const { binding, version, secretPayload } = await seedProfileAndCredential(repository);

    await expect(repository.getCodexCredentialBindingPublic(binding.id)).resolves.toEqual({
      id: binding.id,
      profile_id: binding.profile_id,
      project_id: binding.project_id,
      repo_id: binding.repo_id,
      provider: binding.provider,
      purpose: binding.purpose,
      active_version_id: version.id,
      active_payload_digest: version.payload_digest,
    });

    expect(JSON.stringify(await repository.getCodexCredentialBindingPublic(binding.id))).not.toContain(
      secretPayload.env.OPENAI_API_KEY,
    );
  });

  it('stores unsafe DB payload only in the credential-version private path', async () => {
    const repository = createRepository();
    const { binding, version, secretPayload } = await seedProfileAndCredential(repository);

    await expect(
      repository.resolveCodexCredentialForLaunch({
        credential_binding_id: binding.id,
        target_kind: 'generation',
        runtime_profile_id: binding.profile_id,
        project_id: 'project-1',
        repo_id: 'repo-1',
        required_payload_digest: version.payload_digest,
        now,
      }),
    ).resolves.toMatchObject({
      binding_id: binding.id,
      binding_version_id: version.id,
      payload: secretPayload,
      payload_digest: version.payload_digest,
    });

    const status = await repository.getCodexRuntimeStatus({
      project_id: 'project-1',
      repo_id: 'repo-1',
      target_kind: 'generation',
      credential_binding_id: binding.id,
      now,
    });

    expect(JSON.stringify(status)).not.toContain('sk-test-private-key');
    expect(JSON.stringify(status)).not.toContain('must-stay-private');
  });

  it('does not project credential metadata outside the requested runtime scope', async () => {
    const repository = createRepository();
    const { binding } = await seedProfileAndCredential(repository);
    const projectB = profileRevision({
      id: 'runtime-profile-revision-project-2',
      profile_id: 'runtime-profile-project-2',
      allowed_scopes: [{ project_id: 'project-2', repo_id: 'repo-2' }],
    });
    await repository.createCodexRuntimeProfileWithRevision(projectB);

    const status = await repository.getCodexRuntimeStatus({
      project_id: 'project-2',
      repo_id: 'repo-2',
      target_kind: 'generation',
      credential_binding_id: binding.id,
      now,
    });

    expect(status).toMatchObject({
      runtime_profile_id: projectB.profile.id,
      runtime_profile_revision_id: projectB.revision.id,
      blocker_codes: expect.arrayContaining(['codex_credential_unavailable', 'codex_worker_unavailable']),
    });
    expect(status).not.toHaveProperty('credential_binding_id');
    expect(status).not.toHaveProperty('credential_binding_version_id');
    expect(status).not.toHaveProperty('credential_payload_digest');
  });

  it('projects the only matching model-provider credential when runtime status is queried by scope', async () => {
    const repository = createRepository();
    const { revision, binding, version } = await seedProfileAndCredential(repository, 'run_execution');
    await heartbeatWorkerForRuntime(repository, { targetKind: 'run_execution', revision, allowedScopes: revision.allowed_scopes });

    const status = await repository.getCodexRuntimeStatus({
      project_id: 'project-1',
      repo_id: 'repo-1',
      target_kind: 'run_execution',
      now,
    });

    expect(status).toMatchObject({
      runtime_profile_id: 'runtime-profile-run_execution',
      credential_binding_id: binding.id,
      credential_binding_version_id: version.id,
      credential_payload_digest: version.payload_digest,
      profile_status: 'active',
      worker_status: 'online',
      blocker_codes: [],
    });
  });

  it('does not auto-project ambiguous model-provider credentials in runtime status', async () => {
    const repository = createRepository();
    const { profile, revision, binding } = await seedProfileAndCredential(repository, 'run_execution');
    const other = credential(
      { id: 'credential-binding-run-2', profile_id: profile.id },
      { id: 'credential-version-run-2' },
    );
    await repository.createCodexCredentialBindingWithVersion({
      binding: other.binding,
      version: other.version,
      secret_payload_json: other.secretPayload,
    });
    await heartbeatWorkerForRuntime(repository, { targetKind: 'run_execution', revision, allowedScopes: revision.allowed_scopes });

    const status = await repository.getCodexRuntimeStatus({
      project_id: binding.project_id,
      repo_id: binding.repo_id,
      target_kind: 'run_execution',
      now,
    });

    expect(status).toMatchObject({
      runtime_profile_id: profile.id,
      profile_status: 'active',
      worker_status: 'online',
    });
    expect(status).not.toHaveProperty('credential_binding_id');
    expect(status).not.toHaveProperty('credential_binding_version_id');
    expect(status).not.toHaveProperty('credential_payload_digest');
  });

  it('registers workers and heartbeat updates availability', async () => {
    const repository = createRepository();
    await seedProfileAndCredential(repository);
    const { worker, sessionToken } = await seedWorker(repository);

    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision().revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now,
      }),
    ).resolves.toBeUndefined();

    const heartbeat = await repository.heartbeatCodexWorker({
      worker_id: worker.id,
      session_token: sessionToken,
      nonce: 'heartbeat-nonce-1',
      nonce_timestamp: later,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: later,
    });

    expect(heartbeat.last_heartbeat_at).toBe(later);
    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision().revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now: later,
      }),
    ).resolves.toMatchObject({ id: worker.id, status: 'online' });

    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision().revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now: '2026-05-20T00:07:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });

  it('prefers the freshest available worker when compatible workers have equal lease load', async () => {
    const repository = createRepository();
    await seedProfileAndCredential(repository);
    const { worker: olderWorker, sessionToken: olderSessionToken } = await seedWorker(repository, { worker_id: 'worker-1' });
    const { worker: newerWorker, sessionToken: newerSessionToken } = await seedWorker(repository, {
      worker_id: 'worker-2',
      session_token: 'session-token-2',
    });

    for (const [worker, sessionToken, nonce] of [
      [olderWorker, olderSessionToken, 'heartbeat-worker-1'],
      [newerWorker, newerSessionToken, 'heartbeat-worker-2'],
    ] as const) {
      await repository.heartbeatCodexWorker({
        worker_id: worker.id,
        session_token: sessionToken,
        nonce,
        nonce_timestamp: later,
        status: 'online',
        control_channel_status: 'connected',
        active_lease_count: 0,
        capabilities: ['generation'],
        now: later,
      });
    }

    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision().revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now: later,
      }),
    ).resolves.toMatchObject({ id: newerWorker.id });

    const freshest = '2026-05-20T00:02:00.000Z';
    await repository.heartbeatCodexWorker({
      worker_id: olderWorker.id,
      session_token: olderSessionToken,
      nonce: 'heartbeat-worker-1-freshest',
      nonce_timestamp: freshest,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: freshest,
    });

    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision().revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now: freshest,
      }),
    ).resolves.toMatchObject({ id: olderWorker.id });
  });

  it('rejects heartbeat capability escalation beyond registration capabilities', async () => {
    const repository = createRepository();
    await seedProfileAndCredential(repository, 'run_execution');
    const { worker, sessionToken } = await seedWorker(repository, { capabilities: ['generation'] });

    await expect(
      repository.heartbeatCodexWorker({
        worker_id: worker.id,
        session_token: sessionToken,
        nonce: 'heartbeat-escalation-nonce',
        nonce_timestamp: later,
        status: 'online',
        control_channel_status: 'connected',
        active_lease_count: 0,
        capabilities: ['generation', 'run_execution'],
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_registration_denied',
    });

    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'run_execution',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision({ target_kind: 'run_execution' }).revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now: later,
      }),
    ).resolves.toBeUndefined();
  });

  it('uses heartbeat-downgraded capabilities for worker availability', async () => {
    const repository = createRepository();
    await seedProfileAndCredential(repository, 'generation');
    await seedProfileAndCredential(repository, 'run_execution');
    const { worker, sessionToken } = await seedWorker(repository, { capabilities: ['generation', 'run_execution'] });

    await repository.heartbeatCodexWorker({
      worker_id: worker.id,
      session_token: sessionToken,
      nonce: 'heartbeat-downgrade-nonce',
      nonce_timestamp: later,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: later,
    });

    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'run_execution',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision({ target_kind: 'run_execution' }).revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now: later,
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision().revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now: later,
      }),
    ).resolves.toMatchObject({ id: worker.id, capabilities: ['generation'] });
  });

  it('requires repo-specific worker scope for run-execution availability', async () => {
    const repository = createRepository();
    await seedProfileAndCredential(repository, 'generation');
    await seedProfileAndCredential(repository, 'run_execution');
    const { worker, sessionToken } = await seedWorker(repository, {
      capabilities: ['generation', 'run_execution'],
      allowedScopes: [{ project_id: 'project-1' }],
    });
    await repository.heartbeatCodexWorker({
      worker_id: worker.id,
      session_token: sessionToken,
      nonce: 'heartbeat-run-execution-scope-nonce',
      nonce_timestamp: now,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation', 'run_execution'],
      now,
    });

    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision().revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now,
      }),
    ).resolves.toMatchObject({ id: worker.id });
    await expect(
      repository.findAvailableCodexWorker({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'run_execution',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        network_policy_digest: codexCanonicalDigest(profileRevision({ target_kind: 'run_execution' }).revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        now,
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps runtime profile revisions immutable on duplicate create', async () => {
    const repository = createRepository();
    const { profile, revision } = profileRevision();

    await expect(repository.createCodexRuntimeProfileWithRevision({ profile, revision })).resolves.toEqual(revision);
    await expect(repository.createCodexRuntimeProfileWithRevision({ profile, revision })).resolves.toEqual(revision);

    const changed = profileRevision({
      id: revision.id,
      profile_id: profile.id,
      codex_config_toml: 'model = "gpt-5-mini"\napproval_policy = "never"\n',
    });
    await expect(repository.createCodexRuntimeProfileWithRevision(changed)).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });
    await expect(
      repository.getActiveCodexRuntimeProfileRevision({
        project_id: 'project-1',
        repo_id: 'repo-1',
        target_kind: 'generation',
        runtime_profile_id: profile.id,
        now,
      }),
    ).resolves.toEqual(revision);
  });

  it('rejects runtime profile creates with inconsistent active revision or duplicate revision number', async () => {
    const repository = createRepository();
    const { profile, revision } = profileRevision();

    await expect(
      repository.createCodexRuntimeProfileWithRevision({
        profile: { ...profile, active_revision_id: 'runtime-profile-revision-missing' },
        revision,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });

    await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
    const duplicate = profileRevision({
      id: 'runtime-profile-revision-duplicate',
      profile_id: profile.id,
      revision_number: revision.revision_number,
    });
    await expect(repository.createCodexRuntimeProfileWithRevision(duplicate)).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });
  });

  it('keeps credential versions immutable on duplicate create', async () => {
    const repository = createRepository();
    const { profile, revision } = profileRevision();
    const { binding, version, secretPayload } = credential({ profile_id: profile.id });

    await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
    await expect(
      repository.createCodexCredentialBindingWithVersion({ binding, version, secret_payload_json: secretPayload }),
    ).resolves.toEqual(version);
    await expect(
      repository.createCodexCredentialBindingWithVersion({ binding, version, secret_payload_json: secretPayload }),
    ).resolves.toEqual(version);

    const changedPayload = { env: { OPENAI_API_KEY: 'sk-replaced-key' } };
    const changedVersion = {
      ...version,
      payload_digest: codexCredentialPayloadDigest(changedPayload),
    };
    await expect(
      repository.createCodexCredentialBindingWithVersion({
        binding,
        version: changedVersion,
        secret_payload_json: changedPayload,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });
    await expect(
      repository.resolveCodexCredentialForLaunch({
        credential_binding_id: binding.id,
        target_kind: 'generation',
        runtime_profile_id: binding.profile_id,
        project_id: 'project-1',
        repo_id: 'repo-1',
        required_payload_digest: version.payload_digest,
        now,
      }),
    ).resolves.toMatchObject({ payload: secretPayload, payload_digest: version.payload_digest });
  });

  it('rejects credential binding creates with inconsistent active version or duplicate version number', async () => {
    const repository = createRepository();
    const { profile, revision } = profileRevision();
    const { binding, version, secretPayload } = credential({ profile_id: profile.id });

    await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
    await expect(
      repository.createCodexCredentialBindingWithVersion({
        binding: { ...binding, active_version_id: 'credential-version-missing' },
        version,
        secret_payload_json: secretPayload,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });
    await expect(
      repository.createCodexCredentialBindingWithVersion({
        binding,
        version: { ...version, binding_id: 'credential-binding-missing' },
        secret_payload_json: secretPayload,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });

    await repository.createCodexCredentialBindingWithVersion({ binding, version, secret_payload_json: secretPayload });
    const duplicateVersion = {
      ...version,
      id: 'credential-version-duplicate',
    };
    await expect(
      repository.createCodexCredentialBindingWithVersion({
        binding: { ...binding, active_version_id: duplicateVersion.id },
        version: duplicateVersion,
        secret_payload_json: secretPayload,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });
  });

  it('keeps consumed bootstrap tokens immutable on duplicate create', async () => {
    const repository = createRepository();
    const { worker } = await seedWorker(repository);

    await expect(
      repository.createCodexWorkerBootstrapToken({
        id: 'bootstrap-token-1',
        worker_identity: worker.worker_identity,
        bootstrap_token_hash: tokenHash('bootstrap-token-raw'),
        bootstrap_token_version: 1,
        status: 'online',
        allowed_scopes_json: [{ project_id: 'project-1', repo_id: 'repo-1' }],
        allowed_capabilities_json: {
          target_kinds: ['generation'],
          docker_image_digests: [`sha256:${'a'.repeat(64)}`],
          network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
          network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
        },
        created_by_actor_id: 'actor-admin',
        created_at: now,
        expires_at: expiresAt,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_registration_denied',
    });
  });

  it('replays identical active bootstrap token creates', async () => {
    const repository = createRepository();
    const input = {
      id: 'bootstrap-token-duplicate-active',
      worker_identity: 'local-worker-duplicate-active',
      bootstrap_token_hash: tokenHash('bootstrap-token-duplicate-active-raw'),
      bootstrap_token_version: 1,
      status: 'active' as const,
      allowed_scopes_json: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      allowed_capabilities_json: {
        target_kinds: ['generation'],
        docker_image_digests: [`sha256:${'a'.repeat(64)}`],
        network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
        network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
      },
      created_by_actor_id: 'actor-admin',
      created_at: now,
      expires_at: expiresAt,
    };

    await expect(repository.createCodexWorkerBootstrapToken(input)).resolves.toMatchObject({
      id: input.id,
      token_hash: input.bootstrap_token_hash,
    });
    await expect(repository.createCodexWorkerBootstrapToken({ ...input, created_at: later, expires_at: later })).resolves.toMatchObject({
      id: input.id,
      token_hash: input.bootstrap_token_hash,
      created_at: input.created_at,
      expires_at: input.expires_at,
    });
  });

  it('rejects duplicate active bootstrap token hash and version across ids', async () => {
    const repository = createRepository();
    const input = {
      id: 'bootstrap-token-generation',
      worker_identity: 'local-worker-generation',
      bootstrap_token_hash: tokenHash('bootstrap-token-shared-raw'),
      bootstrap_token_version: 1,
      status: 'active' as const,
      allowed_scopes_json: [{ project_id: 'project-1' }],
      allowed_capabilities_json: {
        target_kinds: ['generation'],
        docker_image_digests: [`sha256:${'a'.repeat(64)}`],
        network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
        network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
      },
      created_by_actor_id: 'actor-admin',
      created_at: now,
      expires_at: expiresAt,
    };

    await expect(repository.createCodexWorkerBootstrapToken(input)).resolves.toMatchObject({
      id: input.id,
      token_hash: input.bootstrap_token_hash,
    });
    await expect(
      repository.createCodexWorkerBootstrapToken({
        ...input,
        id: 'bootstrap-token-run-execution',
        worker_identity: 'local-worker-run-execution',
        allowed_scopes_json: [{ project_id: 'project-1', repo_id: 'repo-1' }],
        allowed_capabilities_json: {
          ...input.allowed_capabilities_json,
          target_kinds: ['run_execution'],
        },
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_registration_denied',
    });
  });

  it('rejects bootstrap token replay from replacing an existing worker session', async () => {
    const repository = createRepository();
    const { sessionToken, worker } = await seedWorker(repository);

    await expect(
      repository.upsertCodexWorkerRegistration({
        worker_id: 'worker-2',
        worker_identity: worker.worker_identity,
        version: '0.1.0',
        bootstrap_token_hash: tokenHash('bootstrap-token-raw'),
        bootstrap_token_version: 1,
        session_token: 'replacement-session-token',
        session_expires_at: expiresAt,
        status: 'online',
        control_channel_status: 'connected',
        allowed_scopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
        capabilities: ['generation'],
        docker_image_digests: [`sha256:${'a'.repeat(64)}`],
        network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
        network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
        host_worker_uid: 501,
        host_worker_gid: 20,
        lease_count: 0,
        max_concurrency: 2,
        labels: { host: 'test-host' },
        session_public_key_id: 'session-key-2',
        session_public_key_algorithm: 'x25519',
        session_public_key_material: 'replacement-public-key-material',
        session_public_key_expires_at: expiresAt,
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_registration_denied',
    });

    await expect(
      repository.heartbeatCodexWorker({
        worker_id: worker.id,
        session_token: sessionToken,
        nonce: 'original-session-still-valid-nonce',
        nonce_timestamp: later,
        status: 'online',
        control_channel_status: 'connected',
        active_lease_count: 0,
        capabilities: ['generation'],
        now: later,
      }),
    ).resolves.toMatchObject({ id: worker.id });
  });

  it('rejects nonce replay for worker session operations', async () => {
    const repository = createRepository();
    const { worker, sessionToken } = await seedWorker(repository);
    const heartbeat = {
      worker_id: worker.id,
      session_token: sessionToken,
      nonce: 'replayed-nonce',
      nonce_timestamp: later,
      status: 'online' as const,
      control_channel_status: 'connected' as const,
      active_lease_count: 0,
      capabilities: ['generation' as const],
      now: later,
    };

    await repository.heartbeatCodexWorker(heartbeat);

    await expect(repository.heartbeatCodexWorker(heartbeat)).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_nonce_replay',
    });
  });

  it('exposes the remote runtime job create/replay repository contract', () => {
    const repository = createRepository() as unknown as Record<string, unknown>;

    expect(assertCodexRuntimeJobRepositoryContract<DeliveryRepository>()).toBeUndefined();
    for (const method of [
      'createOrReplayCodexRuntimeJobWithLeaseAndEnvelope',
      'pollCodexRuntimeJobs',
      'acceptCodexRuntimeJob',
      'claimCodexLaunchTokenEnvelope',
      'materializeCodexRuntimeJob',
      'startCodexRuntimeJob',
      'appendCodexRuntimeJobEvent',
      'createCodexRuntimeJobArtifact',
      'listCodexRuntimeJobArtifacts',
      'cancelCodexRuntimeJob',
      'terminalizeCodexRuntimeJob',
      'recoverStaleCodexRuntimeJobs',
      'getCodexLaunchLeaseStatus',
    ]) {
      expect(typeof repository[method]).toBe('function');
    }
  });

  it('rejects workflow-owned run-execution create when first-class lineage diverges from trusted workload lineage', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const input = await workflowRunExecutionRuntimeJobInput(repository, {
      codex_session_turn_id: 'turn-first-class',
      input_json: workflowRunExecutionWorkload({
        codex_session_turn_id: 'turn-different',
      }),
    });

    await expect(repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('rejects active workflow-owned run-execution jobs for a Codex session that already has one active job', async () => {
    const { repository } = await createWorkflowRuntimeJobWithCapturedToken();
    await repository.releaseRunWorkerLease(
      'workflow-run-session-1',
      'run-worker-workflow-runtime-job-1',
      'run-worker-token-workflow-runtime-job-1',
      now,
    );
    const duplicateInput = await workflowRunExecutionRuntimeJobInput(repository, {
      runtime_job_id: 'workflow-runtime-job-duplicate',
      launch_lease_id: 'workflow-launch-lease-duplicate',
      envelope_id: 'workflow-envelope-duplicate',
      job_request_id: 'workflow-job-request-duplicate',
      launch_attempt: 2,
      worker_id: 'worker-duplicate',
      target: generationTarget({
        target_type: 'run_session',
        target_kind: 'run_execution',
        target_id: 'workflow-run-session-1',
      }),
      execution_package_id: 'workflow-execution-package-1',
      input_json: workflowRunExecutionWorkload({
        runtime_job_id: 'workflow-runtime-job-duplicate',
        run_session_id: 'workflow-run-session-1',
        execution_package_id: 'workflow-execution-package-1',
      }),
    });

    await expect(repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(duplicateInput)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('hides corrupt workflow-owned run-execution jobs from worker poll', async () => {
    const { repository, input } = await createWorkflowRuntimeJobWithCapturedToken();
    corruptStoredWorkflowRuntimeJobLineage(repository, input.runtime_job_id);

    await expect(
      repository.pollCodexRuntimeJobs({
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'poll-corrupt-workflow-runtime-job',
        nonce_timestamp: later,
        target_kinds: ['run_execution'],
        limit: 10,
        now: later,
      }),
    ).resolves.toEqual([]);
  });

  it('fails closed on corrupt workflow-owned run-execution jobs during worker accept and workload read', async () => {
    const { repository, input } = await createWorkflowRuntimeJobWithCapturedToken();
    corruptStoredWorkflowRuntimeJobLineage(repository, input.runtime_job_id);

    await expect(acceptRuntimeJob(repository, input.runtime_job_id)).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
    await expect(
      repository.getCodexRuntimeJobWorkload({
        runtime_job_id: input.runtime_job_id,
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'workload-corrupt-workflow-runtime-job',
        nonce_timestamp: later,
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('fails closed on corrupt workflow-owned run-execution jobs during workspace bundle download', async () => {
    const { repository, input } = await createWorkflowRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository, input.runtime_job_id);
    corruptStoredWorkflowRuntimeJobLineage(repository, input.runtime_job_id);

    await expect(
      repository.getWorkspaceBundleDownloadForRuntimeJob({
        runtime_job_id: input.runtime_job_id,
        bundle_id: input.pending_workspace_bundle!.bundle_id,
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'download-corrupt-workflow-runtime-job',
        nonce_timestamp: later,
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('fails closed on corrupt workflow-owned run-execution jobs during envelope claim, materialization, and start', async () => {
    const { repository, input, launchToken } = await createWorkflowRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository, input.runtime_job_id);
    corruptStoredWorkflowRuntimeJobLineage(repository, input.runtime_job_id);

    await expect(
      claimRuntimeJobEnvelope(repository, input.runtime_job_id, input.envelope_id, {
        nonce: 'claim-corrupt-workflow-runtime-job',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });

    const materializing = await createWorkflowRuntimeJobWithCapturedToken({
      runtime_job_id: 'workflow-runtime-job-materialize-corrupt',
      launch_lease_id: 'workflow-launch-lease-materialize-corrupt',
      envelope_id: 'workflow-envelope-materialize-corrupt',
      job_request_id: 'workflow-job-request-materialize-corrupt',
      target: generationTarget({
        target_type: 'run_session',
        target_kind: 'run_execution',
        target_id: 'workflow-run-session-materialize-corrupt',
      }),
      execution_package_id: 'workflow-execution-package-materialize-corrupt',
      codex_session_id: 'session-materialize-corrupt',
      codex_session_turn_id: 'turn-materialize-corrupt',
      input_json: workflowRunExecutionWorkload({
        runtime_job_id: 'workflow-runtime-job-materialize-corrupt',
        codex_session_id: 'session-materialize-corrupt',
        codex_session_turn_id: 'turn-materialize-corrupt',
        run_session_id: 'workflow-run-session-materialize-corrupt',
        execution_package_id: 'workflow-execution-package-materialize-corrupt',
      }),
    });
    await acceptRuntimeJob(materializing.repository, materializing.input.runtime_job_id);
    await claimRuntimeJobEnvelope(
      materializing.repository,
      materializing.input.runtime_job_id,
      materializing.input.envelope_id,
      { nonce: 'claim-before-materialize-corrupt-workflow-runtime-job' },
    );
    corruptStoredWorkflowRuntimeJobLineage(materializing.repository, materializing.input.runtime_job_id);
    await expect(
      materializeRuntimeJob(
        materializing.repository,
        materializing.launchToken,
        materializing.input.runtime_job_id,
        materializing.input.launch_lease_id,
        {
          nonce: 'materialize-corrupt-workflow-runtime-job',
          active_fence: {
            run_worker_lease_id: materializing.input.run_worker_lease_id,
            run_worker_lease_token_hash: materializing.input.run_worker_lease_token_hash,
            run_session_status: materializing.input.run_session_status,
            run_session_updated_at: materializing.input.run_session_updated_at,
            execution_package_version: materializing.input.execution_package_version,
          },
        },
      ),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });

    const running = await createWorkflowRuntimeJobWithCapturedToken({
      runtime_job_id: 'workflow-runtime-job-start-corrupt',
      launch_lease_id: 'workflow-launch-lease-start-corrupt',
      envelope_id: 'workflow-envelope-start-corrupt',
      job_request_id: 'workflow-job-request-start-corrupt',
      target: generationTarget({
        target_type: 'run_session',
        target_kind: 'run_execution',
        target_id: 'workflow-run-session-start-corrupt',
      }),
      execution_package_id: 'workflow-execution-package-start-corrupt',
      codex_session_id: 'session-start-corrupt',
      codex_session_turn_id: 'turn-start-corrupt',
      input_json: workflowRunExecutionWorkload({
        runtime_job_id: 'workflow-runtime-job-start-corrupt',
        codex_session_id: 'session-start-corrupt',
        codex_session_turn_id: 'turn-start-corrupt',
        run_session_id: 'workflow-run-session-start-corrupt',
        execution_package_id: 'workflow-execution-package-start-corrupt',
      }),
    });
    await acceptRuntimeJob(running.repository, running.input.runtime_job_id);
    await claimRuntimeJobEnvelope(running.repository, running.input.runtime_job_id, running.input.envelope_id, {
      nonce: 'claim-before-start-corrupt-workflow-runtime-job',
    });
    await materializeRuntimeJob(running.repository, running.launchToken, running.input.runtime_job_id, running.input.launch_lease_id, {
      nonce: 'materialize-before-start-corrupt-workflow-runtime-job',
      active_fence: {
        run_worker_lease_id: running.input.run_worker_lease_id,
        run_worker_lease_token_hash: running.input.run_worker_lease_token_hash,
        run_session_status: running.input.run_session_status,
        run_session_updated_at: running.input.run_session_updated_at,
        execution_package_version: running.input.execution_package_version,
      },
    });
    corruptStoredWorkflowRuntimeJobLineage(running.repository, running.input.runtime_job_id);
    await expect(
      startRuntimeJob(running.repository, running.input.runtime_job_id, {
        nonce: 'start-corrupt-workflow-runtime-job',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });

    expect(launchToken).toBeDefined();
  });

  it('polls only queued runtime jobs assigned to the worker and validates worker session nonces', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const workerOneInput = await runtimeJobInput(repository);
    await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(workerOneInput);
    const target = generationTarget({ target_id: 'generation-worker-2' });
    await claimGenerationAction(repository, {
      id: target.target_id,
      idempotency_key: 'runtime-generation-worker-2-idem',
      target_object_id: target.target_id,
      action_input_json: { generation_id: target.target_id },
      claim_token: 'runtime-action-claim-token-1',
      precondition_fingerprint: 'runtime-precondition-1',
    });
    const workerTwoInput = await runtimeJobInput(
      repository,
      {
        runtime_job_id: 'runtime-job-worker-2',
        launch_lease_id: 'runtime-launch-lease-worker-2',
        envelope_id: 'runtime-envelope-worker-2',
        job_request_id: 'runtime-job-request-worker-2',
        target,
      },
      { worker_id: 'worker-2', session_token: 'session-token-2' },
    );
    await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(workerTwoInput);

    await expect(
      repository.pollCodexRuntimeJobs({
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'poll-nonce-1',
        nonce_timestamp: later,
        target_kinds: ['generation'],
        limit: 10,
        now: later,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: workerOneInput.runtime_job_id, status: 'queued', worker_id: 'worker-1' })]);

    await expect(
      repository.pollCodexRuntimeJobs({
        worker_id: 'worker-1',
        worker_session_token: 'wrong-session-token',
        nonce: 'poll-bad-session-nonce',
        nonce_timestamp: later,
        limit: 10,
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });

    await expect(
      repository.pollCodexRuntimeJobs({
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'poll-nonce-1',
        nonce_timestamp: later,
        limit: 10,
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_nonce_replay',
    });
  });

  it('accepts runtime jobs idempotently and fails closed on conflicting accept replay', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken();

    const accepted = await acceptRuntimeJob(repository);

    expect(accepted).toMatchObject({
      id: 'runtime-job-1',
      status: 'accepted',
      accepted_worker_session_digest: tokenHash('session-token-1'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      accept_idempotency_key: 'accept-runtime-job-1',
      accept_request_digest: tokenHash('accept-request-runtime-job-1'),
    });
    await expect(
      acceptRuntimeJob(repository, 'runtime-job-1', { nonce: 'accept-replay-nonce-runtime-job-1' }),
    ).resolves.toEqual(accepted);
    await expect(
      acceptRuntimeJob(repository, 'runtime-job-1', {
        nonce: 'accept-conflict-nonce-runtime-job-1',
        idempotency_key: 'accept-conflict-runtime-job-1',
        request_digest: tokenHash('accept-conflict-request-runtime-job-1'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('claims launch token envelopes once and denies stale or mismatched worker proofs without detail', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);

    const claimed = await claimRuntimeJobEnvelope(repository);

    expect(claimed).toMatchObject({
      id: 'runtime-envelope-1',
      status: 'claimed',
      claim_request_id: 'claim-runtime-job-1',
      claim_request_digest: tokenHash('claim-request-runtime-job-1'),
      claimed_worker_session_digest: tokenHash('session-token-1'),
      claimed_key_id: 'session-key-1',
    });
    await expect(
      claimRuntimeJobEnvelope(repository, 'runtime-job-1', 'runtime-envelope-1', {
        nonce: 'claim-replay-nonce-runtime-job-1',
      }),
    ).resolves.toEqual(claimed);

    for (const patch of [
      { nonce: 'claim-wrong-worker-nonce', worker_id: 'worker-other' },
      { nonce: 'claim-stale-session-nonce', worker_session_token: 'wrong-session-token' },
      { nonce: 'claim-wrong-key-nonce', key_id: 'wrong-session-key' },
      { nonce: 'claim-wrong-digest-nonce', accepted_worker_session_digest: tokenHash('wrong-session-token') },
      { nonce: 'claim-wrong-epoch-nonce', accepted_session_epoch: 2 },
    ]) {
      await expect(claimRuntimeJobEnvelope(repository, 'runtime-job-1', 'runtime-envelope-1', patch)).rejects.toMatchObject<
        Partial<DomainError>
      >({
        name: 'DomainError',
        code: 'codex_launch_materialization_denied',
      });
    }

    await expect(
      claimRuntimeJobEnvelope(repository, 'runtime-job-1', 'runtime-envelope-1', {
        nonce: 'claim-replay-nonce-runtime-job-1',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_nonce_replay',
    });

    const cancelled = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-cancelled-before-claim',
        launch_lease_id: 'runtime-launch-lease-cancelled-before-claim',
        envelope_id: 'runtime-envelope-cancelled-before-claim',
        job_request_id: 'runtime-job-request-cancelled-before-claim',
        target: generationTarget({ target_id: 'generation-cancelled-before-claim' }),
      },
      { worker_id: 'worker-cancelled-before-claim', session_token: 'session-token-cancelled-before-claim' },
    );
    await cancelled.repository.cancelCodexRuntimeJob({
      runtime_job_id: 'runtime-job-cancelled-before-claim',
      reason_code: 'user_cancelled',
      idempotency_key: 'cancel-before-claim',
      request_digest: tokenHash('cancel-before-claim-request'),
      now: later,
    });
    await expect(
      cancelled.repository.claimCodexLaunchTokenEnvelope({
        runtime_job_id: 'runtime-job-cancelled-before-claim',
        envelope_id: 'runtime-envelope-cancelled-before-claim',
        worker_id: 'worker-cancelled-before-claim',
        worker_session_token: 'session-token-cancelled-before-claim',
        nonce: 'claim-cancelled-job-nonce',
        nonce_timestamp: later,
        accepted_worker_session_digest: tokenHash('session-token-cancelled-before-claim'),
        key_id: 'session-key-1',
        accepted_session_epoch: 1,
        claim_request_id: 'claim-cancelled-job',
        request_digest: tokenHash('claim-cancelled-job-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });

    const expiredKey = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-expired-key',
        launch_lease_id: 'runtime-launch-lease-expired-key',
        envelope_id: 'runtime-envelope-expired-key',
        job_request_id: 'runtime-job-request-expired-key',
        target: generationTarget({ target_id: 'generation-expired-key' }),
        expires_at: '2026-05-20T00:30:00.000Z',
      },
      {
        worker_id: 'worker-expired-key',
        session_token: 'session-token-expired-key',
        session_expires_at: '2026-05-20T00:30:00.000Z',
        session_public_key_expires_at: '2026-05-20T00:00:30.000Z',
      },
    );
    await expiredKey.repository.acceptCodexRuntimeJob({
      runtime_job_id: 'runtime-job-expired-key',
      worker_id: 'worker-expired-key',
      worker_session_token: 'session-token-expired-key',
      nonce: 'accept-expired-key-nonce',
      nonce_timestamp: now,
      accepted_worker_session_digest: tokenHash('session-token-expired-key'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      idempotency_key: 'accept-expired-key',
      request_digest: tokenHash('accept-expired-key-request'),
      now,
    });
    await expect(
      expiredKey.repository.claimCodexLaunchTokenEnvelope({
        runtime_job_id: 'runtime-job-expired-key',
        envelope_id: 'runtime-envelope-expired-key',
        worker_id: 'worker-expired-key',
        worker_session_token: 'session-token-expired-key',
        nonce: 'claim-expired-key-nonce',
        nonce_timestamp: later,
        accepted_worker_session_digest: tokenHash('session-token-expired-key'),
        key_id: 'session-key-1',
        accepted_session_epoch: 1,
        claim_request_id: 'claim-expired-key',
        request_digest: tokenHash('claim-expired-key-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });

    const expiredKeyAfterRefresh = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-expired-key-after-refresh',
        launch_lease_id: 'runtime-launch-lease-expired-key-after-refresh',
        envelope_id: 'runtime-envelope-expired-key-after-refresh',
        job_request_id: 'runtime-job-request-expired-key-after-refresh',
        target: generationTarget({ target_id: 'generation-expired-key-after-refresh' }),
        expires_at: '2026-05-20T00:30:00.000Z',
      },
      {
        worker_id: 'worker-expired-key-after-refresh',
        session_token: 'session-token-expired-key-after-refresh',
        session_expires_at: '2026-05-20T00:30:00.000Z',
        session_public_key_expires_at: '2026-05-20T00:00:30.000Z',
      },
    );
    await expiredKeyAfterRefresh.repository.acceptCodexRuntimeJob({
      runtime_job_id: 'runtime-job-expired-key-after-refresh',
      worker_id: 'worker-expired-key-after-refresh',
      worker_session_token: 'session-token-expired-key-after-refresh',
      nonce: 'accept-expired-key-after-refresh-nonce',
      nonce_timestamp: now,
      accepted_worker_session_digest: tokenHash('session-token-expired-key-after-refresh'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      idempotency_key: 'accept-expired-key-after-refresh',
      request_digest: tokenHash('accept-expired-key-after-refresh-request'),
      now,
    });
    await expect(
      expiredKeyAfterRefresh.repository.refreshCodexWorkerSession({
        worker_id: 'worker-expired-key-after-refresh',
        current_session_token: 'session-token-expired-key-after-refresh',
        nonce: 'refresh-expired-key-after-accept',
        nonce_timestamp: now,
        next_session_token: 'session-token-expired-key-after-refresh-2',
        next_session_expires_at: '2026-05-20T00:30:00.000Z',
        next_session_public_key_id: 'session-key-2',
        next_session_public_key_material: 'public-key-material-2',
        next_session_public_key_expires_at: '2026-05-20T00:30:00.000Z',
        request_digest: tokenHash('refresh-expired-key-after-accept-request'),
        replay_protection: {
          method: 'POST',
          path: '/internal/codex-workers/worker-expired-key-after-refresh/session/refresh',
          body_digest: tokenHash('refresh-expired-key-after-accept-request'),
        },
        now,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_registration_denied',
    });
  });

  it('materializes runtime jobs by launch-token hash only and replays materialization response loss until terminal', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    const claimed = await claimRuntimeJobEnvelope(repository);

    const materializeInput: Parameters<DeliveryRepository['materializeCodexRuntimeJob']>[0] = {
      runtime_job_id: 'runtime-job-1',
      launch_lease_id: 'runtime-launch-lease-1',
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'materialize-nonce-runtime-job-1',
      nonce_timestamp: later,
      launch_token_hash: tokenHash(launchToken),
      accepted_worker_session_digest: tokenHash('session-token-1'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      materialization_request_id: 'materialize-runtime-job-1',
      request_digest: tokenHash('materialize-request-runtime-job-1'),
      active_fence: {
        action_claim_token_hash: tokenHash('runtime-action-claim-token-1'),
        precondition_fingerprint: 'runtime-precondition-1',
      },
      now: later,
    };
    expect(materializeInput).not.toHaveProperty('launch_token');

    const materialized = await repository.materializeCodexRuntimeJob(materializeInput);

    expect(materialized).toMatchObject({
      lease_id: 'runtime-launch-lease-1',
      materialized_at: later,
      resolved_credentials: [{ payload: credential().secretPayload }],
    });
    await expect(
      repository.pollCodexRuntimeJobs({
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'poll-after-materialize-nonce',
        nonce_timestamp: later,
        limit: 10,
        now: later,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.getCodexLaunchLeaseStatus({
        launch_lease_id: 'runtime-launch-lease-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'lease-status-materialized-nonce',
        nonce_timestamp: later,
        now: later,
      }),
    ).resolves.toMatchObject<CodexLaunchLease>({ id: 'runtime-launch-lease-1', status: 'materialized' });
    await expect(
      repository.materializeCodexRuntimeJob({ ...materializeInput, nonce: 'materialize-replay-nonce-runtime-job-1' }),
    ).resolves.toEqual(materialized);
    await expect(
      claimRuntimeJobEnvelope(repository, 'runtime-job-1', 'runtime-envelope-1', {
        nonce: 'claim-replay-after-materialize-nonce-runtime-job-1',
      }),
    ).resolves.toEqual(claimed);

    await expect(
      repository.materializeCodexRuntimeJob({
        ...materializeInput,
        nonce: 'materialize-wrong-accepted-key-nonce-runtime-job-1',
        accepted_session_public_key_id: 'session-key-rotated',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
    await expect(
      repository.materializeCodexRuntimeJob({
        ...materializeInput,
        nonce: 'materialize-wrong-accepted-epoch-nonce-runtime-job-1',
        accepted_session_epoch: 2,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });

    await startRuntimeJob(repository);
    await expect(
      claimRuntimeJobEnvelope(repository, 'runtime-job-1', 'runtime-envelope-1', {
        nonce: 'claim-replay-after-start-nonce-runtime-job-1',
      }),
    ).resolves.toEqual(claimed);
    await expect(
      repository.materializeCodexRuntimeJob({ ...materializeInput, nonce: 'materialize-replay-after-start-nonce-runtime-job-1' }),
    ).resolves.toEqual(materialized);

    await terminalizeRuntimeJob(repository);
    await expect(
      repository.materializeCodexRuntimeJob({ ...materializeInput, nonce: 'materialize-after-terminal-nonce-runtime-job-1' }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
  });

  it('starts only materializing runtime jobs and rejects cancelled jobs', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);

    await expect(startRuntimeJob(repository)).resolves.toMatchObject({
      id: 'runtime-job-1',
      status: 'running',
      start_idempotency_key: 'start-runtime-job-1',
      start_request_digest: tokenHash('start-request-runtime-job-1'),
      runtime_evidence_digest: tokenHash('runtime-evidence-runtime-job-1'),
      launch_materialization_digest: tokenHash('launch-materialization-runtime-job-1'),
    });
    await expect(
      startRuntimeJob(repository, 'runtime-job-1', {
        nonce: 'start-replay-nonce-runtime-job-1',
      }),
    ).resolves.toEqual(expect.objectContaining({ runtime_evidence_digest: tokenHash('runtime-evidence-runtime-job-1') }));
    await expect(
      startRuntimeJob(repository, 'runtime-job-1', {
        nonce: 'start-conflicting-evidence-nonce-runtime-job-1',
        launch_materialization_digest: tokenHash('conflicting-launch-materialization-runtime-job-1'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });

    const cancelled = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-cancelled-start',
        launch_lease_id: 'runtime-launch-lease-cancelled-start',
        envelope_id: 'runtime-envelope-cancelled-start',
        job_request_id: 'runtime-job-request-cancelled-start',
        target: generationTarget({ target_id: 'generation-cancelled-start' }),
      },
      { worker_id: 'worker-cancelled-start', session_token: 'session-token-cancelled-start' },
    );
    await cancelled.repository.acceptCodexRuntimeJob({
      runtime_job_id: 'runtime-job-cancelled-start',
      worker_id: 'worker-cancelled-start',
      worker_session_token: 'session-token-cancelled-start',
      nonce: 'accept-cancelled-start-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-cancelled-start'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      idempotency_key: 'accept-cancelled-start',
      request_digest: tokenHash('accept-cancelled-start-request'),
      now: later,
    });
    await cancelled.repository.cancelCodexRuntimeJob({
      runtime_job_id: 'runtime-job-cancelled-start',
      reason_code: 'user_cancelled',
      idempotency_key: 'cancel-cancelled-start',
      request_digest: tokenHash('cancel-cancelled-start-request'),
      now: later,
    });
    await expect(
      cancelled.repository.startCodexRuntimeJob({
        runtime_job_id: 'runtime-job-cancelled-start',
        worker_id: 'worker-cancelled-start',
        worker_session_token: 'session-token-cancelled-start',
        nonce: 'start-cancelled-start-nonce',
        nonce_timestamp: later,
        idempotency_key: 'start-cancelled-start',
        request_digest: tokenHash('start-cancelled-start-request'),
        runtime_evidence_digest: tokenHash('runtime-evidence-cancelled-start'),
        launch_materialization_digest: tokenHash('launch-materialization-cancelled-start'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('rejects start when the coupled launch lease is no longer materialized for the worker', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    const leaseRecord = runtimeLaunchLeases(repository).get('runtime-launch-lease-1');
    expect(leaseRecord).toBeDefined();
    runtimeLaunchLeases(repository).set('runtime-launch-lease-1', {
      ...leaseRecord!,
      lease: {
        ...leaseRecord!.lease,
        status: 'revoked',
        revoked_at: later,
        terminal_reason_code: 'revoked-for-test',
      },
    });

    await expect(
      startRuntimeJob(repository, 'runtime-job-1', {
        nonce: 'start-revoked-lease-nonce',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('deduplicates runtime job events and updates last_event_at', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    await startRuntimeJob(repository);

    const event = await repository.appendCodexRuntimeJobEvent({
      runtime_job_id: 'runtime-job-1',
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'event-nonce-1',
      nonce_timestamp: later,
      event_id: 'event-1',
      idempotency_key: 'event-idem-1',
      event_type: 'progress',
      event_payload_json: { step: 'started' },
      request_digest: tokenHash('event-request-1'),
      now: '2026-05-20T00:02:00.000Z',
    });

    expect(event).toMatchObject({ id: 'runtime-job-1', last_event_at: '2026-05-20T00:02:00.000Z' });
    await expect(
      repository.appendCodexRuntimeJobEvent({
        runtime_job_id: 'runtime-job-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'event-replay-nonce-1',
        nonce_timestamp: later,
        event_id: 'event-1',
        idempotency_key: 'event-idem-1',
        event_type: 'progress',
        event_payload_json: { step: 'started' },
        request_digest: tokenHash('event-request-1'),
        now: '2026-05-20T00:03:00.000Z',
      }),
    ).resolves.toEqual(event);
  });

  it('terminalizes runtime jobs and launch leases exactly once', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    await startRuntimeJob(repository);

    const terminal = await terminalizeRuntimeJob(repository);

    expect(terminal).toMatchObject({
      id: 'runtime-job-1',
      status: 'terminal',
      terminal_status: 'succeeded',
      terminal_reason_code: 'completed',
      terminal_idempotency_key: 'terminal-runtime-job-1',
      terminal_request_digest: tokenHash('terminal-request-runtime-job-1'),
    });
    await expect(
      repository.getCodexLaunchLeaseStatus({
        launch_lease_id: 'runtime-launch-lease-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'lease-status-terminal-nonce',
        nonce_timestamp: later,
        now: later,
      }),
    ).resolves.toMatchObject<CodexLaunchLease>({
      id: 'runtime-launch-lease-1',
      status: 'terminal',
      terminal_runtime_job_id: 'runtime-job-1',
    });
    await expect(
      terminalizeRuntimeJob(repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'terminal-replay-nonce-runtime-job-1',
      }),
    ).resolves.toEqual(terminal);
    await expect(
      terminalizeRuntimeJob(repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'terminal-conflict-nonce-runtime-job-1',
        idempotency_key: 'terminal-conflict-runtime-job-1',
        request_digest: tokenHash('terminal-conflict-request-runtime-job-1'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('issues job-bound artifact refs and requires terminal internal refs to match stored artifacts', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    await startRuntimeJob(repository);

    const artifact = await createRuntimeJobArtifact(repository);

    expect(artifact).toMatchObject({
      runtime_job_id: 'runtime-job-1',
      project_id: 'project-1',
      repo_id: 'repo-1',
      target_kind: 'generation',
      content_type: 'application/json',
      digest: tokenHash('artifact-digest-runtime-job-1'),
      size_bytes: 128,
      internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/11111111-1111-4111-8111-111111111111',
      internal_artifact_object_id: '33333333-3333-4333-8333-111111111111',
    });
    await expect(repository.listCodexRuntimeJobArtifacts({ runtime_job_id: 'runtime-job-1' })).resolves.toEqual([artifact]);
    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        nonce: 'artifact-replay-runtime-job-1',
      }),
    ).resolves.toEqual(artifact);
    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        nonce: 'artifact-replay-conflict-runtime-job-1',
        digest: tokenHash('artifact-digest-runtime-job-1-changed'),
        request_digest: tokenHash('artifact-replay-conflict-request-runtime-job-1'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
    const conflictingArtifactId = '11111111-1111-4111-8111-333333333333';
    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        nonce: 'artifact-same-digest-different-key-runtime-job-1',
        artifact_id: conflictingArtifactId,
        artifact_idempotency_key: 'artifact-runtime-job-1-conflict',
        internal_ref: `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/${conflictingArtifactId}`,
        request_digest: tokenHash('artifact-same-digest-different-key-request-runtime-job-1'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });

    await expect(
      terminalizeRuntimeJob(repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        terminal_result_json: {
          ...validGenerationTerminalResult(),
          generation_artifacts: [
            {
              kind: 'generated_payload',
              name: 'generated-payload.json',
              content_type: artifact.content_type,
              digest: artifact.digest,
              internal_ref: artifact.internal_ref,
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ status: 'terminal', terminal_status: 'succeeded' });
  });

  it('requires oversized generated payload artifact refs to match stored artifacts', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    await startRuntimeJob(repository);

    const generatedPayloadDigest = tokenHash('oversized-product-generated-payload');
    await expect(
      terminalizeRuntimeJob(repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        terminal_result_json: {
          task_kind: 'development_plan_item_spec_revision',
          prompt_version: 'spec-revision.remote.v1',
          output_schema_version: 'spec_revision.v1',
          generated_payload: {
            schema_version: 'generated_payload_ref.v1',
            artifact: {
              kind: 'generated_payload',
              name: 'generated-payload.json',
              content_type: 'application/json',
              digest: generatedPayloadDigest,
              internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/generated_payload',
            },
          },
          generated_payload_digest: generatedPayloadDigest,
          generation_artifacts: [],
          public_summary: 'Generated an oversized Spec revision.',
        },
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
  });

  it('accepts startup failure evidence after materialization before runtime job start', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);

    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        kind: 'startup_failure_evidence',
        name: 'startup-failure-evidence.json',
        nonce: 'artifact-startup-failure-after-materialize',
        artifact_idempotency_key: 'artifact-startup-failure-after-materialize',
        request_digest: tokenHash('artifact-startup-failure-after-materialize-request'),
        metadata_json: {
          reason_code: 'codex_worker_startup_failed',
          public_summary: 'Startup failed after materialization.',
        },
      }),
    ).resolves.toMatchObject({
      runtime_job_id: 'runtime-job-1',
      kind: 'startup_failure_evidence',
      name: 'startup-failure-evidence.json',
    });
  });

  it('rejects worker-invented, wrong-job, invalid-type, and oversized runtime job artifacts', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    await startRuntimeJob(repository);

    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        content_type: 'application/x-secret-dump',
        nonce: 'artifact-bad-content-type',
        request_digest: tokenHash('artifact-bad-content-type-request'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        digest: 'not-a-digest',
        nonce: 'artifact-bad-digest',
        request_digest: tokenHash('artifact-bad-digest-request'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        size_bytes: 10_000_001,
        nonce: 'artifact-too-large',
        request_digest: tokenHash('artifact-too-large-request'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
    await expect(
      createRuntimeJobArtifact(repository, 'runtime-job-1', {
        metadata_json: { workspace_path: '/tmp/private/codex-home' },
        nonce: 'artifact-unsafe-metadata',
        request_digest: tokenHash('artifact-unsafe-metadata-request'),
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
  });

  it('requires new runtime job artifacts to bind to matching internal artifact objects', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    await startRuntimeJob(repository);

    await expect(
      repository.createCodexRuntimeJobArtifact({
        runtime_job_id: 'runtime-job-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'artifact-missing-object',
        nonce_timestamp: later,
        artifact_id: '11111111-1111-4111-8111-444444444444',
        artifact_idempotency_key: 'artifact-missing-object',
        kind: 'generated_payload',
        name: 'generated-payload.json',
        content_type: 'application/json',
        digest: tokenHash('artifact-missing-object-digest'),
        internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/11111111-1111-4111-8111-444444444444',
        internal_artifact_object_id: '33333333-3333-4333-8333-444444444444',
        size_bytes: 128,
        metadata_json: {},
        request_digest: tokenHash('artifact-missing-object-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });

    await repository.createOrReplayInternalArtifactObject({
      id: '33333333-3333-4333-8333-666666666666',
      artifact_id: '11111111-1111-4111-8111-666666666666',
      ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/11111111-1111-4111-8111-666666666666',
      storage_key: `objects/${tokenHash('unreserved-digest').slice('sha256:'.length)}`,
      kind: 'codex_runtime_job_artifact',
      content_type: 'application/json',
      size_bytes: '128',
      digest: tokenHash('unreserved-digest'),
      visibility: 'internal',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      idempotency_key: 'artifact-unreserved-object',
      request_digest: tokenHash('artifact-unreserved-request'),
      metadata_json: {},
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: 'worker-1',
      created_at: later,
    });
    await expect(
      repository.bindReservedCodexRuntimeJobArtifact({
        runtime_job_id: 'runtime-job-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'artifact-unreserved-nonce',
        nonce_timestamp: later,
        artifact_id: '11111111-1111-4111-8111-666666666666',
        artifact_idempotency_key: 'artifact-unreserved-object',
        kind: 'generated_payload',
        name: 'generated-payload.json',
        content_type: 'application/json',
        digest: tokenHash('unreserved-digest'),
        internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/11111111-1111-4111-8111-666666666666',
        internal_artifact_object_id: '33333333-3333-4333-8333-666666666666',
        size_bytes: 128,
        metadata_json: {},
        request_digest: tokenHash('artifact-unreserved-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_worker_nonce_replay' });

    const reservedAfterCancelArtifactId = '11111111-1111-4111-8111-777777777777';
    const reservedAfterCancelObjectId = '33333333-3333-4333-8333-777777777777';
    const reservedAfterCancelRef = `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/${reservedAfterCancelArtifactId}`;
    const reservedAfterCancelDigest = tokenHash('reserved-after-cancel-digest');
    await repository.reserveCodexRuntimeJobArtifactUpload({
      runtime_job_id: 'runtime-job-1',
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'artifact-reserved-before-cancel',
      nonce_timestamp: later,
      artifact_id: reservedAfterCancelArtifactId,
      artifact_idempotency_key: 'artifact-reserved-before-cancel',
      kind: 'generated_payload',
      name: 'generated-payload.json',
      content_type: 'application/json',
      digest: reservedAfterCancelDigest,
      internal_ref: reservedAfterCancelRef,
      size_bytes: 128,
      metadata_json: {},
      request_digest: tokenHash('artifact-reserved-before-cancel-request'),
      now: later,
    });
    await terminalizeRuntimeJob(repository, 'runtime-job-1', 'runtime-launch-lease-1', {
      nonce: 'terminal-before-artifact-bind',
      idempotency_key: 'terminal-before-artifact-bind',
      request_digest: tokenHash('terminal-before-artifact-bind-request'),
    });
    await repository.createOrReplayInternalArtifactObject({
      id: reservedAfterCancelObjectId,
      artifact_id: reservedAfterCancelArtifactId,
      ref: reservedAfterCancelRef,
      storage_key: `objects/${reservedAfterCancelDigest.slice('sha256:'.length)}`,
      kind: 'codex_runtime_job_artifact',
      content_type: 'application/json',
      size_bytes: '128',
      digest: reservedAfterCancelDigest,
      visibility: 'internal',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      idempotency_key: 'artifact-reserved-before-cancel',
      request_digest: tokenHash('artifact-reserved-before-cancel-request'),
      metadata_json: {},
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: 'worker-1',
      created_at: later,
    });
    await expect(
      repository.bindReservedCodexRuntimeJobArtifact({
        runtime_job_id: 'runtime-job-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'artifact-reserved-before-cancel',
        nonce_timestamp: later,
        artifact_id: reservedAfterCancelArtifactId,
        artifact_idempotency_key: 'artifact-reserved-before-cancel',
        kind: 'generated_payload',
        name: 'generated-payload.json',
        content_type: 'application/json',
        digest: reservedAfterCancelDigest,
        internal_ref: reservedAfterCancelRef,
        internal_artifact_object_id: reservedAfterCancelObjectId,
        size_bytes: 128,
        metadata_json: {},
        request_digest: tokenHash('artifact-reserved-before-cancel-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });

    await repository.createOrReplayInternalArtifactObject({
      id: '33333333-3333-4333-8333-555555555555',
      artifact_id: '11111111-1111-4111-8111-555555555555',
      ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/11111111-1111-4111-8111-555555555555',
      storage_key: `objects/${tokenHash('wrong-digest').slice('sha256:'.length)}`,
      kind: 'codex_runtime_job_artifact',
      content_type: 'application/json',
      size_bytes: '128',
      digest: tokenHash('wrong-digest'),
      visibility: 'internal',
      owner_type: 'codex_runtime_job',
      owner_id: 'runtime-job-1',
      idempotency_key: 'artifact-mismatched-object',
      request_digest: tokenHash('artifact-mismatched-object-request'),
      metadata_json: {},
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: 'worker-1',
      created_at: later,
    });
    await expect(
      repository.createCodexRuntimeJobArtifact({
        runtime_job_id: 'runtime-job-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'artifact-mismatched-object',
        nonce_timestamp: later,
        artifact_id: '11111111-1111-4111-8111-555555555555',
        artifact_idempotency_key: 'artifact-mismatched-object',
        kind: 'generated_payload',
        name: 'generated-payload.json',
        content_type: 'application/json',
        digest: tokenHash('expected-digest'),
        internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/11111111-1111-4111-8111-555555555555',
        internal_artifact_object_id: '33333333-3333-4333-8333-555555555555',
        size_bytes: 128,
        metadata_json: {},
        request_digest: tokenHash('artifact-mismatched-object-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
  });

  it('rejects terminal internal refs invented by the worker or issued for another runtime job', async () => {
    const first = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(first.repository);
    await claimRuntimeJobEnvelope(first.repository);
    await materializeRuntimeJob(first.repository, first.launchToken);
    await startRuntimeJob(first.repository);

    await expect(
      terminalizeRuntimeJob(first.repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'terminal-invented-ref',
        request_digest: tokenHash('terminal-invented-ref-request'),
        terminal_result_json: {
          ...validGenerationTerminalResult(),
          generation_artifacts: [
            {
              kind: 'generated_payload',
              name: 'generated-payload.json',
              content_type: 'application/json',
              digest: tokenHash('invented-artifact'),
              internal_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/worker-invented',
            },
          ],
        },
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });

    const secondInput = await runtimeJobInput(first.repository, {
      runtime_job_id: 'runtime-job-2',
      launch_lease_id: 'runtime-launch-lease-2',
      envelope_id: 'runtime-envelope-2',
      job_request_id: 'runtime-job-request-2',
      target: generationTarget({ target_id: 'generation-2' }),
      input_digest: tokenHash('runtime-input-2'),
    }, { worker_id: 'worker-2', session_token: 'session-token-2' });
    await first.repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(secondInput);
    const secondLaunchToken = first.sealerCalls.find((call) => call.runtime_job_id === 'runtime-job-2')?.plaintext_launch_token;
    if (secondLaunchToken === undefined) {
      throw new Error('expected second runtime job launch token');
    }
    await acceptRuntimeJob(first.repository, 'runtime-job-2', {
      worker_id: 'worker-2',
      worker_session_token: 'session-token-2',
      nonce: 'accept-nonce-runtime-job-2',
      accepted_worker_session_digest: tokenHash('session-token-2'),
      request_digest: tokenHash('accept-request-runtime-job-2'),
    });
    await claimRuntimeJobEnvelope(first.repository, 'runtime-job-2', 'runtime-envelope-2', {
      worker_id: 'worker-2',
      worker_session_token: 'session-token-2',
      nonce: 'claim-nonce-runtime-job-2',
      accepted_worker_session_digest: tokenHash('session-token-2'),
      request_digest: tokenHash('claim-request-runtime-job-2'),
    });
    await materializeRuntimeJob(first.repository, secondLaunchToken, 'runtime-job-2', 'runtime-launch-lease-2', {
      worker_id: 'worker-2',
      worker_session_token: 'session-token-2',
      nonce: 'materialize-nonce-runtime-job-2',
      accepted_worker_session_digest: tokenHash('session-token-2'),
      request_digest: tokenHash('materialize-request-runtime-job-2'),
    });
    await startRuntimeJob(first.repository, 'runtime-job-2', {
      worker_id: 'worker-2',
      worker_session_token: 'session-token-2',
      nonce: 'start-nonce-runtime-job-2',
      request_digest: tokenHash('start-request-runtime-job-2'),
    });
    const otherArtifact = await createRuntimeJobArtifact(first.repository, 'runtime-job-2', {
      worker_id: 'worker-2',
      worker_session_token: 'session-token-2',
      nonce: 'artifact-other-job',
      request_digest: tokenHash('artifact-other-job-request'),
    });

    await expect(
      terminalizeRuntimeJob(first.repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'terminal-other-job-ref',
        request_digest: tokenHash('terminal-other-job-ref-request'),
        terminal_result_json: {
          ...validGenerationTerminalResult(),
          generation_artifacts: [
            {
              kind: 'generated_payload',
              name: 'generated-payload.json',
              content_type: otherArtifact.content_type,
              digest: otherArtifact.digest,
              internal_ref: otherArtifact.internal_ref,
            },
          ],
        },
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
  });

  it('rejects successful terminal results before the runtime job starts', async () => {
    const accepted = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(accepted.repository);
    await expect(
      terminalizeRuntimeJob(accepted.repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'terminal-accepted-success-nonce',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });

    const materializing = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-materializing-success-terminal',
        launch_lease_id: 'runtime-launch-lease-materializing-success-terminal',
        envelope_id: 'runtime-envelope-materializing-success-terminal',
        job_request_id: 'runtime-job-request-materializing-success-terminal',
        target: generationTarget({ target_id: 'generation-materializing-success-terminal' }),
      },
      { worker_id: 'worker-materializing-success-terminal', session_token: 'session-token-materializing-success-terminal' },
    );
    await materializing.repository.acceptCodexRuntimeJob({
      runtime_job_id: 'runtime-job-materializing-success-terminal',
      worker_id: 'worker-materializing-success-terminal',
      worker_session_token: 'session-token-materializing-success-terminal',
      nonce: 'accept-materializing-success-terminal-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-materializing-success-terminal'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      idempotency_key: 'accept-materializing-success-terminal',
      request_digest: tokenHash('accept-materializing-success-terminal-request'),
      now: later,
    });
    await materializing.repository.claimCodexLaunchTokenEnvelope({
      runtime_job_id: 'runtime-job-materializing-success-terminal',
      envelope_id: 'runtime-envelope-materializing-success-terminal',
      worker_id: 'worker-materializing-success-terminal',
      worker_session_token: 'session-token-materializing-success-terminal',
      nonce: 'claim-materializing-success-terminal-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-materializing-success-terminal'),
      key_id: 'session-key-1',
      accepted_session_epoch: 1,
      claim_request_id: 'claim-materializing-success-terminal',
      request_digest: tokenHash('claim-materializing-success-terminal-request'),
      now: later,
    });
    await materializing.repository.materializeCodexRuntimeJob({
      runtime_job_id: 'runtime-job-materializing-success-terminal',
      launch_lease_id: 'runtime-launch-lease-materializing-success-terminal',
      worker_id: 'worker-materializing-success-terminal',
      worker_session_token: 'session-token-materializing-success-terminal',
      nonce: 'materialize-materializing-success-terminal-nonce',
      nonce_timestamp: later,
      launch_token_hash: tokenHash(materializing.launchToken),
      accepted_worker_session_digest: tokenHash('session-token-materializing-success-terminal'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      materialization_request_id: 'materialize-materializing-success-terminal',
      request_digest: tokenHash('materialize-materializing-success-terminal-request'),
      active_fence: {
        action_claim_token_hash: tokenHash('runtime-action-claim-token-1'),
        precondition_fingerprint: 'runtime-precondition-1',
      },
      now: later,
    });
    await expect(
      materializing.repository.terminalizeCodexRuntimeJob({
        runtime_job_id: 'runtime-job-materializing-success-terminal',
        launch_lease_id: 'runtime-launch-lease-materializing-success-terminal',
        worker_id: 'worker-materializing-success-terminal',
        worker_session_token: 'session-token-materializing-success-terminal',
        nonce: 'terminal-materializing-success-nonce',
        nonce_timestamp: later,
        terminal_status: 'succeeded',
        reason_code: 'completed',
        terminal_result_json: validGenerationTerminalResult('completed-before-start'),
        idempotency_key: 'terminal-materializing-success',
        request_digest: tokenHash('terminal-materializing-success-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('rejects new terminal results after runtime job or launch lease expiry', async () => {
    const expired = await createRuntimeJobWithCapturedToken(
      { expires_at: '2026-05-20T00:01:30.000Z' },
      { session_expires_at: expiresAt, session_public_key_expires_at: expiresAt },
    );
    await acceptRuntimeJob(expired.repository);
    await claimRuntimeJobEnvelope(expired.repository);
    await materializeRuntimeJob(expired.repository, expired.launchToken);
    await startRuntimeJob(expired.repository);

    for (const terminalStatus of ['succeeded', 'failed'] as const) {
      await expect(
        terminalizeRuntimeJob(expired.repository, 'runtime-job-1', 'runtime-launch-lease-1', {
          nonce: `terminal-expired-${terminalStatus}-nonce`,
          terminal_status: terminalStatus,
          reason_code: terminalStatus === 'succeeded' ? 'completed' : 'runtime_failed',
          terminal_result_json:
            terminalStatus === 'succeeded' ? validGenerationTerminalResult('completed-after-expiry') : undefined,
          idempotency_key: `terminal-expired-${terminalStatus}`,
          request_digest: tokenHash(`terminal-expired-${terminalStatus}-request`),
          now: afterRuntimeJobExpiry,
        }),
      ).rejects.toMatchObject<Partial<DomainError>>({
        name: 'DomainError',
        code: 'codex_runtime_job_unavailable',
      });
    }

    await expired.repository.cancelCodexRuntimeJob({
      runtime_job_id: 'runtime-job-1',
      reason_code: 'user_cancelled',
      idempotency_key: 'cancel-before-expired-terminal',
      request_digest: tokenHash('cancel-before-expired-terminal-request'),
      now: later,
    });
    await expect(
      terminalizeRuntimeJob(expired.repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'terminal-expired-cancelled-nonce',
        terminal_status: 'cancelled',
        reason_code: 'user_cancelled',
        terminal_result_json: undefined,
        idempotency_key: 'terminal-expired-cancelled',
        request_digest: tokenHash('terminal-expired-cancelled-request'),
        now: afterRuntimeJobExpiry,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('rejects unsafe runtime job terminal result payloads before persistence', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);
    await claimRuntimeJobEnvelope(repository);
    await materializeRuntimeJob(repository, launchToken);
    await startRuntimeJob(repository);

    await expect(
      terminalizeRuntimeJob(repository, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'terminal-unsafe-result-nonce',
        terminal_result_json: {
          ...validGenerationTerminalResult('unsafe'),
          generated_payload: {
            raw_endpoint: 'http://127.0.0.1:8080/internal',
          },
          generated_payload_digest: tokenHash('unsafe-generated-payload'),
        },
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });
  });

  it('cancels queued runtime jobs by terminalizing the job and revoking the lease', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken();

    const cancelled = await repository.cancelCodexRuntimeJob({
      runtime_job_id: 'runtime-job-1',
      reason_code: 'user_cancelled',
      idempotency_key: 'cancel-queued',
      request_digest: tokenHash('cancel-queued-request'),
      now: later,
    });

    expect(cancelled).toMatchObject({
      id: 'runtime-job-1',
      status: 'terminal',
      terminal_status: 'cancelled',
      terminal_reason_code: 'user_cancelled',
      cancel_idempotency_key: 'cancel-queued',
    });
    await expect(
      repository.getCodexLaunchLeaseStatus({
        launch_lease_id: 'runtime-launch-lease-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'lease-status-revoked-nonce',
        nonce_timestamp: later,
        now: later,
      }),
    ).resolves.toMatchObject<CodexLaunchLease>({ id: 'runtime-launch-lease-1', status: 'revoked' });
  });

  it('terminalizes accepted unclaimed cancels and records durable monotonic cancel requests after claim, materialize, or start', async () => {
    const accepted = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(accepted.repository);
    const acceptedCancel = await accepted.repository.cancelCodexRuntimeJob({
      runtime_job_id: 'runtime-job-1',
      reason_code: 'user_cancelled',
      idempotency_key: 'cancel-accepted',
      request_digest: tokenHash('cancel-accepted-request'),
      now: later,
    });
    expect(acceptedCancel).toMatchObject({
      status: 'terminal',
      terminal_status: 'cancelled',
      terminal_reason_code: 'user_cancelled',
      cancel_requested_at: later,
      cancel_idempotency_key: 'cancel-accepted',
      cancel_request_digest: tokenHash('cancel-accepted-request'),
    });
    await expect(
      accepted.repository.getCodexLaunchLeaseStatus({
        launch_lease_id: 'runtime-launch-lease-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'lease-status-accepted-cancel-nonce',
        nonce_timestamp: later,
        now: later,
      }),
    ).resolves.toMatchObject<CodexLaunchLease>({ id: 'runtime-launch-lease-1', status: 'revoked' });
    expect(runtimeTokenEnvelopes(accepted.repository).get('runtime-envelope-1')).toMatchObject({ status: 'revoked' });
    await expect(
      accepted.repository.cancelCodexRuntimeJob({
        runtime_job_id: 'runtime-job-1',
        reason_code: 'user_cancelled',
        idempotency_key: 'cancel-accepted',
        request_digest: tokenHash('cancel-accepted-request'),
        now: '2026-05-20T00:02:00.000Z',
      }),
    ).resolves.toEqual(acceptedCancel);
    await expect(
      accepted.repository.cancelCodexRuntimeJob({
        runtime_job_id: 'runtime-job-1',
        reason_code: 'different_cancel',
        idempotency_key: 'cancel-accepted-conflict',
        request_digest: tokenHash('cancel-accepted-conflict-request'),
        now: '2026-05-20T00:03:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });

    const acceptedClaimed = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-accepted-claimed-cancel',
        launch_lease_id: 'runtime-launch-lease-accepted-claimed-cancel',
        envelope_id: 'runtime-envelope-accepted-claimed-cancel',
        job_request_id: 'runtime-job-request-accepted-claimed-cancel',
        target: generationTarget({ target_id: 'generation-accepted-claimed-cancel' }),
      },
      { worker_id: 'worker-accepted-claimed-cancel', session_token: 'session-token-accepted-claimed-cancel' },
    );
    await acceptedClaimed.repository.acceptCodexRuntimeJob({
      runtime_job_id: 'runtime-job-accepted-claimed-cancel',
      worker_id: 'worker-accepted-claimed-cancel',
      worker_session_token: 'session-token-accepted-claimed-cancel',
      nonce: 'accept-accepted-claimed-cancel-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-accepted-claimed-cancel'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      idempotency_key: 'accept-accepted-claimed-cancel',
      request_digest: tokenHash('accept-accepted-claimed-cancel-request'),
      now: later,
    });
    await acceptedClaimed.repository.claimCodexLaunchTokenEnvelope({
      runtime_job_id: 'runtime-job-accepted-claimed-cancel',
      envelope_id: 'runtime-envelope-accepted-claimed-cancel',
      worker_id: 'worker-accepted-claimed-cancel',
      worker_session_token: 'session-token-accepted-claimed-cancel',
      nonce: 'claim-accepted-claimed-cancel-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-accepted-claimed-cancel'),
      key_id: 'session-key-1',
      accepted_session_epoch: 1,
      claim_request_id: 'claim-accepted-claimed-cancel',
      request_digest: tokenHash('claim-accepted-claimed-cancel-request'),
      now: later,
    });
    await expect(
      acceptedClaimed.repository.cancelCodexRuntimeJob({
        runtime_job_id: 'runtime-job-accepted-claimed-cancel',
        reason_code: 'user_cancelled',
        idempotency_key: 'cancel-accepted-claimed',
        request_digest: tokenHash('cancel-accepted-claimed-request'),
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'accepted', cancel_idempotency_key: 'cancel-accepted-claimed' });

    const materializing = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-materializing-cancel',
        launch_lease_id: 'runtime-launch-lease-materializing-cancel',
        envelope_id: 'runtime-envelope-materializing-cancel',
        job_request_id: 'runtime-job-request-materializing-cancel',
        target: generationTarget({ target_id: 'generation-materializing-cancel' }),
      },
      { worker_id: 'worker-materializing-cancel', session_token: 'session-token-materializing-cancel' },
    );
    await materializing.repository.acceptCodexRuntimeJob({
      runtime_job_id: 'runtime-job-materializing-cancel',
      worker_id: 'worker-materializing-cancel',
      worker_session_token: 'session-token-materializing-cancel',
      nonce: 'accept-materializing-cancel-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-materializing-cancel'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      idempotency_key: 'accept-materializing-cancel',
      request_digest: tokenHash('accept-materializing-cancel-request'),
      now: later,
    });
    await materializing.repository.claimCodexLaunchTokenEnvelope({
      runtime_job_id: 'runtime-job-materializing-cancel',
      envelope_id: 'runtime-envelope-materializing-cancel',
      worker_id: 'worker-materializing-cancel',
      worker_session_token: 'session-token-materializing-cancel',
      nonce: 'claim-materializing-cancel-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-materializing-cancel'),
      key_id: 'session-key-1',
      accepted_session_epoch: 1,
      claim_request_id: 'claim-materializing-cancel',
      request_digest: tokenHash('claim-materializing-cancel-request'),
      now: later,
    });
    await materializing.repository.materializeCodexRuntimeJob({
      runtime_job_id: 'runtime-job-materializing-cancel',
      launch_lease_id: 'runtime-launch-lease-materializing-cancel',
      worker_id: 'worker-materializing-cancel',
      worker_session_token: 'session-token-materializing-cancel',
      nonce: 'materialize-materializing-cancel-nonce',
      nonce_timestamp: later,
      launch_token_hash: tokenHash(materializing.launchToken),
      accepted_worker_session_digest: tokenHash('session-token-materializing-cancel'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      materialization_request_id: 'materialize-materializing-cancel',
      request_digest: tokenHash('materialize-materializing-cancel-request'),
      active_fence: {
        action_claim_token_hash: tokenHash('runtime-action-claim-token-1'),
        precondition_fingerprint: 'runtime-precondition-1',
      },
      now: later,
    });
    await expect(
      materializing.repository.cancelCodexRuntimeJob({
        runtime_job_id: 'runtime-job-materializing-cancel',
        reason_code: 'user_cancelled',
        idempotency_key: 'cancel-materializing',
        request_digest: tokenHash('cancel-materializing-request'),
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'materializing', cancel_idempotency_key: 'cancel-materializing' });

    const running = await createRuntimeJobWithCapturedToken(
      {
        runtime_job_id: 'runtime-job-running-cancel',
        launch_lease_id: 'runtime-launch-lease-running-cancel',
        envelope_id: 'runtime-envelope-running-cancel',
        job_request_id: 'runtime-job-request-running-cancel',
        target: generationTarget({ target_id: 'generation-running-cancel' }),
      },
      { worker_id: 'worker-running-cancel', session_token: 'session-token-running-cancel' },
    );
    await running.repository.acceptCodexRuntimeJob({
      runtime_job_id: 'runtime-job-running-cancel',
      worker_id: 'worker-running-cancel',
      worker_session_token: 'session-token-running-cancel',
      nonce: 'accept-running-cancel-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-running-cancel'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      idempotency_key: 'accept-running-cancel',
      request_digest: tokenHash('accept-running-cancel-request'),
      now: later,
    });
    await running.repository.claimCodexLaunchTokenEnvelope({
      runtime_job_id: 'runtime-job-running-cancel',
      envelope_id: 'runtime-envelope-running-cancel',
      worker_id: 'worker-running-cancel',
      worker_session_token: 'session-token-running-cancel',
      nonce: 'claim-running-cancel-nonce',
      nonce_timestamp: later,
      accepted_worker_session_digest: tokenHash('session-token-running-cancel'),
      key_id: 'session-key-1',
      accepted_session_epoch: 1,
      claim_request_id: 'claim-running-cancel',
      request_digest: tokenHash('claim-running-cancel-request'),
      now: later,
    });
    await running.repository.materializeCodexRuntimeJob({
      runtime_job_id: 'runtime-job-running-cancel',
      launch_lease_id: 'runtime-launch-lease-running-cancel',
      worker_id: 'worker-running-cancel',
      worker_session_token: 'session-token-running-cancel',
      nonce: 'materialize-running-cancel-nonce',
      nonce_timestamp: later,
      launch_token_hash: tokenHash(running.launchToken),
      accepted_worker_session_digest: tokenHash('session-token-running-cancel'),
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
      materialization_request_id: 'materialize-running-cancel',
      request_digest: tokenHash('materialize-running-cancel-request'),
      active_fence: {
        action_claim_token_hash: tokenHash('runtime-action-claim-token-1'),
        precondition_fingerprint: 'runtime-precondition-1',
      },
      now: later,
    });
    await running.repository.startCodexRuntimeJob({
      runtime_job_id: 'runtime-job-running-cancel',
      worker_id: 'worker-running-cancel',
      worker_session_token: 'session-token-running-cancel',
      nonce: 'start-running-cancel-nonce',
      nonce_timestamp: later,
      idempotency_key: 'start-running-cancel',
      request_digest: tokenHash('start-running-cancel-request'),
      runtime_evidence_digest: tokenHash('runtime-evidence-running-cancel'),
      launch_materialization_digest: tokenHash('launch-materialization-running-cancel'),
      now: later,
    });
    await expect(
      running.repository.cancelCodexRuntimeJob({
        runtime_job_id: 'runtime-job-running-cancel',
        reason_code: 'user_cancelled',
        idempotency_key: 'cancel-running',
        request_digest: tokenHash('cancel-running-request'),
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'running', cancel_idempotency_key: 'cancel-running' });
    await expect(
      running.repository.terminalizeCodexRuntimeJob({
        runtime_job_id: 'runtime-job-running-cancel',
        launch_lease_id: 'runtime-launch-lease-running-cancel',
        worker_id: 'worker-running-cancel',
        worker_session_token: 'session-token-running-cancel',
        nonce: 'terminal-running-cancel-success-race-nonce',
        nonce_timestamp: later,
        terminal_status: 'succeeded',
        reason_code: 'completed_after_cancel',
        terminal_result_json: validGenerationTerminalResult('completed-after-cancel'),
        idempotency_key: 'terminal-running-cancel-success-race',
        request_digest: tokenHash('terminal-running-cancel-success-race-request'),
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
    await expect(
      running.repository.terminalizeCodexRuntimeJob({
        runtime_job_id: 'runtime-job-running-cancel',
        launch_lease_id: 'runtime-launch-lease-running-cancel',
        worker_id: 'worker-running-cancel',
        worker_session_token: 'session-token-running-cancel',
        nonce: 'terminal-running-cancelled-nonce',
        nonce_timestamp: later,
        terminal_status: 'cancelled',
        reason_code: 'user_cancelled',
        idempotency_key: 'terminal-running-cancelled',
        request_digest: tokenHash('terminal-running-cancelled-request'),
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'terminal', terminal_status: 'cancelled' });
  });

  it('recovers stale runtime jobs and associated leases without writing product state', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken({
      expires_at: '2026-05-20T00:30:00.000Z',
    });
    await acceptRuntimeJob(repository);

    const recovered = await repository.recoverStaleCodexRuntimeJobs({
      stale_before: '2026-05-20T00:02:00.000Z',
      now: '2026-05-20T00:02:00.000Z',
      worker_id: 'worker-1',
      reason_code: 'codex_runtime_job_stale',
    });

    expect(recovered).toMatchObject({
      recovered_runtime_jobs: [
        {
          id: 'runtime-job-1',
          status: 'terminal',
          terminal_status: 'expired',
          terminal_reason_code: 'codex_runtime_job_stale',
        },
      ],
      recovered_launch_leases: [{ id: 'runtime-launch-lease-1', status: 'expired' }],
    });
    expect(recovered.recovered_runtime_jobs[0]).not.toHaveProperty('input_json');
    expect(recovered.recovered_runtime_jobs[0]).not.toHaveProperty('workspace_acquisition_json');
    expect(JSON.stringify(recovered)).not.toContain('artifact://runtime/input');
    await expect(
      repository.getClaimedAutomationActionRun({
        id: 'generation-1',
        claim_token: 'runtime-action-claim-token-1',
      }),
    ).resolves.toMatchObject({ id: 'generation-1', status: 'running' });
  });

  it('rejects non-allowlisted runtime job recovery reason codes', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken({
      expires_at: '2026-05-20T00:30:00.000Z',
    });

    await expect(
      repository.recoverStaleCodexRuntimeJobs({
        stale_before: '2026-05-20T00:02:00.000Z',
        now: '2026-05-20T00:02:00.000Z',
        worker_id: 'worker-1',
        reason_code: 'unsafe /tmp/recovery token' as never,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it.each([
    ['queued', async () => undefined],
    ['accepted', async (repository: DeliveryRepository) => acceptRuntimeJob(repository)],
    [
      'materializing',
      async (repository: DeliveryRepository, launchToken: string) => {
        await acceptRuntimeJob(repository);
        await claimRuntimeJobEnvelope(repository);
        await materializeRuntimeJob(repository, launchToken);
      },
    ],
    [
      'running',
      async (repository: DeliveryRepository, launchToken: string) => {
        await acceptRuntimeJob(repository);
        await claimRuntimeJobEnvelope(repository);
        await materializeRuntimeJob(repository, launchToken);
        await startRuntimeJob(repository);
      },
    ],
  ])('recovers stale %s runtime jobs idempotently with public-safe reason codes', async (_status, prepare) => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken({
      expires_at: '2026-05-20T00:30:00.000Z',
    });
    await prepare(repository, launchToken);

    await expect(
      repository.recoverStaleCodexRuntimeJobs({
        stale_before: '2026-05-20T00:02:00.000Z',
        now: '2026-05-20T00:02:00.000Z',
        worker_id: 'worker-1',
        reason_code: 'codex_runtime_job_stale',
      }),
    ).resolves.toMatchObject({
      recovered_runtime_jobs: [
        {
          id: 'runtime-job-1',
          status: 'terminal',
          terminal_status: 'expired',
          terminal_reason_code: 'codex_runtime_job_stale',
        },
      ],
      recovered_launch_leases: [{ id: 'runtime-launch-lease-1', status: 'expired' }],
    });
    await expect(
      repository.recoverStaleCodexRuntimeJobs({
        stale_before: '2026-05-20T00:02:00.000Z',
        now: '2026-05-20T00:02:00.000Z',
        worker_id: 'worker-1',
        reason_code: 'codex_runtime_job_stale',
      }),
    ).resolves.toEqual({ recovered_runtime_jobs: [], recovered_launch_leases: [] });
    await expect(
      repository.getClaimedAutomationActionRun({
        id: 'generation-1',
        claim_token: 'runtime-action-claim-token-1',
      }),
    ).resolves.toMatchObject({ id: 'generation-1', status: 'running' });
  });

  it('repairs nonterminal runtime jobs whose launch lease already reached a terminal status', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken({
      expires_at: '2026-05-20T00:30:00.000Z',
    });
    await acceptRuntimeJob(repository);
    await repository.terminalizeCodexLaunchLease({
      lease_id: 'runtime-launch-lease-1',
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'terminalize-runtime-lease-before-runtime-recovery',
      nonce_timestamp: later,
      terminal_status: 'terminal',
      reason_code: 'worker_closed_before_runtime_terminal',
      idempotency_key: 'terminalize-runtime-lease-before-runtime-recovery',
      evidence_summary: { cleanup_digest: tokenHash('runtime-lease-cleanup') },
      now: later,
    });

    await expect(
      repository.recoverStaleCodexRuntimeJobs({
        stale_before: now,
        now: '2026-05-20T00:02:00.000Z',
        worker_id: 'worker-1',
        reason_code: 'codex_runtime_job_lease_terminal',
      }),
    ).resolves.toMatchObject({
      recovered_runtime_jobs: [
        {
          id: 'runtime-job-1',
          status: 'terminal',
          terminal_status: 'expired',
          terminal_reason_code: 'codex_runtime_job_lease_terminal',
        },
      ],
      recovered_launch_leases: [],
    });
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: 'runtime-job-1' })).resolves.toMatchObject({
      status: 'terminal',
      terminal_status: 'expired',
      terminal_reason_code: 'codex_runtime_job_lease_terminal',
    });
  });

  it('keeps runtime job launch leases out of legacy stale worker recovery', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken({
      expires_at: '2026-05-20T00:30:00.000Z',
    });
    await acceptRuntimeJob(repository);

    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: '2026-05-20T00:02:00.000Z',
        now: '2026-05-20T00:02:00.000Z',
        worker_id: 'worker-1',
        reason_code: 'legacy_stale_worker',
      }),
    ).resolves.toEqual({ recovered_launch_leases: [], automation_action_transitions: [], run_session_transitions: [] });
    await expect(
      repository.getClaimedAutomationActionRun({
        id: 'generation-1',
        claim_token: 'runtime-action-claim-token-1',
      }),
    ).resolves.toMatchObject({ id: 'generation-1', status: 'running' });
    await expect(
      repository.getCodexLaunchLeaseStatus({
        launch_lease_id: 'runtime-launch-lease-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'lease-status-after-legacy-recovery-nonce',
        nonce_timestamp: later,
        now: later,
      }),
    ).resolves.toMatchObject<CodexLaunchLease>({ id: 'runtime-launch-lease-1', status: 'active' });
  });

  it('returns only public-safe launch lease status for runtime jobs', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();

    const status = await repository.getCodexLaunchLeaseStatus({
      launch_lease_id: 'runtime-launch-lease-1',
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'lease-status-public-safe-nonce',
      nonce_timestamp: later,
      now: later,
    });

    expect(status).toMatchObject({ id: 'runtime-launch-lease-1', status: 'active', lease_token_hash: tokenHash(launchToken) });
    expect(status).not.toHaveProperty('lease_token');
    expect(JSON.stringify(status)).not.toContain(launchToken);
  });

  it('does not deliver new queued runtime jobs to draining workers', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken();
    await repository.heartbeatCodexWorker({
      worker_id: 'worker-1',
      session_token: 'session-token-1',
      nonce: 'runtime-job-draining-heartbeat',
      nonce_timestamp: later,
      status: 'draining',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: later,
    });

    await expect(
      repository.pollCodexRuntimeJobs({
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'runtime-job-draining-poll',
        nonce_timestamp: later,
        target_kinds: ['generation'],
        limit: 1,
        replay_protection: {
          method: 'POST',
          path: '/internal/codex-workers/worker-1/runtime-jobs/poll',
          body_digest: tokenHash('runtime-job-draining-poll-request'),
        },
        now: later,
      }),
    ).resolves.toEqual([]);
  });

  it('refreshes worker sessions only when queued jobs sealed to the current key cannot be stranded', async () => {
    const { repository } = await createRuntimeJobWithCapturedToken();

    await expect(
      repository.refreshCodexWorkerSession({
        worker_id: 'worker-1',
        current_session_token: 'session-token-1',
        nonce: 'refresh-with-queued-runtime-job',
        nonce_timestamp: later,
        next_session_token: 'session-token-2',
        next_session_expires_at: expiresAt,
        next_session_public_key_id: 'session-key-2',
        next_session_public_key_material: 'public-key-material-2',
        next_session_public_key_expires_at: expiresAt,
        request_digest: tokenHash('refresh-with-queued-runtime-job-request'),
        replay_protection: {
          method: 'POST',
          path: '/internal/codex-workers/worker-1/session/refresh',
          body_digest: tokenHash('refresh-with-queued-runtime-job-request'),
        },
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_worker_registration_denied',
    });

    await repository.cancelCodexRuntimeJob({
      runtime_job_id: 'runtime-job-1',
      reason_code: 'test_cancel_before_refresh',
      idempotency_key: 'cancel-before-refresh',
      request_digest: tokenHash('cancel-before-refresh-request'),
      now: later,
    });

    await expect(
      repository.refreshCodexWorkerSession({
        worker_id: 'worker-1',
        current_session_token: 'session-token-1',
        nonce: 'refresh-after-queued-runtime-job-cancel',
        nonce_timestamp: later,
        next_session_token: 'session-token-2',
        next_session_expires_at: expiresAt,
        next_session_public_key_id: 'session-key-2',
        next_session_public_key_material: 'public-key-material-2',
        next_session_public_key_expires_at: expiresAt,
        request_digest: tokenHash('refresh-after-queued-runtime-job-cancel-request'),
        replay_protection: {
          method: 'POST',
          path: '/internal/codex-workers/worker-1/session/refresh',
          body_digest: tokenHash('refresh-after-queued-runtime-job-cancel-request'),
        },
        now: later,
      }),
    ).resolves.toMatchObject({ id: 'worker-1', session_id: 'session-key-2', session_epoch: 2 });
  });

  it('keeps the accepted session token valid for already accepted runtime jobs after session refresh', async () => {
    const { repository, launchToken } = await createRuntimeJobWithCapturedToken();
    await acceptRuntimeJob(repository);

    await repository.refreshCodexWorkerSession({
      worker_id: 'worker-1',
      current_session_token: 'session-token-1',
      nonce: 'refresh-after-accepted-runtime-job',
      nonce_timestamp: later,
      next_session_token: 'session-token-2',
      next_session_expires_at: expiresAt,
      next_session_public_key_id: 'session-key-2',
      next_session_public_key_material: 'public-key-material-2',
      next_session_public_key_expires_at: expiresAt,
      request_digest: tokenHash('refresh-after-accepted-runtime-job-request'),
      replay_protection: {
        method: 'POST',
        path: '/internal/codex-workers/worker-1/session/refresh',
        body_digest: tokenHash('refresh-after-accepted-runtime-job-request'),
      },
      now: later,
    });

    await expect(
      claimRuntimeJobEnvelope(repository, 'runtime-job-1', 'runtime-envelope-1', {
        nonce: 'claim-with-accepted-session-after-refresh',
      }),
    ).resolves.toMatchObject({ id: 'runtime-envelope-1', status: 'claimed', claimed_key_id: 'session-key-1' });
    await expect(
      materializeRuntimeJob(repository, launchToken, 'runtime-job-1', 'runtime-launch-lease-1', {
        nonce: 'materialize-with-accepted-session-after-refresh',
      }),
    ).resolves.toMatchObject({ lease_id: 'runtime-launch-lease-1' });
  });

  it('creates runtime jobs with a repository-owned sealed envelope and no raw launch token in the result', async () => {
    const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
    const repository = createRepository(createEnvelopeSealer(sealerCalls));
    const input = await runtimeJobInput(repository);

    const result = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

    expect(result.replayed).toBe(false);
    expect(result.runtime_job).toMatchObject({
      id: input.runtime_job_id,
      job_request_id: input.job_request_id,
      status: 'queued',
      input_digest: input.input_digest,
      workspace_acquisition_digest: input.workspace_acquisition_digest,
    });
    expect(result.launch_lease).toMatchObject({
      id: input.launch_lease_id,
      status: 'active',
      lease_token_hash: expect.stringMatching(/^sha256:/),
    });
    expect(result.envelope).toMatchObject({
      id: input.envelope_id,
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      worker_id: input.worker_id,
      status: 'available',
    });
    expect(sealerCalls).toHaveLength(1);
    expect(sealerCalls[0]).toMatchObject({
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
      worker_id: input.worker_id,
      worker_public_key_material: 'public-key-material',
      key_id: 'session-key-1',
      expires_at: input.expires_at,
    });
    expect(sealerCalls[0]?.plaintext_launch_token).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain(sealerCalls[0]!.plaintext_launch_token);
    expect(result.launch_lease).not.toHaveProperty('lease_token');
  });

  it('replays runtime jobs by job_request_id without resealing a new launch token', async () => {
    const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
    const repository = createRepository(createEnvelopeSealer(sealerCalls));
    const input = await runtimeJobInput(repository);
    const first = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

    const second = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
      ...input,
      runtime_job_id: 'runtime-job-replay-ignored',
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
    });

    expect(second).toEqual({ ...first, replayed: true });
    expect(sealerCalls).toHaveLength(1);
  });

  it('replays runtime jobs by target plus launch attempt when fences match', async () => {
    const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
    const repository = createRepository(createEnvelopeSealer(sealerCalls));
    const input = await runtimeJobInput(repository);
    const first = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

    const second = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
      ...input,
      runtime_job_id: 'runtime-job-target-replay',
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
      job_request_id: 'runtime-job-request-target-replay',
    });

    expect(second).toEqual({ ...first, replayed: true });
    expect(sealerCalls).toHaveLength(1);
  });

  it('rejects runtime job replay after the stored action claim fence expires', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const input = await runtimeJobInput(repository, {
      expires_at: '2026-05-20T00:30:00.000Z',
    });
    await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

    await expect(
      repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
        ...input,
        runtime_job_id: 'runtime-job-stale-action-replay',
        now: '2026-05-20T00:11:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('rejects runtime job replay after the stored launch lease expires', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const target = generationTarget({ target_id: 'generation-lease-expiry-replay' });
    await claimGenerationAction(repository, {
      id: target.target_id,
      idempotency_key: 'runtime-generation-lease-expiry-replay-idem',
      target_object_id: target.target_id,
      action_input_json: { generation_id: target.target_id },
      claim_token: 'runtime-action-claim-token-1',
      precondition_fingerprint: 'runtime-precondition-1',
      locked_until: '2026-05-20T00:30:00.000Z',
    });
    const input = await runtimeJobInput(repository, {
      runtime_job_id: 'runtime-job-lease-expiry-replay',
      launch_lease_id: 'runtime-launch-lease-expiry-replay',
      envelope_id: 'runtime-envelope-lease-expiry-replay',
      job_request_id: 'runtime-job-request-lease-expiry-replay',
      target,
      expires_at: expiresAt,
    });
    await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

    await expect(
      repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
        ...input,
        runtime_job_id: 'runtime-job-lease-expiry-replay-ignored',
        now: '2026-05-20T00:11:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('creates runtime jobs for the selected eligible worker even when another worker has more free slots', async () => {
    const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
    const repository = createRepository(createEnvelopeSealer(sealerCalls));
    const input = await runtimeJobInput(repository, {}, { lease_count: 1, max_concurrency: 2 });
    const { worker: emptierWorker, sessionToken: emptierSessionToken } = await seedWorker(repository, {
      worker_id: 'worker-with-more-free-slots',
      session_token: 'session-token-more-free-slots',
      capabilities: ['generation'],
      lease_count: 0,
      max_concurrency: 2,
    });
    await repository.heartbeatCodexWorker({
      worker_id: emptierWorker.id,
      session_token: emptierSessionToken,
      nonce: 'runtime-job-emptier-worker-heartbeat',
      nonce_timestamp: now,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now,
    });

    const created = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

    expect(created.runtime_job.worker_id).toBe(input.worker_id);
    expect(sealerCalls).toHaveLength(1);
  });

  it('rejects runtime job create when a non-runtime launch lease already owns the target attempt', async () => {
    const repository = createRepository(createEnvelopeSealer());
    await createLaunchLease(repository);
    const input = await runtimeJobInput(
      repository,
      {
        runtime_job_id: 'runtime-job-launch-lease-conflict',
        launch_lease_id: 'runtime-launch-lease-conflict',
        envelope_id: 'runtime-envelope-launch-lease-conflict',
        job_request_id: 'runtime-job-request-launch-lease-conflict',
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
      },
      {
        worker_id: 'worker-runtime-launch-lease-conflict',
        session_token: 'session-token-runtime-launch-lease-conflict',
      },
    );

    await expect(repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('requires generation runtime jobs to carry strong action claim fences', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const input = await runtimeJobInput(repository, {
      action_claim_token_hash: undefined,
      precondition_fingerprint: undefined,
    });

    await expect(repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it.each([
    ['input digest', { input_digest: tokenHash('other-input') }],
    ['workspace digest', { workspace_acquisition_digest: tokenHash('other-workspace') }],
    ['worker id', { worker_id: 'worker-other' }],
    ['launch lease id', { launch_lease_id: 'runtime-launch-lease-other' }],
    ['profile fence', { runtime_profile_digest: tokenHash('other-profile') }],
    ['credential fence', { credential_payload_digest: tokenHash('other-credential') }],
    ['envelope id', { envelope_id: 'runtime-envelope-other' }],
  ])('rejects runtime job replay with conflicting %s', async (_label, patch) => {
    const repository = createRepository(createEnvelopeSealer());
    const input = await runtimeJobInput(repository);
    await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

    await expect(
      repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
        ...input,
        ...patch,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('does not persist runtime job, launch lease, or envelope when envelope sealing fails', async () => {
    const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
    const repository = createRepository(createEnvelopeSealer(sealerCalls, { failFirst: true }));
    const input = await runtimeJobInput(repository, {}, { max_concurrency: 1 });

    await expect(repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input)).rejects.toThrow('seal failed');

    const retried = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
    expect(retried.replayed).toBe(false);
    expect(retried.runtime_job.id).toBe(input.runtime_job_id);
    expect(sealerCalls).toHaveLength(2);
  });

  it('binds pending workspace bundles on create and rejects mismatched bundle replays', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const run = runSession({
      id: 'runtime-run-session-1',
      execution_package_id: 'runtime-execution-package-1',
    });
    await repository.saveExecutionPackage(executionPackage({ id: run.execution_package_id }));
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-1',
      lease_token: 'run-worker-token-1',
      now,
      expires_at: expiresAt,
    });
    const target = generationTarget({
      target_type: 'run_session',
      target_kind: 'run_execution',
      target_id: run.id,
    });
    const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: 'pending-bundle-1' });
    const archiveBytes = archiveFixture.archive;
    const workspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'pending-bundle-1',
      archive_ref: 'artifact://internal/workspace_bundle/run_session/runtime-run-session-1/pending-bundle-1',
      archive_digest: archiveFixture.archive_digest,
      manifest_digest: archiveFixture.manifest_digest,
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingBundle = {
      bundle_id: 'pending-bundle-1',
      pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
      internal_artifact_object_id: '22222222-2222-4222-8222-222222222223',
      archive_digest: workspaceAcquisitionJson.archive_digest,
      manifest_digest: workspaceAcquisitionJson.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: archiveBytes.byteLength,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
      workspace_acquisition_json: workspaceAcquisitionJson,
      expires_at: expiresAt,
    };
    await createInternalArtifactObject(repository, {
      id: pendingBundle.internal_artifact_object_id,
      artifact_id: pendingBundle.bundle_id,
      ref: pendingBundle.pending_artifact_ref,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: run.id,
      size_bytes: pendingBundle.size_bytes,
      digest: pendingBundle.archive_digest,
      metadata_json: {
        manifest_digest: pendingBundle.manifest_digest,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
      },
    });
    const pendingBundleRecord = {
      ...pendingBundle,
      id: '22222222-2222-4222-8222-222222222222',
      run_session_id: run.id,
      execution_package_id: run.execution_package_id,
      request_digest: tokenHash('pending-workspace-request-1'),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingBundleRecord);
    const input = await runtimeJobInput(
      repository,
      {
        runtime_job_id: 'runtime-job-run-execution-1',
        launch_lease_id: 'runtime-launch-lease-run-execution-1',
        envelope_id: 'runtime-envelope-run-execution-1',
        job_request_id: 'runtime-job-request-run-execution-1',
        target,
        action_type: undefined,
        action_attempt: undefined,
        action_claim_token_hash: undefined,
        precondition_fingerprint: undefined,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
        run_worker_lease_token_hash: tokenHash('run-worker-token-1'),
        run_session_status: 'running',
        run_session_updated_at: now,
        execution_package_version: 1,
        input_json: { task: 'run package', public_ref: 'artifact://runtime/run-input' },
        input_digest: tokenHash('runtime-run-input-1'),
        workspace_acquisition_json: pendingBundle.workspace_acquisition_json,
        workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
        pending_workspace_bundle: pendingBundleRecord,
      },
      { capabilities: ['run_execution'] },
    );

    const created = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
    const replayed = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
      ...input,
      job_request_id: 'runtime-job-request-run-execution-replay',
    });

    expect(created.runtime_job.workspace_acquisition_digest).toBe(pendingBundle.workspace_acquisition_digest);
    expect([...runtimeJobArtifactBindings(repository).values()]).toContainEqual(
      expect.objectContaining({
        runtime_job_id: created.runtime_job.id,
        kind: 'workspace_bundle',
        name: pendingBundle.bundle_id,
        digest: pendingBundle.archive_digest,
        internal_ref: pendingBundle.pending_artifact_ref,
        internal_artifact_object_id: pendingBundle.internal_artifact_object_id,
        metadata_json: expect.objectContaining({
          bundle_id: pendingBundle.bundle_id,
          manifest_digest: pendingBundle.manifest_digest,
          run_worker_lease_id: pendingBundle.run_worker_lease_id,
          workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
        }),
      }),
    );
    expect(replayed).toEqual({ ...created, replayed: true });
    await expect(
      repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
        ...input,
        job_request_id: 'runtime-job-request-run-execution-conflict',
        pending_workspace_bundle: {
          ...pendingBundleRecord,
          archive_digest: tokenHash('bundle-archive-conflict'),
        },
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('rejects run-execution runtime job create when pending bundle object id differs from stored bundle', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const run = runSession({
      id: 'runtime-run-session-pending-object-mismatch',
      execution_package_id: 'runtime-execution-package-pending-object-mismatch',
    });
    await repository.saveExecutionPackage(executionPackage({ id: run.execution_package_id }));
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-pending-object-mismatch',
      lease_token: 'run-worker-token-pending-object-mismatch',
      now,
      expires_at: expiresAt,
    });
    const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: 'pending-bundle-object-mismatch' });
    const archiveBytes = archiveFixture.archive;
    const workspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'pending-bundle-object-mismatch',
      archive_ref:
        'artifact://internal/workspace_bundle/run_session/runtime-run-session-pending-object-mismatch/pending-bundle-object-mismatch',
      archive_digest: archiveFixture.archive_digest,
      manifest_digest: archiveFixture.manifest_digest,
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingBundle = {
      bundle_id: 'pending-bundle-object-mismatch',
      pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
      internal_artifact_object_id: '66666666-6666-4666-8666-666666666666',
      archive_digest: workspaceAcquisitionJson.archive_digest,
      manifest_digest: workspaceAcquisitionJson.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: archiveBytes.byteLength,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
      workspace_acquisition_json: workspaceAcquisitionJson,
      expires_at: expiresAt,
    };
    await createInternalArtifactObject(repository, {
      id: pendingBundle.internal_artifact_object_id,
      artifact_id: pendingBundle.bundle_id,
      ref: pendingBundle.pending_artifact_ref,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: run.id,
      size_bytes: pendingBundle.size_bytes,
      digest: pendingBundle.archive_digest,
      metadata_json: {
        manifest_digest: pendingBundle.manifest_digest,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
      },
    });
    const pendingBundleRecord = {
      ...pendingBundle,
      id: '66666666-6666-4666-8666-666666666665',
      run_session_id: run.id,
      execution_package_id: run.execution_package_id,
      request_digest: tokenHash('pending-workspace-request-object-mismatch'),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingBundleRecord);
    const input = await runtimeJobInput(
      repository,
      {
        runtime_job_id: 'runtime-job-run-execution-pending-object-mismatch',
        launch_lease_id: 'runtime-launch-lease-run-execution-pending-object-mismatch',
        envelope_id: 'runtime-envelope-run-execution-pending-object-mismatch',
        job_request_id: 'runtime-job-request-run-execution-pending-object-mismatch',
        target: generationTarget({
          target_type: 'run_session',
          target_kind: 'run_execution',
          target_id: run.id,
        }),
        action_type: undefined,
        action_attempt: undefined,
        action_claim_token_hash: undefined,
        precondition_fingerprint: undefined,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
        run_worker_lease_token_hash: tokenHash('run-worker-token-pending-object-mismatch'),
        run_session_status: 'running',
        run_session_updated_at: now,
        execution_package_version: 1,
        input_json: { task: 'run package', public_ref: 'artifact://runtime/run-input-pending-object-mismatch' },
        input_digest: tokenHash('runtime-run-input-pending-object-mismatch'),
        workspace_acquisition_json: pendingBundle.workspace_acquisition_json,
        workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
        pending_workspace_bundle: {
          ...pendingBundleRecord,
          internal_artifact_object_id: '66666666-6666-4666-8666-000000000000',
        },
      },
      { capabilities: ['run_execution'] },
    );

    await expect(repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('rejects new pending workspace bundle rows that only carry legacy DB bytes', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const run = runSession({
      id: 'runtime-run-session-pending-byte-only',
      execution_package_id: 'runtime-execution-package-pending-byte-only',
    });
    await repository.saveExecutionPackage(executionPackage({ id: run.execution_package_id }));
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-pending-byte-only',
      lease_token: 'run-worker-token-pending-byte-only',
      now,
      expires_at: expiresAt,
    });
    const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: 'pending-bundle-byte-only' });
    const workspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'pending-bundle-byte-only',
      archive_ref: 'artifact://internal/workspace_bundle/run_session/runtime-run-session-pending-byte-only/pending-bundle-byte-only',
      archive_digest: archiveFixture.archive_digest,
      manifest_digest: archiveFixture.manifest_digest,
      size_bytes: archiveFixture.archive.byteLength,
      expires_at: expiresAt,
    };

    await expect(
      repository.createPendingWorkspaceBundleArtifact({
        id: '99999999-9999-4999-8999-999999999999',
        bundle_id: workspaceAcquisitionJson.bundle_id,
        run_session_id: run.id,
        execution_package_id: run.execution_package_id,
        pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
        archive_digest: workspaceAcquisitionJson.archive_digest,
        manifest_digest: workspaceAcquisitionJson.manifest_digest,
        archive_bytes_base64: archiveFixture.archive.toString('base64'),
        run_worker_lease_id: runWorkerLease.id,
        size_bytes: archiveFixture.archive.byteLength,
        workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
        workspace_acquisition_json: workspaceAcquisitionJson,
        expires_at: expiresAt,
        request_digest: tokenHash('pending-workspace-request-byte-only'),
        created_at: now,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('returns byte-less workspace bundle download metadata after object-backed binding', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const run = runSession({
      id: 'runtime-run-session-byteless',
      execution_package_id: 'runtime-execution-package-byteless',
    });
    await repository.saveExecutionPackage(executionPackage({ id: run.execution_package_id }));
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-byteless',
      lease_token: 'run-worker-token-byteless',
      now,
      expires_at: expiresAt,
    });
    const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: 'pending-bundle-byteless' });
    const archiveBytes = archiveFixture.archive;
    const workspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'pending-bundle-byteless',
      archive_ref: 'artifact://internal/workspace_bundle/run_session/runtime-run-session-byteless/pending-bundle-byteless',
      archive_digest: archiveFixture.archive_digest,
      manifest_digest: archiveFixture.manifest_digest,
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingBundle = {
      bundle_id: 'pending-bundle-byteless',
      pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
      internal_artifact_object_id: '44444444-4444-4444-8444-444444444444',
      archive_digest: workspaceAcquisitionJson.archive_digest,
      manifest_digest: workspaceAcquisitionJson.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: archiveBytes.byteLength,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
      workspace_acquisition_json: workspaceAcquisitionJson,
      expires_at: expiresAt,
    };
    await createInternalArtifactObject(repository, {
      id: pendingBundle.internal_artifact_object_id,
      artifact_id: pendingBundle.bundle_id,
      ref: pendingBundle.pending_artifact_ref,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: run.id,
      size_bytes: pendingBundle.size_bytes,
      digest: pendingBundle.archive_digest,
      metadata_json: {
        manifest_digest: pendingBundle.manifest_digest,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
      },
    });
    const pendingBundleRecord = {
      ...pendingBundle,
      id: '44444444-4444-4444-8444-444444444443',
      run_session_id: run.id,
      execution_package_id: run.execution_package_id,
      request_digest: tokenHash('pending-workspace-request-byteless'),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingBundleRecord);
    const input = await runtimeJobInput(
      repository,
      {
        runtime_job_id: 'runtime-job-run-execution-byteless',
        launch_lease_id: 'runtime-launch-lease-run-execution-byteless',
        envelope_id: 'runtime-envelope-run-execution-byteless',
        job_request_id: 'runtime-job-request-run-execution-byteless',
        target: generationTarget({
          target_type: 'run_session',
          target_kind: 'run_execution',
          target_id: run.id,
        }),
        action_type: undefined,
        action_attempt: undefined,
        action_claim_token_hash: undefined,
        precondition_fingerprint: undefined,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
        run_worker_lease_token_hash: tokenHash('run-worker-token-byteless'),
        run_session_status: 'running',
        run_session_updated_at: now,
        execution_package_version: 1,
        input_json: { task: 'run package', public_ref: 'artifact://runtime/run-input-byteless' },
        input_digest: tokenHash('runtime-run-input-byteless'),
        workspace_acquisition_json: pendingBundle.workspace_acquisition_json,
        workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
        pending_workspace_bundle: pendingBundleRecord,
      },
      { capabilities: ['run_execution'] },
    );
    await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
    await acceptRuntimeJob(repository, input.runtime_job_id, {
      nonce: 'accept-nonce-runtime-job-run-execution-byteless',
      idempotency_key: 'accept-runtime-job-run-execution-byteless',
      request_digest: tokenHash('accept-request-runtime-job-run-execution-byteless'),
    });

    await expect(
      repository.getWorkspaceBundleDownloadForRuntimeJob({
        runtime_job_id: input.runtime_job_id,
        bundle_id: pendingBundle.bundle_id,
        worker_id: input.worker_id,
        worker_session_token: 'session-token-1',
        nonce: 'download-nonce-byteless',
        nonce_timestamp: later,
        replay_protection: {
          method: 'GET',
          path: `/codex/runtime-jobs/${input.runtime_job_id}/workspace-bundles/${pendingBundle.bundle_id}`,
          body_digest: tokenHash('download-byteless'),
        },
        now: later,
      }),
    ).resolves.toMatchObject({
      bundle_id: pendingBundle.bundle_id,
      archive_ref: pendingBundle.pending_artifact_ref,
      internal_artifact_object_id: pendingBundle.internal_artifact_object_id,
      archive_digest: pendingBundle.archive_digest,
      manifest_digest: pendingBundle.manifest_digest,
      size_bytes: pendingBundle.size_bytes,
    });
  });

  it('rejects in-memory workspace bundle downloads when artifact object binding drifts from pending bundle', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const run = runSession({
      id: 'runtime-run-session-object-drift',
      execution_package_id: 'runtime-execution-package-object-drift',
    });
    await repository.saveExecutionPackage(executionPackage({ id: run.execution_package_id }));
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-object-drift',
      lease_token: 'run-worker-token-object-drift',
      now,
      expires_at: expiresAt,
    });
    const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: 'pending-bundle-object-drift' });
    const archiveBytes = archiveFixture.archive;
    const workspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'pending-bundle-object-drift',
      archive_ref: 'artifact://internal/workspace_bundle/run_session/runtime-run-session-object-drift/pending-bundle-object-drift',
      archive_digest: archiveFixture.archive_digest,
      manifest_digest: archiveFixture.manifest_digest,
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingBundle = {
      bundle_id: 'pending-bundle-object-drift',
      pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
      internal_artifact_object_id: '55555555-5555-4555-8555-555555555555',
      archive_digest: workspaceAcquisitionJson.archive_digest,
      manifest_digest: workspaceAcquisitionJson.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: archiveBytes.byteLength,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
      workspace_acquisition_json: workspaceAcquisitionJson,
      expires_at: expiresAt,
    };
    await createInternalArtifactObject(repository, {
      id: pendingBundle.internal_artifact_object_id,
      artifact_id: pendingBundle.bundle_id,
      ref: pendingBundle.pending_artifact_ref,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: run.id,
      size_bytes: pendingBundle.size_bytes,
      digest: pendingBundle.archive_digest,
      metadata_json: {
        manifest_digest: pendingBundle.manifest_digest,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
      },
    });
    const pendingBundleRecord = {
      ...pendingBundle,
      id: '55555555-5555-4555-8555-555555555554',
      run_session_id: run.id,
      execution_package_id: run.execution_package_id,
      request_digest: tokenHash('pending-workspace-request-object-drift'),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingBundleRecord);
    const input = await runtimeJobInput(
      repository,
      {
        runtime_job_id: 'runtime-job-run-execution-object-drift',
        launch_lease_id: 'runtime-launch-lease-run-execution-object-drift',
        envelope_id: 'runtime-envelope-run-execution-object-drift',
        job_request_id: 'runtime-job-request-run-execution-object-drift',
        target: generationTarget({
          target_type: 'run_session',
          target_kind: 'run_execution',
          target_id: run.id,
        }),
        action_type: undefined,
        action_attempt: undefined,
        action_claim_token_hash: undefined,
        precondition_fingerprint: undefined,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
        run_worker_lease_token_hash: tokenHash('run-worker-token-object-drift'),
        run_session_status: 'running',
        run_session_updated_at: now,
        execution_package_version: 1,
        input_json: { task: 'run package', public_ref: 'artifact://runtime/run-input-object-drift' },
        input_digest: tokenHash('runtime-run-input-object-drift'),
        workspace_acquisition_json: pendingBundle.workspace_acquisition_json,
        workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
        pending_workspace_bundle: pendingBundleRecord,
      },
      { capabilities: ['run_execution'] },
    );
    await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
    await acceptRuntimeJob(repository, input.runtime_job_id, {
      nonce: 'accept-nonce-runtime-job-run-execution-object-drift',
      idempotency_key: 'accept-runtime-job-run-execution-object-drift',
      request_digest: tokenHash('accept-request-runtime-job-run-execution-object-drift'),
    });
    for (const [artifactId, artifact] of runtimeJobArtifactBindings(repository)) {
      if (artifact.kind === 'workspace_bundle') {
        runtimeJobArtifactBindings(repository).set(artifactId, {
          ...artifact,
          internal_artifact_object_id: '55555555-5555-4555-8555-000000000000',
        });
      }
    }

    await expect(
      repository.getWorkspaceBundleDownloadForRuntimeJob({
        runtime_job_id: input.runtime_job_id,
        bundle_id: pendingBundle.bundle_id,
        worker_id: input.worker_id,
        worker_session_token: 'session-token-1',
        nonce: 'download-nonce-object-drift',
        nonce_timestamp: later,
        replay_protection: {
          method: 'GET',
          path: `/codex/runtime-jobs/${input.runtime_job_id}/workspace-bundles/${pendingBundle.bundle_id}`,
          body_digest: tokenHash('download-object-drift'),
        },
        now: later,
      }),
    ).rejects.toThrow(/Runtime job workspace bundle download was denied/);
  });

  it('requires run-execution runtime jobs to carry strong run-worker fences', async () => {
    const repository = createRepository(createEnvelopeSealer());
    const run = runSession({
      id: 'runtime-run-session-missing-fence',
      execution_package_id: 'runtime-execution-package-missing-fence',
    });
    await repository.saveExecutionPackage(executionPackage({ id: run.execution_package_id }));
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-missing-fence',
      lease_token: 'run-worker-token-missing-fence',
      now,
      expires_at: expiresAt,
    });
    const target = generationTarget({
      target_type: 'run_session',
      target_kind: 'run_execution',
      target_id: run.id,
    });
    const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: 'pending-bundle-missing-fence' });
    const archiveBytes = archiveFixture.archive;
    const workspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'pending-bundle-missing-fence',
      archive_ref: 'artifact://internal/workspace_bundle/run_session/runtime-run-session-missing-fence/pending-bundle-missing-fence',
      archive_digest: archiveFixture.archive_digest,
      manifest_digest: archiveFixture.manifest_digest,
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingBundle = {
      bundle_id: 'pending-bundle-missing-fence',
      pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
      internal_artifact_object_id: '33333333-3333-4333-8333-333333333334',
      archive_digest: workspaceAcquisitionJson.archive_digest,
      manifest_digest: workspaceAcquisitionJson.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: archiveBytes.byteLength,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
      workspace_acquisition_json: workspaceAcquisitionJson,
      expires_at: expiresAt,
    };
    await createInternalArtifactObject(repository, {
      id: pendingBundle.internal_artifact_object_id,
      artifact_id: pendingBundle.bundle_id,
      ref: pendingBundle.pending_artifact_ref,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: run.id,
      size_bytes: pendingBundle.size_bytes,
      digest: pendingBundle.archive_digest,
      metadata_json: {
        manifest_digest: pendingBundle.manifest_digest,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
      },
    });
    const pendingBundleRecord = {
      ...pendingBundle,
      id: '33333333-3333-4333-8333-333333333333',
      run_session_id: run.id,
      execution_package_id: run.execution_package_id,
      request_digest: tokenHash('pending-workspace-request-missing-fence'),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingBundleRecord);
    const input = await runtimeJobInput(
      repository,
      {
        runtime_job_id: 'runtime-job-run-execution-missing-fence',
        launch_lease_id: 'runtime-launch-lease-run-execution-missing-fence',
        envelope_id: 'runtime-envelope-run-execution-missing-fence',
        job_request_id: 'runtime-job-request-run-execution-missing-fence',
        target,
        action_type: undefined,
        action_attempt: undefined,
        action_claim_token_hash: undefined,
        precondition_fingerprint: undefined,
        execution_package_id: run.execution_package_id,
        run_worker_lease_id: runWorkerLease.id,
        run_worker_lease_token_hash: undefined,
        run_session_status: 'running',
        run_session_updated_at: now,
        execution_package_version: 1,
        workspace_acquisition_json: pendingBundle.workspace_acquisition_json,
        workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
        pending_workspace_bundle: pendingBundleRecord,
      },
      { capabilities: ['run_execution'] },
    );

    await expect(repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      name: 'DomainError',
      code: 'codex_runtime_job_unavailable',
    });
  });

  it('replays launch leases idempotently for the same lease_request_id', async () => {
    const repository = createRepository();
    const first = await createLaunchLease(repository);
    expect(first.status).toBe('active');
    const { revision } = profileRevision();
    const { binding, version } = credential();
    const second = await repository.createOrReplayCodexLaunchLease({
      id: 'launch-lease-1',
      lease_request_id: 'lease-request-1',
      target: generationTarget(),
      worker_id: 'worker-1',
      runtime_profile_revision_id: revision.id,
      runtime_profile_digest: revision.profile_digest,
      credential_binding_id: binding.id,
      credential_binding_version_id: version.id,
      credential_payload_digest: version.payload_digest,
      docker_image_digest: revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(revision.network_policy),
      network_provider_config_digest: dockerProxyConfig().provider_config_digest,
      launch_token: 'launch-token-1',
      launch_attempt: 1,
      action_type: 'codex_generation',
      action_attempt: 1,
      action_claim_token_hash: tokenHash('action-claim-token-1'),
      precondition_fingerprint: 'precondition-1',
      expires_at: expiresAt,
      now,
    });
    expect(second).toEqual(first);

    await expect(
      repository.createOrReplayCodexLaunchLease({
        id: 'launch-lease-duplicate-attempt',
        lease_request_id: 'lease-request-duplicate-attempt',
        target: generationTarget(),
        worker_id: 'worker-1',
        runtime_profile_revision_id: revision.id,
        runtime_profile_digest: revision.profile_digest,
        credential_binding_id: binding.id,
        credential_binding_version_id: version.id,
        credential_payload_digest: version.payload_digest,
        docker_image_digest: revision.docker_image_digest,
        network_policy_digest: codexCanonicalDigest(revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        launch_token: 'launch-token-duplicate-attempt',
        launch_attempt: 1,
        action_type: 'codex_generation',
        action_attempt: 1,
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
        expires_at: expiresAt,
        now,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });
  });

  it('rejects target kind mismatches', async () => {
    const repository = createRepository();
    const target = generationTarget({ target_kind: 'run_execution' });

    expect(() => validateCodexLaunchTargetKind(target.target_type, target.target_kind)).toThrow(DomainError);
    await expect(createLaunchLease(repository, { target })).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_runtime_profile_invalid',
    });
  });

  it('materializes raw auth exactly once', async () => {
    const repository = createRepository();
    const lease = await createLaunchLease(repository);

    const materialized = await repository.materializeCodexLaunchLease({
      lease_id: lease.id,
      worker_id: 'worker-1',
      launch_token: lease.lease_token,
      worker_session_token: 'session-token-1',
      nonce: 'materialize-nonce-1',
      nonce_timestamp: later,
      materialization_request_hash: tokenHash('materialize-request-1'),
      active_fence: {
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
      },
      now: later,
    });

    expect(materialized.resolved_credentials).toEqual([
      {
        binding_id: 'credential-binding-1',
        binding_version_id: 'credential-version-1',
        payload: credential().secretPayload,
        payload_digest: codexCredentialPayloadDigest(credential().secretPayload),
      },
    ]);

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-1',
        launch_token: lease.lease_token,
        worker_session_token: 'session-token-1',
        nonce: 'materialize-nonce-2',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('materialize-request-2'),
        active_fence: {
          action_claim_token_hash: tokenHash('action-claim-token-1'),
          precondition_fingerprint: 'precondition-1',
        },
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
  });

  it('rejects launch leases whose credential binding does not belong to the selected profile', async () => {
    const repository = createRepository();
    const selected = await seedProfileAndCredential(repository);
    const other = profileRevision({
      id: 'runtime-profile-revision-other-credential',
      profile_id: 'runtime-profile-other-credential',
    });
    await repository.createCodexRuntimeProfileWithRevision(other);
    const otherCredential = credential(
      {
        id: 'credential-binding-other-profile',
        profile_id: other.profile.id,
      },
      { id: 'credential-version-other-profile' },
    );
    await repository.createCodexCredentialBindingWithVersion({
      binding: otherCredential.binding,
      version: otherCredential.version,
      secret_payload_json: otherCredential.secretPayload,
    });
    const { worker } = await seedWorker(repository);

    await expect(
      repository.createOrReplayCodexLaunchLease({
        id: 'launch-lease-profile-mismatch',
        lease_request_id: 'lease-request-profile-mismatch',
        target: generationTarget(),
        worker_id: worker.id,
        runtime_profile_revision_id: selected.revision.id,
        runtime_profile_digest: selected.revision.profile_digest,
        credential_binding_id: otherCredential.binding.id,
        credential_binding_version_id: otherCredential.version.id,
        credential_payload_digest: otherCredential.version.payload_digest,
        docker_image_digest: selected.revision.docker_image_digest,
        network_policy_digest: codexCanonicalDigest(selected.revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        launch_token: 'launch-token-profile-mismatch',
        launch_attempt: 1,
        action_type: 'codex_generation',
        action_attempt: 1,
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
        expires_at: expiresAt,
        now,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });
  });

  it('rejects materialization when the bound worker session expired or capabilities no longer match', async () => {
    const repository = createRepository();
    const expiredLease = await createLaunchLease(repository, {}, { session_token: 'expired-session-token' });

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: expiredLease.id,
        worker_id: 'worker-1',
        launch_token: expiredLease.lease_token,
        worker_session_token: 'expired-session-token',
        nonce: 'materialize-expired-session-nonce',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('materialize-expired-session-request'),
        active_fence: {
          action_claim_token_hash: tokenHash('action-claim-token-1'),
          precondition_fingerprint: 'precondition-1',
        },
        now: '2026-05-20T00:11:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });

    const repositoryWithDowngradedWorker = createRepository();
    const downgradedLease = await createLaunchLease(repositoryWithDowngradedWorker);
    await repositoryWithDowngradedWorker.heartbeatCodexWorker({
      worker_id: 'worker-1',
      session_token: 'session-token-1',
      nonce: 'downgrade-before-materialize-nonce',
      nonce_timestamp: later,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 1,
      capabilities: [],
      now: later,
    });

    await expect(
      repositoryWithDowngradedWorker.materializeCodexLaunchLease({
        lease_id: downgradedLease.id,
        worker_id: 'worker-1',
        launch_token: downgradedLease.lease_token,
        worker_session_token: 'session-token-1',
        nonce: 'materialize-downgraded-worker-nonce',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('materialize-downgraded-worker-request'),
        active_fence: {
          action_claim_token_hash: tokenHash('action-claim-token-1'),
          precondition_fingerprint: 'precondition-1',
        },
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
  });

  it('rejects launch lease request replay after materialization', async () => {
    const repository = createRepository();
    const lease = await createLaunchLease(repository);
    const { revision } = profileRevision();
    const { binding, version } = credential();

    await repository.materializeCodexLaunchLease({
      lease_id: lease.id,
      worker_id: 'worker-1',
      launch_token: lease.lease_token,
      worker_session_token: 'session-token-1',
      nonce: 'materialize-before-replay-nonce',
      nonce_timestamp: later,
      materialization_request_hash: tokenHash('materialize-before-replay-request'),
      active_fence: {
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
      },
      now: later,
    });

    await expect(
      repository.createOrReplayCodexLaunchLease({
        id: 'launch-lease-1',
        lease_request_id: 'lease-request-1',
        target: generationTarget(),
        worker_id: 'worker-1',
        runtime_profile_revision_id: revision.id,
        runtime_profile_digest: revision.profile_digest,
        credential_binding_id: binding.id,
        credential_binding_version_id: version.id,
        credential_payload_digest: version.payload_digest,
        docker_image_digest: revision.docker_image_digest,
        network_policy_digest: codexCanonicalDigest(revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        launch_token: 'launch-token-1',
        launch_attempt: 1,
        action_type: 'codex_generation',
        action_attempt: 1,
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
        expires_at: expiresAt,
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });
  });

  it('does not stale-recover a materialized lease after worker terminalization', async () => {
    const repository = createRepository();
    const lease = await createLaunchLease(repository);

    await repository.materializeCodexLaunchLease({
      lease_id: lease.id,
      worker_id: 'worker-1',
      launch_token: lease.lease_token,
      worker_session_token: 'session-token-1',
      nonce: 'materialize-before-terminal-nonce',
      nonce_timestamp: later,
      materialization_request_hash: tokenHash('materialize-before-terminal-request'),
      active_fence: {
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
      },
      now: later,
    });
    await expect(
      repository.terminalizeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'terminalize-materialized-nonce',
        nonce_timestamp: later,
        terminal_status: 'terminal',
        reason_code: 'completed_after_materialization',
        idempotency_key: 'terminalize-materialized',
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'terminal' });

    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: later,
        now: later,
        reason_code: 'worker_stale_after_completion',
      }),
    ).resolves.toMatchObject({ recovered_launch_leases: [], automation_action_transitions: [], run_session_transitions: [] });
  });

  it('rejects materialization when profile or credential digests drift from the lease fence', async () => {
    const repository = createRepository();
    const lease = await createLaunchLease(repository);
    const changedPayload = { env: { OPENAI_API_KEY: 'sk-replaced-key' } };

    await expect(
      repository.createCodexCredentialBindingWithVersion({
        binding: credential().binding,
        version: {
          ...credential().version,
          payload_digest: codexCredentialPayloadDigest(changedPayload),
        },
        secret_payload_json: changedPayload,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
    });

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-1',
        launch_token: lease.lease_token,
        worker_session_token: 'session-token-1',
        nonce: 'materialize-digest-fence-nonce',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('materialize-digest-fence-request'),
        active_fence: {
          action_claim_token_hash: tokenHash('action-claim-token-1'),
          precondition_fingerprint: 'precondition-1',
        },
        now: later,
      }),
    ).resolves.toMatchObject({
      resolved_credentials: [{ payload: credential().secretPayload, payload_digest: credential().version.payload_digest }],
    });
  });

  it('releases worker capacity when a leased launch is terminalized', async () => {
    const repository = createRepository();
    const first = await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await expect(
      repository.terminalizeCodexLaunchLease({
        lease_id: first.id,
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'terminalize-release-capacity-nonce',
        nonce_timestamp: later,
        terminal_status: 'terminal',
        reason_code: 'completed_without_materialization',
        idempotency_key: 'terminalize-release-capacity',
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'terminal' });

    const secondLeaseInput = {
      id: 'launch-lease-2',
      lease_request_id: 'lease-request-2',
      target: generationTarget({ target_id: 'generation-2' }),
      worker_id: 'worker-1',
      runtime_profile_revision_id: seeded.revision.id,
      runtime_profile_digest: seeded.revision.profile_digest,
      credential_binding_id: seeded.binding.id,
      credential_binding_version_id: seeded.version.id,
      credential_payload_digest: seeded.version.payload_digest,
      docker_image_digest: seeded.revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
      network_provider_config_digest: dockerProxyConfig().provider_config_digest,
      launch_token: 'launch-token-2',
      launch_attempt: 1,
      expires_at: expiresAt,
      now: later,
    };

    await expect(repository.createOrReplayCodexLaunchLease(secondLeaseInput)).resolves.toMatchObject({
      id: 'launch-lease-2',
      worker_id: 'worker-1',
    });
  });

  it('persists terminal evidence and replays terminal idempotency keys', async () => {
    const repository = createRepository();
    const first = await createLaunchLease(repository, {}, { max_concurrency: 1 });

    await expect(
      repository.terminalizeCodexLaunchLease({
        lease_id: first.id,
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'terminalize-evidence-nonce',
        nonce_timestamp: later,
        terminal_status: 'terminal',
        reason_code: 'completed_with_evidence',
        evidence_summary: { cleanup: 'ok', docker_policy_digest: `sha256:${'1'.repeat(64)}` },
        runtime_job_id: 'runtime-job-1',
        idempotency_key: 'terminalize-evidence',
        now: later,
      }),
    ).resolves.toMatchObject({
      status: 'terminal',
      terminal_reason_code: 'completed_with_evidence',
      terminal_evidence_summary: { cleanup: 'ok', docker_policy_digest: `sha256:${'1'.repeat(64)}` },
      terminal_runtime_job_id: 'runtime-job-1',
      terminal_idempotency_key: 'terminalize-evidence',
    });

    await expect(
      repository.terminalizeCodexLaunchLease({
        lease_id: first.id,
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'terminalize-evidence-replay-nonce',
        nonce_timestamp: later,
        terminal_status: 'terminal',
        reason_code: 'completed_with_evidence',
        evidence_summary: { cleanup: 'ok', docker_policy_digest: `sha256:${'1'.repeat(64)}` },
        runtime_job_id: 'runtime-job-1',
        idempotency_key: 'terminalize-evidence',
        now: later,
      }),
    ).resolves.toMatchObject({
      status: 'terminal',
      terminal_evidence_summary: { cleanup: 'ok', docker_policy_digest: `sha256:${'1'.repeat(64)}` },
      terminal_runtime_job_id: 'runtime-job-1',
      terminal_idempotency_key: 'terminalize-evidence',
    });

    await expect(
      repository.terminalizeCodexLaunchLease({
        lease_id: first.id,
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'terminalize-evidence-conflict-nonce',
        nonce_timestamp: later,
        terminal_status: 'terminal',
        reason_code: 'conflicting_terminal',
        idempotency_key: 'terminalize-evidence-conflict',
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });
  });

  it('keeps worker capacity occupied after materialization until terminalization', async () => {
    const repository = createRepository();
    const first = await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await repository.materializeCodexLaunchLease({
      lease_id: first.id,
      worker_id: 'worker-1',
      launch_token: first.lease_token,
      worker_session_token: 'session-token-1',
      nonce: 'materialize-capacity-held-nonce',
      nonce_timestamp: later,
      materialization_request_hash: tokenHash('materialize-capacity-held-request'),
      active_fence: {
        action_claim_token_hash: tokenHash('action-claim-token-1'),
        precondition_fingerprint: 'precondition-1',
      },
      now: later,
    });

    const secondLeaseInput = {
      id: 'launch-lease-2',
      lease_request_id: 'lease-request-2',
      target: generationTarget({ target_id: 'generation-2' }),
      worker_id: 'worker-1',
      runtime_profile_revision_id: seeded.revision.id,
      runtime_profile_digest: seeded.revision.profile_digest,
      credential_binding_id: seeded.binding.id,
      credential_binding_version_id: seeded.version.id,
      credential_payload_digest: seeded.version.payload_digest,
      docker_image_digest: seeded.revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
      network_provider_config_digest: dockerProxyConfig().provider_config_digest,
      launch_token: 'launch-token-2',
      launch_attempt: 1,
      expires_at: expiresAt,
      now: later,
    };

    await expect(repository.createOrReplayCodexLaunchLease(secondLeaseInput)).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });

    await repository.terminalizeCodexLaunchLease({
      lease_id: first.id,
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'terminalize-capacity-held-nonce',
      nonce_timestamp: later,
      terminal_status: 'terminal',
      reason_code: 'completed_after_materialization',
      idempotency_key: 'terminalize-capacity-held',
      now: later,
    });

    await expect(repository.createOrReplayCodexLaunchLease(secondLeaseInput)).resolves.toMatchObject({
      id: 'launch-lease-2',
      worker_id: 'worker-1',
    });
  });

  it('does not let heartbeat under-reporting free an occupied worker slot', async () => {
    const repository = createRepository();
    await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await repository.heartbeatCodexWorker({
      worker_id: 'worker-1',
      session_token: 'session-token-1',
      nonce: 'heartbeat-underreported-lease-count-nonce',
      nonce_timestamp: later,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: later,
    });

    await expect(
      repository.createOrReplayCodexLaunchLease({
        id: 'launch-lease-2',
        lease_request_id: 'lease-request-2',
        target: generationTarget({ target_id: 'generation-2' }),
        worker_id: 'worker-1',
        runtime_profile_revision_id: seeded.revision.id,
        runtime_profile_digest: seeded.revision.profile_digest,
        credential_binding_id: seeded.binding.id,
        credential_binding_version_id: seeded.version.id,
        credential_payload_digest: seeded.version.payload_digest,
        docker_image_digest: seeded.revision.docker_image_digest,
        network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
        network_provider_config_digest: dockerProxyConfig().provider_config_digest,
        launch_token: 'launch-token-2',
        launch_attempt: 1,
        expires_at: expiresAt,
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });
  });

  it('releases worker capacity when a leased launch is revoked', async () => {
    const repository = createRepository();
    const first = await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await expect(
      repository.revokeCodexLaunchLease({
        lease_id: first.id,
        reason_code: 'revoked_by_controller',
        idempotency_key: 'revoke-release-capacity',
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'revoked' });
    await expect(
      repository.revokeCodexLaunchLease({
        lease_id: first.id,
        reason_code: 'revoked_by_controller',
        idempotency_key: 'revoke-release-capacity-replay',
        now: later,
      }),
    ).resolves.toMatchObject({ status: 'revoked' });

    const secondLeaseInput = {
      id: 'launch-lease-2',
      lease_request_id: 'lease-request-2',
      target: generationTarget({ target_id: 'generation-2' }),
      worker_id: 'worker-1',
      runtime_profile_revision_id: seeded.revision.id,
      runtime_profile_digest: seeded.revision.profile_digest,
      credential_binding_id: seeded.binding.id,
      credential_binding_version_id: seeded.version.id,
      credential_payload_digest: seeded.version.payload_digest,
      docker_image_digest: seeded.revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
      network_provider_config_digest: dockerProxyConfig().provider_config_digest,
      launch_token: 'launch-token-2',
      launch_attempt: 1,
      expires_at: expiresAt,
      now: later,
    };

    await expect(repository.createOrReplayCodexLaunchLease(secondLeaseInput)).resolves.toMatchObject({
      id: 'launch-lease-2',
      worker_id: 'worker-1',
    });
  });

  it('releases worker capacity when a leased launch expires', async () => {
    const repository = createRepository();
    await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await expect(repository.expireCodexLaunchLeases('2026-05-20T00:11:00.000Z')).resolves.toBe(1);
    await expect(repository.expireCodexLaunchLeases('2026-05-20T00:11:00.000Z')).resolves.toBe(0);

    const secondLeaseInput = {
      id: 'launch-lease-2',
      lease_request_id: 'lease-request-2',
      target: generationTarget({ target_id: 'generation-2' }),
      worker_id: 'worker-1',
      runtime_profile_revision_id: seeded.revision.id,
      runtime_profile_digest: seeded.revision.profile_digest,
      credential_binding_id: seeded.binding.id,
      credential_binding_version_id: seeded.version.id,
      credential_payload_digest: seeded.version.payload_digest,
      docker_image_digest: seeded.revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
      network_provider_config_digest: dockerProxyConfig().provider_config_digest,
      launch_token: 'launch-token-2',
      launch_attempt: 1,
      expires_at: expiresAt,
      now: later,
    };

    await expect(repository.createOrReplayCodexLaunchLease(secondLeaseInput)).resolves.toMatchObject({
      id: 'launch-lease-2',
      worker_id: 'worker-1',
    });
  });

  it('stalls owning run sessions when stale worker recovery expires run-execution leases', async () => {
    const repository = createRepository();
    const run = runSession({
      id: 'run-session-stale-codex',
      execution_package_id: 'execution-package-stale-codex',
      runtime_metadata: {
        ...runtimeMetadata,
        driver_status: 'running',
        worker_lease_status: 'active',
      },
    });
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-1',
      lease_token: 'run-worker-token-1',
      now,
      expires_at: expiresAt,
    });

    await createLaunchLease(repository, {
      id: 'launch-lease-run-execution',
      lease_request_id: 'lease-request-run-execution',
      target: generationTarget({
        target_type: 'run_session',
        target_kind: 'run_execution',
        target_id: run.id,
      }),
      action_type: undefined,
      action_attempt: undefined,
      action_claim_token_hash: undefined,
      precondition_fingerprint: undefined,
      execution_package_id: run.execution_package_id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token_hash: tokenHash('run-worker-token-1'),
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_version: 1,
    });

    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: later,
        now: later,
        reason_code: 'codex_worker_stale_run_execution',
      }),
    ).resolves.toMatchObject({
      recovered_launch_leases: [{ id: 'launch-lease-run-execution', status: 'expired' }],
      run_session_transitions: [
        {
          run_session_id: run.id,
          execution_package_id: run.execution_package_id,
          reason_code: 'codex_worker_stale_run_execution',
        },
      ],
    });
    await expect(repository.getRunSession(run.id)).resolves.toMatchObject({
      id: run.id,
      status: 'stalled',
      failure_kind: 'executor_error',
      failure_reason: 'codex_worker_stale_run_execution',
      runtime_metadata: expect.objectContaining({
        driver_status: 'stalled',
        worker_lease_status: 'expired',
      }),
    });

    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: later,
        now: later,
        reason_code: 'codex_worker_stale_run_execution',
      }),
    ).resolves.toMatchObject({ recovered_launch_leases: [], automation_action_transitions: [], run_session_transitions: [] });
  });

  it('moves owning generation actions to gate pending even when launch lease action_type is absent', async () => {
    const repository = createRepository();
    const action = await claimGenerationAction(repository);

    await createLaunchLease(repository, {
      target: generationTarget({ target_id: action.id }),
      action_type: undefined,
      action_claim_token_hash: tokenHash('generation-action-claim-1'),
    });

    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: later,
        now: later,
        reason_code: 'codex_worker_stale_generation',
      }),
    ).resolves.toMatchObject({
      recovered_launch_leases: [{ id: 'launch-lease-1', status: 'expired' }],
      automation_action_transitions: [
        {
          target_id: action.id,
          reason_code: 'codex_worker_stale_generation',
        },
      ],
    });

    await expect(
      repository.claimNextAutomationActionRun({
        now: later,
        claim_token: 'generation-action-claim-2',
        locked_until: expiresAt,
        limit: 1,
        action_type: action.action_type,
      }),
    ).resolves.toMatchObject({
      id: action.id,
      status: 'running',
      attempt: 2,
    });
  });

  it('releases worker capacity when stale worker lease recovery expires a lease', async () => {
    const repository = createRepository();
    await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: later,
        now: later,
        reason_code: 'worker_stale',
      }),
    ).resolves.toMatchObject({ recovered_launch_leases: [{ id: 'launch-lease-1', status: 'expired' }] });
    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: later,
        now: later,
        reason_code: 'worker_stale',
      }),
    ).resolves.toMatchObject({ recovered_launch_leases: [] });

    const secondLeaseInput = {
      id: 'launch-lease-2',
      lease_request_id: 'lease-request-2',
      target: generationTarget({ target_id: 'generation-2' }),
      worker_id: 'worker-1',
      runtime_profile_revision_id: seeded.revision.id,
      runtime_profile_digest: seeded.revision.profile_digest,
      credential_binding_id: seeded.binding.id,
      credential_binding_version_id: seeded.version.id,
      credential_payload_digest: seeded.version.payload_digest,
      docker_image_digest: seeded.revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(seeded.revision.network_policy),
      network_provider_config_digest: dockerProxyConfig().provider_config_digest,
      launch_token: 'launch-token-2',
      launch_attempt: 1,
      expires_at: expiresAt,
      now: later,
    };

    await expect(repository.createOrReplayCodexLaunchLease(secondLeaseInput)).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_lease_denied',
    });

    await repository.heartbeatCodexWorker({
      worker_id: 'worker-1',
      session_token: 'session-token-1',
      nonce: 'heartbeat-after-stale-recovery',
      nonce_timestamp: later,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: later,
    });

    await expect(repository.createOrReplayCodexLaunchLease(secondLeaseInput)).resolves.toMatchObject({
      id: 'launch-lease-2',
      worker_id: 'worker-1',
    });
  });

  it('does not let a late terminal report undo stale recovery expiration', async () => {
    const repository = createRepository();
    await createLaunchLease(repository);

    await repository.recoverStaleCodexWorkerLeases({
      stale_before: later,
      now: later,
      reason_code: 'worker_stale_before_terminal',
    });

    await expect(
      repository.terminalizeCodexLaunchLease({
        lease_id: 'launch-lease-1',
        worker_id: 'worker-1',
        worker_session_token: 'session-token-1',
        nonce: 'late-terminal-after-recovery-nonce',
        nonce_timestamp: later,
        terminal_status: 'terminal',
        reason_code: 'late_success_after_recovery',
        idempotency_key: 'late-terminal-after-recovery',
        now: later,
      }),
    ).resolves.toMatchObject({
      id: 'launch-lease-1',
      status: 'expired',
    });

    await expect(
      repository.recoverStaleCodexWorkerLeases({
        stale_before: later,
        now: later,
        reason_code: 'worker_stale_before_terminal',
      }),
    ).resolves.toMatchObject({ recovered_launch_leases: [], automation_action_transitions: [], run_session_transitions: [] });
  });

  it('rejects materialization by the wrong worker', async () => {
    const repository = createRepository();
    const lease = await createLaunchLease(repository);

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-2',
        launch_token: lease.lease_token,
        worker_session_token: 'session-token-1',
        nonce: 'wrong-worker-nonce',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('wrong-worker-request'),
        active_fence: {
          action_claim_token_hash: tokenHash('action-claim-token-1'),
          precondition_fingerprint: 'precondition-1',
        },
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
  });

  it('rejects stale automation action claim fences', async () => {
    const repository = createRepository();
    const lease = await createLaunchLease(repository);

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-1',
        launch_token: lease.lease_token,
        worker_session_token: 'session-token-1',
        nonce: 'stale-action-fence-nonce',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('stale-action-fence-request'),
        active_fence: {
          action_claim_token_hash: tokenHash('stale-action-token'),
          precondition_fingerprint: 'precondition-1',
        },
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
  });

  it('rejects stale run-worker lease fences', async () => {
    const repository = createRepository();
    const lease = await createLaunchLease(repository, {
      target: generationTarget({
        target_type: 'run_session',
        target_kind: 'run_execution',
        target_id: 'run-session-1',
      }),
      run_worker_lease_id: 'run-worker-lease-1',
      run_worker_lease_token_hash: tokenHash('run-worker-token-1'),
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_id: 'execution-package-1',
      execution_package_version: 1,
    });

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-1',
        launch_token: lease.lease_token,
        worker_session_token: 'session-token-1',
        nonce: 'stale-run-worker-fence-nonce',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('stale-run-worker-fence-request'),
        active_fence: {
          run_worker_lease_id: 'run-worker-lease-1',
          run_worker_lease_token_hash: tokenHash('stale-run-worker-token'),
          run_session_status: 'running',
          run_session_updated_at: now,
        },
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
  });

  it('rejects run-execution materialization when target scope does not match the execution package', async () => {
    const repository = createRepository();
    const packageRecord = executionPackage({ project_id: 'project-cross-scope' });
    const run = runSession({ execution_package_id: packageRecord.id });
    await repository.saveExecutionPackage(packageRecord);
    await repository.saveRunSession(run);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: run.id,
      worker_id: 'run-worker-1',
      lease_token: 'run-worker-token-1',
      now,
      expires_at: expiresAt,
    });
    const lease = await createLaunchLease(repository, {
      target: generationTarget({
        target_type: 'run_session',
        target_kind: 'run_execution',
        target_id: run.id,
      }),
      action_type: undefined,
      action_attempt: undefined,
      action_claim_token_hash: undefined,
      precondition_fingerprint: undefined,
      execution_package_id: packageRecord.id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token_hash: tokenHash('run-worker-token-1'),
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_version: 1,
    });

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-1',
        launch_token: lease.lease_token,
        worker_session_token: 'session-token-1',
        nonce: 'cross-scope-run-fence-nonce',
        nonce_timestamp: later,
        materialization_request_hash: tokenHash('cross-scope-run-fence-request'),
        active_fence: {
          run_worker_lease_id: runWorkerLease.id,
          run_worker_lease_token_hash: tokenHash('run-worker-token-1'),
          run_session_status: 'running',
          run_session_updated_at: now,
        },
        now: later,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'codex_launch_materialization_denied',
    });
  });
});
