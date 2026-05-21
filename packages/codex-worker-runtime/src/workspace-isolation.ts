import { cp, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import { codexCanonicalDigest } from '@forgeloop/domain';

export type ContainerWorkspaceMode = 'artifact_only' | 'direct_mount' | 'self_contained_clone';

export interface PreparedContainerWorkspace {
  mode: ContainerWorkspaceMode;
  hostWorkspacePath?: string;
  containerWorkspacePath?: '/workspace';
  publicWorkspaceDigest?: string;
  publicSummary: Record<string, unknown>;
  cleanup(): Promise<void>;
}

const isInside = (root: string, child: string): boolean => {
  const childRelative = relative(resolve(root), resolve(child));
  return childRelative === '' || (!childRelative.startsWith('..') && !childRelative.startsWith('/'));
};

const assertAllowedRoot = async (path: string, allowedRepoRoots: readonly string[]): Promise<void> => {
  const resolvedPath = await realpath(path);
  const resolvedRoots = await Promise.all(allowedRepoRoots.map((root) => realpath(root).catch(() => resolve(root))));
  if (!resolvedRoots.some((root) => isInside(root, resolvedPath))) {
    throw new Error('codex_runtime_workspace_isolation_unavailable: workspace path is outside allowed roots');
  }
};

export const prepareContainerWorkspace = async (input: {
  sourceAccessMode: 'artifact_only' | 'path_policy_scoped';
  originalWorkspacePath?: string;
  leaseTempRoot: string;
  allowedRepoRoots: readonly string[];
  runCommand?: (command: string, args: readonly string[], options: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;
}): Promise<PreparedContainerWorkspace> => {
  if (input.sourceAccessMode === 'artifact_only') {
    return {
      mode: 'artifact_only',
      publicWorkspaceDigest: codexCanonicalDigest({ mode: 'artifact_only' }),
      publicSummary: { mode: 'artifact_only' },
      cleanup: async () => undefined,
    };
  }
  if (input.originalWorkspacePath === undefined) {
    throw new Error('codex_runtime_workspace_isolation_unavailable: workspace path is required');
  }

  await assertAllowedRoot(input.originalWorkspacePath, input.allowedRepoRoots);
  const gitPath = join(input.originalWorkspacePath, '.git');
  const gitStat = await lstat(gitPath).catch(() => undefined);
  if (gitStat?.isSymbolicLink()) {
    throw new Error('codex_runtime_workspace_isolation_unavailable: symlinked .git is not allowed');
  }
  if (gitStat?.isDirectory()) {
    return {
      mode: 'direct_mount',
      hostWorkspacePath: input.originalWorkspacePath,
      containerWorkspacePath: '/workspace',
      publicWorkspaceDigest: codexCanonicalDigest({ mode: 'direct_mount', basename: basename(input.originalWorkspacePath) }),
      publicSummary: { mode: 'direct_mount' },
      cleanup: async () => undefined,
    };
  }

  if (gitStat?.isFile()) {
    const gitFile = await readFile(gitPath, 'utf8');
    const gitdir = gitFile.match(/^gitdir:\s*(.+)\s*$/m)?.[1];
    if (gitdir === undefined) {
      throw new Error('codex_runtime_workspace_isolation_unavailable: unsupported .git file');
    }
    const resolvedGitDir = resolve(input.originalWorkspacePath, gitdir);
    await assertAllowedRoot(resolvedGitDir, input.allowedRepoRoots);

    const selfContainedPath = join(input.leaseTempRoot, 'workspace');
    await mkdir(selfContainedPath, { recursive: false, mode: 0o700 });
    await cp(input.originalWorkspacePath, selfContainedPath, {
      recursive: true,
      filter: (source) => source !== gitPath,
    });
    await cp(resolvedGitDir, join(selfContainedPath, '.git'), { recursive: true });
    if (input.runCommand !== undefined) {
      await input.runCommand('git', ['status', '--porcelain'], { cwd: selfContainedPath }).catch((error: unknown) => {
        throw Object.assign(new Error('codex_runtime_workspace_isolation_unavailable: self-contained workspace git status failed'), {
          cause: error,
        });
      });
    }
    return {
      mode: 'self_contained_clone',
      hostWorkspacePath: selfContainedPath,
      containerWorkspacePath: '/workspace',
      publicWorkspaceDigest: codexCanonicalDigest({ mode: 'self_contained_clone', source: basename(input.originalWorkspacePath) }),
      publicSummary: { mode: 'self_contained_clone' },
      cleanup: async () => {
        await rm(selfContainedPath, { recursive: true, force: true });
      },
    };
  }

  throw new Error('codex_runtime_workspace_isolation_unavailable: unsupported workspace git shape');
};
