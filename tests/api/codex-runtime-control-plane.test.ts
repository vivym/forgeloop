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
  codexNetworkPolicyDigestInput,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  type ExecutionPackage,
  type CodexRuntimeProfileRevision,
  type RunSession,
} from '../../packages/domain/src/index';

const secret = 'test-secret';
const now = '2026-05-20T00:00:00.000Z';
const later = '2026-05-20T00:01:00.000Z';
const expiresAt = '2026-05-20T00:10:00.000Z';
const longLaunchLeaseExpiresAt = '2026-05-21T00:00:00.000Z';
const longPublicKeyExpiresAt = '2026-05-21T00:00:00.000Z';
const afterServerSessionTtl = '2026-05-20T00:16:00.000Z';
const actorId = 'setup-admin';
const daemonIdentity = 'codex-runtime-setup';
const projectId = 'project-codex';
const repoId = 'repo-codex';
const workerId = 'worker-codex-1';
const workerIdentity = 'codex-worker-host-1';
const bootstrapToken = 'bootstrap-token-1';
const bootstrapTokenHash = codexCredentialPayloadDigest(bootstrapToken);
const bootstrapTokenVersion = 1;
const clientSuppliedWorkerSessionToken = 'client-supplied-worker-session-token-1';
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
const allowlistRules = [
  {
    id: 'model-provider',
    protocol: 'https' as const,
    host: 'api.openai.test',
    purpose: 'model_provider' as const,
  },
];
const networkPolicy = {
  mode: 'egress_allowlist' as const,
  provider: 'docker_network_proxy' as const,
  allowlist_rules: allowlistRules,
  provider_config: { ...providerConfig, provider_config_digest: providerConfigDigest },
  egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('docker_network_proxy', allowlistRules)),
  self_test_digest: providerConfig.self_test_image_digest,
};
const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(networkPolicy);
const materializedNetworkPolicy = {
  mode: 'egress_allowlist',
  provider: 'docker_network_proxy',
  allowlist_rules: networkPolicy.allowlist_rules,
  provider_config: networkPolicy.provider_config,
  egress_allowlist_digest: networkPolicy.egress_allowlist_digest,
  self_test_digest: providerConfig.self_test_image_digest,
};

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
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
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

const runProfileId = 'profile-run-execution';
const runProfileRevisionId = 'profile-run-execution-revision-1';
const runCredentialBindingId = 'credential-binding-run-execution';
const runCredentialVersionId = 'credential-binding-version-run-execution';
const runLaunchToken = 'run-launch-token-1';

const runProfileBody = () => {
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    ...buildProfileRevision(),
    id: runProfileRevisionId,
    profile_id: runProfileId,
    target_kind: 'run_execution',
    source_access_mode: 'path_policy_scoped',
    effective_config_assertions: {
      target_kind: 'run_execution',
      approval_policy: 'never',
      sandbox_type: 'danger-full-access',
      writable_roots_policy: 'task_workspace_only',
    },
  };
  const revision = {
    ...revisionWithoutDigest,
    profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest),
  };
  return {
    profile: {
      id: runProfileId,
      name: 'Run execution test profile',
      environment: 'test',
      target_kind: 'run_execution',
      active_revision_id: runProfileRevisionId,
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

const runCredentialBody = () => ({
  ...credentialBody(),
  binding: {
    ...credentialBody().binding,
    id: runCredentialBindingId,
    profile_id: runProfileId,
    active_version_id: runCredentialVersionId,
  },
  version: {
    ...credentialBody().version,
    id: runCredentialVersionId,
    binding_id: runCredentialBindingId,
  },
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

const runBootstrapBody = () => ({
  ...bootstrapBody(),
  id: 'bootstrap-id-run-execution',
  allowed_capabilities_json: {
    target_kinds: ['run_execution'],
    docker_image_digests: [runProfileBody().revision.docker_image_digest],
    network_policy_digests: [networkPolicyDigest],
    network_provider_config_digests: [providerConfigDigest],
  },
});

const registerBody = (overrides: Record<string, unknown> = {}) => ({
  worker_id: workerId,
  worker_identity: workerIdentity,
  version: 'codex-worker-test-v1',
  bootstrap_token: bootstrapToken,
  bootstrap_token_version: bootstrapTokenVersion,
  status: 'online',
  control_channel_status: 'connected',
  allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
  capabilities: ['generation'],
  docker_image_digests: [buildProfileRevision().docker_image_digest],
  network_policy_digests: [networkPolicyDigest],
  network_provider_config_digests: [providerConfigDigest],
  host_worker_uid: 501,
  host_worker_gid: 20,
  lease_count: 0,
  max_concurrency: 2,
  session_public_key_id: 'session-key-1',
  session_public_key_algorithm: 'x25519',
  session_public_key_material: 'base64-public-key-material',
  session_public_key_expires_at: expiresAt,
  ...overrides,
});

const heartbeatBody = (sessionToken: string, nonce: string, overrides: Record<string, unknown> = {}) => ({
  session_token: sessionToken,
  nonce,
  nonce_timestamp: later,
  status: 'online',
  control_channel_status: 'connected',
  active_lease_count: 0,
  capabilities: ['generation'],
  ...overrides,
});

const launchLeaseBody = (claim: { id: string; claim_token: string; attempt: number; precondition_fingerprint: string }) => ({
  id: 'lease-1',
  lease_request_id: 'lease-request-1',
  target: {
    target_type: 'automation_action_run',
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
  launch_attempt: 1,
  action_type: 'ensure_plan_draft',
  action_attempt: claim.attempt,
  action_claim_token: claim.claim_token,
  precondition_fingerprint: claim.precondition_fingerprint,
  expires_at: expiresAt,
});

const runExecutionLeaseBody = (lease: { id: string; run_session_id: string; lease_token: string }) => ({
  id: 'lease-run-execution-1',
  lease_request_id: 'lease-request-run-execution-1',
  target: {
    target_type: 'run_session',
    target_id: lease.run_session_id,
    target_kind: 'run_execution',
    project_id: projectId,
    repo_id: repoId,
  },
  worker_id: workerId,
  runtime_profile_revision_id: runProfileRevisionId,
  credential_binding_id: runCredentialBindingId,
  credential_binding_version_id: runCredentialVersionId,
  credential_payload_digest: credentialPayloadDigest,
  launch_token: runLaunchToken,
  launch_attempt: 1,
  execution_package_id: 'execution-package-run-execution-1',
  run_session_id: lease.run_session_id,
  run_worker_lease_id: lease.id,
  run_worker_lease_token: lease.lease_token,
  run_session_status: 'running',
  run_session_updated_at: now,
  execution_package_version: 1,
  expires_at: expiresAt,
});

const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: overrides.id ?? 'execution-package-run-execution-1',
  work_item_id: overrides.work_item_id ?? 'work-item-1',
  spec_id: overrides.spec_id ?? 'spec-1',
  spec_revision_id: overrides.spec_revision_id ?? 'spec-revision-1',
  plan_id: overrides.plan_id ?? 'plan-1',
  plan_revision_id: overrides.plan_revision_id ?? 'plan-revision-1',
  project_id: overrides.project_id ?? projectId,
  repo_id: overrides.repo_id ?? repoId,
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
  ...(overrides.last_run_session_id !== undefined ? { last_run_session_id: overrides.last_run_session_id } : {}),
  ...(overrides.current_run_session_id !== undefined ? { current_run_session_id: overrides.current_run_session_id } : {}),
});

const materializeBody = (sessionToken: string, nonce: string, overrides: Record<string, unknown> = {}) => ({
  launch_token: launchToken,
  worker_session_token: sessionToken,
  nonce,
  nonce_timestamp: later,
  materialization_request_hash: codexCanonicalDigest({ lease_id: 'lease-1', worker_id: workerId }),
  ...overrides,
});

const terminalBody = (sessionToken: string, overrides: Record<string, unknown> = {}) => ({
  worker_session_token: sessionToken,
  nonce: 'terminal-nonce-1',
  nonce_timestamp: later,
  terminal_status: 'terminal',
  reason_code: 'test_terminal',
  idempotency_key: 'terminal-1',
  evidence_summary: { result: 'failed cleanly' },
  ...overrides,
});

const bootApp = async (repository: DeliveryRepository = new InMemoryDeliveryRepository()): Promise<{ app: INestApplication; repository: DeliveryRepository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(repository)
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

const signedGet = (
  app: INestApplication,
  pathAndQuery: string,
  actorClass: 'automation_daemon' | 'human_admin' | 'system_bootstrap' = 'automation_daemon',
) => {
  const headers = signAutomationRequest({
    method: 'GET',
    pathAndQuery,
    rawBody: '',
    actorId,
    actorClass,
    daemonIdentity,
    timestamp: new Date().toISOString(),
    secret,
  });
  return request(app.getHttpServer()).get(pathAndQuery).set(headers);
};

const signedSetupPost = (
  app: INestApplication,
  pathAndQuery: string,
  body: Record<string, unknown>,
  nonce: string,
  actorClass: 'automation_daemon' | 'human_admin' | 'system_bootstrap' = 'human_admin',
) => signedPost(app, pathAndQuery, { ...body, setup_nonce: nonce }, actorClass).set('X-Forgeloop-Setup-Nonce', nonce);

const seedRuntime = async (app: INestApplication, noncePrefix: string) => {
  await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), `${noncePrefix}-setup-profile`).expect(201);
  vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
  await signedSetupPost(app, '/internal/codex-runtime/credentials', credentialBody(), `${noncePrefix}-setup-credential`).expect(201);
  await signedSetupPost(app, '/internal/codex-runtime/worker-bootstrap-tokens', bootstrapBody(), `${noncePrefix}-setup-bootstrap`).expect(201);
};

const registerWorker = async (app: INestApplication, overrides: Record<string, unknown> = {}) => {
  const response = await request(app.getHttpServer()).post('/internal/codex-workers/register').send(registerBody(overrides)).expect(201);
  return response.body as { worker: { id: string }; session_token: string; session_expires_at: string };
};

const claimActionRun = async (repository: DeliveryRepository, suffix = '1', lockedUntil = expiresAt) => {
  const actionId = `action-run-${suffix}`;
  await repository.createOrReplayAutomationActionRun({
    id: actionId,
    action_type: 'ensure_plan_draft',
    target_object_type: 'work_item',
    target_object_id: 'work-item-1',
    target_revision_id: 'spec-revision-1',
    target_status: 'approved',
    idempotency_key: `${actionId}-key`,
    automation_scope: `repo:${projectId}:${repoId}`,
    automation_settings_version: 1,
    capability_fingerprint: 'capability-1',
    precondition_fingerprint: 'precondition-1',
    action_input_json: { project_id: projectId, repo_id: repoId },
    now,
  });
  const claimed = await repository.claimNextAutomationActionRun({
    now,
    claim_token: `action-claim-token-${suffix}`,
    locked_until: lockedUntil,
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
    const { app, repository } = await bootApp();

    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-daemon', 'automation_daemon').expect(403);

    await signedSetupPost(
      app,
      '/internal/codex-runtime/profiles',
      { ...profileBody(), created_by_actor_id: 'different-actor' },
      'nonce-actor-mismatch',
    ).expect(403);

    await signedPost(app, '/internal/codex-runtime/profiles', profileBody(), 'human_admin').expect(401);

    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-signed-body').set(
      'X-Forgeloop-Setup-Nonce',
      'nonce-header-only',
    ).expect(401);

    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-replay').expect(201);
    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-replay').expect(401);
    const restarted = await bootApp(repository);
    await signedSetupPost(restarted.app, '/internal/codex-runtime/profiles', profileBody(), 'nonce-replay').expect(401);

    await signedSetupPost(app, '/internal/codex-runtime/credentials', credentialBody(), 'nonce-credential-no-flag').expect(403);

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(
      app,
      '/internal/codex-runtime/credentials',
      {
        ...credentialBody(),
        binding: { ...credentialBody().binding, provider: 'openai' },
      },
      'nonce-credential-provider',
    ).expect(400);
    const credential = await signedSetupPost(
      app,
      '/internal/codex-runtime/credentials',
      credentialBody(),
      'nonce-credential',
    ).expect(201);
    expect(JSON.stringify(credential.body)).not.toContain('secret_payload_json');
    expect(JSON.stringify(credential.body)).not.toContain('unsafe-db-access-token');
  });

  it('rejects unsafe runtime profile revisions before persistence', async () => {
    const { app } = await bootApp();
    const unpinned = profileBody();
    unpinned.revision = {
      ...unpinned.revision,
      docker_image_digest: 'latest',
    };
    await signedSetupPost(app, '/internal/codex-runtime/profiles', unpinned, 'profile-unpinned').expect(400);

    const secretConfig = profileBody();
    secretConfig.revision = {
      ...secretConfig.revision,
      codex_config_toml: 'auth_token = "do-not-store-here"\n',
      codex_config_digest: codexCanonicalDigest('auth_token = "do-not-store-here"\n'),
    };
    secretConfig.revision = {
      ...secretConfig.revision,
      profile_digest: codexRuntimeProfileRevisionDigest(secretConfig.revision),
    };
    await signedSetupPost(app, '/internal/codex-runtime/profiles', secretConfig, 'profile-secret-config').expect(400);

    const weakAssertions = profileBody();
    weakAssertions.revision = {
      ...weakAssertions.revision,
      effective_config_assertions: {
        target_kind: 'generation',
        approval_policy: 'on-request',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    } as never;
    await signedSetupPost(app, '/internal/codex-runtime/profiles', weakAssertions, 'profile-weak-assertions').expect(400);
  });

  it('keeps public status and bootstrap responses redacted, rejects missing bootstrap, and returns worker session tokens only once', async () => {
    const { app, repository } = await bootApp();
    await signedSetupPost(app, '/internal/codex-runtime/profiles', profileBody(), 'status-profile').expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(app, '/internal/codex-runtime/credentials', credentialBody(), 'status-credential').expect(201);

    const statusQuery = `/internal/codex-runtime/status?project_id=${projectId}&repo_id=${repoId}&target_kind=generation&credential_binding_id=${credentialBindingId}`;
    await request(app.getHttpServer()).get(statusQuery).expect(401);
    const status = await signedGet(app, statusQuery).expect(200);
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

    await request(app.getHttpServer())
      .post('/internal/codex-workers/register')
      .send(registerBody({ session_token: clientSuppliedWorkerSessionToken }))
      .expect(400);

    const registration = await registerWorker(app, { session_public_key_expires_at: longPublicKeyExpiresAt });
    expect(registration).toMatchObject({
      worker: { id: workerId, status: 'online', control_channel_status: 'connected' },
      session_token: expect.any(String),
      session_expires_at: expect.any(String),
    });
    expect(registration.session_token).not.toBe(clientSuppliedWorkerSessionToken);
    expect(new Date(registration.session_expires_at).getTime()).toBeLessThan(new Date(longPublicKeyExpiresAt).getTime());
    expect(new Date(registration.session_expires_at).getTime()).toBeLessThanOrEqual(new Date('2026-05-20T00:15:00.000Z').getTime());
    expect(JSON.stringify(registration.worker)).not.toContain(registration.session_token);
    expect(JSON.stringify(await repository.getCodexRuntimeStatus({ project_id: projectId, repo_id: repoId, target_kind: 'generation', now }))).not.toContain(
      registration.session_token,
    );
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', afterServerSessionTtl);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'heartbeat-after-server-ttl', { nonce_timestamp: afterServerSessionTtl }))
      .expect(400);

    await request(app.getHttpServer()).post('/internal/codex-workers/register').send(registerBody()).expect(400);
  });

  it('uses worker session nonce replay protection for heartbeats', async () => {
    const { app } = await bootApp();
    await seedRuntime(app, 'heartbeat');
    const registration = await registerWorker(app);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'heartbeat-1'))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'heartbeat-stale', { nonce_timestamp: '2026-05-19T23:00:00.000Z' }))
      .expect(401);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'heartbeat-1'))
      .expect(400);
  });

  it('creates generation launch leases only for automation daemon claims and materializes raw auth once for the correct worker', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'materialize');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'materialize-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository);

    await request(app.getHttpServer())
      .post('/internal/codex-launch-leases')
      .send(launchLeaseBody(claimed))
      .expect(401);

    const staleClaim = await claimActionRun(repository, 'stale', now);
    await signedPost(app, '/internal/codex-launch-leases', {
      ...launchLeaseBody(staleClaim),
      id: 'lease-stale-claim',
      lease_request_id: 'lease-request-stale-claim',
      launch_token: 'launch-token-stale-claim',
    }).expect(403);

    const lease = await signedPost(app, '/internal/codex-launch-leases', launchLeaseBody(claimed)).expect(201);
    expect(lease.body).toMatchObject({ lease: { id: 'lease-1', worker_id: workerId }, launch_token: launchToken });

    await repository.completeAutomationActionRun({
      id: claimed.id,
      idempotency_key: claimed.idempotency_key,
      claim_token: 'action-claim-token-1',
      status: 'succeeded',
      finished_at: now,
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/materialize`)
      .send(materializeBody(registration.session_token, 'materialize-stale-action'))
      .expect(400);
    await signedPost(app, '/internal/codex-launch-leases/lease-1/revoke', {
      reason_code: 'test_stale_action_revoke',
      idempotency_key: 'revoke-lease-1',
    }).expect(201);

    const claimedAgain = await claimActionRun(repository, '2');
    const lease2 = await signedPost(app, '/internal/codex-launch-leases', {
      ...launchLeaseBody(claimedAgain),
      id: 'lease-2',
      lease_request_id: 'lease-request-2',
      launch_token: 'launch-token-2',
      expires_at: longLaunchLeaseExpiresAt,
    }).expect(201);
    expect(lease2.body.lease).toMatchObject({ id: 'lease-2', expires_at: expiresAt });

    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', later);
    const lease2Replay = await signedPost(app, '/internal/codex-launch-leases', {
      ...launchLeaseBody(claimedAgain),
      id: 'lease-2',
      lease_request_id: 'lease-request-2',
      launch_token: 'launch-token-2',
      expires_at: longLaunchLeaseExpiresAt,
    }).expect(201);
    expect(lease2Replay.body.lease).toMatchObject({ id: 'lease-2', expires_at: expiresAt });

    await signedPost(app, '/internal/codex-launch-leases', {
      ...launchLeaseBody(claimedAgain),
      id: 'lease-2-duplicate-attempt',
      lease_request_id: 'lease-request-2-duplicate-attempt',
      launch_token: 'launch-token-2-duplicate-attempt',
    }).expect(400);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/wrong-worker/launch-leases/lease-2/materialize`)
      .send(materializeBody(registration.session_token, 'materialize-wrong-worker', { launch_token: 'launch-token-2' }))
      .expect(400);

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '');
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-2/materialize`)
      .send(materializeBody(registration.session_token, 'materialize-unsafe-disabled', { launch_token: 'launch-token-2' }))
      .expect(403);

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    const materialized = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-2/materialize`)
      .send(materializeBody(registration.session_token, 'materialize-1', { launch_token: 'launch-token-2' }))
      .expect(201);
    expect(materialized.body.runtime_profile.network_policy).toEqual(materializedNetworkPolicy);
    expect(materialized.body.runtime_profile).toMatchObject({
      profile_id: profileId,
      revision_id: profileRevisionId,
      environment: 'test',
      docker_image: 'forgeloop/codex-worker:test',
      docker_image_digest: buildProfileRevision().docker_image_digest,
      codex_config_toml: codexConfigToml,
      codex_config_digest: codexCanonicalDigest(codexConfigToml),
      expected_effective_config_digest: sha('4'),
      effective_config_assertions: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
      app_server_required: true,
      resource_limits: resourceLimits,
      docker_policy: {
        app_server_only: true,
        rootless: true,
        read_only_rootfs: true,
        no_new_privileges: true,
        drop_capabilities: ['ALL'],
      },
    });
    expect(materialized.body).toMatchObject({
      lease_id: 'lease-2',
      expires_at: expiresAt,
    });
    expect(materialized.body.credential).toMatchObject({
      binding_id: credentialBindingId,
      version_id: credentialVersionId,
      secret_payload_kind: 'codex_auth_json',
      secret_payload_digest: credentialPayloadDigest,
      secret_payload_json: credentialSecretPayload,
    });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-2/materialize`)
      .send(materializeBody(registration.session_token, 'materialize-2', { launch_token: 'launch-token-2' }))
      .expect(400);

    await signedPost(app, '/internal/codex-runtime/recover-stale-workers', {
      stale_before: later,
      now: later,
      reason_code: 'test_post_materialize_stale_worker',
    })
      .expect(201)
      .expect(({ body }) => {
        expect(body.recovered_launch_leases).toEqual([expect.objectContaining({ id: 'lease-2', status: 'expired' })]);
      });
    await expect(repository.listClaimableAutomationActionRuns({ now: later, limit: 5 })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'action-run-2',
          status: 'gate_pending',
          reason: 'test_post_materialize_stale_worker',
        }),
      ]),
    );
  });

  it('materializes durable launch leases after control-plane service restart without process-local fence state', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'restart-materialize');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'restart-materialize-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository, 'restart-materialize');

    await signedPost(app, '/internal/codex-launch-leases', {
      ...launchLeaseBody(claimed),
      id: 'lease-restart-materialize',
      lease_request_id: 'lease-request-restart-materialize',
      launch_token: 'launch-token-restart-materialize',
    }).expect(201);

    const restarted = await bootApp(repository);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await request(restarted.app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-restart-materialize/materialize`)
      .send(
        materializeBody(registration.session_token, 'materialize-after-service-restart', {
          launch_token: 'launch-token-restart-materialize',
          materialization_request_hash: codexCanonicalDigest({ lease_id: 'lease-restart-materialize', worker_id: workerId }),
        }),
      )
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          lease_id: 'lease-restart-materialize',
          expires_at: expiresAt,
          credential: {
            binding_id: credentialBindingId,
            version_id: credentialVersionId,
            secret_payload_kind: 'codex_auth_json',
            secret_payload_json: credentialSecretPayload,
            secret_payload_digest: credentialPayloadDigest,
          },
        });
      });
  });

  it('creates run-execution launch leases only with active run-worker fences and stalls owning run sessions on recovery', async () => {
    const { app, repository } = await bootApp();
    await signedSetupPost(app, '/internal/codex-runtime/profiles', runProfileBody(), 'run-execution-profile').expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(app, '/internal/codex-runtime/credentials', runCredentialBody(), 'run-execution-credential').expect(201);
    await signedSetupPost(
      app,
      '/internal/codex-runtime/worker-bootstrap-tokens',
      runBootstrapBody(),
      'run-execution-bootstrap',
    ).expect(201);
    const registration = await registerWorker(app, {
      capabilities: ['run_execution'],
      docker_image_digests: [runProfileBody().revision.docker_image_digest],
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(
        heartbeatBody(registration.session_token, 'run-execution-heartbeat', {
          nonce_timestamp: now,
          capabilities: ['run_execution'],
        }),
      )
      .expect(201);

    const runSession = {
      id: 'run-session-run-execution-1',
      execution_package_id: 'execution-package-run-execution-1',
      requested_by_actor_id: 'actor-owner',
      status: 'running',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      runtime_metadata: {
        durability_mode: 'durable',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
        driver_status: 'running',
        worker_lease_status: 'active',
      },
      created_at: now,
      updated_at: now,
    } satisfies RunSession;
    await repository.saveExecutionPackage(executionPackage());
    await repository.saveRunSession(runSession);

    await signedPost(app, '/internal/codex-launch-leases', {
      ...runExecutionLeaseBody({ id: 'missing-run-worker-lease', run_session_id: runSession.id, lease_token: 'unused' }),
      run_worker_lease_token: undefined,
    }).expect(400);

    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'run-worker-api-1',
      lease_token: 'run-worker-token-api-1',
      now,
      expires_at: expiresAt,
    });

    await signedPost(app, '/internal/codex-launch-leases', {
      ...runExecutionLeaseBody(runWorkerLease),
      run_worker_lease_token: 'wrong-run-worker-token',
    }).expect(403);
    await signedPost(app, '/internal/codex-launch-leases', {
      ...runExecutionLeaseBody(runWorkerLease),
      id: 'lease-run-execution-missing-session-fence',
      lease_request_id: 'lease-request-run-execution-missing-session-fence',
      run_session_status: undefined,
    }).expect(400);
    await signedPost(app, '/internal/codex-launch-leases', {
      ...runExecutionLeaseBody(runWorkerLease),
      id: 'lease-run-execution-stale-package-version',
      lease_request_id: 'lease-request-run-execution-stale-package-version',
      execution_package_version: 2,
    }).expect(403);
    await signedPost(app, '/internal/codex-launch-leases', {
      ...runExecutionLeaseBody(runWorkerLease),
      id: 'lease-run-execution-target-mismatch',
      lease_request_id: 'lease-request-run-execution-target-mismatch',
      target: {
        ...runExecutionLeaseBody(runWorkerLease).target,
        target_id: 'wrong-run-session-id',
      },
    }).expect(403);

    const crossScopePackage = executionPackage({
      id: 'execution-package-cross-scope',
      project_id: 'project-cross-scope',
    });
    const crossScopeRunSession = {
      ...runSession,
      id: 'run-session-cross-scope',
      execution_package_id: crossScopePackage.id,
    } satisfies RunSession;
    await repository.saveExecutionPackage(crossScopePackage);
    await repository.saveRunSession(crossScopeRunSession);
    const crossScopeLease = await repository.claimRunWorkerLease({
      run_session_id: crossScopeRunSession.id,
      worker_id: 'run-worker-api-cross-scope',
      lease_token: 'run-worker-token-api-cross-scope',
      now,
      expires_at: expiresAt,
    });
    await signedPost(app, '/internal/codex-launch-leases', {
      ...runExecutionLeaseBody(crossScopeLease),
      id: 'lease-run-execution-cross-scope',
      lease_request_id: 'lease-request-run-execution-cross-scope',
      execution_package_id: crossScopePackage.id,
    }).expect(403);

    const lease = await signedPost(app, '/internal/codex-launch-leases', runExecutionLeaseBody(runWorkerLease)).expect(201);
    expect(lease.body).toMatchObject({ lease: { id: 'lease-run-execution-1', worker_id: workerId }, launch_token: runLaunchToken });

    const firstRecovery = await signedPost(app, '/internal/codex-runtime/recover-stale-workers', {
      stale_before: later,
      now: later,
      reason_code: 'test_run_execution_stale_worker',
    }).expect(201);
    expect(firstRecovery.body).toMatchObject({
      recovered_launch_leases: [expect.objectContaining({ id: 'lease-run-execution-1', status: 'expired' })],
      run_session_transitions: [
        {
          run_session_id: runSession.id,
          execution_package_id: runSession.execution_package_id,
          reason_code: 'test_run_execution_stale_worker',
        },
      ],
    });
    await expect(repository.getRunSession(runSession.id)).resolves.toMatchObject({
      status: 'stalled',
      failure_kind: 'executor_error',
      failure_reason: 'test_run_execution_stale_worker',
      runtime_metadata: expect.objectContaining({
        driver_status: 'stalled',
        worker_lease_status: 'expired',
      }),
    });

    const secondRecovery = await signedPost(app, '/internal/codex-runtime/recover-stale-workers', {
      stale_before: later,
      now: later,
      reason_code: 'test_run_execution_stale_worker',
    }).expect(201);
    expect(secondRecovery.body.recovered_launch_leases).toHaveLength(0);
    expect(secondRecovery.body.run_session_transitions).toHaveLength(0);
  });

  it('rejects terminal evidence summaries with secret-looking keys or values and recovers stale workers idempotently', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'terminal');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'stale-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository);
    await signedPost(app, '/internal/codex-launch-leases', launchLeaseBody(claimed)).expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(terminalBody(registration.session_token, { terminal_status: 'expired', nonce: 'terminal-expired-status' }))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(terminalBody(registration.session_token, { evidence_summary: { token: 'abc' } }))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(terminalBody(registration.session_token, { evidence_summary: { note: 'contains api_key value' }, nonce: 'terminal-nonce-2' }))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(
        terminalBody(registration.session_token, {
          evidence_summary: { app_server_endpoint: 'unix:/tmp/private/codex.sock' },
          nonce: 'terminal-nonce-raw-endpoint',
        }),
      )
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(terminalBody(registration.session_token, { secret_payload_json: { token: 'abc' }, nonce: 'terminal-nonce-3' }))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(
        terminalBody(registration.session_token, {
          evidence_summary: {
            runtime_profile_id: profileId,
            runtime_profile_revision_id: profileRevisionId,
            runtime_profile_digest: buildProfileRevision().profile_digest,
            runtime_target_kind: 'generation',
            source_access_mode: 'artifact_only',
            environment: 'test',
            launch_lease_id: 'lease-1',
            worker_id: '4f1e2d3c4f1e',
            docker_image_digest: buildProfileRevision().docker_image_digest,
            network_policy_digest: networkPolicyDigest,
            app_server_attempted: true,
            selected_execution_mode: 'app_server',
            startup_blocker_code: 'codex_app_server_unavailable',
          },
          nonce: 'terminal-nonce-startup-raw-container',
        }),
      )
      .expect(400);

    const firstRecovery = await signedPost(app, '/internal/codex-runtime/recover-stale-workers', {
      stale_before: later,
      now: later,
      reason_code: 'test_stale_worker',
    }).expect(201);
    expect(firstRecovery.body.recovered_launch_leases).toHaveLength(1);
    await expect(repository.listClaimableAutomationActionRuns({ now: later, limit: 5 })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'action-run-1',
          status: 'gate_pending',
          reason: 'test_stale_worker',
          result_json: expect.objectContaining({ codex_runtime_blocker_code: 'test_stale_worker' }),
        }),
      ]),
    );

    const secondRecovery = await signedPost(app, '/internal/codex-runtime/recover-stale-workers', {
      stale_before: later,
      now: later,
      reason_code: 'test_stale_worker',
    }).expect(201);
    expect(secondRecovery.body.recovered_launch_leases).toHaveLength(0);
  });

  it('accepts strict public Docker runtime evidence as terminal evidence', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'terminal-public-evidence');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'terminal-public-evidence-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository);
    await signedPost(app, '/internal/codex-launch-leases', launchLeaseBody(claimed)).expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(
        terminalBody(registration.session_token, {
          nonce: 'terminal-public-evidence',
          evidence_summary: {
            runtime_profile_id: profileId,
            runtime_profile_revision_id: profileRevisionId,
            runtime_profile_digest: buildProfileRevision().profile_digest,
            runtime_target_kind: 'generation',
            source_access_mode: 'artifact_only',
            environment: 'test',
            credential_binding_id: credentialBindingId,
            credential_binding_version_id: credentialVersionId,
            credential_payload_digest: credentialPayloadDigest,
            launch_lease_id: 'lease-1',
            worker_id: workerId,
            docker_image_digest: buildProfileRevision().docker_image_digest,
            container_id_digest: sha('5'),
            app_server_effective_config_digest: sha('6'),
            network_policy_digest: networkPolicyDigest,
            network_policy_self_test_digest: sha('7'),
            docker_policy_self_check_digest: sha('8'),
            workspace_isolation_digest: sha('9'),
            app_server_attempted: true,
            selected_execution_mode: 'app_server',
          },
        }),
      )
      .expect(201);
  });

  it('accepts public-safe app-server startup failure evidence', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'terminal-startup-evidence');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'terminal-startup-evidence-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository);
    await signedPost(app, '/internal/codex-launch-leases', launchLeaseBody(claimed)).expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send(
        terminalBody(registration.session_token, {
          nonce: 'terminal-startup-evidence',
          evidence_summary: {
            runtime_profile_id: profileId,
            runtime_profile_revision_id: profileRevisionId,
            runtime_profile_digest: buildProfileRevision().profile_digest,
            runtime_target_kind: 'generation',
            source_access_mode: 'artifact_only',
            environment: 'test',
            launch_lease_id: 'lease-1',
            worker_id: workerId,
            docker_image_digest: buildProfileRevision().docker_image_digest,
            network_policy_digest: networkPolicyDigest,
            app_server_attempted: true,
            selected_execution_mode: 'app_server',
            startup_blocker_code: 'codex_app_server_effective_config_mismatch',
          },
        }),
      )
      .expect(201);
  });
});
