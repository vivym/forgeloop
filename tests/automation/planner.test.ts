import { describe, expect, it } from 'vitest';

import {
  AutomationHttpClient,
  defaultGenerationPlanningConfig,
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
  planRevisionsRequiringPackages: [],
  runEnqueueDisabledPackages: [],
  activeHolds: [],
  recentActionRuns: [],
  runEnqueueDisabledReason: 'run_enqueue_disabled_by_scope',
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

const generationPlanning = (overrides: {
  mode?: 'disabled' | 'fake' | 'app_server';
  packageDraftsEnabled?: boolean;
  packageDraftsPromptVersion?: string;
} = {}) => ({
  mode: overrides.mode ?? 'fake',
  tasks: {
    package_drafts: {
      enabled: overrides.packageDraftsEnabled ?? true,
      promptVersion: overrides.packageDraftsPromptVersion ?? 'package-drafts.fake.v1',
      outputSchemaVersion: 'package_drafts.v1',
    },
  },
} as const);

describe('automation planner', () => {
  it('suppresses generation actions by default', () => {
    const actions = planNextActions(
      baseSnapshot({
        planRevisionsRequiringPackages: [packageTarget()],
      }),
    );

    expect(actions.map((action) => action.actionType)).not.toContain('ensure_package_drafts');
  });

  it('does not allow external mutation of the default generation planning config', () => {
    const resetPackageDraftsEnabled = defaultGenerationPlanningConfig.tasks.package_drafts.enabled;
    try {
      expect(() => {
        (defaultGenerationPlanningConfig.tasks.package_drafts as { enabled: boolean }).enabled = true;
      }).toThrow();
    } finally {
      if (!Object.isFrozen(defaultGenerationPlanningConfig.tasks.package_drafts)) {
        (defaultGenerationPlanningConfig.tasks.package_drafts as { enabled: boolean }).enabled = resetPackageDraftsEnabled;
      }
    }

    const actions = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }));
    expect(actions.map((action) => action.actionType)).not.toContain('ensure_package_drafts');
  });

  it('suppresses all generation actions when generation mode is disabled', () => {
    const actions = planNextActions(
      baseSnapshot({
        planRevisionsRequiringPackages: [packageTarget()],
      }),
      { generation: generationPlanning({ mode: 'disabled' }) },
    );

    expect(actions.map((action) => action.actionType)).not.toContain('ensure_package_drafts');
  });

  it('suppresses package draft actions in 2A when package_drafts is disabled', () => {
    const actions = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }), {
      generation: generationPlanning({ packageDraftsEnabled: false }),
    });

    expect(actions.map((action) => action.actionType)).not.toContain('ensure_package_drafts');
  });

  it('includes generation identity for package draft actions', () => {
    const baselineActions = planNextActions(
      baseSnapshot({
        planRevisionsRequiringPackages: [packageTarget()],
      }),
      { generation: generationPlanning() },
    );
    const changedPromptActions = planNextActions(
      baseSnapshot({
        planRevisionsRequiringPackages: [packageTarget()],
      }),
      {
        generation: generationPlanning({
          packageDraftsPromptVersion: 'package-drafts.fake.v2',
        }),
      },
    );

    expect(changedPromptActions.find((action) => action.actionType === 'ensure_package_drafts')?.idempotencyKey).not.toBe(
      baselineActions.find((action) => action.actionType === 'ensure_package_drafts')?.idempotencyKey,
    );
    expect(changedPromptActions.find((action) => action.actionType === 'ensure_package_drafts')?.actionInputJson).toMatchObject({
      prompt_version: 'package-drafts.fake.v2',
      output_schema_version: 'package_drafts.v1',
    });
  });

  it('orders app_server runtime projection before generation actions', () => {
    const actions = planNextActions(
      baseSnapshot({
        repos: [
          {
            projectId: 'project-1',
            repoId: 'repo-1',
            automationScope: repoScope,
            automationSettingsVersion: 3,
            capabilityFingerprint: 'capability-fingerprint-1',
            daemonInternalLocalPath: '/private/repo-1',
            policyProjection: {
              automationScope: repoScope,
              repoId: 'repo-1',
              policyStatus: 'loaded',
              policyDigest: 'sha256:policy',
              parserVersion: 'workflow-md-parser:v1',
            },
          },
        ],
        planRevisionsRequiringPackages: [packageTarget()],
      }),
      { generation: generationPlanning({ mode: 'app_server' }) },
    );

    expect(actions.map((action) => action.actionType)).toEqual([
      'project_runtime_snapshot',
      'ensure_package_drafts',
    ]);
  });

  it('emits package drafts when generation is enabled', () => {
    const actions = planNextActions(
      baseSnapshot({
        planRevisionsRequiringPackages: [packageTarget()],
      }),
      { generation: generationPlanning() },
    );

    expect(actions.map((action) => action.actionType)).toEqual(['ensure_package_drafts']);
  });

  it('emits ensure_package_drafts for an approved PlanRevision missing package drafts', () => {
    const actions = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }), {
      generation: generationPlanning(),
    });

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
        planRevisionsRequiringPackages: [
          packageTarget({ activeHoldFingerprint: 'package_generation:plan-revision-1:manual' }),
        ],
      }),
      { generation: generationPlanning() },
    );

    expect(actions).toEqual([]);
  });

  it('suppresses package actions for an active hold before multi-repo ambiguity checks', () => {
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
        planRevisionsRequiringPackages: [
          packageTarget({
            projectId: 'project-1',
            repoId: undefined,
            automationScope: 'project:project-1',
            activeHoldFingerprint: 'package_generation:plan-revision-1:manual',
          }),
        ],
      }),
      { generation: generationPlanning() },
    );

    expect(actions).toEqual([]);
  });

  it('requests a manual path when a project-scoped target is ambiguous across multiple repos', () => {
    const ambiguousTarget = packageTarget({
      projectId: 'project-1',
      repoId: undefined,
      eligibleRepoIds: ['repo-2', 'repo-3'],
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
          {
            projectId: 'project-1',
            repoId: 'repo-3',
            automationScope: 'repo:project-1:repo-3',
            automationSettingsVersion: 5,
            capabilityFingerprint: 'capability-fingerprint-3',
            daemonInternalLocalPath: '/private/repo-3',
          },
        ],
        planRevisionsRequiringPackages: [ambiguousTarget],
      }),
      { generation: generationPlanning() },
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionType: 'request_manual_path',
      targetObjectType: 'plan_revision',
      targetObjectId: 'plan-revision-1',
      automationScope: 'repo:project-1:repo-2',
      reasonCode: 'multi_repo_ambiguity',
      actionInputJson: {
        object_type: 'plan_revision',
        object_id: 'plan-revision-1',
        scope_key: 'plan_revision:plan-revision-1',
        reason_code: 'multi_repo_ambiguity',
      },
    });
    expect(String(actions[0]?.summary)).toContain('multiple repos');
  });

  it('changes mutating precondition and idempotency when target status changes', () => {
    const approvedAction = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }), {
      generation: generationPlanning(),
    })[0]!;
    const changedStatusAction = planNextActions(
      baseSnapshot({ planRevisionsRequiringPackages: [packageTarget({ targetStatus: 'ready_for_repackage' })] }),
      { generation: generationPlanning() },
    )[0]!;

    expect(changedStatusAction.preconditionFingerprint).not.toBe(approvedAction.preconditionFingerprint);
    expect(changedStatusAction.idempotencyKey).not.toBe(approvedAction.idempotencyKey);
  });

  it('changes mutating precondition and idempotency when generation key changes', () => {
    const defaultAction = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }), {
      generation: generationPlanning(),
    })[0]!;
    const changedGenerationAction = planNextActions(
      baseSnapshot({
        planRevisionsRequiringPackages: [
          packageTarget({
            generationKey: 'retry:plan-revision-1',
          }),
        ],
      }),
      { generation: generationPlanning() },
    )[0]!;

    expect(changedGenerationAction.preconditionFingerprint).not.toBe(defaultAction.preconditionFingerprint);
    expect(changedGenerationAction.idempotencyKey).not.toBe(defaultAction.idempotencyKey);
  });

  it('does not include policy projection fields in mutating preconditions', () => {
    const baseline = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }), {
      generation: generationPlanning(),
    })[0]!;
    const changedPolicyProjection = planNextActions(
      baseSnapshot({
        repos: [
          {
            ...baseSnapshot().repos[0]!,
            policyProjection: {
              automationScope: repoScope,
              repoId: 'repo-1',
              policyStatus: 'loaded',
              policyDigest: 'workflow-digest-changed',
              parserVersion: 'workflow-md-parser:v2',
              reasonCode: 'loaded',
            },
          },
        ],
        planRevisionsRequiringPackages: [packageTarget()],
      }),
      { generation: generationPlanning() },
    ).find((action) => action.actionType === 'ensure_package_drafts')!;

    expect(changedPolicyProjection.preconditionFingerprint).toBe(baseline.preconditionFingerprint);
    expect(changedPolicyProjection.idempotencyKey).toBe(baseline.idempotencyKey);
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
            blockers: [
              {
                targetObjectType: 'execution_package',
                targetObjectId: 'execution-package-1',
                targetRevisionId: 'plan-revision-1',
                repoId: 'repo-1',
                blockedReasonCode: 'runtime_hard_limits_unavailable',
                blockedSummary: 'Runtime hard limits are unavailable.',
                retryable: true,
              },
            ],
          },
        ],
      }),
    );

    expect(actions.map((action) => action.actionType)).not.toContain('enqueue_run');
    expect(actions).toEqual([]);
  });

  it('does not emit enqueue actions even when ready packages have no runtime blockers', () => {
    const actions = planNextActions(
      baseSnapshot({
        runEnqueueDisabledPackages: [
          {
            targetObjectType: 'execution_package',
            targetObjectId: 'execution-package-runtime-satisfied',
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

    expect(actions).not.toContainEqual(expect.objectContaining({ actionType: expect.stringMatching(/enqueue/i) }));
    expect(actions).toEqual([]);
  });

  it('parses runtime blockers and singular aliases from HTTP snapshots', async () => {
    const client = new AutomationHttpClient({
      baseUrl: 'http://control-plane.test',
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      secret: 'test-secret',
      now: () => generatedAt,
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          generated_at: generatedAt,
          projects: [],
          repos: [],
          plan_revisions_requiring_packages: [
            {
              target_object_type: 'plan_revision',
              target_object_id: 'plan-revision-1',
              target_revision_id: 'default:plan-revision-1',
              target_status: 'approved',
              project_id: 'project-1',
              repo_id: 'repo-1',
              automation_scope: repoScope,
              blocked_reason_code: 'runtime_policy_invalid',
              blocked_summary: 'Runtime policy is invalid.',
              blockers: [
                {
                  target_object_type: 'plan_revision',
                  target_object_id: 'plan-revision-1',
                  target_revision_id: 'default:plan-revision-1',
                  repo_id: 'repo-1',
                  blocked_reason_code: 'runtime_policy_invalid',
                  blocked_summary: 'Runtime policy is invalid.',
                  retryable: false,
                  policy_digest: 'sha256:policy',
                  policy_snapshot_version: 2,
                  diagnostic_ref: 'diag:runtime-policy',
                },
              ],
            },
          ],
          run_enqueue_disabled_packages: [],
          active_holds: [],
          recent_action_runs: [],
          run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope',
        }),
        text: async () => '',
      }),
    });

    const snapshot = await client.runtimeSnapshot();

    expect(snapshot.planRevisionsRequiringPackages[0]).toMatchObject({
      blockedReasonCode: 'runtime_policy_invalid',
      blockedSummary: 'Runtime policy is invalid.',
      blockers: [
        {
          targetObjectType: 'plan_revision',
          targetObjectId: 'plan-revision-1',
          targetRevisionId: 'default:plan-revision-1',
          repoId: 'repo-1',
          blockedReasonCode: 'runtime_policy_invalid',
          blockedSummary: 'Runtime policy is invalid.',
          retryable: false,
          policyDigest: 'sha256:policy',
          policySnapshotVersion: 2,
          diagnosticRef: 'diag:runtime-policy',
        },
      ],
    });
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
      targetObjectType: 'repo',
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
    const plannedDraft = planNextActions(baseSnapshot({ planRevisionsRequiringPackages: [packageTarget()] }), {
      generation: generationPlanning(),
    })[0]!;
    const plannedProjection = planNextActions(
      baseSnapshot({
        repos: [{ ...baseSnapshot().repos[0]!, policyProjection: projectionIdentity }],
      }),
    )[0]!;

    const actions = planNextActions(
      baseSnapshot({
        planRevisionsRequiringPackages: [packageTarget()],
        repos: [{ ...baseSnapshot().repos[0]!, policyProjection: projectionIdentity }],
        recentActionRuns: [
          {
            id: 'action-running',
            actionType: 'ensure_package_drafts',
            targetObjectType: 'plan_revision',
            targetObjectId: 'plan-revision-1',
            targetRevisionId: 'default:plan-revision-1',
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
            targetObjectType: 'repo',
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
      { generation: generationPlanning() },
    );

    expect(actions).toEqual([]);
  });
});
