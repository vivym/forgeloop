import { describe, expect, it } from 'vitest';

import {
  DomainError,
  transitionRelease,
  type Release,
  type ReleaseBlocker,
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
  code: 'empty_release_scope',
  category: 'structural',
  overrideable: false,
  message: 'Release requires at least one valid work item and execution package.',
};

describe('Release state transitions', () => {
  it('creates a draft release in the not-submitted gate', () => {
    expect(releaseState(createRelease())).toEqual({
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
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
    const candidate = transitionRelease(createRelease(), {
      type: 'link_execution_package',
      execution_package_id: 'package-1',
    }).release;

    expect(releaseState(transitionRelease(candidate, { type: 'submit', blockers: [] }).release)).toEqual({
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
      resolution: 'none',
    });
  });

  it('approves a release with no blockers for rollout', () => {
    const release = {
      ...createRelease(),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;

    const result = transitionRelease(release, {
      type: 'approve',
      approved_by_actor_id: 'actor-reviewer',
      blockers: [],
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
      ...createRelease(),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;
    const result = transitionRelease(release, {
      type: 'override_approve',
      approved_by_actor_id: 'actor-release-manager',
      reason: 'Known flaky evidence service; reviewed manually.',
      blockers: [
        {
          code: 'stale_or_superseded_evidence',
          category: 'evidence',
          overrideable: true,
          message: 'Evidence was superseded after review.',
        },
      ],
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
      },
      {
        object_type: 'release',
        object_id: 'release-1',
        actor_id: 'actor-release-manager',
        decision_type: 'release_approval',
        outcome: 'override_approved',
        reason: 'Known flaky evidence service; reviewed manually.',
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

  it('rejects structural blockers on submit, approve, and override approve', () => {
    const candidate = { ...createRelease(), phase: 'candidate' } as Release;
    const approval = {
      ...createRelease(),
      phase: 'approval',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_approval',
    } as Release;

    for (const transition of [
      () => transitionRelease(candidate, { type: 'submit', blockers: [emptyScopeBlocker] }),
      () =>
        transitionRelease(approval, {
          type: 'approve',
          approved_by_actor_id: 'actor-reviewer',
          blockers: [emptyScopeBlocker],
        }),
      () =>
        transitionRelease(approval, {
          type: 'override_approve',
          approved_by_actor_id: 'actor-reviewer',
          reason: 'Manual approval.',
          blockers: [emptyScopeBlocker],
        }),
    ]) {
      expect(transition).toThrow(DomainError);
    }
  });
});
