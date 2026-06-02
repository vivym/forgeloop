import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { signAutomationRequest } from '../../packages/automation/src/index';
import type { DeliveryRepository } from '../../packages/db/src';
import { ids, seedWorkflow } from '../helpers/plan-item-workflow-fixtures';

const trustedSecret = 'test-secret';
const trustedActorId = 'automation-daemon';
const daemonIdentity = 'codex-session-lease-worker';
const wrongTokenHash = 'sha256:1fbdf98262d91a0eaaf09bd7c942c8c60aafec9895d13062d2bc76c9a4c4ef1f';

const outputCapsuleBody = (input: {
  id: string;
  sequence: number;
  artifact_ref: string;
  digest: string;
  manifest_digest: string;
  thread_state_digest?: string;
  memory_state_digest?: string;
  environment_manifest_digest?: string;
  codex_thread_id_digest?: string;
  codex_cli_version?: string;
  app_server_protocol_digest?: string;
  runtime_profile_revision_id?: string;
  trusted_runtime_manifest_digest?: string;
  credential_binding_lineage_digest?: string;
  output_memory_bundle_ref?: string;
  output_memory_bundle_digest?: string;
  memory_delta_artifact_ref?: string;
  memory_delta_digest?: string;
  output_environment_manifest_ref?: string;
  output_environment_manifest_digest?: string;
}) => ({
  output_capsule_id: input.id,
  output_capsule_sequence: input.sequence,
  output_capsule_artifact_ref: input.artifact_ref,
  output_capsule_digest: input.digest,
  output_capsule_size_bytes: '1024',
  output_capsule_manifest_digest: input.manifest_digest,
  output_capsule_thread_state_digest: input.thread_state_digest ?? 'sha256:output-thread-state',
  output_capsule_memory_state_digest: input.memory_state_digest ?? 'sha256:output-memory-state',
  output_capsule_environment_manifest_digest: input.environment_manifest_digest ?? 'sha256:output-environment-manifest',
  output_capsule_codex_thread_id_digest: input.codex_thread_id_digest ?? 'sha256:output-codex-thread-id',
  output_capsule_codex_cli_version: input.codex_cli_version ?? '0.1.0-test',
  output_capsule_app_server_protocol_digest: input.app_server_protocol_digest ?? 'sha256:output-app-server-protocol',
  runtime_profile_revision_id: input.runtime_profile_revision_id ?? 'runtime-profile-revision-1',
  output_capsule_trusted_runtime_manifest_digest:
    input.trusted_runtime_manifest_digest ?? 'sha256:output-trusted-runtime-manifest',
  output_capsule_credential_binding_lineage_digest:
    input.credential_binding_lineage_digest ?? 'sha256:output-credential-binding-lineage',
  output_memory_bundle_ref:
    input.output_memory_bundle_ref ??
    input.artifact_ref.replace('/codex_runtime_capsule/', '/codex_memory_bundle/').replace(/\/[^/]+$/, `/memory-${input.sequence}`),
  output_memory_bundle_digest: input.output_memory_bundle_digest ?? 'sha256:output-memory-bundle',
  ...(input.memory_delta_artifact_ref === undefined ? {} : { memory_delta_artifact_ref: input.memory_delta_artifact_ref }),
  ...(input.memory_delta_digest === undefined ? {} : { memory_delta_digest: input.memory_delta_digest }),
  output_environment_manifest_ref:
    input.output_environment_manifest_ref ??
    input.artifact_ref.replace('/codex_runtime_capsule/', '/codex_environment_manifest/').replace(/\/[^/]+$/, `/environment-${input.sequence}`),
  output_environment_manifest_digest: input.output_environment_manifest_digest ?? 'sha256:output-environment-bundle',
});

const signedAutomationPost = (
  app: INestApplication,
  pathAndQuery: string,
  body: Record<string, unknown>,
  actorClass: 'automation_daemon' | 'human_admin' = 'automation_daemon',
) => {
  const rawBody = JSON.stringify(body);
  const headers = signAutomationRequest({
    method: 'POST',
    pathAndQuery,
    rawBody,
    actorId: trustedActorId,
    actorClass,
    daemonIdentity,
    timestamp: new Date().toISOString(),
    secret: trustedSecret,
  });
  return request(app.getHttpServer()).post(pathAndQuery).set(headers).set('Content-Type', 'application/json').send(rawBody);
};

describe('Codex Session lease API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.stubEnv('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET', trustedSecret);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('claims and renews only the workflow active session', async () => {
    const { workflow } = await seedWorkflow(app);

    const claim = (
      await signedAutomationPost(app, `/internal/codex-sessions/${workflow.active_codex_session_id}/leases/claim`, {
        workflow_id: workflow.id,
        lease_token: 'lease-token-1',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        expected_input_capsule_digest: null,
        expires_at: '2026-05-31T00:05:00.000Z',
      }).expect(201)
    ).body;

    expect(claim).toMatchObject({
      session_id: workflow.active_codex_session_id,
      lease_epoch: 1,
      status: 'active',
    });
    expect(claim.lease_token_hash).toBeUndefined();
    expect(claim.worker_id).toBeUndefined();

    await signedAutomationPost(app, `/internal/codex-sessions/${workflow.active_codex_session_id}/leases/${claim.id}/renew`, {
      lease_token: 'lease-token-1',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      expires_at: '2026-05-31T00:10:00.000Z',
    }).expect(201);
  });

  it('requires trusted automation actor auth for internal lease routes', async () => {
    const { workflow } = await seedWorkflow(app);

    await request(app.getHttpServer())
      .post(`/internal/codex-sessions/${workflow.active_codex_session_id}/leases/claim`)
      .send({
        workflow_id: workflow.id,
        lease_token: 'lease-token-1',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        expected_input_capsule_digest: null,
        expires_at: '2026-05-31T00:05:00.000Z',
      })
      .expect(401);

    await signedAutomationPost(
      app,
      `/internal/codex-sessions/${workflow.active_codex_session_id}/leases/claim`,
      {
        workflow_id: workflow.id,
        lease_token: 'lease-token-1',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        expected_input_capsule_digest: null,
        expires_at: '2026-05-31T00:05:00.000Z',
      },
      'human_admin',
    ).expect(403);
  });

  it('marks stale terminalization without updating latest capsule', async () => {
    const { workflow } = await seedWorkflow(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    const turnId = '11111111-1111-4111-8111-111111119001';
    await repository.createCodexSessionTurn({
      id: turnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:turn-input',
      expected_input_capsule_digest: undefined,
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    const claimed = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflow.id,
      lease_id: 'lease-current',
      lease_token_hash: wrongTokenHash,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      expected_input_capsule_digest: undefined,
      now: '2026-05-31T00:00:00.000Z',
      expires_at: '2026-05-31T00:05:00.000Z',
    });

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${turnId}/terminalize`, {
      lease_id: claimed.lease.id,
      lease_token: 'wrong-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_input_capsule_digest: null,
      codex_thread_id: 'thread-output',
      codex_thread_id_digest: 'sha256:thread-output',
    }).expect(409);

    await expect(repository.getCodexSession(sessionId)).resolves.toMatchObject({
      status: 'running',
      role: 'active',
    });
    const session = await repository.getCodexSession(sessionId);
    expect(session?.latest_capsule_digest).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({ status: 'stale' });
    const turn = await repository.getCodexSessionTurn(turnId);
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    expect(turn?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.listPlanItemWorkflowTransitions(workflow.id)).resolves.toHaveLength(1);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(sessionId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codex_session_id: sessionId,
          codex_session_turn_id: turnId,
          lease_id: claimed.lease.id,
          failure_code: 'codex_session_stale_terminalization',
        }),
      ]),
    );
  });

  it('rejects partial thread binding and non-public failure codes before terminalization', async () => {
    const { workflow } = await seedWorkflow(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    const turnId = '11111111-1111-4111-8111-111111119006';
    await repository.createCodexSessionTurn({
      id: turnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:turn-input-dto-validation',
      expected_input_capsule_digest: undefined,
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${turnId}/terminalize`, {
      lease_id: 'lease-dto-validation',
      lease_token: 'lease-token-dto-validation',
      lease_epoch: 1,
      worker_id: 'worker-dto-validation',
      worker_session_digest: 'sha256:worker-dto-validation-session',
      status: 'failed',
      expected_input_capsule_digest: null,
      codex_thread_id: 'thread-dto-validation',
    }).expect(400);

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${turnId}/terminalize`, {
      lease_id: 'lease-dto-validation',
      lease_token: 'lease-token-dto-validation',
      lease_epoch: 1,
      worker_id: 'worker-dto-validation',
      worker_session_digest: 'sha256:worker-dto-validation-session',
      status: 'failed',
      expected_input_capsule_digest: null,
      failure_code: 'internal_not_public',
    }).expect(400);

    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({ status: 'running' });
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(sessionId)).resolves.toEqual([]);
  });

  it('rejects non-succeeded terminalization with output capsule fields before mutation', async () => {
    const { workflow } = await seedWorkflow(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    const turnId = '11111111-1111-4111-8111-111111119107';
    await repository.createCodexSessionTurn({
      id: turnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:turn-input-failed-output-capsule',
      expected_input_capsule_digest: undefined,
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${turnId}/terminalize`, {
      lease_id: 'lease-failed-output-capsule',
      lease_token: 'lease-token-failed-output-capsule',
      lease_epoch: 1,
      worker_id: 'worker-failed-output-capsule',
      worker_session_digest: 'sha256:worker-failed-output-capsule-session',
      status: 'failed',
      expected_input_capsule_digest: null,
      failure_code: 'codex_runtime_capsule_missing',
      ...outputCapsuleBody({
        id: '11111111-1111-4111-8111-111111119108',
        sequence: 1,
        artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/failed-output-capsule`,
        digest: 'sha256:failed-output-capsule',
        manifest_digest: 'sha256:failed-output-capsule-manifest',
      }),
    }).expect(400);

    const session = await repository.getCodexSession(sessionId);
    expect(session).toMatchObject({ status: 'idle' });
    expect(session?.latest_capsule_id).toBeUndefined();
    expect(session?.latest_capsule_digest).toBeUndefined();
    expect(session?.latest_memory_bundle_ref).toBeUndefined();
    expect(session?.latest_memory_bundle_digest).toBeUndefined();
    expect(session?.latest_environment_manifest_ref).toBeUndefined();
    expect(session?.latest_environment_manifest_digest).toBeUndefined();
    const turn = await repository.getCodexSessionTurn(turnId);
    expect(turn).toMatchObject({ status: 'running' });
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    expect(turn?.output_memory_bundle_ref).toBeUndefined();
    expect(turn?.output_memory_bundle_digest).toBeUndefined();
    expect(turn?.output_environment_manifest_ref).toBeUndefined();
    expect(turn?.output_environment_manifest_digest).toBeUndefined();
    await expect(repository.getCodexRuntimeCapsule('11111111-1111-4111-8111-111111119108')).resolves.toBeUndefined();
  });

  it('persists the full output capsule contract from terminalization input', async () => {
    const { workflow } = await seedWorkflow(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    const turnId = '11111111-1111-4111-8111-111111119007';
    await repository.createCodexSessionTurn({
      id: turnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:turn-input-full-capsule',
      expected_input_capsule_digest: undefined,
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });
    const claimed = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflow.id,
      lease_id: 'lease-full-capsule',
      lease_token_hash: 'sha256:e3e00b73fba1eee878bc3b0e6a6e2c20e0bd38898e7d2c6d8c8e96014df7d7c1',
      worker_id: 'worker-full-capsule',
      worker_session_digest: 'sha256:worker-full-capsule-session',
      expected_input_capsule_digest: undefined,
      now: '2026-05-31T00:00:00.000Z',
      expires_at: '2026-05-31T00:05:00.000Z',
    });

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${turnId}/terminalize`, {
      lease_id: claimed.lease.id,
      lease_token: 'lease-token-full-capsule',
      lease_epoch: claimed.lease.lease_epoch,
      worker_id: 'worker-full-capsule',
      worker_session_digest: 'sha256:worker-full-capsule-session',
      status: 'succeeded',
      expected_input_capsule_digest: null,
      ...outputCapsuleBody({
        id: '11111111-1111-4111-8111-111111119107',
        sequence: 1,
        artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/11111111-1111-4111-8111-111111119107`,
        digest: 'sha256:full-capsule-output',
        manifest_digest: 'sha256:full-capsule-manifest',
        thread_state_digest: 'sha256:full-capsule-thread-state',
        memory_state_digest: 'sha256:full-capsule-memory-state',
        environment_manifest_digest: 'sha256:full-capsule-environment-manifest',
        codex_thread_id_digest: 'sha256:thread-full-capsule',
        codex_cli_version: '0.2.0-real',
        app_server_protocol_digest: 'sha256:full-capsule-app-server-protocol',
        runtime_profile_revision_id: ids.runtimeProfileRevision,
        trusted_runtime_manifest_digest: 'sha256:full-capsule-trusted-runtime-manifest',
        credential_binding_lineage_digest: 'sha256:full-capsule-credential-binding-lineage',
      }),
      codex_thread_id: 'thread-full-capsule',
      codex_thread_id_digest: 'sha256:thread-full-capsule',
    }).expect(201);

    await expect(repository.getCodexRuntimeCapsule('11111111-1111-4111-8111-111111119107')).resolves.toMatchObject({
      id: '11111111-1111-4111-8111-111111119107',
      codex_session_id: sessionId,
      created_from_turn_id: turnId,
      digest: 'sha256:full-capsule-output',
      thread_state_digest: 'sha256:full-capsule-thread-state',
      memory_state_digest: 'sha256:full-capsule-memory-state',
      environment_manifest_digest: 'sha256:full-capsule-environment-manifest',
      codex_thread_id_digest: 'sha256:thread-full-capsule',
      codex_cli_version: '0.2.0-real',
      app_server_protocol_digest: 'sha256:full-capsule-app-server-protocol',
      runtime_profile_revision_id: ids.runtimeProfileRevision,
      trusted_runtime_manifest_digest: 'sha256:full-capsule-trusted-runtime-manifest',
      credential_binding_lineage_digest: 'sha256:full-capsule-credential-binding-lineage',
      created_by_actor_id: trustedActorId,
    });
  });

  it('creates runtime capsules through the trusted capsule route and keeps snapshots absent', async () => {
    const { workflow } = await seedWorkflow(app, { idPrefix: '55555555' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    const turnId = '55555555-1111-4111-8111-111111119001';
    const capsuleId = '55555555-1111-4111-8111-111111119101';
    await repository.createCodexSessionTurn({
      id: turnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:trusted-route-turn-input',
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/runtime-capsules`, {
      capsule_id: capsuleId,
      sequence: 1,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/${capsuleId}`,
      digest: 'sha256:trusted-route-capsule',
      size_bytes: '123',
      manifest_digest: 'sha256:trusted-route-manifest',
      thread_state_digest: 'sha256:trusted-route-thread-state',
      memory_state_digest: 'sha256:trusted-route-memory-state',
      environment_manifest_digest: 'sha256:trusted-route-environment-manifest',
      codex_thread_id_digest: 'sha256:trusted-route-thread-id',
      codex_cli_version: '0.133.0',
      app_server_protocol_digest: 'sha256:trusted-route-app-server-protocol',
      runtime_profile_revision_id: ids.runtimeProfileRevision,
      trusted_runtime_manifest_digest: 'sha256:trusted-route-runtime-manifest',
      credential_binding_lineage_digest: 'sha256:trusted-route-credential-lineage',
      created_from_turn_id: turnId,
      actor_id: ids.actorTech,
    }).expect(201);

    await expect(repository.getCodexRuntimeCapsule(capsuleId)).resolves.toMatchObject({
      id: capsuleId,
      codex_session_id: sessionId,
      sequence: 1,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/${capsuleId}`,
      digest: 'sha256:trusted-route-capsule',
      created_from_turn_id: turnId,
      created_by_actor_id: ids.actorTech,
    });

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/snapshots`, {}).expect(404);
  });

  it('rejects legacy output snapshot terminalization fields', async () => {
    const { workflow } = await seedWorkflow(app, { idPrefix: '44444444' });
    const sessionId = workflow.active_codex_session_id;
    const turnId = '44444444-1111-4111-8111-111111119001';
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await repository.createCodexSessionTurn({
      id: turnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:legacy-output-snapshot',
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${turnId}/terminalize`, {
      lease_id: 'lease-legacy-output-snapshot',
      lease_token: 'lease-token-legacy-output-snapshot',
      lease_epoch: 1,
      worker_id: 'worker-legacy-output-snapshot',
      worker_session_digest: 'sha256:worker-legacy-output-snapshot',
      status: 'succeeded',
      expected_input_capsule_digest: null,
      output_snapshot_id: 'snapshot-1',
      output_snapshot_digest: 'sha256:legacy-output-snapshot-digest',
    }).expect(400);
  });

  it('records stale terminalization with the attempted stale lease epoch', async () => {
    const { workflow } = await seedWorkflow(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    const firstTurnId = '11111111-1111-4111-8111-111111119002';
    const secondTurnId = '11111111-1111-4111-8111-111111119003';
    await repository.createCodexSessionTurn({
      id: firstTurnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:first-turn-input-stale-epoch',
      expected_input_capsule_digest: undefined,
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    const firstClaim = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflow.id,
      lease_id: 'lease-stale-epoch-1',
      lease_token_hash: 'sha256:first-lease-token-stale-epoch',
      worker_id: 'worker-stale-epoch',
      worker_session_digest: 'sha256:worker-stale-epoch-session',
      expected_input_capsule_digest: undefined,
      now: '2026-05-31T00:00:00.000Z',
      expires_at: '2026-05-31T00:05:00.000Z',
    });
    await repository.terminalizeCodexSessionTurn({
      session_id: sessionId,
      turn_id: firstTurnId,
      lease_id: firstClaim.lease.id,
      lease_token_hash: firstClaim.lease.lease_token_hash,
      lease_epoch: firstClaim.lease.lease_epoch,
      worker_id: firstClaim.lease.worker_id,
      worker_session_digest: firstClaim.lease.worker_session_digest,
      status: 'succeeded',
      expected_input_capsule_digest: undefined,
      output_capsule: {
        id: '11111111-1111-4111-8111-111111119101',
        codex_session_id: sessionId,
        created_from_turn_id: firstTurnId,
        sequence: 1,
        artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/11111111-1111-4111-8111-111111119101`,
        digest: 'sha256:first-turn-output-stale-epoch',
        size_bytes: '1024',
        manifest_digest: 'sha256:first-turn-manifest-stale-epoch',
        thread_state_digest: 'sha256:first-turn-thread-state-stale-epoch',
        memory_state_digest: 'sha256:first-turn-memory-state-stale-epoch',
        environment_manifest_digest: 'sha256:first-turn-environment-manifest-stale-epoch',
        codex_thread_id_digest: 'sha256:first-turn-codex-thread-stale-epoch',
        codex_cli_version: '0.1.0-test',
        app_server_protocol_digest: 'sha256:first-turn-app-server-protocol-stale-epoch',
        runtime_profile_revision_id: ids.runtimeProfileRevision,
        trusted_runtime_manifest_digest: 'sha256:first-turn-trusted-runtime-manifest-stale-epoch',
        credential_binding_lineage_digest: 'sha256:first-turn-credential-binding-lineage-stale-epoch',
        created_by_actor_id: ids.actorTech,
        created_at: '2026-05-31T00:01:00.000Z',
      },
      output_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${sessionId}/memory-${firstTurnId}`,
      output_memory_bundle_digest: 'sha256:first-turn-memory-bundle-stale-epoch',
      output_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${sessionId}/environment-${firstTurnId}`,
      output_environment_manifest_digest: 'sha256:first-turn-environment-bundle-stale-epoch',
      now: '2026-05-31T00:01:00.000Z',
    });
    await repository.createCodexSessionTurn({
      id: secondTurnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:second-turn-input-stale-epoch',
      expected_input_capsule_digest: 'sha256:first-turn-output-stale-epoch',
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:02:00.000Z',
      updated_at: '2026-05-31T00:02:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflow.id,
      lease_id: 'lease-stale-epoch-2',
      lease_token_hash: 'sha256:42e9508ed339e0214a72717f29da8b99b6bcbb179641bb8ab6e1e5d69b6ad9a1',
      worker_id: 'worker-stale-epoch',
      worker_session_digest: 'sha256:worker-stale-epoch-session',
      expected_input_capsule_digest: 'sha256:first-turn-output-stale-epoch',
      now: '2026-05-31T00:03:00.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    });

    const staleTerminalizationResponse = await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${secondTurnId}/terminalize`, {
      lease_id: secondClaim.lease.id,
      lease_token: 'lease-token-stale-epoch',
      lease_epoch: firstClaim.lease.lease_epoch,
      worker_id: 'worker-stale-epoch',
      worker_session_digest: 'sha256:worker-stale-epoch-session',
      status: 'succeeded',
      expected_input_capsule_digest: 'sha256:first-turn-output-stale-epoch',
      ...outputCapsuleBody({
        id: '11111111-1111-4111-8111-111111119102',
        sequence: 2,
        artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/11111111-1111-4111-8111-111111119102`,
        digest: 'sha256:stale-epoch-output',
        manifest_digest: 'sha256:stale-epoch-manifest',
        codex_thread_id_digest: 'sha256:thread-stale-epoch',
        runtime_profile_revision_id: ids.runtimeProfileRevision,
      }),
      codex_thread_id: 'thread-stale-epoch',
      codex_thread_id_digest: 'sha256:thread-stale-epoch',
    });
    expect(staleTerminalizationResponse.body).toMatchObject({});
    expect(staleTerminalizationResponse.status).toBe(409);

    const session = await repository.getCodexSession(sessionId);
    expect(session).toMatchObject({ status: 'running', active_lease_id: secondClaim.lease.id, lease_epoch: secondClaim.lease.lease_epoch });
    expect(session?.latest_capsule_digest).toBe('sha256:first-turn-output-stale-epoch');
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn(secondTurnId)).resolves.toMatchObject({ status: 'stale' });
    const turn = await repository.getCodexSessionTurn(secondTurnId);
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    expect(turn?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.listPlanItemWorkflowTransitions(workflow.id)).resolves.toHaveLength(1);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(sessionId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codex_session_id: sessionId,
          codex_session_turn_id: secondTurnId,
          lease_id: secondClaim.lease.id,
          lease_epoch: firstClaim.lease.lease_epoch,
          attempted_output_capsule_digest: 'sha256:stale-epoch-output',
          attempted_codex_thread_id_digest: 'sha256:thread-stale-epoch',
          failure_code: 'codex_session_stale_terminalization',
        }),
      ]),
    );
  });

  it('records stale thread-binding overwrite attempts without mutating the active session binding', async () => {
    const { workflow } = await seedWorkflow(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    const firstTurnId = '11111111-1111-4111-8111-111111119004';
    const secondTurnId = '11111111-1111-4111-8111-111111119005';
    await repository.createCodexSessionTurn({
      id: firstTurnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:first-turn-input-thread-binding',
      expected_input_capsule_digest: undefined,
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    const firstClaim = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflow.id,
      lease_id: 'lease-thread-binding-1',
      lease_token_hash: 'sha256:38cfadc7174933eff930e5aa83e3dadb1eed51b79cff52dab29546a7b28cc8fa',
      worker_id: 'worker-thread-binding',
      worker_session_digest: 'sha256:worker-thread-binding-session',
      expected_input_capsule_digest: undefined,
      now: '2026-05-31T00:00:00.000Z',
      expires_at: '2026-05-31T00:05:00.000Z',
    });
    await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${firstTurnId}/terminalize`, {
      lease_id: firstClaim.lease.id,
      lease_token: 'lease-token-thread-binding-1',
      lease_epoch: firstClaim.lease.lease_epoch,
      worker_id: 'worker-thread-binding',
      worker_session_digest: 'sha256:worker-thread-binding-session',
      status: 'succeeded',
      expected_input_capsule_digest: null,
      ...outputCapsuleBody({
        id: '11111111-1111-4111-8111-111111119104',
        sequence: 1,
        artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/11111111-1111-4111-8111-111111119104`,
        digest: 'sha256:first-turn-output-thread-binding',
        manifest_digest: 'sha256:first-turn-manifest-thread-binding',
        codex_thread_id_digest: 'sha256:thread-current',
        runtime_profile_revision_id: ids.runtimeProfileRevision,
      }),
      codex_thread_id: 'thread-current',
      codex_thread_id_digest: 'sha256:thread-current',
    }).expect(201);

    await repository.createCodexSessionTurn({
      id: secondTurnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:second-turn-input-thread-binding',
      expected_input_capsule_digest: 'sha256:first-turn-output-thread-binding',
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:02:00.000Z',
      updated_at: '2026-05-31T00:02:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflow.id,
      lease_id: 'lease-thread-binding-2',
      lease_token_hash: 'sha256:f2363bdb4f60bd34d6144ea86ec1f5cfae6c274f2a65a6bc2a8a75dad869a18a',
      worker_id: 'worker-thread-binding',
      worker_session_digest: 'sha256:worker-thread-binding-session',
      expected_input_capsule_digest: 'sha256:first-turn-output-thread-binding',
      now: '2026-05-31T00:03:00.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    });

    const staleTerminalizationResponse = await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/turns/${secondTurnId}/terminalize`, {
      lease_id: secondClaim.lease.id,
      lease_token: 'lease-token-thread-binding-2',
      lease_epoch: secondClaim.lease.lease_epoch,
      worker_id: 'worker-thread-binding',
      worker_session_digest: 'sha256:worker-thread-binding-session',
      status: 'succeeded',
      expected_input_capsule_digest: 'sha256:first-turn-output-thread-binding',
      ...outputCapsuleBody({
        id: '11111111-1111-4111-8111-111111119105',
        sequence: 2,
        artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/11111111-1111-4111-8111-111111119105`,
        digest: 'sha256:second-turn-output-thread-binding',
        manifest_digest: 'sha256:second-turn-manifest-thread-binding',
        codex_thread_id_digest: 'sha256:thread-overwrite',
        runtime_profile_revision_id: ids.runtimeProfileRevision,
      }),
      codex_thread_id: 'thread-overwrite',
      codex_thread_id_digest: 'sha256:thread-overwrite',
    });
    expect(staleTerminalizationResponse.body).toMatchObject({});
    expect(staleTerminalizationResponse.status).toBe(409);

    await expect(repository.getCodexSession(sessionId)).resolves.toMatchObject({
      status: 'running',
      active_lease_id: secondClaim.lease.id,
      lease_epoch: secondClaim.lease.lease_epoch,
      codex_thread_id: 'thread-current',
      codex_thread_id_digest: 'sha256:thread-current',
    });
    await expect(repository.getCodexSessionTurn(firstTurnId)).resolves.toMatchObject({
      status: 'succeeded',
      codex_thread_id_digest: 'sha256:thread-current',
    });
    await expect(repository.getCodexSessionTurn(secondTurnId)).resolves.toMatchObject({ status: 'stale' });
    const staleTurn = await repository.getCodexSessionTurn(secondTurnId);
    expect(staleTurn?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(sessionId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codex_session_id: sessionId,
          codex_session_turn_id: secondTurnId,
          lease_id: secondClaim.lease.id,
          lease_epoch: secondClaim.lease.lease_epoch,
          attempted_codex_thread_id_digest: 'sha256:thread-overwrite',
          failure_code: 'codex_session_thread_binding_stale',
        }),
      ]),
    );
  });
});
