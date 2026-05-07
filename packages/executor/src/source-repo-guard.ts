import type { LocalCodexEnvironment } from './local-codex-preflight.js';

export interface SourceRepoSnapshot {
  repoPath: string;
  beforePorcelain: string;
}

export interface SourceRepoGuardResult {
  unchanged: boolean;
  beforePorcelain: string;
  afterPorcelain: string;
}

export const snapshotSourceRepoStatus = async (
  environment: LocalCodexEnvironment,
  repoPath: string,
): Promise<SourceRepoSnapshot> => {
  const { stdout } = await environment.runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repoPath,
    maxBuffer: 1024 * 1024 * 10,
  });

  return {
    repoPath,
    beforePorcelain: stdout,
  };
};

export const sourceRepoWasMutated = (input: {
  beforePorcelain: string;
  afterPorcelain: string;
}): boolean => input.beforePorcelain !== input.afterPorcelain;

export const verifySourceRepoUnchanged = async (
  environment: LocalCodexEnvironment,
  snapshot: SourceRepoSnapshot,
): Promise<SourceRepoGuardResult> => {
  const { stdout } = await environment.runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: snapshot.repoPath,
    maxBuffer: 1024 * 1024 * 10,
  });

  return {
    unchanged: !sourceRepoWasMutated({
      beforePorcelain: snapshot.beforePorcelain,
      afterPorcelain: stdout,
    }),
    beforePorcelain: snapshot.beforePorcelain,
    afterPorcelain: stdout,
  };
};
