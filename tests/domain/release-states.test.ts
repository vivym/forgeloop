import { describe, expect, it } from 'vitest';

import {
  createReleaseBlockerSnapshot,
  DomainError,
  deriveReleaseBlockers,
  transitionRelease,
  type ExecutionPackage,
  type Release,
  type ReleaseBlocker,
  type ReleaseBlockerSnapshot,
  type ReleaseGateContext,
  type ReviewPacket,
  type RunSession,
  type WorkItem,
} from '../../packages/domain/src/index';

const timestamp = '2026-05-05T00:00:00.000Z';

const releaseState = (release: Release) => ({
  phase: release.phase,
  activity_state: release.activity_state,
  gate_state: release.gate_state,
  resolution: release.resolution,
});

const createRelease = () =>
  transitionRelease(undefined, {
    type: 'create',
    id: 'release-1',
    org_id: 'org-1',
    project_id: 'project-1',
    title: 'P1 core schema release flow',
    created_by_actor_id: 'actor-owner',
    at: timestamp,
  }).release;

const emptyScopeBlocker: ReleaseBlocker = {
  code: 'empty_work_item_scope',
  category: 'structural',
  overrideable: false,
  message: 'Release requires at least one valid work item.',
};

const blockerSnapshot = (releaseId: string, blockers: ReleaseBlocker[]): ReleaseBlockerSnapshot =>
  createReleaseBlockerSnapshot({
    release_id: releaseId,
    generated_at: timestamp,
    blockers,
  });

const workItem = (): WorkItem => ({
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Releaseable work item',
  goal: 'Ship the release.',
  success_criteria: ['Release gates pass.'],
  priority: 'P1',
  risk: 'medium',
  owner_actor_id: 'actor-owner',
  phase: 'done',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'completed',
  created_at: timestamp,
  updated_at: timestamp,
});

const executionPackage = (): ExecutionPackage => ({
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
});

const runSession = (): RunSession => ({
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
});

const reviewPacket = (): ReviewPacket => ({
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
});

const releasable = (release: Release): Release => ({
  ...release,
  work_item_ids: ['work-item-1'],
  execution_package_ids: ['package-1'],
  rollout_strategy: 'Deploy behind a flag.',
  rollback_plan: 'Disable the flag.',
  observation_plan: 'Watch errors.',
});

const gateContext = (release: Release, overrides: ReleaseGateContext = {}): ReleaseGateContext => ({
  release,
  work_items: [workItem()],
  execution_packages: [executionPackage()],
  run_sessions: [runSession()],
  review_packets: [reviewPacket()],
  evidence: [],
  ...overrides,
});

const currentSnapshot = (release: Release, overrides: ReleaseGateContext = {}): ReleaseBlockerSnapshot =>
  blockerSnapshot(release.id, deriveReleaseBlockers(gateContext(release, overrides)));

describe('Release state transitions', () => {
  it('creates a draft release in the not-submitted gate', () => {
    expect(releaseState(createRelease())).toEqual({
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
    });
  });

  it('creates a release with productized ownership, type, scope summary, and updater metadata', () => {
    const created = transitionRelease(undefined, {
      type: 'create',
      id: 'release-1',
      org_id: 'org-1',
      project_id: 'project-1',
      title: 'P1 core schema release flow',
      scope_summary: 'Ship release risk radar.',
      release_owner_actor_id: 'actor-owner',
      release_type: 'normal',
      created_by_actor_id: 'actor-creator',
      updated_by_actor_id: 'actor-creator',
      at: timestamp,
    }).release;

    expect(created).toMatchObject({
      scope_summary: 'Ship release risk radar.',
      release_owner_actor_id: 'actor-owner',
      release_type: 'normal',
      created_by_actor_id: 'actor-creator',
      updated_by_actor_id: 'actor-creator',
    });
  });

  it('moves to candidate after the first valid linked object', () => {
    const linked = transitionRelease(createRelease(), {
      type: 'link_work_item',
      work_item_id: 'work-item-1',
      at: timestamp,
    }).release;

    expect(releaseState(linked)).toEqual({
      phase: 'candidate',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
    });
  });

  it('submits a candidate release for approval', () => {
    const candidate = releasable(
      transitionRelease(
        transitionRelease(createRelease(), {
          type: 'link_work_item',
          work_item_id: 'work-item-1',
        }).release,
        {
          type: 'link_execution_package',
          execution_package_id: 'package-1',
        },
      ).release,
    );

    expect(
      releaseState(
        transitionRelease(candidate, {
          type: 'submit',
          gate_context: gateContext(candidate),
        }).release,
      ),
    ).toEqual({
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
      resolution: 'none',
    });
  });

  it('submits again from approval changes requested', () => {
    const changesRequested = {
      ...releasable(createRelease()),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'changes_requested',
    } as Release;

    expect(
      releaseState(
        transitionRelease(changesRequested, {
          type: 'submit',
          gate_context: gateContext(changesRequested),
          at: timestamp,
        }).release,
      ),
    ).toEqual({
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
      resolution: 'none',
    });
  });

  it('requests approval changes and records a changes-requested decision intent', () => {
    const release = {
      ...releasable(createRelease()),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;

    const result = transitionRelease(release, {
      type: 'request_changes',
      actor_id: 'actor-reviewer',
      rationale: 'Need rollout notes.',
      at: timestamp,
    });

    expect(result.release).toMatchObject({
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'changes_requested',
      resolution: 'none',
    });
    expect(result.decision_intents).toEqual([
      {
        object_type: 'release',
        object_id: 'release-1',
        actor_id: 'actor-reviewer',
        decision_type: 'release_changes_requested',
        outcome: 'changes_requested',
        reason: 'Need rollout notes.',
      },
    ]);
  });

  it('approves a release with no blockers for rollout', () => {
    const release = {
      ...releasable(createRelease()),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;

    const result = transitionRelease(release, {
      type: 'approve',
      approved_by_actor_id: 'actor-reviewer',
      gate_context: gateContext(release),
    });

    expect(releaseState(result.release)).toEqual({
      phase: 'rollout',
      activity_state: 'idle',
      gate_state: 'approved',
      resolution: 'none',
    });
    expect(result.decision_intents).toEqual([
      {
        object_type: 'release',
        object_id: 'release-1',
        actor_id: 'actor-reviewer',
        decision_type: 'release_approval',
        outcome: 'approved',
      },
    ]);
  });

  it('override-approves a release with overrideable blockers and records both decision intents', () => {
    const release = {
      ...releasable(createRelease()),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;
    const requestSnapshot = currentSnapshot(release, {
      evidence: [
        {
          id: 'evidence-1',
          release_id: release.id,
          evidence_type: 'review_packet',
          summary: 'Superseded review packet.',
          object_ref: {
            object_type: 'review_packet',
            object_id: 'review-packet-1',
            relationship: 'supports',
          },
          redacted: false,
          status: 'superseded',
          created_at: timestamp,
        },
      ],
    });
    const result = transitionRelease(release, {
      type: 'override_approve',
      approved_by_actor_id: 'actor-release-manager',
      rationale: 'Known flaky evidence service; reviewed manually.',
      blocker_snapshot: requestSnapshot,
      gate_context: gateContext(release, {
        evidence: [
          {
            id: 'evidence-1',
            release_id: release.id,
            evidence_type: 'review_packet',
            summary: 'Superseded review packet.',
            object_ref: {
              object_type: 'review_packet',
              object_id: 'review-packet-1',
              relationship: 'supports',
            },
            redacted: false,
            status: 'superseded',
            created_at: timestamp,
          },
        ],
      }),
    });

    expect(releaseState(result.release)).toEqual({
      phase: 'rollout',
      activity_state: 'idle',
      gate_state: 'approved',
      resolution: 'none',
    });
    expect(result.decision_intents).toEqual([
      {
        object_type: 'release',
        object_id: 'release-1',
        actor_id: 'actor-release-manager',
        decision_type: 'manual_override',
        outcome: 'override_approved',
        reason: 'Known flaky evidence service; reviewed manually.',
        blocker_snapshot: requestSnapshot,
      },
      {
        object_type: 'release',
        object_id: 'release-1',
        actor_id: 'actor-release-manager',
        decision_type: 'release_approval',
        outcome: 'override_approved',
        reason: 'Known flaky evidence service; reviewed manually.',
        blocker_snapshot: requestSnapshot,
      },
    ]);
  });

  it('starts observing after rollout', () => {
    const rollout = {
      ...createRelease(),
      phase: 'rollout',
      gate_state: 'approved',
    } as Release;

    expect(releaseState(transitionRelease(rollout, { type: 'start_observing' }).release)).toEqual({
      phase: 'observing',
      activity_state: 'idle',
      gate_state: 'rollout_succeeded',
      resolution: 'none',
    });
  });

  it('closes completed observing releases', () => {
    const observing = {
      ...createRelease(),
      phase: 'observing',
      gate_state: 'rollout_succeeded',
    } as Release;

    expect(releaseState(transitionRelease(observing, { type: 'close', resolution: 'completed' }).release)).toEqual({
      phase: 'completed',
      activity_state: 'idle',
      gate_state: 'rollout_succeeded',
      resolution: 'completed',
    });
  });

  it('closes completed with observation override and records override plus close decision intents', () => {
    const observing = {
      ...releasable(createRelease()),
      phase: 'observing',
      gate_state: 'rollout_succeeded',
    } as Release;
    const overrideContext = gateContext(observing, {
      evidence: [
        {
          id: 'evidence-1',
          release_id: observing.id,
          evidence_type: 'observation_note',
          summary: 'Known observation backlink issue.',
          extra: {
            observation: {
              source: 'human',
              severity: 'failure',
              summary: 'Issue without public release link',
              observed_at: timestamp,
              links: [{ object_type: 'work_item', object_id: 'work-item-1', relationship: 'affected' }],
            },
          },
          redacted: false,
          status: 'current',
          created_at: timestamp,
        },
      ],
    });
    const snapshot = currentSnapshot(observing, overrideContext);
    const result = transitionRelease(observing, {
      type: 'close_override',
      resolution: 'completed',
      actor_id: 'actor-release-manager',
      rationale: 'Observation issue is understood and publicly documented elsewhere.',
      blocker_snapshot: snapshot,
      gate_context: overrideContext,
      at: timestamp,
    });

    expect(releaseState(result.release)).toEqual({
      phase: 'completed',
      activity_state: 'idle',
      gate_state: 'rollout_succeeded',
      resolution: 'completed',
    });
    expect(result.decision_intents).toEqual([
      expect.objectContaining({
        actor_id: 'actor-release-manager',
        decision_type: 'manual_override',
        outcome: 'completed',
        reason: 'Observation issue is understood and publicly documented elsewhere.',
        blocker_snapshot: snapshot,
      }),
      expect.objectContaining({
        actor_id: 'actor-release-manager',
        decision_type: 'release_close',
        outcome: 'completed',
        reason: 'Observation issue is understood and publicly documented elsewhere.',
        blocker_snapshot: snapshot,
      }),
    ]);
  });

  it('rejects close override with a stale blocker snapshot', () => {
    const observing = {
      ...releasable(createRelease()),
      phase: 'observing',
      gate_state: 'rollout_succeeded',
    } as Release;
    const overrideContext = gateContext(observing, {
      evidence: [
        {
          id: 'evidence-1',
          release_id: observing.id,
          evidence_type: 'observation_note',
          summary: 'Known observation backlink issue.',
          extra: {
            observation: {
              source: 'human',
              severity: 'failure',
              summary: 'Issue without public release link',
              observed_at: timestamp,
              links: [{ object_type: 'work_item', object_id: 'work-item-1', relationship: 'affected' }],
            },
          },
          redacted: false,
          status: 'current',
          created_at: timestamp,
        },
      ],
    });
    const snapshot = currentSnapshot(observing, overrideContext);

    expect(() =>
      transitionRelease(observing, {
        type: 'close_override',
        resolution: 'completed',
        actor_id: 'actor-release-manager',
        rationale: 'Observation issue is understood.',
        blocker_snapshot: {
          ...snapshot,
          blocker_fingerprint: 'release-blockers:v1:stale',
        },
        gate_context: overrideContext,
        at: timestamp,
      }),
    ).toThrow(DomainError);
  });

  it.each(['rolled_back', 'cancelled'] as const)('closes %s releases', (resolution) => {
    const release = {
      ...createRelease(),
      phase: 'rollout',
      gate_state: resolution === 'rolled_back' ? 'rollout_failed' : 'approved',
    } as Release;

    expect(releaseState(transitionRelease(release, { type: 'close', resolution }).release)).toEqual({
      phase: 'closed',
      activity_state: 'idle',
      gate_state: release.gate_state,
      resolution,
    });
  });

  it.each([
    ['draft', 'not_submitted'],
    ['candidate', 'not_submitted'],
    ['approval', 'awaiting_approval'],
    ['approval', 'changes_requested'],
    ['rollout', 'approved'],
    ['observing', 'rollout_succeeded'],
  ] as const)('closes cancelled from %s/%s with the expected gate state', (phase, gateState) => {
    const release = {
      ...releasable(createRelease()),
      phase,
      gate_state: gateState,
      activity_state: phase === 'approval' ? 'awaiting_human' : 'idle',
    } as Release;

    expect(releaseState(transitionRelease(release, { type: 'close', resolution: 'cancelled', at: timestamp }).release)).toEqual({
      phase: 'closed',
      activity_state: 'idle',
      gate_state: gateState,
      resolution: 'cancelled',
    });
  });

  it('rejects structural blockers on submit, approve, and override approve', () => {
    const candidate = { ...releasable(createRelease()), phase: 'candidate' } as Release;
    const approval = {
      ...releasable(createRelease()),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;

    for (const transition of [
      () =>
        transitionRelease(candidate, {
          type: 'submit',
          gate_context: gateContext(candidate, {
            work_item_links: [{ object_id: 'work-item-1', status: 'missing' }],
          }),
        }),
      () =>
        transitionRelease(approval, {
          type: 'approve',
          approved_by_actor_id: 'actor-reviewer',
          gate_context: gateContext(approval, {
            work_item_links: [{ object_id: 'work-item-1', status: 'missing' }],
          }),
        }),
      () =>
        transitionRelease(approval, {
          type: 'override_approve',
          approved_by_actor_id: 'actor-reviewer',
          rationale: 'Manual approval.',
          blocker_snapshot: blockerSnapshot(approval.id, [emptyScopeBlocker]),
          gate_context: gateContext(approval, {
            work_item_links: [{ object_id: 'work-item-1', status: 'missing' }],
          }),
        }),
    ]) {
      expect(transition).toThrow(DomainError);
    }
  });

  it('rejects override approval with an empty blocker snapshot, blank rationale, or stale fingerprint', () => {
    const release = {
      ...releasable(createRelease()),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;
    const overrideableBlockerContext = gateContext(release, {
      evidence: [
        {
          id: 'evidence-1',
          release_id: release.id,
          evidence_type: 'review_packet',
          summary: 'Evidence was superseded after review.',
          object_ref: {
            object_type: 'review_packet',
            object_id: 'review-packet-1',
            relationship: 'supports',
          },
          redacted: false,
          status: 'superseded',
          created_at: timestamp,
        },
      ],
    });
    const validSnapshot = currentSnapshot(release, overrideableBlockerContext);

    expect(() =>
      transitionRelease(release, {
        type: 'override_approve',
        approved_by_actor_id: 'actor-reviewer',
        rationale: 'Manual approval.',
        blocker_snapshot: blockerSnapshot(release.id, []),
        gate_context: gateContext(release),
      }),
    ).toThrow(DomainError);
    expect(() =>
      transitionRelease(release, {
        type: 'override_approve',
        approved_by_actor_id: 'actor-reviewer',
        rationale: ' ',
        blocker_snapshot: validSnapshot,
        gate_context: overrideableBlockerContext,
      }),
    ).toThrow(DomainError);
    expect(() =>
      transitionRelease(release, {
        type: 'override_approve',
        approved_by_actor_id: 'actor-reviewer',
        rationale: 'Manual approval.',
        blocker_snapshot: {
          ...validSnapshot,
          blocker_fingerprint: 'release-blockers:v1:stale',
        },
        gate_context: overrideableBlockerContext,
      }),
    ).toThrow(DomainError);
  });

  it('rejects caller-supplied empty snapshots when current blockers exist', () => {
    const approval = {
      ...releasable(createRelease()),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
      rollout_strategy: undefined,
    } as Release;

    expect(() =>
      transitionRelease(approval, {
        type: 'approve',
        approved_by_actor_id: 'actor-reviewer',
        gate_context: gateContext(approval),
      }),
    ).toThrow(DomainError);
    expect(() =>
      transitionRelease(approval, {
        type: 'override_approve',
        approved_by_actor_id: 'actor-reviewer',
        rationale: 'Manual approval.',
        blocker_snapshot: blockerSnapshot(approval.id, []),
        gate_context: gateContext(approval),
      }),
    ).toThrow(DomainError);
  });

  it('submits with overrideable blockers and override-approves from normal lifecycle with matching current snapshot', () => {
    const linkedWorkItem = transitionRelease(createRelease(), {
      type: 'link_work_item',
      work_item_id: 'work-item-1',
    }).release;
    const candidate = {
      ...releasable(
        transitionRelease(linkedWorkItem, {
          type: 'link_execution_package',
          execution_package_id: 'package-1',
        }).release,
      ),
      rollout_strategy: undefined,
    };
    const submitResult = transitionRelease(candidate, {
      type: 'submit',
      gate_context: gateContext(candidate),
    });
    const approval = submitResult.release;
    const snapshot = currentSnapshot(approval);
    const result = transitionRelease(approval, {
      type: 'override_approve',
      approved_by_actor_id: 'actor-reviewer',
      rationale: 'Release manager accepted the planning risk.',
      blocker_snapshot: snapshot,
      gate_context: gateContext(approval),
    });

    expect(releaseState(approval)).toEqual({
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
      resolution: 'none',
    });
    expect(submitResult.blocker_snapshot?.blockers.map((blocker) => blocker.code)).toEqual(['missing_rollout_strategy']);
    expect(releaseState(result.release)).toEqual({
      phase: 'rollout',
      activity_state: 'idle',
      gate_state: 'approved',
      resolution: 'none',
    });
    expect(result.decision_intents).toEqual([
      expect.objectContaining({
        decision_type: 'manual_override',
        blocker_snapshot: snapshot,
      }),
      expect.objectContaining({
        decision_type: 'release_approval',
        blocker_snapshot: snapshot,
      }),
    ]);
  });

  it('blocks submit when any current blocker is non-overrideable', () => {
    const candidate = releasable(
      transitionRelease(createRelease(), {
        type: 'link_work_item',
        work_item_id: 'work-item-1',
      }).release,
    );

    expect(() =>
      transitionRelease(candidate, {
        type: 'submit',
        gate_context: gateContext(candidate, {
          execution_package_links: [{ object_id: 'package-1', status: 'missing' }],
        }),
      }),
    ).toThrow(DomainError);
  });

  it('supports the full release path from create through completion', () => {
    const linkedWorkItem = transitionRelease(createRelease(), {
      type: 'link_work_item',
      work_item_id: 'work-item-1',
    }).release;
    const candidate = transitionRelease(linkedWorkItem, {
      type: 'link_execution_package',
      execution_package_id: 'package-1',
    }).release;
    const approval = transitionRelease(releasable(candidate), {
      type: 'submit',
      gate_context: gateContext(releasable(candidate)),
    }).release;
    const rollout = transitionRelease(approval, {
      type: 'approve',
      approved_by_actor_id: 'actor-reviewer',
      gate_context: gateContext(approval),
    }).release;
    const observing = transitionRelease(rollout, { type: 'start_observing' }).release;
    const completed = transitionRelease(observing, { type: 'close', resolution: 'completed' }).release;

    expect(releaseState(completed)).toEqual({
      phase: 'completed',
      activity_state: 'idle',
      gate_state: 'rollout_succeeded',
      resolution: 'completed',
    });
  });
});
