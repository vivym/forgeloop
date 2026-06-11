import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  observedAbsentSchema,
  observedPresentSchema,
  observedRefSchema,
  operatorSessionHealthProjectionSchema,
  planItemSessionDiagnosticsSchema,
  planItemSessionHealthSeveritySchema,
  planItemSessionHealthStateSchema,
  recoverSessionRequestSchema,
  recoverSessionResponseSchema,
  scavengeSessionOperationsRequestSchema,
  scavengeSessionOperationsResponseSchema,
  sessionOperationsAuditResponseSchema,
  sessionOperationsFilterSchema,
  sessionOperationsHealthResponseSchema,
  sessionOperationsHealthQuerySchema,
  sessionRecoveryCandidatePredicateSchema,
  sessionRecoveryRecordDtoSchema,
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
    active_codex_session_id: 'session-1',
    active_boundary_summary_revision_id: null,
    active_spec_doc_revision_id: null,
    active_implementation_plan_doc_revision_id: null,
    execution_package_id: null,
    updated_at: iso,
  }),
  session: present({
    id: 'session-1',
    workflow_id: 'workflow-1',
    status: 'running',
    role: 'active',
    lease_epoch: 1,
    active_lease_id: 'lease-1',
    latest_turn_id: 'turn-1',
    latest_capsule_id: 'capsule-1',
    latest_capsule_digest: digest('8'),
    codex_thread_id_digest: digest('2'),
    runner_worker_id: null,
    runner_launch_lease_id: null,
    runner_runtime_job_id: null,
    runner_expires_at: null,
    updated_at: iso,
  }),
  active_lease: present({
    id: 'lease-1',
    session_id: 'session-1',
    status: 'active',
    lease_epoch: 1,
    worker_id: 'worker-1',
    worker_session_digest: digest('3'),
    heartbeat_at: iso,
    expires_at: '2026-06-10T01:00:00.000Z',
    updated_at: iso,
  }),
  pending_queued_action: present({
    id: 'action-1',
    workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
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
    workflow_id: 'workflow-1',
    status: 'queued',
    input_digest: digest('9'),
    input_capsule_digest: digest('5'),
    output_capsule_digest: null,
    runtime_job_id: 'runtime-job-1',
    updated_at: iso,
  }),
  runtime_job: present({
    id: 'runtime-job-1',
    session_id: 'session-1',
    status: 'running',
    terminal_status: null,
    worker_id: 'worker-1',
    launch_lease_id: 'launch-lease-1',
    worker_session_digest: digest('6'),
    expires_at: '2026-06-10T01:00:00.000Z',
    updated_at: iso,
  }),
  run_session: present({
    id: 'run-session-1',
    workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'turn-1',
    status: 'running',
    remote_runtime_job_id: 'runtime-job-1',
    remote_run_worker_lease_id: 'run-worker-lease-1',
    input_capsule_digest: digest('7'),
    output_capsule_digest: null,
    updated_at: iso,
  }),
  latest_capsule: present({
    id: 'capsule-1',
    digest: digest('8'),
    sequence: 4,
    retention_pin: {
      capsule_id: 'capsule-1',
      capsule_digest: digest('8'),
      pin_state: 'pinned',
      pin_reasons: ['active_session_latest'],
      referenced_by: [{ object_type: 'codex_session_turn', object_id: 'turn-1', relation: 'latest_turn' }],
      checked_at: iso,
    },
    created_at: iso,
  }),
} as const;

const predicateSummary = {
  operation_idempotency_key: 'recover:session-1:predicate-1',
  projection_digest: digest('0'),
  expected_health_state: 'blocked_stale_lease',
  observed_at: iso,
  workflow_state: 'present',
  session_state: 'present',
  active_lease_state: 'present',
  pending_queued_action_state: 'present',
  latest_turn_state: 'present',
  runtime_job_state: 'present',
  run_session_state: 'present',
  latest_capsule_state: 'present',
} as const;

const operatorProjection = {
  codex_session_id: 'session-1',
  project_id: 'project-1',
  organization_id: 'organization-1',
  workflow_id: 'workflow-1',
  development_plan_id: 'plan-1',
  development_plan_item_id: 'plan-item-1',
  state: 'blocked_stale_lease',
  severity: 'blocked',
  reason_code: 'stale_lease',
  summary: 'The active session lease is stale.',
  projection_digest: digest('0'),
  checked_at: iso,
  recovery_available: true,
  recovery_operation_labels: ['recover', 'mark_unrecoverable'],
  operator_intervention_required: true,
  normal_workflow_actions_available: false,
  retention_risk: true,
  lineage_risk: true,
  latest_checkpoint: {
    checkpoint_id: 'checkpoint-1',
    created_at: iso,
    projection_digest: digest('9'),
  },
  retention_pins: [
    {
      capsule_id: 'capsule-1',
      capsule_digest: digest('8'),
      pin_state: 'pinned',
      pin_reasons: ['active_session_latest'],
      referenced_by: [{ object_type: 'codex_session_turn', object_id: 'turn-1', relation: 'latest_turn' }],
      checked_at: iso,
    },
  ],
  candidate_predicate: candidatePredicate,
} as const;

const recoveryRecord = {
  id: 'recovery-record-1',
  codex_session_id: 'session-1',
  operation: 'recover',
  result: 'applied',
  result_code: 'recovered_stale_lease',
  reason: 'Recovered using the fenced predicate.',
  actor_id: 'operator-1',
  operation_idempotency_key: 'recover:session-1:predicate-1',
  before_state: 'blocked_stale_lease',
  after_state: 'recovered',
  before_projection_digest: digest('0'),
  after_projection_digest: digest('a'),
  predicate_summary: predicateSummary,
  object_event_id: 'object-event-1',
  created_at: iso,
} as const;

describe('session operations contracts', () => {
  it('parses observed absent refs', () => {
    expect(observedAbsentSchema.parse({ checked: true, state: 'absent' })).toEqual(absent);
  });

  it('rejects absent refs when a present ref is required', () => {
    expect(observedPresentSchema).toBeDefined();
    expect(() => observedPresentSchema({ id: z.string() }).parse(absent)).toThrow();
  });

  it('parses observed refs and rejects unchecked ref shapes', () => {
    const refSchema = observedRefSchema({ id: z.string() });

    expect(refSchema.parse(absent)).toEqual(absent);
    expect(refSchema.parse(present({ id: 'object-1' }))).toEqual(present({ id: 'object-1' }));
    expect(refSchema.safeParse({ state: 'absent' }).success).toBe(false);
    expect(refSchema.safeParse({ checked: false, state: 'absent' }).success).toBe(false);
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

  it('parses every Plan Item session health severity', () => {
    expect(planItemSessionHealthSeveritySchema.options).toEqual(['none', 'info', 'warning', 'blocked', 'critical']);

    for (const severity of planItemSessionHealthSeveritySchema.options) {
      expect(planItemSessionHealthSeveritySchema.parse(severity)).toBe(severity);
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

    for (const observedRefField of [
      'workflow',
      'session',
      'active_lease',
      'pending_queued_action',
      'latest_turn',
      'runtime_job',
      'run_session',
      'latest_capsule',
    ] as const) {
      const { [observedRefField]: _missingObservedRefField, ...missingObservedRefField } = candidatePredicate;
      expect(sessionRecoveryCandidatePredicateSchema.safeParse(missingObservedRefField).success).toBe(false);
    }

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
    const executeRequest = {
      mode: 'execute',
      reason: 'Recover sessions whose projected fencing still matches.',
      operation_idempotency_key_prefix: 'scavenge-2026-06-10',
      confirm_execute: true,
      candidates: [
        {
          codex_session_id: 'session-1',
          candidate_predicate: candidatePredicate,
        },
      ],
    } as const;

    const { confirm_execute: _missingConfirmExecute, ...missingConfirmExecute } = executeRequest;
    expect(scavengeSessionOperationsRequestSchema.safeParse(missingConfirmExecute).success).toBe(false);
    expect(
      scavengeSessionOperationsRequestSchema.safeParse({
        ...executeRequest,
        confirm_execute: false,
      }).success,
    ).toBe(false);

    const { reason: _missingReason, ...missingReason } = executeRequest;
    expect(scavengeSessionOperationsRequestSchema.safeParse(missingReason).success).toBe(false);

    const {
      operation_idempotency_key_prefix: _missingOperationIdempotencyKeyPrefix,
      ...missingOperationIdempotencyKeyPrefix
    } = executeRequest;
    expect(scavengeSessionOperationsRequestSchema.safeParse(missingOperationIdempotencyKeyPrefix).success).toBe(false);

    const { candidates: _missingCandidates, ...missingCandidates } = executeRequest;
    expect(scavengeSessionOperationsRequestSchema.safeParse(missingCandidates).success).toBe(false);
    expect(
      scavengeSessionOperationsRequestSchema.safeParse({
        ...executeRequest,
        candidates: [],
      }).success,
    ).toBe(false);

    expect(scavengeSessionOperationsRequestSchema.parse(executeRequest)).toMatchObject({
      mode: 'execute',
      confirm_execute: true,
      candidates: [
        {
          codex_session_id: 'session-1',
          candidate_predicate: { operation_idempotency_key: 'recover:session-1:predicate-1' },
        },
      ],
    });
  });

  it('defaults scavenge requests to dry_run and rejects bare predicate candidates', () => {
    expect(scavengeSessionOperationsRequestSchema.parse({})).toMatchObject({ mode: 'dry_run' });
    expect(scavengeSessionOperationsRequestSchema.safeParse({ mode: 'plan' }).success).toBe(false);
    expect(
      scavengeSessionOperationsRequestSchema.safeParse({
        mode: 'execute',
        reason: 'Recover sessions whose projected fencing still matches.',
        operation_idempotency_key_prefix: 'scavenge-2026-06-10',
        confirm_execute: true,
        candidates: [candidatePredicate],
      }).success,
    ).toBe(false);
  });

  it('accepts authorized operator projections with candidate predicates', () => {
    expect(
      operatorSessionHealthProjectionSchema.parse(operatorProjection),
    ).toMatchObject({
      codex_session_id: 'session-1',
      project_id: 'project-1',
      state: 'blocked_stale_lease',
      severity: 'blocked',
      reason_code: 'stale_lease',
      summary: 'The active session lease is stale.',
      projection_digest: digest('0'),
      checked_at: iso,
      recovery_available: true,
      recovery_operation_labels: ['recover', 'mark_unrecoverable'],
      operator_intervention_required: true,
      normal_workflow_actions_available: false,
      latest_checkpoint: {
        checkpoint_id: 'checkpoint-1',
        created_at: iso,
        projection_digest: digest('9'),
      },
      retention_pins: [
        {
          capsule_id: 'capsule-1',
          capsule_digest: digest('8'),
          pin_state: 'pinned',
          pin_reasons: ['active_session_latest'],
          referenced_by: [{ object_type: 'codex_session_turn', object_id: 'turn-1', relation: 'latest_turn' }],
          checked_at: iso,
        },
      ],
      candidate_predicate: {
        operation_idempotency_key: 'recover:session-1:predicate-1',
      },
    });
  });

  it('requires project scope on operator health projections', () => {
    const { project_id: _projectId, ...withoutProject } = operatorProjection;
    expect(operatorSessionHealthProjectionSchema.safeParse(withoutProject).success).toBe(false);
  });

  it('exposes plan-aligned public diagnostics without raw recovery internals', () => {
    const diagnostics = {
      plan_item_id: 'plan-item-1',
      workflow_resolution: 'active_workflow',
      state: 'blocked_stale_lease',
      severity: 'blocked',
      summary: 'The active session lease is stale.',
      operator_intervention_required: true,
      normal_workflow_actions_available: false,
      recovery_request_available: true,
      latest_checkpoint: {
        checkpoint_id: 'checkpoint-1',
        created_at: iso,
        projection_digest: digest('0'),
      },
    } as const;

    expect(planItemSessionDiagnosticsSchema.parse(diagnostics)).toMatchObject({
      plan_item_id: 'plan-item-1',
      workflow_resolution: 'active_workflow',
      recovery_request_available: true,
    });

    for (const forbidden of [
      ['workflow_id', 'workflow-1'],
      ['codex_session_id', 'session-1'],
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

  it('requires recover session operation and candidate predicate fencing', () => {
    for (const operation of ['recover', 'mark_unrecoverable'] as const) {
      expect(
        recoverSessionRequestSchema.parse({
          operation,
          reason: 'Recover the fenced session.',
          operation_idempotency_key: 'recover:session-1:predicate-1',
          candidate_predicate: candidatePredicate,
        }),
      ).toMatchObject({
        operation,
        operation_idempotency_key: 'recover:session-1:predicate-1',
        candidate_predicate: {
          operation_idempotency_key: 'recover:session-1:predicate-1',
        },
      });
    }

    expect(
      recoverSessionRequestSchema.safeParse({
        reason: 'Recover the fenced session.',
        operation_idempotency_key: 'recover:session-1:predicate-1',
        candidate_predicate: candidatePredicate,
      }).success,
    ).toBe(false);

    expect(
      recoverSessionRequestSchema.safeParse({
        operation: 'recover',
        reason: 'Recover the fenced session.',
        operation_idempotency_key: 'recover:session-1:mismatch',
        candidate_predicate: candidatePredicate,
      }).success,
    ).toBe(false);

    expect(
      recoverSessionRequestSchema.safeParse({
        operation: 'recover',
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
        state: 'blocked_stale_lease',
        severity: 'blocked',
        project_id: 'project-1',
        codex_session_id: 'session-1',
        worker_id: 'worker-1',
        recovered_state: 'recovered',
        min_lease_age_seconds: '60',
        max_lease_age_seconds: '3600',
        limit: '25',
      }),
    ).toMatchObject({
      state: 'blocked_stale_lease',
      severity: 'blocked',
      project_id: 'project-1',
      codex_session_id: 'session-1',
      worker_id: 'worker-1',
      recovered_state: 'recovered',
      min_lease_age_seconds: 60,
      max_lease_age_seconds: 3600,
      limit: 25,
    });

    for (const looseValue of ['', null] as const) {
      expect(
        sessionOperationsFilterSchema.safeParse({
          min_lease_age_seconds: looseValue,
        }).success,
      ).toBe(false);
      expect(
        sessionOperationsFilterSchema.safeParse({
          max_lease_age_seconds: looseValue,
        }).success,
      ).toBe(false);
      expect(
        sessionOperationsFilterSchema.safeParse({
          limit: looseValue,
        }).success,
      ).toBe(false);
    }

    expect(sessionOperationsFilterSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(sessionOperationsFilterSchema.safeParse({ health_states: [] }).success).toBe(false);
    expect(sessionOperationsFilterSchema.safeParse({ severities: [] }).success).toBe(false);
    expect(sessionOperationsFilterSchema.safeParse({ session_id: 'session-1' }).success).toBe(false);
  });

  it('coerces numeric session operations health query fields from strings', () => {
    expect(
      sessionOperationsHealthQuerySchema.parse({
        state: 'blocked_stale_lease',
        severity: 'blocked',
        project_id: 'project-1',
        codex_session_id: 'session-1',
        worker_id: 'worker-1',
        recovered_state: 'recovered',
        min_lease_age_seconds: '60',
        max_lease_age_seconds: '3600',
        limit: '25',
      }),
    ).toMatchObject({
      state: 'blocked_stale_lease',
      severity: 'blocked',
      project_id: 'project-1',
      codex_session_id: 'session-1',
      worker_id: 'worker-1',
      recovered_state: 'recovered',
      min_lease_age_seconds: 60,
      max_lease_age_seconds: 3600,
      limit: 25,
    });

    for (const looseValue of ['', null] as const) {
      expect(
        sessionOperationsHealthQuerySchema.safeParse({
          min_lease_age_seconds: looseValue,
        }).success,
      ).toBe(false);
      expect(
        sessionOperationsHealthQuerySchema.safeParse({
          max_lease_age_seconds: looseValue,
        }).success,
      ).toBe(false);
      expect(
        sessionOperationsHealthQuerySchema.safeParse({
          limit: looseValue,
        }).success,
      ).toBe(false);
    }

    expect(sessionOperationsHealthQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(sessionOperationsHealthQuerySchema.safeParse({ session_id: 'session-1' }).success).toBe(false);
    expect(
      sessionOperationsHealthQuerySchema.safeParse({
        health_state: 'blocked_stale_lease',
      }).success,
    ).toBe(false);
  });

  it('exposes recovery predicate summaries but rejects full predicates on recovery records', () => {
    expect(sessionRecoveryRecordDtoSchema.parse(recoveryRecord)).toMatchObject({
      operation: 'recover',
      result: 'applied',
      result_code: 'recovered_stale_lease',
      actor_id: 'operator-1',
      before_state: 'blocked_stale_lease',
      after_state: 'recovered',
      affected_lease_ids: [],
      affected_queued_action_ids: [],
      affected_turn_ids: [],
      affected_runtime_job_ids: [],
      affected_run_session_ids: [],
      affected_capsule_ids: [],
      predicate_summary: {
        operation_idempotency_key: 'recover:session-1:predicate-1',
        projection_digest: digest('0'),
      },
    });

    expect(
      sessionRecoveryRecordDtoSchema.safeParse({
        ...recoveryRecord,
        candidate_predicate: candidatePredicate,
      }).success,
    ).toBe(false);
  });

  it('rejects stale recovery record dto aliases directly and when nested in responses', () => {
    for (const staleField of [
      ['session_id', 'session-1'],
      ['operation_type', 'recover_session'],
      ['status', 'succeeded'],
      ['completed_at', iso],
      ['message', 'Recovered stale lease.'],
    ] as const) {
      const staleRecord = {
        ...recoveryRecord,
        [staleField[0]]: staleField[1],
      };

      expect(sessionRecoveryRecordDtoSchema.safeParse(staleRecord).success).toBe(false);
      expect(sessionOperationsAuditResponseSchema.safeParse({ items: [staleRecord] }).success).toBe(false);
      expect(
        scavengeSessionOperationsResponseSchema.safeParse({
          mode: 'execute',
          candidates: [operatorProjection],
          results: [staleRecord],
        }).success,
      ).toBe(false);
      expect(
        recoverSessionResponseSchema.safeParse({
          record: staleRecord,
          before: operatorProjection,
          after: {
            ...operatorProjection,
            state: 'recovered',
            recovery_available: false,
            operator_intervention_required: false,
            projection_digest: digest('a'),
            candidate_predicate: undefined,
          },
          replayed: false,
        }).success,
      ).toBe(false);
    }
  });

  it('rejects stale operator projection aliases directly and when nested in responses', () => {
    for (const staleField of [
      ['session_id', 'session-1'],
      ['health_state', 'blocked_stale_lease'],
      ['observed_at', iso],
    ] as const) {
      const staleProjection = {
        ...operatorProjection,
        [staleField[0]]: staleField[1],
      };

      expect(operatorSessionHealthProjectionSchema.safeParse(staleProjection).success).toBe(false);
      expect(
        sessionOperationsHealthResponseSchema.safeParse({
          items: [staleProjection],
          filters: {
            state: 'blocked_stale_lease',
          },
        }).success,
      ).toBe(false);
      expect(
        scavengeSessionOperationsResponseSchema.safeParse({
          mode: 'dry_run',
          candidates: [staleProjection],
          results: [],
        }).success,
      ).toBe(false);
      expect(
        recoverSessionResponseSchema.safeParse({
          record: recoveryRecord,
          before: staleProjection,
          after: {
            ...operatorProjection,
            state: 'recovered',
            recovery_available: false,
            operator_intervention_required: false,
            projection_digest: digest('a'),
            candidate_predicate: undefined,
          },
          replayed: false,
        }).success,
      ).toBe(false);
    }
  });

  it('requires operator projection risk flags to be booleans', () => {
    expect(
      operatorSessionHealthProjectionSchema.safeParse({
        ...operatorProjection,
        retention_risk: 'latest capsule is pinned by the stale turn.',
      }).success,
    ).toBe(false);

    expect(
      operatorSessionHealthProjectionSchema.safeParse({
        ...operatorProjection,
        lineage_risk: 'queued action is fenced to the stale turn.',
      }).success,
    ).toBe(false);
  });

  it('requires structured capsule retention pins', () => {
    expect(
      operatorSessionHealthProjectionSchema.safeParse({
        ...operatorProjection,
        retention_pins: [
          {
            pin_state: 'pinned',
            referenced_by: ['latest_turn:turn-1'],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      operatorSessionHealthProjectionSchema.parse({
        ...operatorProjection,
        retention_pins: [
          {
            capsule_id: 'capsule-1',
            capsule_digest: digest('8'),
            pin_state: 'pinned',
            pin_reasons: ['active_session_latest'],
            referenced_by: [{ object_type: 'codex_session_turn', object_id: 'turn-1', relation: 'latest_turn' }],
            checked_at: iso,
          },
        ],
      }).retention_pins[0]?.referenced_by[0],
    ).toEqual({ object_type: 'codex_session_turn', object_id: 'turn-1', relation: 'latest_turn' });
  });

  it('accepts plan-aligned health, audit, scavenge, and recover responses', () => {
    expect(
      sessionOperationsHealthResponseSchema.parse({
        items: [operatorProjection],
        filters: {
          state: 'blocked_stale_lease',
          codex_session_id: 'session-1',
          limit: '25',
        },
      }),
    ).toMatchObject({
      items: [{ codex_session_id: 'session-1', state: 'blocked_stale_lease' }],
      filters: { limit: 25 },
    });

    expect(sessionOperationsAuditResponseSchema.parse({ items: [recoveryRecord] })).toMatchObject({
      items: [{ operation: 'recover', result: 'applied' }],
    });

    expect(sessionOperationsAuditResponseSchema.safeParse({ records: [recoveryRecord] }).success).toBe(false);

    expect(
      scavengeSessionOperationsResponseSchema.parse({
        mode: 'dry_run',
        candidates: [operatorProjection],
      }),
    ).toMatchObject({
      mode: 'dry_run',
      candidates: [{ codex_session_id: 'session-1' }],
      results: [],
    });

    expect(
      recoverSessionResponseSchema.parse({
        record: recoveryRecord,
        before: operatorProjection,
        after: {
          ...operatorProjection,
          state: 'recovered',
          recovery_available: false,
          operator_intervention_required: false,
          projection_digest: digest('a'),
          candidate_predicate: undefined,
        },
        replayed: false,
      }),
    ).toMatchObject({
      record: { operation: 'recover', result: 'applied' },
      before: { state: 'blocked_stale_lease' },
      after: { state: 'recovered' },
      replayed: false,
    });
  });

  it('rejects stale session operations health response envelope fields', () => {
    const healthResponse = {
      items: [operatorProjection],
      filters: {
        state: 'blocked_stale_lease',
        codex_session_id: 'session-1',
        limit: '25',
      },
    } as const;

    expect(sessionOperationsHealthResponseSchema.parse(healthResponse)).toMatchObject({
      items: [{ codex_session_id: 'session-1', state: 'blocked_stale_lease' }],
      filters: { limit: 25 },
    });
    expect(sessionOperationsHealthResponseSchema.safeParse({ items: [operatorProjection] }).success).toBe(false);

    for (const staleField of [
      ['generated_at', iso],
      ['total_count', 1],
    ] as const) {
      expect(
        sessionOperationsHealthResponseSchema.safeParse({
          ...healthResponse,
          [staleField[0]]: staleField[1],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects stale session operations audit response envelope fields', () => {
    const auditResponse = {
      items: [recoveryRecord],
    } as const;

    expect(sessionOperationsAuditResponseSchema.parse(auditResponse)).toMatchObject({
      items: [{ operation: 'recover', result: 'applied' }],
    });

    for (const staleField of [
      ['generated_at', iso],
      ['records', [recoveryRecord]],
      ['next_cursor', 'cursor-1'],
      ['has_more', false],
    ] as const) {
      expect(
        sessionOperationsAuditResponseSchema.safeParse({
          ...auditResponse,
          [staleField[0]]: staleField[1],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects stale scavenge session operations response aliases and counters', () => {
    const scavengeResponse = {
      mode: 'dry_run',
      candidates: [operatorProjection],
      results: [recoveryRecord],
    } as const;

    expect(scavengeSessionOperationsResponseSchema.parse(scavengeResponse)).toMatchObject({
      mode: 'dry_run',
      candidates: [{ codex_session_id: 'session-1' }],
      results: [{ operation: 'recover', result: 'applied' }],
    });

    for (const staleField of [
      ['generated_at', iso],
      ['planned_candidates', [operatorProjection]],
      ['recovery_records', [recoveryRecord]],
      ['accepted_count', 1],
      ['rejected_count', 0],
      ['skipped_count', 0],
    ] as const) {
      expect(
        scavengeSessionOperationsResponseSchema.safeParse({
          ...scavengeResponse,
          [staleField[0]]: staleField[1],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects stale recover session response status fields', () => {
    const recoverResponse = {
      record: recoveryRecord,
      before: operatorProjection,
      after: {
        ...operatorProjection,
        state: 'recovered',
        recovery_available: false,
        operator_intervention_required: false,
        projection_digest: digest('a'),
        candidate_predicate: undefined,
      },
      replayed: false,
    } as const;

    expect(recoverSessionResponseSchema.parse(recoverResponse)).toMatchObject({
      record: { operation: 'recover', result: 'applied' },
      before: { state: 'blocked_stale_lease' },
      after: { state: 'recovered' },
      replayed: false,
    });

    for (const staleField of [
      ['status', 'accepted'],
      ['operation_id', 'operation-1'],
      ['session_id', 'session-1'],
      ['operation_idempotency_key', 'recover:session-1:predicate-1'],
      ['recovery_record', recoveryRecord],
      ['rejection_reason', 'Predicate no longer matched.'],
    ] as const) {
      expect(
        recoverSessionResponseSchema.safeParse({
          ...recoverResponse,
          [staleField[0]]: staleField[1],
        }).success,
      ).toBe(false);
    }
  });

  it('keeps public diagnostics free of operator-only recovery material', () => {
    const diagnostics = {
      plan_item_id: 'plan-item-1',
      workflow_resolution: 'active_workflow',
      state: 'blocked_stale_lease',
      summary: 'The active session lease is stale.',
      operator_intervention_required: true,
      normal_workflow_actions_available: false,
      recovery_request_available: true,
    } as const;

    expect(planItemSessionDiagnosticsSchema.parse(diagnostics)).toEqual(diagnostics);

    for (const rawIdentifier of [
      ['workflow_id', 'workflow-1'],
      ['codex_session_id', 'session-1'],
    ] as const) {
      expect(
        planItemSessionDiagnosticsSchema.safeParse({
          ...diagnostics,
          [rawIdentifier[0]]: rawIdentifier[1],
        }).success,
      ).toBe(false);
    }

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
