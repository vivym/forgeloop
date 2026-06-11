import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import {
  createSessionOperationsTestApp,
  seedAmbiguousWorkflowForPlanItem,
  seedBlockedLineageConflictCandidate,
  seedBlockedMissingCapsuleCandidate,
  seedBlockedOrphanQueuedActionCandidate,
  seedBlockedOrphanRuntimeRunSessionCandidate,
  seedBlockedStaleLeaseCandidate,
  seedBlockedStaleLeaseCandidateInApp,
  seedBlockedStaleLeaseStateOnly,
  seedExternalActorForSessionOperations,
  signedDeveloperHeaders,
  signedHumanHeaders,
} from '../helpers/session-operations-fixtures';
import { seedDevelopmentPlanItem, startWorkflow } from '../helpers/plan-item-workflow-fixtures';

describe('session operations API', () => {
  const apps: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns public Plan Item diagnostics without raw recovery predicate', async () => {
    const { app } = await createSessionOperationsTestApp();
    apps.push(app);
    const seeded = await seedDevelopmentPlanItem(app, { idPrefix: '88888881' });
    await startWorkflow(app, seeded.plan.id, seeded.item.id);

    const response = await request(app.getHttpServer())
      .get(`/plan-items/${seeded.item.id}/session-diagnostics`)
      .set(signedDeveloperHeaders(seeded.ids.actorTech))
      .expect(200);

    expect(response.body.workflow_resolution).toBe('active_workflow');
    expect(JSON.stringify(response.body)).not.toContain('candidate_predicate');
    expect(JSON.stringify(response.body)).not.toContain('worker_session_digest');
    expect(JSON.stringify(response.body)).not.toContain('codex_thread_id');
  });

  it('returns no-active-workflow diagnostics when a Plan Item has not started a workflow', async () => {
    const { app } = await createSessionOperationsTestApp();
    apps.push(app);
    const seeded = await seedDevelopmentPlanItem(app, { idPrefix: '88888898' });

    const response = await request(app.getHttpServer())
      .get(`/plan-items/${seeded.item.id}/session-diagnostics`)
      .set(signedDeveloperHeaders(seeded.ids.actorTech))
      .expect(200);

    expect(response.body.workflow_resolution).toBe('no_active_workflow');
    expect(response.body.normal_workflow_actions_available).toBe(false);
  });

  it('fails closed when Plan Item workflow resolution is ambiguous', async () => {
    const { app } = await createSessionOperationsTestApp();
    apps.push(app);
    const seeded = await seedDevelopmentPlanItem(app, { idPrefix: '88888882' });
    await startWorkflow(app, seeded.plan.id, seeded.item.id);
    await seedAmbiguousWorkflowForPlanItem(app, seeded);

    await request(app.getHttpServer())
      .get(`/plan-items/${seeded.item.id}/session-diagnostics`)
      .set(signedHumanHeaders(seeded.ids.actorTech))
      .expect(409);
  });

  it('lists operator health projections with candidate predicate only for human admin operators', async () => {
    const seeded = await seedBlockedStaleLeaseStateOnly('88888896');
    apps.push(seeded.app);

    expect(await seeded.repository.listPlanItemSessionHealth({ codex_session_id: seeded.sessionId })).toEqual([]);
    const operatorResponse = await request(seeded.app.getHttpServer())
      .get(
        `/session-operations/health?state=blocked_stale_lease&development_plan_item_id=${seeded.itemId}&worker_id=${seeded.developerActorId}&min_lease_age_seconds=120`,
      )
      .set(signedHumanHeaders(seeded.actorId))
      .expect(200);

    expect(operatorResponse.body.items.some((item: { codex_session_id?: string }) => item.codex_session_id === seeded.sessionId)).toBe(true);
    expect(operatorResponse.body.items[0].candidate_predicate).toBeDefined();
    expect(JSON.stringify(operatorResponse.body)).not.toContain('codex_thread_id');
    expect(JSON.stringify(operatorResponse.body)).not.toContain('lease_token');

    await request(seeded.app.getHttpServer())
      .get(`/session-operations/health?codex_session_id=${seeded.sessionId}`)
      .set(signedDeveloperHeaders(seeded.actorId))
      .expect(403);
  });

  it('scavenge dry-run discovers candidates from active workflow sessions without mutating rows', async () => {
    const seeded = await seedBlockedStaleLeaseStateOnly('88888895');
    apps.push(seeded.app);

    const beforeHealth = await seeded.repository.listPlanItemSessionHealth({ codex_session_id: seeded.sessionId });
    const response = await request(seeded.app.getHttpServer())
      .post('/session-operations/scavenge')
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        mode: 'dry_run',
        filters: {
          state: 'blocked_stale_lease',
          development_plan_item_id: seeded.itemId,
          min_lease_age_seconds: 120,
        },
      })
      .expect(201);

    expect(response.body.candidates.some((item: { codex_session_id?: string }) => item.codex_session_id === seeded.sessionId)).toBe(true);
    expect(response.body.candidates[0].candidate_predicate).toBeDefined();
    expect(await seeded.repository.listPlanItemSessionHealth({ codex_session_id: seeded.sessionId })).toEqual(beforeHealth);
    expect(await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId })).toEqual([]);
  });

  it('recovers a stale lease using signed header actor and replays by idempotency key', async () => {
    const seeded = await seedBlockedStaleLeaseStateOnly('88888883');
    apps.push(seeded.app);
    const repositoryInternals = seeded.repository as unknown as { codexSessions: Map<string, Record<string, unknown>> };
    const sessionBeforeRecovery = repositoryInternals.codexSessions.get(seeded.sessionId);
    if (sessionBeforeRecovery === undefined) {
      throw new Error(`Expected session ${seeded.sessionId}`);
    }
    repositoryInternals.codexSessions.set(seeded.sessionId, {
      ...sessionBeforeRecovery,
      runner_worker_id: seeded.developerActorId,
      runner_launch_lease_id: '88888883-1111-4111-8111-111111112101',
      runner_runtime_job_id: '88888883-1111-4111-8111-111111112102',
      runner_expires_at: '2026-06-09T00:01:00.000Z',
    });
    const health = await request(seeded.app.getHttpServer())
      .get(`/session-operations/health?codex_session_id=${seeded.sessionId}`)
      .set(signedHumanHeaders(seeded.actorId))
      .expect(200);
    const predicate = health.body.items[0].candidate_predicate;
    const body = {
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Release stale worker lease after heartbeat expiry.',
      candidate_predicate: predicate,
      actor_id: 'malicious-body-actor',
    };

    const response = await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send(body)
      .expect(201);

    expect(response.body.record.result).toBe('applied');
    expect(response.body.record.actor_id).toBe(seeded.actorId);
    expect(response.body.after.state).toBe('recovered');
    const recoveredSession = await seeded.repository.getCodexSession(seeded.sessionId);
    expect(recoveredSession?.runner_worker_id).toBeUndefined();
    expect(recoveredSession?.runner_launch_lease_id).toBeUndefined();
    expect(recoveredSession?.runner_runtime_job_id).toBeUndefined();
    expect(recoveredSession?.runner_expires_at).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('candidate_predicate');
    expect(JSON.stringify(response.body)).not.toContain('worker_session_digest');
    expect(JSON.stringify(response.body)).not.toContain('lease_token');

    const replay = await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send(body)
      .expect(201);

    expect(replay.body.replayed).toBe(true);
    expect(replay.body.record.id).toBe(response.body.record.id);
  });

  it('rejects stale lease recovery when runner owner changes after candidate capture', async () => {
    const seeded = await seedBlockedStaleLeaseStateOnly('88888915');
    apps.push(seeded.app);
    const repositoryInternals = seeded.repository as unknown as { codexSessions: Map<string, Record<string, unknown>> };
    const sessionBeforeCandidate = repositoryInternals.codexSessions.get(seeded.sessionId);
    if (sessionBeforeCandidate === undefined) {
      throw new Error(`Expected session ${seeded.sessionId}`);
    }
    repositoryInternals.codexSessions.set(seeded.sessionId, {
      ...sessionBeforeCandidate,
      runner_worker_id: seeded.developerActorId,
      runner_launch_lease_id: '88888915-1111-4111-8111-111111112101',
      runner_runtime_job_id: '88888915-1111-4111-8111-111111112102',
      runner_expires_at: '2026-06-09T00:01:00.000Z',
    });
    const health = await request(seeded.app.getHttpServer())
      .get(`/session-operations/health?codex_session_id=${seeded.sessionId}`)
      .set(signedHumanHeaders(seeded.actorId))
      .expect(200);
    const predicate = health.body.items[0].candidate_predicate;
    repositoryInternals.codexSessions.set(seeded.sessionId, {
      ...sessionBeforeCandidate,
      runner_worker_id: seeded.developerActorId,
      runner_launch_lease_id: '88888915-1111-4111-8111-111111112201',
      runner_runtime_job_id: '88888915-1111-4111-8111-111111112202',
      runner_expires_at: '2026-06-09T00:30:00.000Z',
    });

    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Old stale runner owner candidate must not clear a new runner owner.',
        candidate_predicate: predicate,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('session_operations_stale_candidate');
      });
    const currentSession = await seeded.repository.getCodexSession(seeded.sessionId);
    expect(currentSession?.runner_launch_lease_id).toBe('88888915-1111-4111-8111-111111112201');
    expect(currentSession?.runner_runtime_job_id).toBe('88888915-1111-4111-8111-111111112202');
    const records = await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: 'skipped', result_code: 'stale_candidate' });
  });

  it('rejects same idempotency key with different reason before stale predicate checking', async () => {
    const seeded = await seedBlockedStaleLeaseCandidate('88888902');
    apps.push(seeded.app);

    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Release stale worker lease after heartbeat expiry.',
        candidate_predicate: seeded.predicate,
      })
      .expect(201);

    const response = await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Changed reason should be an idempotency conflict, not a stale candidate.',
        candidate_predicate: seeded.predicate,
      })
      .expect(409);

    expect(JSON.stringify(response.body)).toContain('session_operations_idempotency_conflict');
    const records = await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId });
    expect(records).toHaveLength(1);
    expect(records[0]?.result).toBe('applied');
  });

  it('rejects recover when request idempotency key differs from candidate predicate key and records blocked result', async () => {
    const seeded = await seedBlockedStaleLeaseCandidate('88888900');
    apps.push(seeded.app);

    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: `${seeded.predicate.operation_idempotency_key}:different`,
        operation: 'recover',
        reason: 'Mismatched key should fail closed.',
        candidate_predicate: seeded.predicate,
      })
      .expect(409);

    const records = await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId });
    expect(records.at(-1)?.result).toBe('blocked');
    expect(records.at(-1)?.result_code).toBe('idempotency_key_mismatch');
  });

  it('marks missing capsule state unrecoverable with audit and no normal workflow actions', async () => {
    const seeded = await seedBlockedMissingCapsuleCandidate('88888899');
    apps.push(seeded.app);

    const response = await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'mark_unrecoverable',
        reason: 'Required capsule is missing and cannot satisfy resume contract.',
        candidate_predicate: seeded.predicate,
      })
      .expect(201);

    expect(response.body.record.result).toBe('applied');
    expect(response.body.after.state).toBe('unrecoverable');
    expect(response.body.after.normal_workflow_actions_available).not.toBe(true);
    const records = await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId });
    expect(records.at(-1)?.operation).toBe('mark_unrecoverable');
  });

  it('keeps recovered state durable until a separate human product action clears it', async () => {
    const seeded = await seedBlockedStaleLeaseCandidate('88888901');
    apps.push(seeded.app);

    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Release stale worker lease after heartbeat expiry.',
        candidate_predicate: seeded.predicate,
      })
      .expect(201);

    const health = await request(seeded.app.getHttpServer())
      .get('/session-operations/health?state=recovered')
      .set(signedHumanHeaders(seeded.actorId))
      .expect(200);
    expect(health.body.items.some((item: { codex_session_id?: string; state?: string }) => item.codex_session_id === seeded.sessionId && item.state === 'recovered')).toBe(true);

    const diagnostics = await request(seeded.app.getHttpServer())
      .get(`/plan-items/${seeded.itemId}/session-diagnostics`)
      .set(signedDeveloperHeaders(seeded.actorId))
      .expect(200);
    expect(diagnostics.body.state).toBe('recovered');
    expect(diagnostics.body.normal_workflow_actions_available).toBe(false);
  });

  it('lists safe recovery audit records for an operator-scoped session', async () => {
    const seeded = await seedBlockedStaleLeaseCandidate('88888897');
    apps.push(seeded.app);
    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Release stale worker lease after heartbeat expiry.',
        candidate_predicate: seeded.predicate,
      })
      .expect(201);

    const response = await request(seeded.app.getHttpServer())
      .get(`/session-operations/${seeded.sessionId}/audit`)
      .set(signedHumanHeaders(seeded.actorId))
      .expect(200);

    expect(response.body.items[0].result).toBe('applied');
    expect(response.body.items[0].predicate_summary).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('candidate_predicate');
    expect(JSON.stringify(response.body)).not.toContain('worker_session_digest');
  });

  it('rejects cross-org operator access to health audit recover and Plan Item diagnostics', async () => {
    const seeded = await seedBlockedStaleLeaseCandidate('88888906');
    apps.push(seeded.app);
    const external = await seedExternalActorForSessionOperations(seeded.app, '88888906');

    await request(seeded.app.getHttpServer())
      .get(`/session-operations/health?codex_session_id=${seeded.sessionId}`)
      .set(signedHumanHeaders(external.actorId))
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await request(seeded.app.getHttpServer())
      .get(`/session-operations/${seeded.sessionId}/audit`)
      .set(signedHumanHeaders(external.actorId))
      .expect(403);

    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(external.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Cross org operator must not recover.',
        candidate_predicate: seeded.predicate,
      })
      .expect(403);
    expect(await seeded.repository.listPlanItemSessionHealth({ codex_session_id: seeded.sessionId })).toHaveLength(1);
    expect(await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId })).toEqual([]);

    await request(seeded.app.getHttpServer())
      .get(`/plan-items/${seeded.itemId}/session-diagnostics`)
      .set(signedDeveloperHeaders(external.actorId))
      .expect(403);
  });

  it('rejects replaying an existing idempotency key through another route session', async () => {
    const first = await seedBlockedStaleLeaseCandidate('88888907');
    apps.push(first.app);
    const second = await seedBlockedStaleLeaseCandidateInApp(first.app, '88888908');

    await request(first.app.getHttpServer())
      .post(`/session-operations/${first.sessionId}/recover`)
      .set(signedHumanHeaders(first.actorId))
      .send({
        operation_idempotency_key: first.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Release stale worker lease after heartbeat expiry.',
        candidate_predicate: first.predicate,
      })
      .expect(201);

    await request(first.app.getHttpServer())
      .post(`/session-operations/${second.sessionId}/recover`)
      .set(signedHumanHeaders(second.actorId))
      .send({
        operation_idempotency_key: first.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Release stale worker lease after heartbeat expiry.',
        candidate_predicate: first.predicate,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('session_operations_idempotency_conflict');
      });
  });

  it('rejects route and candidate session mismatch before writing recovery audit', async () => {
    const first = await seedBlockedStaleLeaseCandidate('88888912');
    apps.push(first.app);
    const second = await seedBlockedStaleLeaseCandidateInApp(first.app, '88888913');

    await request(first.app.getHttpServer())
      .post(`/session-operations/${second.sessionId}/recover`)
      .set(signedHumanHeaders(second.actorId))
      .send({
        operation_idempotency_key: first.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Route and candidate target mismatch must fail closed.',
        candidate_predicate: first.predicate,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('session_operations_idempotency_conflict');
      });

    expect(await first.repository.listSessionRecoveryRecords({ codex_session_id: first.sessionId })).toEqual([]);
    expect(await first.repository.listSessionRecoveryRecords({ codex_session_id: second.sessionId })).toEqual([]);
  });

  it('rejects mutated predicate workflow identity before writing recovery audit', async () => {
    const seeded = await seedBlockedStaleLeaseCandidate('88888914');
    apps.push(seeded.app);
    const tamperedPredicate = {
      ...seeded.predicate,
      workflow_id: '88888914-2222-4222-8222-222222222222',
      workflow: seeded.predicate.workflow.state === 'present'
        ? {
            ...seeded.predicate.workflow,
            value: {
              ...seeded.predicate.workflow.value,
              id: '88888914-2222-4222-8222-222222222222',
              development_plan_item_id: '88888914-3333-4333-8333-333333333333',
            },
          }
        : seeded.predicate.workflow,
    };

    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Tampered workflow identity must not become audit identity.',
        candidate_predicate: tamperedPredicate,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('session_operations_stale_candidate');
      });

    expect(await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId })).toEqual([]);
    expect(await seeded.repository.listSessionRecoveryRecords({ workflow_id: '88888914-2222-4222-8222-222222222222' })).toEqual([]);
    expect(await seeded.repository.listSessionRecoveryRecords({ development_plan_item_id: '88888914-3333-4333-8333-333333333333' })).toEqual([]);
  });

  it('terminalizes an orphaned queued action with recovery audit', async () => {
    const seeded = await seedBlockedOrphanQueuedActionCandidate('88888886');
    apps.push(seeded.app);

    const response = await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Terminalize orphaned queued action without a valid owner.',
        candidate_predicate: seeded.predicate,
      })
      .expect(201);

    expect(response.body.record.result).toBe('applied');
    expect(response.body.record.affected_queued_action_ids).toContain(seeded.actionId);
    const action = await seeded.repository.getPlanItemWorkflowQueuedAction({
      workflow_id: seeded.workflowId,
      action_id: seeded.actionId,
    });
    expect(action?.status).toBe('stale');
    expect(action?.blocked_reason_code).toBe('session_operations_orphaned_action');
  });

  it('marks a fenced lineage conflict unrecoverable', async () => {
    const seeded = await seedBlockedLineageConflictCandidate('88888909');
    apps.push(seeded.app);
    await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'mark_unrecoverable',
        reason: 'Lineage conflict requires explicit human unrecoverable marker.',
        candidate_predicate: seeded.predicate,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.record.result).toBe('applied');
        expect(body.record.result_code).toBe('marked_unrecoverable_lineage_conflict');
        expect(body.after.state).toBe('unrecoverable');
      });
  });

  it('terminalizes orphaned runtime job and run session with recovery audit', async () => {
    const seeded = await seedBlockedOrphanRuntimeRunSessionCandidate('88888887');
    apps.push(seeded.app);

    const response = await request(seeded.app.getHttpServer())
      .post(`/session-operations/${seeded.sessionId}/recover`)
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        operation_idempotency_key: seeded.predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Terminalize orphaned runtime ownership.',
        candidate_predicate: seeded.predicate,
      })
      .expect(201);

    expect(response.body.record.result).toBe('applied');
    expect(response.body.record.affected_runtime_job_ids).toContain(seeded.runtimeJobId);
    expect(response.body.record.affected_run_session_ids).toContain(seeded.runSessionId);
    const runtimeJob = await seeded.repository.getCodexRuntimeJob({ runtime_job_id: seeded.runtimeJobId });
    const runSession = await seeded.repository.getRunSession(seeded.runSessionId);
    expect(runtimeJob?.status).toBe('terminal');
    expect(runSession?.status).toBe('failed');
  });

  it('audits scavenge idempotency conflicts per candidate without changing recovered state', async () => {
    const seeded = await seedBlockedStaleLeaseCandidate('88888910');
    apps.push(seeded.app);
    const operationKey = `scavenge-conflict:${seeded.sessionId}:${seeded.predicate.projection_digest}`;

    await request(seeded.app.getHttpServer())
      .post('/session-operations/scavenge')
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Original scavenge reason.',
        operation_idempotency_key_prefix: 'scavenge-conflict',
        candidates: [{ codex_session_id: seeded.sessionId, candidate_predicate: seeded.predicate }],
      })
      .expect(201);

    const beforeRecords = await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId });
    const response = await request(seeded.app.getHttpServer())
      .post('/session-operations/scavenge')
      .set(signedHumanHeaders(seeded.actorId))
      .send({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Different scavenge reason should conflict.',
        operation_idempotency_key_prefix: 'scavenge-conflict',
        candidates: [{ codex_session_id: seeded.sessionId, candidate_predicate: seeded.predicate }],
      })
      .expect(201);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0]).toMatchObject({
      operation_idempotency_key: expect.stringContaining(`${operationKey}:conflict:`),
      result: 'blocked',
      result_code: 'idempotency_conflict',
    });
    const afterRecords = await seeded.repository.listSessionRecoveryRecords({ codex_session_id: seeded.sessionId });
    expect(afterRecords).toHaveLength(beforeRecords.length + 1);
    const conflictRecord = afterRecords.find((record) => record.result_code === 'idempotency_conflict');
    expect(conflictRecord).toMatchObject({
      result: 'blocked',
      result_code: 'idempotency_conflict',
      before_state: 'recovered',
      after_state: 'recovered',
    });
  });

  it('scavenge execute writes per-candidate records without comparing derived key to candidate key', async () => {
    const stale = await seedBlockedStaleLeaseCandidate('88888903');
    apps.push(stale.app);
    const blocked = await seedBlockedMissingCapsuleCandidate('88888904');
    apps.push(blocked.app);
    const repository = stale.app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
    const fresh = await seedBlockedStaleLeaseCandidate('88888905');
    apps.push(fresh.app);
    const freshRepository = fresh.repository;
    await freshRepository.claimCodexSessionLease({
      session_id: fresh.sessionId,
      workflow_id: fresh.workflowId,
      lease_id: '88888905-1111-4111-8111-111111112002',
      worker_id: 'fresh-worker-id',
      worker_session_digest: `sha256:${'f'.repeat(64)}`,
      lease_token_hash: `sha256:${'e'.repeat(64)}`,
      now: '2026-06-09T00:08:00.000Z',
      expires_at: '2026-06-09T00:30:00.000Z',
    });

    expect(repository).toBeDefined();
    const applied = await request(stale.app.getHttpServer())
      .post('/session-operations/scavenge')
      .set(signedHumanHeaders(stale.actorId))
      .send({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Operator scavenge first slice.',
        operation_idempotency_key_prefix: 'scavenge-first-slice',
        candidates: [{ codex_session_id: stale.sessionId, candidate_predicate: stale.predicate }],
      })
      .expect(201);
    expect(applied.body.results.map((result: { result: string }) => result.result)).toEqual(['applied']);
    const scavengeRecords = await stale.repository.listSessionRecoveryRecords({ codex_session_id: stale.sessionId });
    expect(scavengeRecords[0]).toMatchObject({ operation: 'scavenge', result: 'applied' });
    const replayed = await request(stale.app.getHttpServer())
      .post('/session-operations/scavenge')
      .set(signedHumanHeaders(stale.actorId))
      .send({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Operator scavenge first slice.',
        operation_idempotency_key_prefix: 'scavenge-first-slice',
        candidates: [{ codex_session_id: stale.sessionId, candidate_predicate: stale.predicate }],
      })
      .expect(201);
    expect(replayed.body.results[0]).toMatchObject({
      id: applied.body.results[0].id,
      operation: 'scavenge',
      result: 'applied',
    });
    expect(await stale.repository.listSessionRecoveryRecords({ codex_session_id: stale.sessionId })).toHaveLength(scavengeRecords.length);

    const skipped = await request(fresh.app.getHttpServer())
      .post('/session-operations/scavenge')
      .set(signedHumanHeaders(fresh.actorId))
      .send({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Operator scavenge first slice.',
        operation_idempotency_key_prefix: 'scavenge-first-slice',
        candidates: [{ codex_session_id: fresh.sessionId, candidate_predicate: fresh.predicate }],
      })
      .expect(201);
    expect(skipped.body.results.map((result: { result: string }) => result.result)).toEqual(['skipped']);

    const blockedResponse = await request(blocked.app.getHttpServer())
      .post('/session-operations/scavenge')
      .set(signedHumanHeaders(blocked.actorId))
      .send({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Operator scavenge first slice.',
        operation_idempotency_key_prefix: 'scavenge-first-slice',
        candidates: [{ codex_session_id: blocked.sessionId, candidate_predicate: blocked.predicate }],
      })
      .expect(201);
    expect(blockedResponse.body.results.map((result: { result: string }) => result.result)).toEqual(['blocked']);
  });
});
