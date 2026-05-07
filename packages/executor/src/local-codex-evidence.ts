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
import type { LocalCodexEnvironment } from './local-codex-preflight.js';
import {
  verifySourceRepoUnchanged,
  type SourceRepoSnapshot,
} from './source-repo-guard.js';

const execAsync = promisify(exec);

const EXECUTOR_VERSION = '0.1.0';
const GIT_OUTPUT_MAX_BUFFER = 1024 * 1024 * 50;

interface CommandExecutionResult {
  status: CheckResult['status'];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationSeconds: number;
}

export interface LocalCodexEvidenceInput {
  runSpec: RunSpec;
  workspacePath: string;
  baseRef: string;
  artifactRoot: string;
  summary: string;
  startedAt: string;
  environment: LocalCodexEnvironment;
  checkEnv: NodeJS.ProcessEnv;
  sourceRepoSnapshot: SourceRepoSnapshot;
  effectiveDangerousMode: 'confirmed' | 'unconfirmed' | 'not_requested';
}

export type CaptureLocalCodexEvidence = (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;

const nowIso = () => new Date().toISOString();

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

const rawMetadataFor = (
  input: LocalCodexEvidenceInput,
  sourceRepoAfterStatus: string | null,
): Record<string, string | number | boolean | null> => ({
  workspace_path: input.workspacePath,
  base_ref: input.baseRef,
  source_repo_before_status: input.sourceRepoSnapshot.beforePorcelain,
  source_repo_after_status: sourceRepoAfterStatus,
  effective_dangerous_mode: input.effectiveDangerousMode,
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
  input: LocalCodexEvidenceInput,
  error: unknown,
): Promise<ExecutorResult> => {
  const message = error instanceof Error ? error.message : 'unknown diff capture failure';
  let artifacts: ArtifactRef[] = [];

  try {
    artifacts = [
      await writeArtifact(
        input.artifactRoot,
        input.runSpec.run_session_id,
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
    runSpec: input.runSpec,
    startedAt: input.startedAt,
    summary: `Git diff capture failed: ${message}`,
    failure: {
      kind: 'executor_error',
      message: `Git diff capture failed: ${message}`,
      retryable: true,
    },
    artifacts,
    rawMetadata: rawMetadataFor(input, null),
  });
};

const sourceRepoMutationFailure = (): ExecutorFailure => ({
  kind: 'path_violation',
  message: 'Source repo changed outside the run worktree.',
  retryable: false,
});

export const captureLocalCodexEvidence: CaptureLocalCodexEvidence = async (input) => {
  let initialChangedFiles: ChangedFile[];
  try {
    initialChangedFiles = await collectChangedFiles(input.environment, input.runSpec, input.workspacePath, input.checkEnv);
  } catch (error) {
    return diffCaptureFailure(input, error);
  }

  const initialPathFailure = pathViolation(input.runSpec, initialChangedFiles);

  if (initialPathFailure !== undefined) {
    let capture: { changedFiles: ChangedFile[]; artifacts: ArtifactRef[] };
    try {
      capture = await captureDiffArtifacts(
        input.environment,
        input.runSpec,
        input.workspacePath,
        input.artifactRoot,
        input.summary,
        input.checkEnv,
      );
    } catch (error) {
      return diffCaptureFailure(input, error);
    }
    const sourceRepoGuard = await verifySourceRepoUnchanged(input.environment, input.sourceRepoSnapshot);

    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: initialPathFailure.message,
      failure: sourceRepoGuard.unchanged
        ? initialPathFailure
        : sourceRepoMutationFailure(),
      changedFiles: capture.changedFiles,
      checks: [],
      artifacts: capture.artifacts,
      rawMetadata: rawMetadataFor(input, sourceRepoGuard.afterPorcelain),
    });
  }

  const checkRun = await runChecks(input.runSpec, input.workspacePath, input.artifactRoot, input.checkEnv);
  let finalCapture: { changedFiles: ChangedFile[]; artifacts: ArtifactRef[] };
  try {
    finalCapture = await captureDiffArtifacts(
      input.environment,
      input.runSpec,
      input.workspacePath,
      input.artifactRoot,
      input.summary,
      input.checkEnv,
    );
  } catch (error) {
    return diffCaptureFailure(input, error);
  }
  const artifacts = [...finalCapture.artifacts, ...checkRun.artifacts];
  const finalPathFailure = pathViolation(input.runSpec, finalCapture.changedFiles);
  const sourceRepoGuard = await verifySourceRepoUnchanged(input.environment, input.sourceRepoSnapshot);
  const rawMetadata = rawMetadataFor(input, sourceRepoGuard.afterPorcelain);

  if (finalPathFailure !== undefined) {
    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: finalPathFailure.message,
      failure: sourceRepoGuard.unchanged
        ? finalPathFailure
        : sourceRepoMutationFailure(),
      changedFiles: finalCapture.changedFiles,
      checks: checkRun.checks,
      artifacts,
      rawMetadata,
    });
  }

  if (!sourceRepoGuard.unchanged) {
    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: 'Source repo changed outside the run worktree.',
      failure: sourceRepoMutationFailure(),
      changedFiles: finalCapture.changedFiles,
      checks: checkRun.checks,
      artifacts,
      rawMetadata,
    });
  }

  const failedBlockingCheck = checkRun.checks.find((check) => check.blocks_review && check.status !== 'succeeded');

  if (failedBlockingCheck !== undefined) {
    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: `Blocking check failed: ${failedBlockingCheck.check_id}`,
      failure: {
        kind: 'required_check_failed',
        message: `Blocking check failed: ${failedBlockingCheck.check_id}`,
        retryable: true,
      },
      changedFiles: finalCapture.changedFiles,
      checks: checkRun.checks,
      artifacts,
      rawMetadata,
    });
  }

  return {
    run_session_id: input.runSpec.run_session_id,
    executor_type: 'local_codex',
    executor_version: EXECUTOR_VERSION,
    status: 'succeeded',
    started_at: input.startedAt,
    finished_at: nowIso(),
    summary: input.summary,
    changed_files: finalCapture.changedFiles,
    checks: checkRun.checks,
    artifacts,
    raw_metadata: rawMetadata,
  };
};
