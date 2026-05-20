import type { ExecutionPackage, ReviewPacket, RunSession } from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  currentApprovedPlanPackages,
  selectWorkItemReviewPacket,
  selectWorkItemRunSession,
} from '../../packages/db/src/queries/work-item-delivery-selection';

const now = '2026-05-20T00:00:00.000Z';

const packageFixture = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: 'package-1',
  work_item_id: 'wi-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-r1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-r1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement the selected package.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'review',
  activity_state: 'idle',
  gate_state: 'awaiting_human_review',
  resolution: 'none',
  required_checks: [],
  required_artifact_kinds: [],
  allowed_paths: [],
  forbidden_paths: [],
  source_mutation_policy: 'path_policy_scoped',
  version: 1,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const runFixture = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-1',
  execution_package_id: 'package-1',
  requested_by_actor_id: 'actor-owner',
  status: 'succeeded',
  changed_files: [],
  check_results: [],
  artifacts: [],
  log_refs: [],
  created_at: now,
  updated_at: now,
  ...overrides,
});

const reviewPacketFixture = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-1',
  run_session_id: 'run-1',
  execution_package_id: 'package-1',
  reviewer_actor_id: 'actor-reviewer',
  spec_revision_id: 'spec-r1',
  plan_revision_id: 'plan-r1',
  status: 'ready',
  decision: 'none',
  changed_files: [],
  check_result_summary: 'Checks passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Ready for review.',
    spec_plan_alignment: 'Aligned.',
    test_assessment: 'Covered.',
    risk_notes: [],
    follow_up_questions: [],
  },
  risk_notes: [],
  requested_changes: [],
  created_at: now,
  updated_at: now,
  ...overrides,
});

describe('Work Item delivery selection', () => {
  it('selects only current approved-plan packages in input order', () => {
    const packages = [
      packageFixture({ id: 'stale-spec', spec_revision_id: 'spec-r0' }),
      packageFixture({ id: 'current-1' }),
      packageFixture({ id: 'other-work-item', work_item_id: 'wi-2' }),
      packageFixture({ id: 'archived', archived_at: '2026-05-20T00:01:00.000Z' }),
      packageFixture({ id: 'current-2' }),
      packageFixture({ id: 'stale-plan', plan_revision_id: 'plan-r0' }),
      packageFixture({ id: 'deleted', deleted_at: '2026-05-20T00:02:00.000Z' }),
    ] as const;

    expect(
      currentApprovedPlanPackages(packages, {
        workItemId: 'wi-1',
        approvedSpecRevisionId: 'spec-r1',
        approvedPlanRevisionId: 'plan-r1',
      }).map((item) => item.id),
    ).toEqual(['current-1', 'current-2']);
  });

  it('selects current run, then last run, then latest package run', () => {
    const runs = [
      runFixture({
        id: 'latest-other-package',
        execution_package_id: 'package-2',
        created_at: '2026-05-20T00:04:00.000Z',
      }),
      runFixture({ id: 'latest', created_at: '2026-05-20T00:03:00.000Z' }),
      runFixture({ id: 'last', created_at: '2026-05-20T00:02:00.000Z' }),
      runFixture({ id: 'current', created_at: '2026-05-20T00:01:00.000Z' }),
    ] as const;

    expect(
      selectWorkItemRunSession(packageFixture({ current_run_session_id: 'current', last_run_session_id: 'last' }), runs)
        ?.id,
    ).toBe('current');
    expect(selectWorkItemRunSession(packageFixture({ last_run_session_id: 'last' }), runs)?.id).toBe('last');
    expect(selectWorkItemRunSession(packageFixture({}), runs)?.id).toBe('latest');
  });

  it('selects current review, selected-run review, then latest package review', () => {
    const reviews = [
      reviewPacketFixture({
        id: 'latest-other-package',
        execution_package_id: 'package-2',
        run_session_id: 'run-2',
        updated_at: '2026-05-20T00:04:00.000Z',
      }),
      reviewPacketFixture({ id: 'latest', run_session_id: 'run-2', updated_at: '2026-05-20T00:03:00.000Z' }),
      reviewPacketFixture({ id: 'selected-run', run_session_id: 'run-1', updated_at: '2026-05-20T00:02:00.000Z' }),
      reviewPacketFixture({ id: 'current', run_session_id: 'run-0', updated_at: '2026-05-20T00:01:00.000Z' }),
    ] as const;

    expect(
      selectWorkItemReviewPacket(
        packageFixture({ current_review_packet_id: 'current' }),
        runFixture({ id: 'run-1' }),
        reviews,
      )?.id,
    ).toBe('current');
    expect(selectWorkItemReviewPacket(packageFixture({}), runFixture({ id: 'run-1' }), reviews)?.id).toBe(
      'selected-run',
    );
    expect(selectWorkItemReviewPacket(packageFixture({}), runFixture({ id: 'missing' }), reviews)?.id).toBe('latest');
  });

  it('uses deterministic tie-breakers without mutating inputs', () => {
    const tiedRuns = [
      runFixture({ id: 'run-b', created_at: '2026-05-20T00:05:00.000Z' }),
      runFixture({ id: 'run-a', created_at: '2026-05-20T00:05:00.000Z' }),
    ] as const;
    const tiedReviews = [
      reviewPacketFixture({ id: 'review-b', updated_at: '2026-05-20T00:05:00.000Z' }),
      reviewPacketFixture({ id: 'review-a', updated_at: '2026-05-20T00:05:00.000Z' }),
    ] as const;

    expect(selectWorkItemRunSession(packageFixture({}), tiedRuns)?.id).toBe('run-a');
    expect(selectWorkItemReviewPacket(packageFixture({}), undefined, tiedReviews)?.id).toBe('review-a');
    expect(tiedRuns.map((run) => run.id)).toEqual(['run-b', 'run-a']);
    expect(tiedReviews.map((review) => review.id)).toEqual(['review-b', 'review-a']);
  });

  it('ignores runtime values without package ids', () => {
    const unscopedRun = {
      id: 'unscoped-run',
      created_at: '2026-05-20T00:06:00.000Z',
    } as unknown as RunSession;
    const unscopedReview = {
      id: 'unscoped-review',
      run_session_id: 'run-1',
      updated_at: '2026-05-20T00:06:00.000Z',
    } as unknown as ReviewPacket;

    expect(
      selectWorkItemRunSession(packageFixture({}), [
        runFixture({ id: 'package-run', created_at: '2026-05-20T00:05:00.000Z' }),
        unscopedRun,
      ])?.id,
    ).toBe('package-run');
    expect(
      selectWorkItemReviewPacket(packageFixture({}), runFixture({ id: 'run-1' }), [
        reviewPacketFixture({ id: 'package-review', updated_at: '2026-05-20T00:05:00.000Z' }),
        unscopedReview,
      ])?.id,
    ).toBe('package-review');
  });
});
