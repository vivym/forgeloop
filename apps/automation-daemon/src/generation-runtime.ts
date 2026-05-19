import { createCodexGenerationRuntime, type CodexGenerationRuntime } from '@forgeloop/codex-runtime';
import {
  createFakeSpecDraftGenerator,
  disabledSpecDraftGenerator,
  type SpecDraftGenerator,
} from '@forgeloop/automation';

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

export const createAutomationDaemonSpecDraftGenerator = (config: AutomationDaemonConfig): SpecDraftGenerator => {
  if (!config.generationPlanning.tasks.spec_draft.enabled || config.generationPlanning.mode === 'disabled') {
    return disabledSpecDraftGenerator;
  }
  if (config.generationPlanning.mode === 'fake') {
    return createFakeSpecDraftGenerator();
  }

  const runtime = createCodexGenerationRuntime(codexGenerationRuntimeConfigFor(config));
  const specConfig = config.generationPlanning.tasks.spec_draft;
  return {
    mode: 'app_server',
    async generateSpecDraft(context) {
      const result = await runtime.generateSpecDraft({
        actionRunId: context.action_run_id,
        projectId: context.work_item.project_id,
        repoIds: context.repos.map((repo) => repo.repo_id),
        context: context as unknown as Record<string, unknown>,
        promptVersion: specConfig.promptVersion,
        outputSchemaVersion: specConfig.outputSchemaVersion,
        policyDigests: Object.fromEntries(
          context.repos
            .filter((repo) => repo.policy_digest !== undefined)
            .map((repo) => [repo.repo_id, repo.policy_digest as string]),
        ),
      });
      return {
        generated: result.generated,
        generationArtifacts: result.generationArtifacts,
      };
    },
  };
};
