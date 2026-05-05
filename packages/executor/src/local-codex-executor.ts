import { exec } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
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

const EXECUTOR_VERSION = '0.1.0';
const GIT_OUTPUT_MAX_BUFFER = 1024 * 1024 * 50;
const ALLOWED_ENV_KEYS = new Set(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SHELL', 'LANG', 'TERM']);

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
  codexHome?: string;
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

const baseHermeticEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => ALLOWED_ENV_KEYS.has(key) || key.startsWith('LC_')));

const createHermeticEnv = async (root: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> => {
  const home = join(root, 'home');
  const xdgConfig = join(root, 'xdg-config');
  const xdgCache = join(root, 'xdg-cache');
  const xdgData = join(root, 'xdg-data');
  const npmCache = join(root, 'npm-cache');
  const pnpmHome = join(root, 'pnpm-home');
  const npmUserConfig = join(root, 'npmrc');
  const gitConfig = join(root, 'gitconfig');

  await mkdir(home, { recursive: true });
  await mkdir(xdgConfig, { recursive: true });
  await mkdir(xdgCache, { recursive: true });
  await mkdir(xdgData, { recursive: true });
  await mkdir(npmCache, { recursive: true });
  await mkdir(pnpmHome, { recursive: true });
  await writeFile(gitConfig, '');
  await writeFile(npmUserConfig, '');

  return {
    ...baseHermeticEnv(),
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    XDG_DATA_HOME: xdgData,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_TERMINAL_PROMPT: '0',
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    npm_config_userconfig: npmUserConfig,
    NPM_CONFIG_CACHE: npmCache,
    npm_config_cache: npmCache,
    PNPM_HOME: pnpmHome,
    ...extraEnv,
  };
};

const createCheckEnv = (workspacePath: string): Promise<NodeJS.ProcessEnv> =>
  createHermeticEnv(join(workspacePath, '.git', '.forgeloop-hermetic-env'));

const configuredCodexHome = (options: LocalCodexExecutorOptions): string | undefined =>
  options.codexHome ?? process.env.FORGELOOP_CODEX_HOME ?? process.env.CODEX_HOME;

const createCodexEnv = (artifactRoot: string, runSpec: RunSpec, codexHome: string): Promise<NodeJS.ProcessEnv> =>
  createHermeticEnv(join(artifactRoot, safePathSegment(runSpec.run_session_id), 'codex-env'), {
    CODEX_HOME: codexHome,
  });

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
};

const assertInside = (root: string, candidate: string): string => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);

  if (relativePath.startsWith('..') || relativePath === '..' || resolve(relativePath) === relativePath) {
    throw new Error(`Resolved path escapes root: ${candidate}`);
  }

  return resolvedCandidate;
};

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

const defaultRunner = (environment: LocalCodexEnvironment, env: NodeJS.ProcessEnv): CodexRunner => ({
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
        env,
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

const statusOutput = async (
  environment: LocalCodexEnvironment,
  workspacePath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => {
  const { stdout } = await environment.runCommand('git', args, {
    cwd: workspacePath,
    env,
    maxBuffer: GIT_OUTPUT_MAX_BUFFER,
  });

  return stdout;
};

const prepareDiffIndex = async (environment: LocalCodexEnvironment, workspacePath: string, env: NodeJS.ProcessEnv) => {
  await environment.runCommand('git', ['add', '-N', '.'], { cwd: workspacePath, env });
};

const neutralizeGitRemotes = async (environment: LocalCodexEnvironment, workspacePath: string, env: NodeJS.ProcessEnv) => {
  const { stdout } = await environment.runCommand('git', ['remote'], {
    cwd: workspacePath,
    env,
    maxBuffer: GIT_OUTPUT_MAX_BUFFER,
  });

  await Promise.all(
    stdout
      .split('\n')
      .map((remote) => remote.trim())
      .filter(Boolean)
      .map((remote) => environment.runCommand('git', ['remote', 'remove', remote], { cwd: workspacePath, env })),
  );
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
    (file) =>
      !pathIsAllowed(file.path, runSpec.allowed_paths) ||
      pathIsForbidden(file.path, runSpec.forbidden_paths) ||
      (file.previous_path !== undefined &&
        (!pathIsAllowed(file.previous_path, runSpec.allowed_paths) ||
          pathIsForbidden(file.previous_path, runSpec.forbidden_paths))),
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

const artifactPath = (artifactRoot: string, runSessionId: string, name: string) =>
  assertInside(artifactRoot, join(artifactRoot, safePathSegment(runSessionId), safePathSegment(name)));

const writeArtifact = async (
  artifactRoot: string,
  runSessionId: string,
  artifact: Omit<ArtifactRef, 'local_ref'>,
  content: string,
): Promise<ArtifactRef> => {
  const localRef = artifactPath(artifactRoot, runSessionId, artifact.name);

  await mkdir(assertInside(artifactRoot, join(artifactRoot, safePathSegment(runSessionId))), { recursive: true });
  await writeFile(localRef, content);

  return {
    ...artifact,
    local_ref: localRef,
  };
};

const runCheckCommand = async (
  command: string,
  cwd: string,
  timeoutSeconds: number,
  env: NodeJS.ProcessEnv,
): Promise<CommandExecutionResult> => {
  const started = performance.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 1024 * 1024 * 10,
      env,
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

const forbiddenCheckPatterns = [
  /\bgit\s+push\b/i,
  /\bgh\s+pr\b/i,
  /\bgh\s+release\b/i,
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\byarn\s+npm\s+publish\b/i,
];

const isForbiddenCheckCommand = (command: string) => forbiddenCheckPatterns.some((pattern) => pattern.test(command));

const runChecks = async (
  runSpec: RunSpec,
  workspacePath: string,
  artifactRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<{ checks: CheckResult[]; artifacts: ArtifactRef[] }> => {
  const checks: CheckResult[] = [];
  const artifacts: ArtifactRef[] = [];

  for (const check of runSpec.required_checks) {
    const result = isForbiddenCheckCommand(check.command)
      ? {
          status: 'failed' as const,
          exitCode: 1,
          stdout: '',
          stderr: `Blocked forbidden required-check command: ${check.command}`,
          durationSeconds: 0,
        }
      : await runCheckCommand(check.command, workspacePath, check.timeout_seconds, env);
    const stdoutArtifact = await writeArtifact(
      artifactRoot,
      runSpec.run_session_id,
      {
        kind: 'check_output',
        name: `${safePathSegment(check.check_id)}-stdout.txt`,
        content_type: 'text/plain',
      },
      result.stdout,
    );
    const stderrArtifact = await writeArtifact(
      artifactRoot,
      runSpec.run_session_id,
      {
        kind: 'check_output',
        name: `${safePathSegment(check.check_id)}-stderr.txt`,
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

const collectChangedFiles = async (
  environment: LocalCodexEnvironment,
  runSpec: RunSpec,
  workspacePath: string,
  env: NodeJS.ProcessEnv,
): Promise<ChangedFile[]> => {
  await prepareDiffIndex(environment, workspacePath, env);
  const nameStatus = await statusOutput(environment, workspacePath, ['diff', '--name-status', 'HEAD'], env);

  return parseChangedFiles(runSpec.repo.repo_id, nameStatus);
};

const captureDiffArtifacts = async (
  environment: LocalCodexEnvironment,
  runSpec: RunSpec,
  workspacePath: string,
  artifactRoot: string,
  summary: string,
  env: NodeJS.ProcessEnv,
): Promise<{ changedFiles: ChangedFile[]; artifacts: ArtifactRef[] }> => {
  const changedFiles = await collectChangedFiles(environment, runSpec, workspacePath, env);
  const diff = await statusOutput(environment, workspacePath, ['diff', 'HEAD'], env);
  const diffArtifact = await writeArtifact(
    artifactRoot,
    runSpec.run_session_id,
    {
      kind: 'diff',
      name: 'patch.diff',
      content_type: 'text/x-diff',
    },
    diff,
  );
  const changedFilesArtifact = await writeArtifact(
    artifactRoot,
    runSpec.run_session_id,
    {
      kind: 'changed_files',
      name: 'changed-files.json',
      content_type: 'application/json',
    },
    JSON.stringify(changedFiles, null, 2),
  );
  const summaryArtifact = await writeArtifact(
    artifactRoot,
    runSpec.run_session_id,
    {
      kind: 'execution_summary',
      name: 'execution-summary.md',
      content_type: 'text/markdown',
    },
    summary,
  );

  return {
    changedFiles,
    artifacts: [diffArtifact, changedFilesArtifact, summaryArtifact],
  };
};

const diffCaptureFailure = async (
  runSpec: RunSpec,
  startedAt: string,
  artifactRoot: string,
  error: unknown,
): Promise<ExecutorResult> => {
  const message = error instanceof Error ? error.message : 'unknown diff capture failure';
  let artifacts: ArtifactRef[] = [];

  try {
    artifacts = [
      await writeArtifact(
        artifactRoot,
        runSpec.run_session_id,
        {
          kind: 'logs',
          name: 'diff-capture-error.txt',
          content_type: 'text/plain',
        },
        `diff capture failed: ${message}`,
      ),
    ];
  } catch {
    artifacts = [];
  }

  return executorFailureResult({
    runSpec,
    startedAt,
    summary: `Git diff capture failed: ${message}`,
    failure: {
      kind: 'executor_error',
      message: `Git diff capture failed: ${message}`,
      retryable: true,
    },
    artifacts,
  });
};

export const runLocalCodexExecutor = async (
  runSpec: RunSpec,
  options: LocalCodexExecutorOptions,
): Promise<ExecutorResult> => {
  const startedAt = nowIso();
  const environment = options.environment ?? createDefaultLocalCodexEnvironment();
  const usesDefaultRunner = options.runner === undefined;
  const codexHome = configuredCodexHome(options);
  const codexEnv = usesDefaultRunner && codexHome !== undefined
    ? await createCodexEnv(options.artifactRoot, runSpec, codexHome)
    : undefined;

  if (usesDefaultRunner && codexHome === undefined) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: 'Local Codex preflight failed: Codex home is not configured for hermetic execution.',
      failure: {
        kind: 'preflight_failed',
        message: 'Codex home is not configured for hermetic execution. Set codexHome, FORGELOOP_CODEX_HOME, or CODEX_HOME.',
        retryable: false,
      },
    });
  }

  const preflightOptions = {
    artifactRoot: options.artifactRoot,
    environment,
    ...(codexEnv === undefined ? {} : { codexEnv }),
  };
  const preflight = await runLocalCodexPreflight(runSpec, preflightOptions);

  if (!preflight.ok) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: `Local Codex preflight failed: ${preflight.failure.message}`,
      failure: preflight.failure,
    });
  }

  const checkEnv = await createCheckEnv(preflight.workspacePath);
  await neutralizeGitRemotes(environment, preflight.workspacePath, checkEnv);

  const runner = options.runner ?? defaultRunner(environment, codexEnv ?? checkEnv);
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

  let initialChangedFiles: ChangedFile[];
  try {
    initialChangedFiles = await collectChangedFiles(environment, runSpec, preflight.workspacePath, checkEnv);
  } catch (error) {
    return diffCaptureFailure(runSpec, startedAt, options.artifactRoot, error);
  }

  const initialPathFailure = pathViolation(runSpec, initialChangedFiles);

  if (initialPathFailure !== undefined) {
    let capture: { changedFiles: ChangedFile[]; artifacts: ArtifactRef[] };
    try {
      capture = await captureDiffArtifacts(
        environment,
        runSpec,
        preflight.workspacePath,
        options.artifactRoot,
        runnerResult.summary,
        checkEnv,
      );
    } catch (error) {
      return diffCaptureFailure(runSpec, startedAt, options.artifactRoot, error);
    }

    return executorFailureResult({
      runSpec,
      startedAt,
      summary: initialPathFailure.message,
      failure: initialPathFailure,
      changedFiles: capture.changedFiles,
      checks: [],
      artifacts: capture.artifacts,
      rawMetadata: {
        workspace_path: preflight.workspacePath,
        base_ref: preflight.resolvedBaseRef,
      },
    });
  }

  const checkRun = await runChecks(runSpec, preflight.workspacePath, options.artifactRoot, checkEnv);
  let finalCapture: { changedFiles: ChangedFile[]; artifacts: ArtifactRef[] };
  try {
    finalCapture = await captureDiffArtifacts(
      environment,
      runSpec,
      preflight.workspacePath,
      options.artifactRoot,
      runnerResult.summary,
      checkEnv,
    );
  } catch (error) {
    return diffCaptureFailure(runSpec, startedAt, options.artifactRoot, error);
  }
  const artifacts = [...finalCapture.artifacts, ...checkRun.artifacts];
  const finalPathFailure = pathViolation(runSpec, finalCapture.changedFiles);

  if (finalPathFailure !== undefined) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: finalPathFailure.message,
      failure: finalPathFailure,
      changedFiles: finalCapture.changedFiles,
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
      changedFiles: finalCapture.changedFiles,
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
    changed_files: finalCapture.changedFiles,
    checks: checkRun.checks,
    artifacts,
    raw_metadata: {
      workspace_path: preflight.workspacePath,
      base_ref: preflight.resolvedBaseRef,
    },
  };
};
