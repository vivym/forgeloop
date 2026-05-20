import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
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
  assertResettableDatabaseUrl,
  codex_credential_binding_versions,
  codex_launch_leases,
  codex_runtime_profile_revisions,
  codex_worker_registrations,
  createDbClient,
  DrizzleDeliveryRepository,
  resetForgeloopDatabase,
  type DeliveryRepository,
} from '../../packages/db/src/index';

const databaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL?.trim() || process.env.FORGELOOP_DATABASE_URL?.trim() || undefined;
const requireConcurrencyDb = process.env.FORGELOOP_REQUIRE_DB_CONCURRENCY === '1';
const now = '2026-05-20T00:00:00.000Z';
const later = '2026-05-20T00:01:00.000Z';
const expiresAt = '2026-05-20T00:10:00.000Z';

const tokenHash = (token: string) => codexCredentialPayloadDigest(token);

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
      source_access_mode: 'artifact_only',
      source_workspace_write_policy: 'none',
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: {
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
  options: { capabilities?: readonly CodexRuntimeProfileRevision['target_kind'][]; maxConcurrency?: number } = {},
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
    provider: 'openai',
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
    status: 'active',
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

  const lease = await repository.createOrReplayCodexLaunchLease({
    id: randomUUID(),
    lease_request_id: `lease-request-${randomUUID()}`,
    target: {
      target_type: 'generation_request',
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
    launch_token: 'launch-token-1',
    action_claim_token_hash: tokenHash('action-claim-token-1'),
    precondition_fingerprint: 'precondition-1',
    expires_at: expiresAt,
    now,
  });

  return { lease, workerId, sessionToken, secretPayload, profile, revision, binding, version };
};

describe('Codex runtime Drizzle materialization concurrency', () => {
  const usableDatabaseUrl = assertUsableDatabaseUrl();

  if (usableDatabaseUrl === undefined) {
    it.skip('skips concurrency test because no safe resettable database URL is configured', () => {});
  } else {
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
          status: 'released',
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
          status: 'leased',
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
          status: 'active',
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
              target_type: 'generation_request',
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
            target_type: 'generation_request' as const,
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
