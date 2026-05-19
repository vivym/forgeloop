import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PathSafety,
  createDefaultLocalCodexEnvironment,
  createCodexWorktreePathSafety,
  preparePersistentGitWorktree,
  safeGitCommandSpec,
  snapshotSourceRepoStatus,
  sourceRepoWasMutated,
  verifySourceRepoUnchanged,
  worktreePathForRun,
  type ResourceGovernor,
  type ResourceGovernorReadiness,
  type ResourceGovernorRunInput,
  type RuntimeSafetyAttestation,
  type SandboxLeaseInput,
  type StructuredCommandResult,
  type TrustedToolchainConfig,
} from '../../packages/executor/src/index';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];
const shellPath = realpathSync('/bin/sh');
const shellRoot = dirname(shellPath);

const makeTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-worktree-'));
  tempRoots.push(dir);
  return dir;
};

const execGit = async (cwd: string, args: readonly string[]) => execFileAsync('git', [...args], { cwd });

class RecordingGovernor implements ResourceGovernor {
  readonly governorId = 'recording-governor';
  readonly provenance = 'test_only_mock' as const;
  readonly calls: ResourceGovernorRunInput[] = [];

  constructor(private readonly outputs: string[] = []) {}

  async checkReadiness(): Promise<ResourceGovernorReadiness> {
    return { status: 'ready', governor_id: this.governorId, provenance: this.provenance };
  }

  async createRunExecutionAttestation(): Promise<RuntimeSafetyAttestation> {
    throw new Error('not used');
  }

  async createRunLease(_input: SandboxLeaseInput) {
    throw new Error('not used');
  }

  async consumeLeaseCommandInvocation(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult> {
    this.calls.push(input);
    const next = this.outputs.shift() ?? '';
    return {
      exit_code: 0,
      timed_out: false,
      stdout_ref: next,
      stdout_truncated: false,
      stderr_truncated: false,
      visibility: 'internal',
      public_summary: 'recorded',
      internal_diagnostic_ref: next,
    };
  }
}

const trustedToolchains = (): TrustedToolchainConfig => ({
  root_paths: [shellRoot],
  executable_paths: { git: shellPath },
  path_entries: [shellRoot],
  writable: false,
});

const bootstrapContext = () => ({
  bootstrapId: 'bootstrap-run-session-1',
  artifactRoot: '/artifacts/run-session-1',
  trustedToolchains: trustedToolchains(),
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Codex persistent worktrees', () => {
  it('uses a stable per-run worktree path under the source repo', () => {
    expect(worktreePathForRun('/Users/viv/projs/forgeloop', 'run-session-1')).toBe(
      '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
    );
  });

  it('ignores outside workspaceRoot overrides for the local Codex worktree boundary', () => {
    expect(worktreePathForRun('/Users/viv/projs/forgeloop', 'run-session-1', '/tmp/outside-worktrees')).toBe(
      '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
    );
  });

  it('rejects a .worktrees root that resolves outside the canonical repo root', async () => {
    const repo = await makeTempDir();
    const outside = await makeTempDir();
    await symlink(outside, join(repo, '.worktrees'));

    await expect(createCodexWorktreePathSafety(repo)).rejects.toMatchObject({
      code: expect.stringMatching(/^workspace_(path|symlink)_escape$/),
    });
  });

  it('sanitizes run workspace segments and rejects mismatched cleanup targets before removal', async () => {
    const repo = await makeTempDir();
    await mkdir(join(repo, '.worktrees'), { recursive: true });
    const governor = new RecordingGovernor(['']);
    const pathSafety = await PathSafety.create({ repoRoot: repo, worktreeRoot: join(repo, '.worktrees') });

    const result = await preparePersistentGitWorktree({
      repoPath: repo,
      baseRef: 'main',
      runSessionId: 'run/session../1',
      pathSafety,
      bootstrapGovernor: governor,
      commandPolicy: bootstrapContext(),
      readCommandOutputRef: async (ref) => ref,
    });

    expect(result).toMatchObject({ ok: true, workspacePath: join(realpathSync(repo), '.worktrees', 'run-session-1') });
    expect(governor.calls.some((call) => call.scope === 'bootstrap' && call.bindings.commandId === 'worktree-remove')).toBe(false);
  });

  it('materializes safe git worktree commands and executes them through the bootstrap governor', async () => {
    const repo = await makeTempDir();
    await mkdir(join(repo, '.worktrees'), { recursive: true });
    const pathSafety = await PathSafety.create({ repoRoot: repo, worktreeRoot: join(repo, '.worktrees') });
    const workspacePath = join(realpathSync(repo), '.worktrees', 'run-session-1');
    const governor = new RecordingGovernor([`worktree ${workspacePath}\n`]);

    const result = await preparePersistentGitWorktree({
      repoPath: repo,
      baseRef: 'base-ref',
      runSessionId: 'run-session-1',
      pathSafety,
      bootstrapGovernor: governor,
      commandPolicy: bootstrapContext(),
      readCommandOutputRef: async (ref) => ref,
    });

    expect(result).toMatchObject({ ok: true, workspacePath });
    expect(governor.calls.map((call) => call.scope)).toEqual(['bootstrap', 'bootstrap', 'bootstrap']);
    expect(governor.calls.map((call) => call.scope === 'bootstrap' ? call.bindings.commandId : '')).toEqual([
      'worktree-list',
      'worktree-remove',
      'worktree-add',
    ]);
    expect(governor.calls[2]?.command).toMatchObject({
      executable: 'git',
      resolved_executable_path: shellPath,
      source_write_policy: 'read_only',
      visibility: 'internal',
    });
    expect(governor.calls[2]?.command.args).toEqual(
      expect.arrayContaining([
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'credential.helper=',
        '-c',
        'diff.external=',
        'worktree',
        'add',
        '--detach',
        '--no-checkout',
        workspacePath,
        'base-ref',
      ]),
    );
  });

  it('safe git profile disables hooks, prompts, credential helpers, filters, unsafe protocols, and submodule recursion', () => {
    const command = safeGitCommandSpec({ args: ['status', '--porcelain=v2', '-z'], cwd: 'workspace_root' });

    expect(command.env).toEqual({
      GIT_ATTR_NOSYSTEM: '1',
      GIT_CONFIG: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
    });
    expect(command.args.join('\0')).toContain('core.hooksPath=/dev/null');
    expect(command.args.join('\0')).toContain('credential.helper=');
    expect(command.args.join('\0')).toContain('diff.external=');
    expect(command.args.join('\0')).toContain('filter.lfs.process=');
    expect(command.args.join('\0')).toContain('filter.lfs.required=false');
    expect(command.args.join('\0')).toContain('protocol.ext.allow=never');
    expect(command.args.join('\0')).toContain('submodule.recurse=false');
  });

  it('detects source repo mutation from porcelain status changes', () => {
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: ' M packages/domain/src/types.ts\n',
      }),
    ).toBe(true);
  });

  it('ignores run worktree porcelain while still detecting normal source porcelain changes', () => {
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: '?? .worktrees/run-b/packages/executor/src/file.ts\n',
      }),
    ).toBe(false);
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: '?? packages/executor/src/file.ts\n',
      }),
    ).toBe(true);
  });

  it('detects source repo mutation when dirty porcelain stays the same but content changes', async () => {
    const repo = await makeTempDir();
    await execGit(repo, ['init', '-b', 'main']);
    await execGit(repo, ['config', 'user.email', 'test@example.com']);
    await execGit(repo, ['config', 'user.name', 'Test User']);
    await writeFile(join(repo, 'tracked.txt'), 'clean\n');
    await execGit(repo, ['add', '.']);
    await execGit(repo, ['commit', '-m', 'initial']);
    await writeFile(join(repo, 'tracked.txt'), 'dirty before\n');
    await writeFile(join(repo, 'untracked.txt'), 'untracked before\n');

    const environment = createDefaultLocalCodexEnvironment();
    const snapshot = await snapshotSourceRepoStatus(environment, repo);
    await writeFile(join(repo, 'tracked.txt'), 'dirty after\n');
    await writeFile(join(repo, 'untracked.txt'), 'untracked after\n');
    const result = await verifySourceRepoUnchanged(environment, snapshot);

    expect(result.beforePorcelain).toBe(result.afterPorcelain);
    expect(result.unchanged).toBe(false);
  });

  it('detects source repo mutation inside an untracked nested repository directory', async () => {
    const repo = await makeTempDir();
    await execGit(repo, ['init', '-b', 'main']);
    await execGit(repo, ['config', 'user.email', 'test@example.com']);
    await execGit(repo, ['config', 'user.name', 'Test User']);
    await writeFile(join(repo, 'tracked.txt'), 'clean\n');
    await execGit(repo, ['add', '.']);
    await execGit(repo, ['commit', '-m', 'initial']);
    const nestedRepo = join(repo, 'vendor', 'nested');
    await mkdir(nestedRepo, { recursive: true });
    await execGit(nestedRepo, ['init', '-b', 'main']);
    await writeFile(join(nestedRepo, 'nested.txt'), 'nested before\n');

    const environment = createDefaultLocalCodexEnvironment();
    const snapshot = await snapshotSourceRepoStatus(environment, repo);
    await writeFile(join(nestedRepo, 'nested.txt'), 'nested after\n');
    const result = await verifySourceRepoUnchanged(environment, snapshot);

    expect(result.beforePorcelain).toBe(result.afterPorcelain);
    expect(result.unchanged).toBe(false);
  });

  it('keeps local worktree and superpowers directories ignored', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(gitignore).toContain('.worktrees/');
    expect(gitignore).toContain('.superpowers/');
  });
});
