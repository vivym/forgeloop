import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeProfileRevisionDigest,
  type CodexCredentialBinding,
  type CodexCredentialBindingVersion,
  type CodexDockerNetworkProxyConfig,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src/index';
import {
  automation_action_runs,
  codex_credential_bindings,
  assertResettableDatabaseUrl,
  codex_credential_binding_versions,
  codex_launch_leases,
  codex_launch_token_envelopes,
  codex_runtime_jobs,
  codex_runtime_profiles,
  codex_runtime_profile_revisions,
  codex_worker_registrations,
  createDbClient,
  DrizzleDeliveryRepository,
  resetForgeloopDatabase,
  type CodexLaunchTokenEnvelopeSealer,
  type CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  type CreateOrReplayCodexLaunchLeaseInput,
  type DeliveryRepository,
} from '../../packages/db/src/index';

const databaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL?.trim() || process.env.FORGELOOP_DATABASE_URL?.trim() || undefined;
const requireConcurrencyDb = process.env.FORGELOOP_REQUIRE_DB_CONCURRENCY === '1';
const now = '2026-05-20T00:00:00.000Z';
const later = '2026-05-20T00:01:00.000Z';
const expiresAt = '2026-05-20T00:10:00.000Z';

const tokenHash = (token: string) => codexCredentialPayloadDigest(token);

const createEnvelopeSealer = (
  calls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [],
): CodexLaunchTokenEnvelopeSealer => ({
  async sealLaunchTokenEnvelope(input) {
    calls.push(input);
    const aadJson = {
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
      worker_id: input.worker_id,
      key_id: input.key_id,
      expires_at: input.expires_at,
    };
    return {
      id: input.envelope_id,
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      worker_id: input.worker_id,
      key_id: input.key_id,
      algorithm: 'x25519-hkdf-sha256-aes-256-gcm',
      ciphertext: `sealed:${input.runtime_job_id}`,
      encryption_nonce: `nonce:${input.envelope_id}`,
      aad_json: aadJson,
      aad_digest: codexCanonicalDigest(aadJson),
      envelope_digest: tokenHash(`envelope:${input.runtime_job_id}:${input.launch_lease_id}:${input.envelope_id}`),
      expires_at: input.expires_at,
    };
  },
});

const assertUsableDatabaseUrl = (): string | undefined => {
  if (databaseUrl === undefined) {
    if (requireConcurrencyDb) {
      throw new Error('FORGELOOP_REQUIRE_DB_CONCURRENCY=1 requires FORGELOOP_TEST_DATABASE_URL or FORGELOOP_DATABASE_URL.');
    }
    return undefined;
  }
  try {
    assertResettableDatabaseUrl(databaseUrl);
  } catch (error) {
    if (requireConcurrencyDb) {
      throw error;
    }
    return undefined;
  }
  return databaseUrl;
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

const profileRevision = (): { profile: CodexRuntimeProfile; revision: CodexRuntimeProfileRevision } => {
  const profileId = randomUUID();
  const revisionId = randomUUID();
  const codexConfigToml = 'model = "gpt-5"\napproval_policy = "never"\n';
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    id: revisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex-runtime',
    docker_image_digest: `sha256:${'a'.repeat(64)}`,
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: `sha256:${'b'.repeat(64)}`,
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: dockerProxyNetworkPolicy(),
    resource_limits: {
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
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: randomUUID(), repo_id: randomUUID() }],
    profile_digest: `sha256:${'c'.repeat(64)}`,
    created_by_actor_id: randomUUID(),
    created_at: now,
  };
  const revision = {
    ...revisionWithoutDigest,
    profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest),
  };
  const profile: CodexRuntimeProfile = {
    id: profileId,
    name: 'Codex generation docker runtime',
    environment: 'test',
    target_kind: 'generation',
    active_revision_id: revisionId,
    created_by_actor_id: revision.created_by_actor_id,
    created_at: now,
    updated_at: now,
  };
  return { profile, revision };
};

const seedRuntime = async (
  repository: DeliveryRepository,
  options: {
    capabilities?: readonly CodexRuntimeProfileRevision['target_kind'][];
    maxConcurrency?: number;
    heartbeat?: boolean;
    createInitialLease?: boolean;
  } = {},
) => {
  const { profile, revision } = profileRevision();
  const secretPayload = {
    env: {
      OPENAI_API_KEY: 'sk-test-private-key',
    },
  };
  const binding: CodexCredentialBinding = {
    id: randomUUID(),
    profile_id: profile.id,
    project_id: revision.allowed_scopes[0]!.project_id,
    repo_id: revision.allowed_scopes[0]!.repo_id,
    provider: 'unsafe_db',
    purpose: 'model_provider',
    active_version_id: randomUUID(),
    created_by_actor_id: revision.created_by_actor_id,
    created_at: now,
    updated_at: now,
  };
  const version: CodexCredentialBindingVersion = {
    id: binding.active_version_id!,
    binding_id: binding.id,
    version_number: 1,
    status: 'active',
    payload_digest: codexCredentialPayloadDigest(secretPayload),
    created_by_actor_id: revision.created_by_actor_id,
    created_at: now,
  };
  await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
  await repository.createCodexCredentialBindingWithVersion({ binding, version, secret_payload_json: secretPayload });

  const workerId = randomUUID();
  const sessionToken = 'session-token-1';
  await repository.createCodexWorkerBootstrapToken({
    id: randomUUID(),
    worker_identity: 'local-worker-1',
    bootstrap_token_hash: tokenHash('bootstrap-token-raw'),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: revision.allowed_scopes,
    allowed_capabilities_json: {
      target_kinds: options.capabilities ?? ['generation'],
      docker_image_digests: [revision.docker_image_digest],
      network_policy_digests: [codexCanonicalDigest(revision.network_policy)],
      network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
    },
    created_by_actor_id: revision.created_by_actor_id,
    created_at: now,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: 'local-worker-1',
    version: '0.1.0',
    bootstrap_token_hash: tokenHash('bootstrap-token-raw'),
    bootstrap_token_version: 1,
    session_token: sessionToken,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: revision.allowed_scopes,
    capabilities: options.capabilities ?? ['generation'],
    docker_image_digests: [revision.docker_image_digest],
    network_policy_digests: [codexCanonicalDigest(revision.network_policy)],
    network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: 0,
    max_concurrency: options.maxConcurrency ?? 2,
    labels: {},
    session_public_key_id: 'session-key-1',
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'public-key-material',
    session_public_key_expires_at: expiresAt,
    now,
  });
  if (options.heartbeat ?? true) {
    await repository.heartbeatCodexWorker({
      worker_id: workerId,
      session_token: sessionToken,
      nonce: `seed-runtime-heartbeat-${workerId}`,
      nonce_timestamp: now,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: options.capabilities ?? ['generation'],
      now,
    });
  }
  const generationAction = await repository.claimAutomationActionRun({
    id: randomUUID(),
    action_type: 'codex_generation',
    target_object_type: 'generation_request',
    target_object_id: 'generation-drizzle',
    target_status: 'running',
    target_version: 1,
    idempotency_key: `generation-action-${randomUUID()}`,
    automation_scope: `repo:${binding.project_id}:${binding.repo_id}`,
    automation_settings_version: 1,
    capability_fingerprint: 'capability-codex',
    precondition_fingerprint: 'precondition-1',
    action_input_json: { generation_id: 'generation-drizzle' },
    claim_token: 'action-claim-token-1',
    locked_until: expiresAt,
    now,
  });

  const lease =
    options.createInitialLease === false
      ? undefined
      : await repository.createOrReplayCodexLaunchLease({
          id: randomUUID(),
          lease_request_id: `lease-request-${randomUUID()}`,
          target: {
            target_type: 'automation_action_run',
            target_id: generationAction.id,
            target_kind: 'generation',
            project_id: binding.project_id,
            repo_id: binding.repo_id,
          },
          worker_id: workerId,
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
          action_claim_token_hash: tokenHash('action-claim-token-1'),
          precondition_fingerprint: 'precondition-1',
          expires_at: expiresAt,
          now,
        });

  return { lease: lease!, workerId, sessionToken, secretPayload, profile, revision, binding, version, generationAction };
};

const runtimeJobInput = (
  seed: Awaited<ReturnType<typeof seedRuntime>>,
  overrides: Partial<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput> = {},
): CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput => {
  const target = overrides.target ?? {
    target_type: 'automation_action_run' as const,
    target_id: seed.generationAction.id,
    target_kind: 'generation' as const,
    project_id: seed.binding.project_id,
    repo_id: seed.binding.repo_id,
  };
  return {
    runtime_job_id: randomUUID(),
    launch_lease_id: randomUUID(),
    envelope_id: randomUUID(),
    job_request_id: `runtime-job-request-${randomUUID()}`,
    target,
    launch_attempt: 1,
    worker_id: seed.workerId,
    runtime_profile_revision_id: seed.revision.id,
    runtime_profile_digest: seed.revision.profile_digest,
    credential_binding_id: seed.binding.id,
    credential_binding_version_id: seed.version.id,
    credential_payload_digest: seed.version.payload_digest,
    docker_image_digest: seed.revision.docker_image_digest,
    network_policy_digest: codexCanonicalDigest(seed.revision.network_policy),
    network_provider_config_digest: dockerProxyConfig().provider_config_digest,
    input_json: { task: 'draft spec', public_ref: 'artifact://runtime/input' },
    input_digest: tokenHash('runtime-input-1'),
    workspace_acquisition_json: { bundle_id: 'workspace-bundle-1', archive_ref: 'artifact://runtime/workspace' },
    workspace_acquisition_digest: tokenHash('workspace-acquisition-1'),
    action_type: 'codex_generation',
    action_attempt: seed.generationAction.attempt,
    action_claim_token_hash: tokenHash('action-claim-token-1'),
    precondition_fingerprint: 'precondition-1',
    expires_at: expiresAt,
    now,
    ...overrides,
  };
};

const expectRuntimeJobCreateCounts = async (
  client: ReturnType<typeof createDbClient>,
  expected: { jobs: number; leases: number; envelopes: number },
) => {
  await expect(client.db.select().from(codex_runtime_jobs)).resolves.toHaveLength(expected.jobs);
  await expect(client.db.select().from(codex_launch_leases)).resolves.toHaveLength(expected.leases);
  await expect(client.db.select().from(codex_launch_token_envelopes)).resolves.toHaveLength(expected.envelopes);
};

const createLaunchLease = async (
  repository: DeliveryRepository,
  seed: Awaited<ReturnType<typeof seedRuntime>>,
  suffix: string,
  overrides: { expiresAt?: string } = {},
) =>
  repository.createOrReplayCodexLaunchLease({
    id: randomUUID(),
    lease_request_id: `lease-request-${suffix}-${randomUUID()}`,
    target: {
      target_type: 'automation_action_run',
      target_id: randomUUID(),
      target_kind: 'generation',
      project_id: seed.binding.project_id,
      repo_id: seed.binding.repo_id,
    },
    worker_id: seed.workerId,
    runtime_profile_revision_id: seed.revision.id,
    runtime_profile_digest: seed.revision.profile_digest,
    credential_binding_id: seed.binding.id,
    credential_binding_version_id: seed.version.id,
    credential_payload_digest: seed.version.payload_digest,
    docker_image_digest: seed.revision.docker_image_digest,
    network_policy_digest: codexCanonicalDigest(seed.revision.network_policy),
    network_provider_config_digest: dockerProxyConfig().provider_config_digest,
    launch_token: `launch-token-${suffix}`,
    launch_attempt: 1,
    action_claim_token_hash: tokenHash(`action-claim-token-${suffix}`),
    precondition_fingerprint: `precondition-${suffix}`,
    expires_at: overrides.expiresAt ?? expiresAt,
    now,
  });

const targetAttemptLaunchLeaseInput = (
  seed: Awaited<ReturnType<typeof seedRuntime>>,
  suffix: string,
  targetId: string,
): CreateOrReplayCodexLaunchLeaseInput => ({
  id: randomUUID(),
  lease_request_id: `lease-request-${suffix}-${randomUUID()}`,
  target: {
    target_type: 'automation_action_run',
    target_id: targetId,
    target_kind: 'generation',
    project_id: seed.binding.project_id,
    repo_id: seed.binding.repo_id,
  },
  worker_id: seed.workerId,
  runtime_profile_revision_id: seed.revision.id,
  runtime_profile_digest: seed.revision.profile_digest,
  credential_binding_id: seed.binding.id,
  credential_binding_version_id: seed.version.id,
  credential_payload_digest: seed.version.payload_digest,
  docker_image_digest: seed.revision.docker_image_digest,
  network_policy_digest: codexCanonicalDigest(seed.revision.network_policy),
  network_provider_config_digest: dockerProxyConfig().provider_config_digest,
  launch_token: `launch-token-${suffix}`,
  launch_attempt: 1,
  action_claim_token_hash: tokenHash(`action-claim-token-${suffix}`),
  precondition_fingerprint: `precondition-${suffix}`,
  expires_at: expiresAt,
  now,
});

const expectWorkerLeaseCount = async (client: ReturnType<typeof createDbClient>, workerId: string, leaseCount: number) => {
  const [workerRow] = await client.db
    .select({ leaseCount: codex_worker_registrations.leaseCount })
    .from(codex_worker_registrations)
    .where(eq(codex_worker_registrations.id, workerId))
    .limit(1);
  expect(workerRow).toEqual({ leaseCount });
};

const createRuntimeJobWithCapturedToken = async (
  repository: DeliveryRepository,
  seed: Awaited<ReturnType<typeof seedRuntime>>,
  sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]>,
  overrides: Partial<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput> = {},
) => {
  const input = runtimeJobInput(seed, overrides);
  const created = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
  const launchToken = sealerCalls.find((call) => call.runtime_job_id === input.runtime_job_id)?.plaintext_launch_token;
  if (launchToken === undefined) {
    throw new Error(`expected runtime job ${input.runtime_job_id} to capture a launch token`);
  }
  return { input, created, launchToken };
};

const acceptRuntimeJobInput = (
  input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  seed: Awaited<ReturnType<typeof seedRuntime>>,
  suffix: string,
) => ({
  runtime_job_id: input.runtime_job_id,
  worker_id: seed.workerId,
  worker_session_token: seed.sessionToken,
  nonce: `accept-${suffix}`,
  nonce_timestamp: later,
  accepted_worker_session_digest: tokenHash(seed.sessionToken),
  accepted_session_public_key_id: 'session-key-1',
  accepted_session_epoch: 1,
  idempotency_key: `accept-${input.runtime_job_id}`,
  request_digest: tokenHash(`accept-request-${input.runtime_job_id}`),
  now: later,
});

const claimRuntimeJobEnvelopeInput = (
  input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  seed: Awaited<ReturnType<typeof seedRuntime>>,
  suffix: string,
) => ({
  runtime_job_id: input.runtime_job_id,
  envelope_id: input.envelope_id,
  worker_id: seed.workerId,
  worker_session_token: seed.sessionToken,
  nonce: `claim-${suffix}`,
  nonce_timestamp: later,
  accepted_worker_session_digest: tokenHash(seed.sessionToken),
  key_id: 'session-key-1',
  claim_request_id: `claim-${input.runtime_job_id}`,
  request_digest: tokenHash(`claim-request-${input.runtime_job_id}`),
  now: later,
});

const materializeRuntimeJobInput = (
  input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  seed: Awaited<ReturnType<typeof seedRuntime>>,
  launchToken: string,
  suffix: string,
) => ({
  runtime_job_id: input.runtime_job_id,
  launch_lease_id: input.launch_lease_id,
  worker_id: seed.workerId,
  worker_session_token: seed.sessionToken,
  nonce: `materialize-${suffix}`,
  nonce_timestamp: later,
  launch_token_hash: tokenHash(launchToken),
  accepted_worker_session_digest: tokenHash(seed.sessionToken),
  materialization_request_id: `materialize-${input.runtime_job_id}`,
  request_digest: tokenHash(`materialize-request-${input.runtime_job_id}`),
  active_fence: {
    action_claim_token_hash: tokenHash('action-claim-token-1'),
    precondition_fingerprint: 'precondition-1',
  },
  now: later,
});

const installLaunchLeaseUpdateDelay = async (client: ReturnType<typeof createDbClient>, leaseId: string) => {
  await client.db.execute(sql.raw(`
    create or replace function codex_test_delay_launch_lease_update()
    returns trigger
    language plpgsql
    as $$
    begin
      if old.id = '${leaseId}'::uuid then
        perform pg_sleep(0.1);
      end if;
      return new;
    end;
    $$;
  `));
  await client.db.execute(sql.raw(`
    drop trigger if exists codex_test_delay_launch_lease_update_trigger on codex_launch_leases;
    create trigger codex_test_delay_launch_lease_update_trigger
    before update on codex_launch_leases
    for each row execute function codex_test_delay_launch_lease_update();
  `));
};

describe('Codex runtime Drizzle materialization concurrency', () => {
  const usableDatabaseUrl = assertUsableDatabaseUrl();

  if (usableDatabaseUrl === undefined) {
    it.skip('skips concurrency test because no safe resettable database URL is configured', () => {});
  } else {
    it('atomically replays concurrent runtime job create calls with one sealed envelope', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(firstRepository, { createInitialLease: false, maxConcurrency: 2 });
        const input = runtimeJobInput(seed);

        const [first, second] = await Promise.all([
          firstRepository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input),
          secondRepository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
            ...input,
            runtime_job_id: randomUUID(),
            launch_lease_id: input.launch_lease_id,
            envelope_id: input.envelope_id,
          }),
        ]);

        expect(first.runtime_job.id).toBe(input.runtime_job_id);
        expect(second).toEqual({ ...first, replayed: true });
        expect(sealerCalls).toHaveLength(1);
        expect(JSON.stringify(first)).not.toContain(sealerCalls[0]!.plaintext_launch_token);
        await expectRuntimeJobCreateCounts(firstClient, { jobs: 1, leases: 1, envelopes: 1 });
        await expectWorkerLeaseCount(firstClient, seed.workerId, 1);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('fails closed for concurrent conflicting runtime job replays', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(firstRepository, { createInitialLease: false, maxConcurrency: 2 });
        const input = runtimeJobInput(seed);

        const [first, second] = await Promise.allSettled([
          firstRepository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input),
          secondRepository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
            ...input,
            runtime_job_id: randomUUID(),
            launch_lease_id: input.launch_lease_id,
            envelope_id: input.envelope_id,
            input_digest: tokenHash('runtime-input-conflict'),
          }),
        ]);

        const successes = [first, second].filter((result) => result.status === 'fulfilled');
        const failures = [first, second].filter((result) => result.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          reason: {
            name: 'DomainError',
            code: 'codex_runtime_job_unavailable',
          },
        });
        expect(sealerCalls).toHaveLength(1);
        await expectRuntimeJobCreateCounts(firstClient, { jobs: 1, leases: 1, envelopes: 1 });
        await expectWorkerLeaseCount(firstClient, seed.workerId, 1);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('fails closed when replaying a runtime job after its live action fence expires', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const repository = new DrizzleDeliveryRepository(client.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(repository, { createInitialLease: false, maxConcurrency: 2 });
        const input = runtimeJobInput(seed, {
          expires_at: '2026-05-20T00:30:00.000Z',
        });

        await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);

        await expect(
          repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
            ...input,
            runtime_job_id: randomUUID(),
            now: '2026-05-20T00:11:00.000Z',
          }),
        ).rejects.toMatchObject({
          name: 'DomainError',
          code: 'codex_runtime_job_unavailable',
        });
        expect(sealerCalls).toHaveLength(1);
        await expectRuntimeJobCreateCounts(client, { jobs: 1, leases: 1, envelopes: 1 });
      } finally {
        await client.pool.end();
      }
    });

    it('serializes concurrent runtime job accepts and keeps one accepted row', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(firstRepository, { createInitialLease: false, maxConcurrency: 2 });
        const { input } = await createRuntimeJobWithCapturedToken(firstRepository, seed, sealerCalls);
        const accept = acceptRuntimeJobInput(input, seed, 'race-1');

        const [first, second] = await Promise.allSettled([
          firstRepository.acceptCodexRuntimeJob(accept),
          secondRepository.acceptCodexRuntimeJob({
            ...accept,
            nonce: 'accept-race-2',
            idempotency_key: 'accept-conflicting-runtime-job',
            request_digest: tokenHash('accept-conflicting-runtime-job-request'),
          }),
        ]);

        const successes = [first, second].filter((result) => result.status === 'fulfilled');
        const failures = [first, second].filter((result) => result.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          reason: {
            name: 'DomainError',
            code: 'codex_runtime_job_unavailable',
          },
        });

        const [row] = await firstClient.db
          .select({
            status: codex_runtime_jobs.status,
            acceptIdempotencyKey: codex_runtime_jobs.acceptIdempotencyKey,
            acceptRequestDigest: codex_runtime_jobs.acceptRequestDigest,
          })
          .from(codex_runtime_jobs)
          .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
          .limit(1);
        expect(row).toEqual({
          status: 'accepted',
          acceptIdempotencyKey: accept.idempotency_key,
          acceptRequestDigest: accept.request_digest,
        });
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('terminalizes runtime jobs and leases exactly once under concurrent terminal replay', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(firstRepository, { createInitialLease: false, maxConcurrency: 2 });
        const { input, launchToken } = await createRuntimeJobWithCapturedToken(firstRepository, seed, sealerCalls);
        await firstRepository.acceptCodexRuntimeJob(acceptRuntimeJobInput(input, seed, 'terminal-race-accept'));
        await firstRepository.claimCodexLaunchTokenEnvelope(claimRuntimeJobEnvelopeInput(input, seed, 'terminal-race-claim'));
        await firstRepository.materializeCodexRuntimeJob(materializeRuntimeJobInput(input, seed, launchToken, 'terminal-race-materialize'));
        await firstRepository.startCodexRuntimeJob({
          runtime_job_id: input.runtime_job_id,
          worker_id: seed.workerId,
          worker_session_token: seed.sessionToken,
          nonce: 'start-terminal-race',
          nonce_timestamp: later,
          idempotency_key: `start-${input.runtime_job_id}`,
          request_digest: tokenHash(`start-request-${input.runtime_job_id}`),
          runtime_evidence_digest: tokenHash(`runtime-evidence-${input.runtime_job_id}`),
          launch_materialization_digest: tokenHash(`launch-materialization-${input.runtime_job_id}`),
          now: later,
        });

        const terminalInput = {
          runtime_job_id: input.runtime_job_id,
          launch_lease_id: input.launch_lease_id,
          worker_id: seed.workerId,
          worker_session_token: seed.sessionToken,
          nonce: 'terminal-race-1',
          nonce_timestamp: later,
          terminal_status: 'succeeded' as const,
          reason_code: 'completed',
          terminal_result_json: {
            task_kind: 'spec_draft',
            prompt_version: 'codex-generation-test-v1',
            output_schema_version: 'spec-draft-test-v1',
            generated_payload: { title: 'Generated spec' },
            generated_payload_digest: tokenHash('generated-spec-payload'),
            generation_artifacts: [],
            public_summary: 'completed',
          },
          idempotency_key: `terminal-${input.runtime_job_id}`,
          request_digest: tokenHash(`terminal-request-${input.runtime_job_id}`),
          now: later,
        };

        const [first, second] = await Promise.allSettled([
          firstRepository.terminalizeCodexRuntimeJob(terminalInput),
          secondRepository.terminalizeCodexRuntimeJob({ ...terminalInput, nonce: 'terminal-race-2' }),
        ]);

        expect([first, second]).toEqual([
          expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ status: 'terminal' }) }),
          expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ status: 'terminal' }) }),
        ]);
        const [jobRow] = await firstClient.db
          .select({ status: codex_runtime_jobs.status, terminalStatus: codex_runtime_jobs.terminalStatus })
          .from(codex_runtime_jobs)
          .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
          .limit(1);
        const [leaseRow] = await firstClient.db
          .select({ status: codex_launch_leases.status, terminalRuntimeJobId: codex_launch_leases.terminalRuntimeJobId })
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.id, input.launch_lease_id))
          .limit(1);
        expect(jobRow).toEqual({ status: 'terminal', terminalStatus: 'succeeded' });
        expect(leaseRow).toEqual({ status: 'terminal', terminalRuntimeJobId: input.runtime_job_id });
        await expectWorkerLeaseCount(firstClient, seed.workerId, 0);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('terminalizes accepted unclaimed cancels and rejects success terminals after durable cancel', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const repository = new DrizzleDeliveryRepository(client.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(repository, { createInitialLease: false, maxConcurrency: 2 });
        const accepted = await createRuntimeJobWithCapturedToken(repository, seed, sealerCalls);
        await repository.acceptCodexRuntimeJob(acceptRuntimeJobInput(accepted.input, seed, 'accepted-cancel'));

        await expect(
          repository.cancelCodexRuntimeJob({
            runtime_job_id: accepted.input.runtime_job_id,
            reason_code: 'user_cancelled',
            idempotency_key: `cancel-${accepted.input.runtime_job_id}`,
            request_digest: tokenHash(`cancel-request-${accepted.input.runtime_job_id}`),
            now: later,
          }),
        ).resolves.toMatchObject({ status: 'terminal', terminal_status: 'cancelled' });
        const [acceptedJobRow] = await client.db
          .select({ status: codex_runtime_jobs.status, terminalStatus: codex_runtime_jobs.terminalStatus })
          .from(codex_runtime_jobs)
          .where(eq(codex_runtime_jobs.id, accepted.input.runtime_job_id))
          .limit(1);
        const [acceptedLeaseRow] = await client.db
          .select({ status: codex_launch_leases.status })
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.id, accepted.input.launch_lease_id))
          .limit(1);
        const [acceptedEnvelopeRow] = await client.db
          .select({ status: codex_launch_token_envelopes.status })
          .from(codex_launch_token_envelopes)
          .where(eq(codex_launch_token_envelopes.id, accepted.input.envelope_id))
          .limit(1);
        expect(acceptedJobRow).toEqual({ status: 'terminal', terminalStatus: 'cancelled' });
        expect(acceptedLeaseRow).toEqual({ status: 'revoked' });
        expect(acceptedEnvelopeRow).toEqual({ status: 'revoked' });

        const running = await createRuntimeJobWithCapturedToken(
          repository,
          seed,
          sealerCalls,
          {
            runtime_job_id: randomUUID(),
            launch_lease_id: randomUUID(),
            envelope_id: randomUUID(),
            job_request_id: `runtime-job-request-${randomUUID()}`,
            launch_attempt: 2,
          },
        );
        await repository.acceptCodexRuntimeJob(acceptRuntimeJobInput(running.input, seed, 'running-cancel-accept'));
        await repository.claimCodexLaunchTokenEnvelope(claimRuntimeJobEnvelopeInput(running.input, seed, 'running-cancel-claim'));
        await repository.materializeCodexRuntimeJob(materializeRuntimeJobInput(running.input, seed, running.launchToken, 'running-cancel-materialize'));
        await repository.startCodexRuntimeJob({
          runtime_job_id: running.input.runtime_job_id,
          worker_id: seed.workerId,
          worker_session_token: seed.sessionToken,
          nonce: 'start-running-cancel',
          nonce_timestamp: later,
          idempotency_key: `start-${running.input.runtime_job_id}`,
          request_digest: tokenHash(`start-request-${running.input.runtime_job_id}`),
          runtime_evidence_digest: tokenHash(`runtime-evidence-${running.input.runtime_job_id}`),
          launch_materialization_digest: tokenHash(`launch-materialization-${running.input.runtime_job_id}`),
          now: later,
        });
        await repository.cancelCodexRuntimeJob({
          runtime_job_id: running.input.runtime_job_id,
          reason_code: 'user_cancelled',
          idempotency_key: `cancel-${running.input.runtime_job_id}`,
          request_digest: tokenHash(`cancel-request-${running.input.runtime_job_id}`),
          now: later,
        });
        await expect(
          repository.terminalizeCodexRuntimeJob({
            runtime_job_id: running.input.runtime_job_id,
            launch_lease_id: running.input.launch_lease_id,
            worker_id: seed.workerId,
            worker_session_token: seed.sessionToken,
            nonce: 'terminal-running-cancel-success-race',
            nonce_timestamp: later,
            terminal_status: 'succeeded',
            reason_code: 'completed_after_cancel',
            terminal_result_json: {
              task_kind: 'spec_draft',
              prompt_version: 'codex-generation-test-v1',
              output_schema_version: 'spec-draft-test-v1',
              generated_payload: { title: 'Generated spec' },
              generated_payload_digest: tokenHash('generated-spec-after-cancel'),
              generation_artifacts: [],
              public_summary: 'completed after cancel',
            },
            idempotency_key: `terminal-success-after-cancel-${running.input.runtime_job_id}`,
            request_digest: tokenHash(`terminal-success-after-cancel-request-${running.input.runtime_job_id}`),
            now: later,
          }),
        ).rejects.toMatchObject({ name: 'DomainError', code: 'codex_runtime_job_unavailable' });
      } finally {
        await client.pool.end();
      }
    });

    it('keeps runtime job launch leases out of legacy stale worker recovery', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const repository = new DrizzleDeliveryRepository(client.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(repository, { createInitialLease: false, maxConcurrency: 2 });
        const { input } = await createRuntimeJobWithCapturedToken(repository, seed, sealerCalls, {
          expires_at: '2026-05-20T00:30:00.000Z',
        });
        await repository.acceptCodexRuntimeJob(acceptRuntimeJobInput(input, seed, 'legacy-recovery-skip'));

        await expect(
          repository.recoverStaleCodexWorkerLeases({
            stale_before: later,
            now: later,
            worker_id: seed.workerId,
            reason_code: 'legacy_stale_worker',
          }),
        ).resolves.toEqual({ recovered_launch_leases: [], automation_action_transitions: [], run_session_transitions: [] });
        const [leaseRow] = await client.db
          .select({ status: codex_launch_leases.status })
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.id, input.launch_lease_id))
          .limit(1);
        const [actionRow] = await client.db
          .select({ status: automation_action_runs.status })
          .from(automation_action_runs)
          .where(eq(automation_action_runs.id, seed.generationAction.id))
          .limit(1);
        expect(leaseRow).toEqual({ status: 'active' });
        expect(actionRow).toEqual({ status: 'running' });
      } finally {
        await client.pool.end();
      }
    });

    it('materializes runtime jobs by launch token hash atomically and replays the same materialization', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const repository = new DrizzleDeliveryRepository(client.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(repository, { createInitialLease: false, maxConcurrency: 2 });
        const { input, launchToken } = await createRuntimeJobWithCapturedToken(repository, seed, sealerCalls);
        await repository.acceptCodexRuntimeJob(acceptRuntimeJobInput(input, seed, 'materialize-accept'));
        await repository.claimCodexLaunchTokenEnvelope(claimRuntimeJobEnvelopeInput(input, seed, 'materialize-claim'));
        const materializeInput = materializeRuntimeJobInput(input, seed, launchToken, 'materialize-valid');

        await expect(
          repository.materializeCodexRuntimeJob({
            ...materializeInput,
            nonce: 'materialize-wrong-hash',
            launch_token_hash: tokenHash('wrong-launch-token'),
          }),
        ).rejects.toMatchObject({
          name: 'DomainError',
          code: 'codex_launch_materialization_denied',
        });

        const materialized = await repository.materializeCodexRuntimeJob(materializeInput);
        await expect(
          repository.materializeCodexRuntimeJob({ ...materializeInput, nonce: 'materialize-valid-replay' }),
        ).resolves.toEqual(materialized);
        expect(materialized).toMatchObject({
          lease_id: input.launch_lease_id,
          materialized_at: later,
          resolved_credentials: [{ payload: seed.secretPayload }],
        });

        const [jobRow] = await client.db
          .select({ status: codex_runtime_jobs.status, materializationRequestDigest: codex_runtime_jobs.materializationRequestDigest })
          .from(codex_runtime_jobs)
          .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
          .limit(1);
        const [leaseRow] = await client.db
          .select({ status: codex_launch_leases.status, materializationRequestHash: codex_launch_leases.materializationRequestHash })
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.id, input.launch_lease_id))
          .limit(1);
        expect(jobRow).toEqual({ status: 'materializing', materializationRequestDigest: materializeInput.request_digest });
        expect(leaseRow).toEqual({ status: 'materialized', materializationRequestHash: materializeInput.request_digest });
      } finally {
        await client.pool.end();
      }
    });

    it('queued cancel revokes the launch lease and decrements worker lease count once', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const sealerCalls: Array<Parameters<CodexLaunchTokenEnvelopeSealer['sealLaunchTokenEnvelope']>[0]> = [];
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db, {
          codexLaunchTokenEnvelopeSealer: createEnvelopeSealer(sealerCalls),
        });
        const seed = await seedRuntime(firstRepository, { createInitialLease: false, maxConcurrency: 2 });
        const { input } = await createRuntimeJobWithCapturedToken(firstRepository, seed, sealerCalls);
        const cancelInput = {
          runtime_job_id: input.runtime_job_id,
          reason_code: 'user_cancelled',
          idempotency_key: `cancel-${input.runtime_job_id}`,
          request_digest: tokenHash(`cancel-request-${input.runtime_job_id}`),
          now: later,
        };

        const [first, second] = await Promise.allSettled([
          firstRepository.cancelCodexRuntimeJob(cancelInput),
          secondRepository.cancelCodexRuntimeJob(cancelInput),
        ]);

        expect([first, second]).toEqual([
          expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ status: 'terminal' }) }),
          expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ status: 'terminal' }) }),
        ]);
        const [jobRow] = await firstClient.db
          .select({ status: codex_runtime_jobs.status, terminalStatus: codex_runtime_jobs.terminalStatus })
          .from(codex_runtime_jobs)
          .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
          .limit(1);
        const [leaseRow] = await firstClient.db
          .select({ status: codex_launch_leases.status, terminalReasonCode: codex_launch_leases.terminalReasonCode })
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.id, input.launch_lease_id))
          .limit(1);
        expect(jobRow).toEqual({ status: 'terminal', terminalStatus: 'cancelled' });
        expect(leaseRow).toEqual({ status: 'revoked', terminalReasonCode: 'user_cancelled' });
        await expectWorkerLeaseCount(firstClient, seed.workerId, 0);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('replays concurrent identical bootstrap token creates', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const input = {
          id: randomUUID(),
          worker_identity: 'local-worker-bootstrap-race',
          bootstrap_token_hash: tokenHash('bootstrap-token-race-raw'),
          bootstrap_token_version: 1,
          status: 'active' as const,
          allowed_scopes_json: [{ project_id: randomUUID(), repo_id: randomUUID() }],
          allowed_capabilities_json: {
            target_kinds: ['generation'],
            docker_image_digests: [`sha256:${'a'.repeat(64)}`],
            network_policy_digests: [codexCanonicalDigest(profileRevision().revision.network_policy)],
            network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
          },
          created_by_actor_id: randomUUID(),
          created_at: now,
          expires_at: expiresAt,
        };

        const results = await Promise.allSettled([
          firstRepository.createCodexWorkerBootstrapToken(input),
          secondRepository.createCodexWorkerBootstrapToken(input),
        ]);

        expect(results).toEqual([
          expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ id: input.id }) }),
          expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ id: input.id }) }),
        ]);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('denies concurrent launch lease creates for the same target attempt without leaking unique constraint errors', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const seed = await seedRuntime(firstRepository, { createInitialLease: false, maxConcurrency: 2 });
        const targetId = randomUUID();

        const [first, second] = await Promise.allSettled([
          firstRepository.createOrReplayCodexLaunchLease(targetAttemptLaunchLeaseInput(seed, 'target-race-a', targetId)),
          secondRepository.createOrReplayCodexLaunchLease(targetAttemptLaunchLeaseInput(seed, 'target-race-b', targetId)),
        ]);

        const successes = [first, second].filter((result) => result.status === 'fulfilled');
        const failures = [first, second].filter((result) => result.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          reason: {
            name: 'DomainError',
            code: 'codex_launch_lease_denied',
          },
        });
        await expectWorkerLeaseCount(firstClient, seed.workerId, 1);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('allows exactly one concurrent materialization of a launch lease', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const { lease, workerId, sessionToken, secretPayload } = await seedRuntime(firstRepository);
        const firstHash = tokenHash('materialize-request-1');
        const secondHash = tokenHash('materialize-request-2');

        const [first, second] = await Promise.allSettled([
          firstRepository.materializeCodexLaunchLease({
            lease_id: lease.id,
            worker_id: workerId,
            launch_token: lease.lease_token,
            worker_session_token: sessionToken,
            nonce: 'materialize-nonce-1',
            nonce_timestamp: later,
            materialization_request_hash: firstHash,
            active_fence: {
              action_claim_token_hash: tokenHash('action-claim-token-1'),
              precondition_fingerprint: 'precondition-1',
            },
            now: later,
          }),
          secondRepository.materializeCodexLaunchLease({
            lease_id: lease.id,
            worker_id: workerId,
            launch_token: lease.lease_token,
            worker_session_token: sessionToken,
            nonce: 'materialize-nonce-2',
            nonce_timestamp: later,
            materialization_request_hash: secondHash,
            active_fence: {
              action_claim_token_hash: tokenHash('action-claim-token-1'),
              precondition_fingerprint: 'precondition-1',
            },
            now: later,
          }),
        ]);

        const successes = [first, second].filter((result) => result.status === 'fulfilled');
        const failures = [first, second].filter((result) => result.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          reason: {
            name: 'DomainError',
            code: 'codex_launch_materialization_denied',
          },
        });
        const success = successes[0];
        expect(success).toMatchObject({
          value: {
            resolved_credentials: [
              {
                payload: secretPayload,
              },
            ],
          },
        });

        const expectedHash = first.status === 'fulfilled' ? firstHash : secondHash;
        const [row] = await firstClient.db
          .select({
            status: codex_launch_leases.status,
            materializationRequestHash: codex_launch_leases.materializationRequestHash,
          })
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.id, lease.id))
          .limit(1);
        expect(row).toEqual({
          status: 'materialized',
          materializationRequestHash: expectedHash,
        });
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('does not consume a launch lease when materialization dependencies are unavailable', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { lease, workerId, sessionToken, version } = await seedRuntime(repository);

        await client.db
          .update(codex_credential_binding_versions)
          .set({ status: 'revoked' } as never)
          .where(eq(codex_credential_binding_versions.id, version.id));

        await expect(
          repository.materializeCodexLaunchLease({
            lease_id: lease.id,
            worker_id: workerId,
            launch_token: lease.lease_token,
            worker_session_token: sessionToken,
            nonce: 'dependency-failure-nonce',
            nonce_timestamp: later,
            materialization_request_hash: tokenHash('dependency-failure-request'),
            active_fence: {
              action_claim_token_hash: tokenHash('action-claim-token-1'),
              precondition_fingerprint: 'precondition-1',
            },
            now: later,
          }),
        ).rejects.toMatchObject({
          name: 'DomainError',
          code: 'codex_launch_materialization_denied',
        });

        const [row] = await client.db
          .select({
            status: codex_launch_leases.status,
            materializationRequestHash: codex_launch_leases.materializationRequestHash,
          })
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.id, lease.id))
          .limit(1);
        expect(row).toEqual({
          status: 'active',
          materializationRequestHash: null,
        });
      } finally {
        await client.pool.end();
      }
    });

    it('rejects materialization when persisted dependency digests drift from the lease fence', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { lease, workerId, sessionToken, revision, version } = await seedRuntime(repository);

        await client.db
          .update(codex_runtime_profile_revisions)
          .set({ profileDigest: `sha256:${'d'.repeat(64)}` } as never)
          .where(eq(codex_runtime_profile_revisions.id, revision.id));

        await expect(
          repository.materializeCodexLaunchLease({
            lease_id: lease.id,
            worker_id: workerId,
            launch_token: lease.lease_token,
            worker_session_token: sessionToken,
            nonce: 'profile-digest-drift-nonce',
            nonce_timestamp: later,
            materialization_request_hash: tokenHash('profile-digest-drift-request'),
            active_fence: {
              action_claim_token_hash: tokenHash('action-claim-token-1'),
              precondition_fingerprint: 'precondition-1',
            },
            now: later,
          }),
        ).rejects.toMatchObject({
          name: 'DomainError',
          code: 'codex_launch_materialization_denied',
        });

        await client.db
          .update(codex_runtime_profile_revisions)
          .set({ profileDigest: revision.profile_digest } as never)
          .where(eq(codex_runtime_profile_revisions.id, revision.id));
        await client.db
          .update(codex_credential_binding_versions)
          .set({ payloadDigest: `sha256:${'e'.repeat(64)}` } as never)
          .where(eq(codex_credential_binding_versions.id, version.id));

        await expect(
          repository.materializeCodexLaunchLease({
            lease_id: lease.id,
            worker_id: workerId,
            launch_token: lease.lease_token,
            worker_session_token: sessionToken,
            nonce: 'credential-digest-drift-nonce',
            nonce_timestamp: later,
            materialization_request_hash: tokenHash('credential-digest-drift-request'),
            active_fence: {
              action_claim_token_hash: tokenHash('action-claim-token-1'),
              precondition_fingerprint: 'precondition-1',
            },
            now: later,
          }),
        ).rejects.toMatchObject({
          name: 'DomainError',
          code: 'codex_launch_materialization_denied',
        });
      } finally {
        await client.pool.end();
      }
    });

    it('requires a fresh heartbeat before selecting a registered worker', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { workerId, sessionToken, revision, binding } = await seedRuntime(repository, {
          heartbeat: false,
          createInitialLease: false,
          maxConcurrency: 1,
        });

        await expect(
          repository.findAvailableCodexWorker({
            project_id: binding.project_id,
            repo_id: binding.repo_id,
            target_kind: 'generation',
            docker_image_digest: revision.docker_image_digest,
            network_policy_digest: codexCanonicalDigest(revision.network_policy),
            network_provider_config_digest: dockerProxyConfig().provider_config_digest,
            now,
          }),
        ).resolves.toBeUndefined();

        await repository.heartbeatCodexWorker({
          worker_id: workerId,
          session_token: sessionToken,
          nonce: 'drizzle-fresh-heartbeat-nonce',
          nonce_timestamp: later,
          status: 'online',
          control_channel_status: 'connected',
          active_lease_count: 0,
          capabilities: ['generation'],
          now: later,
        });

        await expect(
          repository.findAvailableCodexWorker({
            project_id: binding.project_id,
            repo_id: binding.repo_id,
            target_kind: 'generation',
            docker_image_digest: revision.docker_image_digest,
            network_policy_digest: codexCanonicalDigest(revision.network_policy),
            network_provider_config_digest: dockerProxyConfig().provider_config_digest,
            now: later,
          }),
        ).resolves.toMatchObject({ id: workerId });
      } finally {
        await client.pool.end();
      }
    });

    it('uses active heartbeat capabilities instead of the registration ceiling for scheduling', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { workerId, sessionToken, revision, binding } = await seedRuntime(repository, {
          capabilities: ['generation', 'run_execution'],
        });

        await repository.heartbeatCodexWorker({
          worker_id: workerId,
          session_token: sessionToken,
          nonce: 'heartbeat-capability-downgrade-nonce',
          nonce_timestamp: later,
          status: 'online',
          control_channel_status: 'connected',
          active_lease_count: 0,
          capabilities: ['generation'],
          now: later,
        });

        await expect(
          repository.findAvailableCodexWorker({
            project_id: binding.project_id,
            repo_id: binding.repo_id,
            target_kind: 'run_execution',
            docker_image_digest: revision.docker_image_digest,
            network_policy_digest: codexCanonicalDigest(revision.network_policy),
            network_provider_config_digest: dockerProxyConfig().provider_config_digest,
            now: later,
          }),
        ).resolves.toBeUndefined();
        await expect(
          repository.findAvailableCodexWorker({
            project_id: binding.project_id,
            repo_id: binding.repo_id,
            target_kind: 'generation',
            docker_image_digest: revision.docker_image_digest,
            network_policy_digest: codexCanonicalDigest(revision.network_policy),
            network_provider_config_digest: dockerProxyConfig().provider_config_digest,
            now: later,
          }),
        ).resolves.toMatchObject({ id: workerId, capabilities: ['generation'] });
      } finally {
        await client.pool.end();
      }
    });

    it('does not project credential metadata outside the requested runtime scope', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { binding } = await seedRuntime(repository);
        const projectB = profileRevision();
        await repository.createCodexRuntimeProfileWithRevision(projectB);

        const status = await repository.getCodexRuntimeStatus({
          project_id: projectB.revision.allowed_scopes[0]!.project_id,
          repo_id: projectB.revision.allowed_scopes[0]!.repo_id,
          target_kind: 'generation',
          credential_binding_id: binding.id,
          now: later,
        });

        expect(status).toMatchObject({
          runtime_profile_id: projectB.profile.id,
          runtime_profile_revision_id: projectB.revision.id,
          blocker_codes: expect.arrayContaining(['codex_credential_unavailable', 'codex_worker_unavailable']),
        });
        expect(status).not.toHaveProperty('credential_binding_id');
        expect(status).not.toHaveProperty('credential_binding_version_id');
        expect(status).not.toHaveProperty('credential_payload_digest');
      } finally {
        await client.pool.end();
      }
    });

    it('rejects credential resolution when the binding is outside the requested runtime profile', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { binding, version } = await seedRuntime(repository);
        const projectB = profileRevision();
        await repository.createCodexRuntimeProfileWithRevision(projectB);

        await expect(
          repository.resolveCodexCredentialForLaunch({
            credential_binding_id: binding.id,
            target_kind: 'generation',
            runtime_profile_id: projectB.profile.id,
            project_id: binding.project_id,
            repo_id: binding.repo_id,
            required_payload_digest: version.payload_digest,
            now: later,
          }),
        ).resolves.toBeUndefined();
      } finally {
        await client.pool.end();
      }
    });

    it('rejects inconsistent runtime profile and credential creates without partial writes', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { profile, revision } = profileRevision();

        await expect(
          repository.createCodexRuntimeProfileWithRevision({
            profile: { ...profile, active_revision_id: randomUUID() },
            revision,
          }),
        ).rejects.toMatchObject({ name: 'DomainError' });
        await expect(client.db.select().from(codex_runtime_profiles)).resolves.toEqual([]);

        await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
        const duplicateRevisionId = randomUUID();
        const duplicate = {
          profile: { ...profile, active_revision_id: duplicateRevisionId, updated_at: later },
          revision: { ...revision, id: duplicateRevisionId },
        };
        await expect(repository.createCodexRuntimeProfileWithRevision(duplicate)).rejects.toMatchObject({ name: 'DomainError' });

        const secretPayload = { env: { OPENAI_API_KEY: 'sk-test-private-key' } };
        const binding: CodexCredentialBinding = {
          id: randomUUID(),
          profile_id: profile.id,
          project_id: revision.allowed_scopes[0]!.project_id,
          repo_id: revision.allowed_scopes[0]!.repo_id,
          provider: 'unsafe_db',
          purpose: 'model_provider',
          active_version_id: randomUUID(),
          created_by_actor_id: revision.created_by_actor_id,
          created_at: now,
          updated_at: now,
        };
        const version: CodexCredentialBindingVersion = {
          id: binding.active_version_id!,
          binding_id: binding.id,
          version_number: 1,
          status: 'active',
          payload_digest: codexCredentialPayloadDigest(secretPayload),
          created_by_actor_id: revision.created_by_actor_id,
          created_at: now,
        };

        await expect(
          repository.createCodexCredentialBindingWithVersion({
            binding: { ...binding, active_version_id: randomUUID() },
            version,
            secret_payload_json: secretPayload,
          }),
        ).rejects.toMatchObject({ name: 'DomainError' });
        await expect(client.db.select().from(codex_credential_bindings)).resolves.toEqual([]);

        await repository.createCodexCredentialBindingWithVersion({ binding, version, secret_payload_json: secretPayload });
        const duplicateVersionId = randomUUID();
        await expect(
          repository.createCodexCredentialBindingWithVersion({
            binding: { ...binding, active_version_id: duplicateVersionId, updated_at: later },
            version: { ...version, id: duplicateVersionId },
            secret_payload_json: secretPayload,
          }),
        ).rejects.toMatchObject({ name: 'DomainError' });
      } finally {
        await client.pool.end();
      }
    });

    it('does not let heartbeat under-reporting free an occupied worker slot', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { workerId, sessionToken, revision, binding, version } = await seedRuntime(repository, { maxConcurrency: 1 });

        await repository.heartbeatCodexWorker({
          worker_id: workerId,
          session_token: sessionToken,
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
            id: randomUUID(),
            lease_request_id: `lease-request-underreported-${randomUUID()}`,
            target: {
              target_type: 'automation_action_run',
              target_id: randomUUID(),
              target_kind: 'generation',
              project_id: binding.project_id,
              repo_id: binding.repo_id,
            },
            worker_id: workerId,
            runtime_profile_revision_id: revision.id,
            runtime_profile_digest: revision.profile_digest,
            credential_binding_id: binding.id,
            credential_binding_version_id: version.id,
            credential_payload_digest: version.payload_digest,
            docker_image_digest: revision.docker_image_digest,
            network_policy_digest: codexCanonicalDigest(revision.network_policy),
            network_provider_config_digest: dockerProxyConfig().provider_config_digest,
            launch_token: 'launch-token-underreported',
            launch_attempt: 1,
            expires_at: expiresAt,
            now: later,
          }),
        ).rejects.toMatchObject({
          name: 'DomainError',
          code: 'codex_launch_lease_denied',
        });
      } finally {
        await client.pool.end();
      }
    });

    it('keeps worker capacity occupied after materialization until terminalization', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const seed = await seedRuntime(repository, { maxConcurrency: 1 });

        await repository.materializeCodexLaunchLease({
          lease_id: seed.lease.id,
          worker_id: seed.workerId,
          launch_token: seed.lease.lease_token,
          worker_session_token: seed.sessionToken,
          nonce: 'materialize-capacity-held-nonce',
          nonce_timestamp: later,
          materialization_request_hash: tokenHash('materialize-capacity-held-request'),
          active_fence: {
            action_claim_token_hash: tokenHash('action-claim-token-1'),
            precondition_fingerprint: 'precondition-1',
          },
          now: later,
        });

        await expectWorkerLeaseCount(client, seed.workerId, 1);
        await expect(createLaunchLease(repository, seed, 'capacity-held')).rejects.toMatchObject({
          name: 'DomainError',
          code: 'codex_launch_lease_denied',
        });

        await repository.terminalizeCodexLaunchLease({
          lease_id: seed.lease.id,
          worker_id: seed.workerId,
          worker_session_token: seed.sessionToken,
          nonce: 'terminalize-capacity-held-nonce',
          nonce_timestamp: later,
          terminal_status: 'terminal',
          reason_code: 'completed_after_materialization',
          idempotency_key: 'terminalize-capacity-held',
          now: later,
        });

        await expectWorkerLeaseCount(client, seed.workerId, 0);
        await expect(createLaunchLease(repository, seed, 'capacity-released')).resolves.toMatchObject({ worker_id: seed.workerId });
      } finally {
        await client.pool.end();
      }
    });

    it('releases worker capacity when a leased launch is revoked', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const client = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(client.db);
        const { lease, workerId, revision, binding, version } = await seedRuntime(repository, { maxConcurrency: 1 });

        await repository.revokeCodexLaunchLease({
          lease_id: lease.id,
          reason_code: 'revoked_by_controller',
          idempotency_key: 'drizzle-revoke-release-capacity',
          now: later,
        });
        await repository.revokeCodexLaunchLease({
          lease_id: lease.id,
          reason_code: 'revoked_by_controller',
          idempotency_key: 'drizzle-revoke-release-capacity-replay',
          now: later,
        });

        await expect(
          repository.createOrReplayCodexLaunchLease({
            id: randomUUID(),
            lease_request_id: `lease-request-after-revoke-${randomUUID()}`,
            target: {
              target_type: 'automation_action_run',
              target_id: randomUUID(),
              target_kind: 'generation',
              project_id: binding.project_id,
              repo_id: binding.repo_id,
            },
            worker_id: workerId,
            runtime_profile_revision_id: revision.id,
            runtime_profile_digest: revision.profile_digest,
            credential_binding_id: binding.id,
            credential_binding_version_id: version.id,
            credential_payload_digest: version.payload_digest,
            docker_image_digest: revision.docker_image_digest,
            network_policy_digest: codexCanonicalDigest(revision.network_policy),
            network_provider_config_digest: dockerProxyConfig().provider_config_digest,
            launch_token: 'launch-token-after-revoke',
            launch_attempt: 1,
            expires_at: expiresAt,
            now: later,
          }),
        ).resolves.toMatchObject({ worker_id: workerId });

        const [workerRow] = await client.db
          .select({ leaseCount: codex_worker_registrations.leaseCount })
          .from(codex_worker_registrations)
          .where(eq(codex_worker_registrations.id, workerId))
          .limit(1);
        expect(workerRow).toEqual({ leaseCount: 1 });
      } finally {
        await client.pool.end();
      }
    });

    it('does not double-release capacity when terminalizing the same leased launch concurrently', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const seed = await seedRuntime(firstRepository, { maxConcurrency: 2 });
        await createLaunchLease(firstRepository, seed, 'terminalize-still-active');
        await expectWorkerLeaseCount(firstClient, seed.workerId, 2);
        await installLaunchLeaseUpdateDelay(firstClient, seed.lease.id);

        await Promise.allSettled([
          firstRepository.terminalizeCodexLaunchLease({
            lease_id: seed.lease.id,
            worker_id: seed.workerId,
            worker_session_token: seed.sessionToken,
            nonce: 'terminalize-race-nonce-1',
            nonce_timestamp: later,
            terminal_status: 'terminal',
            reason_code: 'completed_without_materialization',
            idempotency_key: 'terminalize-race-1',
            now: later,
          }),
          secondRepository.terminalizeCodexLaunchLease({
            lease_id: seed.lease.id,
            worker_id: seed.workerId,
            worker_session_token: seed.sessionToken,
            nonce: 'terminalize-race-nonce-2',
            nonce_timestamp: later,
            terminal_status: 'terminal',
            reason_code: 'completed_without_materialization',
            idempotency_key: 'terminalize-race-2',
            now: later,
          }),
        ]);

        await expectWorkerLeaseCount(firstClient, seed.workerId, 1);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('does not double-release capacity when revoking the same leased launch concurrently', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const seed = await seedRuntime(firstRepository, { maxConcurrency: 2 });
        await createLaunchLease(firstRepository, seed, 'revoke-still-active');
        await expectWorkerLeaseCount(firstClient, seed.workerId, 2);
        await installLaunchLeaseUpdateDelay(firstClient, seed.lease.id);

        await Promise.allSettled([
          firstRepository.revokeCodexLaunchLease({
            lease_id: seed.lease.id,
            reason_code: 'revoked_by_controller',
            idempotency_key: 'revoke-race-1',
            now: later,
          }),
          secondRepository.revokeCodexLaunchLease({
            lease_id: seed.lease.id,
            reason_code: 'revoked_by_controller',
            idempotency_key: 'revoke-race-2',
            now: later,
          }),
        ]);

        await expectWorkerLeaseCount(firstClient, seed.workerId, 1);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('does not double-release capacity when expiring leased launches concurrently', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const seed = await seedRuntime(firstRepository, { maxConcurrency: 2 });
        await createLaunchLease(firstRepository, seed, 'expire-still-active', { expiresAt: '2026-05-20T00:20:00.000Z' });
        await expectWorkerLeaseCount(firstClient, seed.workerId, 2);
        await installLaunchLeaseUpdateDelay(firstClient, seed.lease.id);

        await Promise.allSettled([
          firstRepository.expireCodexLaunchLeases('2026-05-20T00:11:00.000Z'),
          secondRepository.expireCodexLaunchLeases('2026-05-20T00:11:00.000Z'),
        ]);

        await expectWorkerLeaseCount(firstClient, seed.workerId, 1);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('does not double-release capacity when recovering stale worker leases concurrently', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const seed = await seedRuntime(firstRepository, { maxConcurrency: 1 });
        await expectWorkerLeaseCount(firstClient, seed.workerId, 1);
        await installLaunchLeaseUpdateDelay(firstClient, seed.lease.id);

        const results = await Promise.allSettled([
          firstRepository.recoverStaleCodexWorkerLeases({
            stale_before: later,
            now: later,
            reason_code: 'worker_stale',
            worker_id: seed.workerId,
          }),
          secondRepository.recoverStaleCodexWorkerLeases({
            stale_before: later,
            now: later,
            reason_code: 'worker_stale',
            worker_id: seed.workerId,
          }),
        ]);

        const recoveredCount = results.reduce((count, result) => {
          if (result.status === 'rejected') {
            throw result.reason;
          }
          return count + result.value.recovered_launch_leases.length;
        }, 0);
        expect(recoveredCount).toBe(1);
        await expectWorkerLeaseCount(firstClient, seed.workerId, 0);
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });

    it('allows only one concurrent launch lease to claim the final worker slot', async () => {
      await resetForgeloopDatabase(usableDatabaseUrl);
      const firstClient = createDbClient({ connectionString: usableDatabaseUrl });
      const secondClient = createDbClient({ connectionString: usableDatabaseUrl });
      try {
        const firstRepository = new DrizzleDeliveryRepository(firstClient.db);
        const secondRepository = new DrizzleDeliveryRepository(secondClient.db);
        const { workerId, revision, binding, version } = await seedRuntime(firstRepository);

        const leaseInput = (suffix: string) => ({
          id: randomUUID(),
          lease_request_id: `lease-request-${suffix}-${randomUUID()}`,
          target: {
            target_type: 'automation_action_run' as const,
            target_id: randomUUID(),
            target_kind: 'generation' as const,
            project_id: binding.project_id,
            repo_id: binding.repo_id,
          },
          worker_id: workerId,
          runtime_profile_revision_id: revision.id,
          runtime_profile_digest: revision.profile_digest,
          credential_binding_id: binding.id,
          credential_binding_version_id: version.id,
          credential_payload_digest: version.payload_digest,
          docker_image_digest: revision.docker_image_digest,
          network_policy_digest: codexCanonicalDigest(revision.network_policy),
          network_provider_config_digest: dockerProxyConfig().provider_config_digest,
          launch_token: `launch-token-${suffix}`,
          launch_attempt: 1,
          expires_at: expiresAt,
          now,
        });

        const [first, second] = await Promise.allSettled([
          firstRepository.createOrReplayCodexLaunchLease(leaseInput('overbook-1')),
          secondRepository.createOrReplayCodexLaunchLease(leaseInput('overbook-2')),
        ]);

        const successes = [first, second].filter((result) => result.status === 'fulfilled');
        const failures = [first, second].filter((result) => result.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          reason: {
            name: 'DomainError',
            code: 'codex_launch_lease_denied',
          },
        });
      } finally {
        await Promise.all([firstClient.pool.end(), secondClient.pool.end()]);
      }
    });
  }
});
