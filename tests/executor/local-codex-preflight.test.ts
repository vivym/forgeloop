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
  ...overrides,
});

const createGitBackedTestEnvironment = (
  workspaceRoot: string,
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
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await mkdir(join(repo, 'packages/executor/src'), { recursive: true });
  await writeFile(join(repo, 'packages/executor/src/existing.ts'), 'export const existing = true;\n');
  await execFileAsync('git', ['add', '.'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });

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

  it('fails when disposable workspace preparation fails', async () => {
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

  it('fails when the disposable workspace starts dirty', async () => {
    const repo = await makeTempDir();
    const result = await runLocalCodexPreflight(createRunSpec({ repo: { local_path: repo } }), {
      artifactRoot: await makeTempDir(),
      environment: createPassingEnvironment({
        isWorkspaceClean: async () => false,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toContain('Disposable workspace is not clean');
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

  it('captures fake runner changes, patch artifact, and successful checks in a disposable workspace', async () => {
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
});
