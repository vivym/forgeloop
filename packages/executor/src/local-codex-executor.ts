import { exec, execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  ArtifactRef,
  ChangedFile,
  CheckResult,
  ExecutorFailure,
  ExecutorResult,
  RunSpec,
} from '../../contracts/src/executor.js';

import {
  createDefaultLocalCodexEnvironment,
  runLocalCodexPreflight,
  type LocalCodexEnvironment,
} from './local-codex-preflight.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const EXECUTOR_VERSION = '0.1.0';

export interface CodexRunnerInput {
  runSpec: RunSpec;
  workspacePath: string;
  baseRef: string;
}

export interface CodexRunnerResult {
  status: 'succeeded' | 'failed';
  summary: string;
  failure?: ExecutorFailure;
}

export interface CodexRunner {
  run(input: CodexRunnerInput): Promise<CodexRunnerResult>;
}

export interface LocalCodexExecutorOptions {
  artifactRoot: string;
  environment?: LocalCodexEnvironment;
  runner?: CodexRunner;
}

interface CommandExecutionResult {
  status: CheckResult['status'];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationSeconds: number;
}

const nowIso = () => new Date().toISOString();

const codexPromptFor = (runSpec: RunSpec) =>
  [
    `Objective:\n${runSpec.objective}`,
    `Spec revision summary:\n${runSpec.context.spec_revision_summary}`,
    `Plan revision summary:\n${runSpec.context.plan_revision_summary}`,
    `Package instructions:\n${runSpec.context.package_instructions}`,
    `Required checks:\n${JSON.stringify(runSpec.context.required_checks, null, 2)}`,
    `Allowed paths:\n${runSpec.allowed_paths.join('\n')}`,
    `Forbidden paths:\n${runSpec.forbidden_paths.join('\n')}`,
    `Requested change context:\n${JSON.stringify(runSpec.review_context.requested_changes, null, 2)}`,
    'Do not push, open a pull request, merge, release, or modify files outside the allowed paths.',
  ].join('\n\n');

const defaultRunner = (environment: LocalCodexEnvironment): CodexRunner => ({
  run: async ({ runSpec, workspacePath }) => {
    if (!(await environment.commandExists('codex'))) {
      return {
        status: 'failed',
        summary: 'Codex runtime became unavailable after preflight.',
        failure: {
          kind: 'executor_process_failed',
          message: 'Codex runtime became unavailable after preflight.',
          retryable: true,
        },
      };
    }

    try {
      await environment.runCodex({
        workspacePath,
        prompt: codexPromptFor(runSpec),
        timeoutSeconds: runSpec.timeout_seconds,
      });

      return {
        status: 'succeeded',
        summary: 'Codex runner completed.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex process failed.';

      return {
        status: 'failed',
        summary: `Codex process failed: ${message}`,
        failure: {
          kind: 'executor_error',
          message: `Codex process failed: ${message}`,
          retryable: true,
        },
      };
    }
  },
});

const executorFailureResult = (input: {
  runSpec: RunSpec;
  startedAt: string;
  summary: string;
  failure: ExecutorFailure;
  changedFiles?: ChangedFile[];
  checks?: CheckResult[];
  artifacts?: ArtifactRef[];
  rawMetadata?: Record<string, string | number | boolean | null>;
}): ExecutorResult => ({
  run_session_id: input.runSpec.run_session_id,
  executor_type: 'local_codex',
  executor_version: EXECUTOR_VERSION,
  status: 'failed',
  started_at: input.startedAt,
  finished_at: nowIso(),
  summary: input.summary,
  changed_files: input.changedFiles ?? [],
  checks: input.checks ?? [],
  artifacts: input.artifacts ?? [],
  failure: input.failure,
  raw_metadata: input.rawMetadata ?? {},
});

const statusOutput = async (workspacePath: string, args: string[]) => {
  const { stdout } = await execFileAsync('git', args, { cwd: workspacePath });

  return stdout;
};

const prepareDiffIndex = async (workspacePath: string) => {
  await execFileAsync('git', ['add', '-N', '.'], { cwd: workspacePath });
};

const changeKindFor = (status: string): ChangedFile['change_kind'] => {
  const code = status[0];

  if (code === 'A') return 'added';
  if (code === 'D') return 'deleted';
  if (code === 'R') return 'renamed';

  return 'modified';
};

const parseChangedFiles = (repoId: string, nameStatus: string): ChangedFile[] =>
  nameStatus
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, firstPath, secondPath] = line.split('\t');
      const changeKind = changeKindFor(status ?? '');

      if (changeKind === 'renamed') {
        return {
          repo_id: repoId,
          path: secondPath ?? firstPath ?? '',
          change_kind: changeKind,
          previous_path: firstPath,
        };
      }

      return {
        repo_id: repoId,
        path: firstPath ?? '',
        change_kind: changeKind,
      };
    });

const globPrefix = (pattern: string) => pattern.replace(/\*\*.*$/, '').replace(/\*.*$/, '');

const pathIsAllowed = (path: string, allowedPatterns: readonly string[]) =>
  allowedPatterns.some((pattern) => path.startsWith(globPrefix(pattern)));

const pathIsForbidden = (path: string, forbiddenPatterns: readonly string[]) =>
  forbiddenPatterns.some((pattern) => path.startsWith(globPrefix(pattern)));

const pathViolation = (runSpec: RunSpec, changedFiles: readonly ChangedFile[]): ExecutorFailure | undefined => {
  const violatingFile = changedFiles.find(
    (file) => !pathIsAllowed(file.path, runSpec.allowed_paths) || pathIsForbidden(file.path, runSpec.forbidden_paths),
  );

  if (violatingFile === undefined) {
    return undefined;
  }

  return {
    kind: 'path_violation',
    message: `Changed file is outside allowed paths or inside forbidden paths: ${violatingFile.path}`,
    retryable: false,
  };
};

const artifactPath = (artifactRoot: string, runSessionId: string, name: string) => join(artifactRoot, runSessionId, name);

const writeArtifact = async (
  artifactRoot: string,
  runSessionId: string,
  artifact: Omit<ArtifactRef, 'local_ref'>,
  content: string,
): Promise<ArtifactRef> => {
  const localRef = artifactPath(artifactRoot, runSessionId, artifact.name);

  await mkdir(join(artifactRoot, runSessionId), { recursive: true });
  await writeFile(localRef, content);

  return {
    ...artifact,
    local_ref: localRef,
  };
};

const runCheckCommand = async (command: string, cwd: string, timeoutSeconds: number): Promise<CommandExecutionResult> => {
  const started = performance.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 1024 * 1024 * 10,
    });

    return {
      status: 'succeeded',
      exitCode: 0,
      stdout,
      stderr,
      durationSeconds: (performance.now() - started) / 1000,
    };
  } catch (error) {
    const maybeError = error as {
      code?: number | string;
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    const timedOut = maybeError.killed === true || maybeError.signal === 'SIGTERM';

    return {
      status: timedOut ? 'timed_out' : 'failed',
      exitCode: timedOut ? null : typeof maybeError.code === 'number' ? maybeError.code : 1,
      stdout: maybeError.stdout ?? '',
      stderr: maybeError.stderr ?? '',
      durationSeconds: (performance.now() - started) / 1000,
    };
  }
};

const runChecks = async (
  runSpec: RunSpec,
  workspacePath: string,
  artifactRoot: string,
): Promise<{ checks: CheckResult[]; artifacts: ArtifactRef[] }> => {
  const checks: CheckResult[] = [];
  const artifacts: ArtifactRef[] = [];

  for (const check of runSpec.required_checks) {
    const result = await runCheckCommand(check.command, workspacePath, check.timeout_seconds);
    const stdoutArtifact = await writeArtifact(
      artifactRoot,
      runSpec.run_session_id,
      {
        kind: 'check_output',
        name: `${check.check_id}-stdout.txt`,
        content_type: 'text/plain',
      },
      result.stdout,
    );
    const stderrArtifact = await writeArtifact(
      artifactRoot,
      runSpec.run_session_id,
      {
        kind: 'check_output',
        name: `${check.check_id}-stderr.txt`,
        content_type: 'text/plain',
      },
      result.stderr,
    );

    artifacts.push(stdoutArtifact, stderrArtifact);
    checks.push({
      check_id: check.check_id,
      command: check.command,
      status: result.status,
      exit_code: result.exitCode,
      duration_seconds: result.durationSeconds,
      blocks_review: check.blocks_review,
      stdout: stdoutArtifact,
      stderr: stderrArtifact,
    });
  }

  return { checks, artifacts };
};

export const runLocalCodexExecutor = async (
  runSpec: RunSpec,
  options: LocalCodexExecutorOptions,
): Promise<ExecutorResult> => {
  const startedAt = nowIso();
  const environment = options.environment ?? createDefaultLocalCodexEnvironment();
  const preflight = await runLocalCodexPreflight(runSpec, {
    artifactRoot: options.artifactRoot,
    environment,
  });

  if (!preflight.ok) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: `Local Codex preflight failed: ${preflight.failure.message}`,
      failure: preflight.failure,
    });
  }

  const runner = options.runner ?? defaultRunner(environment);
  const runnerResult = await runner.run({
    runSpec,
    workspacePath: preflight.workspacePath,
    baseRef: preflight.resolvedBaseRef,
  });

  if (runnerResult.status !== 'succeeded') {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: runnerResult.summary,
      failure:
        runnerResult.failure ??
        ({
          kind: 'executor_process_failed',
          message: runnerResult.summary,
          retryable: true,
        } satisfies ExecutorFailure),
      rawMetadata: {
        workspace_path: preflight.workspacePath,
        base_ref: preflight.resolvedBaseRef,
      },
    });
  }

  await prepareDiffIndex(preflight.workspacePath);
  const nameStatus = await statusOutput(preflight.workspacePath, ['diff', '--name-status', 'HEAD']);
  const diff = await statusOutput(preflight.workspacePath, ['diff', 'HEAD']);
  const changedFiles = parseChangedFiles(runSpec.repo.repo_id, nameStatus);
  const diffArtifact = await writeArtifact(
    options.artifactRoot,
    runSpec.run_session_id,
    {
      kind: 'diff',
      name: 'patch.diff',
      content_type: 'text/x-diff',
    },
    diff,
  );
  const changedFilesArtifact = await writeArtifact(
    options.artifactRoot,
    runSpec.run_session_id,
    {
      kind: 'changed_files',
      name: 'changed-files.json',
      content_type: 'application/json',
    },
    JSON.stringify(changedFiles, null, 2),
  );
  const summaryArtifact = await writeArtifact(
    options.artifactRoot,
    runSpec.run_session_id,
    {
      kind: 'execution_summary',
      name: 'execution-summary.md',
      content_type: 'text/markdown',
    },
    runnerResult.summary,
  );
  const pathFailure = pathViolation(runSpec, changedFiles);
  const checkRun = await runChecks(runSpec, preflight.workspacePath, options.artifactRoot);
  const artifacts = [diffArtifact, changedFilesArtifact, summaryArtifact, ...checkRun.artifacts];

  if (pathFailure !== undefined) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: pathFailure.message,
      failure: pathFailure,
      changedFiles,
      checks: checkRun.checks,
      artifacts,
      rawMetadata: {
        workspace_path: preflight.workspacePath,
        base_ref: preflight.resolvedBaseRef,
      },
    });
  }

  const failedBlockingCheck = checkRun.checks.find((check) => check.blocks_review && check.status !== 'succeeded');

  if (failedBlockingCheck !== undefined) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: `Blocking check failed: ${failedBlockingCheck.check_id}`,
      failure: {
        kind: 'required_check_failed',
        message: `Blocking check failed: ${failedBlockingCheck.check_id}`,
        retryable: true,
      },
      changedFiles,
      checks: checkRun.checks,
      artifacts,
      rawMetadata: {
        workspace_path: preflight.workspacePath,
        base_ref: preflight.resolvedBaseRef,
      },
    });
  }

  return {
    run_session_id: runSpec.run_session_id,
    executor_type: 'local_codex',
    executor_version: EXECUTOR_VERSION,
    status: 'succeeded',
    started_at: startedAt,
    finished_at: nowIso(),
    summary: runnerResult.summary,
    changed_files: changedFiles,
    checks: checkRun.checks,
    artifacts,
    raw_metadata: {
      workspace_path: preflight.workspacePath,
      base_ref: preflight.resolvedBaseRef,
    },
  };
};
