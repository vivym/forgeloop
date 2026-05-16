import {
  executeActionRun,
  planNextActions,
  type AutomationExecutorClient,
  type AutomationExecutorResult,
  type RuntimePolicyProjection,
  type RuntimeSnapshot,
  type RuntimeSnapshotRepo,
  type WorkflowPolicyDigestStatus,
} from '@forgeloop/automation';

export interface AutomationDaemonClient extends AutomationExecutorClient {
  runtimeSnapshot(): Promise<RuntimeSnapshot>;
}

export interface AutomationDaemonPolicyLoaderInput {
  repoRoot: string;
  allowedRepoRoots: string[];
  parserVersion: string;
}

export type AutomationDaemonPolicyLoader = (
  input: AutomationDaemonPolicyLoaderInput,
) => Promise<WorkflowPolicyDigestStatus>;

export interface AutomationDaemonOptions {
  client: AutomationDaemonClient;
  actorId: string;
  daemonIdentity: string;
  allowedRepoRoots: string[];
  policyParserVersion: string;
  policyLoader: AutomationDaemonPolicyLoader;
  loopIntervalMs: number;
  noClaimBackoffMs: number;
  claimToken?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface AutomationDaemonRunOnceResult {
  plannedActionCount: number;
  executed: AutomationExecutorResult;
  backoffMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const policyProjectionFor = (
  repo: RuntimeSnapshotRepo,
  digest: WorkflowPolicyDigestStatus,
): RuntimePolicyProjection => ({
  automationScope: repo.automationScope,
  repoId: repo.repoId,
  policyStatus: digest.status,
  ...(digest.status === 'loaded' ? { policyDigest: digest.policyDigest } : {}),
  parserVersion: digest.parserVersion,
  ...('reasonCode' in digest && digest.reasonCode !== undefined ? { reasonCode: digest.reasonCode } : {}),
  ...(digest.observedAt === undefined ? {} : { observedAt: digest.observedAt }),
});

export class AutomationDaemon {
  private readonly sleep: (ms: number) => Promise<void>;
  private stopped = false;
  private claimCounter = 0;

  constructor(private readonly options: AutomationDaemonOptions) {
    this.sleep = options.sleep ?? defaultSleep;
  }

  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      const result = await this.runOnce();
      if (this.stopped) {
        break;
      }
      await this.sleep(result.backoffMs ?? this.options.loopIntervalMs);
    }
  }

  async runOnce(): Promise<AutomationDaemonRunOnceResult> {
    const snapshot = await this.snapshotWithPolicyDigests(await this.options.client.runtimeSnapshot());
    const actions = planNextActions(snapshot);
    for (const action of actions) {
      await this.options.client.createOrReplayAction(action);
    }

    const claimToken = this.nextClaimToken();
    const claim = await this.options.client.claimNextAction({ claimToken, limit: 1 });
    if (claim.action === null) {
      return {
        plannedActionCount: actions.length,
        backoffMs: this.options.noClaimBackoffMs,
        executed: {
          actionRunId: claimToken,
          status: 'skipped',
          retryable: false,
          reasonCode: 'no_claimable_action',
        },
      };
    }

    return {
      plannedActionCount: actions.length,
      executed: await executeActionRun({
        client: this.options.client,
        action: claim.action,
        actorId: this.options.actorId,
        daemonIdentity: this.options.daemonIdentity,
      }),
    };
  }

  private async snapshotWithPolicyDigests(snapshot: RuntimeSnapshot): Promise<RuntimeSnapshot> {
    const repos = [];
    for (const repo of snapshot.repos) {
      const digest = await this.options.policyLoader({
        repoRoot: repo.daemonInternalLocalPath,
        allowedRepoRoots: this.options.allowedRepoRoots,
        parserVersion: this.options.policyParserVersion,
      });
      repos.push({
        ...repo,
        policyProjection: policyProjectionFor(repo, digest),
      });
    }

    return { ...snapshot, repos };
  }

  private nextClaimToken(): string {
    if (this.options.claimToken !== undefined) {
      return this.options.claimToken;
    }
    this.claimCounter += 1;
    return `${this.options.daemonIdentity}:${Date.now()}:${this.claimCounter}`;
  }
}
