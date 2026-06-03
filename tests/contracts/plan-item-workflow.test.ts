import { describe, expect, it } from 'vitest';
import {
  codexSessionPublicDtoSchema,
  planItemWorkflowPublicDtoSchema,
  planItemWorkflowQueuedActionSchema,
  planItemWorkflowTransitionSchema,
  workflowMessageCommandSchema,
  workflowManualDecisionSchema,
} from '@forgeloop/contracts';

describe('plan item workflow contracts', () => {
  it('validates transition evidence with supporting evidence', () => {
    const parsed = planItemWorkflowTransitionSchema.parse({
      id: 'transition-1',
      workflow_id: 'workflow-1',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-tech',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-1',
      supporting_evidence: [
        {
          object_type: 'implementation_plan_revision',
          object_id: 'plan-revision-1',
        },
      ],
      codex_session_id: 'codex-session-1',
      created_at: '2026-05-31T00:00:00.000Z',
    });

    expect(parsed.evidence_object_type).toBe('execution_readiness_record');
  });

  it('rejects invalid manual decision kinds and accepts start_brainstorming', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'start_brainstorming',
        reason: 'Start Superpowers workflow.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).not.toThrow();

    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-2',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'start',
        reason: 'Ambiguous.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('requires fork_select manual decisions to select a Codex session', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'fork_select',
        reason: 'Use the completed candidate fork.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();

    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-2',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'fork_select',
        reason: 'Use the completed candidate fork.',
        selected_codex_session_id: 'codex-session-2',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects selected Codex sessions on non-fork manual decisions', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'change_request',
        reason: 'Revise the spec.',
        selected_codex_session_id: 'codex-session-2',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('requires related manual decision object fields to be paired', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'change_request',
        reason: 'Revise the spec.',
        related_object_type: 'spec_revision',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();

    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-2',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'change_request',
        reason: 'Revise the spec.',
        related_object_id: 'spec-revision-1',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();

    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-3',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'change_request',
        reason: 'Revise the spec.',
        related_object_type: 'spec_revision',
        related_object_id: 'spec-revision-1',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('keeps normal public DTOs free of raw runtime internals', () => {
    const workflow = planItemWorkflowPublicDtoSchema.parse({
      id: 'workflow-1',
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      status: 'brainstorming',
      active_codex_session_id: 'codex-session-1',
      session: {
        id: 'codex-session-1',
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
        last_turn_at: '2026-05-31T00:00:00.000Z',
      },
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    expect(workflow.session).toMatchObject({ continuity_state: 'ready' });
    const forbiddenSessionFields = [
      'codex_thread_id',
      'runner_worker_id',
      'runner_launch_lease_id',
      'runner_runtime_job_id',
      'runner_expires_at',
      'latest_capsule_ref',
    ] as const;
    for (const field of forbiddenSessionFields) {
      expect(workflow.session).not.toHaveProperty(field);
      expect(() =>
        codexSessionPublicDtoSchema.parse({
          id: 'codex-session-1',
          status: 'idle',
          role: 'active',
          continuity_state: 'ready',
          can_continue: true,
          [field]: `${field}-value`,
        }),
      ).toThrow();
    }
    expect(codexSessionPublicDtoSchema.parse({
        id: 'codex-session-1',
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
      })).toEqual({
        id: 'codex-session-1',
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
      });
  });

  it('rejects raw capsule refs in public Codex session DTOs', () => {
    expect(
      codexSessionPublicDtoSchema.safeParse({
        id: 'session-1',
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
        latest_capsule_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
      }).success,
    ).toBe(false);
  });

  it('validates only Wave 5 message actions', () => {
    expect(
      workflowMessageCommandSchema.parse({
        actor_id: 'actor-tech',
        action: 'answer_boundary_question',
        body_markdown: 'The boundary is API only.',
      }).action,
    ).toBe('answer_boundary_question');

    expect(() =>
      workflowMessageCommandSchema.parse({
        actor_id: 'actor-tech',
        action: 'generate_spec_doc',
        body_markdown: 'Generate the spec.',
      }),
    ).toThrow();
  });

  it('validates queued action public shape without raw runtime refs', () => {
    const parsed = planItemWorkflowQueuedActionSchema.parse({
      id: 'action-1',
      workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      kind: 'generate_spec_doc',
      status: 'queued',
      source_revision_id: 'boundary-revision-1',
      expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
      context_preview_digest: `sha256:${'b'.repeat(64)}`,
      idempotency_key: `sha256:${'c'.repeat(64)}`,
      created_by_actor_id: 'actor-tech',
      created_at: '2026-06-03T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    });

    expect(parsed.kind).toBe('generate_spec_doc');
    expect(JSON.stringify(parsed)).not.toContain('codex_thread_id');
    expect(JSON.stringify(parsed)).not.toContain('artifact_ref');
  });

  it('rejects public workflow DTOs that expose raw runtime internals', () => {
    expect(() =>
      planItemWorkflowPublicDtoSchema.parse({
        id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        status: 'spec_generation_queued',
        active_codex_session_id: 'session-1',
        session: {
          id: 'session-1',
          status: 'idle',
          role: 'active',
          continuity_state: 'ready',
          can_continue: true,
          codex_thread_id: 'raw-thread-id',
        },
        queued_actions: [],
        timeline_events: [],
        created_at: '2026-06-03T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
