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
  type CodexLaunchLeaseWithToken,
  type CodexLaunchTarget,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src/index';

import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-20T00:00:00.000Z';
const later = '2026-05-20T00:01:00.000Z';
const expiresAt = '2026-05-20T00:10:00.000Z';

const createRepository = (): DeliveryRepository => new InMemoryDeliveryRepository();

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
            source_access_mode: 'artifact_only',
            source_workspace_write_policy: 'none',
          }
        : {
            target_kind: 'run_execution',
            approval_policy: 'never',
            sandbox_mode: 'workspace-write',
            writable_workspace: 'task',
            source_workspace_write_policy: 'path_policy_scoped',
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
    provider: overrides.provider ?? 'openai',
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
  target_type: overrides.target_type ?? 'generation_request',
  target_id: overrides.target_id ?? 'generation-1',
  target_kind: overrides.target_kind ?? 'generation',
  project_id: overrides.project_id ?? 'project-1',
  repo_id: overrides.repo_id ?? 'repo-1',
});

const seedProfileAndCredential = async (repository: DeliveryRepository, targetKind: CodexLaunchTarget['target_kind'] = 'generation') => {
  const { profile, revision } = profileRevision({ target_kind: targetKind });
  const { binding, version, secretPayload } = credential({ profile_id: profile.id });

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
      status: 'active',
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
  const { worker } = await seedWorker(repository, { capabilities: [target.target_kind], ...workerOverrides });

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
    action_type: 'codex_generation',
    action_attempt: 1,
    action_claim_token_hash: tokenHash('action-claim-token-1'),
    precondition_fingerprint: 'precondition-1',
    expires_at: expiresAt,
    now,
    ...overrides,
  });
};

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

  it('registers workers and heartbeat updates availability', async () => {
    const repository = createRepository();
    await seedProfileAndCredential(repository);
    const { worker, sessionToken } = await seedWorker(repository);

    const heartbeat = await repository.heartbeatCodexWorker({
      worker_id: worker.id,
      session_token: sessionToken,
      nonce: 'heartbeat-nonce-1',
      nonce_timestamp: later,
      status: 'active',
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
    ).resolves.toMatchObject({ id: worker.id, status: 'active' });
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
        status: 'active',
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
      status: 'active',
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
        project_id: 'project-1',
        repo_id: 'repo-1',
        required_payload_digest: version.payload_digest,
        now,
      }),
    ).resolves.toMatchObject({ payload: secretPayload, payload_digest: version.payload_digest });
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
        status: 'active',
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
        status: 'active',
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
        status: 'active',
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
      status: 'active' as const,
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
      action_type: 'codex_generation',
      action_attempt: 1,
      action_claim_token_hash: tokenHash('action-claim-token-1'),
      precondition_fingerprint: 'precondition-1',
      expires_at: expiresAt,
      now,
    });

    expect(second).toEqual(first);
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

    await repository.terminalizeCodexLaunchLease({
      lease_id: first.id,
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'terminalize-release-capacity-nonce',
      nonce_timestamp: later,
      terminal_status: 'released',
      reason_code: 'completed_without_materialization',
      idempotency_key: 'terminalize-release-capacity',
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
        expires_at: expiresAt,
        now: later,
      }),
    ).resolves.toMatchObject({ id: 'launch-lease-2', worker_id: 'worker-1' });
  });

  it('releases worker capacity when a leased launch is revoked', async () => {
    const repository = createRepository();
    const first = await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await repository.revokeCodexLaunchLease({
      lease_id: first.id,
      reason_code: 'revoked_by_controller',
      idempotency_key: 'revoke-release-capacity',
      now: later,
    });
    await repository.revokeCodexLaunchLease({
      lease_id: first.id,
      reason_code: 'revoked_by_controller',
      idempotency_key: 'revoke-release-capacity-replay',
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
        expires_at: expiresAt,
        now: later,
      }),
    ).resolves.toMatchObject({ id: 'launch-lease-2', worker_id: 'worker-1' });
  });

  it('releases worker capacity when a leased launch expires', async () => {
    const repository = createRepository();
    await createLaunchLease(repository, {}, { max_concurrency: 1 });
    const seeded = { revision: profileRevision().revision, binding: credential().binding, version: credential().version };

    await expect(repository.expireCodexLaunchLeases('2026-05-20T00:11:00.000Z')).resolves.toBe(1);
    await expect(repository.expireCodexLaunchLeases('2026-05-20T00:11:00.000Z')).resolves.toBe(0);

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
        expires_at: expiresAt,
        now: later,
      }),
    ).resolves.toMatchObject({ id: 'launch-lease-2', worker_id: 'worker-1' });
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
        expires_at: expiresAt,
        now: later,
      }),
    ).resolves.toMatchObject({ id: 'launch-lease-2', worker_id: 'worker-1' });
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
        target_type: 'execution_package',
        target_kind: 'run_execution',
        target_id: 'execution-package-1',
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
});
