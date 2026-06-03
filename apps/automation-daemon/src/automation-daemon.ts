import {
  defaultGenerationPlanningConfig,
  executeActionRun,
  planNextActions,
  type AutomationGenerationPlanningConfig,
  type AutomationExecutorClient,
  type AutomationExecutorResult,
  type AutomationPackageDraftGenerationRuntime,
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
  generationPlanning?: AutomationGenerationPlanningConfig;
  generationRuntime?: AutomationPackageDraftGenerationRuntime;
  claimToken?: string;
  sleep?: (ms: number) => Promise<void>;
  onIterationError?: (error: unknown) => void;
}

export interface AutomationDaemonRunOnceResult {
  plannedActionCount: number;
  executed: AutomationExecutorResult;
  backoffMs?: number;
}

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

const openProjectionStatuses = new Set(['pending', 'running']);

const hasOpenProjectRuntimeSnapshotAction = (snapshot: RuntimeSnapshot): boolean =>
  snapshot.recentActionRuns.some(
    (actionRun) => actionRun.actionType === 'project_runtime_snapshot' && openProjectionStatuses.has(actionRun.status),
  );

export class AutomationDaemon {
  private readonly stopWaiters = new Set<() => void>();
  private stopped = false;
  private claimCounter = 0;

  constructor(private readonly options: AutomationDaemonOptions) {}

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    const waiters = [...this.stopWaiters];
    this.stopWaiters.clear();
    for (const waiter of waiters) {
      waiter();
    }
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      let sleepMs = this.options.loopIntervalMs;
      try {
        const result = await this.runOnce();
        sleepMs = result.backoffMs ?? this.options.loopIntervalMs;
      } catch (error) {
        this.reportIterationError(error);
        sleepMs = this.options.noClaimBackoffMs;
      }
      if (this.stopped) {
        break;
      }
      await this.sleepUntilStopped(sleepMs);
    }
  }

  async runOnce(): Promise<AutomationDaemonRunOnceResult> {
    const snapshot = await this.snapshotWithPolicyDigests(await this.options.client.runtimeSnapshot());
    const generationPlanning = this.options.generationPlanning ?? defaultGenerationPlanningConfig;
    const actions = planNextActions(snapshot, { generation: generationPlanning });
    const shouldClaimProjectionFirst =
      generationPlanning.mode === 'app_server' &&
      (actions.some((action) => action.actionType === 'project_runtime_snapshot') || hasOpenProjectRuntimeSnapshotAction(snapshot));
    const actionsToCreate =
      shouldClaimProjectionFirst ? actions.filter((action) => action.actionType === 'project_runtime_snapshot') : actions;
    for (const action of actionsToCreate) {
      await this.options.client.createOrReplayAction(action);
    }

    const claimToken = this.nextClaimToken();
    const claim = await this.options.client.claimNextAction({
      claimToken,
      limit: 1,
      ...(shouldClaimProjectionFirst ? { actionType: 'project_runtime_snapshot' as const } : {}),
    });
    if (claim.action === null) {
      return {
        plannedActionCount: actionsToCreate.length,
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
      plannedActionCount: actionsToCreate.length,
      executed: await executeActionRun({
        client: this.options.client,
        action: claim.action,
        actorId: this.options.actorId,
        daemonIdentity: this.options.daemonIdentity,
        ...(this.options.generationRuntime === undefined ? {} : { generationRuntime: this.options.generationRuntime }),
        generationPlanning,
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

  private async sleepUntilStopped(ms: number): Promise<void> {
    if (this.stopped) {
      return;
    }

    let stopWaiter!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stopWaiter = () => resolve();
      this.stopWaiters.add(stopWaiter);
    });

    try {
      if (this.options.sleep !== undefined) {
        await Promise.race([this.options.sleep(ms), stopped]);
        return;
      }

      let timer: ReturnType<typeof setTimeout>;
      await Promise.race([
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
        stopped,
      ]);
      clearTimeout(timer!);
    } finally {
      this.stopWaiters.delete(stopWaiter);
    }
  }

  private reportIterationError(error: unknown): void {
    try {
      this.options.onIterationError?.(error);
    } catch {
      // Keep transient reporting failures from terminating the daemon loop.
    }
  }
}
