import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { sourceRepoWasMutated, worktreePathForRun } from '../../packages/executor/src/index';

describe('Codex persistent worktrees', () => {
  it('uses a stable per-run worktree path under the source repo', () => {
    expect(worktreePathForRun('/Users/viv/projs/forgeloop', 'run-session-1')).toBe(
      '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
    );
  });

  it('detects source repo mutation from porcelain status changes', () => {
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: ' M packages/domain/src/types.ts\n',
      }),
    ).toBe(true);
  });

  it('keeps local worktree and superpowers directories ignored', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(gitignore).toContain('.worktrees/');
    expect(gitignore).toContain('.superpowers/');
  });
});
