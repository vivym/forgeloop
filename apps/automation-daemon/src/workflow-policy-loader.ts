import {
  loadWorkflowPolicyDigest,
  type WorkflowPolicyDigestStatus,
} from '@forgeloop/automation';

export interface LoadDaemonWorkflowPolicyDigestInput {
  repoRoot: string;
  allowedRepoRoots: string[];
  parserVersion: string;
}

export const loadDaemonWorkflowPolicyDigest = (
  input: LoadDaemonWorkflowPolicyDigestInput,
): Promise<WorkflowPolicyDigestStatus> =>
  loadWorkflowPolicyDigest({
    repoRoot: input.repoRoot,
    allowedRepoRoots: input.allowedRepoRoots,
    policyPath: 'WORKFLOW.md',
    parserVersion: input.parserVersion,
  });
