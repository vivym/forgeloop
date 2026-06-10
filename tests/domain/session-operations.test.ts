import { describe, expect, it } from 'vitest';
import {
  DomainError,
  assertRecoveryIdempotencyNotConflicting,
  assertRecoveryPredicateStillMatches,
  buildCapsuleRetentionPins,
  buildSessionHealthProjection,
  capsuleDigestPrefix,
  recoveryRequestMatchesExistingRecord,
  redactOperatorSessionHealthProjection,
  redactPlanItemSessionDiagnostics,
  sessionRecoveryProjectionDigest,
  type BuildSessionHealthProjectionInput,
  type CodexRuntimeCapsule,
  type CodexSession,
  type CodexSessionLease,
  type PlanItemWorkflow,
  type PlanItemWorkflowQueuedAction,
  type RunSession,
  type SessionRecoveryRecord,
} from '@forgeloop/domain';
import {
  operatorSessionHealthProjectionSchema,
  planItemSessionDiagnosticsSchema,
  sessionRecoveryCandidatePredicateSchema,
} from '@forgeloop/contracts';

const checkedAt = '2026-06-10T12:00:00.000Z';
const later = '2026-06-10T12:05:00.000Z';
const earlier = '2026-06-10T11:55:00.000Z';
const digest = (char: string) => `sha256:${char.repeat(64)}`;

const workflow = (overrides: Partial<PlanItemWorkflow> = {}): PlanItemWorkflow => ({
  id: 'workflow-1',
  development_plan_id: 'plan-1',
  development_plan_item_id: 'plan-item-1',
  status: 'execution_running',
  active_codex_session_id: 'session-1',
  created_by_actor_id: 'actor-1',
  created_at: earlier,
  updated_at: earlier,
  ...overrides,
});

const session = (overrides: Partial<CodexSession> = {}): CodexSession => ({
  id: 'session-1',
  owner_type: 'plan_item_workflow',
  owner_id: 'workflow-1',
  status: 'running',
  role: 'active',
  codex_thread_id: 'raw-thread-id',
  codex_thread_id_digest: digest('a'),
  latest_capsule_id: 'capsule-1',
  latest_capsule_digest: digest('b'),
  latest_turn_id: 'turn-1',
  runtime_profile_id: 'profile-1',
  runtime_profile_revision_id: 'profile-revision-1',
  credential_binding_id: 'credential-1',
  credential_binding_version_id: 'credential-version-1',
  lease_epoch: 1,
  active_lease_id: 'lease-1',
  created_by_actor_id: 'actor-1',
  created_at: earlier,
  updated_at: earlier,
  ...overrides,
});

const capsule = (overrides: Partial<CodexRuntimeCapsule> = {}): CodexRuntimeCapsule => ({
  id: 'capsule-1',
  codex_session_id: 'session-1',
  created_from_turn_id: 'turn-1',
  sequence: 1,
  artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
  digest: digest('b'),
  size_bytes: '100',
  manifest_digest: digest('c'),
  thread_state_digest: digest('d'),
  memory_state_digest: digest('e'),
  environment_manifest_digest: digest('f'),
  codex_thread_id_digest: digest('a'),
  codex_cli_version: '1.0.0',
  app_server_protocol_digest: digest('1'),
  runtime_profile_revision_id: 'profile-revision-1',
  trusted_runtime_manifest_digest: digest('2'),
  credential_binding_lineage_digest: digest('3'),
  created_by_actor_id: 'actor-1',
  created_at: earlier,
  ...overrides,
});

const lease = (overrides: Partial<CodexSessionLease> = {}): CodexSessionLease => ({
  id: 'lease-1',
  codex_session_id: 'session-1',
  lease_token_hash: digest('4'),
  lease_epoch: 1,
  worker_id: 'worker-1',
  worker_session_digest: digest('5'),
  status: 'active',
  acquired_at: earlier,
  heartbeat_at: earlier,
  expires_at: later,
  created_at: earlier,
  updated_at: earlier,
  ...overrides,
});

const queuedAction = (overrides: Partial<PlanItemWorkflowQueuedAction> = {}): PlanItemWorkflowQueuedAction => ({
  id: 'action-1',
  workflow_id: 'workflow-1',
  codex_session_id: 'session-1',
  kind: 'continue_execution',
  status: 'queued',
  context_preview_digest: digest('6'),
  idempotency_key: digest('7'),
  created_by_actor_id: 'actor-1',
  created_at: earlier,
  updated_at: earlier,
  ...overrides,
});

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-session-1',
  execution_package_id: 'package-1',
  workflow_id: 'workflow-1',
  codex_session_id: 'session-1',
  requested_by_actor_id: 'actor-1',
  status: 'running',
  changed_files: [],
  check_results: [],
  artifacts: [],
  log_refs: [],
  created_at: earlier,
  updated_at: earlier,
  ...overrides,
});

const baseInput = (overrides: Partial<BuildSessionHealthProjectionInput> = {}): BuildSessionHealthProjectionInput => ({
  project_id: 'project-1',
  organization_id: 'org-1',
  checked_at: checkedAt,
  workflow: workflow(),
  session: session(),
  latest_capsule: capsule(),
  active_lease: lease(),
  retention_pin_inputs: {
    active_session: session(),
    capsules: [capsule()],
  },
  latest_checkpoint: {
    checkpoint_id: 'checkpoint-1',
    created_at: earlier,
    projection_digest: digest('8'),
  },
  ...overrides,
});

const collectText = (value: unknown): string => JSON.stringify(value);

describe('session operations domain helpers', () => {
  it('buildSessionHealthProjection returns healthy when workflow/session/capsule align', () => {
    const projection = buildSessionHealthProjection(baseInput());

    expect(operatorSessionHealthProjectionSchema.parse(redactOperatorSessionHealthProjection(projection))).toMatchObject({
      codex_session_id: 'session-1',
      project_id: 'project-1',
      organization_id: 'org-1',
      state: 'healthy',
      severity: 'none',
      recovery_available: false,
      operator_intervention_required: false,
      normal_workflow_actions_available: true,
      retention_risk: false,
      lineage_risk: false,
      retention_pins: [
        expect.objectContaining({
          capsule_id: 'capsule-1',
          capsule_digest: digest('b'),
          pin_state: 'pinned',
          pin_reasons: ['active_session_latest'],
        }),
      ],
    });
    expect(projection.candidate_predicate).toBeUndefined();
  });

  it('projects expired active leases as blocked_stale_lease with a fenced candidate predicate', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        active_lease: lease({ expires_at: checkedAt }),
      }),
    );

    expect(projection).toMatchObject({
      state: 'blocked_stale_lease',
      severity: 'blocked',
      reason_code: 'stale_lease',
      recovery_available: true,
      recovery_operation_labels: ['recover', 'mark_unrecoverable'],
      operator_intervention_required: true,
      normal_workflow_actions_available: false,
      lineage_risk: false,
    });
    expect(projection.candidate_predicate?.active_lease).toMatchObject({ state: 'present' });
    expect(sessionRecoveryCandidatePredicateSchema.parse(projection.candidate_predicate)).toMatchObject({
      expected_health_state: 'blocked_stale_lease',
      projection_digest: projection.projection_digest,
      active_lease: { state: 'present' },
    });
  });

  it('projects non-blocking stale_projection_reason as attention_needed without recovery', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        stale_projection_reason: 'checkpoint lagged behind the latest event',
      }),
    );

    expect(projection).toMatchObject({
      state: 'attention_needed',
      severity: 'warning',
      reason_code: 'stale_projection_reason',
      recovery_available: false,
      recovery_operation_labels: [],
      operator_intervention_required: true,
      normal_workflow_actions_available: true,
    });
    expect(projection.candidate_predicate).toBeUndefined();
  });

  it('missing active session or workflow/session mismatch projects blocked_lineage_conflict fail-closed', () => {
    for (const input of [
      baseInput({ session: undefined, latest_capsule: undefined, active_lease: undefined }),
      baseInput({ workflow: workflow({ active_codex_session_id: 'session-other' }) }),
    ]) {
      const projection = buildSessionHealthProjection(input);

      expect(projection).toMatchObject({
        state: 'blocked_lineage_conflict',
        severity: 'critical',
        reason_code: 'lineage_conflict',
        recovery_available: false,
        operator_intervention_required: true,
        normal_workflow_actions_available: false,
        lineage_risk: true,
      });
    }
  });

  it('missing or mismatched latest capsule projects blocked_missing_capsule', () => {
    for (const input of [
      baseInput({ latest_capsule: undefined }),
      baseInput({ latest_capsule: capsule({ digest: digest('9') }) }),
    ]) {
      const projection = buildSessionHealthProjection(input);

      expect(projection).toMatchObject({
        state: 'blocked_missing_capsule',
        severity: 'blocked',
        reason_code: 'missing_capsule',
        recovery_available: false,
        operator_intervention_required: true,
        normal_workflow_actions_available: false,
      });
    }
  });

  it('pending queued action with no active lease projects blocked_orphaned_action', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        active_lease: undefined,
        pending_queued_action: queuedAction(),
      }),
    );

    expect(projection).toMatchObject({
      state: 'blocked_orphaned_action',
      severity: 'blocked',
      reason_code: 'orphaned_action',
      recovery_available: true,
    });
    expect(projection.candidate_predicate?.pending_queued_action).toMatchObject({ state: 'present' });
  });

  it('runtime job without run session projects blocked_orphaned_action', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        runtime_job: {
          id: 'runtime-job-1',
          session_id: 'session-1',
          status: 'running',
          worker_session_digest: digest('5'),
          updated_at: earlier,
        },
        run_session: undefined,
      }),
    );

    expect(projection).toMatchObject({
      state: 'blocked_orphaned_action',
      severity: 'blocked',
      reason_code: 'orphaned_action',
      recovery_available: true,
    });
    expect(projection.candidate_predicate?.runtime_job).toMatchObject({ state: 'present' });
    expect(projection.candidate_predicate?.run_session).toMatchObject({ state: 'absent' });
  });

  it('buildCapsuleRetentionPins derives structured merged pins from product references', () => {
    const capsuleOne = capsule();
    const capsuleTwo = capsule({ id: 'capsule-2', digest: digest('9'), sequence: 2 });
    const pins = buildCapsuleRetentionPins({
      checked_at: checkedAt,
      capsules: [capsuleOne, capsuleOne, capsuleTwo],
      active_session: session(),
      product_checkpoints: [
        { id: 'boundary-1', kind: 'brainstorming_boundary', capsule_id: 'capsule-1', capsule_digest: digest('b') },
        { id: 'spec-1', kind: 'spec_doc', capsule_id: 'capsule-1', capsule_digest: digest('b') },
        { id: 'plan-1', kind: 'implementation_plan_doc', capsule_id: 'capsule-1', capsule_digest: digest('b') },
        { id: 'exec-1', kind: 'execution_checkpoint', capsule_id: 'capsule-2', capsule_digest: digest('9') },
        { id: 'review-1', kind: 'review_checkpoint', capsule_id: 'capsule-2', capsule_digest: digest('9') },
        { id: 'transition-1', kind: 'workflow_transition', capsule_id: 'capsule-2', capsule_digest: digest('9') },
        { id: 'fork-1', kind: 'fork_point', capsule_id: 'capsule-2', capsule_digest: digest('9') },
      ],
      recovery_records: [
        {
          id: 'recovery-1',
          codex_session_id: 'session-1',
          operation: 'recover',
          result: 'applied',
          result_code: 'recovered',
          reason: 'Recovered stale lease.',
          actor_id: 'operator-1',
          operation_idempotency_key: 'recover-key',
          before_state: 'blocked_stale_lease',
          after_state: 'recovered',
          before_projection_digest: digest('0'),
          after_projection_digest: digest('1'),
          affected_capsule_ids: ['capsule-1'],
          predicate_summary: {
            operation_idempotency_key: 'recover-key',
            projection_digest: digest('0'),
            expected_health_state: 'blocked_stale_lease',
            observed_at: checkedAt,
            workflow_state: 'present',
            session_state: 'present',
            active_lease_state: 'present',
            pending_queued_action_state: 'absent',
            latest_turn_state: 'present',
            runtime_job_state: 'absent',
            run_session_state: 'absent',
            latest_capsule_state: 'present',
          },
        },
      ],
      object_events: [
        { id: 'event-1', capsule_id: 'capsule-1', capsule_digest: digest('b'), event_type: 'capsule_referenced' },
      ],
      unrecoverable_evidence: [
        { id: 'evidence-1', capsule_id: 'capsule-2', capsule_digest: digest('9') },
      ],
    });

    expect(pins).toHaveLength(2);
    expect(pins[0]).toMatchObject({
      capsule_id: 'capsule-1',
      capsule_digest: digest('b'),
      pin_state: 'not_cleanable',
      pin_reasons: [
        'active_session_latest',
        'brainstorming_boundary',
        'implementation_plan_doc',
        'object_event',
        'recovery_record',
        'spec_doc',
      ],
      referenced_by: expect.arrayContaining([
        { object_type: 'codex_session', object_id: 'session-1', relation: 'active_session_latest' },
        { object_type: 'brainstorming_boundary', object_id: 'boundary-1', relation: 'brainstorming_boundary' },
        { object_type: 'object_event', object_id: 'event-1', relation: 'object_event' },
      ]),
    });
    expect(pins[1]).toMatchObject({
      capsule_id: 'capsule-2',
      capsule_digest: digest('9'),
      pin_state: 'not_cleanable',
      pin_reasons: [
        'execution_checkpoint',
        'fork_point',
        'review_checkpoint',
        'unrecoverable_evidence',
        'workflow_transition',
      ],
    });
  });

  it('unknown or inconsistent capsule inputs produce unknown pins and retention risk in projection input', () => {
    const pins = buildCapsuleRetentionPins({
      checked_at: checkedAt,
      capsules: [capsule({ id: 'capsule-1', digest: digest('b') })],
      product_checkpoints: [{ id: 'spec-1', kind: 'spec_doc', capsule_id: 'capsule-1', capsule_digest: digest('9') }],
    });

    expect(pins).toEqual([
      expect.objectContaining({
        capsule_id: 'capsule-1',
        capsule_digest: digest('b'),
        pin_state: 'unknown',
        pin_reasons: ['spec_doc'],
      }),
    ]);

    const projection = buildSessionHealthProjection(
      baseInput({
        retention_pin_inputs: {
          checked_at: checkedAt,
          capsules: [capsule({ id: 'capsule-1', digest: digest('b') })],
          product_checkpoints: [{ id: 'spec-1', kind: 'spec_doc', capsule_id: 'capsule-1', capsule_digest: digest('9') }],
        },
      }),
    );
    expect(projection.retention_risk).toBe(true);
  });

  it('redactPlanItemSessionDiagnostics returns public DTO without raw internals', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        active_lease: lease({ expires_at: checkedAt }),
      }),
    );
    const diagnostics = redactPlanItemSessionDiagnostics(projection);

    expect(planItemSessionDiagnosticsSchema.parse(diagnostics)).toMatchObject({
      plan_item_id: 'plan-item-1',
      workflow_resolution: 'active_workflow',
      workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      state: 'blocked_stale_lease',
      recovery_request_available: true,
    });
    const text = collectText(diagnostics);
    expect(text).not.toContain('candidate_predicate');
    expect(text).not.toContain('worker_session_digest');
    expect(text).not.toContain(digest('5'));
    expect(text).not.toContain('raw-thread-id');
    expect(text).not.toContain('/Users/');
    expect(text).not.toContain('secret');
  });

  it('redactOperatorSessionHealthProjection keeps candidate_predicate and follows current contract without stale aliases', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        active_lease: lease({ expires_at: checkedAt }),
      }),
    );
    const operator = redactOperatorSessionHealthProjection(projection);

    expect(operatorSessionHealthProjectionSchema.parse(operator)).toMatchObject({
      codex_session_id: 'session-1',
      state: 'blocked_stale_lease',
      candidate_predicate: {
        active_lease: { state: 'present' },
      },
    });
    expect(operator.candidate_predicate).toBeDefined();
    expect(operator).not.toHaveProperty('session_id');
    expect(operator).not.toHaveProperty('health_state');
    expect(operator).not.toHaveProperty('observed_at');
  });

  it('sessionRecoveryProjectionDigest is stable and canonical', () => {
    expect(sessionRecoveryProjectionDigest({ b: 2, a: 1 })).toBe(sessionRecoveryProjectionDigest({ a: 1, b: 2 }));
    expect(sessionRecoveryProjectionDigest({ a: 1 })).not.toBe(sessionRecoveryProjectionDigest({ a: 2 }));
  });

  it('recoveryRequestMatchesExistingRecord rejects idempotency collisions with different operation targets', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        active_lease: lease({ expires_at: checkedAt }),
      }),
    );
    const incoming = {
      operation: 'recover' as const,
      reason: 'Recover stale lease.',
      operation_idempotency_key: projection.candidate_predicate!.operation_idempotency_key,
      candidate_predicate: projection.candidate_predicate!,
      target_after_state: 'recovered' as const,
      target_result: 'applied' as const,
    };
    const existing: SessionRecoveryRecord = {
      id: 'record-1',
      codex_session_id: 'session-1',
      operation: 'recover',
      result: 'applied',
      result_code: 'recovered',
      reason: 'Recover stale lease.',
      actor_id: 'operator-1',
      operation_idempotency_key: incoming.operation_idempotency_key,
      before_state: 'blocked_stale_lease',
      after_state: 'recovered',
      before_projection_digest: projection.projection_digest,
      after_projection_digest: digest('9'),
      predicate_summary: projection.candidate_predicate!,
    };

    expect(recoveryRequestMatchesExistingRecord(existing, incoming)).toBe(true);
    expect(recoveryRequestMatchesExistingRecord({ ...existing, reason: 'Different reason.' }, incoming)).toBe(false);
    expect(recoveryRequestMatchesExistingRecord({ ...existing, codex_session_id: 'session-2' }, incoming)).toBe(false);
    expect(recoveryRequestMatchesExistingRecord({ ...existing, operation: 'mark_unrecoverable' }, incoming)).toBe(false);
    expect(recoveryRequestMatchesExistingRecord({ ...existing, result: 'blocked' }, incoming)).toBe(false);
    expect(
      recoveryRequestMatchesExistingRecord(
        {
          ...existing,
          predicate_summary: { ...projection.candidate_predicate!, projection_digest: digest('8') },
        },
        incoming,
      ),
    ).toBe(false);
    expect(() =>
      assertRecoveryIdempotencyNotConflicting({ ...existing, after_state: 'unrecoverable' }, incoming),
    ).toThrow(/session_operations_idempotency_conflict/);
  });

  it('assertRecoveryPredicateStillMatches passes for exact projection and rejects stale candidate state', () => {
    const projection = buildSessionHealthProjection(
      baseInput({
        active_lease: lease({ expires_at: checkedAt }),
      }),
    );
    const predicate = projection.candidate_predicate!;

    expect(() => assertRecoveryPredicateStillMatches(projection, predicate)).not.toThrow();

    for (const stalePredicate of [
      { ...predicate, projection_digest: digest('8') },
      { ...predicate, expected_health_state: 'blocked_orphaned_action' as const },
      { ...predicate, codex_session_id: 'session-2' },
    ]) {
      expect(() => assertRecoveryPredicateStillMatches(projection, stalePredicate)).toThrow(DomainError);
      try {
        assertRecoveryPredicateStillMatches(projection, stalePredicate);
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe('session_operations_stale_candidate');
      }
    }
  });

  it('capsuleDigestPrefix returns safe digest prefixes', () => {
    expect(capsuleDigestPrefix(digest('b'))).toBe('sha256:bbbbbbbbbbbb');
  });
});
