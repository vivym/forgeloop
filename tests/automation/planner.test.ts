import { describe, expect, it } from 'vitest';

import {
  planNextActions,
  projectRuntimeSnapshotIdempotencyKey,
  type RuntimeSnapshot,
  type RuntimeSnapshotTarget,
} from '../../packages/automation/src/index';

const generatedAt = '2026-05-15T00:00:00.000Z';
const repoScope = 'repo:project-1:repo-1' as const;

const baseSnapshot = (overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot => ({
  generatedAt,
  projects: [
    {
      projectId: 'project-1',
      automationScope: repoScope,
      automationSettingsVersion: 3,
      capabilityFingerprint: 'capability-fingerprint-1',
    },
  ],
  repos: [
    {
      projectId: 'project-1',
      repoId: 'repo-1',
      automationScope: repoScope,
      automationSettingsVersion: 3,
      capabilityFingerprint: 'capability-fingerprint-1',
      daemonInternalLocalPath: '/private/repo-1',
    },
  ],
  workItemsRequiringPlan: [],
  planRevisionsRequiringPackages: [],
  runEnqueueDisabledPackages: [],
  activeHolds: [],
  recentActionRuns: [],
  runEnqueueDisabledReason: 'run_enqueue_disabled_by_scope',
  ...overrides,
});

const workItemTarget = (overrides: Partial<RuntimeSnapshotTarget> = {}): RuntimeSnapshotTarget => ({
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  targetRevisionId: 'spec-revision-1',
  targetStatus: 'approved',
  projectId: 'project-1',
  repoId: 'repo-1',
  automationScope: repoScope,
  ...overrides,
});

const packageTarget = (overrides: Partial<RuntimeSnapshotTarget> = {}): RuntimeSnapshotTarget => ({
  targetObjectType: 'plan_revision',
  targetObjectId: 'plan-revision-1',
  targetRevisionId: 'default:plan-revision-1',
  targetStatus: 'approved',
  projectId: 'project-1',
  repoId: 'repo-1',
  automationScope: repoScope,
  generationKey: 'default:plan-revision-1',
  ...overrides,
});

describe('automation planner', () => {
  it('emits ensure_plan_draft for an approved Spec missing a Plan draft', () => {
    const actions = planNextActions(baseSnapshot({ workItemsRequiringPlan: [workItemTarget()] }));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionType: 'ensure_plan_draft',
      targetObjectType: 'work_item',
      targetObjectId: 'work-item-1',
      targetRevisionId: 'spec-revision-1',
      targetStatus: 'approved',
      automationScope: repoScope,
      actionInputJson: {
        work_item_id: 'work-item-1',
        spec_revision_id: 'spec-revision-1',
      },
    });
    expect(actions[0]?.policyDigest).toBeUndefined();
  });

  it('emits ensure_package_drafts for an approved PlanRevision missing package drafts', () => {
    const actions = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionType: 'ensure_package_drafts',
      targetObjectType: 'plan_revision',
      targetObjectId: 'plan-revision-1',
      targetRevisionId: 'default:plan-revision-1',
      actionInputJson: {
        plan_revision_id: 'plan-revision-1',
        generation_key: 'default:plan-revision-1',
      },
    });
  });

  it('does not create draft actions while an active hold is present', () => {
    const actions = planNextActions(
      baseSnapshot({
        workItemsRequiringPlan: [workItemTarget({ activeHoldFingerprint: 'work_item:work-item-1:manual' })],
        planRevisionsRequiringPackages: [
          packageTarget({ activeHoldFingerprint: 'package_generation:plan-revision-1:manual' }),
        ],
      }),
    );

    expect(actions).toEqual([]);
  });

  it('requests a manual path when a project-scoped target is ambiguous across multiple repos', () => {
    const ambiguousTarget = workItemTarget({
      targetObjectId: 'work-item-ambiguous',
      projectId: 'project-1',
      repoId: undefined,
      automationScope: 'project:project-1',
    });
    const actions = planNextActions(
      baseSnapshot({
        repos: [
          baseSnapshot().repos[0]!,
          {
            projectId: 'project-1',
            repoId: 'repo-2',
            automationScope: 'repo:project-1:repo-2',
            automationSettingsVersion: 4,
            capabilityFingerprint: 'capability-fingerprint-2',
            daemonInternalLocalPath: '/private/repo-2',
          },
        ],
        workItemsRequiringPlan: [ambiguousTarget],
      }),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionType: 'request_manual_path',
      targetObjectType: 'work_item',
      targetObjectId: 'work-item-ambiguous',
      reasonCode: 'multi_repo_ambiguity',
      actionInputJson: {
        object_type: 'work_item',
        object_id: 'work-item-ambiguous',
        scope_key: 'work_item:work-item-ambiguous',
        reason_code: 'multi_repo_ambiguity',
      },
    });
    expect(String(actions[0]?.summary)).toContain('multiple repos');
  });

  it('never emits run enqueue actions for ready package projections', () => {
    const actions = planNextActions(
      baseSnapshot({
        runEnqueueDisabledPackages: [
          {
            targetObjectType: 'execution_package',
            targetObjectId: 'execution-package-1',
            targetRevisionId: 'plan-revision-1',
            targetStatus: 'ready',
            projectId: 'project-1',
            repoId: 'repo-1',
            automationScope: repoScope,
            disabledReason: 'run_enqueue_disabled_by_scope',
          },
        ],
      }),
    );

    expect(actions.map((action) => action.actionType)).not.toContain('enqueue_run');
    expect(actions).toEqual([]);
  });

  it('emits project_runtime_snapshot for a new WORKFLOW.md observation', () => {
    const observation = {
      automationScope: repoScope,
      repoId: 'repo-1',
      policyStatus: 'loaded',
      policyDigest: 'workflow-digest-1',
      parserVersion: 'workflow-md-parser:v1',
      reasonCode: 'loaded',
    } as const;
    const actions = planNextActions(
      baseSnapshot({
        repos: [
          {
            ...baseSnapshot().repos[0]!,
            policyProjection: {
              ...observation,
              observedAt: '2026-05-15T00:00:01.000Z',
              lastKnownGood: {
                ...observation,
                policyDigest: 'old-digest',
              },
            },
          },
        ],
      }),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'project_repo',
      targetObjectId: 'repo-1',
      automationScope: repoScope,
      idempotencyKey: projectRuntimeSnapshotIdempotencyKey(observation),
      actionInputJson: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'workflow-digest-1',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'loaded',
      },
    });
    expect(JSON.stringify(actions[0]?.actionInputJson)).not.toContain('/private/repo-1');
    expect(JSON.stringify(actions[0]?.actionInputJson)).not.toContain('old-digest');
  });

  it('suppresses duplicate actions with matching pending, running, or completed action runs', () => {
    const projectionIdentity = {
      automationScope: repoScope,
      repoId: 'repo-1',
      policyStatus: 'missing',
      parserVersion: 'workflow-md-parser:v1',
      reasonCode: 'not_found',
    } as const;
    const plannedDraft = planNextActions(baseSnapshot({ workItemsRequiringPlan: [workItemTarget()] }))[0]!;
    const plannedProjection = planNextActions(
      baseSnapshot({
        repos: [{ ...baseSnapshot().repos[0]!, policyProjection: projectionIdentity }],
      }),
    )[0]!;

    const actions = planNextActions(
      baseSnapshot({
        workItemsRequiringPlan: [workItemTarget()],
        repos: [{ ...baseSnapshot().repos[0]!, policyProjection: projectionIdentity }],
        recentActionRuns: [
          {
            id: 'action-running',
            actionType: 'ensure_plan_draft',
            targetObjectType: 'work_item',
            targetObjectId: 'work-item-1',
            targetRevisionId: 'spec-revision-1',
            targetStatus: 'approved',
            idempotencyKey: plannedDraft.idempotencyKey,
            automationScope: repoScope,
            automationSettingsVersion: 3,
            capabilityFingerprint: 'capability-fingerprint-1',
            preconditionFingerprint: plannedDraft.preconditionFingerprint,
            status: 'running',
          },
          {
            id: 'action-projected',
            actionType: 'project_runtime_snapshot',
            targetObjectType: 'project_repo',
            targetObjectId: 'repo-1',
            targetStatus: 'missing',
            idempotencyKey: plannedProjection.idempotencyKey,
            automationScope: repoScope,
            automationSettingsVersion: 3,
            capabilityFingerprint: 'capability-fingerprint-1',
            preconditionFingerprint: plannedProjection.preconditionFingerprint,
            status: 'succeeded',
          },
        ],
      }),
    );

    expect(actions).toEqual([]);
  });
});
