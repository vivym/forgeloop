import { describe, expect, it } from 'vitest';

import { loadAutomationDaemonConfig } from '../../apps/automation-daemon/src/config';
import { AutomationDaemon, type AutomationDaemonClient } from '../../apps/automation-daemon/src/automation-daemon';
import type {
  AutomationActionResponse,
  AutomationActionRunRecord,
  BlockActionInput,
  ClaimNextActionInput,
  CompleteActionInput,
  FailActionInput,
  GatePendingActionInput,
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
  workItemsRequiringPlan: [],
  planRevisionsRequiringPackages: [],
  runEnqueueDisabledPackages: [],
  activeHolds: [],
  recentActionRuns: [],
  runEnqueueDisabledReason: 'run_enqueue_disabled_by_scope',
  ...overrides,
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
    });
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
    });

    const result = await daemon.runOnce();

    expect(policyLoads).toEqual([{ repoRoot: '/workspace/repo-1', allowedRepoRoots: ['/workspace'], parserVersion }]);
    expect(result).toMatchObject({ plannedActionCount: 2, executed: { status: 'succeeded' } });
    expect(client.calls.map((call) => call.method)).toEqual([
      'runtimeSnapshot',
      'createOrReplayAction',
      'createOrReplayAction',
      'claimNextAction',
      'ensurePlanDraft',
      'completeAction',
    ]);
    const createdActions = client.calls
      .filter((call) => call.method === 'createOrReplayAction')
      .map((call) => (call.args[0] as NextAction).actionType);
    expect(createdActions).toEqual(['ensure_plan_draft', 'project_runtime_snapshot']);
    expect(JSON.stringify(client.calls)).not.toContain('enqueue');
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
