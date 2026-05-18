import { describe, expect, it } from 'vitest';

import {
  changedFileSchema,
  checkResultSchema,
  commandInventoryResponseSchema,
  closeReleaseRequestSchema,
  createReleaseEvidenceRequestSchema,
  createReleaseRequestSchema,
  evidenceChainResponseSchema,
  executorResultSchema,
  failureKindSchema,
  approveReviewPacketRequestSchema,
  linkReleaseObjectResponseSchema,
  overrideApproveReleaseRequestSchema,
  patchReleaseRequestSchema,
  releaseBlockerSnapshotSchema,
  releaseActorCommandRequestSchema,
  releaseControlResponseSchema,
  releaseEvidenceSchema,
  releaseSchema,
  forceRerunPackageRequestSchema,
  forceRerunPackageResponseSchema,
  approveReleaseRequestSchema,
  requestReviewChangesRequestSchema,
  rerunPackageRequestSchema,
  rerunPackageResponseSchema,
  linkReleaseObjectRequestSchema,
  publicReleaseSummarySchema,
  releaseBlockerCodes,
  reviewPacketDecisions,
  reviewDecisionPayloadSchema,
  runPackageRequestSchema,
  runPackageResponseSchema,
  runSpecSchema,
  selfReviewResultSchema,
  releaseCockpitResponseSchema,
  releaseListQuerySchema,
  releaseListResponseSchema,
  releaseResourceQuerySchema,
  releaseResourceResponseSchema,
  requestReleaseChangesRequestSchema,
  startReleaseObservingRequestSchema,
  submitReleaseForApprovalRequestSchema,
  submitReviewDecisionResponseSchema,
  unlinkReleaseObjectRequestSchema,
} from '@forgeloop/contracts';

describe('delivery loop contracts', () => {
  it('exports normalized review packet decisions', () => {
    expect(reviewPacketDecisions).toEqual([
      'none',
      'approved',
      'changes_requested',
      'need_more_context',
      'escalate',
    ]);
  });

  const validArtifactRef = {
    kind: 'execution_summary',
    name: 'summary',
    content_type: 'text/markdown',
    local_ref: 'artifacts/run-session/summary.md',
  };

  const validCheckResult = {
    check_id: 'contracts-test',
    command: 'pnpm test tests/contracts',
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 12.4,
    blocks_review: true,
  };

  const validExecutorResult = {
    run_session_id: 'run-session-1',
    executor_type: 'local_codex',
    executor_version: '0.1.0',
    status: 'succeeded',
    started_at: '2026-05-05T01:00:00.000Z',
    finished_at: '2026-05-05T01:02:00.000Z',
    summary: 'Execution succeeded.',
    changed_files: [],
    checks: [validCheckResult],
    artifacts: [validArtifactRef],
  };

  const validRequestedChange = {
    title: 'Add rerun DTO',
    description: 'Expose a contract for rerunning a package with requested changes context.',
    file_path: 'packages/contracts/src/api.ts',
    severity: 'major',
    suggested_validation: 'pnpm test tests/contracts',
  };

  const validReviewDecisionPayload = {
    review_packet_id: 'review-packet-1',
    decision: 'approved',
    summary: 'The contracts are ready for the next delivery loop stage.',
    requested_changes: [],
    reviewed_by_actor_id: 'actor-1',
    reviewed_at: '2026-05-05T02:00:00.000Z',
  };

  const validSubmitReviewDecisionResponse = {
    review_packet_id: 'review-packet-1',
    status: 'completed',
    decision: 'approved',
    recorded_at: '2026-05-05T02:01:00.000Z',
  };

  const validCommandInventory = {
    commands: [
      {
        command: 'run_package',
        method: 'POST',
        path: '/execution-packages/:packageId/run',
        description: 'Run an execution package.',
      },
      {
        command: 'rerun_package',
        method: 'POST',
        path: '/execution-packages/:packageId/rerun',
        description: 'Rerun an execution package with review context.',
      },
      {
        command: 'force_rerun_package',
        method: 'POST',
        path: '/execution-packages/:packageId/force-rerun',
        description: 'Force rerun an execution package after manual approval.',
      },
      {
        command: 'approve_review_packet',
        method: 'POST',
        path: '/review-packets/:reviewPacketId/approve',
        description: 'Approve a review packet.',
      },
      {
        command: 'request_review_changes',
        method: 'POST',
        path: '/review-packets/:reviewPacketId/request-changes',
        description: 'Request changes for a review packet.',
      },
    ],
  };

  const validRequiredChecks = [
    {
      check_id: 'contracts-test',
      display_name: 'Contracts tests',
      command: 'pnpm test tests/contracts',
      timeout_seconds: 60,
      blocks_review: true,
    },
  ];

  const validRunSpec = {
    run_session_id: 'run-session-1',
    execution_package_id: 'exec-package-1',
    work_item_id: 'work-item-1',
    spec_revision_id: 'spec-revision-1',
    plan_revision_id: 'plan-revision-1',
    executor_type: 'local_codex',
    repo: {
      repo_id: 'repo-1',
      local_path: '/workspace/repo',
      base_branch: 'main',
      base_commit_sha: '748c32b',
    },
    objective: 'Implement the delivery contracts package.',
    context: {
      spec_revision_summary: 'Thin delivery loop MVP contracts.',
      plan_revision_summary: 'Add Zod schemas and DTO types.',
      package_instructions: 'Keep this package shared-safe.',
      required_checks: validRequiredChecks,
    },
    review_context: {
      latest_decision: 'changes_requested',
      requested_changes: [
        {
          title: 'Clarify artifact refs',
          description: 'Make artifact references explicit enough for review packets.',
          file_path: 'packages/contracts/src/executor.ts',
          severity: 'major',
          suggested_validation: 'pnpm test tests/contracts',
        },
      ],
    },
    allowed_paths: ['packages/contracts/**', 'tests/contracts/**'],
    forbidden_paths: ['apps/**'],
    required_checks: validRequiredChecks,
    artifact_policy: {
      requested_artifacts: ['diff', 'changed_files', 'check_output', 'logs', 'execution_summary'],
    },
    timeout_seconds: 300,
    idempotency_key: 'exec-package-1:run-session-1:748c32b',
  };

  const validReleaseBlockerSnapshot = {
    release_id: 'release-1',
    generated_at: '2026-05-05T00:00:00.000Z',
    blocker_fingerprint: 'release-blockers:v1:abc123',
    blockers: [
      {
        code: 'stale_or_superseded_evidence',
        category: 'evidence',
        overrideable: true,
        message: 'Release evidence is stale.',
      },
    ],
  };

  const publicReleaseSummaryFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'release-1',
    key: 'REL-1',
    org_id: 'org-1',
    project_id: 'project-1',
    title: 'P1 release',
    scope_summary: 'Ship release radar.',
    release_owner_actor_id: 'actor-owner',
    release_type: 'normal',
    phase: 'approval',
    activity_state: 'awaiting_human',
    gate_state: 'awaiting_approval',
    resolution: 'none',
    work_item_ids: [],
    execution_package_ids: [],
    rollout_strategy: 'Deploy behind a flag.',
    rollback_plan: 'Disable the flag.',
    observation_plan: 'Watch error rate.',
    created_by_actor_id: 'actor-owner',
    updated_by_actor_id: 'actor-owner',
    created_at: '2026-05-05T00:00:00.000Z',
    updated_at: '2026-05-05T00:00:00.000Z',
    ...overrides,
  });

  const releaseFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'release-1',
    org_id: 'org-1',
    project_id: 'project-1',
    title: 'P1 release',
    phase: 'approval',
    activity_state: 'awaiting_human',
    gate_state: 'awaiting_approval',
    resolution: 'none',
    work_item_ids: ['work-item-1'],
    execution_package_ids: ['package-1'],
    scope_summary: 'Ship release radar.',
    rollout_strategy: 'Deploy behind a flag.',
    rollback_plan: 'Disable the flag.',
    observation_plan: 'Watch error rate.',
    created_by_actor_id: 'actor-owner',
    created_at: '2026-05-05T00:00:00.000Z',
    updated_at: '2026-05-05T00:00:00.000Z',
    ...overrides,
  });

  it('parses release request and response DTOs', () => {
    expect(
      createReleaseRequestSchema.parse({
        actor_id: 'actor-owner',
        project_id: 'project-1',
        title: 'P1 release',
        scope_summary: 'Ship release radar.',
      }).release_owner_actor_id,
    ).toBe('actor-owner');

    expect(
      createReleaseRequestSchema.safeParse({
        project_id: 'project-1',
        title: 'P1 release',
        created_by_actor_id: 'old-actor',
      }).success,
    ).toBe(false);

    expect(releaseListQuerySchema.parse({ project_id: 'project-1' })).toMatchObject({
      project_id: 'project-1',
      limit: 50,
    });

    expect(
      releaseListQuerySchema.parse({
        project_id: 'project-1',
        release_owner_actor_id: 'actor-owner',
        phase: 'approval',
        gate_state: 'awaiting_approval',
        resolution: 'none',
        limit: 100,
        cursor: 'release-cursor-1',
      }),
    ).toMatchObject({
      project_id: 'project-1',
      release_owner_actor_id: 'actor-owner',
      phase: 'approval',
      gate_state: 'awaiting_approval',
      resolution: 'none',
      limit: 100,
      cursor: 'release-cursor-1',
    });

    expect(
      releaseListQuerySchema.safeParse({
        project_id: 'project-1',
        limit: 101,
      }).success,
    ).toBe(false);

    expect(releaseResourceQuerySchema.parse({ project_id: 'project-1' })).toEqual({ project_id: 'project-1' });

    expect(
      patchReleaseRequestSchema.parse({
        actor_id: 'actor-owner',
        title: 'P1 release candidate',
        rollout_strategy: 'Deploy behind a flag.',
        rollback_plan: 'Disable the flag.',
        observation_plan: 'Watch error rate.',
      }).title,
    ).toBe('P1 release candidate');

    const control = releaseControlResponseSchema.parse({
      release: publicReleaseSummaryFixture({
        work_item_ids: ['work-item-1'],
        execution_package_ids: ['package-1'],
      }),
      blocker_snapshot: {
        ...validReleaseBlockerSnapshot,
        blockers: [
          {
            code: 'missing_rollout_strategy',
            category: 'planning',
            overrideable: true,
            message: 'Release is missing a rollout strategy.',
          },
        ],
      },
      blockers: [],
      overridden_blockers: [],
      decision_intents: [],
      next_actions: [],
    });

    expect(control.release.gate_state).toBe('awaiting_approval');
    expect(control.blocker_snapshot.blockers[0]?.code).toBe('missing_rollout_strategy');

    expect(
      releaseListResponseSchema.parse({
        releases: [
          publicReleaseSummaryFixture({
            work_item_ids: ['work-item-public'],
            execution_package_ids: ['package-public'],
          }),
        ],
        next_cursor: 'release-cursor-2',
      }).next_cursor,
    ).toBe('release-cursor-2');

    expect(
      publicReleaseSummarySchema.parse(
        publicReleaseSummaryFixture({
          work_item_ids: ['work-item-public'],
          execution_package_ids: ['package-public'],
        }),
      ),
    ).toMatchObject({
      work_item_ids: ['work-item-public'],
      execution_package_ids: ['package-public'],
    });

    for (const release_type of ['normal', 'hotfix', 'emergency', 'gray'] as const) {
      expect(
        createReleaseRequestSchema.parse({
          actor_id: 'actor-owner',
          project_id: 'project-1',
          title: `${release_type} release`,
          release_type,
        }).release_type,
      ).toBe(release_type);

      expect(publicReleaseSummarySchema.parse(publicReleaseSummaryFixture({ release_type })).release_type).toBe(
        release_type,
      );

      expect(releaseSchema.parse(releaseFixture({ release_type })).release_type).toBe(release_type);
    }

    expect(
      releaseResourceResponseSchema.parse({
        release: publicReleaseSummaryFixture(),
      }).release.id,
    ).toBe('release-1');

    const cockpit = releaseCockpitResponseSchema.parse({
      release: publicReleaseSummaryFixture({
        id: 'release-cockpit-1',
        work_item_ids: ['work-item-1'],
        execution_package_ids: ['package-1'],
      }),
      work_items: [
        {
          id: 'work-item-1',
          project_id: 'project-1',
          title: 'Release radar work item',
          kind: 'requirement',
          phase: 'done',
          activity_state: 'idle',
          gate_state: 'none',
          resolution: 'completed',
          priority: 'P1',
          risk: 'medium',
        },
      ],
      execution_packages: [
        {
          id: 'package-1',
          work_item_id: 'work-item-1',
          project_id: 'project-1',
          objective: 'Ship release radar.',
          display_title: 'Ship release radar.',
          phase: 'release',
          activity_state: 'idle',
          gate_state: 'release_ready',
          resolution: 'completed',
          integration_readiness_summary: 'Ready for release.',
          required_check_summary: {
            total: 1,
            passed: 1,
            failed: 0,
            missing: 0,
          },
          required_artifact_summary: {
            required: ['execution_summary'],
            present: ['execution_summary'],
            missing: [],
          },
        },
      ],
      latest_run_sessions: [
        {
          id: 'run-session-1',
          execution_package_id: 'package-1',
          status: 'succeeded',
          executor_type: 'local_codex',
          summary: 'Release checks passed.',
          check_results: [
            {
              check_id: 'contracts',
              status: 'succeeded',
              blocks_review: true,
              summary: 'Passed.',
            },
          ],
          artifacts: [
            {
              kind: 'execution_summary',
              name: 'summary',
              content_type: 'text/markdown',
              storage_uri: 's3://release-artifacts/run-session-1/summary.md',
            },
          ],
          created_at: '2026-05-05T00:00:00.000Z',
          updated_at: '2026-05-05T00:00:00.000Z',
          started_at: '2026-05-05T00:00:00.000Z',
          finished_at: '2026-05-05T00:00:00.000Z',
        },
      ],
      current_review_packets: [
        {
          id: 'review-packet-1',
          execution_package_id: 'package-1',
          run_session_id: 'run-session-1',
          status: 'completed',
          decision: 'approved',
          summary: 'Approved.',
          check_result_summary: 'Contracts passed.',
          risk_notes: [],
          created_at: '2026-05-05T00:00:00.000Z',
          updated_at: '2026-05-05T00:00:00.000Z',
          completed_at: '2026-05-05T00:00:00.000Z',
        },
      ],
      evidences: [
        {
          id: 'evidence-1',
          release_id: 'release-cockpit-1',
          evidence_type: 'observation_note',
          summary: 'Observation is healthy.',
          extra: {
            observation: {
              source: 'human',
              severity: 'info',
              summary: 'Healthy.',
              observed_at: '2026-05-05T00:00:00.000Z',
              links: [{ object_type: 'release', object_id: 'release-cockpit-1', relationship: 'observed' }],
            },
          },
          redacted: false,
          status: 'current',
          created_at: '2026-05-05T00:00:00.000Z',
          created_by_actor_id: 'actor-owner',
        },
      ],
      observations: [
        {
          id: 'evidence-1',
          release_id: 'release-cockpit-1',
          evidence_type: 'observation_note',
          summary: 'Observation is healthy.',
          extra: {
            observation: {
              source: 'human',
              severity: 'info',
              summary: 'Healthy.',
              observed_at: '2026-05-05T00:00:00.000Z',
              links: [{ object_type: 'release', object_id: 'release-cockpit-1', relationship: 'observed' }],
            },
          },
          redacted: false,
          status: 'current',
          created_at: '2026-05-05T00:00:00.000Z',
          created_by_actor_id: 'actor-owner',
        },
      ],
      decisions: [
        {
          id: 'decision-1',
          object_type: 'release',
          object_id: 'release-cockpit-1',
          actor_id: 'actor-reviewer',
          decision_type: 'release_approval',
          outcome: 'approved',
          decision: 'approved',
          summary: 'Approved.',
          created_at: '2026-05-05T00:00:00.000Z',
        },
      ],
      blocker_snapshot: validReleaseBlockerSnapshot,
      blockers: [
        {
          code: 'missing_rollback_plan',
          category: 'planning',
          overrideable: true,
          message: 'Release is missing a rollback plan.',
        },
      ],
      overridden_blockers: [],
      risk_summary: {
        structural_blocker_count: 0,
        risk_blocker_count: 0,
        evidence_blocker_count: 0,
        planning_blocker_count: 1,
        redacted_or_stale_evidence_count: 0,
        failed_or_missing_check_count: 0,
        packages_not_ready_count: 0,
        release_can_proceed_without_override: false,
        release_can_proceed_with_override: true,
        release_cannot_proceed: false,
      },
      checklist: [
        {
          id: 'rollback_plan',
          label: 'Rollback plan exists',
          status: 'blocked',
          blocker_codes: ['missing_rollback_plan'],
          summary: 'Add rollback plan.',
        },
      ],
      next_actions: ['Add rollback plan before approval.'],
    });

    expect(cockpit.release.id).toBe('release-cockpit-1');
    expect(cockpit.work_items).toHaveLength(1);
    expect(cockpit.execution_packages).toHaveLength(1);
    expect(cockpit.latest_run_sessions).toHaveLength(1);
    expect(cockpit.current_review_packets).toHaveLength(1);
    expect(cockpit.evidences).toHaveLength(1);
    expect(cockpit.observations).toHaveLength(1);
    expect(cockpit.decisions[0]?.decision_type).toBe('release_approval');
    expect(cockpit.blockers[0]?.code).toBe('missing_rollback_plan');
    expect(cockpit.risk_summary.release_can_proceed_with_override).toBe(true);
    expect(cockpit.checklist[0]?.blocker_codes).toEqual(['missing_rollback_plan']);
    expect(cockpit.next_actions).toEqual(['Add rollback plan before approval.']);

    const latestRunSession = cockpit.latest_run_sessions[0]!;
    const runArtifact = latestRunSession.artifacts[0]!;
    const releaseDecision = cockpit.decisions[0]!;

    expect(
      releaseCockpitResponseSchema.safeParse({
        ...cockpit,
        latest_run_sessions: [
          {
            ...latestRunSession,
            artifacts: [{ ...runArtifact, storage_uri: '/Users/viv/private.log' }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      releaseCockpitResponseSchema.safeParse({
        ...cockpit,
        evidences: [
          {
            ...cockpit.evidences[0]!,
            extra: {
              build: {
                build_id: 'build-1',
                artifact: {
                  kind: 'execution_summary',
                  name: 'leak',
                  content_type: 'text/plain',
                  storage_uri: '/Users/viv/private.log',
                },
              },
            },
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      releaseCockpitResponseSchema.safeParse({
        ...cockpit,
        evidences: [
          {
            ...cockpit.evidences[0]!,
            extra: {
              observation: {
                source: 'script',
                severity: 'warning',
                summary: 'Unsafe metric',
                observed_at: '2026-05-05T00:00:00.000Z',
                metrics: { client_secret: 'hidden' },
              },
            },
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      releaseCockpitResponseSchema.safeParse({
        ...cockpit,
        decisions: [{ ...releaseDecision, object_type: 'work_item' }],
      }).success,
    ).toBe(false);

    expect(
      releaseCockpitResponseSchema.safeParse({
        ...cockpit,
        decisions: [{ ...releaseDecision, decision_type: 'custom_non_release_decision' }],
      }).success,
    ).toBe(false);

    expect(
      releaseCockpitResponseSchema.safeParse({
        ...cockpit,
        decisions: [{ ...releaseDecision, outcome: 'ignored' }],
      }).success,
    ).toBe(false);

    expect(releaseBlockerCodes).toEqual([
      'missing_work_item',
      'missing_execution_package',
      'empty_work_item_scope',
      'empty_execution_package_scope',
      'work_item_not_complete',
      'package_not_release_ready',
      'missing_approved_review_packet',
      'failed_required_check',
      'missing_required_artifact',
      'evidence_redacted',
      'stale_or_superseded_evidence',
      'missing_required_evidence_backlink',
      'unsafe_or_redacted_evidence_backlink',
      'missing_rollout_strategy',
      'missing_rollback_plan',
      'missing_observation_plan',
    ]);

    expect(
      linkReleaseObjectResponseSchema.parse({
        release_id: 'release-1',
        object_type: 'work_item',
        object_id: 'work-item-1',
        linked: true,
      }).linked,
    ).toBe(true);
  });

  it('rejects whitespace-only release product text fields', () => {
    for (const field of ['scope_summary', 'rollout_strategy', 'rollback_plan', 'observation_plan'] as const) {
      expect(
        createReleaseRequestSchema.safeParse({
          actor_id: 'actor-owner',
          project_id: 'project-1',
          title: 'P1 release',
          [field]: '   ',
        }).success,
      ).toBe(false);

      expect(
        patchReleaseRequestSchema.safeParse({
          actor_id: 'actor-owner',
          [field]: '   ',
        }).success,
      ).toBe(false);

      expect(
        publicReleaseSummarySchema.safeParse(
          publicReleaseSummaryFixture({
            [field]: '   ',
          }),
        ).success,
      ).toBe(false);

      expect(
        releaseSchema.safeParse(
          releaseFixture({
            [field]: '   ',
          }),
        ).success,
      ).toBe(false);
    }
  });

  it('parses release command DTOs', () => {
    expect(
      releaseActorCommandRequestSchema.parse({
        actor_id: 'actor-release-manager',
        idempotency_key: 'release-1:submit',
      }).actor_id,
    ).toBe('actor-release-manager');

    expect(
      patchReleaseRequestSchema.safeParse({ actor_id: 'actor-owner' }).success,
    ).toBe(false);
    expect(patchReleaseRequestSchema.parse({ actor_id: 'actor-owner', title: 'Renamed release' }).title).toBe(
      'Renamed release',
    );
    expect(linkReleaseObjectRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
    expect(unlinkReleaseObjectRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
    expect(submitReleaseForApprovalRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
    expect(approveReleaseRequestSchema.parse({ actor_id: 'actor-reviewer' }).actor_id).toBe('actor-reviewer');
    expect(
      requestReleaseChangesRequestSchema.safeParse({
        actor_id: 'actor-reviewer',
        rationale: '',
      }).success,
    ).toBe(false);
    expect(startReleaseObservingRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
    expect(approveReleaseRequestSchema.safeParse({ actor_id: 'actor-reviewer', rationale: '   ' }).success).toBe(
      false,
    );
    expect(
      closeReleaseRequestSchema.safeParse({
        actor_id: 'actor-owner',
        resolution: 'completed',
        override_without_observation: true,
      }).success,
    ).toBe(false);
    expect(typeof createReleaseEvidenceRequestSchema.parse).toBe('function');
    expect(
      linkReleaseObjectResponseSchema.parse({
        release_id: 'release-1',
        object_type: 'work_item',
        object_id: 'work-item-1',
        linked: true,
      }).linked,
    ).toBe(true);

    expect(
      overrideApproveReleaseRequestSchema.parse({
        actor_id: 'actor-release-manager',
        rationale: 'Reviewed risk manually.',
        blocker_snapshot: validReleaseBlockerSnapshot,
      }).blocker_snapshot.blockers[0]?.code,
    ).toBe('stale_or_superseded_evidence');

    expect(
      closeReleaseRequestSchema.parse({
        actor_id: 'actor-release-manager',
        resolution: 'rolled_back',
        summary: 'Rolled back after rollout failed.',
      }).resolution,
    ).toBe('rolled_back');
  });

  it('parses release evidence DTOs', () => {
    const parsed = createReleaseEvidenceRequestSchema.parse({
      actor_id: 'actor-owner',
      evidence_type: 'review_packet',
      summary: 'Approved review packet.',
      object_ref: {
        object_type: 'review_packet',
        object_id: 'review-packet-1',
        relationship: 'supports',
      },
      redacted: false,
      status: 'current',
    });

    expect(parsed.object_ref.relationship).toBe('supports');

    expect(
      createReleaseEvidenceRequestSchema.parse({
        actor_id: 'actor-owner',
        evidence_type: 'test_report',
        summary: 'Test report uploaded.',
        artifact_id: 'artifact-test-report-1',
      }).artifact_id,
    ).toBe('artifact-test-report-1');

    expect(
      releaseEvidenceSchema.parse({
        id: 'evidence-1',
        release_id: 'release-1',
        evidence_type: 'observation_note',
        summary: 'Observation window is healthy.',
        extra: { error_rate: 0.01 },
        redacted: false,
        status: 'current',
        created_at: '2026-05-05T00:00:00.000Z',
      }).object_ref,
    ).toBeUndefined();
  });

  it('rejects invalid release DTO inputs', () => {
    expect(patchReleaseRequestSchema.safeParse({}).success).toBe(false);
    expect(patchReleaseRequestSchema.safeParse({ title: 'P1', unknown: true }).success).toBe(false);
    expect(
      releaseBlockerSnapshotSchema.safeParse({
        ...validReleaseBlockerSnapshot,
        blockers: [
          {
            code: 'unknown_blocker',
            category: 'evidence',
            overrideable: true,
            message: 'Unknown blocker.',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      overrideApproveReleaseRequestSchema.safeParse({
        actor_id: 'actor-release-manager',
        rationale: '',
        blocker_snapshot: validReleaseBlockerSnapshot,
      }).success,
    ).toBe(false);
    expect(
      overrideApproveReleaseRequestSchema.safeParse({
        actor_id: 'actor-release-manager',
        rationale: 'Reviewed manually.',
        accepted_blocker_codes: ['stale_or_superseded_evidence'],
      }).success,
    ).toBe(false);
    expect(
      overrideApproveReleaseRequestSchema.safeParse({
        actor_id: 'actor-release-manager',
        rationale: 'Reviewed manually.',
        blocker_snapshot: validReleaseBlockerSnapshot,
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      createReleaseEvidenceRequestSchema.safeParse({
        actor_id: 'actor-release-manager',
        evidence_type: 'review_packet',
        summary: 'Approved review packet.',
      }).success,
    ).toBe(false);
    expect(
      createReleaseEvidenceRequestSchema.safeParse({
        actor_id: 'actor-release-manager',
        evidence_type: 'review_packet',
        summary: 'Approved review packet.',
        object_ref: {
          object_type: 'run_session',
          object_id: 'run-session-1',
          relationship: 'supports',
        },
      }).success,
    ).toBe(false);
  });

  it('parses a valid run spec', () => {
    const parsed = runSpecSchema.parse(validRunSpec);

    expect(parsed.executor_type).toBe('local_codex');
    expect(parsed.required_checks[0]?.blocks_review).toBe(true);
    expect(parsed.review_context.requested_changes).toHaveLength(1);
    expect(parsed.idempotency_key).toBe('exec-package-1:run-session-1:748c32b');
  });

  it('rejects run specs with divergent required checks', () => {
    expect(
      runSpecSchema.safeParse({
        ...validRunSpec,
        required_checks: [
          {
            ...validRequiredChecks[0],
            command: 'pnpm test',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(['approved', 'none'] as const)(
    'rejects run specs with %s review context and requested changes',
    (latestDecision) => {
      expect(
        runSpecSchema.safeParse({
          ...validRunSpec,
          review_context: {
            latest_decision: latestDecision,
            requested_changes: [validRequestedChange],
          },
        }).success,
      ).toBe(false);
    },
  );

  it('rejects run specs with omitted review decision and requested changes', () => {
    expect(
      runSpecSchema.safeParse({
        ...validRunSpec,
        review_context: {
          requested_changes: [validRequestedChange],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects run specs with changes-requested review context and no requested changes', () => {
    expect(
      runSpecSchema.safeParse({
        ...validRunSpec,
        review_context: {
          latest_decision: 'changes_requested',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects run specs with duplicate required check ids', () => {
    const duplicateRequiredChecks = [
      validRequiredChecks[0],
      {
        ...validRequiredChecks[0],
        display_name: 'Duplicate contracts tests',
        command: 'pnpm test tests/contracts --runInBand',
      },
    ];

    expect(
      runSpecSchema.safeParse({
        ...validRunSpec,
        context: {
          ...validRunSpec.context,
          required_checks: duplicateRequiredChecks,
        },
        required_checks: duplicateRequiredChecks,
      }).success,
    ).toBe(false);
  });

  it('rejects run specs with no allowed paths', () => {
    expect(
      runSpecSchema.safeParse({
        ...validRunSpec,
        allowed_paths: [],
      }).success,
    ).toBe(false);
  });

  it('rejects run specs with no requested artifacts', () => {
    expect(
      runSpecSchema.safeParse({
        ...validRunSpec,
        artifact_policy: {
          requested_artifacts: [],
        },
      }).success,
    ).toBe(false);
  });

  it('parses blocking and non-blocking executor results', () => {
    const blocking = executorResultSchema.parse({
      run_session_id: 'run-session-blocking',
      executor_type: 'local_codex',
      executor_version: '0.1.0',
      status: 'failed',
      started_at: '2026-05-05T01:00:00.000Z',
      finished_at: '2026-05-05T01:02:00.000Z',
      summary: 'Blocking required check failed, so review packet should not be created.',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/contracts/src/executor.ts',
          change_kind: 'modified',
        },
      ],
      checks: [
        {
          check_id: 'contracts-test',
          command: 'pnpm test tests/contracts',
          status: 'failed',
          exit_code: 1,
          duration_seconds: 12.4,
          blocks_review: true,
          stdout: {
            kind: 'check_output',
            name: 'contracts-test stdout',
            content_type: 'text/plain',
            local_ref: 'artifacts/run-session-blocking/stdout.log',
          },
          stderr: {
            kind: 'check_output',
            name: 'contracts-test stderr',
            content_type: 'text/plain',
            local_ref: 'artifacts/run-session-blocking/stderr.log',
          },
        },
      ],
      artifacts: [
        {
          kind: 'execution_summary',
          name: 'summary',
          content_type: 'text/markdown',
          local_ref: 'artifacts/run-session-blocking/summary.md',
          digest: 'sha256:summary-digest',
        },
      ],
      failure: {
        kind: 'required_check_failed',
        message: 'Contracts tests failed.',
        retryable: true,
      },
      raw_metadata: {
        codex_session_id: 'session-1',
      },
    });

    const nonBlocking = executorResultSchema.parse({
      run_session_id: 'run-session-non-blocking',
      executor_type: 'local_codex',
      executor_version: '0.1.0',
      status: 'succeeded',
      started_at: '2026-05-05T01:00:00.000Z',
      finished_at: '2026-05-05T01:02:00.000Z',
      summary: 'Execution succeeded with non-blocking risk notes.',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/contracts/src/review.ts',
          change_kind: 'added',
        },
      ],
      checks: [
        {
          check_id: 'optional-lint',
          command: 'pnpm lint',
          status: 'failed',
          exit_code: 1,
          duration_seconds: 8.1,
          blocks_review: false,
        },
      ],
      artifacts: [
        {
          kind: 'diff',
          name: 'working tree diff',
          content_type: 'text/x-diff',
          storage_uri: 's3://forgeloop-artifacts/run-session-non-blocking/diff.patch',
        },
      ],
      raw_metadata: {
        warning_count: 3,
      },
    });

    expect(blocking.status).toBe('failed');
    expect(blocking.failure?.kind).toBe('required_check_failed');
    expect(blocking.checks[0]?.blocks_review).toBe(true);
    expect(nonBlocking.status).toBe('succeeded');
    expect(nonBlocking.failure).toBeUndefined();
    expect(nonBlocking.checks[0]?.blocks_review).toBe(false);
  });

  it.each(['timed_out', 'skipped', 'cancelled'] as const)(
    'parses failed required-check results with blocking %s check evidence',
    (checkStatus) => {
      const parsed = executorResultSchema.parse({
        ...validExecutorResult,
        status: 'failed',
        checks: [
          {
            ...validCheckResult,
            status: checkStatus,
            exit_code: checkStatus === 'timed_out' ? 124 : null,
            blocks_review: true,
          },
        ],
        failure: {
          kind: 'required_check_failed',
          message: `Required check ${checkStatus}.`,
          retryable: true,
        },
      });

      expect(parsed.status).toBe('failed');
      expect(parsed.failure?.kind).toBe('required_check_failed');
      expect(parsed.checks[0]?.status).toBe(checkStatus);
      expect(parsed.checks[0]?.blocks_review).toBe(true);
    },
  );

  it.each(['workspace_prepare_failed', 'preflight_failed', 'executor_process_failed'] as const)(
    'parses a local codex executor result with %s failure',
    (failureKind) => {
      const parsed = executorResultSchema.parse({
        run_session_id: `run-session-${failureKind}`,
        executor_type: 'local_codex',
        executor_version: '0.1.0',
        status: 'failed',
        started_at: '2026-05-05T01:00:00.000Z',
        finished_at: '2026-05-05T01:02:00.000Z',
        summary: `Local Codex execution failed during ${failureKind}.`,
        changed_files: [],
        checks: [],
        artifacts: [
          {
            kind: 'logs',
            name: 'executor logs',
            content_type: 'text/plain',
            local_ref: `artifacts/run-session-${failureKind}/executor.log`,
          },
        ],
        failure: {
          kind: failureKind,
          message: `Local Codex execution failed during ${failureKind}.`,
          retryable: true,
        },
      });

      expect(parsed.failure?.kind).toBe(failureKind);
    },
  );

  it('parses the executor process failure kind', () => {
    expect(failureKindSchema.parse('executor_process_failed')).toBe('executor_process_failed');
  });

  it('parses a review request-changes decision payload', () => {
    const parsed = reviewDecisionPayloadSchema.parse({
      review_packet_id: 'review-packet-1',
      decision: 'changes_requested',
      summary: 'The contracts need a stronger API DTO surface before approval.',
      requested_changes: [
        {
          title: 'Add rerun DTO',
          description: 'Expose a contract for rerunning a package with requested changes context.',
          file_path: 'packages/contracts/src/api.ts',
          severity: 'major',
          suggested_validation: 'pnpm test tests/contracts',
        },
      ],
      reviewed_by_actor_id: 'actor-1',
      reviewed_at: '2026-05-05T02:00:00.000Z',
    });

    expect(parsed.decision).toBe('changes_requested');
    expect(parsed.requested_changes).toHaveLength(1);
  });

  it('parses the approve review packet request DTO', () => {
    const parsed = approveReviewPacketRequestSchema.parse({
      review_packet_id: 'review-packet-1',
      decision: 'approved',
      summary: 'The contracts are ready for the next delivery loop stage.',
      reviewed_by_actor_id: 'actor-1',
      reviewed_at: '2026-05-05T02:00:00.000Z',
    });

    expect(parsed.decision).toBe('approved');
    expect('requested_changes' in parsed).toBe(false);
  });

  it('parses the request review changes request DTO', () => {
    const parsed = requestReviewChangesRequestSchema.parse({
      ...validReviewDecisionPayload,
      decision: 'changes_requested',
      requested_changes: [validRequestedChange],
    });

    expect(parsed.decision).toBe('changes_requested');
    expect(parsed.requested_changes).toHaveLength(1);
  });

  it('rejects changes-requested decisions on the approve review packet request DTO', () => {
    expect(
      approveReviewPacketRequestSchema.safeParse({
        ...validReviewDecisionPayload,
        decision: 'changes_requested',
        requested_changes: [validRequestedChange],
      }).success,
    ).toBe(false);
  });

  it('rejects requested changes on the approve review packet request DTO', () => {
    expect(
      approveReviewPacketRequestSchema.safeParse({
        ...validReviewDecisionPayload,
        requested_changes: [validRequestedChange],
      }).success,
    ).toBe(false);
  });

  it('rejects approved decisions on the request review changes request DTO', () => {
    expect(
      requestReviewChangesRequestSchema.safeParse({
        ...validReviewDecisionPayload,
        requested_changes: [validRequestedChange],
      }).success,
    ).toBe(false);
  });

  it('requires requested changes on the request review changes request DTO', () => {
    expect(
      requestReviewChangesRequestSchema.safeParse({
        ...validReviewDecisionPayload,
        decision: 'changes_requested',
      }).success,
    ).toBe(false);
  });

  it('parses the command inventory response DTO', () => {
    const parsed = commandInventoryResponseSchema.parse(validCommandInventory);

    expect(parsed.commands.map((item) => item.command)).toEqual([
      'run_package',
      'rerun_package',
      'force_rerun_package',
      'approve_review_packet',
      'request_review_changes',
    ]);
    expect(parsed.commands.map((item) => item.path)).toEqual([
      '/execution-packages/:packageId/run',
      '/execution-packages/:packageId/rerun',
      '/execution-packages/:packageId/force-rerun',
      '/review-packets/:reviewPacketId/approve',
      '/review-packets/:reviewPacketId/request-changes',
    ]);
  });

  it('parses the run package request DTO', () => {
    const parsed = runPackageRequestSchema.parse({
      execution_package_id: 'exec-package-1',
      executor_type: 'local_codex',
      idempotency_key: 'run-package-1',
    });

    expect(parsed.workflow_only).toBe(false);
    expect(parsed.executor_type).toBe('local_codex');
  });

  it('parses the rerun package request DTO', () => {
    const parsed = rerunPackageRequestSchema.parse({
      execution_package_id: 'exec-package-1',
      previous_run_session_id: 'run-session-1',
      review_packet_id: 'review-packet-1',
      requested_changes_context: [validRequestedChange],
      workflow_only: true,
    });

    expect(parsed.requested_changes_context).toHaveLength(1);
    expect(parsed.workflow_only).toBe(true);
  });

  it('parses the force-rerun package request DTO', () => {
    const parsed = forceRerunPackageRequestSchema.parse({
      execution_package_id: 'exec-package-1',
      previous_run_session_id: 'run-session-1',
      force_reason: 'Reviewer approved a manual rerun after transient executor failure.',
    });

    expect(parsed.force).toBe(true);
    expect(parsed.requested_changes_context).toEqual([]);
  });

  it('rejects actor identity fields in run package request bodies', () => {
    expect(
      runPackageRequestSchema.safeParse({
        execution_package_id: 'exec-package-1',
        requested_by_actor_id: 'actor-1',
      }).success,
    ).toBe(false);
    expect(
      rerunPackageRequestSchema.safeParse({
        execution_package_id: 'exec-package-1',
        previous_run_session_id: 'run-session-1',
        actor_id: 'actor-1',
      }).success,
    ).toBe(false);
    expect(
      forceRerunPackageRequestSchema.safeParse({
        execution_package_id: 'exec-package-1',
        previous_run_session_id: 'run-session-1',
        force_reason: 'Reviewer approved a manual rerun after transient executor failure.',
        requested_by_actor_id: 'actor-1',
      }).success,
    ).toBe(false);
  });

  it('parses async accepted run package response DTOs', () => {
    const run = runPackageResponseSchema.parse({
      execution_package_id: 'exec-package-1',
      run_session_id: 'run-session-1',
      status: 'accepted',
    });

    const rerun = rerunPackageResponseSchema.parse({
      execution_package_id: 'exec-package-1',
      run_session_id: 'run-session-2',
      status: 'accepted',
    });

    const forceRerun = forceRerunPackageResponseSchema.parse({
      execution_package_id: 'exec-package-1',
      run_session_id: 'run-session-3',
      status: 'accepted',
    });

    expect([run.status, rerun.status, forceRerun.status]).toEqual(['accepted', 'accepted', 'accepted']);
    expect([run.run_session_id, rerun.run_session_id, forceRerun.run_session_id]).toEqual([
      'run-session-1',
      'run-session-2',
      'run-session-3',
    ]);
  });

  it('rejects accepted run package responses without run sessions', () => {
    expect(
      runPackageResponseSchema.safeParse({
        execution_package_id: 'exec-package-1',
        status: 'accepted',
      }).success,
    ).toBe(false);
  });

  it('rejects workflow results on accepted run package responses', () => {
    expect(
      runPackageResponseSchema.safeParse({
        execution_package_id: 'exec-package-1',
        run_session_id: 'run-session-1',
        status: 'accepted',
        workflow_result: {
          status: 'succeeded',
        },
      }).success,
    ).toBe(false);
  });

  it('parses a failed self-review result', () => {
    const parsed = selfReviewResultSchema.parse({
      status: 'failed',
      summary: 'Self-review could not determine whether the run satisfies the plan.',
      spec_plan_alignment: 'Insufficient evidence to evaluate plan alignment.',
      test_assessment: 'Required check output artifact was missing.',
      risk_notes: ['Human review should inspect executor artifacts manually.'],
      follow_up_questions: ['Was the contract test output captured elsewhere?'],
      failure_message: 'Missing check output artifact.',
    });

    expect(parsed.status).toBe('failed');
    expect(parsed.failure_message).toBe('Missing check output artifact.');
  });

  it('rejects executor success with a failure object', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        failure: {
          kind: 'executor_error',
          message: 'Unexpected executor error.',
          retryable: true,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects executor success with an unsuccessful blocking check', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        checks: [
          {
            ...validCheckResult,
            status: 'failed',
            exit_code: 1,
            blocks_review: true,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects required-check failure without an unsuccessful blocking check', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        status: 'failed',
        failure: {
          kind: 'required_check_failed',
          message: 'Required check failed.',
          retryable: true,
        },
      }).success,
    ).toBe(false);
  });

  it('allows path_violation to take precedence over unsuccessful blocking checks', () => {
    const parsed = executorResultSchema.parse({
      ...validExecutorResult,
      status: 'failed',
      checks: [
        {
          ...validCheckResult,
          status: 'failed',
          exit_code: 1,
          blocks_review: true,
        },
      ],
      failure: {
        kind: 'path_violation',
        message: 'Source repo changed outside the run worktree.',
        retryable: false,
      },
    });

    expect(parsed.failure?.kind).toBe('path_violation');
  });

  it('rejects unsuccessful blocking checks with an unrelated non-required-check failure kind', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        status: 'failed',
        checks: [
          {
            ...validCheckResult,
            status: 'failed',
            exit_code: 1,
            blocks_review: true,
          },
        ],
        failure: {
          kind: 'executor_error',
          message: 'Executor failed after a required check failed.',
          retryable: true,
        },
      }).success,
    ).toBe(false);
  });

  it.each(['timed_out', 'cancelled'] as const)(
    'rejects failed blocking checks with %s executor status',
    (status) => {
      expect(
        executorResultSchema.safeParse({
          ...validExecutorResult,
          status,
          checks: [
            {
              ...validCheckResult,
              status: 'failed',
              exit_code: 1,
              blocks_review: true,
            },
          ],
          failure: {
            kind: status,
            message: `Execution ${status}.`,
            retryable: true,
          },
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ['timed_out', 'timed_out'],
    ['timed_out', 'cancelled'],
    ['timed_out', 'skipped'],
    ['cancelled', 'timed_out'],
    ['cancelled', 'cancelled'],
    ['cancelled', 'skipped'],
  ] as const)(
    'parses %s executor results with partial %s blocking check evidence',
    (status, checkStatus) => {
      const parsed = executorResultSchema.parse({
        ...validExecutorResult,
        status,
        checks: [
          {
            ...validCheckResult,
            status: checkStatus,
            exit_code: checkStatus === 'timed_out' ? 124 : null,
            blocks_review: true,
          },
        ],
        failure: {
          kind: status,
          message: `Execution ${status} before all required checks completed.`,
          retryable: true,
        },
      });

      expect(parsed.status).toBe(status);
      expect(parsed.failure?.kind).toBe(status);
      expect(parsed.checks[0]?.status).toBe(checkStatus);
      expect(parsed.checks[0]?.blocks_review).toBe(true);
    },
  );

  it.each(['2026-05-05', '05/06/2026'])('rejects non-date-time executor timestamps: %s', (startedAt) => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        started_at: startedAt,
      }).success,
    ).toBe(false);
  });

  it('rejects executor results that finish before they start', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        started_at: '2026-05-05T01:02:00.000Z',
        finished_at: '2026-05-05T01:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects executor results with duplicate check ids', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        checks: [
          validCheckResult,
          {
            ...validCheckResult,
            command: 'pnpm build',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects review decision payloads with no submitted decision', () => {
    expect(
      reviewDecisionPayloadSchema.safeParse({
        ...validReviewDecisionPayload,
        decision: 'none',
      }).success,
    ).toBe(false);
  });

  it('rejects submit-review responses with no submitted decision', () => {
    expect(
      submitReviewDecisionResponseSchema.safeParse({
        ...validSubmitReviewDecisionResponse,
        decision: 'none',
      }).success,
    ).toBe(false);
  });

  it('rejects submit-review responses with submitted decisions before completion', () => {
    expect(
      submitReviewDecisionResponseSchema.safeParse({
        ...validSubmitReviewDecisionResponse,
        status: 'ready',
        decision: 'approved',
      }).success,
    ).toBe(false);
  });

  it('rejects approved review decision payloads with requested changes', () => {
    expect(
      reviewDecisionPayloadSchema.safeParse({
        ...validReviewDecisionPayload,
        requested_changes: [validRequestedChange],
      }).success,
    ).toBe(false);
  });

  it.each(['2026-05-05', '05/06/2026'])('rejects non-date-time review timestamps: %s', (reviewedAt) => {
    expect(
      reviewDecisionPayloadSchema.safeParse({
        ...validReviewDecisionPayload,
        reviewed_at: reviewedAt,
      }).success,
    ).toBe(false);
  });

  it.each(['2026-05-05', '05/06/2026'])('rejects non-date-time recorded_at timestamps: %s', (recordedAt) => {
    expect(
      submitReviewDecisionResponseSchema.safeParse({
        ...validSubmitReviewDecisionResponse,
        recorded_at: recordedAt,
      }).success,
    ).toBe(false);
  });

  it('rejects invalid API command names and force reruns without a reason', () => {
    expect(
      commandInventoryResponseSchema.safeParse({
        commands: [
          {
            command: 'rerun',
            method: 'POST',
            path: '/api/commands/rerun',
            description: 'Invalid command name.',
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      forceRerunPackageRequestSchema.safeParse({
        execution_package_id: 'exec-package-1',
        previous_run_session_id: 'run-session-1',
        requested_by_actor_id: 'actor-1',
      }).success,
    ).toBe(false);
  });

  it('rejects incomplete or duplicate command inventories', () => {
    expect(
      commandInventoryResponseSchema.safeParse({
        commands: validCommandInventory.commands.slice(1),
      }).success,
    ).toBe(false);

    expect(
      commandInventoryResponseSchema.safeParse({
        commands: [
          ...validCommandInventory.commands,
          {
            ...validCommandInventory.commands[0],
            path: '/api/commands/run-package-copy',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects command inventory items with non-spec command paths', () => {
    expect(
      commandInventoryResponseSchema.safeParse({
        commands: [
          {
            ...validCommandInventory.commands[0],
            path: '/api/commands/run-package',
          },
          ...validCommandInventory.commands.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects successful self-review results with a failure message', () => {
    expect(
      selfReviewResultSchema.safeParse({
        status: 'succeeded',
        summary: 'Self-review completed.',
        spec_plan_alignment: 'The run matches the spec and plan.',
        test_assessment: 'Required checks passed.',
        risk_notes: [],
        follow_up_questions: [],
        failure_message: 'This should only be present on failed reviews.',
      }).success,
    ).toBe(false);
  });

  it('rejects contradictory check result exit codes', () => {
    expect(
      checkResultSchema.safeParse({
        ...validCheckResult,
        status: 'succeeded',
        exit_code: 1,
      }).success,
    ).toBe(false);

    expect(
      checkResultSchema.safeParse({
        ...validCheckResult,
        status: 'failed',
        exit_code: 0,
      }).success,
    ).toBe(false);

    expect(
      checkResultSchema.safeParse({
        ...validCheckResult,
        status: 'skipped',
        exit_code: 0,
      }).success,
    ).toBe(false);

    expect(
      checkResultSchema.safeParse({
        ...validCheckResult,
        status: 'cancelled',
        exit_code: 0,
      }).success,
    ).toBe(false);

    expect(
      checkResultSchema.safeParse({
        ...validCheckResult,
        status: 'timed_out',
        exit_code: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects executor timeout status with non-timeout failure kind', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        status: 'timed_out',
        failure: {
          kind: 'preflight_failed',
          message: 'Preflight failed before execution timed out.',
          retryable: true,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects failed executor status with timeout failure kind', () => {
    expect(
      executorResultSchema.safeParse({
        ...validExecutorResult,
        status: 'failed',
        failure: {
          kind: 'timed_out',
          message: 'Execution timed out.',
          retryable: true,
        },
      }).success,
    ).toBe(false);
  });

  it('requires previous_path only for renamed files', () => {
    expect(
      changedFileSchema.safeParse({
        repo_id: 'repo-1',
        path: 'packages/contracts/src/executor.ts',
        change_kind: 'renamed',
      }).success,
    ).toBe(false);

    expect(
      changedFileSchema.safeParse({
        repo_id: 'repo-1',
        path: 'packages/contracts/src/executor.ts',
        change_kind: 'modified',
        previous_path: 'packages/contracts/src/old-executor.ts',
      }).success,
    ).toBe(false);

    expect(
      changedFileSchema.safeParse({
        repo_id: 'repo-1',
        path: 'packages/contracts/src/executor.ts',
        change_kind: 'renamed',
        previous_path: 'packages/contracts/src/executor.ts',
      }).success,
    ).toBe(false);
  });

  it('parses the public Evidence Chain response DTO from the contract barrel', () => {
    const parsed = evidenceChainResponseSchema.parse({
      work_item_id: 'work-item-1',
      generated_at: '2026-05-08T01:00:00.000Z',
      focus: {
        selection: 'explicit',
        review_packet_ids: ['review-packet-1'],
      },
      projection: {
        source: 'read_time',
        version: 1,
        partial: false,
        gaps: [],
      },
      summary: {
        total_items: 0,
        run_count: 0,
        review_packet_count: 0,
        decision_count: 0,
        artifact_count: 0,
        risk_flags: ['no_evidence'],
        redacted_count: 0,
      },
      items: [],
    });

    expect(parsed.focus.selection).toBe('explicit');
    expect(parsed.summary.risk_flags).toEqual(['no_evidence']);
  });
});
