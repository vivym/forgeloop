import { DomainError, type CapsuleRetentionPin, type PlanItemSessionHealth, type SessionRecoveryRecord } from '@forgeloop/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertResettableDatabaseUrl,
  createDbClient,
  DrizzleDeliveryRepository,
  InMemoryDeliveryRepository,
  resetForgeloopDatabase,
  type DeliveryRepository,
} from '../../packages/db/src/index';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

const ids = {
  project: '88888831-1111-4111-8111-111111111000',
  workflow: '88888831-1111-4111-8111-111111111002',
  item: '88888831-1111-4111-8111-111111111003',
  plan: '88888831-1111-4111-8111-111111111004',
  session: '88888831-1111-4111-8111-111111111005',
  actor: '88888831-1111-4111-8111-111111111006',
  lease: '88888831-1111-4111-8111-111111111007',
  runtimeProfile: '88888831-1111-4111-8111-111111111008',
  runtimeProfileRevision: '88888831-1111-4111-8111-111111111009',
  credentialBinding: '88888831-1111-4111-8111-111111111010',
  credentialBindingVersion: '88888831-1111-4111-8111-111111111011',
  record: '88888831-1111-4111-8111-111111111012',
};

const isResettableDatabaseUrl = (databaseUrl: string): boolean => {
  try {
    assertResettableDatabaseUrl(databaseUrl);
    return true;
  } catch {
    return false;
  }
};

const drizzleDatabaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL ?? process.env.FORGELOOP_DATABASE_URL;
const drizzleTest =
  drizzleDatabaseUrl !== undefined && isResettableDatabaseUrl(drizzleDatabaseUrl) ? describe : describe.skip;
const activePools: Array<{ end: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(activePools.splice(0).map((pool) => pool.end()));
});

const healthFixture = (overrides: Partial<PlanItemSessionHealth> = {}): PlanItemSessionHealth => ({
  project_id: ids.project,
  workflow_id: ids.workflow,
  development_plan_id: ids.plan,
  development_plan_item_id: ids.item,
  codex_session_id: ids.session,
  state: 'healthy',
  severity: 'none',
  summary: 'Session is healthy.',
  projection_digest: digest('a'),
  checked_at: '2026-06-09T00:00:00.000Z',
  recovery_available: false,
  recovery_operation_labels: [],
  operator_intervention_required: false,
  normal_workflow_actions_available: true,
  retention_risk: false,
  lineage_risk: false,
  retention_pins: [],
  diagnostics: {
    plan_item_id: ids.item,
    workflow_resolution: 'active_workflow',
    workflow_id: ids.workflow,
    codex_session_id: ids.session,
    state: 'healthy',
    severity: 'none',
    summary: 'Session is healthy.',
    operator_intervention_required: false,
    normal_workflow_actions_available: true,
    recovery_request_available: false,
  },
  ...overrides,
});

const predicateFixture = () =>
  ({
    codex_session_id: ids.session,
    workflow_id: ids.workflow,
    expected_health_state: 'blocked_stale_lease',
    operation_idempotency_key: 'recover-stale-lease-1',
    projection_digest: digest('b'),
    workflow: {
      checked: true,
      state: 'present',
      value: {
        id: ids.workflow,
        development_plan_id: ids.plan,
        development_plan_item_id: ids.item,
        status: 'execution_running',
        updated_at: '2026-06-09T00:00:00.000Z',
      },
    },
    session: {
      checked: true,
      state: 'present',
      value: {
        id: ids.session,
        workflow_id: ids.workflow,
        status: 'running',
        role: 'active',
        updated_at: '2026-06-09T00:00:00.000Z',
      },
    },
    active_lease: {
      checked: true,
      state: 'present',
      value: {
        id: ids.lease,
        session_id: ids.session,
        status: 'active',
        worker_session_digest: digest('c'),
        expires_at: '2026-06-09T00:02:00.000Z',
        updated_at: '2026-06-09T00:01:00.000Z',
      },
    },
    pending_queued_action: { checked: true, state: 'absent' },
    latest_turn: { checked: true, state: 'absent' },
    runtime_job: { checked: true, state: 'absent' },
    run_session: { checked: true, state: 'absent' },
    latest_capsule: { checked: true, state: 'absent' },
    observed_at: '2026-06-09T00:03:00.000Z',
  }) as const;

const predicateSummaryFixture = () => {
  const predicate = predicateFixture();
  return {
    operation_idempotency_key: predicate.operation_idempotency_key,
    projection_digest: predicate.projection_digest,
    expected_health_state: predicate.expected_health_state,
    observed_at: predicate.observed_at,
    workflow_state: predicate.workflow.state,
    session_state: predicate.session.state,
    active_lease_state: predicate.active_lease.state,
    pending_queued_action_state: predicate.pending_queued_action.state,
    latest_turn_state: predicate.latest_turn.state,
    runtime_job_state: predicate.runtime_job.state,
    run_session_state: predicate.run_session.state,
    latest_capsule_state: predicate.latest_capsule.state,
  };
};

const recoveryRecordFixture = (overrides: Partial<SessionRecoveryRecord> = {}): SessionRecoveryRecord => ({
  id: ids.record,
  operation_idempotency_key: 'recover-stale-lease-1',
  operation: 'recover',
  actor_id: ids.actor,
  codex_session_id: ids.session,
  reason: 'Release stale lease.',
  before_state: 'blocked_stale_lease',
  after_state: 'recovered',
  before_projection_digest: digest('b'),
  after_projection_digest: digest('d'),
  predicate_summary: predicateFixture(),
  affected_lease_ids: [ids.lease],
  affected_queued_action_ids: [],
  affected_turn_ids: [],
  affected_runtime_job_ids: [],
  affected_run_session_ids: [],
  affected_capsule_ids: [],
  result: 'applied',
  result_code: 'recovered',
  created_at: '2026-06-09T00:00:00.000Z',
  ...overrides,
});

const pinFixture = (overrides: Partial<CapsuleRetentionPin> = {}): CapsuleRetentionPin => ({
  capsule_id: '88888831-1111-4111-8111-111111111301',
  capsule_digest: digest('e'),
  pin_state: 'pinned',
  pin_reasons: ['active_session_latest'],
  referenced_by: [{ object_type: 'codex_session', object_id: ids.session, relation: 'active_session_latest' }],
  checked_at: '2026-06-09T00:00:00.000Z',
  ...overrides,
});

const seedWorkflowSessionLease = async (repository: DeliveryRepository): Promise<void> => {
  await repository.createPlanItemWorkflowWithInitialSession({
    id: ids.workflow,
    codex_session_id: ids.session,
    development_plan_id: ids.plan,
    development_plan_item_id: ids.item,
    runtime_profile_id: ids.runtimeProfile,
    runtime_profile_revision_id: ids.runtimeProfileRevision,
    credential_binding_id: ids.credentialBinding,
    credential_binding_version_id: ids.credentialBindingVersion,
    actor_id: ids.actor,
    now: '2026-06-09T00:00:00.000Z',
  });
  await repository.claimCodexSessionLease({
    session_id: ids.session,
    workflow_id: ids.workflow,
    lease_id: ids.lease,
    worker_id: 'worker-1',
    worker_session_digest: digest('c'),
    lease_token_hash: digest('f'),
    now: '2026-06-09T00:00:00.000Z',
    expires_at: '2026-06-09T00:10:00.000Z',
  });
};

const createDrizzleRepository = async (): Promise<DeliveryRepository> => {
  if (drizzleDatabaseUrl === undefined) {
    throw new Error('Expected FORGELOOP_TEST_DATABASE_URL or FORGELOOP_DATABASE_URL');
  }
  await resetForgeloopDatabase(drizzleDatabaseUrl);
  const { db, pool } = createDbClient({ connectionString: drizzleDatabaseUrl });
  activePools.push(pool);
  return new DrizzleDeliveryRepository(db);
};

function runSessionOperationsRepositoryExamples(name: string, createRepository: () => DeliveryRepository): void {
  describe(name, () => {
    it('upserts one health projection per workflow/session', async () => {
      const repository = createRepository();
      const health = healthFixture({
        state: 'blocked_stale_lease',
        severity: 'blocked',
        recovery_available: true,
        recovery_operation_labels: ['recover'],
        candidate_predicate: predicateFixture(),
      });

      await repository.upsertPlanItemSessionHealth(health);
      await repository.upsertPlanItemSessionHealth({
        ...health,
        summary: 'Still stale.',
        checked_at: '2026-06-09T00:10:00.000Z',
      });

      const stored = await repository.getPlanItemSessionHealth({
        workflow_id: health.workflow_id!,
        codex_session_id: health.codex_session_id!,
      });
      const rows = await repository.listPlanItemSessionHealth({ workflow_id: health.workflow_id });
      expect(rows).toHaveLength(1);
      expect(stored?.summary).toBe('Still stale.');
      expect(rows[0]?.checked_at).toBe('2026-06-09T00:10:00.000Z');
      expect(stored).not.toHaveProperty('candidate_predicate');
      expect(rows[0]).not.toHaveProperty('candidate_predicate');
      await expect(repository.listPlanItemSessionHealth({ workflow_id: health.workflow_id, candidate_only: true })).resolves.toHaveLength(1);
    });

    it('rejects health projections without Plan Item identity', async () => {
      const repository = createRepository();
      const { development_plan_item_id: _planItemId, ...invalidHealth } = healthFixture();

      await expect(repository.upsertPlanItemSessionHealth(invalidHealth)).rejects.toMatchObject({
        code: 'session_operations_no_active_workflow',
      } satisfies Partial<DomainError>);
    });

    it('creates and replays recovery records by operation idempotency key', async () => {
      const repository = createRepository();
      const record = recoveryRecordFixture();
      const storedRecord = { ...record, predicate_summary: predicateSummaryFixture() };

      await expect(repository.createOrReplaySessionRecoveryRecord(record)).resolves.toEqual({
        record: storedRecord,
        replayed: false,
      });
      await expect(repository.createOrReplaySessionRecoveryRecord(record)).resolves.toEqual({
        record: storedRecord,
        replayed: true,
      });

      await expect(
        repository.createOrReplaySessionRecoveryRecord({
          ...record,
          reason: 'Different reason.',
        }),
      ).rejects.toMatchObject({
        code: 'session_operations_idempotency_conflict',
      } satisfies Partial<DomainError>);

      const stored = await repository.getSessionRecoveryRecordByOperationIdempotencyKey(record.operation_idempotency_key);
      expect(stored?.id).toBe(record.id);
      expect(stored?.predicate_summary).toEqual(predicateSummaryFixture());
      expect(stored?.predicate_summary).not.toHaveProperty('workflow');
      await expect(repository.listSessionRecoveryRecords({ codex_session_id: ids.session })).resolves.toEqual([storedRecord]);
      await expect(repository.listSessionRecoveryRecords({ workflow_id: ids.workflow })).resolves.toEqual([storedRecord]);
      await expect(repository.listSessionRecoveryRecords({ development_plan_item_id: ids.item })).resolves.toEqual([storedRecord]);
    });

    it('replays recovery records across full predicate and DTO predicate summary shapes', async () => {
      const repository = createRepository();
      const fullPredicateRecord = recoveryRecordFixture();
      const dtoSummaryRecord = recoveryRecordFixture({ predicate_summary: predicateSummaryFixture() });

      await expect(repository.createOrReplaySessionRecoveryRecord(fullPredicateRecord)).resolves.toEqual({
        record: dtoSummaryRecord,
        replayed: false,
      });
      await expect(repository.createOrReplaySessionRecoveryRecord(dtoSummaryRecord)).resolves.toEqual({
        record: dtoSummaryRecord,
        replayed: true,
      });

      const secondRepository = createRepository();
      await seedWorkflowSessionLease(secondRepository);
      await expect(secondRepository.createOrReplaySessionRecoveryRecord(dtoSummaryRecord)).resolves.toEqual({
        record: dtoSummaryRecord,
        replayed: false,
      });
      await expect(secondRepository.createOrReplaySessionRecoveryRecord(fullPredicateRecord)).resolves.toEqual({
        record: dtoSummaryRecord,
        replayed: true,
      });
    });

    it('stores and replaces per-capsule retention pins by reference relation', async () => {
      const repository = createRepository();
      const initial = pinFixture();
      const replacement = {
        ...initial,
        pin_state: 'not_cleanable' as const,
        pin_reasons: ['active_session_latest', 'recovery_record'],
        checked_at: '2026-06-09T00:10:00.000Z',
      };

      await repository.upsertCapsuleRetentionPins([initial]);
      await repository.upsertCapsuleRetentionPins([replacement]);

      const pins = await repository.listCapsuleRetentionPins({ capsule_id: initial.capsule_id });
      expect(pins).toEqual([{ ...replacement, referenced_by: [replacement.referenced_by[0]!] }]);
    });

    it('returns one capsule retention pin per referenced object relation', async () => {
      const repository = createRepository();
      const pin = pinFixture({
        referenced_by: [
          { object_type: 'codex_session', object_id: ids.session, relation: 'active_session_latest' },
          { object_type: 'session_recovery_record', object_id: ids.record, relation: 'recovery_record' },
        ],
      });

      await repository.upsertCapsuleRetentionPins([pin]);

      const allPins = await repository.listCapsuleRetentionPins({ capsule_id: pin.capsule_id });
      expect(allPins).toEqual([
        { ...pin, referenced_by: [pin.referenced_by[0]!] },
        { ...pin, referenced_by: [pin.referenced_by[1]!] },
      ]);
      await expect(
        repository.listCapsuleRetentionPins({
          capsule_id: pin.capsule_id,
          referenced_object_type: 'session_recovery_record',
          referenced_object_id: ids.record,
        }),
      ).resolves.toEqual([{ ...pin, referenced_by: [pin.referenced_by[1]!] }]);
    });

    it('discovers active workflow-owned sessions before health rows exist using server supplied now', async () => {
      const repository = createRepository();
      await seedWorkflowSessionLease(repository);

      await expect(repository.listPlanItemSessionHealth({ workflow_id: ids.workflow })).resolves.toEqual([]);
      await expect(
        repository.listActivePlanItemWorkflowSessionsForSessionOperations({
          development_plan_item_id: ids.item,
          workflow_id: ids.workflow,
          codex_session_id: ids.session,
          worker_id: 'worker-1',
          min_lease_age_seconds: 300,
          max_lease_age_seconds: 400,
          now: '2026-06-09T00:06:00.000Z',
        }),
      ).resolves.toEqual([
        {
          workflow_id: ids.workflow,
          development_plan_item_id: ids.item,
          codex_session_id: ids.session,
        },
      ]);
      await expect(
        repository.listActivePlanItemWorkflowSessionsForSessionOperations({
          development_plan_item_id: ids.item,
          worker_id: 'worker-1',
          min_lease_age_seconds: 400,
          now: '2026-06-09T00:06:00.000Z',
        }),
      ).resolves.toEqual([]);
    });
  });
}

runSessionOperationsRepositoryExamples('Session operations repository in-memory adapter', () => new InMemoryDeliveryRepository());

drizzleTest('Session operations repository Drizzle adapter', () => {
  runSessionOperationsRepositoryExamples('resettable Postgres persistence', createDrizzleRepository);
});
