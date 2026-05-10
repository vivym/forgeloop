import { describe, expect, it } from 'vitest';

import {
  createReleaseBlockerSnapshot,
  deriveReleaseBlockers,
  fingerprintReleaseBlockers,
  isReleaseBlockerOverrideable,
  releaseBlockerCodes,
  selectReleaseReviewPacket,
  transitionRelease,
  type ExecutionPackage,
  type Release,
  type ReleaseBlockerCode,
  type ReleaseEvidence,
  type ReviewPacket,
  type RunSession,
  type WorkItem,
} from '../../packages/domain/src/index';

const timestamp = '2026-05-05T00:00:00.000Z';

const expectedCodes = [
  'missing_work_item',
  'missing_execution_package',
  'empty_release_scope',
  'work_item_not_complete',
  'package_not_release_ready',
  'missing_approved_review_packet',
  'failed_required_check',
  'missing_required_artifact',
  'evidence_redacted',
  'stale_or_superseded_evidence',
  'missing_rollout_strategy',
  'missing_rollback_plan',
  'missing_observation_plan',
] as const satisfies readonly ReleaseBlockerCode[];

const release = (overrides: Partial<Release> = {}): Release => ({
  id: 'release-1',
  org_id: 'org-1',
  project_id: 'project-1',
  title: 'P1 release',
  phase: 'candidate',
  activity_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  work_item_ids: ['work-item-1'],
  execution_package_ids: ['package-1'],
  rollout_strategy: 'Deploy behind the release flag.',
  rollback_plan: 'Disable the release flag and revert.',
  observation_plan: 'Watch error rate and latency for one hour.',
  created_by_actor_id: 'actor-owner',
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides,
});

const workItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Releaseable work item',
  goal: 'Ship the release.',
  success_criteria: ['All package evidence is approved.'],
  priority: 'P1',
  risk: 'medium',
  owner_actor_id: 'actor-owner',
  phase: 'done',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'completed',
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides,
});

const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: 'package-1',
  work_item_id: 'work-item-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-revision-1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-revision-1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement release flow.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'release_ready',
  resolution: 'completed',
  required_checks: [
    {
      check_id: 'domain-tests',
      display_name: 'Domain tests',
      command: 'pnpm vitest run tests/domain',
      timeout_seconds: 120,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['packages/domain/**'],
  forbidden_paths: [],
  last_run_session_id: 'run-session-1',
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides,
});

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-session-1',
  execution_package_id: 'package-1',
  requested_by_actor_id: 'actor-owner',
  status: 'succeeded',
  changed_files: [],
  check_results: [
    {
      check_id: 'domain-tests',
      command: 'pnpm vitest run tests/domain',
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 10,
      blocks_review: true,
    },
  ],
  artifacts: [
    {
      kind: 'execution_summary',
      name: 'summary',
      content_type: 'text/markdown',
      local_ref: 'artifacts/run-session-1/summary.md',
    },
  ],
  log_refs: [],
  created_at: timestamp,
  updated_at: timestamp,
  finished_at: timestamp,
  ...overrides,
});

const reviewPacket = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-packet-1',
  run_session_id: 'run-session-1',
  execution_package_id: 'package-1',
  reviewer_actor_id: 'actor-reviewer',
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  status: 'completed',
  decision: 'approved',
  changed_files: [],
  check_result_summary: 'Domain tests passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Ready.',
    spec_plan_alignment: 'Aligned.',
    test_assessment: 'Required tests passed.',
    risk_notes: [],
    follow_up_questions: [],
  },
  risk_notes: [],
  requested_changes: [],
  created_at: timestamp,
  updated_at: timestamp,
  completed_at: timestamp,
  ...overrides,
});

const evidence = (overrides: Partial<ReleaseEvidence> = {}): ReleaseEvidence => ({
  id: 'evidence-1',
  release_id: 'release-1',
  evidence_type: 'review_packet',
  summary: 'Review packet approved.',
  object_ref: {
    object_type: 'review_packet',
    object_id: 'review-packet-1',
    relationship: 'supports',
  },
  redacted: false,
  status: 'current',
  created_at: timestamp,
  ...overrides,
});

const deriveCodes = (overrides: Parameters<typeof deriveReleaseBlockers>[0] = {}) =>
  deriveReleaseBlockers({
    release: release(),
    work_items: [workItem()],
    execution_packages: [executionPackage()],
    run_sessions: [runSession()],
    review_packets: [reviewPacket()],
    evidence: [evidence()],
    ...overrides,
  }).map((blocker) => blocker.code);

describe('Release gate derivation', () => {
  it('exports every required blocker code exactly once', () => {
    expect(releaseBlockerCodes).toEqual(expectedCodes);
  });

  it('classifies structural, evidence, risk, and planning blockers for override policy', () => {
    expect(isReleaseBlockerOverrideable('empty_release_scope')).toBe(false);
    expect(isReleaseBlockerOverrideable('evidence_redacted')).toBe(true);
    expect(isReleaseBlockerOverrideable('stale_or_superseded_evidence')).toBe(true);
    expect(isReleaseBlockerOverrideable('work_item_not_complete')).toBe(true);
    expect(isReleaseBlockerOverrideable('package_not_release_ready')).toBe(true);
    expect(isReleaseBlockerOverrideable('missing_rollout_strategy')).toBe(true);
    expect(isReleaseBlockerOverrideable('missing_rollback_plan')).toBe(true);
    expect(isReleaseBlockerOverrideable('missing_observation_plan')).toBe(true);
  });

  it.each([
    ['absent', undefined],
    ['archived', 'archived'],
    ['soft-deleted', 'deleted'],
    ['unauthorized', 'unauthorized'],
  ] as const)('derives missing_work_item for %s work item links', (_label, linkedWorkItem) => {
    expect(
      typeof linkedWorkItem === 'string'
        ? deriveCodes({
            work_item_links: [
              {
                object_id: 'work-item-1',
                status: linkedWorkItem,
                reason: `${linkedWorkItem} link`,
              },
            ],
          })
        : deriveCodes({ work_items: [] }),
    ).toContain('missing_work_item');
  });

  it.each([
    ['absent', undefined],
    ['archived', 'archived'],
    ['soft-deleted', 'deleted'],
    ['unauthorized', 'unauthorized'],
  ] as const)('derives missing_execution_package for %s package links', (_label, linkedPackage) => {
    expect(
      typeof linkedPackage === 'string'
        ? deriveCodes({
            execution_package_links: [
              {
                object_id: 'package-1',
                status: linkedPackage,
                reason: `${linkedPackage} link`,
              },
            ],
          })
        : deriveCodes({ execution_packages: [] }),
    ).toContain('missing_execution_package');
  });

  it('derives empty_release_scope when either valid linked scope side is empty and blocks submit, approve, and override', () => {
    for (const context of [
      { release: release({ work_item_ids: [] }), work_items: [], execution_packages: [executionPackage()] },
      { release: release({ execution_package_ids: [] }), work_items: [workItem()], execution_packages: [] },
    ]) {
      const blockers = deriveReleaseBlockers(context);
      expect(blockers.map((blocker) => blocker.code)).toContain('empty_release_scope');
      expect(() =>
        transitionRelease(context.release, {
          type: 'submit',
          gate_context: context,
        }),
      ).toThrow();
      expect(() =>
        transitionRelease({ ...context.release, phase: 'approval', gate_state: 'awaiting_approval' }, {
          type: 'approve',
          approved_by_actor_id: 'actor-reviewer',
          gate_context: context,
        }),
      ).toThrow();
      expect(() =>
        transitionRelease({ ...context.release, phase: 'approval', gate_state: 'awaiting_approval' }, {
          type: 'override_approve',
          approved_by_actor_id: 'actor-reviewer',
          rationale: 'Manual approval.',
          blocker_snapshot: createReleaseBlockerSnapshot({
            release_id: context.release.id,
            generated_at: timestamp,
            blockers,
          }),
          gate_context: context,
        }),
      ).toThrow();
    }
  });

  it.each([
    ['work_item_not_complete', { work_items: [workItem({ phase: 'execution', resolution: 'none' })] }],
    ['package_not_release_ready', { execution_packages: [executionPackage({ gate_state: 'review_approved' })] }],
    ['missing_approved_review_packet', { review_packets: [reviewPacket({ decision: 'changes_requested' })] }],
    [
      'failed_required_check',
      {
        run_sessions: [
          runSession({
            check_results: [
              {
                check_id: 'domain-tests',
                command: 'pnpm vitest run tests/domain',
                status: 'failed',
                exit_code: 1,
                duration_seconds: 10,
                blocks_review: true,
              },
            ],
          }),
        ],
      },
    ],
    ['missing_required_artifact', { run_sessions: [runSession({ artifacts: [] })] }],
    ['evidence_redacted', { evidence: [evidence({ redacted: true })] }],
    ['stale_or_superseded_evidence', { evidence: [evidence({ status: 'superseded' })] }],
    ['missing_rollout_strategy', { release: release({ rollout_strategy: undefined }) }],
    ['missing_rollback_plan', { release: release({ rollback_plan: undefined }) }],
    ['missing_observation_plan', { release: release({ observation_plan: undefined }) }],
  ] as const)('derives %s', (code, overrides) => {
    expect(deriveCodes(overrides)).toContain(code);
  });

  it('treats released execution packages as release-ready', () => {
    expect(deriveCodes({ execution_packages: [executionPackage({ gate_state: 'released' })] })).not.toContain(
      'package_not_release_ready',
    );
  });

  it('creates deterministic blocker snapshots for transition commands', () => {
    const blockers = deriveReleaseBlockers({
      release: release({ rollout_strategy: undefined }),
      work_items: [workItem()],
      execution_packages: [executionPackage()],
      run_sessions: [runSession()],
      review_packets: [reviewPacket()],
      evidence: [evidence()],
    });
    const snapshot = createReleaseBlockerSnapshot({
      release_id: 'release-1',
      generated_at: timestamp,
      blockers,
    });

    expect(snapshot).toMatchObject({
      release_id: 'release-1',
      generated_at: timestamp,
      blockers,
    });
    expect(snapshot.blocker_fingerprint).toBe(fingerprintReleaseBlockers(blockers));
    expect(
      createReleaseBlockerSnapshot({
        release_id: 'release-1',
        generated_at: timestamp,
        blockers: [...blockers].reverse(),
      }).blocker_fingerprint,
    ).toBe(snapshot.blocker_fingerprint);
  });

  it('derives failed_required_check when a selected run is missing a required check result', () => {
    expect(
      deriveCodes({
        execution_packages: [
          executionPackage({
            required_checks: [
              {
                check_id: 'domain-tests',
                display_name: 'Domain tests',
                command: 'pnpm vitest run tests/domain',
                timeout_seconds: 120,
                blocks_review: true,
              },
              {
                check_id: 'contracts-tests',
                display_name: 'Contracts tests',
                command: 'pnpm vitest run tests/contracts',
                timeout_seconds: 120,
                blocks_review: true,
              },
            ],
          }),
        ],
      }),
    ).toContain('failed_required_check');
  });

  it('selects release evidence from current pointers, then last run review packet, then latest non-archived packet', () => {
    const archivedNewer = reviewPacket({
      id: 'review-packet-archived-newer',
      run_session_id: 'run-session-archived',
      status: 'archived',
      created_at: '2026-05-07T00:00:00.000Z',
    });
    const latest = reviewPacket({
      id: 'review-packet-latest',
      run_session_id: 'run-session-latest',
      created_at: '2026-05-06T00:00:00.000Z',
    });
    const lastRun = reviewPacket({
      id: 'review-packet-last-run',
      run_session_id: 'run-session-1',
      created_at: '2026-05-05T00:00:00.000Z',
    });
    const current = reviewPacket({
      id: 'review-packet-current',
      run_session_id: 'run-session-current',
      created_at: '2026-05-04T00:00:00.000Z',
    });
    const currentRun = reviewPacket({
      id: 'review-packet-current-run',
      run_session_id: 'run-session-current-pointer',
      created_at: '2026-05-03T00:00:00.000Z',
    });

    expect(
      selectReleaseReviewPacket(
        release({ current_review_packet_ids: ['review-packet-current'] }),
        executionPackage(),
        [archivedNewer, latest, lastRun, current],
      )?.id,
    ).toBe('review-packet-current');

    expect(selectReleaseReviewPacket(release(), executionPackage(), [archivedNewer, latest, lastRun])?.id).toBe(
      'review-packet-last-run',
    );

    expect(
      selectReleaseReviewPacket(
        release({ current_run_session_ids: ['run-session-current-pointer'] }),
        executionPackage(),
        [archivedNewer, latest, lastRun, currentRun],
      )?.id,
    ).toBe('review-packet-current-run');

    expect(
      selectReleaseReviewPacket(release(), executionPackage({ last_run_session_id: undefined }), [
        archivedNewer,
        latest,
        lastRun,
      ])?.id,
    ).toBe('review-packet-latest');
  });
});
