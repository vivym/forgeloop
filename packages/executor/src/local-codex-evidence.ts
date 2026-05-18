import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { resourceLimitDigest } from '@forgeloop/domain';
import type {
  ArtifactRef,
  ChangedFile,
  CheckResult,
  ExecutorFailure,
  ExecutorResult,
  RunSpec,
} from '../../contracts/src/executor.js';
import {
  deriveAuthoritativeChangedFiles,
  runAuthoritativeGitForStdout,
} from './authoritative-changed-files.js';
import type { LocalCodexEnvironment } from './local-codex-preflight.js';
import type { LocalCodexRuntimeSafety } from './local-codex-preflight.js';
import { compileEffectivePathPolicy, type RawPathPolicy } from './path-policy.js';
import {
  runRequiredChecks,
  type FrozenStructuredCheckPolicy,
} from './required-check-runner.js';
import {
  verifySourceRepoUnchanged,
  type SourceRepoSnapshot,
} from './source-repo-guard.js';
import { legacyRequiredCheckToStructuredCommand, StructuredCommandError } from './structured-command.js';

const EXECUTOR_VERSION = '0.1.0';
const GIT_OUTPUT_MAX_BUFFER = 1024 * 1024 * 50;

interface CommandExecutionResult {
  status: CheckResult['status'];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationSeconds: number;
}

interface ChangedFileCapture {
  changedFiles: ChangedFile[];
  artifacts: ArtifactRef[];
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
  runtimeSafety?: LocalCodexRuntimeSafety;
}

export type CaptureLocalCodexEvidence = (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;

export interface FailedLocalCodexEvidenceInput extends LocalCodexEvidenceInput {
  failure: ExecutorFailure;
}

export type CaptureFailedLocalCodexEvidence = (input: FailedLocalCodexEvidenceInput) => Promise<ExecutorResult>;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const rawPathPolicyFrom = (value: unknown): RawPathPolicy => {
  if (!isRecord(value)) {
    return {};
  }
  const allowedPaths = Array.isArray(value.allowed_paths)
    ? value.allowed_paths.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  const forbiddenPaths = Array.isArray(value.forbidden_paths)
    ? value.forbidden_paths.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  return {
    ...(allowedPaths === undefined ? {} : { allowed_paths: allowedPaths }),
    ...(forbiddenPaths === undefined ? {} : { forbidden_paths: forbiddenPaths }),
    ...(value.allow_all_repo === true ? { allow_all_repo: true } : {}),
  };
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

const pathViolation = (
  runSpec: RunSpec,
  changedFiles: readonly ChangedFile[],
  runtimeSafety?: LocalCodexRuntimeSafety,
): ExecutorFailure | undefined => {
  if (runtimeSafety?.frozenSnapshot !== undefined) {
    try {
      const snapshot = runtimeSafety.frozenSnapshot;
      const policy = compileEffectivePathPolicy({
        packagePolicy: {
          allowed_paths: runSpec.allowed_paths,
          forbidden_paths: runSpec.forbidden_paths,
        },
        snapshotPolicy: rawPathPolicyFrom(snapshot.path_policy),
        packageValidationStrategy: snapshot.validation_strategy,
        snapshotValidationStrategy: snapshot.validation_strategy,
        sourceMutationPolicy: runSpec.source_mutation_policy,
      });
      for (const changedFile of changedFiles) {
        const result = policy.evaluateChangedFile({
          path: changedFile.path,
          ...(changedFile.previous_path === undefined ? {} : { previous_path: changedFile.previous_path }),
          ...(changedFile.change_kind === undefined ? {} : { change_kind: changedFile.change_kind }),
        });
        if (!result.allowed) {
          return {
            kind: 'path_violation',
            message: `Changed file is outside allowed paths or inside forbidden paths: ${result.path ?? changedFile.path}`,
            retryable: false,
          };
        }
      }
      return undefined;
    } catch (error) {
      return {
        kind: 'path_violation',
        message: `Changed file path policy could not be evaluated: ${error instanceof Error ? error.message : 'unknown path policy error'}`,
        retryable: false,
      };
    }
  }

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

const writeEvidenceArtifact = async (
  input: {
    artifactRoot: string;
    runSessionId: string;
    runtimeSafety?: LocalCodexRuntimeSafety;
  },
  artifact: Omit<ArtifactRef, 'local_ref'>,
  content: string,
): Promise<ArtifactRef> => {
  if (input.runtimeSafety !== undefined) {
    return input.runtimeSafety.artifactWriter.writeText({
      kind: artifact.kind,
      name: artifact.name,
      contentType: artifact.content_type,
      content,
      visibility: 'internal',
    });
  }

  return writeArtifact(input.artifactRoot, input.runSessionId, artifact, content);
};

const evidenceArtifactWriteInput = (
  artifactRoot: string,
  runSessionId: string,
  runtimeSafety: LocalCodexRuntimeSafety | undefined,
): {
  artifactRoot: string;
  runSessionId: string;
  runtimeSafety?: LocalCodexRuntimeSafety;
} => ({
  artifactRoot,
  runSessionId,
  ...(runtimeSafety === undefined ? {} : { runtimeSafety }),
});

const runCheckCommand = async (
  environment: LocalCodexEnvironment,
  command: string,
  cwd: string,
  timeoutSeconds: number,
  env: NodeJS.ProcessEnv,
): Promise<CommandExecutionResult> => {
  const started = performance.now();
  let commandSpec: ReturnType<typeof legacyRequiredCheckToStructuredCommand>;
  try {
    commandSpec = legacyRequiredCheckToStructuredCommand(command);
  } catch (error) {
    return {
      status: 'failed',
      exitCode: 1,
      stdout: '',
      stderr:
        error instanceof StructuredCommandError
          ? `Invalid required-check command: ${error.message}`
          : 'Invalid required-check command.',
      durationSeconds: (performance.now() - started) / 1000,
    };
  }

  try {
    const { stdout, stderr } = await environment.runCommand(commandSpec.executable, commandSpec.args ?? [], {
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
  environment: LocalCodexEnvironment,
  env: NodeJS.ProcessEnv,
  runtimeSafety?: LocalCodexRuntimeSafety,
): Promise<{ checks: CheckResult[]; artifacts: ArtifactRef[] }> => {
  if (runtimeSafety !== undefined) {
    const commandContext = {
      ...runtimeSafety.hookCommandContext,
      workspaceRoot: workspacePath,
    };
    const checkRun = await runRequiredChecks({
      frozenCheckPolicy: runtimeSafety.frozenSnapshot?.frozen_command_check_policy as unknown as FrozenStructuredCheckPolicy,
      runGovernor: runtimeSafety.runGovernor,
      artifactWriter: runtimeSafety.artifactWriter,
      commandContext,
      primaryExecutionCompleted: true,
      ...(runtimeSafety.mockRunContext === undefined ? {} : { mockRunContext: runtimeSafety.mockRunContext }),
    });

    if (!checkRun.ok && checkRun.checks.length === 0) {
      const blocker = checkRun.blockers[0];
      throw new Error(blocker?.summary ?? 'Required check execution failed.');
    }

    return {
      checks: checkRun.checks,
      artifacts: checkRun.artifactRefs,
    };
  }

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
      : await runCheckCommand(environment, check.command, workspacePath, check.timeout_seconds, env);
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
  runtimeSafety?: LocalCodexRuntimeSafety,
  captureLabel = 'changed-files',
): Promise<ChangedFileCapture> => {
  if (runtimeSafety !== undefined) {
    const commandContext = {
      ...runtimeSafety.hookCommandContext,
      workspaceRoot: workspacePath,
      safeGitProfile: 'forgeloop_default' as const,
    };
    const result = await deriveAuthoritativeChangedFiles({
      runSpec,
      workspaceRoot: workspacePath,
      baseCommit: runSpec.repo.base_commit_sha,
      runGovernor: runtimeSafety.runGovernor,
      commandContext,
      pathSafety: runtimeSafety.pathSafety,
      readCommandOutputRef: (ref) => readFile(ref, 'utf8'),
      outputImporter: runtimeSafety.artifactWriter,
      outputArtifactNamePrefix: captureLabel,
      ...(runtimeSafety.mockRunContext === undefined ? {} : { mockRunContext: runtimeSafety.mockRunContext }),
    });

    if (!result.ok) {
      throw new Error(result.summary);
    }

    return {
      changedFiles: result.changedFiles,
      artifacts: result.diagnosticRefs,
    };
  }

  await prepareDiffIndex(environment, workspacePath, env);
  const nameStatus = await statusOutput(environment, workspacePath, ['diff', '--name-status', 'HEAD'], env);

  return {
    changedFiles: parseChangedFiles(runSpec.repo.repo_id, nameStatus),
    artifacts: [],
  };
};

const collectPatchDiff = async (
  environment: LocalCodexEnvironment,
  runSpec: RunSpec,
  workspacePath: string,
  env: NodeJS.ProcessEnv,
  runtimeSafety?: LocalCodexRuntimeSafety,
  captureLabel = 'diff',
): Promise<string> => {
  if (runtimeSafety !== undefined) {
    const commandContext = {
      ...runtimeSafety.hookCommandContext,
      workspaceRoot: workspacePath,
      safeGitProfile: 'forgeloop_default' as const,
    };
    if (resourceLimitDigest(commandContext.resourceLimits) !== commandContext.resourceLimitDigest) {
      throw new Error('Resource limit digest does not match diff capture context.');
    }
    const result = await runAuthoritativeGitForStdout({
      workspaceRoot: workspacePath,
      commandId: 'authoritative-patch-diff',
      args: ['diff', '--binary', '--no-ext-diff', '--no-textconv', runSpec.repo.base_commit_sha, '--'],
      runGovernor: runtimeSafety.runGovernor,
      commandContext,
      readCommandOutputRef: (ref) => readFile(ref, 'utf8'),
      outputImporter: runtimeSafety.artifactWriter,
      outputArtifactNamePrefix: captureLabel,
      ...(runtimeSafety.mockRunContext === undefined ? {} : { mockRunContext: runtimeSafety.mockRunContext }),
    });
    return result.stdout;
  }

  return statusOutput(environment, workspacePath, ['diff', 'HEAD'], env);
};

const captureDiffArtifacts = async (
  environment: LocalCodexEnvironment,
  runSpec: RunSpec,
  workspacePath: string,
  artifactRoot: string,
  summary: string,
  env: NodeJS.ProcessEnv,
  runtimeSafety?: LocalCodexRuntimeSafety,
  captureLabel = 'final',
): Promise<{ changedFiles: ChangedFile[]; artifacts: ArtifactRef[] }> => {
  const changedFileCapture = await collectChangedFiles(environment, runSpec, workspacePath, env, runtimeSafety, `${captureLabel}-changed-files`);
  const diff = await collectPatchDiff(environment, runSpec, workspacePath, env, runtimeSafety, `${captureLabel}-diff`);
  const diffArtifact = await writeEvidenceArtifact(
    evidenceArtifactWriteInput(artifactRoot, runSpec.run_session_id, runtimeSafety),
    {
      kind: 'diff',
      name: 'patch.diff',
      content_type: 'text/x-diff',
    },
    diff,
  );
  const changedFilesArtifact = await writeEvidenceArtifact(
    evidenceArtifactWriteInput(artifactRoot, runSpec.run_session_id, runtimeSafety),
    {
      kind: 'changed_files',
      name: 'changed-files.json',
      content_type: 'application/json',
    },
    JSON.stringify(changedFileCapture.changedFiles, null, 2),
  );
  const summaryArtifact = await writeEvidenceArtifact(
    evidenceArtifactWriteInput(artifactRoot, runSpec.run_session_id, runtimeSafety),
    {
      kind: 'execution_summary',
      name: 'execution-summary.md',
      content_type: 'text/markdown',
    },
    summary,
  );

  return {
    changedFiles: changedFileCapture.changedFiles,
    artifacts: [...changedFileCapture.artifacts, diffArtifact, changedFilesArtifact, summaryArtifact],
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
      await writeEvidenceArtifact(
        evidenceArtifactWriteInput(input.artifactRoot, input.runSpec.run_session_id, input.runtimeSafety),
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

const blockingCheckFailure = (check: CheckResult): ExecutorFailure => ({
  kind: 'required_check_failed',
  message: `Blocking check failed: ${check.check_id}`,
  retryable: true,
});

const appendBlockingCheckFailureSummary = (summary: string, check: CheckResult | undefined): string =>
  check === undefined ? summary : `${summary}; Blocking check failed: ${check.check_id}`;

const sourceRepoVerificationFailure = (error: unknown): ExecutorFailure => ({
  kind: 'path_violation',
  message: `Source repo verification failed: ${error instanceof Error ? error.message : 'unknown source repo verification error'}`,
  retryable: false,
});

const requiredCheckExecutionFailure = (error: unknown): ExecutorFailure => ({
  kind: 'executor_error',
  message: `Required check execution failed: ${error instanceof Error ? error.message : 'unknown required check execution error'}`,
  retryable: true,
});

const sourceRepoVerificationFailureResult = (
  input: LocalCodexEvidenceInput,
  error: unknown,
  evidence: {
    changedFiles: ChangedFile[];
    checks: CheckResult[];
    artifacts: ArtifactRef[];
  },
): ExecutorResult => {
  const failure = sourceRepoVerificationFailure(error);

  return executorFailureResult({
    runSpec: input.runSpec,
    startedAt: input.startedAt,
    summary: failure.message,
    failure,
    changedFiles: evidence.changedFiles,
    checks: evidence.checks,
    artifacts: evidence.artifacts,
    rawMetadata: rawMetadataFor(input, null),
  });
};

const verifySourceRepoForEvidence = async (
  input: LocalCodexEvidenceInput,
  evidence: {
    changedFiles: ChangedFile[];
    checks: CheckResult[];
    artifacts: ArtifactRef[];
  },
): Promise<
  | {
      ok: true;
      guard: Awaited<ReturnType<typeof verifySourceRepoUnchanged>>;
    }
  | {
      ok: false;
      result: ExecutorResult;
    }
> => {
  try {
    return {
      ok: true,
      guard: await verifySourceRepoUnchanged(input.environment, input.sourceRepoSnapshot),
    };
  } catch (error) {
    return {
      ok: false,
      result: sourceRepoVerificationFailureResult(input, error, evidence),
    };
  }
};

export const captureFailedLocalCodexEvidence: CaptureFailedLocalCodexEvidence = async (input) => {
  let capture: { changedFiles: ChangedFile[]; artifacts: ArtifactRef[] };
  try {
    capture = await captureDiffArtifacts(
      input.environment,
      input.runSpec,
      input.workspacePath,
      input.artifactRoot,
      input.summary,
      input.checkEnv,
      input.runtimeSafety,
      'failed-runner',
    );
  } catch (error) {
    return diffCaptureFailure(input, error);
  }

  const pathFailure = pathViolation(input.runSpec, capture.changedFiles, input.runtimeSafety);
  const sourceRepoVerification = await verifySourceRepoForEvidence(input, {
    changedFiles: capture.changedFiles,
    checks: [],
    artifacts: capture.artifacts,
  });
  if (!sourceRepoVerification.ok) {
    return sourceRepoVerification.result;
  }
  const sourceRepoGuard = sourceRepoVerification.guard;
  const failure = !sourceRepoGuard.unchanged
    ? sourceRepoMutationFailure()
    : pathFailure ?? input.failure;

  return executorFailureResult({
    runSpec: input.runSpec,
    startedAt: input.startedAt,
    summary: failure.message,
    failure,
    changedFiles: capture.changedFiles,
    checks: [],
    artifacts: capture.artifacts,
    rawMetadata: rawMetadataFor(input, sourceRepoGuard.afterPorcelain),
  });
};

export const captureLocalCodexEvidence: CaptureLocalCodexEvidence = async (input) => {
  let initialCapture: ChangedFileCapture;
  try {
    initialCapture = await collectChangedFiles(
      input.environment,
      input.runSpec,
      input.workspacePath,
      input.checkEnv,
      input.runtimeSafety,
      'initial',
    );
  } catch (error) {
    return diffCaptureFailure(input, error);
  }

  const initialChangedFiles = initialCapture.changedFiles;
  const initialPathFailure = pathViolation(input.runSpec, initialChangedFiles, input.runtimeSafety);

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
        input.runtimeSafety,
        'initial-path-violation',
      );
    } catch (error) {
      return diffCaptureFailure(input, error);
    }
    const sourceRepoVerification = await verifySourceRepoForEvidence(input, {
      changedFiles: capture.changedFiles,
      checks: [],
      artifacts: [...initialCapture.artifacts, ...capture.artifacts],
    });
    if (!sourceRepoVerification.ok) {
      return sourceRepoVerification.result;
    }
    const sourceRepoGuard = sourceRepoVerification.guard;

    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: initialPathFailure.message,
      failure: sourceRepoGuard.unchanged
        ? initialPathFailure
        : sourceRepoMutationFailure(),
      changedFiles: capture.changedFiles,
      checks: [],
      artifacts: [...initialCapture.artifacts, ...capture.artifacts],
      rawMetadata: rawMetadataFor(input, sourceRepoGuard.afterPorcelain),
    });
  }

  let checkRun: { checks: CheckResult[]; artifacts: ArtifactRef[] };
  try {
    checkRun = await runChecks(
      input.runSpec,
      input.workspacePath,
      input.artifactRoot,
      input.environment,
      input.checkEnv,
      input.runtimeSafety,
    );
  } catch (error) {
    let changedFileCapture = initialCapture;
    try {
      changedFileCapture = await collectChangedFiles(
        input.environment,
        input.runSpec,
        input.workspacePath,
        input.checkEnv,
        input.runtimeSafety,
        'check-failure',
      );
    } catch {
      changedFileCapture = initialCapture;
    }

    const sourceRepoVerification = await verifySourceRepoForEvidence(input, {
      changedFiles: changedFileCapture.changedFiles,
      checks: [],
      artifacts: changedFileCapture.artifacts,
    });
    if (!sourceRepoVerification.ok) {
      return sourceRepoVerification.result;
    }
    const sourceRepoGuard = sourceRepoVerification.guard;
    const failure = sourceRepoGuard.unchanged ? requiredCheckExecutionFailure(error) : sourceRepoMutationFailure();

    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: failure.message,
      failure,
      changedFiles: changedFileCapture.changedFiles,
      checks: [],
      artifacts: changedFileCapture.artifacts,
      rawMetadata: rawMetadataFor(input, sourceRepoGuard.afterPorcelain),
    });
  }
  let finalCapture: { changedFiles: ChangedFile[]; artifacts: ArtifactRef[] };
  try {
    finalCapture = await captureDiffArtifacts(
      input.environment,
      input.runSpec,
      input.workspacePath,
      input.artifactRoot,
      input.summary,
      input.checkEnv,
      input.runtimeSafety,
      'final',
    );
  } catch (error) {
    return diffCaptureFailure(input, error);
  }
  const artifacts = [...initialCapture.artifacts, ...finalCapture.artifacts, ...checkRun.artifacts];
  const finalPathFailure = pathViolation(input.runSpec, finalCapture.changedFiles, input.runtimeSafety);
  const sourceRepoVerification = await verifySourceRepoForEvidence(input, {
    changedFiles: finalCapture.changedFiles,
    checks: checkRun.checks,
    artifacts,
  });
  if (!sourceRepoVerification.ok) {
    return sourceRepoVerification.result;
  }
  const sourceRepoGuard = sourceRepoVerification.guard;
  const rawMetadata = rawMetadataFor(input, sourceRepoGuard.afterPorcelain);
  const failedBlockingCheck = checkRun.checks.find((check) => check.blocks_review && check.status !== 'succeeded');

  if (finalPathFailure !== undefined) {
    const failure = sourceRepoGuard.unchanged ? finalPathFailure : sourceRepoMutationFailure();

    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: appendBlockingCheckFailureSummary(failure.message, failedBlockingCheck),
      failure,
      changedFiles: finalCapture.changedFiles,
      checks: checkRun.checks,
      artifacts,
      rawMetadata,
    });
  }

  if (!sourceRepoGuard.unchanged) {
    const failure = sourceRepoMutationFailure();

    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: appendBlockingCheckFailureSummary(failure.message, failedBlockingCheck),
      failure,
      changedFiles: finalCapture.changedFiles,
      checks: checkRun.checks,
      artifacts,
      rawMetadata,
    });
  }

  if (failedBlockingCheck !== undefined) {
    const failure = blockingCheckFailure(failedBlockingCheck);

    return executorFailureResult({
      runSpec: input.runSpec,
      startedAt: input.startedAt,
      summary: failure.message,
      failure,
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
