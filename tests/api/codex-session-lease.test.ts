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
const wrongTokenHash = 'sha256:5645a758e6a8f12b6a2715cc22565a9f68d1ed73d98d33a1c5adf99277cd0b73';

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
        expected_previous_snapshot_digest: null,
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
        expected_previous_snapshot_digest: null,
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
        expected_previous_snapshot_digest: null,
        expires_at: '2026-05-31T00:05:00.000Z',
      },
      'human_admin',
    ).expect(403);
  });

  it('marks stale terminalization without updating latest snapshot', async () => {
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
      expected_previous_snapshot_digest: undefined,
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
      expected_previous_snapshot_digest: undefined,
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
      expected_previous_snapshot_digest: null,
      codex_thread_id_digest: 'sha256:thread-output',
    }).expect(409);

    await expect(repository.getCodexSession(sessionId)).resolves.toMatchObject({
      status: 'running',
      role: 'active',
    });
    const session = await repository.getCodexSession(sessionId);
    expect(session?.latest_snapshot_digest).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({ status: 'stale' });
    const turn = await repository.getCodexSessionTurn(turnId);
    expect(turn?.output_snapshot_id).toBeUndefined();
    expect(turn?.output_snapshot_digest).toBeUndefined();
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
      expected_previous_snapshot_digest: undefined,
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
      expected_previous_snapshot_digest: undefined,
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
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:01:00.000Z',
    });
    await repository.createCodexSessionTurn({
      id: secondTurnId,
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:second-turn-input-stale-epoch',
      expected_previous_snapshot_digest: undefined,
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
      expected_previous_snapshot_digest: undefined,
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
      expected_previous_snapshot_digest: null,
      output_snapshot_id: '11111111-1111-4111-8111-111111119102',
      output_snapshot_sequence: 1,
      output_snapshot_artifact_ref: 's3://codex-home/stale-epoch.tar.zst',
      output_snapshot_digest: 'sha256:stale-epoch-output',
      output_snapshot_size_bytes: '1024',
      output_snapshot_manifest_digest: 'sha256:stale-epoch-manifest',
      runtime_profile_revision_id: 'runtime-profile-revision-1',
      codex_thread_id: 'thread-stale-epoch',
      codex_thread_id_digest: 'sha256:thread-stale-epoch',
    });
    expect(staleTerminalizationResponse.body).toMatchObject({});
    expect(staleTerminalizationResponse.status).toBe(409);

    const session = await repository.getCodexSession(sessionId);
    expect(session).toMatchObject({ status: 'running', active_lease_id: secondClaim.lease.id, lease_epoch: secondClaim.lease.lease_epoch });
    expect(session?.latest_snapshot_digest).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn(secondTurnId)).resolves.toMatchObject({ status: 'stale' });
    const turn = await repository.getCodexSessionTurn(secondTurnId);
    expect(turn?.output_snapshot_id).toBeUndefined();
    expect(turn?.output_snapshot_digest).toBeUndefined();
    expect(turn?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.listPlanItemWorkflowTransitions(workflow.id)).resolves.toHaveLength(1);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(sessionId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codex_session_id: sessionId,
          codex_session_turn_id: secondTurnId,
          lease_id: secondClaim.lease.id,
          lease_epoch: firstClaim.lease.lease_epoch,
          attempted_output_snapshot_digest: 'sha256:stale-epoch-output',
          attempted_codex_thread_id_digest: 'sha256:thread-stale-epoch',
          failure_code: 'codex_session_stale_terminalization',
        }),
      ]),
    );
  });
});
