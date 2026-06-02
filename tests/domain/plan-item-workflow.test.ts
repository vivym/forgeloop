import { describe, expect, it } from 'vitest';
import {
  assertPlanItemWorkflowTransitionAllowed,
  assertWorkflowManualDecisionAllowedForTransition,
  codexSessionPublicProjection,
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
    const obsoleteLatestDigestField = ['latest', 'snap', 'shot', 'digest'].join('_');
    expect(obsoleteLatestDigestField in session).toBe(false);

    expect(
      codexSessionPublicProjection(
        {
          ...session,
          codex_thread_id: 'raw-thread',
        },
      ),
    ).toEqual({
      id: 'session-1',
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
});
