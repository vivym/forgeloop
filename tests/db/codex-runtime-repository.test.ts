import { describe, expect, it } from 'vitest';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeProfileRevisionDigest,
  DomainError,
  validateCodexLaunchTargetKind,
  type CodexCredentialBinding,
  type CodexCredentialBindingVersion,
  type CodexDockerNetworkProxyConfig,
  type ExecutionPackage,
  type CodexLaunchLeaseWithToken,
  type CodexLaunchTarget,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type RunSession,
} from '../../packages/domain/src/index';

import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-20T00:00:00.000Z';
const later = '2026-05-20T00:01:00.000Z';
const expiresAt = '2026-05-20T00:10:00.000Z';

const createRepository = (): DeliveryRepository => new InMemoryDeliveryRepository();
const runtimeMetadata = {
  durability_mode: 'durable',
  recovery_attempt_count: 0,
  effective_dangerous_mode: 'confirmed',
} as const;

const tokenHash = (token: string) => codexCredentialPayloadDigest(token);

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
      overrides.network_policy ?? {
        mode: 'docker_network_proxy',
        egress: 'allowlist',
        allowlist: [
          {
            id: 'openai',
            protocol: 'https',
            host: 'api.openai.com',
            purpose: 'model_provider',
          },
        ],
        provider_config: dockerProxyConfig(),
      },
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
  gate_state: overrides.gate_state ?? 'none',
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

const seedWorker = async (
  repository: DeliveryRepository,
  overrides: {
    worker_id?: string;
    session_token?: string;
    capabilities?: readonly CodexLaunchTarget['target_kind'][];
    max_concurrency?: number;
  } = {},
) => {
  const workerId = overrides.worker_id ?? 'worker-1';
  const sessionToken = overrides.session_token ?? 'session-token-1';
  const capabilities = overrides.capabilities ?? ['generation'];
  await repository.createCodexWorkerBootstrapToken({
    id: 'bootstrap-token-1',
    worker_identity: 'local-worker-1',
    bootstrap_token_hash: tokenHash('bootstrap-token-raw'),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: [{ project_id: 'project-1', repo_id: 'repo-1' }],
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
      worker_identity: 'local-worker-1',
      version: '0.1.0',
      bootstrap_token_hash: tokenHash('bootstrap-token-raw'),
      bootstrap_token_version: 1,
      session_token: sessionToken,
      session_expires_at: expiresAt,
      status: 'online',
      control_channel_status: 'connected',
      allowed_scopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities,
      docker_image_digests: [`sha256:${'a'.repeat(64)}`],
      network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
      network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
      host_worker_uid: 501,
      host_worker_gid: 20,
      lease_count: 0,
      max_concurrency: overrides.max_concurrency ?? 2,
      labels: { host: 'test-host' },
      session_public_key_id: 'session-key-1',
      session_public_key_algorithm: 'x25519',
      session_public_key_material: 'public-key-material',
      session_public_key_expires_at: expiresAt,
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
      blocker_codes: [],
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
    await expect(repository.createCodexWorkerBootstrapToken(input)).resolves.toMatchObject({
      id: input.id,
      token_hash: input.bootstrap_token_hash,
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
