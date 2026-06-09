import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  observedAbsentSchema,
  observedPresentSchema,
  planItemSessionDiagnosticsSchema,
  planItemSessionHealthStateSchema,
  recoverSessionRequestSchema,
  scavengeSessionOperationsRequestSchema,
  sessionOperationsFilterSchema,
  sessionOperationsHealthQuerySchema,
  sessionRecoveryCandidatePredicateSchema,
} from '@forgeloop/contracts';

const iso = '2026-06-10T00:00:00.000Z';
const digest = (char: string) => `sha256:${char.repeat(64)}`;

const present = <T>(value: T) =>
  ({
    checked: true,
    state: 'present',
    value,
  }) as const;

const absent = {
  checked: true,
  state: 'absent',
} as const;

const candidatePredicate = {
  codex_session_id: 'session-1',
  workflow_id: 'workflow-1',
  expected_health_state: 'blocked_stale_lease',
  operation_idempotency_key: 'recover:session-1:predicate-1',
  projection_digest: digest('0'),
  observed_at: iso,
  workflow: present({
    id: 'workflow-1',
    development_plan_id: 'plan-1',
    development_plan_item_id: 'plan-item-1',
    status: 'execution_running',
    updated_at: iso,
  }),
  session: present({
    id: 'session-1',
    workflow_id: 'workflow-1',
    status: 'running',
    role: 'active',
    worker_session_digest: digest('1'),
    codex_thread_id_digest: digest('2'),
    updated_at: iso,
  }),
  active_lease: present({
    id: 'lease-1',
    session_id: 'session-1',
    status: 'active',
    worker_session_digest: digest('3'),
    expires_at: '2026-06-10T01:00:00.000Z',
    updated_at: iso,
  }),
  pending_queued_action: present({
    id: 'action-1',
    workflow_id: 'workflow-1',
    status: 'queued',
    kind: 'continue_execution',
    idempotency_key: digest('4'),
    codex_session_turn_id: null,
    expected_input_capsule_digest: null,
    updated_at: iso,
  }),
  latest_turn: present({
    id: 'turn-1',
    session_id: 'session-1',
    status: 'queued',
    input_capsule_digest: digest('5'),
    updated_at: iso,
  }),
  runtime_job: present({
    id: 'runtime-job-1',
    session_id: 'session-1',
    status: 'running',
    worker_session_digest: digest('6'),
    updated_at: iso,
  }),
  run_session: present({
    id: 'run-session-1',
    status: 'running',
    input_capsule_digest: digest('7'),
    updated_at: iso,
  }),
  latest_capsule: present({
    id: 'capsule-1',
    digest: digest('8'),
    sequence: 4,
    retention_pin: {
      pin_state: 'pinned',
      referenced_by: ['latest_turn:turn-1'],
    },
    created_at: iso,
  }),
} as const;

describe('session operations contracts', () => {
  it('parses observed absent refs', () => {
    expect(observedAbsentSchema.parse({ checked: true, state: 'absent' })).toEqual(absent);
  });

  it('rejects absent refs when a present ref is required', () => {
    expect(observedPresentSchema).toBeDefined();
    expect(() => observedPresentSchema({ id: z.string() }).parse(absent)).toThrow();
  });

  it('parses every Plan Item session health state', () => {
    expect(planItemSessionHealthStateSchema.options).toEqual([
      'healthy',
      'attention_needed',
      'blocked_stale_lease',
      'blocked_orphaned_action',
      'blocked_missing_capsule',
      'blocked_lineage_conflict',
      'recovered',
      'unrecoverable',
    ]);

    for (const state of planItemSessionHealthStateSchema.options) {
      expect(planItemSessionHealthStateSchema.parse(state)).toBe(state);
    }
  });

  it('requires full observed fencing material for recovery candidates', () => {
    expect(sessionRecoveryCandidatePredicateSchema.parse(candidatePredicate)).toMatchObject({
      codex_session_id: 'session-1',
      workflow_id: 'workflow-1',
      expected_health_state: 'blocked_stale_lease',
      operation_idempotency_key: 'recover:session-1:predicate-1',
      projection_digest: digest('0'),
      workflow: { state: 'present' },
      session: { state: 'present' },
      active_lease: { state: 'present' },
      pending_queued_action: { state: 'present' },
      latest_turn: { state: 'present' },
      runtime_job: { state: 'present' },
      run_session: { state: 'present' },
      latest_capsule: { state: 'present' },
      observed_at: iso,
    });

    const { latest_capsule: _latestCapsule, ...missingLatestCapsule } = candidatePredicate;
    expect(sessionRecoveryCandidatePredicateSchema.safeParse(missingLatestCapsule).success).toBe(false);

    for (const requiredField of [
      'codex_session_id',
      'workflow_id',
      'expected_health_state',
      'operation_idempotency_key',
      'projection_digest',
    ] as const) {
      const { [requiredField]: _missingRequiredField, ...missingRequiredField } = candidatePredicate;
      expect(sessionRecoveryCandidatePredicateSchema.safeParse(missingRequiredField).success).toBe(false);
    }

    expect(
      sessionRecoveryCandidatePredicateSchema.safeParse({
        ...candidatePredicate,
        predicate_key: 'recover:session-1:predicate-1',
      }).success,
    ).toBe(false);
  });

  it('requires nullable turn and input capsule keys on present queued action predicates', () => {
    expect(sessionRecoveryCandidatePredicateSchema.parse(candidatePredicate).pending_queued_action).toMatchObject({
      state: 'present',
      value: {
        codex_session_turn_id: null,
        expected_input_capsule_digest: null,
      },
    });

    const result = sessionRecoveryCandidatePredicateSchema.safeParse({
      ...candidatePredicate,
      pending_queued_action: present({
        ...candidatePredicate.pending_queued_action.value,
        codex_session_turn_id: undefined,
        expected_input_capsule_digest: undefined,
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['pending_queued_action', 'value', 'codex_session_turn_id'],
        }),
        expect.objectContaining({
          path: ['pending_queued_action', 'value', 'expected_input_capsule_digest'],
        }),
      ]),
    );
  });

  it('requires explicit execution fencing for scavenge execute requests', () => {
    expect(
      scavengeSessionOperationsRequestSchema.safeParse({
        mode: 'execute',
      }).success,
    ).toBe(false);

    expect(
      scavengeSessionOperationsRequestSchema.parse({
        mode: 'execute',
        reason: 'Recover sessions whose projected fencing still matches.',
        operation_idempotency_key_prefix: 'scavenge-2026-06-10',
        confirm_execute: true,
        candidates: [candidatePredicate],
      }),
    ).toMatchObject({
      mode: 'execute',
      confirm_execute: true,
      candidates: [{ operation_idempotency_key: 'recover:session-1:predicate-1' }],
    });
  });

  it('requires recover session operation and candidate predicate fencing', () => {
    expect(
      recoverSessionRequestSchema.parse({
        operation: 'recover',
        session_id: 'session-1',
        reason: 'Recover the fenced session.',
        operation_idempotency_key: 'recover:session-1:predicate-1',
        candidate_predicate: candidatePredicate,
      }),
    ).toMatchObject({
      operation: 'recover',
      operation_idempotency_key: 'recover:session-1:predicate-1',
      candidate_predicate: {
        operation_idempotency_key: 'recover:session-1:predicate-1',
      },
    });

    expect(
      recoverSessionRequestSchema.safeParse({
        session_id: 'session-1',
        reason: 'Recover the fenced session.',
        operation_idempotency_key: 'recover:session-1:predicate-1',
        candidate_predicate: candidatePredicate,
      }).success,
    ).toBe(false);
  });

  it('coerces numeric session operations filter fields from strings', () => {
    expect(
      sessionOperationsFilterSchema.parse({
        min_lease_age_seconds: '60',
        max_lease_age_seconds: '3600',
        limit: '25',
      }),
    ).toMatchObject({
      min_lease_age_seconds: 60,
      max_lease_age_seconds: 3600,
      limit: 25,
    });
  });

  it('coerces numeric session operations health query fields from strings', () => {
    expect(
      sessionOperationsHealthQuerySchema.parse({
        min_lease_age_seconds: '60',
        max_lease_age_seconds: '3600',
        limit: '25',
      }),
    ).toMatchObject({
      min_lease_age_seconds: 60,
      max_lease_age_seconds: 3600,
      limit: 25,
    });
  });

  it('keeps public diagnostics free of operator-only recovery material', () => {
    const diagnostics = {
      health_state: 'blocked_stale_lease',
      severity: 'blocked',
      summary: 'The active session lease is stale.',
      observed_at: iso,
      blocker_codes: ['stale_lease'],
    } as const;

    expect(planItemSessionDiagnosticsSchema.parse(diagnostics)).toEqual(diagnostics);

    for (const forbidden of [
      ['candidate_predicate', candidatePredicate],
      ['worker_session_digest', digest('9')],
      ['operation_idempotency_key', 'recover:session-1:predicate-1'],
      ['codex_thread_id', 'raw-thread-id'],
      ['workspace_path', '/Users/viv/projs/forgeloop'],
      ['secret_material', 'token'],
    ] as const) {
      expect(
        planItemSessionDiagnosticsSchema.safeParse({
          ...diagnostics,
          [forbidden[0]]: forbidden[1],
        }).success,
      ).toBe(false);
    }
  });
});
