import type { DockerizedCodexAppServerLauncher, LocalCodexWorkerRuntime } from '@forgeloop/codex-worker-runtime';
import { CodexAppServerEndpointTransport, createCodexGenerationRuntime, type CodexGenerationRuntime } from '@forgeloop/codex-runtime';

import type { AutomationDaemonConfig } from './config.js';

type GenerationTaskKind = 'spec_draft' | 'plan_draft' | 'package_drafts';

const codexGenerationRuntimeConfigFor = (config: AutomationDaemonConfig): Parameters<typeof createCodexGenerationRuntime>[0] => ({
  mode: config.generationPlanning.mode,
  ...(config.appServerEndpoint === undefined ? {} : { appServerEndpoint: config.appServerEndpoint }),
  ...(config.generationArtifactRoot === undefined ? {} : { artifactRoot: config.generationArtifactRoot }),
  ...(config.generationTurnTimeoutMs === undefined ? {} : { timeoutMs: config.generationTurnTimeoutMs }),
  ...(config.generationOutputLimitBytes === undefined ? {} : { outputLimitBytes: config.generationOutputLimitBytes }),
  ...(config.generationRawNotificationLimitBytes === undefined
    ? {}
    : { rawNotificationLimitBytes: config.generationRawNotificationLimitBytes }),
  ...(config.generationMaxConcurrency === undefined ? {} : { maxConcurrency: config.generationMaxConcurrency }),
});

export interface CreateLeasedDockerCodexGenerationRuntimeOptions {
  worker: Pick<LocalCodexWorkerRuntime, 'selectForLaunch' | 'withLeaseSlot'>;
  launcher: Pick<DockerizedCodexAppServerLauncher, 'launchFromLease'>;
  dockerImageDigest: string;
  createLaunchLease(input: {
    taskKind: GenerationTaskKind;
    workerId: string;
    sessionToken: string;
    generationInput: Parameters<CodexGenerationRuntime['generateSpecDraft']>[0];
  }): Promise<{ leaseId: string; launchToken: string }>;
  innerRuntimeFactory?: (config: Parameters<typeof createCodexGenerationRuntime>[0]) => CodexGenerationRuntime;
  runtimeConfig?: Partial<Parameters<typeof createCodexGenerationRuntime>[0]>;
}

export const createLeasedDockerCodexGenerationRuntime = (
  options: CreateLeasedDockerCodexGenerationRuntimeOptions,
): CodexGenerationRuntime => {
  const innerRuntimeFactory = options.innerRuntimeFactory ?? createCodexGenerationRuntime;

  const generateWithLease = async <T>(
    taskKind: GenerationTaskKind,
    input: Parameters<CodexGenerationRuntime['generateSpecDraft']>[0],
    call: (runtime: CodexGenerationRuntime, input: Parameters<CodexGenerationRuntime['generateSpecDraft']>[0]) => Promise<T>,
  ): Promise<T> => {
    if (input.orchestration === undefined) {
      throw new Error('codex_launch_lease_denied');
    }
    const worker = await options.worker.selectForLaunch({
      projectId: input.projectId,
      ...(input.repoIds[0] === undefined ? {} : { repoId: input.repoIds[0] }),
      dockerImageDigest: options.dockerImageDigest,
      targetKind: 'generation',
    });
    return options.worker.withLeaseSlot(async () => {
      const lease = await options.createLaunchLease({
        taskKind,
        workerId: worker.workerId,
        sessionToken: worker.sessionToken,
        generationInput: input,
      });
      const session = await options.launcher.launchFromLease({
        leaseId: lease.leaseId,
        launchToken: lease.launchToken,
        workerSessionToken: worker.sessionToken,
      });
      try {
        const runtime = innerRuntimeFactory({
          mode: 'app_server',
          ...options.runtimeConfig,
          appServerEndpoint: session.endpoint,
          transportFactory: (endpoint) => session.createTransport?.() ?? new CodexAppServerEndpointTransport(endpoint, session.endpointAuth),
        });
        const result = await call(runtime, input);
        await session.close('succeeded', 'generation complete');
        return result;
      } catch (error) {
        await session.close('failed', error instanceof Error ? error.message : 'generation failed');
        throw error;
      }
    });
  };

  return {
    generateSpecDraft: (input) => generateWithLease('spec_draft', input, (runtime, taskInput) => runtime.generateSpecDraft(taskInput)),
    generatePlanDraft: (input) => generateWithLease('plan_draft', input, (runtime, taskInput) => runtime.generatePlanDraft(taskInput)),
    generatePackageDrafts: (input) =>
      generateWithLease('package_drafts', input, (runtime, taskInput) => runtime.generatePackageDrafts(taskInput)),
  };
};

export const createAutomationDaemonGenerationRuntime = (
  config: AutomationDaemonConfig,
  options: { localDocker?: CreateLeasedDockerCodexGenerationRuntimeOptions } = {},
): CodexGenerationRuntime | undefined => {
  const hasEnabledGenerationTask = Object.values(config.generationPlanning.tasks).some((task) => task.enabled);
  if (config.generationPlanning.mode === 'disabled' || !hasEnabledGenerationTask) {
    return undefined;
  }
  if (config.codexWorkerMode === 'local_docker') {
    if (options.localDocker === undefined) {
      throw new Error('codex_worker_runtime_dependencies_required');
    }
    return createLeasedDockerCodexGenerationRuntime({
      ...options.localDocker,
      runtimeConfig: {
        ...codexGenerationRuntimeConfigFor(config),
        ...options.localDocker.runtimeConfig,
      },
    });
  }
  return createCodexGenerationRuntime(codexGenerationRuntimeConfigFor(config));
};
