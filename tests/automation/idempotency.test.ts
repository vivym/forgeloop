import { describe, expect, it } from 'vitest';

import {
  mutatingActionIdempotencyKey,
  planNextActions,
  projectRuntimeSnapshotIdempotencyKey,
  type AutomationExecutorResult,
  type AutomationPlannerInput,
  type MutatingActionIdentity,
  type NoAction,
  type RuntimeSnapshot,
  type StablePolicyObservationIdentity,
  type WorkflowPolicyDigestStatus,
} from '../../packages/automation/src/index';

describe('automation idempotency helpers', () => {
  const repoScope = 'repo:project-1:repo-1' as const;
  const base = {
    actionType: 'ensure_package_drafts',
    targetObjectType: 'plan_revision',
    targetObjectId: 'plan-revision-1',
    targetRevisionId: 'plan-revision-1:v1',
    automationScope: 'repo:project-1:repo-1',
    automationSettingsVersion: 7,
    capabilityFingerprint: 'capability-a',
    preconditionFingerprint: 'precondition-a',
    generationKey: 'default:plan-revision-1',
    policyDigest: 'policy-digest-a',
  } satisfies MutatingActionIdentity;

  const observationA = {
    automationScope: 'repo:project-1:repo-1',
    repoId: 'repo-1',
    policyStatus: 'loaded',
    policyDigest: 'policy-digest-a',
    parserVersion: 'workflow-md-parser:v1',
    reasonCode: 'loaded',
  } satisfies StablePolicyObservationIdentity;

  const runtimeSnapshot = (): RuntimeSnapshot => ({
    generatedAt: '2026-05-15T00:00:00.000Z',
    projects: [],
    repos: [
      {
        projectId: 'project-1',
        repoId: 'repo-1',
        automationScope: repoScope,
        automationSettingsVersion: 3,
        capabilityFingerprint: 'capability-1',
        daemonInternalLocalPath: '/repo-1',
      },
    ],
    workItemsRequiringSpec: [],
    workItemsRequiringPlan: [
      {
        targetObjectType: 'work_item',
        targetObjectId: 'work-item-1',
        targetRevisionId: 'spec-revision-1',
        targetStatus: 'approved',
        projectId: 'project-1',
        repoId: 'repo-1',
        automationScope: repoScope,
      },
    ],
    planRevisionsRequiringPackages: [
      {
        targetObjectType: 'plan_revision',
        targetObjectId: 'plan-revision-1',
        targetRevisionId: 'default:plan-revision-1',
        targetStatus: 'approved',
        projectId: 'project-1',
        repoId: 'repo-1',
        automationScope: repoScope,
        generationKey: 'default:plan-revision-1',
      },
    ],
    recentActionRuns: [],
    runEnqueueDisabledReason: 'run_enqueue_disabled_by_scope',
  });

  const generationPlanning = (overrides: {
    planDraftPromptVersion?: string;
    packageDraftsPromptVersion?: string;
  } = {}) => ({
    mode: 'fake',
    tasks: {
      spec_draft: {
        enabled: false,
        promptVersion: 'SPEC-draft.fake.v1',
        outputSchemaVersion: 'spec_draft.v1',
      },
      plan_draft: {
        enabled: true,
        promptVersion: overrides.planDraftPromptVersion ?? 'PLAN-draft.fake.v1',
        outputSchemaVersion: 'plan_draft.v1',
      },
      package_drafts: {
        enabled: true,
        promptVersion: overrides.packageDraftsPromptVersion ?? 'package-drafts.fake.v1',
        outputSchemaVersion: 'package_drafts.v1',
      },
    },
  } as const);

  it('builds stable mutating action keys from durable command identity', () => {
    expect(mutatingActionIdempotencyKey(base)).toBe(mutatingActionIdempotencyKey(base));
    expect(mutatingActionIdempotencyKey({ ...base, capabilityFingerprint: 'changed' })).not.toBe(
      mutatingActionIdempotencyKey(base),
    );
    expect(mutatingActionIdempotencyKey({ ...base, policyDigest: 'ignored' })).toBe(mutatingActionIdempotencyKey(base));
  });

  it('canonicalizes mutating action identity field order', () => {
    const first = mutatingActionIdempotencyKey({
      actionType: base.actionType,
      targetObjectType: base.targetObjectType,
      targetObjectId: base.targetObjectId,
      targetRevisionId: base.targetRevisionId,
      automationScope: base.automationScope,
      automationSettingsVersion: base.automationSettingsVersion,
      capabilityFingerprint: base.capabilityFingerprint,
      preconditionFingerprint: base.preconditionFingerprint,
      generationKey: base.generationKey,
    });
    const reordered = mutatingActionIdempotencyKey({
      generationKey: base.generationKey,
      preconditionFingerprint: base.preconditionFingerprint,
      capabilityFingerprint: base.capabilityFingerprint,
      automationSettingsVersion: base.automationSettingsVersion,
      automationScope: base.automationScope,
      targetRevisionId: base.targetRevisionId,
      targetObjectId: base.targetObjectId,
      targetObjectType: base.targetObjectType,
      actionType: base.actionType,
    });
    const changed = mutatingActionIdempotencyKey({
      ...base,
      generationKey: 'changed',
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('includes command-specific mutating identity keys', () => {
    const manualPathBase = {
      ...base,
      actionType: 'request_manual_path',
      generationKey: undefined,
      manualPathScopeKey: 'work_item:work-item-1',
      manualPathReasonCode: 'needs_human_triage',
    } satisfies MutatingActionIdentity;

    expect(mutatingActionIdempotencyKey({ ...manualPathBase, policyDigest: 'ignored' })).toBe(
      mutatingActionIdempotencyKey(manualPathBase),
    );
    expect(mutatingActionIdempotencyKey({ ...manualPathBase, manualPathScopeKey: 'work_item:work-item-2' })).not.toBe(
      mutatingActionIdempotencyKey(manualPathBase),
    );
    expect(mutatingActionIdempotencyKey({ ...manualPathBase, manualPathReasonCode: 'needs_human_review' })).not.toBe(
      mutatingActionIdempotencyKey(manualPathBase),
    );
  });

  it('includes Spec draft generation mode and schema identity', () => {
    const specDraftBase = {
      actionType: 'ensure_SPEC_draft',
      targetObjectType: 'work_item',
      targetObjectId: 'work-item-1',
      automationScope: 'repo:project-1:repo-1',
      automationSettingsVersion: 3,
      capabilityFingerprint: 'capability-1',
      preconditionFingerprint: 'precondition-1',
      generationMode: 'fake',
      promptVersion: 'SPEC-draft.fake.v1',
      outputSchemaVersion: 'spec_draft.v1',
    } satisfies MutatingActionIdentity;

    expect(mutatingActionIdempotencyKey(specDraftBase)).not.toBe(
      mutatingActionIdempotencyKey({ ...specDraftBase, generationMode: 'codex' }),
    );
    expect(mutatingActionIdempotencyKey(specDraftBase)).not.toBe(
      mutatingActionIdempotencyKey({ ...specDraftBase, promptVersion: 'SPEC-draft.fake.v2' }),
    );
    expect(mutatingActionIdempotencyKey(specDraftBase)).not.toBe(
      mutatingActionIdempotencyKey({ ...specDraftBase, outputSchemaVersion: 'spec_draft.v2' }),
    );
  });

  it('includes Plan and package draft generation prompt identity in planned action keys', () => {
    const baseline = planNextActions(runtimeSnapshot(), { generation: generationPlanning() });
    const changedSchema = planNextActions(runtimeSnapshot(), {
      generation: generationPlanning({
        planDraftPromptVersion: 'PLAN-draft.fake.v2',
        packageDraftsPromptVersion: 'package-drafts.fake.v2',
      }),
    });

    expect(changedSchema.find((action) => action.actionType === 'ensure_PLAN_draft')?.idempotencyKey).not.toBe(
      baseline.find((action) => action.actionType === 'ensure_PLAN_draft')?.idempotencyKey,
    );
    expect(changedSchema.find((action) => action.actionType === 'ensure_package_drafts')?.idempotencyKey).not.toBe(
      baseline.find((action) => action.actionType === 'ensure_package_drafts')?.idempotencyKey,
    );
  });

  it('builds runtime snapshot keys from stable policy observation identity and repo scope', () => {
    expect(projectRuntimeSnapshotIdempotencyKey(observationA)).toBe(
      projectRuntimeSnapshotIdempotencyKey({ ...observationA, observedAt: '2026-05-15T00:00:01.000Z' }),
    );
    expect(projectRuntimeSnapshotIdempotencyKey({ ...observationA, automationScope: 'repo:project-2:repo-1' })).not.toBe(
      projectRuntimeSnapshotIdempotencyKey(observationA),
    );
    expect(projectRuntimeSnapshotIdempotencyKey({ ...observationA, policyStatus: 'parse_failed' })).not.toBe(
      projectRuntimeSnapshotIdempotencyKey(observationA),
    );
  });

  it('exports shared automation planner, executor, no-action, and policy digest types', () => {
    const policyDigest = {
      status: 'missing',
      parserVersion: 'workflow-md-parser:v1',
      reasonCode: 'not_found',
    } satisfies WorkflowPolicyDigestStatus;
    const plannerInput = {
      snapshot: {
        generatedAt: '2026-05-15T00:00:00.000Z',
        projects: [],
        repos: [],
        workItemsRequiringSpec: [],
        workItemsRequiringPlan: [],
        planRevisionsRequiringPackages: [],
        recentActionRuns: [],
        runEnqueueDisabledReason: 'run_enqueue_disabled_by_scope',
      },
    } satisfies AutomationPlannerInput;
    const noAction = {
      targetObjectType: 'work_item',
      targetObjectId: 'work-item-1',
      reasonCode: 'already_satisfied',
      summary: 'No eligible automation action.',
    } satisfies NoAction;
    const executorResult = {
      actionRunId: 'action-run-1',
      status: 'succeeded',
      retryable: false,
    } satisfies AutomationExecutorResult;

    expect(policyDigest.status).toBe('missing');
    expect(plannerInput.snapshot.runEnqueueDisabledReason).toBe('run_enqueue_disabled_by_scope');
    expect(noAction.reasonCode).toBe('already_satisfied');
    expect(executorResult.status).toBe('succeeded');
  });
});
