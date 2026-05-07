import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { executorResultSchema } from '@forgeloop/contracts';
import {
  createDefaultLocalCodexEnvironment,
  runLocalCodexExecutor,
  runLocalCodexPreflight,
  type CommandChecker,
  type CommandRunner,
  type CodexRunner,
  type LocalCodexEnvironment,
} from '../../packages/executor/src/index';

import { blockingCheck, createRunSpec } from './test-fixtures';

const tempRoots: string[] = [];

const makeTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-executor-'));
  tempRoots.push(dir);
  return dir;
};

const execGit = async (cwd: string, args: readonly string[]) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  return execFileAsync('git', [...args], { cwd });
};

const okCommandChecker: CommandChecker = async () => true;

const missingCommandChecker =
  (...missing: string[]): CommandChecker =>
  async (command) =>
    !missing.includes(command);

const createPassingEnvironment = (overrides: Partial<LocalCodexEnvironment> = {}): LocalCodexEnvironment => ({
  commandExists: okCommandChecker,
  isCodexRuntimeReady: async () => true,
  isGitRepo: async () => true,
  resolveGitRef: async () => true,
  prepareWorkspace: async () => ({ ok: true, workspacePath: '/tmp/forgeloop-workspace' }),
  isWorkspaceClean: async () => true,
  isWritableDirectory: async () => true,
  runCodex: async () => undefined,
  runCommand: async () => ({ stdout: '', stderr: '' }),
  ...overrides,
});

const createGitBackedTestEnvironment = (
  workspaceRoot: string | undefined,
  overrides: Partial<LocalCodexEnvironment> = {},
): LocalCodexEnvironment => {
  const environment = createDefaultLocalCodexEnvironment({ workspaceRoot });

  return {
    ...environment,
    commandExists: async (command) => (command === 'codex' ? true : environment.commandExists(command)),
    isCodexRuntimeReady: async () => true,
    runCodex: async () => undefined,
    ...overrides,
  };
};

const createGitRepo = async () => {
  const repo = await makeTempDir();

  await execGit(repo, ['init', '-b', 'main']);
  await execGit(repo, ['config', 'user.email', 'test@example.com']);
  await execGit(repo, ['config', 'user.name', 'Test User']);
  await mkdir(join(repo, 'packages/executor/src'), { recursive: true });
  await writeFile(join(repo, 'packages/executor/src/existing.ts'), 'export const existing = true;\n');
  await execGit(repo, ['add', '.']);
  await execGit(repo, ['commit', '-m', 'initial']);
  const { stdout } = await execGit(repo, ['rev-parse', 'HEAD']);

  return {
    repo,
    head: stdout.trim(),
  };
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runLocalCodexPreflight', () => {
  it('fails when the project repo path does not exist', async () => {
    const result = await runLocalCodexPreflight(
      createRunSpec({ repo: { local_path: join(tmpdir(), 'forgeloop-missing-repo') } }),
      {
        artifactRoot: await makeTempDir(),
        environment: createPassingEnvironment(),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('does not exist');
  });

  it('fails when the project repo path is not a Git repo', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({ isGitRepo: async () => false }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('not a Git repo');
  });

  it('fails when the base commit cannot be resolved', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo, base_commit_sha: 'missing' } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({ resolveGitRef: async () => false }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('Cannot resolve Git ref missing');
  });

  it('falls back to the default branch when base commit is omitted', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(
      createRunSpec({ repo: { local_path: repo, base_commit_sha: '' as never, base_branch: 'main' } }),
      {
        artifactRoot: await makeTempDir(),
        environment: createPassingEnvironment({
          resolveGitRef: async (_repo, ref) => ref === 'main',
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.resolvedBaseRef).toBe('main');
  });

  it('fails when the artifact root is not writable', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({ isWritableDirectory: async () => false }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('Artifact root is not writable');
  });

  it('fails when the Codex runtime is missing', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({
        commandExists: missingCommandChecker('codex'),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('Missing required command: codex');
  });

  it('fails when the Codex runtime is not authenticated or ready', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({
        isCodexRuntimeReady: async () => false,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('Codex runtime is not authenticated or ready');
  });

  it('default readiness check uses Codex login status without exposing command output', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const environment = createDefaultLocalCodexEnvironment({
      workspaceRoot: await makeTempDir(),
      commandRunner: async (command: string, args: readonly string[]) => {
        calls.push({ command, args });

        return {
          stdout: 'authenticated as test@example.com',
          stderr: 'debug details that must not be surfaced',
        };
      },
    });

    await expect(environment.isCodexRuntimeReady()).resolves.toBe(true);
    expect(calls).toEqual([{ command: 'codex', args: ['login', 'status'] }]);
  });

  it('closes stdin for default command runner subprocesses', async () => {
    const environment = createDefaultLocalCodexEnvironment({ workspaceRoot: await makeTempDir() });

    const result = await environment.runCommand(
      'node',
      [
        '-e',
        'process.stdin.on("end", () => process.stdout.write("stdin-closed")); process.stdin.resume();',
      ],
      { timeout: 1_000 },
    );

    expect(result.stdout).toBe('stdin-closed');
  });

  it('sanitizes persistent workspace path segments from run session ids', async () => {
    const repo = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    const result = await runLocalCodexPreflight(
      createRunSpec({
        run_session_id: '../escape/run-session',
        repo: { local_path: repo },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createPassingEnvironment({
          prepareWorkspace: createDefaultLocalCodexEnvironment({
            workspaceRoot,
            commandRunner: async () => ({ stdout: '', stderr: '' }),
          }).prepareWorkspace,
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.workspacePath.startsWith(workspaceRoot)).toBe(true);
    expect(result.workspacePath).not.toContain('..');
  });

  it('fails when persistent workspace preparation fails', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({
        prepareWorkspace: async () => ({ ok: false, message: 'git worktree add failed' }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('git worktree add failed');
  });

  it('fails when the persistent workspace starts dirty', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({
        isWorkspaceClean: async () => false,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('Persistent workspace is not clean');
  });

  it('does not fail preflight when a required check command is missing', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(
      createRunSpec({
        repo: { local_path: repo },
        required_checks: [blockingCheck({ command: 'missing-test-command --version' })],
        context: { required_checks: [blockingCheck({ command: 'missing-test-command --version' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createPassingEnvironment(),
      },
    );

    expect(result.ok).toBe(true);
  });
});

describe('runLocalCodexExecutor', () => {
  it('keeps post-terminal source repo mutation checks inside the evidence module', () => {
    const executorSource = readFileSync('packages/executor/src/local-codex-executor.ts', 'utf8');

    expect(executorSource).not.toContain('verifySourceRepoUnchanged');
    expect(executorSource).not.toContain('Source repo changed outside the run worktree.');
  });

  it('returns preflight_failed without invoking Codex when preflight is invalid', async () => {
    let invoked = false;
    const runner: CodexRunner = {
      run: async () => {
        invoked = true;
        return { status: 'succeeded', summary: 'should not run' };
      },
    };

    const result = await runLocalCodexExecutor(
      createRunSpec({ repo: { local_path: join(tmpdir(), 'missing-forgeloop-repo') } }),
      {
        artifactRoot: await makeTempDir(),
        environment: createPassingEnvironment(),
        runner,
      },
    );

    expect(invoked).toBe(false);
    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'preflight_failed',
        retryable: false,
      },
    });
  });

  it('captures fake runner changes, patch artifact, and successful checks in a persistent workspace', async () => {
    const { repo, head } = await createGitRepo();
    const artifactRoot = await makeTempDir();
    const runner: CodexRunner = {
      run: async ({ workspacePath, runSpec }) => {
        await mkdir(join(workspacePath, 'packages/executor/src'), { recursive: true });
        await writeFile(
          join(workspacePath, 'packages/executor/src/local-codex-executor.ts'),
          `export const objective = ${JSON.stringify(runSpec.objective)};\n`,
        );

        return { status: 'succeeded', summary: 'Fake Codex runner completed.' };
      },
    };

    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })] },
      }),
      {
        artifactRoot,
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner,
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'succeeded',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/executor/src/local-codex-executor.ts',
          change_kind: 'added',
        },
      ],
      checks: [
        {
          check_id: 'unit',
          status: 'succeeded',
          exit_code: 0,
        },
      ],
    });
    const diffArtifact = result.artifacts.find((artifact) => artifact.kind === 'diff');
    expect(diffArtifact?.local_ref).toBeDefined();
    await expect(readFile(diffArtifact?.local_ref ?? '', 'utf8')).resolves.toContain(
      'Implement the executor adapter',
    );
    await expect(stat(result.raw_metadata.workspace_path as string)).resolves.toBeDefined();
  });

  it('applies blocking check failure semantics after a successful runner invocation', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(7)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(7)"' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'required_check_failed',
      },
      checks: [
        {
          status: 'failed',
          exit_code: 7,
          blocks_review: true,
        },
      ],
    });
  });

  it('records blocking required-check timeouts as required_check_failed', async () => {
    const { repo, head } = await createGitRepo();
    const timeoutCheck = blockingCheck({
      command: 'node -e "setTimeout(() => {}, 5000)"',
      timeout_seconds: 1,
    });
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [timeoutCheck],
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'required_check_failed',
      },
      checks: [
        {
          status: 'timed_out',
          exit_code: null,
          blocks_review: true,
        },
      ],
    });
  });

  it('returns executor_error when required check execution throws', async () => {
    const { repo, head } = await createGitRepo();
    const artifactRoot = await makeTempDir();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })] },
      }),
      {
        artifactRoot,
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => {
            await rm(artifactRoot, { recursive: true, force: true });
            await writeFile(artifactRoot, 'artifact root is now a file');

            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'executor_error',
        message: expect.stringContaining('Required check execution failed'),
        retryable: true,
      },
      raw_metadata: {
        source_repo_before_status: '',
        source_repo_after_status: '',
      },
    });
  });

  it('treats a missing non-blocking check command as a check failure without failing execution', async () => {
    const { repo, head } = await createGitRepo();
    const nonBlockingCheck = blockingCheck({
      check_id: 'optional-tool',
      display_name: 'Optional tool',
      command: 'forgeloop-missing-command --version',
      blocks_review: false,
    });
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [nonBlockingCheck],
        context: { required_checks: [nonBlockingCheck] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'succeeded',
      checks: [
        {
          check_id: 'optional-tool',
          status: 'failed',
          exit_code: 127,
          blocks_review: false,
        },
      ],
    });
  });

  it('uses executor_error for generic default Codex process failures after preflight', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({ repo: { local_path: repo, base_commit_sha: head } }),
      {
        artifactRoot: await makeTempDir(),
        codexHome: join(await makeTempDir(), '.codex'),
        environment: createGitBackedTestEnvironment(await makeTempDir(), {
          runCodex: async () => {
            throw new Error('prompt rejected');
          },
        }),
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'executor_error',
        message: expect.stringContaining('prompt rejected'),
      },
    });
  });

  it('passes required checks in the frozen default Codex prompt', async () => {
    const { repo, head } = await createGitRepo();
    let prompt = '';

    await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ check_id: 'prompt-check', command: 'pnpm test tests/executor' })],
        context: { required_checks: [blockingCheck({ check_id: 'prompt-check', command: 'pnpm test tests/executor' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        codexHome: join(await makeTempDir(), '.codex'),
        environment: createGitBackedTestEnvironment(await makeTempDir(), {
          runCodex: async (input) => {
            prompt = input.prompt;
          },
        }),
      },
    );

    expect(prompt).toContain('Required checks:');
    expect(prompt).toContain('prompt-check');
    expect(prompt).toContain('pnpm test tests/executor');
  });

  it('uses dangerous JSON exec without a main-run timeout and sanitized environment for the default Codex invocation', async () => {
    const { repo, head } = await createGitRepo();
    const workspaceRoot = await makeTempDir();
    const codexHome = join(await makeTempDir(), '.codex');
    const commandCalls: Array<{
      command: string;
      args: readonly string[];
      env?: NodeJS.ProcessEnv;
      timeout?: number;
    }> = [];
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const commandRunner: CommandRunner = async (command, args, options) => {
      commandCalls.push({ command, args, env: options?.env, timeout: options?.timeout });

      if (command === 'codex') {
        return { stdout: '', stderr: '' };
      }

      const { stdout, stderr } = await execFileAsync(command, [...args], options);
      return { stdout: String(stdout), stderr: String(stderr) };
    };
    const originalGithubToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'secret-token';

    try {
      const result = await runLocalCodexExecutor(
        createRunSpec({
          repo: { local_path: repo, base_commit_sha: head },
          required_checks: [],
          context: { required_checks: [] },
        }),
        {
          artifactRoot: await makeTempDir(),
          codexHome,
          environment: createDefaultLocalCodexEnvironment({ workspaceRoot, commandRunner }),
        },
      );

      expect(executorResultSchema.parse(result)).toMatchObject({ status: 'succeeded' });
      const codexExecCall = commandCalls.find(
        (call) => call.command === 'codex' && call.args[0] === 'exec',
      );
      expect(codexExecCall?.args).toEqual(
        expect.arrayContaining(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox']),
      );
      expect(codexExecCall?.args).not.toContain('workspace-write');
      expect(codexExecCall?.timeout).toBeUndefined();
      expect(codexExecCall?.env).not.toHaveProperty('GITHUB_TOKEN');
    } finally {
      if (originalGithubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalGithubToken;
      }
    }
  });

  it('uses the same explicit Codex auth env for readiness and default invocation', async () => {
    const { repo, head } = await createGitRepo();
    const workspaceRoot = await makeTempDir();
    const codexHome = join(await makeTempDir(), '.codex');
    const codexEnvs: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const commandRunner: CommandRunner = async (command, args, options) => {
      if (command === 'codex') {
        codexEnvs.push({ args, env: options?.env ?? {} });
        return { stdout: '', stderr: '' };
      }

      const { stdout, stderr } = await execFileAsync(command, [...args], options);
      return { stdout: String(stdout), stderr: String(stderr) };
    };

    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [],
        context: { required_checks: [] },
      }),
      {
        artifactRoot: await makeTempDir(),
        codexHome,
        environment: createDefaultLocalCodexEnvironment({ workspaceRoot, commandRunner }),
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({ status: 'succeeded' });
    const readinessEnv = codexEnvs.find((call) => call.args.join(' ') === 'login status')?.env;
    const invocationEnv = codexEnvs.find((call) => call.args[0] === 'exec')?.env;
    expect(readinessEnv?.CODEX_HOME).toBe(codexHome);
    expect(invocationEnv?.CODEX_HOME).toBe(codexHome);
    expect(readinessEnv?.HOME).toBe(invocationEnv?.HOME);
    expect(readinessEnv?.XDG_CONFIG_HOME).toBe(invocationEnv?.XDG_CONFIG_HOME);
  });

  it('fails preflight before default Codex invocation when no explicit Codex home is configured', async () => {
    const { repo, head } = await createGitRepo();
    let codexInvoked = false;
    const originalCodexHome = process.env.CODEX_HOME;
    const originalForgeloopCodexHome = process.env.FORGELOOP_CODEX_HOME;
    delete process.env.CODEX_HOME;
    delete process.env.FORGELOOP_CODEX_HOME;

    try {
      const result = await runLocalCodexExecutor(
        createRunSpec({
          repo: { local_path: repo, base_commit_sha: head },
          required_checks: [],
          context: { required_checks: [] },
        }),
        {
          artifactRoot: await makeTempDir(),
          environment: createGitBackedTestEnvironment(await makeTempDir(), {
            runCodex: async () => {
              codexInvoked = true;
            },
          }),
        },
      );

      expect(codexInvoked).toBe(false);
      expect(executorResultSchema.parse(result)).toMatchObject({
        status: 'failed',
        failure: {
          kind: 'preflight_failed',
          message: expect.stringContaining('Codex home is not configured'),
        },
      });
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalForgeloopCodexHome === undefined) {
        delete process.env.FORGELOOP_CODEX_HOME;
      } else {
        process.env.FORGELOOP_CODEX_HOME = originalForgeloopCodexHome;
      }
    }
  });

  it('returns preflight_failed when default Codex env setup cannot use artifact root', async () => {
    const { repo, head } = await createGitRepo();
    const artifactRootParent = await makeTempDir();
    const artifactRootFile = join(artifactRootParent, 'artifact-root-file');
    const codexHome = join(await makeTempDir(), '.codex');
    let codexInvoked = false;
    await writeFile(artifactRootFile, 'not a directory');

    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [],
        context: { required_checks: [] },
      }),
      {
        artifactRoot: artifactRootFile,
        codexHome,
        environment: createGitBackedTestEnvironment(await makeTempDir(), {
          runCodex: async () => {
            codexInvoked = true;
          },
        }),
      },
    );

    expect(codexInvoked).toBe(false);
    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'preflight_failed',
        message: expect.stringContaining('Codex environment setup failed'),
      },
    });
  });

  it('disables git remote pushes through process env without mutating shared repo config', async () => {
    const { repo, head } = await createGitRepo();
    await execGit(repo, ['remote', 'add', 'origin', 'https://example.com/repo.git']);
    const remoteCheck = blockingCheck({
      check_id: 'remote-push',
      command: 'git remote get-url --push origin > packages/executor/src/push-url.txt',
    });

    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [remoteCheck],
        context: { required_checks: [remoteCheck] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({ status: 'succeeded' });
    await expect(readFile(join(result.raw_metadata.workspace_path as string, 'packages/executor/src/push-url.txt'), 'utf8'))
      .resolves.toBe('DISABLED_BY_FORGELOOP\n');
    await expect(execGit(repo, ['remote', 'get-url', 'origin'])).resolves.toMatchObject({
      stdout: 'https://example.com/repo.git\n',
    });
    await expect(execGit(repo, ['config', '--get', 'extensions.worktreeConfig'])).rejects.toThrow();
  });

  it('uses .worktrees under the source repo by default for compatibility runs', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [],
        context: { required_checks: [] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(undefined),
        runner: {
          run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({ status: 'succeeded' });
    expect(result.raw_metadata.workspace_path).toBe(join(repo, '.worktrees', 'run-session-1'));
  });

  it('runs required checks with hermetic home and without ambient auth credentials', async () => {
    const { repo, head } = await createGitRepo();
    const originalEnv = {
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
    };
    process.env.GH_TOKEN = 'gh-secret';
    process.env.GITHUB_TOKEN = 'github-secret';
    process.env.OPENAI_API_KEY = 'openai-secret';
    process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent.sock';
    const check = blockingCheck({
      check_id: 'env-check',
      command:
        'node -e "const fs=require(\'fs\'); fs.mkdirSync(\'packages/executor/src\', {recursive:true}); fs.writeFileSync(\'packages/executor/src/env.json\', JSON.stringify({HOME:process.env.HOME,GH_TOKEN:process.env.GH_TOKEN,GITHUB_TOKEN:process.env.GITHUB_TOKEN,OPENAI_API_KEY:process.env.OPENAI_API_KEY,SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK,GIT_CONFIG_GLOBAL:process.env.GIT_CONFIG_GLOBAL,GIT_TERMINAL_PROMPT:process.env.GIT_TERMINAL_PROMPT}))"',
    });

    try {
      const result = await runLocalCodexExecutor(
        createRunSpec({
          repo: { local_path: repo, base_commit_sha: head },
          required_checks: [check],
          context: { required_checks: [check] },
        }),
        {
          artifactRoot: await makeTempDir(),
          environment: createGitBackedTestEnvironment(await makeTempDir()),
          runner: {
            run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
          },
        },
      );

      expect(executorResultSchema.parse(result)).toMatchObject({ status: 'succeeded' });
      const envJsonPath = join(result.raw_metadata.workspace_path as string, 'packages/executor/src/env.json');
      const envSnapshot = JSON.parse(await readFile(envJsonPath, 'utf8'));
      expect(envSnapshot.HOME).toContain('.forgeloop-hermetic-env');
      expect(envSnapshot.HOME).not.toBe(process.env.HOME);
      expect(envSnapshot.GH_TOKEN).toBeUndefined();
      expect(envSnapshot.GITHUB_TOKEN).toBeUndefined();
      expect(envSnapshot.OPENAI_API_KEY).toBeUndefined();
      expect(envSnapshot.SSH_AUTH_SOCK).toBeUndefined();
      expect(envSnapshot.GIT_TERMINAL_PROMPT).toBe('0');
      expect(envSnapshot.GIT_CONFIG_GLOBAL).toContain('.forgeloop-hermetic-env');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('does not expose Codex home to required checks while default Codex receives it', async () => {
    const { repo, head } = await createGitRepo();
    const codexHome = join(await makeTempDir(), '.codex');
    let codexInvocationEnv: NodeJS.ProcessEnv | undefined;
    const check = blockingCheck({
      check_id: 'codex-env-check',
      command:
        'node -e "const fs=require(\'fs\'); fs.mkdirSync(\'packages/executor/src\', {recursive:true}); fs.writeFileSync(\'packages/executor/src/codex-env.json\', JSON.stringify({CODEX_HOME:process.env.CODEX_HOME,HOME:process.env.HOME}))"',
    });

    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [check],
        context: { required_checks: [check] },
      }),
      {
        artifactRoot: await makeTempDir(),
        codexHome,
        environment: createGitBackedTestEnvironment(await makeTempDir(), {
          isCodexRuntimeReady: async () => true,
          runCodex: async (input) => {
            codexInvocationEnv = input.env;
          },
        }),
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({ status: 'succeeded' });
    expect(codexInvocationEnv?.CODEX_HOME).toBe(codexHome);
    const envJsonPath = join(result.raw_metadata.workspace_path as string, 'packages/executor/src/codex-env.json');
    const checkEnv = JSON.parse(await readFile(envJsonPath, 'utf8'));
    expect(checkEnv.CODEX_HOME).toBeUndefined();
    expect(checkEnv.HOME).not.toBe(codexInvocationEnv?.HOME);
  });

  it('records forbidden blocking checks as failed without executing them', async () => {
    const { repo, head } = await createGitRepo();
    const markerPath = join(repo, 'should-not-exist');
    const forbiddenCheck = blockingCheck({
      check_id: 'publish',
      display_name: 'Publish',
      command: `git push origin main && touch ${JSON.stringify(markerPath)}`,
    });
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [forbiddenCheck],
        context: { required_checks: [forbiddenCheck] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: { kind: 'required_check_failed' },
      checks: [{ check_id: 'publish', status: 'failed', exit_code: 1 }],
    });
    await expect(stat(markerPath)).rejects.toThrow();
  });

  it('returns path_violation before running checks for runner changes outside allowed paths', async () => {
    const { repo, head } = await createGitRepo();
    let checkRan = false;
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async ({ workspacePath }) => {
            await writeFile(join(workspacePath, 'README.md'), 'outside allowed paths\n');
            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    checkRan = result.checks.length > 0;
    expect(checkRan).toBe(false);
    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: { kind: 'path_violation' },
      changed_files: [{ path: 'README.md' }],
    });
  });

  it('returns path_violation when the source repo changes outside the run worktree', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [],
        context: { required_checks: [] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => {
            await mkdir(join(repo, 'packages/domain/src'), { recursive: true });
            await writeFile(join(repo, 'packages/domain/src/types.ts'), 'export const mutated = true;\n');

            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'path_violation',
        message: 'Source repo changed outside the run worktree.',
        retryable: false,
      },
      raw_metadata: {
        source_repo_before_status: '',
        source_repo_after_status: expect.stringContaining('packages/domain/src/types.ts'),
      },
    });
  });

  it('returns schema-valid path_violation when source repo mutates and a blocking check fails', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(1)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(1)"' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => {
            await mkdir(join(repo, 'packages/domain/src'), { recursive: true });
            await writeFile(join(repo, 'packages/domain/src/types.ts'), 'export const mutated = true;\n');

            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    const parsed = executorResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result).toMatchObject({
      status: 'failed',
      summary: expect.stringContaining('Source repo changed outside the run worktree.'),
      failure: {
        kind: 'path_violation',
        message: 'Source repo changed outside the run worktree.',
        retryable: false,
      },
      checks: [
        {
          status: 'failed',
          exit_code: 1,
          blocks_review: true,
        },
      ],
      raw_metadata: {
        source_repo_before_status: '',
        source_repo_after_status: expect.stringContaining('packages/domain/src/types.ts'),
      },
    });
  });

  it('returns schema-valid path_violation when a failed blocking check mutates a forbidden path', async () => {
    const { repo, head } = await createGitRepo();
    const forbiddenMutationCheck = blockingCheck({
      command: `node -e "const fs=require('node:fs');fs.mkdirSync('packages/contracts/src',{recursive:true});fs.writeFileSync('packages/contracts/src/check.ts','export const bad = true;\\n');process.exit(1)"`,
    });
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [forbiddenMutationCheck],
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => ({ status: 'succeeded', summary: 'Runner completed.' }),
        },
      },
    );

    const parsed = executorResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result).toMatchObject({
      status: 'failed',
      summary: expect.stringContaining('Changed file is outside allowed paths or inside forbidden paths'),
      failure: {
        kind: 'path_violation',
        retryable: false,
      },
      changed_files: [{ path: 'packages/contracts/src/check.ts' }],
      checks: [
        {
          status: 'failed',
          exit_code: 1,
          blocks_review: true,
        },
      ],
    });
  });

  it('returns failed evidence when source repo verification throws after diff capture', async () => {
    const { repo, head } = await createGitRepo();
    const baseEnvironment = createGitBackedTestEnvironment(await makeTempDir());
    const baseRunCommand = baseEnvironment.runCommand;
    let failSourceStatus = false;
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [],
        context: { required_checks: [] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: {
          ...baseEnvironment,
          runCommand: async (command, args, options) => {
            if (failSourceStatus && command === 'git' && args[0] === 'status' && options?.cwd === repo) {
              throw new Error('source repo metadata missing');
            }

            return baseRunCommand(command, args, options);
          },
        },
        runner: {
          run: async ({ workspacePath }) => {
            await writeFile(join(workspacePath, 'packages/executor/src/source-verify.ts'), 'export const ok = true;\n');
            failSourceStatus = true;

            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'path_violation',
        message: expect.stringContaining('Source repo verification failed'),
        retryable: false,
      },
      changed_files: [
        {
          path: 'packages/executor/src/source-verify.ts',
          change_kind: 'added',
        },
      ],
      artifacts: expect.arrayContaining([
        expect.objectContaining({ kind: 'diff' }),
        expect.objectContaining({ kind: 'changed_files' }),
        expect.objectContaining({ kind: 'execution_summary' }),
      ]),
      raw_metadata: {
        source_repo_before_status: '',
        source_repo_after_status: null,
      },
    });
  });

  it('returns preflight failure and skips runner when source repo snapshot fails', async () => {
    const { repo, head } = await createGitRepo();
    const baseEnvironment = createGitBackedTestEnvironment(await makeTempDir());
    const baseRunCommand = baseEnvironment.runCommand;
    let invoked = false;
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [],
        context: { required_checks: [] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: {
          ...baseEnvironment,
          runCommand: async (command, args, options) => {
            if (command === 'git' && args[0] === 'status' && options?.cwd === repo) {
              throw new Error('source repo status unavailable');
            }

            return baseRunCommand(command, args, options);
          },
        },
        runner: {
          run: async () => {
            invoked = true;

            return { status: 'succeeded', summary: 'should not run' };
          },
        },
      },
    );

    expect(invoked).toBe(false);
    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'preflight_failed',
        message: expect.stringContaining('Source repo status snapshot failed'),
        retryable: false,
      },
    });
  });

  it('returns path_violation from evidence capture when a failed runner mutates the source repo', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async () => {
            await writeFile(join(repo, 'README.md'), 'source mutation\n');

            return {
              status: 'failed',
              summary: 'Runner failed after mutation.',
              failure: {
                kind: 'executor_process_failed',
                message: 'Runner failed after mutation.',
                retryable: true,
              },
            };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      checks: [],
      failure: {
        kind: 'path_violation',
        message: 'Source repo changed outside the run worktree.',
        retryable: false,
      },
      raw_metadata: {
        source_repo_before_status: '',
        source_repo_after_status: expect.stringContaining('README.md'),
      },
    });
  });

  it('captures failed runner forbidden workspace changes as path_violation evidence', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async ({ workspacePath }) => {
            await mkdir(join(workspacePath, 'packages/contracts/src'), { recursive: true });
            await writeFile(join(workspacePath, 'packages/contracts/src/failed.ts'), 'export const bad = true;\n');

            return {
              status: 'failed',
              summary: 'Runner failed after forbidden change.',
              failure: {
                kind: 'executor_process_failed',
                message: 'Runner failed after forbidden change.',
                retryable: true,
              },
            };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      checks: [],
      failure: {
        kind: 'path_violation',
        message: expect.stringContaining('packages/contracts/src/failed.ts'),
        retryable: false,
      },
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/contracts/src/failed.ts',
          change_kind: 'added',
        },
      ],
      artifacts: expect.arrayContaining([
        expect.objectContaining({ kind: 'diff' }),
        expect.objectContaining({ kind: 'changed_files' }),
        expect.objectContaining({ kind: 'execution_summary' }),
      ]),
    });
    const diffArtifact = result.artifacts.find((artifact) => artifact.kind === 'diff');
    await expect(readFile(diffArtifact?.local_ref ?? '', 'utf8')).resolves.toContain('packages/contracts/src/failed.ts');
  });

  it('captures failed runner allowed workspace changes with the original runner failure', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })],
        context: { required_checks: [blockingCheck({ command: 'node -e "process.exit(0)"' })] },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async ({ workspacePath }) => {
            await writeFile(join(workspacePath, 'packages/executor/src/failed-but-allowed.ts'), 'export const ok = true;\n');

            return {
              status: 'failed',
              summary: 'Runner failed after allowed change.',
              failure: {
                kind: 'executor_process_failed',
                message: 'Runner failed after allowed change.',
                retryable: true,
              },
            };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      checks: [],
      failure: {
        kind: 'executor_process_failed',
        message: 'Runner failed after allowed change.',
        retryable: true,
      },
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/executor/src/failed-but-allowed.ts',
          change_kind: 'added',
        },
      ],
      artifacts: expect.arrayContaining([
        expect.objectContaining({ kind: 'diff' }),
        expect.objectContaining({ kind: 'changed_files' }),
        expect.objectContaining({ kind: 'execution_summary' }),
      ]),
    });
    const changedFilesArtifact = result.artifacts.find((artifact) => artifact.kind === 'changed_files');
    await expect(readFile(changedFilesArtifact?.local_ref ?? '', 'utf8')).resolves.toContain(
      'packages/executor/src/failed-but-allowed.ts',
    );
  });

  it('returns final path_violation when checks mutate forbidden files and captures the final diff', async () => {
    const { repo, head } = await createGitRepo();
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [blockingCheck({ command: 'mkdir -p packages/contracts/src && echo bad > packages/contracts/src/mutate.ts' })],
        context: {
          required_checks: [blockingCheck({ command: 'mkdir -p packages/contracts/src && echo bad > packages/contracts/src/mutate.ts' })],
        },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async ({ workspacePath }) => {
            await writeFile(join(workspacePath, 'packages/executor/src/allowed.ts'), 'export const ok = true;\n');
            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: { kind: 'path_violation' },
      changed_files: expect.arrayContaining([
        expect.objectContaining({ path: 'packages/contracts/src/mutate.ts' }),
      ]),
    });
    const diffArtifact = result.artifacts.find((artifact) => artifact.kind === 'diff');
    await expect(readFile(diffArtifact?.local_ref ?? '', 'utf8')).resolves.toContain('packages/contracts/src/mutate.ts');
  });

  it('rejects renames from forbidden previous paths into allowed paths', async () => {
    const { repo, head } = await createGitRepo();
    await mkdir(join(repo, 'packages/contracts/src'), { recursive: true });
    await writeFile(join(repo, 'packages/contracts/src/secret.ts'), 'export const secret = true;\n');
    await execGit(repo, ['add', '.']);
    await execGit(repo, ['commit', '-m', 'add forbidden source']);
    const { stdout } = await execGit(repo, ['rev-parse', 'HEAD']);
    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: stdout.trim() },
      }),
      {
        artifactRoot: await makeTempDir(),
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async ({ workspacePath }) => {
            await mkdir(join(workspacePath, 'packages/executor/src'), { recursive: true });
            await execGit(workspacePath, ['mv', 'packages/contracts/src/secret.ts', 'packages/executor/src/secret.ts']);
            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: { kind: 'path_violation' },
      changed_files: [
        {
          path: 'packages/executor/src/secret.ts',
          previous_path: 'packages/contracts/src/secret.ts',
          change_kind: 'renamed',
        },
      ],
    });
  });

  it('keeps artifact paths under artifact root for malicious run and check ids', async () => {
    const { repo, head } = await createGitRepo();
    const artifactRoot = await makeTempDir();
    const maliciousCheck = blockingCheck({
      check_id: '../check/escape',
      command: 'node -e "process.exit(0)"',
    });
    const result = await runLocalCodexExecutor(
      createRunSpec({
        run_session_id: '../session/escape',
        repo: { local_path: repo, base_commit_sha: head },
        required_checks: [maliciousCheck],
        context: { required_checks: [maliciousCheck] },
      }),
      {
        artifactRoot,
        environment: createGitBackedTestEnvironment(await makeTempDir()),
        runner: {
          run: async ({ workspacePath }) => {
            await writeFile(join(workspacePath, 'packages/executor/src/safe.ts'), 'export const safe = true;\n');
            return { status: 'succeeded', summary: 'Runner completed.' };
          },
        },
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({ status: 'succeeded' });
    for (const artifact of result.artifacts) {
      expect(artifact.local_ref?.startsWith(artifactRoot)).toBe(true);
      expect(artifact.local_ref?.slice(artifactRoot.length)).not.toContain('..');
    }
  });

  it('returns executor_error with logs artifact when diff capture fails', async () => {
    const { repo, head } = await createGitRepo();
    const workspaceRoot = await makeTempDir();
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const commandRunner: CommandRunner = async (command, args, options) => {
      if (command === 'git' && args[0] === 'diff' && options?.cwd !== repo) {
        throw new Error('stdout maxBuffer length exceeded');
      }
      if (command === 'codex') {
        return { stdout: '', stderr: '' };
      }

      const { stdout, stderr } = await execFileAsync(command, [...args], options);
      return { stdout: String(stdout), stderr: String(stderr) };
    };

    const result = await runLocalCodexExecutor(
      createRunSpec({
        repo: { local_path: repo, base_commit_sha: head },
      }),
      {
        artifactRoot: await makeTempDir(),
        codexHome: join(await makeTempDir(), '.codex'),
        environment: createDefaultLocalCodexEnvironment({ workspaceRoot, commandRunner }),
      },
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'executor_error',
        message: expect.stringContaining('diff capture failed'),
      },
      artifacts: [expect.objectContaining({ kind: 'logs' })],
    });
  });
});
