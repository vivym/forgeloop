import { describe, expect, it } from 'vitest';

import { createCodexGenerationRuntime } from '../../packages/codex-runtime/src/index';
import { generationPlanningForDaemon, loadAutomationDaemonConfig } from '../../apps/automation-daemon/src/config';
import { AutomationDaemon, type AutomationDaemonClient } from '../../apps/automation-daemon/src/automation-daemon';
import {
  createAutomationDaemonGenerationRuntime,
  createLeasedDockerCodexGenerationRuntime,
} from '../../apps/automation-daemon/src/generation-runtime';
import {
  projectRuntimeSnapshotIdempotencyKey,
  type AutomationGenerationWorkItemContextV1,
  type AutomationGenerationPlanContextV1,
  AutomationActionResponse,
  AutomationActionRunRecord,
  BlockActionInput,
  ClaimNextActionInput,
  CompleteActionInput,
  FailActionInput,
  GatePendingActionInput,
  type EnsureSpecDraftCommandInput,
  NextAction,
  RuntimeSnapshot,
  WorkflowPolicyDigestStatus,
} from '../../packages/automation/src/index';

const repoScope = 'repo:project-1:repo-1' as const;
const parserVersion = 'workflow-md-parser:v1';

const baseSnapshot = (overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot => ({
  generatedAt: '2026-05-16T00:00:00.000Z',
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
      daemonInternalLocalPath: '/workspace/repo-1',
    },
  ],
  workItemsRequiringSpec: [],
  workItemsRequiringPlan: [],
  planRevisionsRequiringPackages: [],
  runEnqueueDisabledPackages: [],
  activeHolds: [],
  recentActionRuns: [],
  runEnqueueDisabledReason: 'run_enqueue_disabled_by_scope',
  ...overrides,
});

const validEnv = () => ({
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret-1',
  FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon-1',
  FORGELOOP_AUTOMATION_ACTOR_ID: 'actor-1',
  FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: ['/workspace'].join(':'),
});

const claimedPlanAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord => ({
  id: 'action-run-1',
  actionType: 'ensure_plan_draft',
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  targetRevisionId: 'spec-revision-1',
  targetStatus: 'approved',
  idempotencyKey: 'action-run-1-idempotency',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'precondition-fingerprint-1',
  actionInputJson: {
    work_item_id: 'work-item-1',
    spec_revision_id: 'spec-revision-1',
  },
  status: 'running',
  attempt: 1,
  claimToken: 'claim-token-1',
  ...overrides,
});

const claimedSpecAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord => ({
  id: 'spec-action-run-1',
  actionType: 'ensure_spec_draft',
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  targetStatus: 'triage',
  idempotencyKey: 'spec-action-run-1-idempotency',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'precondition-fingerprint-1',
  actionInputJson: { work_item_id: 'work-item-1' },
  status: 'running',
  attempt: 1,
  claimToken: 'claim-token-1',
  ...overrides,
});

const claimedProjectionAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord => ({
  id: 'projection-action-run-1',
  actionType: 'project_runtime_snapshot',
  targetObjectType: 'repo',
  targetObjectId: 'repo-1',
  targetStatus: 'loaded',
  idempotencyKey: 'projection-action-run-1-idempotency',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'projection-precondition-fingerprint-1',
  actionInputJson: {
    repo_id: 'repo-1',
    policy_status: 'loaded',
    policy_digest: 'workflow-digest-1',
    parser_version: parserVersion,
  },
  status: 'running',
  attempt: 1,
  claimToken: 'claim-token-1',
  ...overrides,
});

const packageTarget = () => ({
  targetObjectType: 'plan_revision',
  targetObjectId: 'plan-revision-1',
  targetRevisionId: 'default:plan-revision-1',
  targetStatus: 'approved',
  projectId: 'project-1',
  repoId: 'repo-1',
  automationScope: repoScope,
  generationKey: 'default:plan-revision-1',
} as const);

class FakeDaemonClient implements AutomationDaemonClient {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  snapshot: RuntimeSnapshot = baseSnapshot();
  actionToClaim: AutomationActionRunRecord | null = claimedPlanAction();

  async runtimeSnapshot(): Promise<RuntimeSnapshot> {
    this.calls.push({ method: 'runtimeSnapshot', args: [] });
    return this.snapshot;
  }

  async createOrReplayAction(action: NextAction): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'createOrReplayAction', args: [action] });
    return { action: { ...claimedPlanAction(), status: 'pending' } };
  }

  async claimNextAction(input: ClaimNextActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'claimNextAction', args: [input] });
    return { action: this.actionToClaim };
  }

  async completeAction(actionRunId: string, input: CompleteActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'completeAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'succeeded' } };
  }

  async gatePendingAction(actionRunId: string, input: GatePendingActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'gatePendingAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'gate_pending' } };
  }

  async blockAction(actionRunId: string, input: BlockActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'blockAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'blocked' } };
  }

  async failAction(actionRunId: string, input: FailActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'failAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'failed' } };
  }

  async ensurePlanDraft(workItemId: string, input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: 'ensurePlanDraft', args: [workItemId, input] });
    return { status: 'created' };
  }

  async ensurePackageDrafts(planRevisionId: string, input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: 'ensurePackageDrafts', args: [planRevisionId, input] });
    return { status: 'created' };
  }

  async specDraftGenerationContext(
    workItemId: string,
    input: Record<string, unknown>,
  ): Promise<AutomationGenerationWorkItemContextV1> {
    this.calls.push({ method: 'specDraftGenerationContext', args: [workItemId, input] });
    return {
      context_version: 'generation_context.work_item.v1',
      action_run_id: 'spec-action-run-1',
      work_item: {
        id: workItemId,
        project_id: 'project-1',
        title: 'Spec draft work item',
        goal: 'Ship the spec draft path',
        success_criteria: ['Draft spec exists'],
        risk: 'low',
        priority: 'high',
        kind: 'initiative',
      },
      repos: [
        {
          project_id: 'project-1',
          repo_id: 'repo-1',
          default_branch: 'main',
          policy_status: 'missing',
        },
      ],
    };
  }

  async planDraftGenerationContext(
    workItemId: string,
    input: { specRevisionId: string; actionRunId: string; claimToken: string },
  ): Promise<AutomationGenerationPlanContextV1> {
    this.calls.push({ method: 'planDraftGenerationContext', args: [workItemId, input] });
    return {
      context_version: 'generation_context.plan.v1',
      action_run_id: input.actionRunId,
      work_item: {
        id: workItemId,
        project_id: 'project-1',
        title: 'Plan draft work item',
        goal: 'Ship the plan draft path',
        success_criteria: ['Draft plan exists'],
        risk: 'low',
        priority: 'high',
        kind: 'initiative',
      },
      spec_revision: {
        id: input.specRevisionId,
        spec_id: 'spec-1',
        summary: 'Approved spec',
        content: 'Approved spec content',
        background: 'Plan draft generation should use the daemon runtime.',
        goals: ['Generate a Plan draft'],
        scope_in: ['Plan draft command boundary'],
        scope_out: ['Package draft generation'],
        acceptance_criteria: ['Plan draft payload is sent to the command boundary'],
        risk_notes: ['Keep the Plan draft human gated.'],
        test_strategy_summary: 'Run daemon and API command tests.',
        structured_document: { source: 'daemon-test' },
      },
      repos: [
        {
          project_id: 'project-1',
          repo_id: 'repo-1',
          default_branch: 'main',
          policy_status: 'loaded',
          policy_digest: 'workflow-digest-1',
          parser_version: parserVersion,
        },
      ],
    };
  }

  async ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput): Promise<unknown> {
    this.calls.push({ method: 'ensureSpecDraft', args: [workItemId, input] });
    return { status: 'created', spec_id: 'spec-1', spec_revision_id: 'spec-revision-1' };
  }

  async requestManualPathHold(input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: 'requestManualPathHold', args: [input] });
    return { status: 'active' };
  }
}

const loadedPolicy = (): WorkflowPolicyDigestStatus => ({
  status: 'loaded',
  policyDigest: 'workflow-digest-1',
  parserVersion,
  policyPath: 'WORKFLOW.md',
});

const daemonOptions = (client: AutomationDaemonClient) => ({
  client,
  actorId: 'daemon-actor',
  daemonIdentity: 'daemon-1',
  claimToken: 'claim-token-1',
  allowedRepoRoots: ['/workspace'],
  policyParserVersion: parserVersion,
  policyLoader: async () => loadedPolicy(),
  noClaimBackoffMs: 25,
  loopIntervalMs: 1_000,
});

const generationPlanning = {
  mode: 'fake',
  tasks: {
    spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
    plan_draft: { enabled: true, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
    package_drafts: { enabled: false, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
  },
} as const;

describe('automation daemon loop', () => {
  it('loads required config and path-list roots from the environment', () => {
    expect(
      loadAutomationDaemonConfig({
        FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
        FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret-1',
        FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon-1',
        FORGELOOP_AUTOMATION_ACTOR_ID: 'actor-1',
        FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: ['/workspace/a', '/workspace/b'].join(':'),
        FORGELOOP_AUTOMATION_LOOP_INTERVAL_MS: '1500',
        FORGELOOP_AUTOMATION_NO_CLAIM_BACKOFF_MS: '250',
      }),
    ).toMatchObject({
      controlPlaneUrl: 'http://127.0.0.1:3000',
      trustedActorHeaderSecret: 'secret-1',
      daemonIdentity: 'daemon-1',
      actorId: 'actor-1',
      allowedRepoRoots: ['/workspace/a', '/workspace/b'],
      loopIntervalMs: 1500,
      noClaimBackoffMs: 250,
      codexAutomationGeneration: 'disabled',
    });
  });

  it('loads legacy generation mode compatibility', () => {
    expect(loadAutomationDaemonConfig(validEnv())).toMatchObject({
      codexAutomationGeneration: 'disabled',
      generationPlanning: { mode: 'disabled' },
    });
    expect(
      loadAutomationDaemonConfig({
        ...validEnv(),
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
      }),
    ).toMatchObject({
      codexAutomationGeneration: 'fake',
      generationPlanning: { mode: 'fake' },
    });
    expect(
      loadAutomationDaemonConfig({
        ...validEnv(),
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
        FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
        FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
      }),
    ).toMatchObject({
      codexAutomationGeneration: 'app_server',
      generationPlanning: { mode: 'app_server' },
    });
  });

  it('builds an app_server generation runtime from governed runtime config', () => {
    const config = loadAutomationDaemonConfig({
      ...validEnv(),
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
      FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
    });

    expect(createAutomationDaemonGenerationRuntime(config)).toBeDefined();
  });

  it('terminalizes a leased generation session as failed when generation throws', async () => {
    const closed: Array<{ status: string; summary: string }> = [];
    const runtime = createLeasedDockerCodexGenerationRuntime({
      dockerImageDigest: 'sha256:docker',
      worker: {
        selectForLaunch: async () => ({ workerId: 'worker-1', sessionToken: 'worker-session-1' }),
        withLeaseSlot: async (operation) => operation(),
      },
      createLaunchLease: async () => ({ leaseId: 'lease-1', launchToken: 'launch-token-1' }),
      launcher: {
        launchFromLease: async () => ({
          endpoint: 'unix:/safe/codex.sock',
          containerWorkspacePath: '/workspace',
          publicEvidence: {},
          close: async (status, summary) => {
            closed.push({ status, summary });
          },
        }),
      },
      innerRuntimeFactory: () => ({
        generateSpecDraft: async () => {
          throw new Error('generation failed');
        },
        generatePlanDraft: async () => {
          throw new Error('unexpected');
        },
        generatePackageDrafts: async () => {
          throw new Error('unexpected');
        },
      }),
    });

    await expect(
      runtime.generateSpecDraft({
        actionRunId: 'action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: {},
        promptVersion: 'spec.v1',
        outputSchemaVersion: 'spec_draft.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'action-run-1',
          actionType: 'ensure_spec_draft',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-1',
          automationScope: repoScope,
          idempotencyKey: 'idempotency-1',
        },
      }),
    ).rejects.toThrow(/generation failed/);
    expect(closed).toEqual([{ status: 'failed', summary: 'generation failed' }]);
  });

  it('throws early when required config is missing', () => {
    expect(() => loadAutomationDaemonConfig({})).toThrow(/FORGELOOP_CONTROL_PLANE_URL/);
  });

  it('fetches snapshot, loads policy digest, plans actions, creates/replays actions, claims and executes one action', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
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
    });
    const policyLoads: Array<{ repoRoot: string; allowedRepoRoots: string[]; parserVersion: string }> = [];
    const daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async (input) => {
        policyLoads.push(input);
        return loadedPolicy();
      },
      noClaimBackoffMs: 25,
      loopIntervalMs: 1_000,
      generationPlanning,
      generationRuntime: createCodexGenerationRuntime({ mode: 'fake' }),
    });

    const result = await daemon.runOnce();

    expect(policyLoads).toEqual([{ repoRoot: '/workspace/repo-1', allowedRepoRoots: ['/workspace'], parserVersion }]);
    expect(result).toMatchObject({ plannedActionCount: 2, executed: { status: 'succeeded' } });
    expect(client.calls.map((call) => call.method)).toEqual([
      'runtimeSnapshot',
      'createOrReplayAction',
      'createOrReplayAction',
      'claimNextAction',
      'planDraftGenerationContext',
      'ensurePlanDraft',
      'completeAction',
    ]);
    const createdActions = client.calls
      .filter((call) => call.method === 'createOrReplayAction')
      .map((call) => (call.args[0] as NextAction).actionType);
    expect(createdActions).toEqual(['ensure_plan_draft', 'project_runtime_snapshot']);
    expect(JSON.stringify(client.calls)).not.toContain('enqueue');
  });

  it('suppresses Plan and Package draft planning when no generation config is provided', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
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
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = null;
    const daemon = new AutomationDaemon(daemonOptions(client));

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'skipped' } });
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['project_runtime_snapshot']);
  });

  it('suppresses Plan and Package draft planning for minimal environment config', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
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
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = null;
    const config = loadAutomationDaemonConfig(validEnv());
    const generationPlanning = generationPlanningForDaemon(config);
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      ...(generationPlanning === undefined ? {} : { generationPlanning }),
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'skipped' } });
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['project_runtime_snapshot']);
  });

  it('claims policy projection before app_server generation actions', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [
        {
          projectId: 'project-1',
          repoId: 'repo-1',
          automationScope: repoScope,
          automationSettingsVersion: 3,
          capabilityFingerprint: 'capability-fingerprint-1',
          daemonInternalLocalPath: '/workspace/repo-1',
          policyProjection: {
            automationScope: repoScope,
            repoId: 'repo-1',
            policyStatus: 'loaded',
            policyDigest: 'workflow-digest-1',
            parserVersion,
          },
        },
      ],
      workItemsRequiringSpec: [
        {
          targetObjectType: 'work_item',
          targetObjectId: 'work-item-1',
          targetStatus: 'triage',
          projectId: 'project-1',
          repoId: 'repo-1',
          automationScope: repoScope,
        },
      ],
    });
    client.actionToClaim = claimedProjectionAction();
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning: {
        mode: 'app_server',
        tasks: {
          spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
          plan_draft: { enabled: false, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
          package_drafts: { enabled: false, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
        },
      },
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'succeeded' } });
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['project_runtime_snapshot']);
    expect(client.calls.find((call) => call.method === 'claimNextAction')?.args[0]).toMatchObject({
      actionType: 'project_runtime_snapshot',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('specDraftGenerationContext');
  });

  it('claims existing pending policy projection before app_server generation actions', async () => {
    const client = new FakeDaemonClient();
    const projectionIdempotencyKey = projectRuntimeSnapshotIdempotencyKey({
      automationScope: repoScope,
      repoId: 'repo-1',
      policyStatus: 'loaded',
      policyDigest: 'workflow-digest-1',
      parserVersion,
    });
    client.snapshot = baseSnapshot({
      recentActionRuns: [
        {
          id: 'pending-projection-action',
          actionType: 'project_runtime_snapshot',
          targetObjectType: 'repo',
          targetObjectId: 'repo-1',
          status: 'pending',
          idempotencyKey: projectionIdempotencyKey,
          automationScope: repoScope,
        },
      ],
      workItemsRequiringSpec: [
        {
          targetObjectType: 'work_item',
          targetObjectId: 'work-item-1',
          targetStatus: 'triage',
          projectId: 'project-1',
          repoId: 'repo-1',
          automationScope: repoScope,
        },
      ],
    });
    client.actionToClaim = claimedProjectionAction({ id: 'pending-projection-action', idempotencyKey: projectionIdempotencyKey });
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning: {
        mode: 'app_server',
        tasks: {
          spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
          plan_draft: { enabled: false, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
          package_drafts: { enabled: false, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
        },
      },
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 0, executed: { status: 'succeeded' } });
    expect(client.calls.filter((call) => call.method === 'createOrReplayAction')).toHaveLength(0);
    expect(client.calls.find((call) => call.method === 'claimNextAction')?.args[0]).toMatchObject({
      actionType: 'project_runtime_snapshot',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('specDraftGenerationContext');
  });

  it.each(['fake', 'disabled'] as const)(
    'keeps legacy specDraftGenerationMode=%s scoped to Spec draft planning only',
    async (specDraftGenerationMode) => {
      const client = new FakeDaemonClient();
      client.snapshot = baseSnapshot({
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
        planRevisionsRequiringPackages: [packageTarget()],
      });
      client.actionToClaim = null;
      const daemon = new AutomationDaemon({
        ...daemonOptions(client),
        specDraftGenerationMode,
      });

      const result = await daemon.runOnce();

      expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'skipped' } });
      expect(
        client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
      ).toEqual(['project_runtime_snapshot']);
    },
  );

  it('plans and executes Spec draft actions when fake generation is enabled', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      workItemsRequiringSpec: [
        {
          targetObjectType: 'work_item',
          targetObjectId: 'work-item-1',
          targetStatus: 'triage',
          projectId: 'project-1',
          repoId: 'repo-1',
          automationScope: repoScope,
        },
      ],
    });
    client.actionToClaim = claimedSpecAction();
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning,
      generationRuntime: createCodexGenerationRuntime({ mode: 'fake' }),
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 2, executed: { status: 'succeeded' } });
    expect(client.calls.map((call) => call.method)).toEqual([
      'runtimeSnapshot',
      'createOrReplayAction',
      'createOrReplayAction',
      'claimNextAction',
      'specDraftGenerationContext',
      'ensureSpecDraft',
      'completeAction',
    ]);
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['ensure_spec_draft', 'project_runtime_snapshot']);
  });

  it('returns no-claim backoff when nothing is claimable', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [],
      projects: [],
    });
    client.actionToClaim = null;
    const daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => loadedPolicy(),
      noClaimBackoffMs: 50,
      loopIntervalMs: 1_000,
    });

    const result = await daemon.runOnce();

    expect(result).toEqual({
      plannedActionCount: 0,
      backoffMs: 50,
      executed: {
        actionRunId: 'claim-token-1',
        status: 'skipped',
        retryable: false,
        reasonCode: 'no_claimable_action',
      },
    });
  });

  it('finishes the current iteration after stop is requested', async () => {
    const client = new FakeDaemonClient();
    let daemon!: AutomationDaemon;
    daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => {
        daemon.stop();
        return loadedPolicy();
      },
      noClaimBackoffMs: 1,
      loopIntervalMs: 1,
      generationPlanning,
      generationRuntime: createCodexGenerationRuntime({ mode: 'fake' }),
      sleep: async () => undefined,
    });

    await daemon.run();

    expect(client.calls.filter((call) => call.method === 'runtimeSnapshot')).toHaveLength(1);
    expect(client.calls.map((call) => call.method)).toContain('completeAction');
  });

  it('continues after a transient iteration failure using backoff', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [],
      projects: [],
    });
    client.actionToClaim = null;
    let attempts = 0;
    client.runtimeSnapshot = async () => {
      attempts += 1;
      client.calls.push({ method: 'runtimeSnapshot', args: [] });
      if (attempts === 1) {
        throw new Error('temporary control plane outage');
      }
      return client.snapshot;
    };
    const sleeps: number[] = [];
    let daemon!: AutomationDaemon;
    daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => loadedPolicy(),
      noClaimBackoffMs: 50,
      loopIntervalMs: 1_000,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) {
          daemon.stop();
        }
      },
    });

    await daemon.run();

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([50, 50]);
    expect(client.calls.map((call) => call.method)).toContain('claimNextAction');
  });

  it('stop wakes the daemon while it is sleeping between iterations', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [],
      projects: [],
    });
    client.actionToClaim = null;
    let sleepStarted!: () => void;
    const sleepStartedPromise = new Promise<void>((resolve) => {
      sleepStarted = resolve;
    });
    const daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => loadedPolicy(),
      noClaimBackoffMs: 10_000,
      loopIntervalMs: 10_000,
      sleep: async () => {
        sleepStarted();
        await new Promise(() => undefined);
      },
    });

    const runPromise = daemon.run();
    await sleepStartedPromise;
    daemon.stop();
    const outcome = await Promise.race([
      runPromise.then(() => 'stopped'),
      new Promise<'timed_out'>((resolve) => {
        setTimeout(() => resolve('timed_out'), 50);
      }),
    ]);

    expect(outcome).toBe('stopped');
  });
});
