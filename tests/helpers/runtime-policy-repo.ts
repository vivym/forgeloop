import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const testRuntimePolicyMarkdown = (
  options: {
    allowedPaths?: readonly string[];
    forbiddenPaths?: readonly string[];
    publicSummary?: string;
    body?: string;
  } = {},
): string => {
  const allowedPaths = options.allowedPaths ?? [
    '.github/**',
    'apps/**',
    'docs/**',
    'packages/**',
    'scripts/**',
    'tests/**',
    'README.md',
    'package.json',
  ];
  const forbiddenPaths = options.forbiddenPaths ?? ['.git', '.git/**', 'node_modules/**', '.env', 'packages/db/**'];
  const publicSummary = options.publicSummary ?? 'Test runtime policy for frozen package snapshots.';
  const body = options.body ?? 'Runtime policy fixture.\n';

  return `---
path_policy:
  allowed_paths: ${JSON.stringify(allowedPaths)}
  forbidden_paths: ${JSON.stringify(forbiddenPaths)}
observability:
  public_summary: ${JSON.stringify(publicSummary)}
---

${body}`;
};

export const createWorkflowPolicyRepoRoot = async (
  options: Parameters<typeof testRuntimePolicyMarkdown>[0] & { prefix?: string } = {},
): Promise<string> => {
  const repoRoot = await mkdtemp(join(tmpdir(), options.prefix ?? 'forgeloop-runtime-policy-repo-'));
  await writeFile(join(repoRoot, 'WORKFLOW.md'), testRuntimePolicyMarkdown(options), 'utf8');
  return repoRoot;
};
