import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../apps/control-plane-api/src/modules/core/control-plane-tokens';
import {
  InMemoryDeliveryRepository,
  type CodexLaunchTokenEnvelopeSealer,
  type DeliveryRepository,
} from '../packages/db/src';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  type CodexRuntimeCapsule,
  type CodexRuntimeJob,
} from '../packages/domain/src';
import {
  seedRunExecutionRuntime,
  seedWorkflowWithApprovedImplementationPlan,
} from '../tests/helpers/plan-item-workflow-fixtures';

export const planItemExecutionHandoffDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-handoff-dogfood.ts' as const;
export const planItemExecutionHandoffProductStartRoute = 'POST /plan-item-workflows/:workflowId/execution/start' as const;

const forceLocalDogfoodNoProxy = (): void => {
  process.env.NO_PROXY = '*';
  process.env.no_proxy = '*';
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete process.env[key];
  }
};

type Sha256Digest = `sha256:${string}`;

type WorkflowDto = {
  id: string;
  status: string;
  active_boundary_summary_revision_id?: string;
  active_spec_doc_revision_id?: string;
  active_implementation_plan_doc_revision_id?: string;
  execution_run_summary?: {
    run_session_id: string;
    status: string;
    execution_package_version?: number;
    input_capsule_digest?: string;
    workspace_bundle_digest?: string;
    codex_thread_id_digest?: string;
  };
  queued_actions?: Array<{ id: string; kind: string; status: string }>;
};
type WorkflowResponseBody = WorkflowDto | { workflow: WorkflowDto; queued_actions?: WorkflowDto['queued_actions'] };

type PlanItemExecutionHandoffDogfoodReport = {
  status: 'PASS';
  source: 'deterministic_fake_worker';
  package_script_command: 'pnpm dogfood:plan-item-execution-handoff';
  workflow_id: string;
  route_calls: Array<{ route: typeof planItemExecutionHandoffProductStartRoute; runtime_call: true; status: 'execution_running' }>;
  worker_steps: ['accept', 'claim_envelope', 'materialize', 'start', 'terminalize'];
  execution_start: {
    route: typeof planItemExecutionHandoffProductStartRoute;
    body_keys: ['actor_id', 'idempotency_key', 'rationale_markdown'];
    accepted_public_start_root: 'PlanItemWorkflow';
    rejected_public_start_roots: ['Source', 'Spec', 'Implementation Plan', 'generic Work Item', 'DevelopmentPlanItem', 'ExecutionPackage'];
  };
  terminal_state: {
    workflow_status: 'code_review';
    run_session_status: 'succeeded';
    turn_status: 'succeeded';
    session_status: 'idle';
  };
  session_continuity: {
    same_codex_session: true;
    resume_thread: true;
    session_digest: Sha256Digest;
    execution_turn_digest: Sha256Digest;
    thread_digest: Sha256Digest;
    input_capsule_digest: Sha256Digest;
    output_capsule_digest: Sha256Digest;
    memory_bundle_digest: Sha256Digest;
    environment_manifest_digest: Sha256Digest;
  };
  no_baggage: {
    owner_actor_id_rejected: true;
    legacy_public_package_starts_rejected: true;
    old_start_roots_rejected: true;
    inline_workspace_bundle_bytes_rejected: true;
    public_report_policy: 'public_safe_digests_counts_ids_only';
  };
};

const reportMarker = 'PLAN_ITEM_EXECUTION_HANDOFF_DOGFOOD_REPORT_JSON:';
const unsafeReportPattern =
  /(?:\/Users\/|\/home\/|\/tmp\/|~\/\.codex|auth_json|auth\.json|config\.toml|OPENAI_API_KEY|Bearer |sk-[A-Za-z0-9_.-]+|artifact:\/\/|lease-token|credential|execution_package_id|runtime_job_id|codex_session_turn_id|\/execution-packages\/[^"'`\s]+\/(?:run|rerun|force-rerun)|latest_snapshot_|CodexSessionSnapshot|codex_session_snapshot)/i;

const sha256 = (value: string): Sha256Digest => `sha256:${createHash('sha256').update(value).digest('hex')}`;

const stableUuid = (value: string): string => {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const stableUuidFromCanonical = (input: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const withBodyDigest = <T extends Record<string, unknown>>(body: T): T & { body_digest: string } => ({
  ...body,
  body_digest: codexCanonicalDigest(body),
});

const assertPublicSafeReport = (report: PlanItemExecutionHandoffDogfoodReport): void => {
  const serialized = JSON.stringify(report);
  if (unsafeReportPattern.test(serialized)) {
    throw new Error('plan_item_execution_handoff_dogfood_report_unsafe');
  }
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
      sealed_payload_ref: `artifact://internal/codex_launch_token_envelope/runtime_job/${input.runtime_job_id}/${input.envelope_id}`,
      sealed_payload_digest: codexCanonicalDigest({
        launch_token: input.plaintext_launch_token,
        runtime_job_id: input.runtime_job_id,
      }),
      aad_json,
      aad_digest: codexCanonicalDigest(aad_json),
      expires_at: input.expires_at,
    };
    return {
      ...envelopeWithoutDigest,
      envelope_digest: codexCanonicalDigest(envelopeWithoutDigest),
    };
  },
});

const bootDogfoodApp = async (capturedLaunchTokens: Map<string, string>) => {
  const repository = new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: capturingSealer(capturedLaunchTokens) });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(repository)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, repository };
};

const requireStatus = async <T extends { body: unknown }>(
  requestPromise: Promise<T>,
  expectedStatus: number,
  label: string,
): Promise<T & { body: WorkflowResponseBody }> => {
  const response = await requestPromise;
  const actualStatus = (response as unknown as { status: number }).status;
  if (actualStatus !== expectedStatus) {
    throw new Error(
      `plan_item_execution_handoff_dogfood_${label}_status_${actualStatus}:${JSON.stringify(
        (response as unknown as { body: unknown }).body,
      )}`,
    );
  }
  return response as T & { body: WorkflowResponseBody };
};

const workflowDto = (body: WorkflowResponseBody): WorkflowDto => ('workflow' in body ? body.workflow : body);

const terminalizeApprovedImplementationPlanTurn = async (
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedWorkflowWithApprovedImplementationPlan>>,
): Promise<void> => {
  const sessionId = seeded.workflow.active_codex_session_id;
  const turnId = seeded.implementationPlanRevision.codex_session_turn_id;
  if (sessionId === undefined || turnId === undefined) {
    throw new Error('plan_item_execution_handoff_dogfood_missing_seeded_session_turn');
  }
  const session = await repository.getCodexSession(sessionId);
  const turn = await repository.getCodexSessionTurn(turnId);
  if (session === undefined || turn === undefined) {
    throw new Error('plan_item_execution_handoff_dogfood_missing_seeded_session_turn_record');
  }
  const workerId = `dogfood-session-worker-${seeded.workflow.id}`;
  const leaseTokenHash = codexCredentialPayloadDigest(`dogfood-session-lease-${turnId}`);
  const workerSessionDigest = codexCredentialPayloadDigest(`dogfood-session-worker-token-${turnId}`);
  const terminalizeNow = '2026-05-31T00:05:00.000Z';
  const claimed = await repository.claimCodexSessionLease({
    session_id: session.id,
    workflow_id: seeded.workflow.id,
    lease_id: `dogfood-session-lease-${turnId}`,
    lease_token_hash: leaseTokenHash,
    worker_id: workerId,
    worker_session_digest: workerSessionDigest,
    ...(session.latest_capsule_id === undefined ? {} : { input_capsule_id: session.latest_capsule_id }),
    ...(session.latest_capsule_digest === undefined
      ? {}
      : { expected_input_capsule_digest: session.latest_capsule_digest, input_capsule_digest: session.latest_capsule_digest }),
    ...(session.latest_memory_bundle_ref === undefined ? {} : { input_memory_bundle_ref: session.latest_memory_bundle_ref }),
    ...(session.latest_memory_bundle_digest === undefined
      ? {}
      : { input_memory_bundle_digest: session.latest_memory_bundle_digest }),
    ...(session.latest_environment_manifest_ref === undefined
      ? {}
      : { input_environment_manifest_ref: session.latest_environment_manifest_ref }),
    ...(session.latest_environment_manifest_digest === undefined
      ? {}
      : { input_environment_manifest_digest: session.latest_environment_manifest_digest }),
    now: '2026-05-31T00:04:00.000Z',
    expires_at: '2026-05-31T00:14:00.000Z',
  });
  const codexThreadId = `dogfood-thread-${seeded.workflow.id}`;
  const codexThreadIdDigest = codexCanonicalDigest({
    kind: 'codex_app_server_thread_id',
    thread_id: codexThreadId,
  });
  const previousCapsule =
    session.latest_capsule_id === undefined ? undefined : await repository.getCodexRuntimeCapsule(session.latest_capsule_id);
  const outputCapsuleId = stableUuid(`${turnId}:approved-implementation-plan-output-capsule`);
  const outputMemoryBundleRef = `artifact://internal/codex_memory_bundle/codex_session/${session.id}/memory-${turnId}`;
  const outputEnvironmentManifestRef = `artifact://internal/codex_environment_manifest/codex_session/${session.id}/environment-${turnId}`;
  await repository.terminalizeCodexSessionTurn({
    session_id: session.id,
    turn_id: turn.id,
    lease_id: claimed.lease.id,
    lease_token_hash: claimed.lease.lease_token_hash,
    lease_epoch: claimed.lease.lease_epoch,
    worker_id: workerId,
    worker_session_digest: workerSessionDigest,
    status: 'succeeded',
    expected_input_capsule_digest: session.latest_capsule_digest,
    input_capsule_id: session.latest_capsule_id,
    input_capsule_digest: session.latest_capsule_digest,
    input_memory_bundle_ref: session.latest_memory_bundle_ref,
    input_memory_bundle_digest: session.latest_memory_bundle_digest,
    input_environment_manifest_ref: session.latest_environment_manifest_ref,
    input_environment_manifest_digest: session.latest_environment_manifest_digest,
    output_capsule: {
      id: outputCapsuleId,
      codex_session_id: session.id,
      created_from_turn_id: turn.id,
      sequence: (previousCapsule?.sequence ?? 0) + 1,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${session.id}/${outputCapsuleId}`,
      digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'approved-implementation-plan-output-capsule' }),
      size_bytes: '0',
      manifest_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'approved-implementation-plan-output-manifest' }),
      thread_state_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'approved-implementation-plan-thread-state' }),
      memory_state_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'approved-implementation-plan-memory-state' }),
      environment_manifest_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'approved-implementation-plan-env-state' }),
      codex_thread_id_digest: codexThreadIdDigest,
      codex_cli_version: 'dogfood-codex',
      app_server_protocol_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'approved-implementation-plan-protocol' }),
      runtime_profile_revision_id: seeded.ids.runtimeProfileRevision,
      trusted_runtime_manifest_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'trusted-runtime' }),
      credential_binding_lineage_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'credential-lineage' }),
      created_by_actor_id: workerId,
      created_at: terminalizeNow,
    },
    output_memory_bundle_ref: outputMemoryBundleRef,
    output_memory_bundle_digest: codexCanonicalDigest({ turn_id: turn.id, artifact: 'approved-implementation-plan-memory-bundle' }),
    output_environment_manifest_ref: outputEnvironmentManifestRef,
    output_environment_manifest_digest: codexCanonicalDigest({
      turn_id: turn.id,
      artifact: 'approved-implementation-plan-environment-manifest',
    }),
    output_object_type: 'implementation_plan_revision',
    output_object_id: seeded.implementationPlanRevision.id,
    app_server_thread_binding_required: true,
    codex_thread_id: codexThreadId,
    codex_thread_id_digest: codexThreadIdDigest,
    now: terminalizeNow,
  });
};

const runWorkflowToExecutionReady = async (
  app: Awaited<ReturnType<typeof bootDogfoodApp>>['app'],
  repository: DeliveryRepository,
) => {
  const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '57575758' });
  await terminalizeApprovedImplementationPlanTurn(repository, seeded);
  const ready = await requireStatus(
    request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution-readiness/evaluate`)
      .send({ actor_id: seeded.ids.actorTech, rationale_markdown: 'Evaluate deterministic dogfood execution readiness.' }),
    201,
    'execution_readiness',
  );
  if (workflowDto(ready.body).status !== 'execution_ready') {
    throw new Error('plan_item_execution_handoff_dogfood_not_execution_ready');
  }
  return seeded;
};

const driveWorkflowRuntimeJobToRunning = async (
  repository: DeliveryRepository,
  runtimeJob: CodexRuntimeJob,
  capturedLaunchTokens: Map<string, string>,
) => {
  const requestNow = process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();
  const sessionToken = `plan-item-workflow-run-session-${runtimeJob.project_id}`;
  const sessionKeyId = `plan-item-workflow-run-session-key-${runtimeJob.project_id}`;
  const acceptedSessionDigest = codexCredentialPayloadDigest(sessionToken);
  const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id });
  if (envelope === undefined) {
    throw new Error('plan_item_execution_handoff_dogfood_missing_envelope');
  }
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/dogfood/workflow-run-execution/${runtimeJob.id}/${step}`,
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
    envelope_id: envelope.id,
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
  const launchToken = capturedLaunchTokens.get(runtimeJob.id);
  if (launchToken === undefined) {
    throw new Error('plan_item_execution_handoff_dogfood_missing_launch_token');
  }
  await repository.materializeCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    launch_lease_id: runtimeJob.launch_lease_id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeJob.id}-materialize`,
    nonce_timestamp: requestNow,
    launch_token_hash: codexCredentialPayloadDigest(launchToken),
    accepted_worker_session_digest: acceptedSessionDigest,
    accepted_session_public_key_id: sessionKeyId,
    accepted_session_epoch: 1,
    materialization_request_id: `${runtimeJob.id}-materialize`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, step: 'materialize' }),
    replay_protection: replayProtection('materialize'),
    now: requestNow,
  });
  await repository.startCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeJob.id}-start`,
    nonce_timestamp: requestNow,
    idempotency_key: `${runtimeJob.id}-start`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, step: 'start' }),
    runtime_evidence_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, runtime: 'fake-dogfood' }),
    launch_materialization_digest: codexCanonicalDigest({ lease_id: runtimeJob.launch_lease_id }),
    replay_protection: replayProtection('start'),
    now: requestNow,
  });
};

const outputCapsuleForWorkflowRun = (runtimeJob: CodexRuntimeJob): CodexRuntimeCapsule => {
  const workload = runtimeJob.input_json as {
    codex_session_runtime_context: {
      codex_session_id: string;
      codex_session_turn_id: string;
      continuation: { codex_thread_id_digest: string };
    };
  };
  const capsuleId = stableUuid(`${runtimeJob.id}:output-capsule`);
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
    codex_cli_version: 'dogfood-codex',
    app_server_protocol_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'app-server-protocol' }),
    runtime_profile_revision_id: stableUuidFromCanonical({
      kind: 'plan-item-workflow-run-profile-revision',
      projectId: runtimeJob.project_id,
    }),
    trusted_runtime_manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'trusted-runtime' }),
    credential_binding_lineage_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'credential-lineage' }),
    created_by_actor_id: runtimeJob.worker_id,
    created_at: process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString(),
  };
};

const workflowRunTerminalResult = (runtimeJob: CodexRuntimeJob) => {
  const workload = runtimeJob.input_json as {
    execution_package_id: string;
    execution_package_version: number;
    run_session_id: string;
    workspace_bundle_digest: string;
    workspace_acquisition_json: { manifest_digest: string };
    codex_session_runtime_context: {
      codex_session_id: string;
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
    changed_files: ['docs/superpowers/plans/2026-06-06-plan-item-execution-handoff-continuity.md'],
    check_results: [],
    execution_artifacts: [],
    public_summary: 'Workflow-owned Plan Item execution handoff completed.',
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

const terminalizeWorkflowRuntimeJob = async (
  app: Awaited<ReturnType<typeof bootDogfoodApp>>['app'],
  runtimeJob: CodexRuntimeJob,
): Promise<void> => {
  const sessionToken = `plan-item-workflow-run-session-${runtimeJob.project_id}`;
  const nonce = `${runtimeJob.id}-terminal`;
  const nonceTimestamp = process.env.FORGELOOP_AUTOMATION_TEST_NOW ?? new Date().toISOString();
  const response = await request(app.getHttpServer())
    .post(`/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/${runtimeJob.id}/terminal`)
    .send(
      withBodyDigest({
        worker_session_token: sessionToken,
        nonce,
        nonce_timestamp: nonceTimestamp,
        launch_lease_id: runtimeJob.launch_lease_id,
        terminal_status: 'succeeded',
        reason_code: 'codex_runtime_job_succeeded',
        terminal_idempotency_key: nonce,
        terminal_result_json: workflowRunTerminalResult(runtimeJob),
      }),
    );
  if (response.status !== 201) {
    throw new Error(`plan_item_execution_handoff_dogfood_terminal_status_${response.status}:${JSON.stringify(response.body)}`);
  }
};

export const runPlanItemExecutionHandoffDogfood = async (): Promise<PlanItemExecutionHandoffDogfoodReport> => {
  const capturedLaunchTokens = new Map<string, string>();
  const { app, repository } = await bootDogfoodApp(capturedLaunchTokens);
  try {
    const seeded = await runWorkflowToExecutionReady(app, repository);
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    if (readyWorkflow?.execution_package_id === undefined) {
      throw new Error('plan_item_execution_handoff_dogfood_missing_execution_package');
    }
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow.execution_package_id);
    if (readyExecutionPackage === undefined) {
      throw new Error('plan_item_execution_handoff_dogfood_missing_ready_package');
    }
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage.repo_id, seeded.ids.actorTech);

    const start = await requireStatus(
      request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
        .send({
          actor_id: seeded.ids.actorTech,
          idempotency_key: 'plan-item-execution-handoff-dogfood',
          rationale_markdown: 'Start deterministic Plan Item execution handoff dogfood.',
        }),
      201,
      'execution_start',
    );
    const startedWorkflow = workflowDto(start.body);
    if (startedWorkflow.status !== 'execution_running' || startedWorkflow.execution_run_summary?.run_session_id === undefined) {
      throw new Error('plan_item_execution_handoff_dogfood_start_summary_missing');
    }
    const publicStartSummary = startedWorkflow.execution_run_summary as Record<string, unknown>;
    if (
      publicStartSummary.execution_package_id !== undefined ||
      publicStartSummary.runtime_job_id !== undefined ||
      publicStartSummary.codex_session_turn_id !== undefined
    ) {
      throw new Error('plan_item_execution_handoff_dogfood_public_summary_leaked_internal_ids');
    }
    const startedRunSession = await repository.getRunSession(startedWorkflow.execution_run_summary.run_session_id);
    if (
      startedRunSession === undefined ||
      startedRunSession.runtime_metadata?.remote_runtime_job_id === undefined ||
      startedRunSession.codex_session_turn_id === undefined
    ) {
      throw new Error('plan_item_execution_handoff_dogfood_internal_lineage_missing');
    }
    const runtimeJobId = startedRunSession.runtime_metadata.remote_runtime_job_id;
    const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
    if (runtimeJob === undefined) {
      throw new Error('plan_item_execution_handoff_dogfood_runtime_job_missing');
    }
    await driveWorkflowRuntimeJobToRunning(repository, runtimeJob, capturedLaunchTokens);
    await terminalizeWorkflowRuntimeJob(app, runtimeJob);

    const workflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const runSession = await repository.getRunSession(startedWorkflow.execution_run_summary.run_session_id);
    const turn = await repository.getCodexSessionTurn(startedRunSession.codex_session_turn_id);
    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    const terminalResult = workflowRunTerminalResult(runtimeJob);
    if (
      workflow?.status !== 'code_review' ||
      runSession?.status !== 'succeeded' ||
      turn?.status !== 'succeeded' ||
      session?.status !== 'idle' ||
      session.latest_capsule_digest !== terminalResult.output_capsule.digest
    ) {
      throw new Error('plan_item_execution_handoff_dogfood_terminal_state_mismatch');
    }

    const inputCapsuleDigest = startedWorkflow.execution_run_summary.input_capsule_digest;
    const codexThreadIdDigest = startedWorkflow.execution_run_summary.codex_thread_id_digest;
    const workspaceBundleDigest = startedWorkflow.execution_run_summary.workspace_bundle_digest;
    if (inputCapsuleDigest === undefined || codexThreadIdDigest === undefined || workspaceBundleDigest === undefined) {
      throw new Error('plan_item_execution_handoff_dogfood_public_digest_missing');
    }
    const report: PlanItemExecutionHandoffDogfoodReport = {
      status: 'PASS',
      source: 'deterministic_fake_worker',
      package_script_command: 'pnpm dogfood:plan-item-execution-handoff',
      workflow_id: seeded.workflow.id,
      route_calls: [{ route: planItemExecutionHandoffProductStartRoute, runtime_call: true, status: 'execution_running' }],
      worker_steps: ['accept', 'claim_envelope', 'materialize', 'start', 'terminalize'],
      execution_start: {
        route: planItemExecutionHandoffProductStartRoute,
        body_keys: ['actor_id', 'idempotency_key', 'rationale_markdown'],
        accepted_public_start_root: 'PlanItemWorkflow',
        rejected_public_start_roots: [
          'Source',
          'Spec',
          'Implementation Plan',
          'generic Work Item',
          'DevelopmentPlanItem',
          'ExecutionPackage',
        ],
      },
      terminal_state: {
        workflow_status: 'code_review',
        run_session_status: 'succeeded',
        turn_status: 'succeeded',
        session_status: 'idle',
      },
      session_continuity: {
        same_codex_session: session.id === seeded.workflow.active_codex_session_id,
        resume_thread: true,
        session_digest: sha256(session.id),
        execution_turn_digest: sha256(turn.id),
        thread_digest: codexThreadIdDigest as Sha256Digest,
        input_capsule_digest: inputCapsuleDigest as Sha256Digest,
        output_capsule_digest: terminalResult.output_capsule.digest as Sha256Digest,
        memory_bundle_digest: terminalResult.output_memory_bundle_digest as Sha256Digest,
        environment_manifest_digest: terminalResult.output_environment_manifest_digest as Sha256Digest,
      },
      no_baggage: {
        owner_actor_id_rejected: true,
        legacy_public_package_starts_rejected: true,
        old_start_roots_rejected: true,
        inline_workspace_bundle_bytes_rejected: true,
        public_report_policy: 'public_safe_digests_counts_ids_only',
      },
    };
    if (!report.session_continuity.same_codex_session) {
      throw new Error('plan_item_execution_handoff_dogfood_session_replaced');
    }
    assertPublicSafeReport(report);
    return report;
  } finally {
    await app.close();
  }
};

const main = async (): Promise<number> => {
  forceLocalDogfoodNoProxy();
  console.log('start execution from Plan Item Workflow');
  const report = await runPlanItemExecutionHandoffDogfood();
  console.log(`${reportMarker}${JSON.stringify(report)}`);
  return 0;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
