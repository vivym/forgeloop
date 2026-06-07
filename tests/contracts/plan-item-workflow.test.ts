import { describe, expect, it } from 'vitest';
import {
  abandonWorkflowSessionBodySchema,
  codexSessionPublicDtoSchema,
  continueWorkflowExecutionBodySchema,
  internalPlanItemWorkflowTransitionSchema,
  internalWorkflowManualDecisionSchema,
  planItemWorkflowPublicDtoSchema,
  planItemWorkflowQueuedActionSchema,
  planItemWorkflowTransitionSchema,
  requestWorkflowReviewFixBodySchema,
  respondToWorkflowReviewBodySchema,
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
      created_at: '2026-05-31T00:00:00.000Z',
    });

    expect(parsed.evidence_object_type).toBe('execution_readiness_record');
    expect(() =>
      planItemWorkflowTransitionSchema.parse({
        ...parsed,
        codex_session_id: 'codex-session-1',
      }),
    ).toThrow();
    expect(() =>
      planItemWorkflowTransitionSchema.parse({
        ...parsed,
        codex_session_turn_id: 'turn-1',
      }),
    ).toThrow();
  });

  it('keeps raw runtime transition evidence behind internal schemas', () => {
    const parsed = internalPlanItemWorkflowTransitionSchema.parse({
      id: 'transition-1',
      workflow_id: 'workflow-1',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-tech',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-1',
      codex_session_id: 'codex-session-1',
      codex_session_turn_id: 'turn-1',
      created_at: '2026-05-31T00:00:00.000Z',
    });

    expect(parsed.codex_session_id).toBe('codex-session-1');
  });

  it('rejects invalid manual decision kinds and accepts start_brainstorming', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
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
        kind: 'start',
        reason: 'Ambiguous.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts Wave 7 queued action kinds and abandon decision kind', () => {
    for (const kind of ['continue_execution', 'respond_to_review', 'request_fix']) {
      expect(() =>
        planItemWorkflowQueuedActionSchema.parse({
          id: `action-${kind}`,
          workflow_id: 'workflow-1',
          kind,
          status: 'queued',
          context_preview_digest: `sha256:${'1'.repeat(64)}`,
          idempotency_key: `sha256:${'2'.repeat(64)}`,
          created_by_actor_id: 'actor-tech',
          created_at: '2026-06-07T00:00:00.000Z',
          updated_at: '2026-06-07T00:00:00.000Z',
        }),
      ).not.toThrow();
    }

    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-abandon',
        workflow_id: 'workflow-1',
        kind: 'abandon_new_session',
        reason: 'The session cannot be resumed safely.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-06-07T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects fork_select from the public manual decision schema', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
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
        kind: 'fork_select',
        reason: 'Use the completed candidate fork.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects selected Codex sessions on non-fork manual decisions', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
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
        kind: 'change_request',
        reason: 'Revise the spec.',
        related_object_type: 'spec_revision',
        related_object_id: 'spec-revision-1',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('keeps raw runtime manual decision evidence behind internal schemas', () => {
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
    ).toThrow();

    const parsed = internalWorkflowManualDecisionSchema.parse({
      id: 'decision-1',
      workflow_id: 'workflow-1',
      codex_session_id: 'codex-session-1',
      kind: 'fork_select',
      reason: 'Use the completed candidate fork.',
      selected_codex_session_id: 'codex-session-2',
      created_by_actor_id: 'actor-tech',
      created_at: '2026-05-31T00:00:00.000Z',
    });

    expect(parsed.selected_codex_session_id).toBe('codex-session-2');
  });

  it('keeps normal public DTOs free of raw runtime internals', () => {
    const workflow = planItemWorkflowPublicDtoSchema.parse({
      id: 'workflow-1',
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      status: 'brainstorming',
      session: {
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
      'id',
    ] as const;
    for (const field of forbiddenSessionFields) {
      expect(workflow.session).not.toHaveProperty(field);
      expect(() =>
        codexSessionPublicDtoSchema.parse({
          status: 'idle',
          role: 'active',
          continuity_state: 'ready',
          can_continue: true,
          [field]: `${field}-value`,
        }),
      ).toThrow();
    }
    expect(
      codexSessionPublicDtoSchema.parse({
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
      }),
    ).toEqual({
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
      });
  });

  it('rejects raw capsule refs in public Codex session DTOs', () => {
    expect(
      codexSessionPublicDtoSchema.safeParse({
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
        latest_capsule_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
      }).success,
    ).toBe(false);
  });

  it('accepts Wave 7 public projection fields and rejects raw runtime refs', () => {
    const workflow = planItemWorkflowPublicDtoSchema.parse({
      id: 'workflow-1',
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      status: 'code_review',
      session: {
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
      },
      attempt_history: [
        {
          run_session_id: 'run-1',
          attempt_kind: 'first_execution',
          status: 'succeeded',
          continuation_events: [
            {
              queued_action_id: 'action-continue-1',
              continuation_kind: 'relaunch_after_fencing',
              created_at: '2026-06-07T00:01:00.000Z',
            },
          ],
          created_at: '2026-06-07T00:00:00.000Z',
          updated_at: '2026-06-07T00:02:00.000Z',
        },
      ],
      latest_review_response: {
        id: 'review-response-1',
        review_packet_id: 'review-packet-1',
        previous_run_session_id: 'run-1',
        status: 'succeeded',
        created_at: '2026-06-07T00:03:00.000Z',
      },
      recovery_options: [
        {
          action_id: 'continue_same_session',
          enabled: false,
          blocker_code: 'workflow_execution_writer_still_active',
          warning_copy: 'The current writer can still terminalize.',
          required_confirmation_kind: 'none',
        },
      ],
      created_at: '2026-06-07T00:00:00.000Z',
      updated_at: '2026-06-07T00:03:00.000Z',
    });

    expect(workflow.attempt_history).toHaveLength(1);
    expect(workflow.latest_review_response?.review_packet_id).toBe('review-packet-1');
    for (const field of [
      'codex_thread_id',
      'latest_capsule_ref',
      'latest_memory_bundle_ref',
      'local_path',
      'worker_id',
      'lease_token',
    ]) {
      expect(() =>
        planItemWorkflowPublicDtoSchema.parse({
          ...workflow,
          attempt_history: [{ ...workflow.attempt_history[0], [field]: `${field}-value` }],
        }),
      ).toThrow();
    }
  });

  it('validates Wave 7 command bodies without raw runtime refs', () => {
    expect(
      continueWorkflowExecutionBodySchema.parse({
        actor_id: 'actor-tech',
        idempotency_key: 'continue-1',
        input_markdown: 'Continue from the latest safe capsule.',
        cancel_recovery_decision: 'recover_instead_of_accept_cancel',
        cancel_recovery_confirmation_phrase: 'recover cancelled execution',
      }).cancel_recovery_decision,
    ).toBe('recover_instead_of_accept_cancel');
    expect(() =>
      continueWorkflowExecutionBodySchema.parse({
        actor_id: 'actor-tech',
        idempotency_key: 'continue-1',
        codex_thread_id: 'thread-raw',
      }),
    ).toThrow();

    expect(
      respondToWorkflowReviewBodySchema.parse({
        actor_id: 'actor-tech',
        expected_review_packet_id: 'review-packet-1',
        expected_review_packet_digest: `sha256:${'a'.repeat(64)}`,
      }).expected_review_packet_id,
    ).toBe('review-packet-1');
    expect(() =>
      respondToWorkflowReviewBodySchema.parse({
        actor_id: 'actor-tech',
        expected_review_packet_id: 'review-packet-1',
        expected_review_packet_digest: `sha256:${'a'.repeat(64)}`,
        action_run_id: 'legacy-action-run',
      }),
    ).toThrow();

    expect(
      requestWorkflowReviewFixBodySchema.parse({
        actor_id: 'actor-tech',
        expected_review_packet_id: 'review-packet-1',
        expected_review_packet_digest: `sha256:${'b'.repeat(64)}`,
      }).expected_review_packet_digest,
    ).toBe(`sha256:${'b'.repeat(64)}`);
    expect(() =>
      requestWorkflowReviewFixBodySchema.parse({
        actor_id: 'actor-tech',
        expected_review_packet_id: 'review-packet-1',
        expected_review_packet_digest: `sha256:${'b'.repeat(64)}`,
        worker_id: 'worker-raw',
      }),
    ).toThrow();

    expect(
      abandonWorkflowSessionBodySchema.parse({
        actor_id: 'actor-tech',
        next_action: 'code_review',
        confirmation_phrase: 'abandon current session and start new session',
        reason: 'The current session cannot be resumed safely.',
      }).next_action,
    ).toBe('code_review');
    expect(() =>
      abandonWorkflowSessionBodySchema.parse({
        actor_id: 'actor-tech',
        next_action: 'code_review',
        confirmation_phrase: 'abandon current session and start new session',
        reason: 'The current session cannot be resumed safely.',
        lease_token: 'raw-token',
      }),
    ).toThrow();
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
    expect(() =>
      planItemWorkflowQueuedActionSchema.parse({
        ...parsed,
        codex_session_id: 'session-1',
      }),
    ).toThrow();
    expect(() =>
      planItemWorkflowQueuedActionSchema.parse({
        ...parsed,
        codex_session_turn_id: 'turn-1',
      }),
    ).toThrow();
    expect(() =>
      planItemWorkflowQueuedActionSchema.parse({
        ...parsed,
        output_capsule_id: 'capsule-1',
      }),
    ).toThrow();
  });

  it('rejects public workflow DTOs that expose raw runtime internals', () => {
    expect(() =>
      planItemWorkflowPublicDtoSchema.parse({
        id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        status: 'spec_generation_queued',
        session: {
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
    expect(() =>
      planItemWorkflowPublicDtoSchema.parse({
        id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        status: 'spec_generation_queued',
        active_codex_session_id: 'session-1',
        session: {
          status: 'idle',
          role: 'active',
          continuity_state: 'ready',
          can_continue: true,
        },
        queued_actions: [],
        timeline_events: [],
        created_at: '2026-06-03T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
      }),
    ).toThrow();
    expect(() =>
      planItemWorkflowPublicDtoSchema.parse({
        id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        status: 'execution_ready',
        execution_package_id: 'execution-package-internal-boundary',
        session: {
          status: 'idle',
          role: 'active',
          continuity_state: 'ready',
          can_continue: true,
        },
        queued_actions: [],
        timeline_events: [],
        readiness: {
          state: 'ready',
          can_evaluate: false,
          blocker_codes: [],
        },
        created_at: '2026-06-03T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
      }),
    ).toThrow();
    expect(() =>
      planItemWorkflowPublicDtoSchema.parse({
        id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        status: 'execution_running',
        session: {
          status: 'running',
          role: 'active',
          continuity_state: 'running',
          can_continue: false,
        },
        queued_actions: [],
        timeline_events: [],
        execution_run_summary: {
          run_session_id: 'run-session-1',
          execution_package_id: 'execution-package-internal-boundary',
          runtime_job_id: 'runtime-job-internal-boundary',
          codex_session_turn_id: 'turn-internal-boundary',
          status: 'running',
        },
        created_at: '2026-06-03T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
