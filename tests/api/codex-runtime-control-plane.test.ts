import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { signAutomationRequest } from '../../packages/automation/src/index';
import {
  InMemoryDeliveryRepository,
  LocalInternalArtifactStore,
  type CodexLaunchTokenEnvelopeSealer,
  type DeliveryRepository,
} from '../../packages/db/src/index';
import {
  buildInternalArtifactRef,
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexLaunchTokenEnvelopeDigest,
  codexNetworkPolicyDigestInput,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  codexWorkspaceAcquisitionDigest,
  reviewPacketInputDigest,
  runtimeArtifactUploadProofPayload,
  type ExecutionPackage,
  type CodexRuntimeCapsule,
  type CodexRuntimeProfileRevision,
  type RunSession,
} from '../../packages/domain/src/index';
import { decryptCodexLaunchTokenEnvelope, generateCodexWorkerSessionKeyPair } from '../../packages/codex-worker-runtime/src/envelope-crypto';
import { seedRunExecutionRuntime, seedWorkflow } from '../helpers/plan-item-workflow-fixtures';

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
const rawSha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const workspaceBundleArchiveFixture = (input: { bundle_id: string; created_at?: string; files?: Record<string, string> }) => {
  const files = Object.entries(input.files ?? { 'README.md': 'workspace bundle fixture\n' }).map(([path, content]) => {
    const bytes = Buffer.from(content, 'utf8');
    return {
      path,
      type: 'file',
      digest: rawSha256(bytes),
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
    archive_digest: rawSha256(archive),
    manifest_digest: rawSha256(JSON.stringify(manifest)),
  };
};
const deterministicRuntimeArtifactId = (jobId: string, artifactIdempotencyKey: string): string => {
  const hex = codexCanonicalDigest({ runtime_job_id: jobId, artifact_idempotency_key: artifactIdempotencyKey }).slice(
    'sha256:'.length,
  );
  const bytes = Buffer.from(hex.slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const uuidHex = bytes.toString('hex');
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
};
const runtimeArtifactInternalRef = (jobId: string, artifactIdempotencyKey: string): string =>
  buildInternalArtifactRef({
    kind: 'codex_runtime_job_artifact',
    owner_type: 'codex_runtime_job',
    owner_id: jobId,
    artifact_id: deterministicRuntimeArtifactId(jobId, artifactIdempotencyKey),
  });

const firstPlanItemWorkflowQueuedAction = async (app: INestApplication, workflowId: string) => {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const [action] = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
  if (action === undefined) {
    throw new Error(`Expected workflow ${workflowId} to have a queued action`);
  }
  return action;
};

const runPlanItemWorkflowToExecutionReady = async (app: INestApplication, idPrefix: string) => {
  const seeded = await seedWorkflow(app, { idPrefix });
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const initialAction = await firstPlanItemWorkflowQueuedAction(app, seeded.workflow.id);
  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${initialAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);

  const boundaryAnswer = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/messages`)
    .send({
      actor_id: seeded.ids.actorTech,
      action: 'answer_boundary_question',
      body_markdown: 'Keep execution terminalization bounded to the approved Plan Item.',
    })
    .expect(201);
  const continuationAction = boundaryAnswer.body.queued_actions.find(
    (candidate: { kind: string; status: string }) => candidate.kind === 'continue_brainstorming' && candidate.status === 'queued',
  );
  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${continuationAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);

  const boundaryAction = (await repository.listActivePlanItemWorkflowQueuedActions(seeded.workflow.id)).find(
    (candidate) => candidate.kind === 'generate_boundary_summary' && candidate.status === 'queued',
  );
  if (boundaryAction === undefined) {
    throw new Error('Expected boundary summary action');
  }
  const boundaryRun = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${boundaryAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  const boundaryRevisionId = boundaryRun.body.workflow.active_boundary_summary_revision_id;

  const specQueue = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/boundary-summary/revisions/${boundaryRevisionId}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Boundary accepted.' })
    .expect(201);
  const specAction = specQueue.body.queued_actions.find(
    (candidate: { kind: string; status: string }) => candidate.kind === 'generate_spec_doc' && candidate.status === 'queued',
  );
  const specRun = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${specAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  const specRevisionId = specRun.body.workflow.active_spec_doc_revision_id;

  const implementationPlanQueue = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${specRevisionId}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Spec accepted.' })
    .expect(201);
  const implementationPlanAction = implementationPlanQueue.body.queued_actions.find(
    (candidate: { kind: string; status: string }) =>
      candidate.kind === 'generate_implementation_plan_doc' && candidate.status === 'queued',
  );
  const implementationPlanRun = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${implementationPlanAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  const implementationPlanRevisionId = implementationPlanRun.body.workflow.active_implementation_plan_doc_revision_id;

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/implementation-plan-doc/revisions/${implementationPlanRevisionId}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Plan accepted.' })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/execution-readiness/evaluate`)
    .send({ actor_id: seeded.ids.actorTech, rationale_markdown: 'Create the execution package.' })
    .expect(201);

  return { ...seeded, boundaryRevisionId, specRevisionId, implementationPlanRevisionId };
};

const outputCapsuleForWorkflowRun = (runtimeJob: { id: string; worker_id: string; input_json: Record<string, unknown> }) => {
  const workload = runtimeJob.input_json as {
    codex_session_runtime_context: {
      codex_session_id: string;
      codex_session_turn_id: string;
      continuation: { codex_thread_id_digest: string };
    };
  };
  const capsuleId = deterministicRuntimeArtifactId(runtimeJob.id, 'output-capsule');
  return {
    id: capsuleId,
    codex_session_id: workload.codex_session_runtime_context.codex_session_id,
    created_from_turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
    sequence: 100,
    artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${workload.codex_session_runtime_context.codex_session_id}/${capsuleId}`,
    digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'output-capsule' }),
    size_bytes: '0',
    manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'output-capsule-manifest' }),
    thread_state_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'output-thread-state' }),
    memory_state_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'output-memory-state' }),
    environment_manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'output-env-state' }),
    codex_thread_id_digest: workload.codex_session_runtime_context.continuation.codex_thread_id_digest,
    codex_cli_version: 'test-codex',
    app_server_protocol_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'app-server-protocol' }),
    runtime_profile_revision_id: 'runtime-profile-revision-output',
    trusted_runtime_manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'trusted-runtime' }),
    credential_binding_lineage_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'credential-lineage' }),
    created_by_actor_id: runtimeJob.worker_id,
    created_at: new Date().toISOString(),
  } satisfies CodexRuntimeCapsule;
};

const workflowRunTerminalResult = (runtimeJob: { id: string; worker_id: string; input_json: Record<string, unknown> }) => {
  const workload = runtimeJob.input_json as {
    execution_package_id: string;
    execution_package_version: number;
    run_session_id: string;
    workspace_bundle_digest: string;
    workspace_acquisition_json: { manifest_digest: string };
    codex_session_runtime_context: {
      codex_session_turn_id: string;
      continuation: { codex_thread_id: string; codex_thread_id_digest: string };
    };
  };
  const outputCapsule = outputCapsuleForWorkflowRun(runtimeJob);
  return {
    task_kind: 'run_execution',
    output_schema_version: 'codex_run_execution_result.v1',
    execution_package_id: workload.execution_package_id,
    execution_package_version: workload.execution_package_version,
    run_session_id: workload.run_session_id,
    workspace_bundle_digest: workload.workspace_bundle_digest,
    workspace_bundle_manifest_digest: workload.workspace_acquisition_json.manifest_digest,
    mounted_task_workspace_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, mounted: true }),
    changed_files: ['packages/domain/src/codex-runtime.ts'],
    check_results: [],
    execution_artifacts: [],
    runtime_evidence: publicDockerRuntimeEvidence('run_execution'),
    public_summary: 'Workflow-owned run execution completed.',
    codex_session_thread: {
      codex_thread_id: workload.codex_session_runtime_context.continuation.codex_thread_id,
      codex_thread_id_digest: workload.codex_session_runtime_context.continuation.codex_thread_id_digest,
      app_server_turn_id: `app-server-turn-${runtimeJob.id}`,
    },
    output_capsule: outputCapsule,
    output_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${outputCapsule.codex_session_id}/memory-${runtimeJob.id}`,
    output_memory_bundle_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'memory-bundle' }),
    output_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${outputCapsule.codex_session_id}/environment-${runtimeJob.id}`,
    output_environment_manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'environment-manifest' }),
    codex_session_turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
  };
};

const reviewResponseTerminalResult = (runtimeJob: { id: string; worker_id: string; input_json: Record<string, unknown> }) => {
  const workload = runtimeJob.input_json as {
    prompt_version: string;
    codex_session_runtime_context: {
      codex_session_id: string;
      codex_session_turn_id: string;
      continuation: { codex_thread_id: string; codex_thread_id_digest: string };
    };
  };
  const outputCapsuleId = deterministicRuntimeArtifactId(runtimeJob.id, 'review-response-output-capsule');
  const outputCapsule = {
    id: outputCapsuleId,
    codex_session_id: workload.codex_session_runtime_context.codex_session_id,
    created_from_turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
    sequence: 101,
    artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${workload.codex_session_runtime_context.codex_session_id}/${outputCapsuleId}`,
    digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-output-capsule' }),
    size_bytes: '0',
    manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-output-capsule-manifest' }),
    thread_state_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-output-thread-state' }),
    memory_state_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-output-memory-state' }),
    environment_manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-output-env-state' }),
    codex_thread_id_digest: workload.codex_session_runtime_context.continuation.codex_thread_id_digest,
    codex_cli_version: 'test-codex',
    app_server_protocol_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-app-server-protocol' }),
    runtime_profile_revision_id: 'runtime-profile-revision-output',
    trusted_runtime_manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-trusted-runtime' }),
    credential_binding_lineage_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-credential-lineage' }),
    created_by_actor_id: runtimeJob.worker_id,
    created_at: process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? now,
  } satisfies CodexRuntimeCapsule;
  const generatedPayload = {
    schema_version: 'review_response.v1',
    response_markdown: 'The requested changes are understood and need a follow-up fix attempt.',
    summary: 'Review response recorded.',
    public_summary: 'Review response recorded.',
  };
  return {
    task_kind: 'review_response',
    prompt_version: workload.prompt_version,
    output_schema_version: 'review_response.v1',
    generated_payload: generatedPayload,
    generated_payload_digest: codexCanonicalDigest(generatedPayload),
    generation_artifacts: [],
    public_summary: 'Review response recorded.',
    codex_session_thread: {
      codex_thread_id: workload.codex_session_runtime_context.continuation.codex_thread_id,
      codex_thread_id_digest: workload.codex_session_runtime_context.continuation.codex_thread_id_digest,
      app_server_turn_id: `app-server-turn-${runtimeJob.id}`,
    },
    output_capsule: outputCapsule,
    output_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${outputCapsule.codex_session_id}/review-response-memory-${runtimeJob.id}`,
    output_memory_bundle_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'review-response-memory-bundle' }),
    output_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${outputCapsule.codex_session_id}/review-response-environment-${runtimeJob.id}`,
    output_environment_manifest_digest: codexCanonicalDigest({
      runtime_job_id: runtimeJob.id,
      artifact: 'review-response-environment-manifest',
    }),
  };
};

const driveWorkflowRuntimeJobToRunning = async (
  repository: DeliveryRepository,
  runtimeJob: { id: string; launch_lease_id: string; worker_id: string; project_id: string },
  capturedLaunchTokens: Map<string, string>,
) => {
  const requestNow = process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();
  const sessionToken = `plan-item-workflow-run-session-${runtimeJob.project_id}`;
  const sessionKeyId = `plan-item-workflow-run-session-key-${runtimeJob.project_id}`;
  const acceptedSessionDigest = codexCredentialPayloadDigest(sessionToken);
  const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id });
  expect(envelope).toBeDefined();
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/test/workflow-run-execution/${runtimeJob.id}/${step}`,
    body_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, step }),
  });
  await repository.acceptCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeJob.id}-accept`,
    nonce_timestamp: requestNow,
    accepted_worker_session_digest: acceptedSessionDigest,
    accepted_session_public_key_id: sessionKeyId,
    accepted_session_epoch: 1,
    idempotency_key: `${runtimeJob.id}-accept`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, step: 'accept' }),
    replay_protection: replayProtection('accept'),
    now: requestNow,
  });
  await repository.claimCodexLaunchTokenEnvelope({
    runtime_job_id: runtimeJob.id,
    envelope_id: envelope!.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeJob.id}-claim`,
    nonce_timestamp: requestNow,
    accepted_worker_session_digest: acceptedSessionDigest,
    key_id: sessionKeyId,
    accepted_session_epoch: 1,
    claim_request_id: `${runtimeJob.id}-claim`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, step: 'claim' }),
    replay_protection: replayProtection('claim'),
    now: requestNow,
  });
  await repository.materializeCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    launch_lease_id: runtimeJob.launch_lease_id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeJob.id}-materialize`,
    nonce_timestamp: requestNow,
    launch_token_hash: codexCredentialPayloadDigest(capturedLaunchTokens.get(runtimeJob.id)),
    accepted_worker_session_digest: acceptedSessionDigest,
    accepted_session_public_key_id: sessionKeyId,
    accepted_session_epoch: 1,
    materialization_request_id: `${runtimeJob.id}-materialize`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, step: 'materialize' }),
    replay_protection: replayProtection('materialize'),
    now: requestNow,
  });
  const runtimeEvidence = publicDockerRuntimeEvidence('run_execution');
  await repository.startCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeJob.id}-start`,
    nonce_timestamp: requestNow,
    idempotency_key: `${runtimeJob.id}-start`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, step: 'start' }),
    runtime_evidence_digest: codexCanonicalDigest(runtimeEvidence),
    launch_materialization_digest: codexCanonicalDigest({ lease_id: runtimeJob.launch_lease_id }),
    replay_protection: replayProtection('start'),
    now: requestNow,
  });
};

const putWorkspaceBundleObject = async (
  repository: DeliveryRepository,
  input: {
    run_session_id: string;
    bundle_id: string;
    bytes: Buffer;
    digest: string;
    manifest_digest: string;
    execution_package_id: string;
    run_worker_lease_id: string;
  },
) =>
  new LocalInternalArtifactStore({
    root: process.env.FORGELOOP_ARTIFACT_STORE_ROOT ?? '',
    repository,
    requestId: `workspace-bundle-test-${input.bundle_id}`,
  }).putObject({
    artifact_id: input.bundle_id,
    kind: 'workspace_bundle',
    owner_type: 'run_session',
    owner_id: input.run_session_id,
    visibility: 'internal',
    content_type: 'application/vnd.forgeloop.workspace-bundle',
    declared_size_bytes: String(input.bytes.byteLength),
    declared_artifact_digest: input.digest,
    idempotency_key: input.bundle_id,
    metadata_json: {
      manifest_digest: input.manifest_digest,
      execution_package_id: input.execution_package_id,
      run_worker_lease_id: input.run_worker_lease_id,
    },
    created_by_actor_type: 'codex_worker',
    created_by_actor_id: input.run_worker_lease_id,
    now,
    max_size_bytes: 10_000_000,
    bytes: input.bytes,
  });

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
  'worker_id',
  'launch_lease_id',
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
  const serialized = JSON.stringify(runtimeJob);
  expect(serialized).not.toContain('"worker_id"');
  expect(serialized).not.toContain('"launch_lease_id"');
  expect(serialized).not.toContain('"credential_binding_id"');
  expect(serialized).not.toContain('"credential_binding_version_id"');
  expect(serialized).not.toContain('"credential_payload_digest"');
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

const runtimeArtifactUploadMetadata = (input: {
  sessionToken: string;
  nonce: string;
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  size_bytes: string;
  metadata_json?: Record<string, unknown>;
}) => ({
  schema_version: 'codex_runtime_job_artifact_upload.v2' as const,
  worker_session_token: input.sessionToken,
  nonce: input.nonce,
  nonce_timestamp: later,
  artifact_idempotency_key: input.artifact_idempotency_key,
  kind: input.kind,
  name: input.name,
  content_type: input.content_type,
  digest: input.digest,
  size_bytes: input.size_bytes,
  metadata_json: input.metadata_json ?? {},
});

const runtimeArtifactUpload = (input: {
  app: INestApplication;
  workerId: string;
  runtimeJobId: string;
  metadata: ReturnType<typeof runtimeArtifactUploadMetadata>;
  payload: Buffer;
}) => {
  const uploadPath = `/internal/codex-workers/${input.workerId}/runtime-jobs/${input.runtimeJobId}/artifacts`;
  const proofPayload = runtimeArtifactUploadProofPayload({
    method: 'POST',
    path: uploadPath,
    worker_id: input.workerId,
    runtime_job_id: input.runtimeJobId,
    metadata: input.metadata,
  });
  const metadata = {
    ...input.metadata,
    body_digest: codexCanonicalDigest(proofPayload),
  };
  return request(input.app.getHttpServer())
    .post(uploadPath)
    .set('content-type', 'application/octet-stream')
    .set('x-forgeloop-runtime-artifact-metadata', Buffer.from(JSON.stringify(metadata)).toString('base64url'))
    .send(input.payload);
};

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
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: '10mb' });
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
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: '10mb' });
  app.useLogger(false);
  await app.init();
  apps.push(app);
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository };
};

const setupWorkflowOwnedRunExecution = async (idPrefix: string, options: { driveToRunning?: boolean } = {}) => {
  const capturedLaunchTokens = new Map<string, string>();
  const { app, repository } = await bootApp(
    new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) }),
  );
  const seeded = await runPlanItemWorkflowToExecutionReady(app, idPrefix);
  const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
  const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
  await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);
  const started = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
    .send({ actor_id: seeded.ids.actorTech, idempotency_key: `runtime-control-plane-workflow-start-${idPrefix}` })
    .expect(201);
  const startedRunSession = await repository.getRunSession(started.body.execution_run_summary.run_session_id);
  const runtimeJobId = startedRunSession?.runtime_metadata?.remote_runtime_job_id;
  if (runtimeJobId === undefined) {
    throw new Error('Expected workflow execution start to bind a runtime job to the run session');
  }
  const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
  if (runtimeJob === undefined) {
    throw new Error('Expected workflow execution start to create a runtime job');
  }
  if (options.driveToRunning ?? true) {
    await driveWorkflowRuntimeJobToRunning(repository, runtimeJob, capturedLaunchTokens);
  }
  return {
    app,
    repository,
    seeded,
    started,
    runtimeJob,
    sessionToken: `plan-item-workflow-run-session-${seeded.ids.project}`,
  };
};

const terminalizeWorkflowRuntimeJobRequest = (
  app: INestApplication,
  input: {
    runtimeJob: { id: string; worker_id: string; launch_lease_id: string };
    sessionToken: string;
    terminalStatus: 'succeeded' | 'failed' | 'cancelled';
    reasonCode: string;
    terminalResult?: Record<string, unknown>;
    nonceSuffix: string;
    nonceTimestamp?: string;
  },
) =>
  request(app.getHttpServer())
    .post(`/internal/codex-workers/${input.runtimeJob.worker_id}/runtime-jobs/${input.runtimeJob.id}/terminal`)
    .send(
      runtimeWorkerBody(input.sessionToken, `${input.runtimeJob.id}-${input.nonceSuffix}`, {
        nonce_timestamp: input.nonceTimestamp ?? process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString(),
        launch_lease_id: input.runtimeJob.launch_lease_id,
        terminal_status: input.terminalStatus,
        reason_code: input.reasonCode,
        terminal_idempotency_key: `${input.runtimeJob.id}-${input.nonceSuffix}`,
        ...(input.terminalResult === undefined ? {} : { terminal_result_json: input.terminalResult }),
      }),
    );

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
    vi.stubEnv('FORGELOOP_ARTIFACT_STORE_ROOT', mkdtempSync(join(tmpdir(), 'forgeloop-runtime-api-artifacts-')));
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
        expect(body.recovered_launch_leases).toEqual([
          expect.objectContaining({ launch_lease_digest: expect.stringMatching(/^sha256:/), status: 'expired' }),
        ]);
        expect(JSON.stringify(body)).not.toContain('"id":"lease-2"');
        expect(JSON.stringify(body)).not.toContain('"worker_id"');
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
      recovered_launch_leases: [expect.objectContaining({ launch_lease_digest: expect.stringMatching(/^sha256:/), status: 'expired' })],
      run_session_transitions: [
        {
          run_session_id: runSession.id,
          execution_package_id: runSession.execution_package_id,
          reason_code: 'test_run_execution_stale_worker',
        },
      ],
    });
    expect(JSON.stringify(firstRecovery.body)).not.toContain('"id":"lease-run-execution-1"');
    expect(JSON.stringify(firstRecovery.body)).not.toContain('"worker_id"');
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

  it('honors explicit run-execution credential profile selection and rejects direct non-workflow runtime jobs', async () => {
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
    const workspaceBundleFixture = workspaceBundleArchiveFixture({ bundle_id: 'workspace-bundle-selected-runtime-job' });
    const workspaceBundleBytes = workspaceBundleFixture.archive;
    const workspaceBundle = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'workspace-bundle-selected-runtime-job',
      archive_ref: `artifact://internal/workspace_bundle/run_session/${runtimeJobRunSession.id}/workspace-bundle-selected-runtime-job`,
      archive_digest: workspaceBundleFixture.archive_digest,
      manifest_digest: workspaceBundleFixture.manifest_digest,
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
    const storedWorkspaceBundleObject = await putWorkspaceBundleObject(repository, {
      run_session_id: runtimeJobRunSession.id,
      bundle_id: pendingWorkspaceBundle.bundle_id,
      bytes: workspaceBundleBytes,
      digest: pendingWorkspaceBundle.archive_digest,
      manifest_digest: pendingWorkspaceBundle.manifest_digest,
      execution_package_id: runtimeJobRunSession.execution_package_id,
      run_worker_lease_id: runtimeJobRunWorkerLease.id,
    });
    const pendingWorkspaceBundleRecord = {
      ...pendingWorkspaceBundle,
      internal_artifact_object_id: storedWorkspaceBundleObject.id,
      id: '44444444-4444-4444-8444-444444444444',
      run_session_id: runtimeJobRunSession.id,
      execution_package_id: runtimeJobRunSession.execution_package_id,
      request_digest: codexCanonicalDigest({ bundle_id: pendingWorkspaceBundle.bundle_id, archive_digest: pendingWorkspaceBundle.archive_digest }),
      created_at: now,
    };
    await repository.createPendingWorkspaceBundleArtifact(pendingWorkspaceBundleRecord);
    await signedPost(app, '/internal/codex-runtime/runtime-jobs', {
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
      pending_workspace_bundle: pendingWorkspaceBundleRecord,
      launch_attempt: 1,
      execution_package_id: runtimeJobRunSession.execution_package_id,
      run_session_id: runtimeJobRunSession.id,
      run_worker_lease_id: runtimeJobRunWorkerLease.id,
      run_worker_lease_token: runtimeJobRunWorkerLease.lease_token,
      run_session_status: 'running',
      run_session_updated_at: now,
      execution_package_version: 1,
      expires_at: expiresAt,
    })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('codex_runtime_job_unavailable'));
  });

  it('downloads workspace bundle bytes only after pending artifact binding to the accepted runtime job', async () => {
    const { app, runtimeJob, sessionToken } = await setupWorkflowOwnedRunExecution('63636363', { driveToRunning: false });
    const workspaceAcquisition = runtimeJob.workspace_acquisition_json as {
      bundle_id: string;
      archive_digest: string;
      manifest_digest: string;
    };
    const workerRequestNow = process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();

    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/${runtimeJob.id}/workspace-bundle/${workspaceAcquisition.bundle_id}`)
      .query(runtimeWorkerQuery(sessionToken, 'workspace-bundle-before-accept', { nonce_timestamp: workerRequestNow }))
      .expect(400);

    const acceptedSessionDigest = codexCredentialPayloadDigest(sessionToken);
    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/${runtimeJob.id}/accepted`)
      .send(
        runtimeWorkerBody(sessionToken, 'workspace-bundle-accept', {
          nonce_timestamp: workerRequestNow,
          accept_idempotency_key: 'workspace-bundle-accept-1',
          accepted_worker_session_digest: acceptedSessionDigest,
          accepted_session_public_key_id: `plan-item-workflow-run-session-key-${runtimeJob.project_id}`,
          accepted_session_epoch: 1,
        }),
      )
      .expect(201);

    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/${runtimeJob.id}/workspace-bundle/other-bundle`)
      .query(runtimeWorkerQuery(sessionToken, 'workspace-bundle-wrong-bundle', { nonce_timestamp: workerRequestNow }))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/internal/codex-workers/wrong-worker/runtime-jobs/${runtimeJob.id}/workspace-bundle/${workspaceAcquisition.bundle_id}`)
      .query(runtimeWorkerQuery(sessionToken, 'workspace-bundle-wrong-worker', { nonce_timestamp: workerRequestNow }))
      .expect(400);

    const downloaded = await request(app.getHttpServer())
      .get(`/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/${runtimeJob.id}/workspace-bundle/${workspaceAcquisition.bundle_id}`)
      .query(runtimeWorkerQuery(sessionToken, 'workspace-bundle-download', { nonce_timestamp: workerRequestNow }))
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(downloaded.headers['content-type']).toContain('application/vnd.forgeloop.workspace-bundle');
    expect(downloaded.headers['x-forgeloop-workspace-bundle-digest']).toBe(workspaceAcquisition.archive_digest);
    expect(rawSha256(downloaded.body)).toBe(workspaceAcquisition.archive_digest);

    await signedPost(app, `/internal/codex-runtime/runtime-jobs/${runtimeJob.id}/cancel`, {
      reason_code: 'test_cancel',
      idempotency_key: 'workspace-bundle-cancel-1',
    }).expect(201);
    await request(app.getHttpServer())
      .get(`/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/${runtimeJob.id}/workspace-bundle/${workspaceAcquisition.bundle_id}`)
      .query(runtimeWorkerQuery(sessionToken, 'workspace-bundle-after-cancel', { nonce_timestamp: workerRequestNow }))
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

  it('drives remote runtime jobs through sealed-envelope worker APIs and uploads artifacts without exposing launch tokens', async () => {
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
      },
      launch_lease: {
        launch_lease_digest: expect.stringMatching(/^sha256:/),
        status: 'active',
      },
      envelope: {
        envelope_digest: expect.stringMatching(/^sha256:/),
        status: 'available',
      },
    });
    expectRuntimeJobProjectionRedacted(created.body.runtime_job);
    expect(JSON.stringify(created.body)).not.toContain(runtimeJobLaunchLeaseId);
    expect(JSON.stringify(created.body)).not.toContain(workerId);
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
        expect(body.envelope).toMatchObject({ envelope_digest: created.body.envelope.envelope_digest, status: 'available' });
        expect(body.envelope.id).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain(runtimeJobEnvelopeId);
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
        expect(body).toMatchObject({ launch_lease_digest: expect.stringMatching(/^sha256:/), status: 'active' });
        expect(JSON.stringify(body)).not.toContain(runtimeJobLaunchLeaseId);
        expect(JSON.stringify(body)).not.toContain(workerId);
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

    const startupFailurePayload = Buffer.from('startup-fail');
    const startupFailureUpload = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: startupFailurePayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'runtime-job-startup-failure-artifact',
        artifact_idempotency_key: 'runtime-job-startup-failure-artifact-1',
        kind: 'startup_failure_evidence',
        name: 'startup-failure-evidence.json',
        content_type: 'application/json',
        digest: rawSha256(startupFailurePayload),
        size_bytes: String(startupFailurePayload.byteLength),
        metadata_json: {
          reason_code: 'codex_workspace_bundle_invalid',
          failure_subcode: 'job_temp_root_already_exists',
          public_summary: 'Remote Codex workspace bundle validation failed.',
        },
      }),
    });
    expect(startupFailureUpload.status, JSON.stringify(startupFailureUpload.body)).toBe(201);
    expect(startupFailureUpload.body.artifact).toMatchObject({
      runtime_job_id: runtimeJobId,
      kind: 'startup_failure_evidence',
      metadata_json: {
        reason_code: 'codex_workspace_bundle_invalid',
        failure_subcode: 'job_temp_root_already_exists',
      },
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

    const generatedPayload = { schema_version: 'test_payload.v1', value: 'ok' };
    const payload = Buffer.from(`${JSON.stringify(generatedPayload)}\n`);
    const digest = rawSha256(payload);
    const generatedPayloadDigest = codexCanonicalDigest(generatedPayload);
    const upload = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-nonce-1',
        artifact_idempotency_key: 'artifact-key-1',
        kind: 'generated_payload',
        name: 'payload.json',
        content_type: 'application/json',
        digest,
        size_bytes: String(payload.byteLength),
        metadata_json: { schema_version: 'generated_payload_metadata.v1' },
      }),
    }).expect(201);

    expect(upload.body.artifact).toMatchObject({
      runtime_job_id: runtimeJobId,
      project_id: projectId,
      repo_id: repoId,
      target_kind: 'generation',
      content_type: 'application/json',
      digest,
      size_bytes: payload.byteLength,
    });
    expect(upload.body.artifact.internal_ref).toMatch(
      /^artifact:\/\/internal\/codex_runtime_job_artifact\/codex_runtime_job\/runtime-job-1\//,
    );
    expect(upload.body.artifact.digest).toBe(digest);
    expect(upload.body.artifact.digest).not.toBe(generatedPayloadDigest);
    expect(JSON.stringify(upload.body)).not.toContain('storage_key');
    expect(JSON.stringify(upload.body)).not.toContain('launch_token');
    expect(JSON.stringify(upload.body)).not.toContain(remoteLaunchToken);

    const uploadReplay = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-nonce-1-replay',
        artifact_idempotency_key: 'artifact-key-1',
        kind: 'generated_payload',
        name: 'payload.json',
        content_type: 'application/json',
        digest,
        size_bytes: String(payload.byteLength),
        metadata_json: { schema_version: 'generated_payload_metadata.v1' },
      }),
    });
    expect(uploadReplay.status, JSON.stringify(uploadReplay.body)).toBe(201);
    expect(uploadReplay.body.artifact).toEqual(upload.body.artifact);

    const nonceReplayPayload = Buffer.from('nonce replay payload\n');
    const nonceReplayDigest = rawSha256(nonceReplayPayload);
    const rejectedNonceReplay = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: nonceReplayPayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-nonce-1',
        artifact_idempotency_key: 'artifact-retry-key-nonce-replay',
        kind: 'generated_payload',
        name: 'nonce-replay.txt',
        content_type: 'text/plain',
        digest: nonceReplayDigest,
        size_bytes: String(nonceReplayPayload.byteLength),
      }),
    });
    expect(rejectedNonceReplay.status).toBe(400);
    await expect(
      repository.getInternalArtifactObjectByRef({
        ref: runtimeArtifactInternalRef(runtimeJobId, 'artifact-retry-key-nonce-replay'),
      }),
    ).resolves.toBeUndefined();
    const correctedNonceReplay = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: nonceReplayPayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-retry-nonce-replay-corrected',
        artifact_idempotency_key: 'artifact-retry-key-nonce-replay',
        kind: 'generated_payload',
        name: 'nonce-replay.txt',
        content_type: 'text/plain',
        digest: nonceReplayDigest,
        size_bytes: String(nonceReplayPayload.byteLength),
      }),
    });
    expect(correctedNonceReplay.status, JSON.stringify(correctedNonceReplay.body)).toBe(201);

    const concurrentNoncePayloadA = Buffer.from('concurrent nonce replay payload a\n');
    const concurrentNoncePayloadB = Buffer.from('concurrent nonce replay payload b\n');
    const concurrentNonceDigestA = rawSha256(concurrentNoncePayloadA);
    const concurrentNonceDigestB = rawSha256(concurrentNoncePayloadB);
    const concurrentNonceUploads = [
      {
        key: 'artifact-concurrent-nonce-replay-a',
        response: runtimeArtifactUpload({
          app,
          workerId,
          runtimeJobId,
          payload: concurrentNoncePayloadA,
          metadata: runtimeArtifactUploadMetadata({
            sessionToken: registration.session_token,
            nonce: 'artifact-concurrent-nonce-replay',
            artifact_idempotency_key: 'artifact-concurrent-nonce-replay-a',
            kind: 'generated_payload',
            name: 'concurrent-a.txt',
            content_type: 'text/plain',
            digest: concurrentNonceDigestA,
            size_bytes: String(concurrentNoncePayloadA.byteLength),
          }),
        }),
      },
      {
        key: 'artifact-concurrent-nonce-replay-b',
        response: runtimeArtifactUpload({
          app,
          workerId,
          runtimeJobId,
          payload: concurrentNoncePayloadB,
          metadata: runtimeArtifactUploadMetadata({
            sessionToken: registration.session_token,
            nonce: 'artifact-concurrent-nonce-replay',
            artifact_idempotency_key: 'artifact-concurrent-nonce-replay-b',
            kind: 'generated_payload',
            name: 'concurrent-b.txt',
            content_type: 'text/plain',
            digest: concurrentNonceDigestB,
            size_bytes: String(concurrentNoncePayloadB.byteLength),
          }),
        }),
      },
    ];
    const concurrentNonceResults = await Promise.all(
      concurrentNonceUploads.map(async (upload) => ({ key: upload.key, response: await upload.response })),
    );
    expect(concurrentNonceResults.map((result) => result.response.status).sort()).toEqual([201, 400]);
    const rejectedConcurrentNonce = concurrentNonceResults.find((result) => result.response.status === 400);
    expect(rejectedConcurrentNonce).toBeDefined();
    await expect(
      repository.getInternalArtifactObjectByRef({
        ref: runtimeArtifactInternalRef(runtimeJobId, rejectedConcurrentNonce?.key ?? ''),
      }),
    ).resolves.toBeUndefined();

    await request(app.getHttpServer())
      .post(`/internal/codex-workers/${workerId}/runtime-jobs/${runtimeJobId}/artifacts`)
      .send(
        runtimeWorkerBody(registration.session_token, 'metadata-only', {
          artifact_idempotency_key: 'metadata-only',
          kind: 'generated_payload',
          name: 'payload.json',
          content_type: 'application/json',
          digest,
          size_bytes: String(payload.byteLength),
          metadata_json: { generated_payload: { unsafe: 'legacy canonical path' } },
        }),
      )
      .expect(400);

    const retryPayload = Buffer.from('retry payload\n');
    const retryDigest = rawSha256(retryPayload);
    const rejectedContentType = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: retryPayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-retry-invalid-content-type',
        artifact_idempotency_key: 'artifact-retry-key-1',
        kind: 'generated_payload',
        name: 'payload.txt',
        content_type: 'application/x-secret-dump',
        digest: retryDigest,
        size_bytes: String(retryPayload.byteLength),
      }),
    });
    expect(rejectedContentType.status).toBe(400);
    await expect(
      repository.getInternalArtifactObjectByRef({
        ref: runtimeArtifactInternalRef(runtimeJobId, 'artifact-retry-key-1'),
      }),
    ).resolves.toBeUndefined();
    const correctedContentType = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: retryPayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-retry-valid-content-type',
        artifact_idempotency_key: 'artifact-retry-key-1',
        kind: 'generated_payload',
        name: 'payload.txt',
        content_type: 'text/plain',
        digest: retryDigest,
        size_bytes: String(retryPayload.byteLength),
      }),
    });
    expect(correctedContentType.status, JSON.stringify(correctedContentType.body)).toBe(201);

    const unsafeMetadataPayload = Buffer.from('unsafe metadata retry payload\n');
    const unsafeMetadataDigest = rawSha256(unsafeMetadataPayload);
    const rejectedUnsafeMetadata = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: unsafeMetadataPayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-retry-unsafe-metadata',
        artifact_idempotency_key: 'artifact-retry-key-2',
        kind: 'generated_payload',
        name: 'unsafe-metadata.txt',
        content_type: 'text/plain',
        digest: unsafeMetadataDigest,
        size_bytes: String(unsafeMetadataPayload.byteLength),
        metadata_json: { workspace_path: '/tmp/private/codex-home' },
      }),
    });
    expect(rejectedUnsafeMetadata.status).toBe(400);
    await expect(
      repository.getInternalArtifactObjectByRef({
        ref: runtimeArtifactInternalRef(runtimeJobId, 'artifact-retry-key-2'),
      }),
    ).resolves.toBeUndefined();
    const correctedMetadata = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: unsafeMetadataPayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'artifact-retry-safe-metadata',
        artifact_idempotency_key: 'artifact-retry-key-2',
        kind: 'generated_payload',
        name: 'unsafe-metadata.txt',
        content_type: 'text/plain',
        digest: unsafeMetadataDigest,
        size_bytes: String(unsafeMetadataPayload.byteLength),
        metadata_json: { note: 'safe retry metadata' },
      }),
    });
    expect(correctedMetadata.status, JSON.stringify(correctedMetadata.body)).toBe(201);

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
    const artifactPayload = Buffer.from(`${JSON.stringify(generatedPayload)}\n`);
    const generatedPayloadDigest = rawSha256(artifactPayload);
    const terminalGeneratedPayloadDigest = codexCanonicalDigest(generatedPayload);
    const artifact = await runtimeArtifactUpload({
      app,
      workerId,
      runtimeJobId,
      payload: artifactPayload,
      metadata: runtimeArtifactUploadMetadata({
        sessionToken: registration.session_token,
        nonce: 'runtime-job-projection-generation-artifact',
        artifact_idempotency_key: 'runtime-job-projection-generation-artifact-1',
        kind: 'generated_payload',
        name: 'generated-payload.json',
        content_type: 'application/json',
        digest: generatedPayloadDigest,
        size_bytes: String(artifactPayload.byteLength),
        metadata_json: {
          output_schema_version: 'spec_revision.v1',
          generated_payload_digest: terminalGeneratedPayloadDigest,
        },
      }),
    }).expect(201);

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
            generated_payload_digest: terminalGeneratedPayloadDigest,
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
            generated_payload_digest: terminalGeneratedPayloadDigest,
            public_summary: 'Generated a Spec revision.',
            output_schema_version: 'spec_revision.v1',
            runtime_evidence: {
              app_server_attempted: true,
              selected_execution_mode: 'app_server',
            },
          },
        });
        const generatedPayloadArtifact = body.artifacts.find(
          (artifact: { kind?: string }) => artifact.kind === 'generated_payload',
        );
        expect(generatedPayloadArtifact).toMatchObject({
          metadata_json: expect.objectContaining({
            output_schema_version: 'spec_revision.v1',
            generated_payload_digest: terminalGeneratedPayloadDigest,
          }),
        });
        expect(generatedPayloadArtifact.metadata_json).not.toHaveProperty('generated_payload');
        expectRuntimeJobProjectionRedacted(body.runtime_job);
        expect(JSON.stringify(body)).not.toContain('launch_token');
        expect(JSON.stringify(body)).not.toContain('docker-exec:');
      });
  });

  it('terminalizes workflow-owned run-execution jobs through workflow/session lineage with public-safe projection', async () => {
    const { app, repository, seeded, started, runtimeJob, sessionToken } = await setupWorkflowOwnedRunExecution('57575757');
    const runtimeJobId = runtimeJob.id;
    expect(runtimeJob).toMatchObject({
      target_kind: 'run_execution',
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: runtimeJob.codex_session_turn_id,
    });

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob,
      sessionToken,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult: workflowRunTerminalResult(runtimeJob),
      nonceSuffix: 'terminal',
    }).expect(201);

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'code_review' });
    await expect(repository.getRunSession(started.body.execution_run_summary.run_session_id)).resolves.toMatchObject({
      status: 'succeeded',
      changed_files: ['packages/domain/src/codex-runtime.ts'],
    });
    await expect(repository.getCodexSessionTurn(runtimeJob.codex_session_turn_id!)).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(repository.getCodexSession(seeded.workflow.active_codex_session_id!)).resolves.toMatchObject({
      status: 'idle',
      latest_capsule_digest: workflowRunTerminalResult(runtimeJob).output_capsule.digest,
    });

    await signedGet(app, `/internal/codex-runtime/runtime-jobs/${runtimeJobId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.runtime_job).toMatchObject({
          id: runtimeJobId,
          input: {
            schema_version: 'codex_run_execution_workload.v1',
            output_schema_version: 'codex_run_execution_result.v1',
          },
          terminal_result_json: {
            task_kind: 'run_execution',
            run_session_id: started.body.execution_run_summary.run_session_id,
            changed_files: ['packages/domain/src/codex-runtime.ts'],
            output_schema_version: 'codex_run_execution_result.v1',
            runtime_evidence: {
              app_server_attempted: true,
              selected_execution_mode: 'app_server',
            },
          },
        });
        expectRuntimeJobProjectionRedacted(body.runtime_job);
        expect(JSON.stringify(body.runtime_job)).not.toContain('codex_session_thread');
        expect(JSON.stringify(body.runtime_job)).not.toContain('output_capsule');
        expect(JSON.stringify(body.runtime_job)).not.toContain('artifact://internal');
        expect(JSON.stringify(body)).not.toContain('launch_token');
        expect(JSON.stringify(body)).not.toContain('docker-exec:');
      });
  });

  it('keeps workflow in code review when run execution succeeds with failed check evidence', async () => {
    const { app, repository, seeded, started, runtimeJob, sessionToken } = await setupWorkflowOwnedRunExecution('58585858');
    const terminalResult = {
      ...workflowRunTerminalResult(runtimeJob),
      check_results: [{ name: 'unit', status: 'failed', summary: 'Unit tests failed.' }],
      public_summary: 'Execution completed with failed checks.',
    };

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob,
      sessionToken,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult,
      nonceSuffix: 'terminal-failed-checks',
    }).expect(201);

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'code_review' });
    await expect(repository.getRunSession(started.body.execution_run_summary.run_session_id)).resolves.toMatchObject({
      status: 'succeeded',
      check_results: [{ name: 'unit', status: 'failed', summary: 'Unit tests failed.' }],
      summary: 'Execution completed with failed checks.',
    });
  });

  it.each([
    ['failed', 'failed', 'codex_runtime_job_failed'],
    ['cancelled', 'cancelled', 'codex_runtime_job_cancelled'],
  ] as const)(
    'terminalizes workflow-owned run-execution %s through the same guarded failure path',
    async (terminalStatus, expectedRunStatus, reasonCode) => {
      const { app, repository, seeded, started, runtimeJob, sessionToken } = await setupWorkflowOwnedRunExecution(
        terminalStatus === 'failed' ? '59595959' : '60606060',
      );
      const sessionBefore = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);

      await terminalizeWorkflowRuntimeJobRequest(app, {
        runtimeJob,
        sessionToken,
        terminalStatus,
        reasonCode,
        nonceSuffix: `terminal-${terminalStatus}`,
      }).expect(201);

      await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({
        status: 'blocked',
        previous_status: 'execution_running',
      });
      await expect(repository.getRunSession(started.body.execution_run_summary.run_session_id)).resolves.toMatchObject({
        status: expectedRunStatus,
      });
      const terminalTurn = await repository.getCodexSessionTurn(runtimeJob.codex_session_turn_id!);
      expect(terminalTurn).toMatchObject({
        status: expectedRunStatus,
      });
      expect(terminalTurn?.output_capsule_id).toBeUndefined();
      expect(terminalTurn?.output_capsule_digest).toBeUndefined();
      await expect(repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id })).resolves.toMatchObject({
        status: 'terminal',
        terminal_status: terminalStatus,
      });
      await expect(repository.getCodexSession(seeded.workflow.active_codex_session_id!)).resolves.toMatchObject({
        status: 'blocked',
        latest_capsule_id: sessionBefore?.latest_capsule_id,
        latest_capsule_digest: sessionBefore?.latest_capsule_digest,
        latest_memory_bundle_ref: sessionBefore?.latest_memory_bundle_ref,
        latest_memory_bundle_digest: sessionBefore?.latest_memory_bundle_digest,
        latest_environment_manifest_ref: sessionBefore?.latest_environment_manifest_ref,
        latest_environment_manifest_digest: sessionBefore?.latest_environment_manifest_digest,
      });
    },
  );

  it('records stale workflow-owned terminalization without mutating active execution state', async () => {
    const { app, repository, seeded, started, runtimeJob, sessionToken } = await setupWorkflowOwnedRunExecution('61616161');
    const sessionBefore = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    const turnBefore = await repository.getCodexSessionTurn(runtimeJob.codex_session_turn_id!);
    const runBefore = await repository.getRunSession(started.body.execution_run_summary.run_session_id);
    const runtimeJobBefore = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id });
    const staleNow = new Date(Date.parse(process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? now) + 11 * 60_000).toISOString();
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', staleNow);
    const terminalResult = workflowRunTerminalResult(runtimeJob);

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob,
      sessionToken,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult,
      nonceSuffix: 'terminal-stale',
      nonceTimestamp: staleNow,
    }).expect(201);

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_running' });
    await expect(repository.getRunSession(started.body.execution_run_summary.run_session_id)).resolves.toEqual(runBefore);
    await expect(repository.getCodexSessionTurn(runtimeJob.codex_session_turn_id!)).resolves.toEqual(turnBefore);
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id })).resolves.toEqual(runtimeJobBefore);
    await expect(repository.getCodexSession(seeded.workflow.active_codex_session_id!)).resolves.toEqual(sessionBefore);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(seeded.workflow.active_codex_session_id!)).resolves.toEqual([
      expect.objectContaining({
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: runtimeJob.codex_session_turn_id,
        attempted_output_capsule_digest: terminalResult.output_capsule.digest,
        failure_code: 'codex_session_stale_terminalization',
      }),
    ]);
  });

  it('rejects stale workflow-owned terminalization without worker session proof', async () => {
    const { app, repository, seeded, started, runtimeJob } = await setupWorkflowOwnedRunExecution('61616162');
    const sessionBefore = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    const turnBefore = await repository.getCodexSessionTurn(runtimeJob.codex_session_turn_id!);
    const runBefore = await repository.getRunSession(started.body.execution_run_summary.run_session_id);
    const runtimeJobBefore = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id });
    const staleNow = new Date(Date.parse(process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? now) + 11 * 60_000).toISOString();
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', staleNow);

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob,
      sessionToken: 'forged-plan-item-workflow-run-session-token',
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult: workflowRunTerminalResult(runtimeJob),
      nonceSuffix: 'terminal-stale-forged-session',
      nonceTimestamp: staleNow,
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('codex_runtime_job_unavailable');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_running' });
    await expect(repository.getRunSession(started.body.execution_run_summary.run_session_id)).resolves.toEqual(runBefore);
    await expect(repository.getCodexSessionTurn(runtimeJob.codex_session_turn_id!)).resolves.toEqual(turnBefore);
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id })).resolves.toEqual(runtimeJobBefore);
    await expect(repository.getCodexSession(seeded.workflow.active_codex_session_id!)).resolves.toEqual(sessionBefore);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(seeded.workflow.active_codex_session_id!)).resolves.toEqual([]);
  });

  it('rejects workflow-owned successful terminalization without output capsule evidence', async () => {
    const { app, repository, seeded, started, runtimeJob, sessionToken } = await setupWorkflowOwnedRunExecution('62626262');
    const terminalResult = { ...workflowRunTerminalResult(runtimeJob) } as Record<string, unknown>;
    delete terminalResult.output_capsule;

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob,
      sessionToken,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult,
      nonceSuffix: 'terminal-missing-capsule',
    }).expect(400);

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_running' });
    await expect(repository.getRunSession(started.body.execution_run_summary.run_session_id)).resolves.toMatchObject({
      status: 'queued',
    });
    const turn = await repository.getCodexSessionTurn(runtimeJob.codex_session_turn_id!);
    expect(turn).toMatchObject({
      status: 'running',
    });
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
  });

  it('rejects review response terminalization with stale lineage without mutating workflow state', async () => {
    const capturedLaunchTokens = new Map<string, string>();
    const { app, repository } = await bootApp(
      new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) }),
    );
    const seeded = await runPlanItemWorkflowToExecutionReady(app, '65656565');
    const readyWorkflow = (await repository.getPlanItemWorkflow(seeded.workflow.id))!;
    const executionPackage = (await repository.getExecutionPackage(readyWorkflow.execution_package_id!))!;
    await seedRunExecutionRuntime(repository, seeded.ids.project, executionPackage.repo_id, seeded.ids.actorTech);
    const started = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'runtime-control-plane-review-response-start' })
      .expect(201);
    const runSession = (await repository.getRunSession(started.body.execution_run_summary.run_session_id))!;
    const executionRuntimeJobId = runSession.runtime_metadata?.remote_runtime_job_id;
    if (executionRuntimeJobId === undefined) {
      throw new Error('Expected workflow execution start to bind a runtime job to the run session');
    }
    const executionRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: executionRuntimeJobId }))!;
    await driveWorkflowRuntimeJobToRunning(repository, executionRuntimeJob, capturedLaunchTokens);
    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob: executionRuntimeJob,
      sessionToken: `plan-item-workflow-run-session-${seeded.ids.project}`,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult: workflowRunTerminalResult(executionRuntimeJob),
      nonceSuffix: 'terminal-before-review-response',
    }).expect(201);
    const sessionAfterExecution = (await repository.getCodexSession(seeded.workflow.active_codex_session_id!))!;
    if (sessionAfterExecution.runner_launch_lease_id !== undefined) {
      await repository.clearCodexSessionRunnerOwner({
        session_id: sessionAfterExecution.id,
        runner_launch_lease_id: sessionAfterExecution.runner_launch_lease_id,
        terminal_reason_code: 'codex_runtime_job_succeeded',
        now: sessionAfterExecution.updated_at,
      });
    }
    const reviewExecutionPackage = (await repository.getExecutionPackage(executionPackage.id))!;
    const sessionBeforeReviewResponse = (await repository.getCodexSession(sessionAfterExecution.id))!;
    expect(sessionBeforeReviewResponse.runner_worker_id).toBeUndefined();
    expect(sessionBeforeReviewResponse.runner_runtime_job_id).toBeUndefined();
    expect(sessionBeforeReviewResponse.runner_launch_lease_id).toBeUndefined();
    expect(sessionBeforeReviewResponse.runner_expires_at).toBeUndefined();

    const reviewPacket = {
      id: deterministicRuntimeArtifactId(seeded.workflow.id, 'review-response-stale-context-packet'),
      workflow_id: seeded.workflow.id,
      codex_session_id: executionRuntimeJob.codex_session_id!,
      codex_session_turn_id: runSession.codex_session_turn_id,
      execution_package_id: executionPackage.id,
      run_session_id: runSession.id,
      reviewer_actor_id: seeded.ids.actorTech,
      spec_revision_id: seeded.specRevisionId,
      plan_revision_id: seeded.implementationPlanRevisionId,
      status: 'completed' as const,
      decision: 'changes_requested' as const,
      summary: 'Review requests a response.',
      changed_files: [],
      check_result_summary: 'Checks passed.',
      self_review: { status: 'done', summary: 'Self review complete.' },
      risk_notes: ['Review response must preserve previous run lineage.'],
      requested_changes: [{ id: 'change-1', severity: 'medium', body: 'Explain the failed assumption.' }],
      created_at: now,
      updated_at: now,
      completed_at: now,
    };
    const reviewPacketDigest = reviewPacketInputDigest({
      packet: reviewPacket,
      evidence_refs: [],
      previous_run_session_id: runSession.id,
      execution_package_id: reviewExecutionPackage.id,
      execution_package_version: reviewExecutionPackage.execution_package_version ?? reviewExecutionPackage.version,
      approved_spec_revision_id: seeded.specRevisionId,
      approved_implementation_plan_revision_id: seeded.implementationPlanRevisionId,
    });
    await repository.saveReviewPacket({ ...reviewPacket, current_digest: reviewPacketDigest });
    const codeReviewWorkflow = (await repository.getPlanItemWorkflow(seeded.workflow.id))!;
    const session = (await repository.getCodexSession(codeReviewWorkflow.active_codex_session_id!))!;
    const actionContextPreviewDigest = codexCanonicalDigest({
      workflow_id: codeReviewWorkflow.id,
      codex_session_id: session.id,
      development_plan_id: codeReviewWorkflow.development_plan_id,
      development_plan_item_id: codeReviewWorkflow.development_plan_item_id,
      workflow_status: codeReviewWorkflow.status,
      active_boundary_summary_revision_id: codeReviewWorkflow.active_boundary_summary_revision_id ?? null,
      active_spec_doc_revision_id: codeReviewWorkflow.active_spec_doc_revision_id ?? null,
      active_implementation_plan_doc_revision_id: codeReviewWorkflow.active_implementation_plan_doc_revision_id ?? null,
      latest_capsule_digest: session.latest_capsule_digest ?? null,
      action_kind: 'respond_to_review',
    });
    const action = await repository.createOrReplayPlanItemWorkflowQueuedAction({
      id: deterministicRuntimeArtifactId(seeded.workflow.id, 'review-response-stale-context-action'),
      workflow_id: seeded.workflow.id,
      codex_session_id: session.id,
      kind: 'respond_to_review',
      status: 'queued',
      expected_input_capsule_digest: session.latest_capsule_digest!,
      context_preview_digest: actionContextPreviewDigest,
      idempotency_key: codexCanonicalDigest({ kind: 'review-response-stale-context-idempotency', workflow_id: seeded.workflow.id }),
      created_by_actor_id: seeded.ids.actorTech,
      created_at: now,
      updated_at: now,
    });

    vi.stubEnv('FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE', 'runtime');
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', '2026-05-31T00:02:00.000Z');
    const runReviewResponse = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
      .send({ actor_id: seeded.ids.actorTech });
    expect(runReviewResponse.status, JSON.stringify(runReviewResponse.body)).toBe(201);
    const runtimeJobRecords = repository as unknown as { codexRuntimeJobs: Map<string, { job: CodexRuntimeJob }> };
    const reviewRuntimeJob = [...runtimeJobRecords.codexRuntimeJobs.values()]
      .map((record) => record.job)
      .find((candidate) => candidate.target_id === action.id);
    expect(reviewRuntimeJob).toBeDefined();
    const runtimePrivate = repository as unknown as {
      codexRuntimeJobs: Map<string, { job: CodexRuntimeJob }>;
      codexLaunchLeases: Map<string, { lease: Record<string, unknown> }>;
    };
    const scheduledReviewJobRecord = runtimePrivate.codexRuntimeJobs.get(reviewRuntimeJob!.id);
    const scheduledReviewLeaseRecord = runtimePrivate.codexLaunchLeases.get(reviewRuntimeJob!.launch_lease_id);
    expect(scheduledReviewJobRecord).toBeDefined();
    expect(scheduledReviewLeaseRecord).toBeDefined();
    // This regression targets terminalization guards; attach/materialize protocol coverage lives in runtime scheduler tests.
    runtimePrivate.codexRuntimeJobs.set(reviewRuntimeJob!.id, {
      ...scheduledReviewJobRecord!,
      job: {
        ...scheduledReviewJobRecord!.job,
        status: 'running',
        started_at: '2026-05-31T00:02:30.000Z',
        runtime_evidence_digest: codexCanonicalDigest(publicDockerRuntimeEvidence('generation')),
        launch_materialization_digest: codexCanonicalDigest({ lease_id: reviewRuntimeJob!.launch_lease_id }),
        updated_at: '2026-05-31T00:02:30.000Z',
      },
    });
    runtimePrivate.codexLaunchLeases.set(reviewRuntimeJob!.launch_lease_id, {
      ...scheduledReviewLeaseRecord!,
      lease: {
        ...scheduledReviewLeaseRecord!.lease,
        status: 'materialized',
        materialized_at: '2026-05-31T00:02:30.000Z',
      },
    });

    const runningRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: reviewRuntimeJob!.id }))!;
    const workspaceAcquisition = runningRuntimeJob.workspace_acquisition_json as Record<string, unknown>;
    const signedContextJson = { ...(workspaceAcquisition.signed_context_json as Record<string, unknown>) };
    delete signedContextJson.previous_run_session_id;
    const staleWorkspaceAcquisition = { ...workspaceAcquisition, signed_context_json: signedContextJson };
    const record = runtimeJobRecords.codexRuntimeJobs.get(runningRuntimeJob.id);
    expect(record).toBeDefined();
    runtimeJobRecords.codexRuntimeJobs.set(runningRuntimeJob.id, {
      ...record!,
      job: {
        ...record!.job,
        workspace_acquisition_json: staleWorkspaceAcquisition,
      },
    });

    const runtimeJobBefore = (await repository.getCodexRuntimeJob({ runtime_job_id: runningRuntimeJob.id }))!;
    const actionBefore = await repository.getPlanItemWorkflowQueuedAction({ workflow_id: seeded.workflow.id, action_id: action.id });
    const turnBefore = await repository.getCodexSessionTurn(actionBefore!.codex_session_turn_id!);
    const sessionBefore = await repository.getCodexSession(session.id);
    const workflowBefore = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const eventsBefore = await repository.listObjectEvents(seeded.workflow.id, 'plan_item_workflow');
    const leaseBefore = runtimePrivate.codexLaunchLeases.get(runningRuntimeJob.launch_lease_id);
    await expect(repository.getLatestReviewResponseForWorkflow(seeded.workflow.id)).resolves.toBeUndefined();

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob: runningRuntimeJob,
      sessionToken: `plan-item-workflow-session-${seeded.ids.project}`,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult: reviewResponseTerminalResult(runningRuntimeJob),
      nonceSuffix: 'terminal-review-response-stale-context',
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code, JSON.stringify(body)).toBe('workflow_review_packet_not_current');
      });

    await expect(repository.getCodexRuntimeJob({ runtime_job_id: runningRuntimeJob.id })).resolves.toEqual(runtimeJobBefore);
    await expect(repository.getPlanItemWorkflowQueuedAction({ workflow_id: seeded.workflow.id, action_id: action.id })).resolves.toEqual(
      actionBefore,
    );
    await expect(repository.getCodexSessionTurn(actionBefore!.codex_session_turn_id!)).resolves.toEqual(turnBefore);
    await expect(repository.getCodexSession(session.id)).resolves.toEqual(sessionBefore);
    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toEqual(workflowBefore);
    await expect(repository.getLatestReviewResponseForWorkflow(seeded.workflow.id)).resolves.toBeUndefined();
    await expect(repository.listObjectEvents(seeded.workflow.id, 'plan_item_workflow')).resolves.toEqual(eventsBefore);
    expect(runtimePrivate.codexLaunchLeases.get(runningRuntimeJob.launch_lease_id)).toEqual(leaseBefore);

    const staleRecord = runtimeJobRecords.codexRuntimeJobs.get(runningRuntimeJob.id);
    expect(staleRecord).toBeDefined();
    runtimeJobRecords.codexRuntimeJobs.set(runningRuntimeJob.id, {
      ...staleRecord!,
      job: {
        ...staleRecord!.job,
        workspace_acquisition_json: workspaceAcquisition,
      },
    });

    await repository.saveReviewPacketEvidenceRef({
      id: deterministicRuntimeArtifactId(seeded.workflow.id, 'review-response-drifted-evidence'),
      review_packet_id: reviewPacket.id,
      workflow_id: seeded.workflow.id,
      ref_kind: 'markdown_excerpt',
      visibility: 'public',
      display_text: 'Evidence added after the review response runtime job was scheduled.',
      digest: sha('abcdef'),
      created_by_actor_id: seeded.ids.actorTech,
      created_at: '2026-05-31T00:02:45.000Z',
    });
    const digestDriftRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: runningRuntimeJob.id }))!;
    const digestDriftRuntimeJobBefore = (await repository.getCodexRuntimeJob({ runtime_job_id: digestDriftRuntimeJob.id }))!;
    const digestDriftActionBefore = await repository.getPlanItemWorkflowQueuedAction({
      workflow_id: seeded.workflow.id,
      action_id: action.id,
    });
    const digestDriftTurnBefore = await repository.getCodexSessionTurn(digestDriftActionBefore!.codex_session_turn_id!);
    const digestDriftSessionBefore = await repository.getCodexSession(session.id);
    const digestDriftWorkflowBefore = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const digestDriftReviewPacketBefore = await repository.getReviewPacket(reviewPacket.id);
    const digestDriftEventsBefore = await repository.listObjectEvents(seeded.workflow.id, 'plan_item_workflow');
    const digestDriftLeaseBefore = runtimePrivate.codexLaunchLeases.get(digestDriftRuntimeJob.launch_lease_id);
    await expect(repository.getLatestReviewResponseForWorkflow(seeded.workflow.id)).resolves.toBeUndefined();

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob: digestDriftRuntimeJob,
      sessionToken: `plan-item-workflow-session-${seeded.ids.project}`,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult: reviewResponseTerminalResult(digestDriftRuntimeJob),
      nonceSuffix: 'terminal-review-response-digest-drift',
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code, JSON.stringify(body)).toBe('workflow_review_packet_digest_mismatch');
      });

    await expect(repository.getCodexRuntimeJob({ runtime_job_id: digestDriftRuntimeJob.id })).resolves.toEqual(digestDriftRuntimeJobBefore);
    await expect(repository.getPlanItemWorkflowQueuedAction({ workflow_id: seeded.workflow.id, action_id: action.id })).resolves.toEqual(
      digestDriftActionBefore,
    );
    await expect(repository.getCodexSessionTurn(digestDriftActionBefore!.codex_session_turn_id!)).resolves.toEqual(digestDriftTurnBefore);
    await expect(repository.getCodexSession(session.id)).resolves.toEqual(digestDriftSessionBefore);
    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toEqual(digestDriftWorkflowBefore);
    await expect(repository.getReviewPacket(reviewPacket.id)).resolves.toEqual(digestDriftReviewPacketBefore);
    await expect(repository.getLatestReviewResponseForWorkflow(seeded.workflow.id)).resolves.toBeUndefined();
    await expect(repository.listObjectEvents(seeded.workflow.id, 'plan_item_workflow')).resolves.toEqual(digestDriftEventsBefore);
    expect(runtimePrivate.codexLaunchLeases.get(digestDriftRuntimeJob.launch_lease_id)).toEqual(digestDriftLeaseBefore);

    await repository.saveReviewPacket({
      ...reviewPacket,
      superseded_by_review_packet_id: deterministicRuntimeArtifactId(seeded.workflow.id, 'review-response-superseding-packet'),
      current_digest: reviewPacketDigest,
    });
    const supersededRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: runningRuntimeJob.id }))!;
    const supersededRuntimeJobBefore = (await repository.getCodexRuntimeJob({ runtime_job_id: supersededRuntimeJob.id }))!;
    const supersededActionBefore = await repository.getPlanItemWorkflowQueuedAction({
      workflow_id: seeded.workflow.id,
      action_id: action.id,
    });
    const supersededTurnBefore = await repository.getCodexSessionTurn(supersededActionBefore!.codex_session_turn_id!);
    const supersededSessionBefore = await repository.getCodexSession(session.id);
    const supersededWorkflowBefore = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const supersededReviewPacketBefore = await repository.getReviewPacket(reviewPacket.id);
    const supersededEventsBefore = await repository.listObjectEvents(seeded.workflow.id, 'plan_item_workflow');
    const supersededLeaseBefore = runtimePrivate.codexLaunchLeases.get(supersededRuntimeJob.launch_lease_id);
    await expect(repository.getLatestReviewResponseForWorkflow(seeded.workflow.id)).resolves.toBeUndefined();

    await terminalizeWorkflowRuntimeJobRequest(app, {
      runtimeJob: supersededRuntimeJob,
      sessionToken: `plan-item-workflow-session-${seeded.ids.project}`,
      terminalStatus: 'succeeded',
      reasonCode: 'codex_runtime_job_succeeded',
      terminalResult: reviewResponseTerminalResult(supersededRuntimeJob),
      nonceSuffix: 'terminal-review-response-superseded-packet',
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code, JSON.stringify(body)).toBe('workflow_review_packet_not_current');
      });

    await expect(repository.getCodexRuntimeJob({ runtime_job_id: supersededRuntimeJob.id })).resolves.toEqual(supersededRuntimeJobBefore);
    await expect(repository.getPlanItemWorkflowQueuedAction({ workflow_id: seeded.workflow.id, action_id: action.id })).resolves.toEqual(
      supersededActionBefore,
    );
    await expect(repository.getCodexSessionTurn(supersededActionBefore!.codex_session_turn_id!)).resolves.toEqual(supersededTurnBefore);
    await expect(repository.getCodexSession(session.id)).resolves.toEqual(supersededSessionBefore);
    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toEqual(supersededWorkflowBefore);
    await expect(repository.getReviewPacket(reviewPacket.id)).resolves.toEqual(supersededReviewPacketBefore);
    await expect(repository.getLatestReviewResponseForWorkflow(seeded.workflow.id)).resolves.toBeUndefined();
    await expect(repository.listObjectEvents(seeded.workflow.id, 'plan_item_workflow')).resolves.toEqual(supersededEventsBefore);
    expect(runtimePrivate.codexLaunchLeases.get(supersededRuntimeJob.launch_lease_id)).toEqual(supersededLeaseBefore);
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
            status: 'terminal',
            terminal_status: 'expired',
            terminal_reason_code: 'codex_runtime_job_stale',
          }),
        ]);
        expect(body.recovered_launch_leases).toEqual([
          expect.objectContaining({ launch_lease_digest: expect.stringMatching(/^sha256:/), status: 'expired' }),
        ]);
        expect(body.recovered_runtime_jobs[0].worker_id).toBeUndefined();
        expect(body.recovered_runtime_jobs[0].launch_lease_id).toBeUndefined();
        expect(body.recovered_runtime_jobs[0].input_json).toBeUndefined();
        expect(body.recovered_runtime_jobs[0].workspace_acquisition_json).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain(runtimeJobLaunchLeaseId);
        expect(JSON.stringify(body)).not.toContain(workerId);
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
    const { app, runtimeJob, sessionToken } = await setupWorkflowOwnedRunExecution('64646464', { driveToRunning: false });
    const workspaceAcquisition = runtimeJob.workspace_acquisition_json;
    if (workspaceAcquisition === undefined) {
      throw new Error('Expected workflow-owned runtime job to include workspace acquisition');
    }
    const workerRequestNow = process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();

    const poll = await request(app.getHttpServer())
      .post(`/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/poll`)
      .send(
        runtimeWorkerBody(sessionToken, 'runtime-job-poll-run-execution-workspace', {
          nonce_timestamp: workerRequestNow,
          limit: 1,
          target_kinds: ['run_execution'],
        }),
      )
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
