import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { signAutomationRequest } from '../../packages/automation/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeProfileRevisionDigest,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src/index';

const secret = 'test-secret';
const now = '2026-05-20T00:00:00.000Z';
const later = '2026-05-20T00:01:00.000Z';
const expiresAt = '2026-05-20T00:10:00.000Z';
const actorId = 'setup-admin';
const daemonIdentity = 'codex-runtime-setup';
const projectId = 'project-codex';
const repoId = 'repo-codex';
const workerId = 'worker-codex-1';
const workerIdentity = 'codex-worker-host-1';
const bootstrapToken = 'bootstrap-token-1';
const bootstrapTokenHash = codexCredentialPayloadDigest(bootstrapToken);
const bootstrapTokenVersion = 1;
const workerSessionToken = 'worker-session-token-1';
const launchToken = 'launch-token-1';
const profileId = 'profile-generation';
const profileRevisionId = 'profile-generation-revision-1';
const credentialBindingId = 'credential-binding-1';
const credentialVersionId = 'credential-binding-version-1';

const apps: INestApplication[] = [];

const sha = (seed: string): string => `sha256:${seed.padEnd(64, seed).slice(0, 64)}`;

const codexConfigToml = 'approval_policy = "never"\n';
const providerConfig = {
  proxy_image: 'forgeloop/codex-proxy:test',
  proxy_image_digest: sha('1'),
  self_test_image: 'forgeloop/codex-proxy-self-test:test',
  self_test_image_digest: sha('2'),
};
const providerConfigDigest = codexCanonicalDigest(providerConfig);
const networkPolicy = {
  mode: 'docker_network_proxy' as const,
  egress: 'allowlist' as const,
  allowlist: [
    {
      id: 'model-provider',
      protocol: 'https' as const,
      host: 'api.openai.test',
      purpose: 'model_provider' as const,
    },
  ],
  provider_config: { ...providerConfig, provider_config_digest: providerConfigDigest },
};
const networkPolicyDigest = codexCanonicalDigest(networkPolicy);

const resourceLimits = {
  cpu_ms: 60_000,
  memory_mb: 2048,
  pids: 256,
  fds: 512,
  workspace_bytes: 10_000_000,
  artifact_bytes: 10_000_000,
  timeout_ms: 300_000,
  output_limit_bytes: 1_000_000,
  run_output_limit_bytes: 1_000_000,
};

const buildProfileRevision = (): CodexRuntimeProfileRevision => {
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    id: profileRevisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'forgeloop/codex-worker:test',
    docker_image_digest: sha('3'),
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: sha('4'),
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_access_mode: 'artifact_only',
      source_workspace_write_policy: 'none',
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: networkPolicy,
    resource_limits: resourceLimits,
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
    profile_digest: '',
    created_by_actor_id: actorId,
    created_at: now,
  };
  return { ...revisionWithoutDigest, profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest) };
};

const profileBody = () => {
  const revision = buildProfileRevision();
  return {
    profile: {
      id: profileId,
      name: 'Generation test profile',
      environment: 'test',
      target_kind: 'generation',
      active_revision_id: profileRevisionId,
      created_by_actor_id: actorId,
      created_at: now,
      updated_at: now,
    },
    revision,
    created_by_actor_id: actorId,
  };
};

const credentialSecretPayload = {
  auth: {
    access_token: 'unsafe-db-access-token',
  },
};
const credentialPayloadDigest = codexCredentialPayloadDigest(credentialSecretPayload);

const credentialBody = () => ({
  binding: {
    id: credentialBindingId,
    profile_id: profileId,
    project_id: projectId,
    repo_id: repoId,
    provider: 'unsafe_db',
    purpose: 'model_provider',
    active_version_id: credentialVersionId,
    created_by_actor_id: actorId,
    created_at: now,
    updated_at: now,
  },
  version: {
    id: credentialVersionId,
    binding_id: credentialBindingId,
    version_number: 1,
    status: 'active',
    payload_digest: credentialPayloadDigest,
    created_by_actor_id: actorId,
    created_at: now,
  },
  secret_payload_json: credentialSecretPayload,
  created_by_actor_id: actorId,
});

const bootstrapBody = () => ({
  id: 'bootstrap-id-1',
  worker_identity: workerIdentity,
  bootstrap_token_hash: bootstrapTokenHash,
  bootstrap_token_version: bootstrapTokenVersion,
  allowed_scopes_json: [{ project_id: projectId, repo_id: repoId }],
  allowed_capabilities_json: {
    target_kinds: ['generation'],
    docker_image_digests: [buildProfileRevision().docker_image_digest],
    network_policy_digests: [networkPolicyDigest],
    network_provider_config_digests: [providerConfigDigest],
  },
  created_by_actor_id: actorId,
  expires_at: expiresAt,
});

const registerBody = (overrides: Record<string, unknown> = {}) => ({
  worker_id: workerId,
  worker_identity: workerIdentity,
  version: 'codex-worker-test-v1',
  bootstrap_token: bootstrapToken,
  bootstrap_token_version: bootstrapTokenVersion,
  session_token: workerSessionToken,
  status: 'online',
  control_channel_status: 'local',
  allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
  capabilities: ['generation'],
  docker_image_digests: [buildProfileRevision().docker_image_digest],
  network_policy_digests: [networkPolicyDigest],
  network_provider_config_digests: [providerConfigDigest],
  host_worker_uid: 501,
  host_worker_gid: 20,
  lease_count: 0,
  max_concurrency: 1,
  session_public_key_id: 'session-key-1',
  session_public_key_algorithm: 'x25519',
  session_public_key_material: 'base64-public-key-material',
  session_public_key_expires_at: expiresAt,
  ...overrides,
});

const heartbeatBody = (nonce: string, overrides: Record<string, unknown> = {}) => ({
  session_token: workerSessionToken,
  nonce,
  nonce_timestamp: later,
  status: 'online',
  control_channel_status: 'local',
  active_lease_count: 0,
  capabilities: ['generation'],
  ...overrides,
});

const launchLeaseBody = (claim: { id: string; claim_token: string; attempt: number; precondition_fingerprint: string }) => ({
  id: 'lease-1',
  lease_request_id: 'lease-request-1',
  target: {
    target_type: 'generation_request',
    target_id: claim.id,
    target_kind: 'generation',
    project_id: projectId,
    repo_id: repoId,
  },
  worker_id: workerId,
  runtime_profile_revision_id: profileRevisionId,
  credential_binding_id: credentialBindingId,
  credential_binding_version_id: credentialVersionId,
  credential_payload_digest: credentialPayloadDigest,
  launch_token: launchToken,
  action_type: 'ensure_plan_draft',
  action_attempt: claim.attempt,
  action_claim_token: claim.claim_token,
  precondition_fingerprint: claim.precondition_fingerprint,
  expires_at: expiresAt,
});

const materializeBody = (nonce: string, overrides: Record<string, unknown> = {}) => ({
  launch_token: launchToken,
  worker_session_token: workerSessionToken,
  nonce,
  nonce_timestamp: later,
  materialization_request_hash: codexCanonicalDigest({ lease_id: 'lease-1', worker_id: workerId }),
  ...overrides,
});

const terminalBody = (overrides: Record<string, unknown> = {}) => ({
  worker_session_token: workerSessionToken,
  nonce: 'terminal-nonce-1',
  nonce_timestamp: later,
  terminal_status: 'expired',
  reason_code: 'test_terminal',
  idempotency_key: 'terminal-1',
  evidence_summary: { result: 'failed cleanly' },
  ...overrides,
});

const bootApp = async (): Promise<{ app: INestApplication; repository: DeliveryRepository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository())
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useLogger(false);
  await app.init();
  apps.push(app);
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository };
};

const signedPost = (
  app: INestApplication,
  pathAndQuery: string,
  body: Record<string, unknown>,
  actorClass: 'automation_daemon' | 'human_admin' | 'system_bootstrap' = 'automation_daemon',
) => {
  const rawBody = JSON.stringify(body);
  const headers = signAutomationRequest({
    method: 'POST',
    pathAndQuery,
    rawBody,
    actorId,
    actorClass,
    daemonIdentity,
    timestamp: new Date().toISOString(),
    secret,
  });
  return request(app.getHttpServer()).post(pathAndQuery).set(headers).set('Content-Type', 'application/json').send(rawBody);
};

const signedSetupPost = (
  app: INestApplication,
  pathAndQuery: string,
  body: Record<string, unknown>,
  nonce: string,
  actorClass: 'automation_daemon' | 'human_admin' | 'system_bootstrap' = 'human_admin',
) => signedPost(app, pathAndQuery, body, actorClass).set('X-Forgeloop-Setup-Nonce', nonce);

const seedRuntime = async (app: INestApplication, noncePrefix: string) => {
  await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), `${noncePrefix}-setup-profile`).expect(201);
  vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
  await signedSetupPost(app, '/internal/codex-runtime/credentials', credentialBody(), `${noncePrefix}-setup-credential`).expect(201);
  await signedSetupPost(app, '/internal/codex-runtime/worker-bootstrap-tokens', bootstrapBody(), `${noncePrefix}-setup-bootstrap`).expect(201);
};

const registerWorker = async (app: INestApplication) =>
  request(app.getHttpServer()).post('/internal/codex-workers/register').send(registerBody()).expect(201);

const claimActionRun = async (repository: DeliveryRepository) => {
  await repository.createOrReplayAutomationActionRun({
    id: 'action-run-1',
    action_type: 'ensure_plan_draft',
    target_object_type: 'work_item',
    target_object_id: 'work-item-1',
    target_revision_id: 'spec-revision-1',
    target_status: 'approved',
    idempotency_key: 'action-run-1-key',
    automation_scope: `repo:${projectId}:${repoId}`,
    automation_settings_version: 1,
    capability_fingerprint: 'capability-1',
    precondition_fingerprint: 'precondition-1',
    action_input_json: { project_id: projectId, repo_id: repoId },
    now,
  });
  const claimed = await repository.claimNextAutomationActionRun({
    now,
    claim_token: 'action-claim-token-1',
    locked_until: expiresAt,
    limit: 1,
  });
  if (claimed === undefined) {
    throw new Error('expected claimed action run');
  }
  return claimed;
};

describe('codex runtime control-plane APIs', () => {
  beforeEach(() => {
    vi.stubEnv('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET', secret);
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', now);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('requires trusted setup actors, body-bound signatures, nonces, actor match, and the unsafe credential flag', async () => {
    const { app } = await bootApp();

    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-daemon', 'automation_daemon').expect(403);

    await signedSetupPost(
      app,
      '/internal/codex-runtime/profiles',
      { ...profileBody(), created_by_actor_id: 'different-actor' },
      'nonce-actor-mismatch',
    ).expect(403);

    await signedPost(app, '/internal/codex-runtime/profiles', profileBody(), 'human_admin').expect(401);

    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-replay').expect(201);
    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-replay').expect(401);

    await signedSetupPost(app, '/internal/codex-runtime/credentials', credentialBody(), 'nonce-credential-no-flag').expect(403);

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    const credential = await signedSetupPost(
      app,
      '/internal/codex-runtime/credentials',
      credentialBody(),
      'nonce-credential',
    ).expect(201);
    expect(JSON.stringify(credential.body)).not.toContain('secret_payload_json');
    expect(JSON.stringify(credential.body)).not.toContain('unsafe-db-access-token');
  });

  it('keeps public status and bootstrap responses redacted, rejects missing bootstrap, and returns worker session tokens only once', async () => {
    const { app, repository } = await bootApp();
    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'status-profile').expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(app, '/internal/codex-runtime/credentials', credentialBody(), 'status-credential').expect(201);

    const status = await request(app.getHttpServer())
      .get(`/internal/codex-runtime/status?project_id=${projectId}&repo_id=${repoId}&target_kind=generation&credential_binding_id=${credentialBindingId}`)
      .expect(200);
    expect(status.body).toMatchObject({
      runtime_profile_id: profileId,
      credential_binding_id: credentialBindingId,
      credential_payload_digest: credentialPayloadDigest,
    });
    expect(JSON.stringify(status.body)).not.toContain('secret_payload_json');
    expect(JSON.stringify(status.body)).not.toContain('unsafe-db-access-token');

    await request(app.getHttpServer()).post('/internal/codex-workers/register').send(registerBody()).expect(400);

    const bootstrap = await signedSetupPost(
      app,
      '/internal/codex-runtime/worker-bootstrap-tokens',
      bootstrapBody(),
      'status-bootstrap',
    ).expect(201);
    expect(JSON.stringify(bootstrap.body)).not.toContain(bootstrapToken);

    const registration = await registerWorker(app);
    expect(registration.body).toMatchObject({ worker: { id: workerId }, session_token: workerSessionToken });
    expect(JSON.stringify(registration.body.worker)).not.toContain(workerSessionToken);
    expect(JSON.stringify(await repository.getCodexRuntimeStatus({ project_id: projectId, repo_id: repoId, target_kind: 'generation', now }))).not.toContain(
      workerSessionToken,
    );

    await request(app.getHttpServer()).post('/internal/codex-workers/register').send(registerBody()).expect(400);
  });

  it('uses worker session nonce replay protection for heartbeats', async () => {
    const { app } = await bootApp();
    await seedRuntime(app, 'heartbeat');
    await registerWorker(app);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody('heartbeat-1'))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody('heartbeat-1'))
      .expect(400);
  });

  it('creates generation launch leases only for automation daemon claims and materializes raw auth once for the correct worker', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'materialize');
    await registerWorker(app);
    const claimed = await claimActionRun(repository);

    await request(app.getHttpServer())
      .post('/internal/codex-launch-leases')
      .send(launchLeaseBody(claimed))
      .expect(401);

    const lease = await signedPost(app, '/internal/codex-launch-leases', launchLeaseBody(claimed)).expect(201);
    expect(lease.body).toMatchObject({ lease: { id: 'lease-1', worker_id: workerId }, launch_token: launchToken });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/wrong-worker/launch-leases/lease-1/materialize`)
      .send(materializeBody('materialize-wrong-worker'))
      .expect(400);

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '');
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/materialize`)
      .send(materializeBody('materialize-unsafe-disabled'))
      .expect(403);

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    const materialized = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/materialize`)
      .send(materializeBody('materialize-1'))
      .expect(201);
    expect(materialized.body.runtime_profile.network_policy).toMatchObject({
      mode: 'docker_network_proxy',
      provider_config: { provider_config_digest: providerConfigDigest },
    });
    expect(materialized.body.credentials).toHaveLength(1);
    expect(materialized.body.credentials[0]).toMatchObject({
      binding_id: credentialBindingId,
      secret_payload_json: credentialSecretPayload,
    });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/materialize`)
      .send(materializeBody('materialize-2'))
      .expect(400);
  });

  it('rejects terminal evidence summaries with secret-looking keys or values and recovers stale workers idempotently', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'terminal');
    await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody('stale-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository);
    await signedPost(app, '/internal/codex-launch-leases', launchLeaseBody(claimed)).expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(terminalBody({ evidence_summary: { token: 'abc' } }))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(terminalBody({ evidence_summary: { note: 'contains api_key value' }, nonce: 'terminal-nonce-2' }))
      .expect(400);

    const firstRecovery = await signedPost(app, '/internal/codex-runtime/recover-stale-workers', {
      stale_before: later,
      now: later,
      reason_code: 'test_stale_worker',
    }).expect(201);
    expect(firstRecovery.body.recovered_launch_leases).toHaveLength(1);

    const secondRecovery = await signedPost(app, '/internal/codex-runtime/recover-stale-workers', {
      stale_before: later,
      now: later,
      reason_code: 'test_stale_worker',
    }).expect(201);
    expect(secondRecovery.body.recovered_launch_leases).toHaveLength(0);
  });
});
