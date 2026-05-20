import { randomUUID } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';

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

const isInsideArtifactRoot = (candidatePath: string, artifactRoot: string): boolean => {
  const candidateRelativePath = relative(artifactRoot, candidatePath);
  return candidateRelativePath === '' || (!candidateRelativePath.startsWith('..') && !candidateRelativePath.startsWith('/'));
};

export const createCodexGenerationRuntimeSafety = (
  input: CreateCodexGenerationRuntimeSafetyInput,
): CodexGenerationRuntimeSafety => {
  if (input.artifactRoot === undefined || !isAbsolute(input.artifactRoot)) {
    throw new Error('codex_generation_safety_unavailable');
  }
  const artifactRoot = input.artifactRoot;
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
    artifactRoot,
    ...(input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot }),
    policyDigests: { ...input.policyDigests },
    async createGenerationLease(leaseInput): Promise<GenerationLease> {
      if (
        (leaseInput.sandboxPolicy !== 'readOnly' && leaseInput.sandboxPolicy !== 'artifactOnly') ||
        leaseInput.writableRoots.some((root) => !isAbsolute(root)) ||
        leaseInput.timeoutMs <= 0 ||
        leaseInput.outputLimitBytes <= 0 ||
        leaseInput.rawNotificationLimitBytes <= 0
      ) {
        throw new Error('codex_generation_safety_unavailable');
      }
      if (leaseInput.sandboxPolicy === 'readOnly' && leaseInput.writableRoots.length > 0) {
        throw new Error('codex_generation_safety_unavailable');
      }
      if (
        leaseInput.sandboxPolicy === 'artifactOnly' &&
        leaseInput.writableRoots.some((root) => !isInsideArtifactRoot(root, artifactRoot))
      ) {
        throw new Error('codex_generation_safety_unavailable');
      }
      return { lease_id: `gen_lease_${randomUUID()}`, expires_at: leaseInput.expiresAt };
    },
    async consumeGenerationCommand({ method }): Promise<void> {
      if (!allowedGenerationCommands.has(method)) {
        throw new Error('codex_generation_command_invalid');
      }
    },
  };
};
