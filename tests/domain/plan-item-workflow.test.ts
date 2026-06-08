import { describe, expect, it } from 'vitest';
import {
  assertAbandonNewSessionTransitionAllowed,
  assertQueuedActionCanRun,
  assertPlanItemWorkflowTransitionAllowed,
  assertWorkflowManualDecisionAllowedForTransition,
  assertWorkflowMessageAllowed,
  buildPlanItemWorkflowQueuedActionIdempotencyKey,
  codexSessionPublicProjection,
  determineAbandonNewSessionFallback,
  isSameStatusWorkflowEventActionKind,
  mapQueuedActionKindToTurnIntent,
  planItemWorkflowPublicProjection,
  planItemWorkflowStatusValues,
  type CodexRuntimeCapsule,
  type CodexSession,
  type CodexSessionStaleTerminalizationAttempt,
  type CodexSessionTurn,
  type PlanItemWorkflowStatus,
  type WorkflowManualDecision,
} from '@forgeloop/domain';

describe('plan item workflow domain', () => {
  const baseSession = (overrides: Partial<CodexSession> = {}): CodexSession => ({
    id: 'session-1',
    owner_type: 'plan_item_workflow',
    owner_id: 'workflow-1',
    status: 'idle',
    role: 'active',
    runtime_profile_id: 'profile-1',
    runtime_profile_revision_id: 'profile-revision-1',
    credential_binding_id: 'credential-1',
    credential_binding_version_id: 'credential-version-1',
    lease_epoch: 0,
    created_by_actor_id: 'actor-tech',
    created_at: '2026-05-31T00:00:00.000Z',
    updated_at: '2026-05-31T00:00:00.000Z',
    ...overrides,
  });

  const baseDecision = (overrides: Partial<WorkflowManualDecision> = {}): WorkflowManualDecision => ({
    id: 'decision-1',
    workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
    kind: 'change_request',
    reason: 'Revise the scope.',
    created_by_actor_id: 'actor-tech',
    created_at: '2026-05-31T00:00:00.000Z',
    ...overrides,
  });

  it('accepts only allowed transition/evidence combinations', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'not_started',
        to_status: 'brainstorming',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'start_brainstorming',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'not_started',
        to_status: 'brainstorming',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'override',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('requires fork_select decisions for same-status active-session replacement', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'spec_review',
        to_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'fork_select',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'blocked',
        to_status: 'blocked',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'fork_select',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'spec_review',
        to_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'override',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('recovers blocked workflows only to the recorded previous safe status', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'blocked',
        to_status: 'spec_review',
        previous_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'recover',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'blocked',
        to_status: 'execution_ready',
        previous_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'recover',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('rejects terminal workflow mutations', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'archived',
        to_status: 'blocked',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'block',
      }),
    ).toThrow(/workflow_invalid_transition/);

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'archived',
        to_status: 'archived',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'fork_select',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('validates manual decision kinds against transition intent', () => {
    const decision = baseDecision({
      related_object_type: 'spec_revision',
      related_object_id: 'spec-revision-1',
    });

    expect(() =>
      assertWorkflowManualDecisionAllowedForTransition(decision, {
        from_status: 'spec_review',
        to_status: 'spec_generation_queued',
      }),
    ).not.toThrow();
  });

  it('enforces manual decision payload invariants for direct domain objects', () => {
    expect(() =>
      assertWorkflowManualDecisionAllowedForTransition(baseDecision({ kind: 'fork_select' }), {
        from_status: 'spec_review',
        to_status: 'spec_review',
      }),
    ).toThrow(/workflow_invalid_transition/);

    expect(() =>
      assertWorkflowManualDecisionAllowedForTransition(
        baseDecision({ kind: 'change_request', selected_codex_session_id: 'session-2' }),
        {
          from_status: 'spec_review',
          to_status: 'spec_generation_queued',
        },
      ),
    ).toThrow(/workflow_invalid_transition/);

    expect(() =>
      assertWorkflowManualDecisionAllowedForTransition(baseDecision({ related_object_type: 'spec_revision' }), {
        from_status: 'spec_review',
        to_status: 'spec_generation_queued',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('does not project raw runtime internals into public session DTOs', () => {
    const session = {
      id: 'session-1',
      owner_type: 'plan_item_workflow',
      owner_id: 'workflow-1',
      status: 'idle',
      role: 'active',
      codex_thread_id_digest: `sha256:${'a'.repeat(64)}`,
      latest_capsule_id: 'capsule-1',
      latest_capsule_digest: `sha256:${'b'.repeat(64)}`,
      base_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-base',
      base_memory_bundle_digest: `sha256:${'c'.repeat(64)}`,
      latest_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
      latest_memory_bundle_digest: `sha256:${'d'.repeat(64)}`,
      latest_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
      latest_environment_manifest_digest: `sha256:${'e'.repeat(64)}`,
      latest_turn_id: 'turn-1',
      latest_turn_digest: `sha256:${'f'.repeat(64)}`,
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      lease_epoch: 0,
      created_by_actor_id: 'actor-1',
      created_at: '2026-06-02T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
    } satisfies CodexSession;
    const turn = {
      id: 'turn-1',
      codex_session_id: 'session-1',
      workflow_id: 'workflow-1',
      intent: 'draft_spec_doc',
      status: 'succeeded',
      input_digest: `sha256:${'0'.repeat(64)}`,
      expected_input_capsule_digest: `sha256:${'b'.repeat(64)}`,
      input_capsule_id: 'capsule-1',
      input_capsule_digest: `sha256:${'b'.repeat(64)}`,
      output_capsule_id: 'capsule-2',
      output_capsule_digest: `sha256:${'9'.repeat(64)}`,
      input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
      output_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-2',
      input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
      output_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-2',
      created_by_actor_id: 'actor-1',
      created_at: '2026-06-02T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
    } satisfies CodexSessionTurn;
    const capsule = {
      id: 'capsule-2',
      codex_session_id: 'session-1',
      created_from_turn_id: 'turn-1',
      sequence: 2,
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
      digest: `sha256:${'9'.repeat(64)}`,
      size_bytes: '1024',
      manifest_digest: `sha256:${'1'.repeat(64)}`,
      thread_state_digest: `sha256:${'2'.repeat(64)}`,
      memory_state_digest: `sha256:${'3'.repeat(64)}`,
      environment_manifest_digest: `sha256:${'4'.repeat(64)}`,
      codex_thread_id_digest: `sha256:${'a'.repeat(64)}`,
      codex_cli_version: 'codex-cli 0.132.0',
      app_server_protocol_digest: `sha256:${'5'.repeat(64)}`,
      runtime_profile_revision_id: 'profile-revision-1',
      trusted_runtime_manifest_digest: `sha256:${'6'.repeat(64)}`,
      credential_binding_lineage_digest: `sha256:${'7'.repeat(64)}`,
      created_by_actor_id: 'actor-1',
      created_at: '2026-06-02T00:00:00.000Z',
    } satisfies CodexRuntimeCapsule;
    const staleAttempt = {
      id: 'stale-attempt-1',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'turn-1',
      worker_id: 'worker-1',
      worker_session_digest: `sha256:${'8'.repeat(64)}`,
      expected_input_capsule_digest: `sha256:${'b'.repeat(64)}`,
      attempted_output_capsule_digest: `sha256:${'9'.repeat(64)}`,
      attempted_codex_thread_id_digest: `sha256:${'a'.repeat(64)}`,
      failure_code: 'stale_capsule',
      created_at: '2026-06-02T00:00:00.000Z',
    } satisfies CodexSessionStaleTerminalizationAttempt;

    expect(session.latest_capsule_digest).toMatch(/^sha256:/);
    expect(turn.output_capsule_digest).toBe(capsule.digest);
    expect(staleAttempt.attempted_output_capsule_digest).toBe(capsule.digest);
    expect('latest_capture_digest' in session).toBe(false);

    expect(
      codexSessionPublicProjection(
        {
          ...session,
          codex_thread_id: 'raw-thread',
        },
      ),
    ).toEqual({
      status: 'idle',
      role: 'active',
      continuity_state: 'ready',
      can_continue: true,
      last_turn_at: '2026-06-02T00:00:00.000Z',
    });
  });

  it.each([
    ['starting', 'running', false],
    ['recovering', 'running', false],
    ['archived', 'stale', false],
  ] as const)('projects %s sessions as %s and not continuable', (status, continuityState, canContinue) => {
    expect(codexSessionPublicProjection(baseSession({ status }))).toMatchObject({
      status,
      continuity_state: continuityState,
      can_continue: canContinue,
    });
  });

  it('exports the expected status set', () => {
    expect(planItemWorkflowStatusValues satisfies readonly PlanItemWorkflowStatus[]).toContain('implementation_plan_review');
  });

  it('maps Wave 5 queued action kinds to Codex turn intents', () => {
    expect(mapQueuedActionKindToTurnIntent('continue_brainstorming')).toBe('continue_brainstorming');
    expect(mapQueuedActionKindToTurnIntent('generate_boundary_summary')).toBe('draft_boundary_summary');
    expect(mapQueuedActionKindToTurnIntent('generate_spec_doc')).toBe('draft_spec_doc');
    expect(mapQueuedActionKindToTurnIntent('generate_implementation_plan_doc')).toBe('draft_implementation_plan_doc');
  });

  it('maps Wave 7 queued action kinds to Codex turn intents', () => {
    expect(mapQueuedActionKindToTurnIntent('continue_execution')).toBe('continue_execution');
    expect(mapQueuedActionKindToTurnIntent('respond_to_review')).toBe('address_review_feedback');
    expect(mapQueuedActionKindToTurnIntent('request_fix')).toBe('fix_review_feedback');
    expect(isSameStatusWorkflowEventActionKind('continue_execution')).toBe(true);
    expect(isSameStatusWorkflowEventActionKind('respond_to_review')).toBe(true);
    expect(isSameStatusWorkflowEventActionKind('request_fix')).toBe(false);
  });

  it('does not allow same-status review actions through workflow transitions', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'code_review',
        to_status: 'code_review',
        evidence_object_type: 'review_response',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('allows abandon_new_session only from blocked to deterministic fallback targets', () => {
    expect(() =>
      assertAbandonNewSessionTransitionAllowed({
        from_status: 'blocked',
        to_status: 'code_review',
        manual_decision_kind: 'abandon_new_session',
      }),
    ).not.toThrow();
    expect(() =>
      assertAbandonNewSessionTransitionAllowed({
        from_status: 'code_review',
        to_status: 'code_review',
        manual_decision_kind: 'abandon_new_session',
      }),
    ).toThrow(/workflow_invalid_transition/);
    expect(() =>
      assertAbandonNewSessionTransitionAllowed({
        from_status: 'blocked',
        to_status: 'archived',
        manual_decision_kind: 'abandon_new_session',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it.each([
    [
      'current Review Packet',
      { has_current_review_packet: true },
      { target_status: 'code_review', expected_next_action: 'review_current_packet' },
    ],
    [
      'valid readiness',
      { has_valid_execution_readiness: true },
      { target_status: 'execution_ready', expected_next_action: 'start_execution' },
    ],
    [
      'unapproved Implementation Plan Doc',
      { has_unapproved_implementation_plan_doc: true },
      { target_status: 'implementation_plan_review', expected_next_action: 'review_implementation_plan' },
    ],
    [
      'approved Spec Doc only',
      { has_approved_spec_doc: true },
      {
        target_status: 'implementation_plan_generation_queued',
        expected_next_action: 'generate_implementation_plan_doc',
        queued_action_kind: 'generate_implementation_plan_doc',
      },
    ],
    [
      'unapproved Spec Doc',
      { has_unapproved_spec_doc: true },
      { target_status: 'spec_review', expected_next_action: 'review_spec' },
    ],
    [
      'approved Boundary Summary only',
      { has_approved_boundary_summary: true },
      { target_status: 'spec_generation_queued', expected_next_action: 'generate_spec_doc', queued_action_kind: 'generate_spec_doc' },
    ],
    [
      'no Boundary Summary',
      {},
      { target_status: 'brainstorming', expected_next_action: 'continue_brainstorming', queued_action_kind: 'continue_brainstorming' },
    ],
  ] as const)('deterministically maps abandon_new_session fallback for %s', (_label, input, expected) => {
    expect(determineAbandonNewSessionFallback(input)).toEqual(expected);
  });

  it('projects attempt history and recovery options without raw runtime refs', () => {
    const projected = planItemWorkflowPublicProjection({
      workflow: {
        id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        status: 'code_review',
        active_codex_session_id: 'session-1',
        created_at: '2026-06-07T00:00:00.000Z',
        updated_at: '2026-06-07T00:04:00.000Z',
      },
      session: baseSession({
        latest_capsule_id: 'capsule-1',
        latest_capsule_digest: `sha256:${'a'.repeat(64)}`,
        runner_worker_id: 'worker-1',
      }),
      attempt_history: [
        {
          run_session_id: 'run-1',
          attempt_kind: 'review_fix',
          previous_run_session_id: 'run-0',
          previous_review_packet_id: 'review-packet-1',
          status: 'running',
          continuation_events: [],
          created_at: '2026-06-07T00:01:00.000Z',
          updated_at: '2026-06-07T00:02:00.000Z',
        },
      ],
      latest_review_response: {
        id: 'review-response-1',
        review_packet_id: 'review-packet-1',
        previous_run_session_id: 'run-0',
        status: 'succeeded',
        created_at: '2026-06-07T00:03:00.000Z',
      },
      recovery_options: [
        {
          action_id: 'abandon_new_session',
          enabled: false,
          blocker_code: 'workflow_execution_writer_still_active',
          warning_copy: 'The current writer can still terminalize.',
          required_confirmation_kind: 'typed_phrase',
        },
      ],
    });

    expect(projected.attempt_history[0]?.previous_run_session_id).toBe('run-0');
    expect(projected.latest_review_response?.id).toBe('review-response-1');
    expect(projected.recovery_options[0]?.action_id).toBe('abandon_new_session');
    expect(JSON.stringify(projected)).not.toContain('worker-1');
    expect(JSON.stringify(projected)).not.toContain('capsule-1');
    expect(() =>
      planItemWorkflowPublicProjection({
        workflow: {
          id: 'workflow-1',
          development_plan_id: 'plan-1',
          development_plan_item_id: 'item-1',
          status: 'code_review',
          active_codex_session_id: 'session-1',
          created_at: '2026-06-07T00:00:00.000Z',
          updated_at: '2026-06-07T00:04:00.000Z',
        },
        session: baseSession(),
        attempt_history: [
          {
            run_session_id: 'run-1',
            attempt_kind: 'first_execution',
            status: 'succeeded',
            continuation_events: [],
            created_at: '2026-06-07T00:01:00.000Z',
            updated_at: '2026-06-07T00:02:00.000Z',
            codex_thread_id: 'raw-thread',
          } as never,
        ],
      }),
    ).toThrow();
  });

  it('blocks messages while a Codex action is queued or running', () => {
    expect(() =>
      assertWorkflowMessageAllowed({
        action: 'continue_ai',
        workflow_status: 'brainstorming',
        active_codex_session_id: 'session-1',
        active_codex_action_count: 1,
      }),
    ).toThrow(/workflow_action_already_pending/);
  });

  it('limits workflow messages to brainstorming status', () => {
    expect(() =>
      assertWorkflowMessageAllowed({
        action: 'continue_ai',
        workflow_status: 'spec_review',
        active_codex_session_id: 'session-1',
        active_codex_action_count: 0,
      }),
    ).toThrow(/workflow_invalid_message_action/);
  });

  it('requires action/session/digest match before a queued action can run', () => {
    expect(() =>
      assertQueuedActionCanRun({
        action: {
          id: 'action-1',
          workflow_id: 'workflow-1',
          codex_session_id: 'session-1',
          kind: 'generate_spec_doc',
          status: 'queued',
          expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
          context_preview_digest: `sha256:${'b'.repeat(64)}`,
        },
        workflow_id: 'workflow-1',
        active_codex_session_id: 'session-1',
        latest_capsule_digest: `sha256:${'x'.repeat(64)}`,
        context_preview_digest: `sha256:${'b'.repeat(64)}`,
      }),
    ).toThrow(/workflow_capsule_digest_mismatch/);
  });

  it('builds queued action idempotency key from every scoped input', () => {
    const first = buildPlanItemWorkflowQueuedActionIdempotencyKey({
      workflow_id: 'workflow-1',
      kind: 'generate_spec_doc',
      source_revision_id: 'boundary-revision-1',
      context_preview_digest: `sha256:${'b'.repeat(64)}`,
      expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
    });
    const changedSource = buildPlanItemWorkflowQueuedActionIdempotencyKey({
      workflow_id: 'workflow-1',
      kind: 'generate_spec_doc',
      source_revision_id: 'boundary-revision-2',
      context_preview_digest: `sha256:${'b'.repeat(64)}`,
      expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
    });
    const changedCapsule = buildPlanItemWorkflowQueuedActionIdempotencyKey({
      workflow_id: 'workflow-1',
      kind: 'generate_spec_doc',
      source_revision_id: 'boundary-revision-1',
      context_preview_digest: `sha256:${'b'.repeat(64)}`,
      expected_input_capsule_digest: `sha256:${'9'.repeat(64)}`,
    });

    expect(first).not.toBe(changedSource);
    expect(first).not.toBe(changedCapsule);
  });
});
