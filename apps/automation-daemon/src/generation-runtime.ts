import { createCodexGenerationRuntime, type CodexGenerationRuntime } from '@forgeloop/codex-runtime';

import type { AutomationDaemonConfig } from './config.js';

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

export const createAutomationDaemonGenerationRuntime = (
  config: AutomationDaemonConfig,
): CodexGenerationRuntime | undefined => {
  const hasEnabledGenerationTask = Object.values(config.generationPlanning.tasks).some((task) => task.enabled);
  if (config.generationPlanning.mode === 'disabled' || !hasEnabledGenerationTask) {
    return undefined;
  }
  return createCodexGenerationRuntime(codexGenerationRuntimeConfigFor(config));
};
