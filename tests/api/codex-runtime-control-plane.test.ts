import { Buffer } from 'node:buffer';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { signAutomationRequest } from '../../packages/automation/src/index';
import { InMemoryDeliveryRepository, type CodexLaunchTokenEnvelopeSealer, type DeliveryRepository } from '../../packages/db/src/index';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexLaunchTokenEnvelopeDigest,
  codexNetworkPolicyDigestInput,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  codexWorkspaceAcquisitionDigest,
  type ExecutionPackage,
  type CodexRuntimeProfileRevision,
  type RunSession,
} from '../../packages/domain/src/index';
import { decryptCodexLaunchTokenEnvelope, generateCodexWorkerSessionKeyPair } from '../../packages/codex-worker-runtime/src/envelope-crypto';
import { workspaceBundleArchiveDigest } from '../../packages/codex-worker-runtime/src/workspace-bundle';

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
const runtimeJobId = 'runtime-job-1';
const runtimeJobLaunchLeaseId = 'runtime-launch-lease-1';
const runtimeJobEnvelopeId = 'runtime-envelope-1';
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
  unsafe_db_acknowledgement: true,
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
  action_type: 'ensure_package_drafts',
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

const buildRunSession = (overrides: Partial<RunSession> = {}): RunSession =>
  ({
    id: overrides.id ?? 'run-session-run-execution-1',
    execution_package_id: overrides.execution_package_id ?? 'execution-package-run-execution-1',
    requested_by_actor_id: overrides.requested_by_actor_id ?? 'actor-owner',
    status: overrides.status ?? 'running',
    changed_files: overrides.changed_files ?? [],
    check_results: overrides.check_results ?? [],
    artifacts: overrides.artifacts ?? [],
    log_refs: overrides.log_refs ?? [],
    runtime_metadata: overrides.runtime_metadata ?? {
      durability_mode: 'durable',
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'confirmed',
      driver_status: 'running',
      worker_lease_status: 'active',
    },
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  }) satisfies RunSession;

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

const materializeBody = (sessionToken: string, nonce: string, overrides: Record<string, unknown> = {}) =>
  withBodyDigest({
    launch_token: launchToken,
    worker_session_token: sessionToken,
    nonce,
    nonce_timestamp: later,
    materialization_request_hash: codexCanonicalDigest({ lease_id: 'lease-1', worker_id: workerId }),
    ...overrides,
  });

const terminalBody = (sessionToken: string, overrides: Record<string, unknown> = {}) =>
  withBodyDigest({
    worker_session_token: sessionToken,
    nonce: 'terminal-nonce-1',
    nonce_timestamp: later,
    terminal_status: 'terminal',
    reason_code: 'test_terminal',
    idempotency_key: 'terminal-1',
    evidence_summary: { result: 'failed cleanly' },
    ...overrides,
  });

const withBodyDigest = <T extends Record<string, unknown>>(body: T): T & { body_digest: string } => ({
  ...body,
  body_digest: codexCanonicalDigest(body),
});

const generatedSpecRevisionPayload = () => ({
  schema_version: 'spec_revision.v1',
  development_plan_item_id: 'item-runtime',
  boundary_summary_revision_id: 'boundary-summary-revision-runtime',
  summary: 'Generated Spec revision',
  content_markdown: 'Implement the approved boundary.',
  problem_context: 'The Development Plan Item needs a Spec revision.',
  scope_in: ['Spec generation'],
  scope_out: ['Execution'],
  acceptance_criteria: ['Draft Spec revision is created'],
  test_strategy: ['API writer tests'],
  risks: ['Stale boundary'],
  assumptions: ['Leader approved boundary summary'],
  unresolved_questions: [],
  public_summary: 'Generated a Spec revision.',
});

const publicDockerRuntimeEvidence = (targetKind: 'generation' | 'run_execution') => {
  const revision = targetKind === 'generation' ? buildProfileRevision() : runProfileBody().revision;
  return {
    runtime_profile_id: revision.profile_id,
    runtime_profile_revision_id: revision.id,
    runtime_profile_digest: revision.profile_digest,
    runtime_target_kind: targetKind,
    source_access_mode: targetKind === 'generation' ? 'artifact_only' : 'path_policy_scoped',
    environment: 'test',
    launch_lease_id: targetKind === 'generation' ? runtimeJobLaunchLeaseId : 'runtime-launch-lease-run-projection',
    worker_id: workerId,
    docker_image_digest: revision.docker_image_digest,
    container_id_digest: codexCanonicalDigest(`${targetKind}:container`),
    app_server_effective_config_digest: codexCanonicalDigest(`${targetKind}:effective-config`),
    docker_policy_self_check_digest: codexCanonicalDigest(`${targetKind}:docker-policy`),
    app_server_attempted: true,
    selected_execution_mode: 'app_server',
  };
};

const forbiddenRuntimeJobProjectionFields = [
  'accept_idempotency_key',
  'accept_request_digest',
  'accepted_worker_session_digest',
  'accepted_session_public_key_id',
  'accepted_session_epoch',
  'materialization_request_id',
  'materialization_request_digest',
  'start_idempotency_key',
  'start_request_digest',
  'runtime_evidence_digest',
  'launch_materialization_digest',
  'cancel_idempotency_key',
  'cancel_request_digest',
  'terminal_idempotency_key',
  'terminal_request_digest',
] as const;

const expectRuntimeJobProjectionRedacted = (runtimeJob: Record<string, unknown>) => {
  for (const field of forbiddenRuntimeJobProjectionFields) {
    expect(runtimeJob[field]).toBeUndefined();
  }
};

const generationSignedContext = (claim: { id: string }) => ({
  context_version: 'generation_context.work_item.v1',
  action_run_id: claim.id,
  work_item_id: 'work-item-1',
});

const generationWorkload = (claim: { id: string }) => ({
  schema_version: 'codex_generation_workload.v1',
  runtime_job_id: runtimeJobId,
  action_run_id: claim.id,
  task_kind: 'spec_draft',
  prompt_version: 'prompt-v1',
  output_schema_version: 'spec-output-v1',
  signed_context_ref: 'signed-context-ref-1',
  signed_context_digest: codexCanonicalDigest(generationSignedContext(claim)),
  prompt_template_digest: sha('b'),
  created_at: now,
  expires_at: expiresAt,
});

const runtimeJobBody = (claim: { id: string; claim_token: string; attempt: number; precondition_fingerprint: string }) => {
  const workload = generationWorkload(claim);
  return {
    runtime_job_id: runtimeJobId,
    launch_lease_id: runtimeJobLaunchLeaseId,
    envelope_id: runtimeJobEnvelopeId,
    job_request_id: 'runtime-job-request-1',
    target: {
      target_type: 'automation_action_run',
      target_id: claim.id,
      target_kind: 'generation',
      project_id: projectId,
      repo_id: repoId,
    },
    runtime_profile_revision_id: profileRevisionId,
    credential_binding_id: credentialBindingId,
    credential_binding_version_id: credentialVersionId,
    credential_payload_digest: credentialPayloadDigest,
    input_json: workload,
    workspace_acquisition_json: {
      schema_version: 'codex_generation_workspace_acquisition.v1',
      signed_context_ref: workload.signed_context_ref,
      signed_context_digest: workload.signed_context_digest,
      signed_context_json: generationSignedContext(claim),
    },
    launch_attempt: 1,
    action_type: 'ensure_package_drafts',
    action_attempt: claim.attempt,
    action_claim_token: claim.claim_token,
    precondition_fingerprint: claim.precondition_fingerprint,
    expires_at: expiresAt,
  };
};

const productSpecRuntimeJobBody = (claim: { id: string; claim_token: string; attempt: number; precondition_fingerprint: string }) => {
  const base = runtimeJobBody(claim);
  const workload = {
    ...(base.input_json as Record<string, unknown>),
    task_kind: 'development_plan_item_spec_revision',
    output_schema_version: 'spec_revision.v1',
  };
  return {
    ...base,
    action_type: 'generate_development_plan_item_spec_revision',
    input_json: workload,
  };
};

const runtimeWorkerBody = (sessionToken: string, nonce: string, body: Record<string, unknown> = {}) =>
  withBodyDigest({
    worker_session_token: sessionToken,
    nonce,
    nonce_timestamp: later,
    ...body,
  });

const runtimeWorkerQuery = (sessionToken: string, nonce: string, query: Record<string, unknown> = {}) =>
  withBodyDigest({
    worker_session_token: sessionToken,
    nonce,
    nonce_timestamp: later,
    ...query,
  });

const binaryParser = (response: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('error', (error) => callback(error));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

const capturingSealer = (capturedLaunchTokens: Map<string, string>): CodexLaunchTokenEnvelopeSealer => ({
  async sealLaunchTokenEnvelope(input) {
    capturedLaunchTokens.set(input.runtime_job_id, input.plaintext_launch_token);
    const aad_json = {
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
      worker_id: input.worker_id,
      key_id: input.key_id,
      expires_at: input.expires_at,
    };
    const envelopeWithoutDigest = {
      id: input.envelope_id,
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      worker_id: input.worker_id,
      key_id: input.key_id,
      algorithm: 'x25519-hkdf-sha256-aes-256-gcm' as const,
      ciphertext: `test-sealed:${codexCredentialPayloadDigest(input.plaintext_launch_token)}`,
      encryption_nonce: codexCanonicalDigest(`nonce:${input.envelope_id}:${input.runtime_job_id}`),
      aad_json,
      aad_digest: codexCanonicalDigest(aad_json),
      expires_at: input.expires_at,
    };
    return {
      ...envelopeWithoutDigest,
      envelope_digest: codexLaunchTokenEnvelopeDigest(envelopeWithoutDigest),
    };
  },
});

const bootApp = async (
  repository: DeliveryRepository = new InMemoryDeliveryRepository(),
  overrides: { productGenerationResultService?: Pick<ProductGenerationResultService, 'handleGenerationRuntimeTerminal'> } = {},
): Promise<{ app: INestApplication; repository: DeliveryRepository }> => {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(repository)
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined });
  if (overrides.productGenerationResultService !== undefined) {
    builder.overrideProvider(ProductGenerationResultService).useValue(overrides.productGenerationResultService);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useLogger(false);
  await app.init();
  apps.push(app);
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository };
};

const bootAppWithDefaultRepository = async (): Promise<{ app: INestApplication; repository: DeliveryRepository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    action_type: 'ensure_package_drafts',
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

const claimProductSpecActionRun = async (repository: DeliveryRepository, suffix = 'product-spec') => {
  const actionId = `action-run-${suffix}`;
  const precondition = {
    source_ref: { type: 'requirement', id: 'requirement-runtime' },
    source_revision_id: 'requirement-runtime-revision',
    development_plan_id: 'development-plan-runtime',
    development_plan_revision_id: 'development-plan-runtime-revision',
    development_plan_item_id: 'item-runtime',
    development_plan_item_revision_id: 'item-runtime-revision',
    boundary_session_id: 'boundary-session-runtime',
    boundary_session_revision_id: 'boundary-session-runtime-revision',
    approved_boundary_summary_revision_id: 'boundary-summary-revision-runtime',
    context_manifest_id: 'context-runtime',
    context_manifest_revision_id: 'context-runtime-revision',
    requested_by_actor_id: actorId,
  };
  await repository.createOrReplayAutomationActionRun({
    id: actionId,
    action_type: 'generate_development_plan_item_spec_revision',
    target_object_type: 'development_plan_item',
    target_object_id: 'item-runtime',
    target_revision_id: 'item-runtime-revision',
    target_status: 'missing',
    idempotency_key: `${actionId}-key`,
    automation_scope: `repo:${projectId}:${repoId}`,
    automation_settings_version: 1,
    capability_fingerprint: 'development-plan-item-spec-runtime:v1',
    precondition_fingerprint: codexCanonicalDigest(precondition),
    action_input_json: {
      development_plan_id: 'development-plan-runtime',
      development_plan_revision_id: 'development-plan-runtime-revision',
      development_plan_item_id: 'item-runtime',
      development_plan_item_revision_id: 'item-runtime-revision',
      boundary_session_id: 'boundary-session-runtime',
      boundary_session_revision_id: 'boundary-session-runtime-revision',
      approved_boundary_summary_revision_id: 'boundary-summary-revision-runtime',
      context_manifest_id: 'context-runtime',
      context_manifest_revision_id: 'context-runtime-revision',
      requested_by_actor_id: actorId,
      precondition_fingerprint_json: precondition,
    },
    now,
  });
  const claimed = await repository.claimNextAutomationActionRun({
    now,
    claim_token: `action-claim-token-${suffix}`,
    locked_until: expiresAt,
    limit: 1,
  });
  if (claimed === undefined) {
    throw new Error('expected claimed product action run');
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
    const credentialWithoutAck = credentialBody() as Record<string, unknown>;
    delete credentialWithoutAck.unsafe_db_acknowledgement;
    await signedSetupPost(
      app,
      '/internal/codex-runtime/credentials',
      credentialWithoutAck,
      'nonce-credential-no-ack',
    ).expect(400);
    vi.stubEnv('NODE_ENV', 'production');
    await signedSetupPost(
      app,
      '/internal/codex-runtime/credentials',
      credentialBody(),
      'nonce-credential-production',
    ).expect(403);
    vi.stubEnv('NODE_ENV', 'test');
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

    const interpolatedConfig = profileBody();
    interpolatedConfig.revision = {
      ...interpolatedConfig.revision,
      codex_config_toml: 'auth_token = "${OPENAI_API_KEY}"\n',
      codex_config_digest: codexCanonicalDigest('auth_token = "${OPENAI_API_KEY}"\n'),
    };
    interpolatedConfig.revision = {
      ...interpolatedConfig.revision,
      profile_digest: codexRuntimeProfileRevisionDigest(interpolatedConfig.revision),
    };
    await signedSetupPost(app, '/internal/codex-runtime/profiles', interpolatedConfig, 'profile-interpolated-config').expect(400);

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

  it('seals decryptable launch token envelopes for no-shared filesystem workers', async () => {
    vi.stubEnv('FORGELOOP_CODEX_NO_SHARED_FILESYSTEM', '1');
    const { app, repository } = await bootAppWithDefaultRepository();
    await seedRuntime(app, 'real-envelope');
    const workerKeyPair = await generateCodexWorkerSessionKeyPair({});
    const registration = await registerWorker(app, {
      session_public_key_id: workerKeyPair.keyId,
      session_public_key_material: workerKeyPair.publicKeyMaterial,
      session_public_key_expires_at: longPublicKeyExpiresAt,
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'real-envelope-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository, 'real-envelope');
    const created = await signedPost(app, '/internal/codex-runtime/runtime-jobs', runtimeJobBody(claimed));
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const acceptedSessionDigest = codexCredentialPayloadDigest(registration.session_token);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/accepted`)
      .send(
        runtimeWorkerBody(registration.session_token, 'real-envelope-accept', {
          accept_idempotency_key: 'real-envelope-accept-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: workerKeyPair.keyId,
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);

    const claimedEnvelope = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/envelope/claim`)
      .send(
        runtimeWorkerBody(registration.session_token, 'real-envelope-claim', {
          envelope_id: runtimeJobEnvelopeId,
          claim_request_id: 'real-envelope-claim-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: workerKeyPair.keyId,
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);

    expect(claimedEnvelope.body.envelope.ciphertext).not.toContain('in-memory:');
    await expect(
      decryptCodexLaunchTokenEnvelope({
        envelope: claimedEnvelope.body.envelope,
        privateKeyHandle: workerKeyPair.privateKeyHandle,
      }),
    ).resolves.toMatch(/^codex-runtime-launch:/);
  });

  it('imports local Codex profiles with Docker-safe default CPU quota', async () => {
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    const { app, repository } = await bootApp();
    const imported = await signedSetupPost(
      app,
      '/internal/codex-runtime/import-local-codex',
      {
        profile_name: 'Imported local Codex generation profile',
        target_kind: 'generation',
        local_source_label: 'docker-safe-cpu-default',
        codex_config_toml: codexConfigToml,
        auth_json: credentialSecretPayload,
        project_id: projectId,
        repo_id: repoId,
        docker_image: 'forgeloop/codex-worker:test',
        docker_image_digest: sha('3'),
        expected_effective_config_digest: sha('4'),
        allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
        network_policy: networkPolicy,
        provider: 'unsafe_db',
        unsafe_db_acknowledgement: true,
        created_by: { actor_id: actorId },
      },
      'import-local-codex-docker-safe-cpu',
    ).expect(201);

    const revision = await repository.getActiveCodexRuntimeProfileRevision({
      project_id: projectId,
      repo_id: repoId,
      target_kind: 'generation',
      runtime_profile_id: imported.body.profile_id,
      now,
    });
    expect(revision?.resource_limits.cpu_ms).toBe(2_000);
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
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-2/materialize`)
      .send({
        launch_token: 'launch-token-2',
        worker_session_token: registration.session_token,
        nonce: 'materialize-missing-digest',
        nonce_timestamp: later,
        materialization_request_hash: codexCanonicalDigest({ lease_id: 'lease-1', worker_id: workerId }),
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-2/materialize`)
      .send({
        ...materializeBody(registration.session_token, 'materialize-bad-digest', { launch_token: 'launch-token-2' }),
        body_digest: sha('bad'),
      })
      .expect(400);
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

  it('honors explicit run-execution credential profile selection when newer active profiles share the scope', async () => {
    const { app, repository } = await bootApp();
    await signedSetupPost(app, '/internal/codex-runtime/profiles', runProfileBody(), 'run-execution-selected-profile').expect(201);
    const newerRunProfile = runProfileBody();
    newerRunProfile.profile = {
      ...newerRunProfile.profile,
      id: 'profile-run-execution-newer',
      name: 'Newer run execution profile',
      active_revision_id: 'profile-run-execution-newer-revision-1',
      created_at: later,
      updated_at: later,
    };
    newerRunProfile.revision = {
      ...newerRunProfile.revision,
      id: 'profile-run-execution-newer-revision-1',
      profile_id: 'profile-run-execution-newer',
      created_at: later,
    };
    newerRunProfile.revision = {
      ...newerRunProfile.revision,
      profile_digest: codexRuntimeProfileRevisionDigest(newerRunProfile.revision),
    };
    await signedSetupPost(app, '/internal/codex-runtime/profiles', newerRunProfile, 'run-execution-newer-profile').expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(app, '/internal/codex-runtime/credentials', runCredentialBody(), 'run-execution-selected-credential').expect(201);
    await signedSetupPost(
      app,
      '/internal/codex-runtime/worker-bootstrap-tokens',
      runBootstrapBody(),
      'run-execution-selected-bootstrap',
    ).expect(201);
    const registration = await registerWorker(app, {
      capabilities: ['run_execution'],
      docker_image_digests: [runProfileBody().revision.docker_image_digest],
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(
        heartbeatBody(registration.session_token, 'run-execution-selected-heartbeat', {
          nonce_timestamp: now,
          capabilities: ['run_execution'],
        }),
      )
      .expect(201);

    const leaseRunSession = buildRunSession({ id: 'run-session-selected-launch-lease' });
    await repository.saveExecutionPackage(executionPackage());
    await repository.saveRunSession(leaseRunSession);
    const leaseRunWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: leaseRunSession.id,
      worker_id: 'run-worker-selected-launch-lease',
      lease_token: 'run-worker-token-selected-launch-lease',
      now,
      expires_at: expiresAt,
    });
    await signedPost(app, '/internal/codex-launch-leases', {
      ...runExecutionLeaseBody(leaseRunWorkerLease),
      id: 'lease-run-execution-selected-profile',
      lease_request_id: 'lease-request-run-execution-selected-profile',
    }).expect(201);

    const runtimeJobExecutionPackage = executionPackage({ id: 'execution-package-selected-runtime-job' });
    const runtimeJobRunSession = buildRunSession({
      id: 'run-session-selected-runtime-job',
      execution_package_id: runtimeJobExecutionPackage.id,
    });
    await repository.saveExecutionPackage(runtimeJobExecutionPackage);
    await repository.saveRunSession(runtimeJobRunSession);
    const runtimeJobRunWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: runtimeJobRunSession.id,
      worker_id: 'run-worker-selected-runtime-job',
      lease_token: 'run-worker-token-selected-runtime-job',
      now,
      expires_at: expiresAt,
    });
    const workspaceBundleBytes = Buffer.from('selected runtime job workspace\n');
    const workspaceBundle = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'workspace-bundle-selected-runtime-job',
      archive_ref: 'artifact:codex-pending-bundles:workspace-bundle-selected-runtime-job',
      archive_digest: workspaceBundleArchiveDigest(workspaceBundleBytes),
      manifest_digest: sha('d'),
      size_bytes: workspaceBundleBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingWorkspaceBundle = {
      bundle_id: workspaceBundle.bundle_id,
      pending_artifact_ref: workspaceBundle.archive_ref,
      archive_digest: workspaceBundle.archive_digest,
      manifest_digest: workspaceBundle.manifest_digest,
      run_worker_lease_id: runtimeJobRunWorkerLease.id,
      size_bytes: workspaceBundle.size_bytes,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceBundle),
      workspace_acquisition_json: workspaceBundle,
      expires_at: expiresAt,
    };
    await repository.createPendingWorkspaceBundleArtifact({
      ...pendingWorkspaceBundle,
      id: '44444444-4444-4444-8444-444444444444',
      run_session_id: runtimeJobRunSession.id,
      execution_package_id: runtimeJobRunSession.execution_package_id,
      archive_bytes_base64: workspaceBundleBytes.toString('base64'),
      request_digest: codexCanonicalDigest({ bundle_id: pendingWorkspaceBundle.bundle_id, archive_digest: pendingWorkspaceBundle.archive_digest }),
      created_at: now,
    });
    const createdRuntimeJob = await signedPost(app, '/internal/codex-runtime/runtime-jobs', {
      runtime_job_id: 'runtime-job-selected-profile',
      launch_lease_id: 'runtime-launch-lease-selected-profile',
      envelope_id: 'runtime-envelope-selected-profile',
      job_request_id: 'runtime-job-request-selected-profile',
      target: {
        target_type: 'run_session',
        target_id: runtimeJobRunSession.id,
        target_kind: 'run_execution',
        project_id: projectId,
        repo_id: repoId,
      },
      runtime_profile_revision_id: runProfileRevisionId,
      credential_binding_id: runCredentialBindingId,
      credential_binding_version_id: runCredentialVersionId,
      credential_payload_digest: credentialPayloadDigest,
      input_json: {
        schema_version: 'codex_run_execution_workload.v1',
        run_session_id: runtimeJobRunSession.id,
        execution_package_id: runtimeJobRunSession.execution_package_id,
        workspace_bundle_id: workspaceBundle.bundle_id,
        workspace_bundle_digest: workspaceBundle.archive_digest,
      },
      workspace_acquisition_json: workspaceBundle,
      pending_workspace_bundle: pendingWorkspaceBundle,
      launch_attempt: 1,
      execution_package_id: runtimeJobRunSession.execution_package_id,
      run_session_id: runtimeJobRunSession.id,
      run_worker_lease_id: runtimeJobRunWorkerLease.id,
      run_worker_lease_token: runtimeJobRunWorkerLease.lease_token,
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_version: 1,
      expires_at: expiresAt,
    });
    expect(createdRuntimeJob.status, JSON.stringify(createdRuntimeJob.body)).toBe(201);
  });

  it('downloads workspace bundle bytes only after pending artifact binding to the accepted runtime job', async () => {
    const { app, repository } = await bootApp();
    await signedSetupPost(app, '/internal/codex-runtime/profiles', runProfileBody(), 'bundle-profile').expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(app, '/internal/codex-runtime/credentials', runCredentialBody(), 'bundle-credential').expect(201);
    await signedSetupPost(app, '/internal/codex-runtime/worker-bootstrap-tokens', runBootstrapBody(), 'bundle-bootstrap').expect(201);
    const registration = await registerWorker(app, {
      capabilities: ['run_execution'],
      docker_image_digests: [runProfileBody().revision.docker_image_digest],
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(
        heartbeatBody(registration.session_token, 'bundle-heartbeat', {
          nonce_timestamp: now,
          capabilities: ['run_execution'],
        }),
      )
      .expect(201);

    const runSession = {
      id: 'run-session-workspace-bundle-1',
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
      },
      created_at: now,
      updated_at: now,
    } satisfies RunSession;
    await repository.saveExecutionPackage(executionPackage());
    await repository.saveRunSession(runSession);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'run-worker-bundle-1',
      lease_token: 'run-worker-bundle-token-1',
      now,
      expires_at: expiresAt,
    });

    const archiveBytes = Buffer.from('workspace bundle bytes\n');
    const archiveDigest = workspaceBundleArchiveDigest(archiveBytes);
    const manifestDigest = sha('b');
    const workspaceAcquisition = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'workspace-bundle-api-1',
      archive_ref: 'artifact:codex-pending-bundles:workspace-bundle-api-1',
      archive_digest: archiveDigest,
      manifest_digest: manifestDigest,
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingWorkspaceBundle = {
      bundle_id: 'workspace-bundle-api-1',
      pending_artifact_ref: workspaceAcquisition.archive_ref,
      archive_digest: archiveDigest,
      manifest_digest: manifestDigest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: archiveBytes.byteLength,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisition),
      workspace_acquisition_json: workspaceAcquisition,
      expires_at: expiresAt,
    };
    await repository.createPendingWorkspaceBundleArtifact({
      ...pendingWorkspaceBundle,
      id: '22222222-2222-4222-8222-222222222222',
      run_session_id: runSession.id,
      execution_package_id: runSession.execution_package_id,
      archive_bytes_base64: archiveBytes.toString('base64'),
      request_digest: codexCanonicalDigest({ bundle_id: pendingWorkspaceBundle.bundle_id, archive_digest: archiveDigest }),
      created_at: now,
    });

    const runtimeJobIdWithBundle = 'runtime-job-workspace-bundle-1';
    const runtimeJobCreateBody = {
      runtime_job_id: runtimeJobIdWithBundle,
      launch_lease_id: 'runtime-launch-lease-workspace-bundle-1',
      envelope_id: 'runtime-envelope-workspace-bundle-1',
      job_request_id: 'runtime-job-request-workspace-bundle-1',
      target: {
        target_type: 'run_session',
        target_id: runSession.id,
        target_kind: 'run_execution',
        project_id: projectId,
        repo_id: repoId,
      },
      runtime_profile_revision_id: runProfileRevisionId,
      credential_binding_id: runCredentialBindingId,
      credential_binding_version_id: runCredentialVersionId,
      credential_payload_digest: credentialPayloadDigest,
      input_json: {
        schema_version: 'codex_run_execution_workload.v1',
        run_session_id: runSession.id,
        execution_package_id: runSession.execution_package_id,
        workspace_bundle_id: pendingWorkspaceBundle.bundle_id,
        workspace_bundle_digest: archiveDigest,
      },
      workspace_acquisition_json: workspaceAcquisition,
      pending_workspace_bundle: pendingWorkspaceBundle,
      launch_attempt: 1,
      execution_package_id: runSession.execution_package_id,
      run_session_id: runSession.id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token: runWorkerLease.lease_token,
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_version: 1,
      expires_at: expiresAt,
    };
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', {
      ...runtimeJobCreateBody,
      runtime_job_id: 'runtime-job-workspace-bundle-extra-field',
      launch_lease_id: 'runtime-launch-lease-workspace-bundle-extra-field',
      envelope_id: 'runtime-envelope-workspace-bundle-extra-field',
      job_request_id: 'runtime-job-request-workspace-bundle-extra-field',
      workspace_acquisition_json: {
        ...workspaceAcquisition,
        local_path: '/tmp/raw-workspace',
      },
    }).expect(400);
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', runtimeJobCreateBody).expect(201);

    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobIdWithBundle}/workspace-bundle/${pendingWorkspaceBundle.bundle_id}`)
      .query(runtimeWorkerQuery(registration.session_token, 'workspace-bundle-before-accept'))
      .expect(400);

    const acceptedSessionDigest = codexCredentialPayloadDigest(registration.session_token);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobIdWithBundle}/accepted`)
      .send(
        runtimeWorkerBody(registration.session_token, 'workspace-bundle-accept', {
          accept_idempotency_key: 'workspace-bundle-accept-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);

    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobIdWithBundle}/workspace-bundle/other-bundle`)
      .query(runtimeWorkerQuery(registration.session_token, 'workspace-bundle-wrong-bundle'))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/internal/codex-workers/wrong-worker/runtime-jobs/${runtimeJobIdWithBundle}/workspace-bundle/${pendingWorkspaceBundle.bundle_id}`)
      .query(runtimeWorkerQuery(registration.session_token, 'workspace-bundle-wrong-worker'))
      .expect(400);

    const downloaded = await request(app.getHttpServer())
      .get(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobIdWithBundle}/workspace-bundle/${pendingWorkspaceBundle.bundle_id}`)
      .query(runtimeWorkerQuery(registration.session_token, 'workspace-bundle-download'))
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(downloaded.headers['content-type']).toContain('application/vnd.forgeloop.workspace-bundle');
    expect(downloaded.headers['x-forgeloop-workspace-bundle-digest']).toBe(archiveDigest);
    expect(downloaded.body).toEqual(archiveBytes);

    await signedPost(app, `/internal/codex-runtime/runtime-jobs/${runtimeJobIdWithBundle}/cancel`, {
      reason_code: 'test_cancel',
      idempotency_key: 'workspace-bundle-cancel-1',
    }).expect(201);
    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobIdWithBundle}/workspace-bundle/${pendingWorkspaceBundle.bundle_id}`)
      .query(runtimeWorkerQuery(registration.session_token, 'workspace-bundle-after-cancel'))
      .expect(400);
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
      .send({
        worker_session_token: registration.session_token,
        nonce: 'terminal-missing-digest',
        nonce_timestamp: later,
        terminal_status: 'terminal',
        reason_code: 'test_terminal',
        idempotency_key: 'terminal-missing-digest',
        evidence_summary: { result: 'failed cleanly' },
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/launch-leases/lease-1/terminal`)
      .send({
        ...terminalBody(registration.session_token, { nonce: 'terminal-bad-digest' }),
        body_digest: sha('bad'),
      })
      .expect(400);
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

  it('dispatches successful product generation terminal results to the product writer', async () => {
    const productWriter = {
      handleGenerationRuntimeTerminal: vi.fn().mockResolvedValue({ applied: true }),
    };
    const capturedLaunchTokens = new Map<string, string>();
    const { app, repository } = await bootApp(
      new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) }),
      { productGenerationResultService: productWriter },
    );
    await seedRuntime(app, 'runtime-product-terminal');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'runtime-product-terminal-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimProductSpecActionRun(repository);
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', productSpecRuntimeJobBody(claimed)).expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/accepted`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-accept', {
          accept_idempotency_key: 'runtime-product-terminal-accept-1',
          accepted_worker_session_digest: codexCredentialPayloadDigest(registration.session_token),
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/envelope/claim`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-envelope-claim', {
          envelope_id: runtimeJobEnvelopeId,
          claim_request_id: 'runtime-product-terminal-envelope-claim-1',
          accepted_worker_session_digest: codexCredentialPayloadDigest(registration.session_token),
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/materialize`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-materialize', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          launch_token: capturedLaunchTokens.get(runtimeJobId),
          materialization_request_id: 'runtime-product-terminal-materialize-1',
          accepted_worker_session_digest: codexCredentialPayloadDigest(registration.session_token),
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    const started = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/started`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-start', {
          start_idempotency_key: 'runtime-product-terminal-start-1',
          runtime_evidence_digest: sha('a'),
          launch_materialization_digest: sha('b'),
        }),
      );
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const generatedPayload = generatedSpecRevisionPayload();
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/terminal`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          terminal_status: 'succeeded',
          reason_code: 'completed',
          terminal_idempotency_key: 'runtime-product-terminal-1',
          terminal_result_json: {
            task_kind: 'development_plan_item_spec_revision',
            prompt_version: 'prompt-v1',
            output_schema_version: 'spec_revision.v1',
            generated_payload: generatedPayload,
            generated_payload_digest: codexCanonicalDigest(generatedPayload),
            generation_artifacts: [],
            public_summary: 'Generated a Spec revision.',
          },
        }),
      )
      .expect(201);

    expect(productWriter.handleGenerationRuntimeTerminal).toHaveBeenCalledWith({
      runtimeJobId,
      actionRunId: claimed.id,
      terminalResult: expect.objectContaining({
        task_kind: 'development_plan_item_spec_revision',
        generated_payload: generatedPayload,
      }),
    });
  });

  it('fails the owned product generation action when its runtime job terminalizes failed', async () => {
    const productWriter = {
      handleGenerationRuntimeTerminal: vi.fn().mockResolvedValue({ applied: true }),
    };
    const capturedLaunchTokens = new Map<string, string>();
    const { app, repository } = await bootApp(
      new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) }),
      { productGenerationResultService: productWriter },
    );
    await seedRuntime(app, 'runtime-product-terminal-failed');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'runtime-product-terminal-failed-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimProductSpecActionRun(repository, 'product-spec-failed');
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', productSpecRuntimeJobBody(claimed)).expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/accepted`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-failed-accept', {
          accept_idempotency_key: 'runtime-product-terminal-failed-accept-1',
          accepted_worker_session_digest: codexCredentialPayloadDigest(registration.session_token),
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/envelope/claim`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-failed-envelope-claim', {
          envelope_id: runtimeJobEnvelopeId,
          claim_request_id: 'runtime-product-terminal-failed-envelope-claim-1',
          accepted_worker_session_digest: codexCredentialPayloadDigest(registration.session_token),
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/materialize`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-failed-materialize', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          launch_token: capturedLaunchTokens.get(runtimeJobId),
          materialization_request_id: 'runtime-product-terminal-failed-materialize-1',
          accepted_worker_session_digest: codexCredentialPayloadDigest(registration.session_token),
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/started`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-failed-start', {
          start_idempotency_key: 'runtime-product-terminal-failed-start-1',
          runtime_evidence_digest: sha('c'),
          launch_materialization_digest: sha('d'),
        }),
      )
      .expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/terminal`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-product-terminal-failed', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          terminal_status: 'failed',
          reason_code: 'codex_generation_turn_failed',
          terminal_idempotency_key: 'runtime-product-terminal-failed-1',
        }),
      )
      .expect(201);

    expect(productWriter.handleGenerationRuntimeTerminal).not.toHaveBeenCalled();
    await expect(repository.getAutomationActionRun(claimed.id)).resolves.toMatchObject({
      id: claimed.id,
      status: 'failed',
      result_json: {
        product_generation_result: 'runtime_job_failed',
        reason_code: 'codex_generation_turn_failed',
        runtime_job_id: runtimeJobId,
      },
      retryable: true,
    });
  });

  it('drives remote runtime jobs through sealed-envelope worker APIs without exposing launch tokens', async () => {
    const capturedLaunchTokens = new Map<string, string>();
    const { app, repository } = await bootApp(
      new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) }),
    );
    await seedRuntime(app, 'runtime-job');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'runtime-job-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository, 'runtime-job');

    await request(app.getHttpServer()).post('/internal/codex-runtime/runtime-jobs').send(runtimeJobBody(claimed)).expect(401);

    const created = await signedPost(app, '/internal/codex-runtime/runtime-jobs', runtimeJobBody(claimed)).expect(201);
    expect(created.body).toMatchObject({
      runtime_job: {
        id: runtimeJobId,
        status: 'queued',
        worker_id: workerId,
        launch_lease_id: runtimeJobLaunchLeaseId,
      },
      launch_lease: {
        id: runtimeJobLaunchLeaseId,
        status: 'active',
        worker_id: workerId,
      },
      envelope: {
        id: runtimeJobEnvelopeId,
        runtime_job_id: runtimeJobId,
        launch_lease_id: runtimeJobLaunchLeaseId,
        status: 'available',
      },
    });
    expect(JSON.stringify(created.body)).not.toContain('launch_token');
    expect(JSON.stringify(created.body)).not.toContain('codex-runtime-launch');
    expect(JSON.stringify(created.body)).not.toContain('test-sealed:');
    expect(created.body.envelope.key_id).toBeUndefined();
    expect(created.body.envelope.algorithm).toBeUndefined();
    expect(created.body.envelope.aad_digest).toBeUndefined();
    expect(created.body.envelope.ciphertext).toBeUndefined();
    expect(created.body.envelope.encryption_nonce).toBeUndefined();
    expect(created.body.envelope.aad_json).toBeUndefined();

    await signedGet(app, `/internal/codex-runtime/runtime-jobs/${runtimeJobId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({ id: runtimeJobId, status: 'queued' });
        expect(body.envelope).toMatchObject({ id: runtimeJobEnvelopeId, envelope_digest: created.body.envelope.envelope_digest });
        expect(JSON.stringify(body)).not.toContain('launch_token');
        expect(JSON.stringify(body)).not.toContain('codex-runtime-launch');
        expect(JSON.stringify(body)).not.toContain('test-sealed:');
        expect(body.envelope.key_id).toBeUndefined();
        expect(body.envelope.algorithm).toBeUndefined();
        expect(body.envelope.aad_digest).toBeUndefined();
        expect(body.envelope.ciphertext).toBeUndefined();
        expect(body.envelope.encryption_nonce).toBeUndefined();
        expect(body.envelope.aad_json).toBeUndefined();
      });

    await signedGet(app, `/internal/codex-launch-leases/${runtimeJobLaunchLeaseId}/status`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: runtimeJobLaunchLeaseId, status: 'active', worker_id: workerId });
        expect(JSON.stringify(body)).not.toContain('codex-runtime-launch');
      });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/poll`)
      .send({
        worker_session_token: registration.session_token,
        nonce: 'runtime-job-poll-missing-digest',
        nonce_timestamp: later,
        limit: 1,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/poll`)
      .send({
        ...runtimeWorkerBody(registration.session_token, 'runtime-job-poll-bad-digest', { limit: 1 }),
        body_digest: sha('c'),
      })
      .expect(400);

    const poll = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/poll`)
      .send(runtimeWorkerBody(registration.session_token, 'runtime-job-poll', { limit: 1, target_kinds: ['generation'] }))
      .expect(201);
    expect(poll.body.runtime_jobs).toEqual([
      expect.objectContaining({
        runtime_job: expect.objectContaining({
          id: runtimeJobId,
          status: 'queued',
          input: expect.objectContaining({
            input_digest: codexCanonicalDigest(generationWorkload(claimed)),
            schema_version: 'codex_generation_workload.v1',
          }),
        }),
        envelope: expect.objectContaining({ id: runtimeJobEnvelopeId, envelope_digest: created.body.envelope.envelope_digest }),
      }),
    ]);
    expect(poll.body.runtime_jobs[0].runtime_job.input_json).toBeUndefined();
    expect(poll.body.runtime_jobs[0].envelope.key_id).toBeUndefined();
    expect(poll.body.runtime_jobs[0].envelope.algorithm).toBeUndefined();
    expect(poll.body.runtime_jobs[0].envelope.aad_digest).toBeUndefined();
    expect(poll.body.runtime_jobs[0].envelope.ciphertext).toBeUndefined();
    expect(poll.body.runtime_jobs[0].envelope.encryption_nonce).toBeUndefined();
    expect(poll.body.runtime_jobs[0].envelope.aad_json).toBeUndefined();
    expect(JSON.stringify(poll.body)).not.toContain('codex-runtime-launch');
    expect(JSON.stringify(poll.body)).not.toContain('test-sealed:');

    const acceptedSessionDigest = codexCredentialPayloadDigest(registration.session_token);
    const acceptBody = runtimeWorkerBody(registration.session_token, 'runtime-job-accept', {
      accept_idempotency_key: 'runtime-job-accept-1',
      accepted_worker_session_digest: acceptedSessionDigest,
      accepted_session_public_key_id: 'session-key-1',
      accepted_session_epoch: 1,
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/accepted`)
      .send(acceptBody)
      .expect(201)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({ id: runtimeJobId, status: 'accepted' });
        expectRuntimeJobProjectionRedacted(body.runtime_job);
      });

    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/workload`)
      .query(runtimeWorkerQuery(registration.session_token, 'runtime-job-workload'))
      .expect(200)
      .expect(({ body }) => {
        expect(body.workload).toEqual(generationWorkload(claimed));
        expect(body.signed_context).toEqual(generationSignedContext(claimed));
        expect(codexCanonicalDigest(body.signed_context)).toBe(body.workload.signed_context_digest);
      });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/envelope/claim`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-envelope-claim', {
          envelope_id: runtimeJobEnvelopeId,
          claim_request_id: 'runtime-job-envelope-claim-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201)
      .expect(({ body }) => {
        expect(body.envelope).toMatchObject({ id: runtimeJobEnvelopeId, status: 'claimed' });
        expect(body.envelope.ciphertext).toEqual(expect.stringContaining('test-sealed:'));
        expect(JSON.stringify(body)).not.toContain('codex-runtime-launch');
      });

    const remoteLaunchToken = capturedLaunchTokens.get(runtimeJobId);
    expect(remoteLaunchToken).toEqual(expect.stringMatching(/^codex-runtime-launch:/));

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/artifacts`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-startup-failure-artifact', {
          artifact_idempotency_key: 'runtime-job-startup-failure-artifact-1',
          kind: 'startup_failure_evidence',
          name: 'startup-failure-evidence.json',
          content_type: 'application/json',
          digest: sha('a'),
          size_bytes: 12,
          metadata_json: {
            reason_code: 'codex_workspace_bundle_invalid',
            failure_subcode: 'job_temp_root_already_exists',
            public_summary: 'Remote Codex workspace bundle validation failed.',
          },
        }),
      )
      .expect(201)
      .expect(({ body }) => {
        expect(body.artifact).toMatchObject({
          runtime_job_id: runtimeJobId,
          kind: 'startup_failure_evidence',
          metadata_json: {
            reason_code: 'codex_workspace_bundle_invalid',
            failure_subcode: 'job_temp_root_already_exists',
          },
        });
      });

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/materialize`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-materialize', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          launch_token: remoteLaunchToken,
          materialization_request_id: 'runtime-job-materialize-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          launch_target: { target_id: claimed.id, target_kind: 'generation' },
          lease_id: runtimeJobLaunchLeaseId,
          credential: {
            binding_id: credentialBindingId,
            version_id: credentialVersionId,
            secret_payload_json: credentialSecretPayload,
          },
        });
        expect(JSON.stringify(body)).not.toContain('launch_token');
        expect(JSON.stringify(body)).not.toContain(remoteLaunchToken);
      });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/started`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-start', {
          start_idempotency_key: 'runtime-job-start-1',
          runtime_evidence_digest: sha('d'),
          launch_materialization_digest: sha('e'),
        }),
      )
      .expect(201)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({ id: runtimeJobId, status: 'running' });
        expectRuntimeJobProjectionRedacted(body.runtime_job);
      });

    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/workload`)
      .query(runtimeWorkerQuery(registration.session_token, 'runtime-job-workload-after-start'))
      .expect(400);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/events`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-event', {
          event_id: 'runtime-job-event-1',
          event_idempotency_key: 'runtime-job-event-key-1',
          event_type: 'runtime_progress',
          event_payload_json: { phase: 'running' },
          event_payload_digest: codexCanonicalDigest({ phase: 'running' }),
        }),
      )
      .expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/artifacts`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-artifact', {
          artifact_idempotency_key: 'runtime-job-artifact-1',
          kind: 'generated_payload',
          name: 'generated-payload.json',
          content_type: 'application/json',
          digest: sha('f'),
          size_bytes: 12,
          metadata_json: {},
        }),
      )
      .expect(201)
      .expect(({ body }) => {
        expect(body.artifact).toMatchObject({
          runtime_job_id: runtimeJobId,
          project_id: projectId,
          repo_id: repoId,
          target_kind: 'generation',
          content_type: 'application/json',
          digest: sha('f'),
          size_bytes: 12,
        });
        expect(body.artifact.internal_ref).toMatch(
          new RegExp(`^artifact://codex-runtime-jobs/${runtimeJobId}/artifacts/[0-9a-f-]{36}$`),
        );
        expect(JSON.stringify(body)).not.toContain('launch_token');
        expect(JSON.stringify(body)).not.toContain(remoteLaunchToken);
      });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/terminal`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-terminal-invented-artifact-ref', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          terminal_status: 'succeeded',
          reason_code: 'completed',
          terminal_idempotency_key: 'runtime-job-terminal-invented-artifact-ref',
          terminal_result_json: {
            task_kind: 'spec_draft',
            prompt_version: 'prompt-v1',
            output_schema_version: 'SPEC-draft.v1',
            generated_payload: { summary: 'completed' },
            generated_payload_digest: sha('g'),
            generation_artifacts: [
              {
                kind: 'generated_payload',
                name: 'generated-payload.json',
                content_type: 'application/json',
                digest: sha('g'),
                internal_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/artifacts/worker-invented`,
              },
            ],
            public_summary: 'completed',
          },
        }),
      )
      .expect(400);

    await signedPost(app, `/internal/codex-runtime/runtime-jobs/${runtimeJobId}/cancel`, {
      reason_code: 'test_cancel',
      idempotency_key: 'runtime-job-cancel-1',
    })
      .expect(201)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({ id: runtimeJobId, status: 'running', cancel_requested_at: now });
        expectRuntimeJobProjectionRedacted(body.runtime_job);
      });

    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/control`)
      .query(runtimeWorkerQuery(registration.session_token, 'runtime-job-control'))
      .expect(200)
      .expect(({ body }) => {
        expect(body.control).toMatchObject({ cancel_requested: true, drain_requested: true });
      });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/terminal`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-terminal', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          terminal_status: 'cancelled',
          reason_code: 'test_cancel',
          terminal_idempotency_key: 'runtime-job-terminal-1',
        }),
      )
      .expect(201)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({
          id: runtimeJobId,
          status: 'terminal',
          terminal_status: 'cancelled',
          terminal_reason_code: 'test_cancel',
        });
        expectRuntimeJobProjectionRedacted(body.runtime_job);
      });

    await signedPost(app, '/internal/codex-runtime/runtime-jobs/recover-stale', {
      stale_before: later,
      now: later,
      reason_code: 'codex_runtime_job_stale',
    })
      .expect(201)
      .expect(({ body }) => {
        expect(body.recovered_runtime_jobs).toHaveLength(0);
      });
  });

  it('projects generation runtime job schema and public-safe app-server evidence for dogfood checks', async () => {
    const capturedLaunchTokens = new Map<string, string>();
    const { app, repository } = await bootApp(
      new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) }),
    );
    await seedRuntime(app, 'runtime-job-projection-generation');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'runtime-job-projection-generation-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimProductSpecActionRun(repository, 'projection-generation');
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', productSpecRuntimeJobBody(claimed)).expect(201);

    const acceptedSessionDigest = codexCredentialPayloadDigest(registration.session_token);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/accepted`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-generation-accept', {
          accept_idempotency_key: 'runtime-job-projection-generation-accept-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/envelope/claim`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-generation-envelope-claim', {
          envelope_id: runtimeJobEnvelopeId,
          claim_request_id: 'runtime-job-projection-generation-envelope-claim-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/materialize`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-generation-materialize', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          launch_token: capturedLaunchTokens.get(runtimeJobId),
          materialization_request_id: 'runtime-job-projection-generation-materialize-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    const runtimeEvidence = publicDockerRuntimeEvidence('generation');
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/started`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-generation-start', {
          start_idempotency_key: 'runtime-job-projection-generation-start-1',
          runtime_evidence_digest: codexCanonicalDigest(runtimeEvidence),
          launch_materialization_digest: codexCanonicalDigest({ lease_id: runtimeJobLaunchLeaseId }),
        }),
      )
      .expect(201);

    const generatedPayload = generatedSpecRevisionPayload();
    const generatedPayloadDigest = codexCanonicalDigest(generatedPayload);
    const artifact = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/artifacts`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-generation-artifact', {
          artifact_idempotency_key: 'runtime-job-projection-generation-artifact-1',
          kind: 'generated_payload',
          name: 'generated-payload.json',
          content_type: 'application/json',
          digest: generatedPayloadDigest,
          size_bytes: 12,
          metadata_json: {
            output_schema_version: 'spec_revision.v1',
            generated_payload: { schema_version: 'spec_revision.v1' },
          },
        }),
      )
      .expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/terminal`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-generation-terminal', {
          launch_lease_id: runtimeJobLaunchLeaseId,
          terminal_status: 'succeeded',
          reason_code: 'codex_runtime_job_succeeded',
          terminal_idempotency_key: 'runtime-job-projection-generation-terminal-1',
          terminal_result_json: {
            task_kind: 'development_plan_item_spec_revision',
            prompt_version: 'prompt-v1',
            output_schema_version: 'spec_revision.v1',
            generated_payload: generatedPayload,
            generated_payload_digest: generatedPayloadDigest,
            generation_artifacts: [
              {
                kind: 'generated_payload',
                name: 'generated-payload.json',
                content_type: 'application/json',
                digest: generatedPayloadDigest,
                internal_ref: artifact.body.artifact.internal_ref,
              },
            ],
            runtime_evidence: runtimeEvidence,
            public_summary: 'Generated a Spec revision.',
          },
        }),
      )
      .expect(201);

    await signedGet(app, `/internal/codex-runtime/runtime-jobs/${runtimeJobId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({
          id: runtimeJobId,
          input: {
            schema_version: 'codex_generation_workload.v1',
            output_schema_version: 'spec_revision.v1',
          },
          terminal_result_json: {
            task_kind: 'development_plan_item_spec_revision',
            generated_payload: generatedPayload,
            generated_payload_digest: generatedPayloadDigest,
            public_summary: 'Generated a Spec revision.',
            output_schema_version: 'spec_revision.v1',
            runtime_evidence: {
              app_server_attempted: true,
              selected_execution_mode: 'app_server',
            },
          },
        });
        expect(body.artifacts).toContainEqual(
          expect.objectContaining({
            kind: 'generated_payload',
            metadata_json: expect.objectContaining({
              output_schema_version: 'spec_revision.v1',
              generated_payload: expect.objectContaining({ schema_version: 'spec_revision.v1' }),
            }),
          }),
        );
        expectRuntimeJobProjectionRedacted(body.runtime_job);
        expect(JSON.stringify(body)).not.toContain('launch_token');
        expect(JSON.stringify(body)).not.toContain('docker-exec:');
      });
  });

  it('projects run-execution runtime job schema and public-safe app-server evidence for dogfood checks', async () => {
    const capturedLaunchTokens = new Map<string, string>();
    const { app, repository } = await bootApp(
      new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) }),
    );
    await signedSetupPost(app, '/internal/codex-runtime/profiles', runProfileBody(), 'runtime-job-projection-run-profile').expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(app, '/internal/codex-runtime/credentials', runCredentialBody(), 'runtime-job-projection-run-credential').expect(201);
    await signedSetupPost(
      app,
      '/internal/codex-runtime/worker-bootstrap-tokens',
      runBootstrapBody(),
      'runtime-job-projection-run-bootstrap',
    ).expect(201);
    const registration = await registerWorker(app, {
      capabilities: ['run_execution'],
      docker_image_digests: [runProfileBody().revision.docker_image_digest],
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(
        heartbeatBody(registration.session_token, 'runtime-job-projection-run-heartbeat', {
          nonce_timestamp: now,
          capabilities: ['run_execution'],
        }),
      )
      .expect(201);

    const runSession = buildRunSession({
      id: 'run-session-run-projection',
      execution_package_id: 'execution-package-run-projection',
    });
    await repository.saveExecutionPackage(executionPackage({ id: runSession.execution_package_id }));
    await repository.saveRunSession(runSession);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'run-worker-run-projection',
      lease_token: 'run-worker-token-run-projection',
      now,
      expires_at: expiresAt,
    });
    const archiveBytes = Buffer.from('run projection workspace\n');
    const workspaceAcquisition = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'workspace-bundle-run-projection',
      archive_ref: 'artifact:codex-pending-bundles:workspace-bundle-run-projection',
      archive_digest: workspaceBundleArchiveDigest(archiveBytes),
      manifest_digest: codexCanonicalDigest('run-projection-manifest'),
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingWorkspaceBundle = {
      bundle_id: workspaceAcquisition.bundle_id,
      pending_artifact_ref: workspaceAcquisition.archive_ref,
      archive_digest: workspaceAcquisition.archive_digest,
      manifest_digest: workspaceAcquisition.manifest_digest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: workspaceAcquisition.size_bytes,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisition),
      workspace_acquisition_json: workspaceAcquisition,
      expires_at: expiresAt,
    };
    await repository.createPendingWorkspaceBundleArtifact({
      ...pendingWorkspaceBundle,
      id: '55555555-5555-4555-8555-555555555555',
      run_session_id: runSession.id,
      execution_package_id: runSession.execution_package_id,
      archive_bytes_base64: archiveBytes.toString('base64'),
      request_digest: codexCanonicalDigest({
        bundle_id: pendingWorkspaceBundle.bundle_id,
        archive_digest: pendingWorkspaceBundle.archive_digest,
      }),
      created_at: now,
    });
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', {
      runtime_job_id: 'runtime-job-run-projection',
      launch_lease_id: 'runtime-launch-lease-run-projection',
      envelope_id: 'runtime-envelope-run-projection',
      job_request_id: 'runtime-job-request-run-projection',
      target: {
        target_type: 'run_session',
        target_id: runSession.id,
        target_kind: 'run_execution',
        project_id: projectId,
        repo_id: repoId,
      },
      runtime_profile_revision_id: runProfileRevisionId,
      credential_binding_id: runCredentialBindingId,
      credential_binding_version_id: runCredentialVersionId,
      credential_payload_digest: credentialPayloadDigest,
      input_json: {
        schema_version: 'codex_run_execution_workload.v1',
        run_session_id: runSession.id,
        execution_package_id: runSession.execution_package_id,
        execution_package_version: 1,
        workspace_bundle_id: pendingWorkspaceBundle.bundle_id,
        workspace_bundle_digest: pendingWorkspaceBundle.archive_digest,
        package_prompt_ref: 'artifact://codex-runtime-jobs/runtime-job-run-projection/workload/package-prompt',
        package_prompt_digest: codexCanonicalDigest('run-projection-package-prompt'),
        execution_context_ref: 'artifact://codex-runtime-jobs/runtime-job-run-projection/workload/execution-context',
        execution_context_digest: codexCanonicalDigest('run-projection-execution-context'),
        path_policy_digest: codexCanonicalDigest('run-projection-path-policy'),
        required_checks_digest: codexCanonicalDigest('run-projection-required-checks'),
        output_schema_version: 'codex_run_execution_result.v1',
        created_at: now,
        expires_at: expiresAt,
      },
      workspace_acquisition_json: workspaceAcquisition,
      pending_workspace_bundle: pendingWorkspaceBundle,
      launch_attempt: 1,
      execution_package_id: runSession.execution_package_id,
      run_session_id: runSession.id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token: runWorkerLease.lease_token,
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_version: 1,
      expires_at: expiresAt,
    }).expect(201);

    const acceptedSessionDigest = codexCredentialPayloadDigest(registration.session_token);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/runtime-job-run-projection/accepted`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-run-accept', {
          accept_idempotency_key: 'runtime-job-projection-run-accept-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/runtime-job-run-projection/envelope/claim`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-run-envelope-claim', {
          envelope_id: 'runtime-envelope-run-projection',
          claim_request_id: 'runtime-job-projection-run-envelope-claim-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/runtime-job-run-projection/materialize`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-run-materialize', {
          launch_lease_id: 'runtime-launch-lease-run-projection',
          launch_token: capturedLaunchTokens.get('runtime-job-run-projection'),
          materialization_request_id: 'runtime-job-projection-run-materialize-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: 'session-key-1',
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);
    const runtimeEvidence = publicDockerRuntimeEvidence('run_execution');
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/runtime-job-run-projection/started`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-run-start', {
          start_idempotency_key: 'runtime-job-projection-run-start-1',
          runtime_evidence_digest: codexCanonicalDigest(runtimeEvidence),
          launch_materialization_digest: codexCanonicalDigest({ lease_id: 'runtime-launch-lease-run-projection' }),
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/runtime-job-run-projection/terminal`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-job-projection-run-terminal', {
          launch_lease_id: 'runtime-launch-lease-run-projection',
          terminal_status: 'succeeded',
          reason_code: 'codex_runtime_job_succeeded',
          terminal_idempotency_key: 'runtime-job-projection-run-terminal-1',
          terminal_result_json: {
            task_kind: 'run_execution',
            output_schema_version: 'codex_run_execution_result.v1',
            execution_package_id: runSession.execution_package_id,
            execution_package_version: 1,
            run_session_id: runSession.id,
            workspace_bundle_digest: pendingWorkspaceBundle.archive_digest,
            workspace_bundle_manifest_digest: pendingWorkspaceBundle.manifest_digest,
            mounted_task_workspace_digest: codexCanonicalDigest('run-projection-mounted-workspace'),
            changed_files: ['packages/domain/src/codex-runtime.ts'],
            check_results: [],
            execution_artifacts: [],
            runtime_evidence: runtimeEvidence,
            public_summary: 'Run execution completed.',
          },
        }),
      )
      .expect(201);

    await signedGet(app, '/internal/codex-runtime/runtime-jobs/runtime-job-run-projection')
      .expect(200)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({
          id: 'runtime-job-run-projection',
          input: {
            schema_version: 'codex_run_execution_workload.v1',
            output_schema_version: 'codex_run_execution_result.v1',
          },
          terminal_result_json: {
            task_kind: 'run_execution',
            run_session_id: runSession.id,
            workspace_bundle_digest: pendingWorkspaceBundle.archive_digest,
            mounted_task_workspace_digest: codexCanonicalDigest('run-projection-mounted-workspace'),
            changed_files: ['packages/domain/src/codex-runtime.ts'],
            output_schema_version: 'codex_run_execution_result.v1',
            runtime_evidence: {
              app_server_attempted: true,
              selected_execution_mode: 'app_server',
            },
          },
        });
        expectRuntimeJobProjectionRedacted(body.runtime_job);
        expect(JSON.stringify(body)).not.toContain('launch_token');
        expect(JSON.stringify(body)).not.toContain('docker-exec:');
      });
  });

  it('returns public-safe runtime job recovery evidence and rejects unsafe recovery reasons', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'runtime-job-recovery-public');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'runtime-job-recovery-public-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository, 'runtime-job-recovery-public');

    await signedPost(app, '/internal/codex-runtime/runtime-jobs', runtimeJobBody(claimed)).expect(201);

    await signedPost(app, '/internal/codex-runtime/runtime-jobs/recover-stale', {
      stale_before: later,
      now: later,
      reason_code: 'unsafe /tmp/recovery token',
    }).expect(400);

    await signedPost(app, '/internal/codex-runtime/runtime-jobs/recover-stale', {
      stale_before: later,
      now: later,
      reason_code: 'codex_runtime_job_stale',
    })
      .expect(201)
      .expect(({ body }) => {
        expect(body.recovered_runtime_jobs).toEqual([
          expect.objectContaining({
            id: runtimeJobId,
            worker_id: workerId,
            launch_lease_id: runtimeJobLaunchLeaseId,
            status: 'terminal',
            terminal_status: 'expired',
            terminal_reason_code: 'codex_runtime_job_stale',
          }),
        ]);
        expect(body.recovered_launch_leases).toEqual([
          expect.objectContaining({ id: runtimeJobLaunchLeaseId, status: 'expired' }),
        ]);
        expect(body.recovered_runtime_jobs[0].input_json).toBeUndefined();
        expect(body.recovered_runtime_jobs[0].workspace_acquisition_json).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('signed-context-ref-1');
        expect(JSON.stringify(body)).not.toContain('codex_generation_workload.v1');
      });
  });

  it('redacts generation workspace acquisition payloads from worker poll projections', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'runtime-job-workspace-redaction');
    const registration = await registerWorker(app);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'runtime-job-workspace-redaction-heartbeat', { nonce_timestamp: now }))
      .expect(201);
    const claimed = await claimActionRun(repository, 'runtime-job-workspace-redaction');
    const workspaceAcquisition = {
      schema_version: 'workspace_acquisition_v1',
      bundle_id: 'private-bundle-id-1',
      archive_digest: sha('w'),
      manifest_digest: sha('x'),
    };

    await signedPost(app, '/internal/codex-runtime/runtime-jobs', {
      ...runtimeJobBody(claimed),
      runtime_job_id: 'runtime-job-workspace-redaction',
      launch_lease_id: 'runtime-launch-lease-workspace-redaction',
      envelope_id: 'runtime-envelope-workspace-redaction',
      job_request_id: 'runtime-job-request-workspace-redaction',
      workspace_acquisition_json: workspaceAcquisition,
    }).expect(201);
    const poll = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/poll`)
      .send(runtimeWorkerBody(registration.session_token, 'runtime-job-poll-workspace-redaction', { limit: 1, target_kinds: ['generation'] }))
      .expect(201);

    const polledJob = poll.body.runtime_jobs[0];
    expect(polledJob.runtime_job.workspace_acquisition_json).toBeUndefined();
    expect(polledJob.runtime_job.workspace_acquisition).toEqual({
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisition),
      schema_version: 'workspace_acquisition_v1',
    });
    expect(JSON.stringify(poll.body)).not.toContain('private-bundle-id-1');
    expect(JSON.stringify(poll.body)).not.toContain(sha('w'));
    expect(JSON.stringify(poll.body)).not.toContain(sha('x'));
  });

  it('includes run-execution workspace acquisition payloads in worker poll projections', async () => {
    const { app, repository } = await bootApp();
    await signedSetupPost(app, '/internal/codex-runtime/profiles', runProfileBody(), 'runtime-job-run-execution-workspace-poll-profile').expect(201);
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(app, '/internal/codex-runtime/credentials', runCredentialBody(), 'runtime-job-run-execution-workspace-poll-credential').expect(201);
    await signedSetupPost(
      app,
      '/internal/codex-runtime/worker-bootstrap-tokens',
      runBootstrapBody(),
      'runtime-job-run-execution-workspace-poll-bootstrap',
    ).expect(201);
    const registration = await registerWorker(app, {
      capabilities: ['run_execution'],
      docker_image_digests: [runProfileBody().revision.docker_image_digest],
    });
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(
        heartbeatBody(registration.session_token, 'runtime-job-run-execution-workspace-poll-heartbeat', {
          nonce_timestamp: now,
          capabilities: ['run_execution'],
        }),
      )
      .expect(201);

    const runSession = {
      id: 'run-session-worker-poll-1',
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
      },
      created_at: now,
      updated_at: now,
    } satisfies RunSession;
    await repository.saveExecutionPackage(executionPackage());
    await repository.saveRunSession(runSession);
    const runWorkerLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'run-worker-poll-1',
      lease_token: 'run-worker-poll-token-1',
      now,
      expires_at: expiresAt,
    });
    const archiveBytes = Buffer.from('workspace bundle bytes\n');
    const archiveDigest = workspaceBundleArchiveDigest(archiveBytes);
    const manifestDigest = sha('c');
    const workspaceAcquisition = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'workspace-bundle-worker-poll-1',
      archive_ref: 'artifact:codex-pending-bundles:workspace-bundle-worker-poll-1',
      archive_digest: archiveDigest,
      manifest_digest: manifestDigest,
      size_bytes: archiveBytes.byteLength,
      expires_at: expiresAt,
    };
    const pendingWorkspaceBundle = {
      bundle_id: workspaceAcquisition.bundle_id,
      pending_artifact_ref: workspaceAcquisition.archive_ref,
      archive_digest: archiveDigest,
      manifest_digest: manifestDigest,
      run_worker_lease_id: runWorkerLease.id,
      size_bytes: archiveBytes.byteLength,
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisition),
      workspace_acquisition_json: workspaceAcquisition,
      expires_at: expiresAt,
    };
    await repository.createPendingWorkspaceBundleArtifact({
      ...pendingWorkspaceBundle,
      id: '33333333-3333-4333-8333-333333333333',
      run_session_id: runSession.id,
      execution_package_id: runSession.execution_package_id,
      archive_bytes_base64: archiveBytes.toString('base64'),
      request_digest: codexCanonicalDigest({ bundle_id: pendingWorkspaceBundle.bundle_id, archive_digest: archiveDigest }),
      created_at: now,
    });
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', {
      runtime_job_id: 'runtime-job-worker-poll-run-execution-1',
      launch_lease_id: 'runtime-launch-lease-worker-poll-run-execution-1',
      envelope_id: 'runtime-envelope-worker-poll-run-execution-1',
      job_request_id: 'runtime-job-request-worker-poll-run-execution-1',
      target: {
        target_type: 'run_session',
        target_id: runSession.id,
        target_kind: 'run_execution',
        project_id: projectId,
        repo_id: repoId,
      },
      runtime_profile_revision_id: runProfileRevisionId,
      credential_binding_id: runCredentialBindingId,
      credential_binding_version_id: runCredentialVersionId,
      credential_payload_digest: credentialPayloadDigest,
      input_json: {
        schema_version: 'codex_run_execution_workload.v1',
        run_session_id: runSession.id,
        execution_package_id: runSession.execution_package_id,
        execution_package_version: 1,
        workspace_bundle_id: pendingWorkspaceBundle.bundle_id,
        workspace_bundle_digest: archiveDigest,
        package_prompt_ref: 'artifact://codex-runtime-jobs/runtime-job-worker-poll-run-execution-1/workload/package-prompt',
        package_prompt_digest: sha('p'),
        execution_context_ref: 'artifact://codex-runtime-jobs/runtime-job-worker-poll-run-execution-1/workload/execution-context',
        execution_context_digest: sha('e'),
        path_policy_digest: sha('q'),
        required_checks_digest: sha('r'),
        output_schema_version: 'codex_run_execution_result.v1',
        created_at: now,
        expires_at: expiresAt,
      },
      workspace_acquisition_json: workspaceAcquisition,
      pending_workspace_bundle: pendingWorkspaceBundle,
      launch_attempt: 1,
      execution_package_id: runSession.execution_package_id,
      run_session_id: runSession.id,
      run_worker_lease_id: runWorkerLease.id,
      run_worker_lease_token: runWorkerLease.lease_token,
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_version: 1,
      expires_at: expiresAt,
    }).expect(201);

    const poll = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/poll`)
      .send(runtimeWorkerBody(registration.session_token, 'runtime-job-poll-run-execution-workspace', { limit: 1, target_kinds: ['run_execution'] }))
      .expect(201);

    expect(poll.body.runtime_jobs[0].runtime_job.workspace_acquisition_json).toEqual(workspaceAcquisition);
    expect(poll.body.runtime_jobs[0].runtime_job.workspace_acquisition).toEqual({
      workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisition),
      schema_version: 'workspace_bundle_acquisition.v1',
    });
    expect(poll.body.runtime_jobs[0].runtime_job.input_json).toBeUndefined();
    expect(JSON.stringify(poll.body)).not.toContain(runLaunchToken);
    expect(JSON.stringify(poll.body)).not.toContain('unsafe-db-access-token');
  });

  it('refreshes worker sessions without bootstrap reuse and refuses refresh while runtime jobs are assigned', async () => {
    const { app, repository } = await bootApp();
    await seedRuntime(app, 'runtime-refresh');
    const registration = await registerWorker(app);

    const refresh = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/session/refresh`)
      .send(
        runtimeWorkerBody(registration.session_token, 'runtime-refresh-1', {
          next_session_public_key_id: 'session-key-2',
          next_session_public_key_algorithm: 'x25519',
          next_session_public_key_material: 'base64-public-key-material-2',
          next_session_public_key_expires_at: expiresAt,
          refresh_idempotency_key: 'runtime-refresh-1',
        }),
      )
      .expect(201);
    expect(refresh.body.session_token).toEqual(expect.any(String));
    expect(refresh.body.session_token).not.toBe(registration.session_token);
    expect(refresh.body.worker).toMatchObject({
      id: workerId,
      session_public_key: 'base64-public-key-material-2',
    });

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(registration.session_token, 'runtime-refresh-old-token'))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/heartbeat`)
      .send(heartbeatBody(refresh.body.session_token, 'runtime-refresh-new-token'))
      .expect(201);

    const claimed = await claimActionRun(repository, 'runtime-refresh');
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', {
      ...runtimeJobBody(claimed),
      runtime_job_id: 'runtime-refresh-job-1',
      launch_lease_id: 'runtime-refresh-lease-1',
      envelope_id: 'runtime-refresh-envelope-1',
      job_request_id: 'runtime-refresh-request-1',
      input_json: {
        ...generationWorkload(claimed),
        runtime_job_id: 'runtime-refresh-job-1',
      },
    }).expect(201);

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/session/refresh`)
      .send(
        runtimeWorkerBody(refresh.body.session_token, 'runtime-refresh-with-assigned-job', {
          next_session_public_key_id: 'session-key-3',
          next_session_public_key_algorithm: 'x25519',
          next_session_public_key_material: 'base64-public-key-material-3',
          next_session_public_key_expires_at: expiresAt,
          refresh_idempotency_key: 'runtime-refresh-2',
        }),
      )
      .expect(400);
  });

  it('renews claimed automation action locks for the runtime daemon', async () => {
    const { app, repository } = await bootApp();
    const claimed = await claimActionRun(repository, 'renew', later);

    await request(app.getHttpServer())
      .post(`/internal/automation/action-runs/${claimed.id}/claim/renew`)
      .send({ claim_token: claimed.claim_token, locked_until: expiresAt })
      .expect(401);

    await signedPost(app, `/internal/automation/action-runs/${claimed.id}/claim/renew`, {
      claim_token: claimed.claim_token,
      locked_until: expiresAt,
      now,
    })
      .expect(201)
      .expect(({ body }) => {
        expect(body.action_run).toMatchObject({
          id: claimed.id,
          status: 'running',
          claim_token: claimed.claim_token,
          locked_until: expiresAt,
        });
      });
  });
});
