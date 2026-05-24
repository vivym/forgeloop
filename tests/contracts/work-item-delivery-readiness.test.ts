import { describe, expect, it } from 'vitest';
import {
  deliveryStageIdSchema,
  deliveryStageStateSchema,
  productListItemSchema,
  workItemCockpitResponseSchema,
  workItemDeliveryReadinessSchema,
} from '@forgeloop/contracts';

const action = {
  id: 'open-package',
  lane_id: 'execution-owner',
  priority: 'primary',
  label: 'Open Execution',
  enabled: true,
  kind: 'navigate',
  target: { kind: 'object', object_type: 'execution', object_id: 'exec-1', href: '/executions/exec-1' },
} as const;

const commandAction = {
  id: 'generate-packages',
  lane_id: 'execution-owner',
  priority: 'primary',
  label: 'Start execution',
  enabled: true,
  kind: 'command',
  command: {
    type: 'generate_packages',
    object_type: 'plan_revision',
    object_id: 'plan-r1',
    scope_ref: { type: 'requirement', id: 'wi-1' },
    plan_revision_id: 'plan-r1',
  },
} as const;

const stage = {
  id: 'execution',
  label: 'Execution',
  state: 'passed',
  owner_lane: 'execution-owner',
  object_refs: [{ object_type: 'execution', object_id: 'exec-1', href: '/executions/exec-1' }],
  blockers: [],
  evidence_refs: [],
  primary_action: action,
} as const;

const readiness = {
  scope_ref: { type: 'requirement', id: 'wi-1', title: 'Title' },
  active_lane: 'execution-owner',
  overall_state: 'ready_for_release',
  stages: [stage],
  blockers: [],
  evidence: [],
  next_actions: [action],
  degraded_sources: [],
} as const;

const cockpitResponse = (overrides: Record<string, unknown> = {}) => ({
  item: {
    id: 'wi-1',
    project_id: 'project-1',
    kind: 'requirement',
    title: 'Title',
    goal: 'Goal',
    success_criteria: ['Done'],
    priority: 'high',
    risk: 'medium',
    driver_actor_id: 'actor-1',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Users need a validated delivery cockpit response.',
      desired_outcome: 'The cockpit exposes Work Item driver intake data.',
      acceptance_criteria: ['Cockpit response schema accepts driver and intake context.'],
      in_scope: ['Contract parsing'],
    },
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
  },
  current_spec: null,
  current_plan: null,
  packages: [],
  run_sessions: [],
  review_packets: [],
  delivery_readiness: readiness,
  ...overrides,
});

const cockpitPackage = {
  id: 'pkg-1',
  scope_ref: { type: 'requirement', id: 'wi-1', title: 'Title' },
  spec_id: 'spec-1',
  spec_revision_id: 'spec-r1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-r1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement the package.',
  owner_actor_id: 'actor-1',
  reviewer_actor_id: 'actor-2',
  qa_owner_actor_id: 'actor-3',
  phase: 'execution',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  required_checks: [
    {
      check_id: 'unit',
      display_name: 'Unit tests',
      command: 'pnpm test',
      timeout_seconds: 120,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['packages/contracts/**'],
  forbidden_paths: ['packages/db/**'],
  version: 1,
} as const;

const cockpitSpec = {
  id: 'spec-1',
  scope_ref: { type: 'requirement', id: 'wi-1', title: 'Title' },
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
} as const;

describe('Work Item delivery readiness contracts', () => {
  it('parses all stage ids and states', () => {
    expect(deliveryStageIdSchema.options).toEqual([
      'spec',
      'plan',
      'packages',
      'execution',
      'review',
      'integration_readiness',
      'quality_gate',
      'release_readiness',
    ]);
    expect(deliveryStageStateSchema.options).toContain('not_applicable');
  });

  it('parses readiness and full cockpit responses', () => {
    expect(workItemDeliveryReadinessSchema.parse(readiness)).toEqual(readiness);
    expect(workItemCockpitResponseSchema.parse(cockpitResponse())).toMatchObject({ delivery_readiness: readiness });
    expect(workItemDeliveryReadinessSchema.safeParse({ ...readiness, work_item_id: 'wi-1' }).success).toBe(false);
    expect(workItemCockpitResponseSchema.safeParse({ ...cockpitResponse(), work_item: cockpitResponse().item }).success).toBe(
      false,
    );
  });

  it('rejects cockpit work items when kind does not match intake context type', () => {
    const response = cockpitResponse();

    expect(
      workItemCockpitResponseSchema.safeParse({
        ...response,
        item: {
          ...response.item,
          kind: 'bug',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects inconsistent readiness next actions', () => {
    expect(
      workItemDeliveryReadinessSchema.safeParse({
        ...readiness,
        next_actions: [action, { ...action, label: 'Duplicate action' }],
      }).success,
    ).toBe(false);
    expect(
      workItemDeliveryReadinessSchema.safeParse({
        ...readiness,
        next_actions: [{ ...action, lane_id: 'reviewer' }],
      }).success,
    ).toBe(false);
    expect(
      workItemDeliveryReadinessSchema.safeParse({
        ...readiness,
        next_actions: [commandAction],
      }).success,
    ).toBe(true);
    expect(
      workItemDeliveryReadinessSchema.safeParse({
        ...readiness,
        next_actions: [
          {
            ...commandAction,
            command: { ...commandAction.command, scope_ref: { type: 'requirement', id: 'other-work-item' } },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('preserves review packet AI review and test mapping evidence in cockpit responses', () => {
    const parsed = workItemCockpitResponseSchema.parse(
      cockpitResponse({
        review_packets: [
          {
            id: 'review-1',
            run_session_id: 'run-1',
            execution_package_id: 'pkg-1',
            reviewer_actor_id: 'actor-1',
            status: 'completed',
            decision: 'approved',
            independent_ai_review: {
              status: 'approved',
              summary: 'Independent review passed.',
              run_session_id: 'run-1',
              execution_package_id: 'pkg-1',
              risk_notes: [],
            },
            test_mapping: [{ gate_id: 'regression', result: 'passed', evidence_ref: 'run-check:regression' }],
          },
        ],
      }),
    );

    expect(parsed.review_packets[0]?.independent_ai_review).toMatchObject({
      status: 'approved',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
    });
    expect(parsed.review_packets[0]?.test_mapping).toEqual([
      expect.objectContaining({ gate_id: 'regression', result: 'passed' }),
    ]);
  });

  it('rejects the old public next_actions array on cockpit responses', () => {
    const result = workItemCockpitResponseSchema.safeParse(
      cockpitResponse({
        next_actions: ['run_ready_packages'],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects unsafe public artifact refs in cockpit run evidence', () => {
    const localRefArtifact = {
      kind: 'execution_summary',
      name: 'Summary',
      content_type: 'text/markdown',
      local_ref: 'artifacts/run-1/summary.md',
    };
    const unsafeStorageArtifact = {
      kind: 'check_output',
      name: 'stdout',
      content_type: 'text/plain',
      storage_uri: 'file:///tmp/run-1/stdout.txt',
    };
    const runSession = {
      id: 'run-1',
      execution_package_id: 'pkg-1',
      requested_by_actor_id: 'actor-1',
      status: 'succeeded',
    };
    const checkResult = {
      check_id: 'unit',
      command: 'pnpm test',
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 1,
      blocks_review: true,
      stdout: unsafeStorageArtifact,
    };

    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ run_sessions: [{ ...runSession, artifacts: [localRefArtifact] }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ run_sessions: [{ ...runSession, check_results: [checkResult] }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse({
        ...cockpitResponse(),
        run_sessions: [{ ...runSession, log_refs: [localRefArtifact] }],
      }).success,
    ).toBe(false);
  });

  it('rejects unsafe public artifact refs in readiness evidence check results', () => {
    const checkResult = {
      check_id: 'unit',
      command: 'pnpm test',
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 1,
      blocks_review: true,
      stdout: {
        kind: 'check_output',
        name: 'stdout',
        content_type: 'text/plain',
        local_ref: 'artifacts/run-1/stdout.txt',
      },
    };
    expect(
      workItemDeliveryReadinessSchema.safeParse({
        ...readiness,
        evidence: [{ id: 'evidence-1', label: 'Unit output', check_result: checkResult }],
      }).success,
    ).toBe(false);
    expect(
      workItemDeliveryReadinessSchema.safeParse({
        ...readiness,
        evidence: [
          {
            id: 'evidence-1',
            label: 'Unit output',
            check_result: {
              ...checkResult,
              stdout: {
                kind: 'check_output',
                name: 'stdout',
                content_type: 'text/plain',
                storage_uri: 'file:///tmp/run-1/stdout.txt',
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown cockpit check result statuses', () => {
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({
          run_sessions: [
            {
              id: 'run-1',
              execution_package_id: 'pkg-1',
              requested_by_actor_id: 'actor-1',
              status: 'succeeded',
              check_results: [
                {
                  check_id: 'unit',
                  command: 'pnpm test',
                  status: 'passed',
                  exit_code: 0,
                  duration_seconds: 1,
                  blocks_review: true,
                },
              ],
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects unknown cockpit review packet status and decision values', () => {
    const reviewPacket = {
      id: 'review-1',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
      reviewer_actor_id: 'actor-1',
      status: 'ready',
      decision: 'none',
    };

    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ review_packets: [{ ...reviewPacket, status: 'waiting_for_review' }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ review_packets: [{ ...reviewPacket, decision: 'ship_it' }] }),
      ).success,
    ).toBe(false);
  });

  it('rejects unknown fields on nested cockpit child objects', () => {
    const runSession = {
      id: 'run-1',
      execution_package_id: 'pkg-1',
      requested_by_actor_id: 'actor-1',
      status: 'succeeded',
    };
    const reviewPacket = {
      id: 'review-1',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
      reviewer_actor_id: 'actor-1',
      status: 'ready',
      decision: 'none',
    };

    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ run_sessions: [{ ...runSession, executor_result: { raw: true } }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ run_sessions: [{ ...runSession, run_spec: { raw: true } }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ review_packets: [{ ...reviewPacket, internal_payload: { raw: true } }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ packages: [{ ...cockpitPackage, internal_payload: { raw: true } }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ current_spec: { ...cockpitSpec, internal_payload: { raw: true } } }),
      ).success,
    ).toBe(false);
  });

  it('rejects non-public cockpit run runtime metadata fields', () => {
    const runSession = {
      id: 'run-1',
      execution_package_id: 'pkg-1',
      requested_by_actor_id: 'actor-1',
      status: 'succeeded',
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        last_event_at: '2026-05-20T00:00:01.000Z',
        recovery_attempt_count: 0,
      },
    };

    expect(workItemCockpitResponseSchema.parse(cockpitResponse({ run_sessions: [runSession] })).run_sessions[0]).toMatchObject({
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        last_event_at: '2026-05-20T00:00:01.000Z',
        recovery_attempt_count: 0,
      },
    });

    for (const [field, value] of [
      ['worker_id', 'worker-1'],
      ['worker_lease_status', 'active'],
      ['worker_lease_heartbeat_at', '2026-05-20T00:00:00.000Z'],
      ['worker_lease_expires_at', '2026-05-20T00:05:00.000Z'],
      ['last_event_cursor', 'cursor-1'],
      ['runtime_profile_id', 'profile-1'],
      ['runtime_profile_revision_id', 'profile-revision-1'],
      ['credential_binding_id', 'credential-binding-1'],
      ['credential_binding_version_id', 'credential-version-1'],
      ['launch_lease_id', 'lease-1'],
      ['workspace_path', '/tmp/workspace'],
      ['source_repo_path', '/tmp/repo'],
      ['codex_config_toml', 'approval_policy = "never"'],
      ['active_turn_id', 'turn-1'],
      ['effective_dangerous_mode', 'confirmed'],
    ] as const) {
      expect(
        workItemCockpitResponseSchema.safeParse(
          cockpitResponse({
            run_sessions: [
              {
                ...runSession,
                runtime_metadata: { ...runSession.runtime_metadata, [field]: value },
              },
            ],
          }),
        ).success,
      ).toBe(false);
    }
  });

  it('rejects unknown fields inside cockpit nested evidence arrays and review objects', () => {
    const changedFile = {
      repo_id: 'forgeloop',
      path: 'packages/contracts/src/work-item-delivery-readiness.ts',
      change_kind: 'modified',
    };
    const selfReview = {
      status: 'succeeded',
      summary: 'Checks passed.',
      spec_plan_alignment: 'Aligned',
      test_assessment: 'Contract tests cover the boundary.',
      risk_notes: [],
      follow_up_questions: [],
    };
    const requestedChange = {
      title: 'Tighten nested schema',
      description: 'Reject internal fields in public cockpit review payloads.',
      severity: 'major',
    };
    const runSession = {
      id: 'run-1',
      execution_package_id: 'pkg-1',
      requested_by_actor_id: 'actor-1',
      status: 'succeeded',
      changed_files: [changedFile],
    };
    const reviewPacket = {
      id: 'review-1',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
      reviewer_actor_id: 'actor-1',
      status: 'ready',
      decision: 'none',
      changed_files: [changedFile],
      self_review: selfReview,
      requested_changes: [requestedChange],
    };

    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ run_sessions: [{ ...runSession, changed_files: [{ ...changedFile, internal_diff: true }] }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({
          review_packets: [{ ...reviewPacket, changed_files: [{ ...changedFile, internal_diff: true }] }],
        }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({ review_packets: [{ ...reviewPacket, self_review: { ...selfReview, raw_prompt: 'hidden' } }] }),
      ).success,
    ).toBe(false);
    expect(
      workItemCockpitResponseSchema.safeParse(
        cockpitResponse({
          review_packets: [{ ...reviewPacket, requested_changes: [{ ...requestedChange, internal_thread_id: 'thread-1' }] }],
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts only known degraded source keys', () => {
    expect(
      workItemDeliveryReadinessSchema.parse({ ...readiness, degraded_sources: ['run_sessions'] }).degraded_sources,
    ).toEqual(['run_sessions']);
    expect(workItemDeliveryReadinessSchema.safeParse({ ...readiness, degraded_sources: ['unknown_source'] }).success).toBe(
      false,
    );
  });

  it('rejects raw package list state from public product list items', () => {
    expect(
      productListItemSchema.safeParse({
        id: 'pkg-1',
        object: { type: 'execution', id: 'exec-1', title: 'Execution 1' },
        title: 'Execution 1',
        package_state: {
          scope_ref: { type: 'requirement', id: 'wi-1' },
          spec_revision_id: 'spec-r1',
          plan_revision_id: 'plan-r1',
          current_run_session_id: 'run-1',
          current_review_packet_id: 'review-1',
          integration_readiness: { status: 'ready' },
          required_test_gates: [{ gate_id: 'regression' }],
        },
        counts: {},
        updated_at: '2026-05-20T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
