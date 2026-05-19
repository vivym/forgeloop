import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type { CodexGenerationTaskKind } from './types.js';
import type { CodexGenerationRuntimeSafety, GenerationLease } from './generation-safety.js';

export interface CreateCodexGenerationRuntimeSafetyInput {
  taskKind: CodexGenerationTaskKind;
  actionRunId: string;
  projectId: string;
  repoIds: string[];
  artifactRoot: string | undefined;
  workspaceRoot?: string;
  policyDigests: Record<string, string>;
}

const allowedGenerationCommands = new Set(['thread/start', 'turn/start', 'turn/interrupt', 'turn/steer']);

export const createCodexGenerationRuntimeSafety = (
  input: CreateCodexGenerationRuntimeSafetyInput,
): CodexGenerationRuntimeSafety => {
  if (input.artifactRoot === undefined || !isAbsolute(input.artifactRoot)) {
    throw new Error('codex_generation_safety_unavailable');
  }
  for (const repoId of input.repoIds) {
    if (input.policyDigests[repoId] === undefined) {
      throw new Error('codex_generation_safety_unavailable');
    }
  }

  return {
    taskKind: input.taskKind,
    actionRunId: input.actionRunId,
    projectId: input.projectId,
    repoIds: [...input.repoIds],
    artifactRoot: input.artifactRoot,
    ...(input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot }),
    policyDigests: { ...input.policyDigests },
    async createGenerationLease({ expiresAt }): Promise<GenerationLease> {
      return { lease_id: `gen_lease_${randomUUID()}`, expires_at: expiresAt };
    },
    async consumeGenerationCommand({ method }): Promise<void> {
      if (!allowedGenerationCommands.has(method)) {
        throw new Error('codex_generation_command_invalid');
      }
    },
  };
};
