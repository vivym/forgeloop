import { describe, expect, it } from 'vitest';
import {
  assertPlanItemWorkflowTransitionAllowed,
  assertWorkflowManualDecisionAllowedForTransition,
  codexSessionPublicProjection,
  planItemWorkflowStatusValues,
  type CodexSession,
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
    expect(
      codexSessionPublicProjection(
        baseSession({
          codex_thread_id: 'raw-thread',
          codex_thread_id_digest: 'sha256:abc',
          latest_snapshot_id: 'snapshot-1',
          latest_snapshot_digest: 'sha256:def',
        }),
      ),
    ).toEqual({
      id: 'session-1',
      status: 'idle',
      role: 'active',
      continuity_state: 'ready',
      can_continue: true,
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
