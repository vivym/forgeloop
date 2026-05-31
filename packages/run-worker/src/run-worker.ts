import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { ArtifactRef, ChangedFile, CheckResult, ExecutorFailure, ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import {
  LocalInternalArtifactStore,
  type CreatePendingWorkspaceBundleArtifactInput,
  type DeliveryRepository,
  type PendingWorkspaceBundleInput,
  type PendingWorkspaceBundleReplayInput,
} from '../../db/src/index.js';
import {
  codexCanonicalDigest,
  codexWorkspaceAcquisitionDigest,
  validateCodexRuntimeJobTerminalResult,
  type CodexRunExecutionRuntimeJobResult,
  type CodexRuntimeStatusProjection,
} from '../../domain/src/index.js';
import type { ExecutionPackage, RunRuntimeMetadata, RunSession, RunWorkerLease } from '../../domain/src/index.js';
import {
  createWorkspaceBundleArchive,
  createWorkspaceBundleManifest,
  workspaceBundleArchiveDigest,
  workspaceBundleManifestDigest,
  type WorkspaceBundleFileInput,
} from '@forgeloop/codex-worker-runtime';
import type {
  CodexDriverStreamItem,
  CodexSessionDriver,
  LocalCodexEvidenceInput,
  LocalCodexEnvironment,
  SourceRepoSnapshot,
} from '../../executor/src/index.js';
import { createDefaultLocalCodexEnvironment, createLocalCodexCheckEnv, snapshotSourceRepoStatus } from '../../executor/src/index.js';
import {
  buildAndStartPackageRun,
  completePackageRunReviewFinalization,
  finalizePackageRunWithExecutorResult,
  terminalizePackageRunWithRuntimeEvidence,
  type RuntimeFinalizationEvidence,
  type RuntimeSafetyBlocker,
  type TerminalizedRunResult,
} from '../../workflow/src/index.js';

import { applyPendingRunCommands } from './command-inbox.js';
import { acquireLeaseForRun, heartbeatLease, releaseLease } from './lease.js';
import { evaluateRunProgress } from './watchdog.js';

type IsoDateTime = string;

export interface RunWorkerDriverFactoryInput {
  runSession: RunSession;
  runtimeMetadata: RunRuntimeMetadata;
  workerLease: {
    workerId: string;
    runSessionId: string;
    leaseId?: string;
    leaseToken: string;
  };
}

export interface RunWorkerInput {
  repository: DeliveryRepository;
  workerId: string;
  driverFactory: (input: RunWorkerDriverFactoryInput) => CodexSessionDriver;
  execFallbackDriverFactory?: (input: RunWorkerDriverFactoryInput) => CodexSessionDriver;
  evidenceCollector: (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;
  selfReview: (input: SelfReviewInput) => Promise<SelfReviewResult>;
  remoteRunExecutionClient?: RemoteRunExecutionClient;
  internalArtifactStore?: LocalInternalArtifactStore;
  now?: () => IsoDateTime;
  heartbeatIntervalMs?: number;
  commandPollIntervalMs?: number;
  leaseDurationMs?: number;
  idleThresholdMs?: number;
  artifactRoot?: string;
  internalArtifactStoreRoot?: string;
  allowExecFallback?: boolean;
  remoteRunExecutionWaitTimeoutMs?: number;
  remoteRunExecutionPollIntervalMs?: number;
}

export interface RemoteRunExecutionClient {
  getStatus(input: { projectId: string; repoId?: string; targetKind: 'run_execution' }): Promise<CodexRuntimeStatusProjection>;
  createRuntimeJob(input: Record<string, unknown>): Promise<unknown>;
  getRuntimeJob(runtimeJobId: string): Promise<unknown>;
  cancelRuntimeJob?(runtimeJobId: string, input: { reason_code: string; idempotency_key: string }): Promise<unknown>;
}

interface RemoteRunExecutionTerminal {
  runtimeJobId: string;
  terminalStatus: 'succeeded' | 'failed' | 'cancelled' | 'expired';
  reasonCode?: string;
  terminalResult?: CodexRunExecutionRuntimeJobResult;
}

interface RemoteRunExecutionWorkloadInput {
  runtimeJobId: string;
  launchLeaseId: string;
  envelopeId: string;
  jobRequestId: string;
  bundleId: string;
  packagePrompt: string;
  executionContext: Record<string, unknown>;
}

interface RemoteRunExecutionFence {
  runSessionStatus: RunSession['status'];
  runSessionUpdatedAt: string;
  executionPackageVersion: number;
  workspaceBundleDigest: string;
  workspaceBundleManifestDigest: string;
  mountedTaskWorkspaceDigest: string;
  pathPolicyDigest: string;
}

interface OwnedRun {
  runSessionId: string;
  workerId: string;
  leaseId?: string;
  leaseToken: string;
}

interface RunControl {
  stopped: boolean;
  stalled: boolean;
  failure?: unknown;
  stoppedPromise: Promise<void>;
  stop: () => void;
  fail: (error: unknown) => void;
  stall: () => void;
  cancelStream?: () => Promise<void> | void;
}

interface OpenedDriverStream {
  driver: CodexSessionDriver;
  runtimeMetadata: RunRuntimeMetadata;
  stream: AsyncIterable<CodexDriverStreamItem>;
  isRecoveryFallback?: boolean;
}

interface PrimedDriverStream {
  driver: CodexSessionDriver;
  runtimeMetadata: RunRuntimeMetadata;
  iterator: AsyncIterator<CodexDriverStreamItem>;
  currentRunSession: RunSession;
  isRecoveryFallback?: boolean;
  firstTerminal?: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
  stalled?: boolean;
}

type TerminalStreamItem = Extract<CodexDriverStreamItem, { kind: 'terminal' }>;

type ConsumeStreamResult =
  | { kind: 'terminal'; terminal: TerminalStreamItem }
  | { kind: 'switched'; stream: PrimedDriverStream }
  | { kind: 'ended'; currentRunSession: RunSession };

const terminalStatuses = new Set<RunSession['status']>(['succeeded', 'failed', 'timed_out', 'cancelled']);
const nowIso = () => new Date().toISOString();
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isFallbackRequiredEvent = (item: CodexDriverStreamItem): boolean =>
  item.kind === 'event' &&
  item.event.event_type === 'driver_fallback_used' &&
  item.runtimeMetadata?.driver_kind === 'exec_fallback';

const fallbackReason = (reason: unknown): string => {
  if (typeof reason === 'string') {
    return reason;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  if (reason !== null && typeof reason === 'object' && 'summary' in reason && typeof reason.summary === 'string') {
    return reason.summary;
  }
  return String(reason);
};

const fallbackReasonFromEvent = (item: Extract<CodexDriverStreamItem, { kind: 'event' }>): string =>
  typeof item.event.payload?.reason === 'string' ? item.event.payload.reason : item.event.summary;

const runtimeSafetyFailureSummaries = {
  runtime_policy_invalid: 'Runtime policy is invalid.',
  runtime_hard_limits_unavailable: 'Runtime hard limits are unavailable.',
  sandbox_isolation_unavailable: 'Sandbox isolation is unavailable.',
  runtime_attestation_invalid: 'Runtime safety attestation is invalid.',
  primary_executor_governor_unavailable: 'Primary executor governor is unavailable.',
  fallback_denied_by_policy: 'Executor fallback is denied by policy.',
  artifact_visibility_denied: 'Artifact visibility policy denied public projection.',
} as const;

type RuntimeSafetyFailureCode = keyof typeof runtimeSafetyFailureSummaries;

const runtimeSafetyFailureCodePatterns: Array<[RuntimeSafetyFailureCode, RegExp]> = Object.keys(runtimeSafetyFailureSummaries).map(
  (code) => [code as RuntimeSafetyFailureCode, new RegExp(`(?:^|[^A-Za-z0-9_])${code}(?:$|[^A-Za-z0-9_])`)],
);

const baseRuntimeMetadata = (runSession: RunSession, workerId: string): RunRuntimeMetadata => ({
  durability_mode: runSession.runtime_metadata?.durability_mode ?? 'durable',
  recovery_attempt_count: runSession.runtime_metadata?.recovery_attempt_count ?? 0,
  effective_dangerous_mode: runSession.runtime_metadata?.effective_dangerous_mode ?? 'not_requested',
  ...runSession.runtime_metadata,
  worker_id: workerId,
});

const mergeMetadata = (
  runSession: RunSession,
  workerId: string,
  update: Partial<RunRuntimeMetadata> = {},
): RunRuntimeMetadata => ({
  ...baseRuntimeMetadata(runSession, workerId),
  ...update,
  worker_id: workerId,
});

const terminalExecutorResult = (input: {
  runSession: RunSession;
  status: 'failed' | 'cancelled';
  summary: string;
  failure?: ExecutorFailure;
  at: string;
}): ExecutorResult => ({
  run_session_id: input.runSession.id,
  executor_type: input.runSession.run_spec?.executor_type ?? input.runSession.executor_type ?? 'mock',
  executor_version: 'run-worker',
  status: input.status,
  started_at: input.runSession.started_at ?? input.at,
  finished_at: input.at,
  summary: input.summary,
  changed_files: [],
  checks: [],
  artifacts: [],
  failure:
    input.status === 'failed' && input.failure !== undefined
      ? input.failure
      : {
          kind: input.status === 'cancelled' ? 'cancelled' : 'executor_error',
          message: input.summary,
          retryable: input.status !== 'cancelled',
        },
  raw_metadata: {},
});

const runtimeSafetyBlockersFromExecutorResult = (executorResult: ExecutorResult): RuntimeSafetyBlocker[] => {
  if (executorResult.status === 'succeeded' || executorResult.failure === undefined) {
    return [];
  }

  const evidenceText = [executorResult.failure?.message, executorResult.summary]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n');
  if (evidenceText.length === 0) {
    return [];
  }

  const retryable = executorResult.failure?.retryable;
  return runtimeSafetyFailureCodePatterns.flatMap(([code, pattern]) =>
    pattern.test(evidenceText)
      ? [
          {
            code,
            summary: runtimeSafetyFailureSummaries[code],
            retryable: retryable ?? code !== 'fallback_denied_by_policy',
          },
        ]
      : [],
  );
};

const runtimeEvidenceFromExecutorResult = (executorResult: ExecutorResult): RuntimeFinalizationEvidence => ({
  executorResult,
  authoritativeChangedFiles: executorResult.changed_files,
  requiredCheckResults: executorResult.checks,
  primaryArtifactRefs: executorResult.artifacts,
  runtimeBlockers: runtimeSafetyBlockersFromExecutorResult(executorResult),
  pathPolicy:
    executorResult.failure?.kind === 'path_violation'
      ? {
          ok: false,
          blockerCode: 'path_policy_actual_changes_rejected',
          publicSummary: executorResult.failure.message,
        }
      : { ok: true },
});

const isInsidePath = (root: string, child: string): boolean => {
  const childRelative = relative(root, child);
  return childRelative === '' || (!childRelative.startsWith('..') && !childRelative.startsWith('/'));
};

const defaultInternalArtifactStoreRoot = (): string => {
  const root = process.env.FORGELOOP_ARTIFACT_STORE_ROOT?.trim();
  if (root === undefined || root.length === 0) {
    throw new Error('FORGELOOP_ARTIFACT_STORE_ROOT is required for pending workspace bundles');
  }
  return root;
};

const createRunWorkerInternalArtifactStore = (
  repository: DeliveryRepository,
  root = defaultInternalArtifactStoreRoot(),
): LocalInternalArtifactStore =>
  new LocalInternalArtifactStore({
    root,
    repository,
    requestId: 'run-worker-workspace-bundle',
  });

const stableUuidFromDigest = (input: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = (8 + (Number.parseInt(hex[16]!, 16) % 4)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const remoteRunExecutionPromptPath = '.forgeloop/codex-runtime/package-prompt.txt';
const remoteRunExecutionContextPath = '.forgeloop/codex-runtime/execution-context.json';

const isReservedRemoteRuntimePath = (current: string): boolean => {
  const normalized = current.replaceAll('\\', '/');
  return normalized === '.forgeloop/codex-runtime' || normalized.startsWith('.forgeloop/codex-runtime/');
};

const collectWorkspaceFiles = async (workspacePath: string, current = '', rootRealPath?: string): Promise<WorkspaceBundleFileInput[]> => {
  if (isReservedRemoteRuntimePath(current) || current.split(/[\\/]/).some((segment) => segment === '.git' || segment === 'node_modules')) {
    return [];
  }
  const root = rootRealPath ?? (await realpath(workspacePath));
  const absolute = current.length === 0 ? workspacePath : join(workspacePath, current);
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) {
    throw new Error('codex_workspace_bundle_invalid: workspace symlinks are not allowed');
  }
  const real = await realpath(absolute);
  if (!isInsidePath(root, real)) {
    throw new Error('codex_workspace_bundle_invalid: workspace entry escapes root');
  }
  if (info.isDirectory()) {
    const children = await readdir(absolute);
    const nested = await Promise.all(
      children.sort().map((child) => collectWorkspaceFiles(workspacePath, current.length === 0 ? child : join(current, child), root)),
    );
    return nested.flat();
  }
  if (!info.isFile()) {
    return [];
  }
  const path = relative(workspacePath, absolute).replaceAll('\\', '/');
  return [{ path, content: await readFile(absolute) }];
};

export const createRunWorkerPendingWorkspaceBundleArtifact = async (input: {
  repository: DeliveryRepository;
  runSession: RunSession;
  executionPackage: ExecutionPackage;
  runWorkerLease: RunWorkerLease;
  workspacePath: string;
  bundleId: string;
  now: string;
  expiresAt: string;
  maxSizeBytes?: number;
  extraFiles?: readonly WorkspaceBundleFileInput[];
  internalArtifactStore?: LocalInternalArtifactStore;
}): Promise<{
  pending_workspace_bundle: PendingWorkspaceBundleReplayInput;
  archive_digest: string;
  manifest_digest: string;
  size_bytes: number;
  pending_artifact_record: CreatePendingWorkspaceBundleArtifactInput;
}> => {
  if (
    input.runWorkerLease.status !== 'active' ||
    input.runWorkerLease.expires_at <= input.now ||
    input.runWorkerLease.run_session_id !== input.runSession.id
  ) {
    throw new Error('run_worker_lease_unavailable');
  }
  await input.repository.assertActiveRunWorkerLease(
    input.runSession.id,
    input.runWorkerLease.worker_id,
    input.runWorkerLease.lease_token,
    input.now,
  );
  const files = [...(await collectWorkspaceFiles(input.workspacePath)), ...(input.extraFiles ?? [])];
  const manifest = createWorkspaceBundleManifest({
    bundleId: input.bundleId,
    createdAt: input.now,
    allowedPaths: ['**'],
    forbiddenPaths: ['.git/**', 'node_modules/**'],
    files,
  });
  const archiveBytes = createWorkspaceBundleArchive({ manifest, files });
  if (input.maxSizeBytes !== undefined && archiveBytes.byteLength > input.maxSizeBytes) {
    throw new Error('codex_workspace_bundle_invalid: archive exceeds byte limit');
  }
  const archiveDigest = workspaceBundleArchiveDigest(archiveBytes);
  const manifestDigest = workspaceBundleManifestDigest(manifest);
  const pendingArtifactRef = `artifact://internal/workspace_bundle/run_session/${input.runSession.id}/${input.bundleId}`;
  const workspaceAcquisitionJson = {
    schema_version: 'workspace_bundle_acquisition.v1',
    bundle_id: input.bundleId,
    archive_ref: pendingArtifactRef,
    archive_digest: archiveDigest,
    manifest_digest: manifestDigest,
    size_bytes: archiveBytes.byteLength,
    expires_at: input.expiresAt,
  };
  const workspaceAcquisitionDigest = codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!;
  const stored = await (input.internalArtifactStore ?? createRunWorkerInternalArtifactStore(input.repository)).putObject({
    artifact_id: input.bundleId,
    kind: 'workspace_bundle',
    owner_type: 'run_session',
    owner_id: input.runSession.id,
    visibility: 'internal',
    content_type: 'application/vnd.forgeloop.workspace-bundle',
    declared_size_bytes: String(archiveBytes.byteLength),
    declared_artifact_digest: archiveDigest,
    idempotency_key: input.bundleId,
    metadata_json: {
      manifest_digest: manifestDigest,
      execution_package_id: input.executionPackage.id,
      run_worker_lease_id: input.runWorkerLease.id,
      workspace_acquisition_digest: workspaceAcquisitionDigest,
    },
    created_by_actor_type: 'codex_worker',
    created_by_actor_id: input.runWorkerLease.worker_id,
    now: input.now,
    max_size_bytes: input.maxSizeBytes ?? 100 * 1024 * 1024,
    bytes: archiveBytes,
  });
  const pendingWorkspaceBundle: PendingWorkspaceBundleInput = {
    bundle_id: input.bundleId,
    pending_artifact_ref: pendingArtifactRef,
    internal_artifact_object_id: stored.id,
    archive_digest: archiveDigest,
    manifest_digest: manifestDigest,
    run_worker_lease_id: input.runWorkerLease.id,
    size_bytes: archiveBytes.byteLength,
    workspace_acquisition_digest: workspaceAcquisitionDigest,
    workspace_acquisition_json: workspaceAcquisitionJson,
    expires_at: input.expiresAt,
  };
  const pendingArtifactRecord: CreatePendingWorkspaceBundleArtifactInput = {
    ...pendingWorkspaceBundle,
    id: stableUuidFromDigest({ kind: 'pending_workspace_bundle', bundle_id: input.bundleId }),
    run_session_id: input.runSession.id,
    execution_package_id: input.executionPackage.id,
    internal_artifact_object_id: stored.id,
    request_digest: codexCanonicalDigest({
      run_session_id: input.runSession.id,
      execution_package_id: input.executionPackage.id,
      bundle_id: input.bundleId,
      archive_digest: archiveDigest,
      manifest_digest: manifestDigest,
      internal_artifact_object_id: stored.id,
    }),
    created_at: input.now,
  };
  await input.repository.createPendingWorkspaceBundleArtifact(pendingArtifactRecord);
  return {
    pending_workspace_bundle: pendingArtifactRecord,
    archive_digest: archiveDigest,
    manifest_digest: manifestDigest,
    size_bytes: archiveBytes.byteLength,
    pending_artifact_record: pendingArtifactRecord,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requiredRemoteStatusString = (status: CodexRuntimeStatusProjection, key: keyof CodexRuntimeStatusProjection): string => {
  const value = status[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`codex_runtime_job_unavailable:${String(key)}`);
  }
  return value;
};

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

const globMatches = (pattern: string, candidate: string): boolean => {
  const normalizedPattern = pattern.replaceAll('\\', '/');
  if (normalizedPattern === '**') {
    return true;
  }
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }
  let regex = '^';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      index += 1;
    } else if (char === '*') {
      regex += '[^/]*';
    } else {
      regex += escapeRegex(char ?? '');
    }
  }
  regex += '$';
  return new RegExp(regex).test(candidate);
};

const normalizeRemoteChangedPath = (path: string): string => {
  if (path.length === 0 || path.includes('\\') || path.startsWith('/') || path.includes('\0')) {
    throw new Error('path_policy_actual_changes_rejected');
  }
  const parts = path.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error('path_policy_actual_changes_rejected');
  }
  return path;
};

const assertRemoteChangedFilesAllowed = (runSession: RunSession, result: CodexRunExecutionRuntimeJobResult): void => {
  const runSpec = runSession.run_spec;
  if (runSpec === undefined) {
    throw new Error('codex_runtime_job_stale');
  }
  for (const changedFile of result.changed_files) {
    const normalized = normalizeRemoteChangedPath(changedFile);
    const allowed = runSpec.allowed_paths.length === 0 || runSpec.allowed_paths.some((pattern) => globMatches(pattern, normalized));
    const forbidden = runSpec.forbidden_paths.some((pattern) => globMatches(pattern, normalized));
    if (!allowed || forbidden) {
      throw new Error('path_policy_actual_changes_rejected');
    }
  }
};

const remoteChangedFiles = (runSession: RunSession, result: CodexRunExecutionRuntimeJobResult): ChangedFile[] => {
  const repoId = runSession.run_spec?.repo.repo_id ?? '';
  return result.changed_files.map((path) => ({
    repo_id: repoId,
    path: normalizeRemoteChangedPath(path),
    change_kind: 'modified' as const,
  }));
};

const remoteCheckResults = (result: CodexRunExecutionRuntimeJobResult): CheckResult[] =>
  result.check_results.map((check) => ({
    check_id: check.name,
    command: check.name,
    status: check.status === 'passed' ? 'succeeded' : check.status,
    exit_code: check.status === 'passed' ? 0 : check.status === 'failed' ? 1 : null,
    duration_seconds: 0,
    blocks_review: check.status !== 'skipped',
    ...(check.output_internal_ref === undefined
      ? {}
      : {
          stdout: {
            kind: 'check_output' as const,
            name: `${check.name}.out`,
            content_type: 'text/plain',
            storage_uri: check.output_internal_ref,
            ...(check.output_digest === undefined ? {} : { digest: check.output_digest }),
          },
        }),
  }));

const remoteArtifactRefs = (result: CodexRunExecutionRuntimeJobResult): ArtifactRef[] => {
  const artifacts: ArtifactRef[] = [];
  if (result.patch_artifact !== undefined) {
    artifacts.push({
      kind: 'diff',
      name: 'run-execution.patch',
      content_type: result.patch_artifact.content_type,
      storage_uri: result.patch_artifact.internal_ref,
      digest: result.patch_artifact.digest,
    });
  }
  for (const artifact of result.execution_artifacts) {
    if (
      artifact.internal_ref !== undefined &&
      ['diff', 'changed_files', 'check_output', 'logs', 'execution_summary', 'raw_metadata'].includes(artifact.kind)
    ) {
      artifacts.push({
        kind: artifact.kind as ArtifactRef['kind'],
        name: artifact.name,
        content_type: artifact.content_type,
        storage_uri: artifact.internal_ref,
        ...(artifact.digest === undefined ? {} : { digest: artifact.digest }),
      });
    }
  }
  return artifacts;
};

const executorResultFromRemoteRunExecution = (input: {
  runSession: RunSession;
  terminal: RemoteRunExecutionTerminal;
  at: string;
}): ExecutorResult => {
  const startedAt = input.runSession.started_at ?? input.at;
  const result = input.terminal.terminalResult;
  if (input.terminal.terminalStatus !== 'succeeded' || result === undefined) {
    const status = input.terminal.terminalStatus === 'cancelled' ? 'cancelled' : 'failed';
    const executorResult = terminalExecutorResult({
      runSession: input.runSession,
      status,
      summary: input.terminal.reasonCode ?? 'Remote Codex run execution failed.',
      at: input.at,
    });
    return {
      ...executorResult,
      raw_metadata: {
        remote_runtime_job_id: input.terminal.runtimeJobId,
        ...(input.terminal.reasonCode === undefined ? {} : { remote_runtime_reason_code: input.terminal.reasonCode }),
      },
    };
  }
  return {
    run_session_id: input.runSession.id,
    executor_type: 'local_codex',
    executor_version: 'codex-remote-worker',
    status: 'succeeded',
    started_at: startedAt,
    finished_at: input.at,
    summary: result.public_summary,
    changed_files: remoteChangedFiles(input.runSession, result),
    checks: remoteCheckResults(result),
    artifacts: remoteArtifactRefs(result),
    raw_metadata: {
      remote_runtime_job_id: input.terminal.runtimeJobId,
      workspace_bundle_digest: result.workspace_bundle_digest,
      workspace_bundle_manifest_digest: result.workspace_bundle_manifest_digest,
      mounted_task_workspace_digest: result.mounted_task_workspace_digest,
    },
  };
};

const pendingWorkspaceBundleFromRuntimeMetadata = (
  runtimeMetadata: RunRuntimeMetadata,
  runSessionId: string,
  executionPackageId: string,
  runWorkerLeaseId: string,
): PendingWorkspaceBundleReplayInput | undefined => {
  if (
    typeof runtimeMetadata.remote_workspace_bundle_id !== 'string' ||
    typeof runtimeMetadata.remote_run_worker_lease_id !== 'string' ||
    runtimeMetadata.remote_run_worker_lease_id !== runWorkerLeaseId ||
    typeof runtimeMetadata.remote_workspace_bundle_artifact_record_id !== 'string' ||
    typeof runtimeMetadata.remote_workspace_bundle_artifact_request_digest !== 'string' ||
    typeof runtimeMetadata.remote_workspace_bundle_created_at !== 'string' ||
    typeof runtimeMetadata.remote_workspace_bundle_digest !== 'string' ||
    typeof runtimeMetadata.remote_workspace_manifest_digest !== 'string' ||
    typeof runtimeMetadata.remote_workspace_bundle_size_bytes !== 'number' ||
    typeof runtimeMetadata.remote_workspace_bundle_expires_at !== 'string' ||
    typeof runtimeMetadata.remote_workspace_acquisition_digest !== 'string' ||
    !isRecord(runtimeMetadata.remote_workspace_acquisition_json) ||
    typeof runtimeMetadata.remote_workspace_acquisition_json.archive_ref !== 'string' ||
    runtimeMetadata.remote_workspace_acquisition_json.archive_ref !==
      `artifact://internal/workspace_bundle/run_session/${runSessionId}/${runtimeMetadata.remote_workspace_bundle_id}`
  ) {
    return undefined;
  }
  return {
    id: runtimeMetadata.remote_workspace_bundle_artifact_record_id,
    bundle_id: runtimeMetadata.remote_workspace_bundle_id,
    run_session_id: runSessionId,
    execution_package_id: executionPackageId,
    pending_artifact_ref: runtimeMetadata.remote_workspace_acquisition_json.archive_ref,
    ...(typeof runtimeMetadata.remote_workspace_internal_artifact_object_id === 'string'
      ? { internal_artifact_object_id: runtimeMetadata.remote_workspace_internal_artifact_object_id }
      : {}),
    archive_digest: runtimeMetadata.remote_workspace_bundle_digest,
    manifest_digest: runtimeMetadata.remote_workspace_manifest_digest,
    run_worker_lease_id: runWorkerLeaseId,
    size_bytes: runtimeMetadata.remote_workspace_bundle_size_bytes,
    workspace_acquisition_digest: runtimeMetadata.remote_workspace_acquisition_digest,
    workspace_acquisition_json: runtimeMetadata.remote_workspace_acquisition_json,
    expires_at: runtimeMetadata.remote_workspace_bundle_expires_at,
    request_digest: runtimeMetadata.remote_workspace_bundle_artifact_request_digest,
    created_at: runtimeMetadata.remote_workspace_bundle_created_at,
  };
};

const fakeEnvironment = (): LocalCodexEnvironment => ({
  commandExists: async () => false,
  isCodexRuntimeReady: async () => false,
  isGitRepo: async () => false,
  resolveGitRef: async () => false,
  prepareWorkspace: async () => ({ ok: false, message: 'not prepared by run-worker test environment' }),
  isWorkspaceClean: async () => true,
  isWritableDirectory: async () => true,
  runCodex: async () => undefined,
  runCommand: async () => ({ stdout: '', stderr: '' }),
});

const sourceSnapshot = (runSession: RunSession): SourceRepoSnapshot => ({
  repoPath: runSession.run_spec?.repo.local_path ?? '',
  beforePorcelain: '',
  beforeDirtyFingerprint: '',
});

const closeDriverQuietly = async (driver: CodexSessionDriver): Promise<void> => {
  try {
    await driver.close?.();
  } catch {
    // Driver cleanup must not overwrite the authoritative run outcome.
  }
};

const isRealLocalCodexDriverRun = (runSession: RunSession, driver: CodexSessionDriver): boolean =>
  runSession.run_spec?.executor_type === 'local_codex' &&
  runSession.run_spec.workflow_only !== true &&
  (driver.kind === 'app_server' || driver.kind === 'exec_fallback');

const isRealLocalCodexRuntime = (runSession: RunSession): boolean =>
  runSession.run_spec?.executor_type === 'local_codex' &&
  runSession.run_spec.workflow_only !== true &&
  (runSession.runtime_metadata?.driver_kind === 'app_server' || runSession.runtime_metadata?.driver_kind === 'exec_fallback');

const runtimeMetadataSourceSnapshot = (runtimeMetadata: RunRuntimeMetadata | undefined): SourceRepoSnapshot | undefined => {
  if (
    typeof runtimeMetadata?.source_repo_path !== 'string' ||
    typeof runtimeMetadata.source_repo_before_status !== 'string' ||
    typeof runtimeMetadata.source_repo_before_dirty_fingerprint !== 'string'
  ) {
    return undefined;
  }

  return {
    repoPath: runtimeMetadata.source_repo_path,
    beforePorcelain: runtimeMetadata.source_repo_before_status,
    beforeDirtyFingerprint: runtimeMetadata.source_repo_before_dirty_fingerprint,
  };
};

export class RunWorker {
  private readonly repository: DeliveryRepository;
  private readonly workerId: string;
  private readonly driverFactory: RunWorkerInput['driverFactory'];
  private readonly execFallbackDriverFactory: NonNullable<RunWorkerInput['execFallbackDriverFactory']>;
  private readonly evidenceCollector: RunWorkerInput['evidenceCollector'];
  private readonly selfReview: RunWorkerInput['selfReview'];
  private readonly remoteRunExecutionClient: RunWorkerInput['remoteRunExecutionClient'];
  private readonly internalArtifactStore: LocalInternalArtifactStore | undefined;
  private readonly internalArtifactStoreRoot: string | undefined;
  private readonly now: () => string;
  private readonly heartbeatIntervalMs: number;
  private readonly commandPollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly idleThresholdMs: number;
  private readonly artifactRoot: string;
  private readonly allowExecFallback: boolean;
  private readonly remoteRunExecutionWaitTimeoutMs: number;
  private readonly remoteRunExecutionPollIntervalMs: number;
  private drainPromise: Promise<void> | undefined;
  private drainAgainRequested = false;

  constructor(input: RunWorkerInput) {
    this.repository = input.repository;
    this.workerId = input.workerId;
    this.driverFactory = input.driverFactory;
    this.execFallbackDriverFactory = input.execFallbackDriverFactory ?? input.driverFactory;
    this.evidenceCollector = input.evidenceCollector;
    this.selfReview = input.selfReview;
    this.remoteRunExecutionClient = input.remoteRunExecutionClient;
    this.internalArtifactStore = input.internalArtifactStore;
    this.internalArtifactStoreRoot = input.internalArtifactStoreRoot;
    this.now = input.now ?? nowIso;
    this.heartbeatIntervalMs = input.heartbeatIntervalMs ?? 5_000;
    this.commandPollIntervalMs = input.commandPollIntervalMs ?? 750;
    this.leaseDurationMs = input.leaseDurationMs ?? 60_000;
    this.idleThresholdMs = input.idleThresholdMs ?? 120_000;
    this.artifactRoot = input.artifactRoot ?? '.forgeloop/artifacts';
    this.allowExecFallback = input.allowExecFallback ?? true;
    this.remoteRunExecutionWaitTimeoutMs = input.remoteRunExecutionWaitTimeoutMs ?? this.leaseDurationMs;
    this.remoteRunExecutionPollIntervalMs = input.remoteRunExecutionPollIntervalMs ?? this.commandPollIntervalMs;
  }

  kick(): void {
    if (this.drainPromise !== undefined) {
      this.drainAgainRequested = true;
      return;
    }

    this.startBackgroundDrain();
  }

  private startBackgroundDrain(): void {
    this.drainAgainRequested = false;
    this.drainPromise = this.drainOnce().catch(() => undefined).finally(() => {
      this.drainPromise = undefined;
      if (this.drainAgainRequested) {
        this.startBackgroundDrain();
      }
    });
  }

  async drainOnce(): Promise<void> {
    const sessions = await this.repository.listRecoverableRunSessions();
    for (const session of sessions) {
      if (terminalStatuses.has(session.status)) {
        continue;
      }

      const at = this.now();
      let leaseId: string;
      let leaseToken: string;
      try {
        const acquired = await acquireLeaseForRun(this.repository, session.id, this.workerId, at, this.leaseDurationMs);
        leaseId = acquired.lease.id;
        leaseToken = acquired.leaseToken;
        await this.repository.appendWorkerRunEvent(
          {
            id: `run-event:${session.id}:worker-lease-acquired:${this.workerId}:${at}`,
            run_session_id: session.id,
            event_type: 'worker_lease_acquired',
            source: 'worker',
            visibility: 'internal',
            summary: 'Worker lease acquired.',
            payload: { worker_id: this.workerId },
            created_at: at,
          },
          { workerId: this.workerId, leaseToken },
        );
      } catch {
        continue;
      }

      await this.runOne({ runSessionId: session.id, workerId: this.workerId, leaseId, leaseToken });
    }
  }

  async runOne(input: OwnedRun): Promise<void> {
    let terminalOrStopped = false;
    const control = this.createRunControl();
    const heartbeat = this.startHeartbeat(input, control);
    const openedDrivers = new Set<CodexSessionDriver>();

    try {
      const loaded = await this.repository.getRunSession(input.runSessionId);
      if (loaded === undefined || terminalStatuses.has(loaded.status)) {
        terminalOrStopped = true;
        return;
      }

      if (await this.stallIfIdle(loaded, input)) {
        terminalOrStopped = true;
        return;
      }

      const wasQueued = loaded.status === 'queued';
      const started = wasQueued ? await this.startQueuedRun(loaded, input) : loaded;
      if (this.shouldDelegateRemoteRunExecution(started)) {
        terminalOrStopped = true;
        await this.runRemoteExecution(started, input, wasQueued ? 'start' : 'resume', control);
        return;
      }
      let activeRunSession = started;
      let runtimeMetadata = mergeMetadata(started, input.workerId, {
        driver_kind: started.runtime_metadata?.driver_kind ?? 'fake',
      });
      const resumeWithExecFallback =
        !wasQueued &&
        (runtimeMetadata.driver_kind === 'exec_fallback' || runtimeMetadata.selected_execution_mode === 'exec_fallback');
      const driver = resumeWithExecFallback
        ? this.execFallbackDriverFactory({ runSession: started, runtimeMetadata, workerLease: input })
        : this.driverFactory({ runSession: started, runtimeMetadata, workerLease: input });
      openedDrivers.add(driver);
      if (isRealLocalCodexDriverRun(started, driver)) {
        activeRunSession = await this.prepareLocalCodexRuntime(
          activeRunSession,
          input,
          runtimeMetadata,
          wasQueued ? 'start' : 'resume',
        );
        runtimeMetadata = activeRunSession.runtime_metadata!;
      }
      if (driver.kind === 'app_server') {
        const workspacePath = runtimeMetadata.workspace_path ?? started.run_spec?.repo.local_path;
        activeRunSession = await this.updateRuntimeMetadata(activeRunSession, input, {
          driver_kind: 'app_server',
          driver_status: 'starting',
          ...(workspacePath === undefined ? {} : { workspace_path: workspacePath }),
          app_server_attempted: true,
          selected_execution_mode: 'app_server',
        } as Partial<RunRuntimeMetadata>);
        runtimeMetadata = activeRunSession.runtime_metadata!;
      }
      const opened = await this.openDriverStream(driver, activeRunSession, runtimeMetadata, input, wasQueued ? 'start' : 'resume');
      const primed = await this.primeDriverStream(opened, activeRunSession, input, wasQueued ? 'start' : 'resume', control);
      openedDrivers.add(primed.driver);

      if (primed.stalled === true) {
        terminalOrStopped = true;
        return;
      }
      if (control.stopped) {
        const latest = (await this.repository.getRunSession(started.id)) ?? primed.currentRunSession;
        await this.stallStoppedRun(latest, input, control);
        terminalOrStopped = true;
        return;
      }

      control.cancelStream = async () => {
        await primed.iterator.return?.();
      };

      let terminal = primed.firstTerminal;
      let currentStream: PrimedDriverStream | undefined = terminal === undefined ? primed : undefined;
      let currentRunSession = primed.currentRunSession;
      let activeDriver = primed.driver;
      let activeRuntimeMetadata = currentRunSession.runtime_metadata ?? primed.runtimeMetadata;
      const commandInput = () => ({
        repository: this.repository,
        runSessionId: started.id,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        driver: activeDriver,
        runtimeMetadata: currentStream?.currentRunSession.runtime_metadata ?? currentRunSession.runtime_metadata ?? activeRuntimeMetadata,
        now: this.now,
      });
      const reclaimClaimedBefore = loaded.status === 'queued' ? undefined : this.now();
      const commandPolling =
        primed.firstTerminal === undefined
          ? this.startCommandPolling(() => ({
              ...commandInput(),
              ...(reclaimClaimedBefore === undefined ? {} : { reclaimClaimedBefore }),
            }), control)
          : { done: Promise.resolve() };

      let streamStalled = false;
      while (terminal === undefined && currentStream !== undefined && !control.stopped) {
        activeDriver = currentStream.driver;
        currentRunSession = currentStream.currentRunSession;
        activeRuntimeMetadata = currentRunSession.runtime_metadata ?? currentStream.runtimeMetadata;
        control.cancelStream = async () => {
          await currentStream?.iterator.return?.();
        };

        const consumed = await this.consumeStream(currentStream, input, wasQueued ? 'start' : 'resume', control);
        if (consumed.kind === 'terminal') {
          terminal = consumed.terminal;
          break;
        }
        if (consumed.kind === 'switched') {
          openedDrivers.add(consumed.stream.driver);
          if (consumed.stream.stalled === true) {
            streamStalled = true;
            currentStream = undefined;
            currentRunSession = consumed.stream.currentRunSession;
            break;
          }
          currentStream = consumed.stream.firstTerminal === undefined ? consumed.stream : undefined;
          terminal = consumed.stream.firstTerminal;
          activeDriver = consumed.stream.driver;
          activeRuntimeMetadata = consumed.stream.runtimeMetadata;
          currentRunSession = consumed.stream.currentRunSession;
          continue;
        }
        currentRunSession = consumed.currentRunSession;
        activeRuntimeMetadata = currentRunSession.runtime_metadata ?? activeRuntimeMetadata;
        currentStream = undefined;
      }
      const stoppedBeforeStreamEndHandling = control.stopped;
      control.stop();
      await commandPolling.done;

      if (streamStalled || control.stalled) {
        terminalOrStopped = true;
        return;
      }
      if (terminal !== undefined) {
        terminalOrStopped = true;
        await this.finalizeTerminal(started, terminal, input);
        return;
      }
      const latest = (await this.repository.getRunSession(started.id)) ?? currentRunSession;
      if (stoppedBeforeStreamEndHandling) {
        await this.stallStoppedRun(latest, input, control);
        terminalOrStopped = true;
        return;
      }
      if (!stoppedBeforeStreamEndHandling) {
        if (!terminalStatuses.has(latest.status)) {
          await this.stallRun(latest, input, 'Driver stream ended before terminal completion.');
        }
        terminalOrStopped = true;
      }
    } catch (error) {
      const runSession = await this.repository.getRunSession(input.runSessionId);
      if (runSession !== undefined && !terminalStatuses.has(runSession.status)) {
        await this.stallRun(runSession, input, 'Driver recovery failed.', error);
      }
      terminalOrStopped = true;
    } finally {
      control.stop();
      await heartbeat.done;
      await Promise.all([...openedDrivers].map((driver) => closeDriverQuietly(driver)));
      if (terminalOrStopped) {
        try {
          await releaseLease(this.repository, input.runSessionId, input.workerId, input.leaseToken, this.now());
        } catch {
          // Another worker may already have taken over an expired lease.
        }
      }
    }
  }

  private shouldDelegateRemoteRunExecution(runSession: RunSession): boolean {
    return (
      this.remoteRunExecutionClient !== undefined &&
      runSession.run_spec?.executor_type === 'local_codex' &&
      runSession.run_spec.workflow_only !== true
    );
  }

  private async runRemoteExecution(
    runSession: RunSession,
    lease: OwnedRun,
    mode: 'start' | 'resume',
    control: RunControl,
  ): Promise<void> {
    if (this.remoteRunExecutionClient === undefined) {
      throw new Error('codex_runtime_job_unavailable');
    }
    let activeRunSession = runSession;
    let runtimeMetadata = mergeMetadata(runSession, lease.workerId, {
      driver_kind: 'app_server',
      driver_status: 'starting',
      app_server_attempted: true,
      selected_execution_mode: 'app_server',
    });
    const executionPackage = await this.repository.getExecutionPackage(activeRunSession.execution_package_id);
    if (executionPackage === undefined) {
      throw new Error('codex_runtime_job_unavailable');
    }
    const remoteWorkload = this.buildRemoteRunExecutionWorkloadInput(activeRunSession, executionPackage);
    const canReusePreparedRemoteRun =
      mode === 'resume' &&
      runSession.runtime_metadata?.workspace_path !== undefined &&
      runtimeMetadataSourceSnapshot(runSession.runtime_metadata) !== undefined &&
      runSession.runtime_metadata.launch_lease_id === remoteWorkload.launchLeaseId;
    if (canReusePreparedRemoteRun) {
      runtimeMetadata = runSession.runtime_metadata!;
    } else {
      activeRunSession = await this.prepareLocalCodexRuntime(activeRunSession, lease, runtimeMetadata, mode);
      runtimeMetadata = activeRunSession.runtime_metadata!;
      if (runtimeMetadata.workspace_path === undefined) {
        throw new Error('codex_runtime_job_unavailable');
      }
      activeRunSession = await this.updateRuntimeMetadata(activeRunSession, lease, {
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: runtimeMetadata.workspace_path,
        launch_lease_id: remoteWorkload.launchLeaseId,
      });
      runtimeMetadata = activeRunSession.runtime_metadata!;
    }
    const runSpec = activeRunSession.run_spec;
    if (runSpec === undefined || runtimeMetadata.workspace_path === undefined) {
      throw new Error('codex_runtime_job_unavailable');
    }
    const workspacePath = runtimeMetadata.workspace_path;
    const expiresAt = new Date(Date.parse(this.now()) + this.remoteRunExecutionWaitTimeoutMs).toISOString();
    const runWorkerLeaseId =
      lease.leaseId ?? stableUuidFromDigest({ kind: 'run_worker_lease', run_session_id: activeRunSession.id, worker_id: lease.workerId });
    const persistedRemoteFenceMatches =
      runtimeMetadata.remote_runtime_job_id === remoteWorkload.runtimeJobId &&
      runtimeMetadata.launch_lease_id === remoteWorkload.launchLeaseId;
    const existingRuntimeJobId =
      persistedRemoteFenceMatches && runtimeMetadata.remote_runtime_job_created === true ? runtimeMetadata.remote_runtime_job_id : undefined;
    let pendingBundle = persistedRemoteFenceMatches
      ? pendingWorkspaceBundleFromRuntimeMetadata(runtimeMetadata, activeRunSession.id, executionPackage.id, runWorkerLeaseId)
      : undefined;
    let workspaceBundleDigest = pendingBundle?.archive_digest;
    const resumeExistingRuntimeJob = existingRuntimeJobId !== undefined && pendingBundle !== undefined && workspaceBundleDigest !== undefined;
    if (pendingBundle === undefined || workspaceBundleDigest === undefined) {
      const bundle = await createRunWorkerPendingWorkspaceBundleArtifact({
        repository: this.repository,
        internalArtifactStore: this.internalArtifactStore ?? createRunWorkerInternalArtifactStore(this.repository, this.internalArtifactStoreRoot),
        runSession: activeRunSession,
        executionPackage,
        runWorkerLease: {
          id: runWorkerLeaseId,
          run_session_id: activeRunSession.id,
          worker_id: lease.workerId,
          lease_token: lease.leaseToken,
          status: 'active',
          heartbeat_at: this.now(),
          expires_at: expiresAt,
        },
        workspacePath,
        bundleId: remoteWorkload.bundleId,
        now: this.now(),
        expiresAt,
        extraFiles: [
          { path: remoteRunExecutionPromptPath, content: remoteWorkload.packagePrompt },
          { path: remoteRunExecutionContextPath, content: JSON.stringify(remoteWorkload.executionContext) },
        ],
      });
      activeRunSession = await this.updateRuntimeMetadata(activeRunSession, lease, {
        remote_runtime_job_id: remoteWorkload.runtimeJobId,
        remote_run_worker_lease_id: bundle.pending_workspace_bundle.run_worker_lease_id,
        remote_workspace_bundle_id: bundle.pending_workspace_bundle.bundle_id,
        remote_workspace_bundle_digest: bundle.archive_digest,
        remote_workspace_manifest_digest: bundle.manifest_digest,
        remote_workspace_bundle_size_bytes: bundle.size_bytes,
        remote_workspace_bundle_expires_at: bundle.pending_workspace_bundle.expires_at,
        remote_workspace_bundle_artifact_record_id: bundle.pending_artifact_record.id,
        remote_workspace_bundle_artifact_request_digest: bundle.pending_artifact_record.request_digest,
        remote_workspace_bundle_created_at: bundle.pending_artifact_record.created_at,
        ...(bundle.pending_workspace_bundle.internal_artifact_object_id === undefined
          ? {}
          : { remote_workspace_internal_artifact_object_id: bundle.pending_workspace_bundle.internal_artifact_object_id }),
        remote_workspace_acquisition_digest: bundle.pending_workspace_bundle.workspace_acquisition_digest,
        remote_workspace_acquisition_json: bundle.pending_workspace_bundle.workspace_acquisition_json,
      });
      runtimeMetadata = activeRunSession.runtime_metadata!;
      pendingBundle = bundle.pending_artifact_record;
      workspaceBundleDigest = bundle.archive_digest;
    }
    let runtimeJobId = existingRuntimeJobId;
    if (!resumeExistingRuntimeJob) {
      runtimeJobId = await this.createRemoteRunExecutionJob({
        runSession: activeRunSession,
        executionPackage,
        lease,
        bundle: pendingBundle,
        expiresAt: pendingBundle.expires_at,
        remoteWorkload,
      });
      activeRunSession = await this.updateRuntimeMetadata(activeRunSession, lease, { remote_runtime_job_created: true });
    }
    if (runtimeJobId === undefined) {
      throw new Error('codex_runtime_job_unavailable');
    }
    const cancelRemoteRunExecutionJob = async () => {
      await this.cancelRemoteRunExecutionJob(runtimeJobId);
    };
    const remoteCommandDriver: CodexSessionDriver = {
      kind: 'app_server',
      startRun: async function* () {
        return;
      },
      resumeRun: async function* () {
        return;
      },
      sendInput: async () => {
        throw new Error('remote_runtime_input_unavailable');
      },
      cancelRun: async () => {
        await cancelRemoteRunExecutionJob();
        control.stop();
        return { remote_runtime_job_cancel_requested: true };
      },
      close: async () => undefined,
    };
    control.cancelStream = async () => {
      await cancelRemoteRunExecutionJob();
    };
    const commandPolling = this.startCommandPolling(() => ({
      repository: this.repository,
      runSessionId: activeRunSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver: remoteCommandDriver,
      runtimeMetadata: activeRunSession.runtime_metadata ?? runtimeMetadata,
      now: this.now,
      ...(mode === 'resume' ? { reclaimClaimedBefore: this.now() } : {}),
    }), control);
    let terminal: RemoteRunExecutionTerminal;
    try {
      terminal = await this.waitForRemoteRunExecutionTerminal(runtimeJobId, control, pendingBundle.expires_at);
    } finally {
      control.stop();
      await commandPolling.done;
    }
    await this.finalizeRemoteRunExecutionTerminal(activeRunSession, terminal, lease, {
      runSessionStatus: activeRunSession.status,
      runSessionUpdatedAt: activeRunSession.updated_at,
      executionPackageVersion: executionPackage.version,
      workspaceBundleDigest,
      workspaceBundleManifestDigest: pendingBundle.manifest_digest,
      mountedTaskWorkspaceDigest: pendingBundle.manifest_digest,
      pathPolicyDigest: codexCanonicalDigest({
        allowed_paths: activeRunSession.run_spec?.allowed_paths ?? [],
        forbidden_paths: activeRunSession.run_spec?.forbidden_paths ?? [],
      }),
    });
  }

  private buildRemoteRunExecutionWorkloadInput(
    runSession: RunSession,
    executionPackage: ExecutionPackage,
  ): RemoteRunExecutionWorkloadInput {
    const runSpec = runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error('codex_runtime_job_unavailable');
    }
    const runtimeJobId = stableUuidFromDigest({
      kind: 'codex_runtime_job',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
    });
    const remoteRunSpec = {
      ...runSpec,
      repo: {
        ...runSpec.repo,
        local_path: '/workspace',
      },
    };
    return {
      runtimeJobId,
      launchLeaseId: stableUuidFromDigest({ kind: 'codex_launch_lease', runtime_job_id: runtimeJobId }),
      envelopeId: stableUuidFromDigest({ kind: 'codex_launch_token_envelope', runtime_job_id: runtimeJobId }),
      jobRequestId: stableUuidFromDigest({
        kind: 'codex_runtime_job_request',
        run_session_id: runSession.id,
        execution_package_id: executionPackage.id,
        execution_package_version: executionPackage.version,
      }),
      bundleId: `run-worker-workspace-bundle-${runSession.id}`,
      packagePrompt: [
        `Objective: ${runSpec.objective}`,
        '',
        `Package instructions: ${runSpec.context.package_instructions}`,
      ].join('\n'),
      executionContext: {
        schema_version: 'codex_run_execution_context.v1',
        run_spec: remoteRunSpec,
      },
    };
  }

  private async createRemoteRunExecutionJob(input: {
    runSession: RunSession;
    executionPackage: ExecutionPackage;
    lease: OwnedRun;
      bundle: PendingWorkspaceBundleReplayInput;
    expiresAt: string;
    remoteWorkload: RemoteRunExecutionWorkloadInput;
  }): Promise<string> {
    const client = this.remoteRunExecutionClient!;
    const runSpec = input.runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error('codex_runtime_job_unavailable');
    }
    const runtimeStatus = await client.getStatus({
      projectId: runSpec.project_id,
      repoId: runSpec.repo.repo_id,
      targetKind: 'run_execution',
    });
    if ((runtimeStatus.blocker_codes?.length ?? 0) > 0 || runtimeStatus.profile_status !== 'active' || runtimeStatus.worker_status !== 'online') {
      throw new Error('codex_runtime_job_unavailable');
    }
    const runWorkerLeaseId =
      input.lease.leaseId ?? stableUuidFromDigest({ kind: 'run_worker_lease', run_session_id: input.runSession.id, worker_id: input.lease.workerId });
    const runtimeJobId = input.remoteWorkload.runtimeJobId;
    const workload = {
      schema_version: 'codex_run_execution_workload.v1',
      runtime_job_id: runtimeJobId,
      run_session_id: input.runSession.id,
      execution_package_id: input.executionPackage.id,
      execution_package_version: input.executionPackage.version,
      workspace_bundle_id: input.bundle.bundle_id,
      workspace_bundle_digest: input.bundle.archive_digest,
      package_prompt_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/package-prompt`,
      package_prompt_digest: codexCanonicalDigest(input.remoteWorkload.packagePrompt),
      execution_context_ref: `artifact://codex-runtime-jobs/${runtimeJobId}/workload/execution-context`,
      execution_context_digest: codexCanonicalDigest(input.remoteWorkload.executionContext),
      path_policy_digest: codexCanonicalDigest({
        allowed_paths: runSpec.allowed_paths,
        forbidden_paths: runSpec.forbidden_paths,
      }),
      required_checks_digest: codexCanonicalDigest(runSpec.required_checks),
      output_schema_version: 'codex_run_execution_result.v1',
      created_at: this.now(),
      expires_at: input.expiresAt,
    };
    const response = await client.createRuntimeJob({
      runtime_job_id: runtimeJobId,
      launch_lease_id: input.remoteWorkload.launchLeaseId,
      envelope_id: input.remoteWorkload.envelopeId,
      job_request_id: input.remoteWorkload.jobRequestId,
      target: {
        target_type: 'run_session',
        target_id: input.runSession.id,
        target_kind: 'run_execution',
        project_id: runSpec.project_id,
        repo_id: runSpec.repo.repo_id,
      },
      runtime_profile_revision_id: requiredRemoteStatusString(runtimeStatus, 'runtime_profile_revision_id'),
      runtime_profile_digest: requiredRemoteStatusString(runtimeStatus, 'runtime_profile_digest'),
      credential_binding_id: requiredRemoteStatusString(runtimeStatus, 'credential_binding_id'),
      credential_binding_version_id: requiredRemoteStatusString(runtimeStatus, 'credential_binding_version_id'),
      credential_payload_digest: requiredRemoteStatusString(runtimeStatus, 'credential_payload_digest'),
      docker_image_digest: requiredRemoteStatusString(runtimeStatus, 'docker_image_digest'),
      network_policy_digest: requiredRemoteStatusString(runtimeStatus, 'network_policy_digest'),
      input_json: workload,
      workspace_acquisition_json: input.bundle.workspace_acquisition_json,
      pending_workspace_bundle: input.bundle,
      launch_attempt: 1,
      execution_package_id: input.executionPackage.id,
      run_session_id: input.runSession.id,
      run_worker_lease_id: runWorkerLeaseId,
      run_worker_lease_token: input.lease.leaseToken,
      run_session_status: input.runSession.status,
      run_session_updated_at: input.runSession.updated_at,
      execution_package_version: input.executionPackage.version,
      expires_at: input.expiresAt,
    });
    if (!isRecord(response) || !isRecord(response.runtime_job) || typeof response.runtime_job.id !== 'string') {
      throw new Error('codex_runtime_job_unavailable');
    }
    return response.runtime_job.id;
  }

  private async waitForRemoteRunExecutionTerminal(
    runtimeJobId: string,
    control: RunControl,
    expiresAt: string,
  ): Promise<RemoteRunExecutionTerminal> {
    const client = this.remoteRunExecutionClient!;
    const expiresAtMs = Date.parse(expiresAt);
    while (!control.stopped) {
      const nowMs = Date.parse(this.now());
      if (Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && nowMs >= expiresAtMs) {
        await this.cancelRemoteRunExecutionJob(runtimeJobId);
        return {
          runtimeJobId,
          terminalStatus: 'expired',
          reasonCode: 'codex_runtime_job_expired',
        };
      }
      const expiryDelayMs = Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) ? Math.max(0, expiresAtMs - nowMs) : undefined;
      let expiryTimer: ReturnType<typeof setTimeout> | undefined;
      const expiryPromise =
        expiryDelayMs === undefined
          ? undefined
          : new Promise<{ kind: 'expired' }>((resolve) => {
              expiryTimer = setTimeout(() => resolve({ kind: 'expired' }), expiryDelayMs);
            });
      const pollOutcome = await Promise.race([
        client.getRuntimeJob(runtimeJobId).then((response) => ({ kind: 'response' as const, response })),
        control.stoppedPromise.then(() => ({ kind: 'stopped' as const })),
        ...(expiryPromise === undefined ? [] : [expiryPromise]),
      ]);
      if (expiryTimer !== undefined) {
        clearTimeout(expiryTimer);
      }
      if (pollOutcome.kind === 'stopped') {
        break;
      }
      if (pollOutcome.kind === 'expired') {
        await this.cancelRemoteRunExecutionJob(runtimeJobId);
        return {
          runtimeJobId,
          terminalStatus: 'expired',
          reasonCode: 'codex_runtime_job_expired',
        };
      }
      const response = pollOutcome.response;
      if (!isRecord(response) || !isRecord(response.runtime_job)) {
        throw new Error('codex_runtime_job_unavailable');
      }
      const job = response.runtime_job;
      if (job.status === 'terminal') {
        const terminalStatus = job.terminal_status;
        if (
          terminalStatus !== 'succeeded' &&
          terminalStatus !== 'failed' &&
          terminalStatus !== 'cancelled' &&
          terminalStatus !== 'expired'
        ) {
          throw new Error('codex_runtime_job_unavailable');
        }
        const terminalResult =
          isRecord(job.terminal_result_json) && job.terminal_result_json.task_kind === 'run_execution'
            ? (validateCodexRuntimeJobTerminalResult(job.terminal_result_json) as CodexRunExecutionRuntimeJobResult)
            : undefined;
        return {
          runtimeJobId,
          terminalStatus,
          ...(typeof job.terminal_reason_code === 'string' ? { reasonCode: job.terminal_reason_code } : {}),
          ...(terminalResult === undefined ? {} : { terminalResult }),
        };
      }
      await delay(this.remoteRunExecutionPollIntervalMs);
    }
    if (control.failure !== undefined) {
      throw control.failure;
    }
    await this.cancelRemoteRunExecutionJob(runtimeJobId);
    return {
      runtimeJobId,
      terminalStatus: 'cancelled',
      reasonCode: 'codex_runtime_job_cancelled',
    };
  }

  private async cancelRemoteRunExecutionJob(runtimeJobId: string): Promise<void> {
    await this.remoteRunExecutionClient?.cancelRuntimeJob?.(runtimeJobId, {
      reason_code: 'codex_runtime_job_cancelled',
      idempotency_key: codexCanonicalDigest({ runtime_job_id: runtimeJobId, operation: 'cancel' }),
    });
  }

  private async finalizeRemoteRunExecutionTerminal(
    runSession: RunSession,
    terminal: RemoteRunExecutionTerminal,
    lease: OwnedRun,
    fence: RemoteRunExecutionFence,
  ): Promise<void> {
    const latest = (await this.repository.getRunSession(runSession.id)) ?? runSession;
    const latestExecutionPackage = await this.repository.getExecutionPackage(latest.execution_package_id);
    const leaseStillActive = await this.repository
      .assertActiveRunWorkerLease(latest.id, lease.workerId, lease.leaseToken, this.now())
      .then(() => true)
      .catch(() => false);
    const currentPathPolicyDigest =
      latest.run_spec === undefined
        ? undefined
        : codexCanonicalDigest({
            allowed_paths: latest.run_spec.allowed_paths,
            forbidden_paths: latest.run_spec.forbidden_paths,
          });
    const staleFence =
      !leaseStillActive ||
      terminalStatuses.has(latest.status) ||
      latest.status !== fence.runSessionStatus ||
      latest.updated_at !== fence.runSessionUpdatedAt ||
      latestExecutionPackage?.version !== fence.executionPackageVersion ||
      currentPathPolicyDigest !== fence.pathPolicyDigest;
    if (staleFence) {
      await this.recordStaleRemoteTerminal(latest, terminal, lease);
      return;
    }
    if (terminal.terminalResult !== undefined) {
      if (
        terminal.terminalResult.run_session_id !== latest.id ||
        terminal.terminalResult.execution_package_id !== latest.execution_package_id ||
        terminal.terminalResult.execution_package_version !== latest.run_spec?.expected_package_version ||
        terminal.terminalResult.execution_package_version !== latestExecutionPackage?.version ||
        terminal.terminalResult.workspace_bundle_digest !== fence.workspaceBundleDigest ||
        terminal.terminalResult.workspace_bundle_manifest_digest !== fence.workspaceBundleManifestDigest ||
        terminal.terminalResult.mounted_task_workspace_digest !== fence.mountedTaskWorkspaceDigest
      ) {
        await this.recordStaleRemoteTerminal(latest, terminal, lease);
        return;
      }
    }
    let executorResult = executorResultFromRemoteRunExecution({
      runSession: latest,
      terminal,
      at: this.now(),
    });
    if (terminal.terminalResult !== undefined && terminal.terminalStatus === 'succeeded') {
      try {
        assertRemoteChangedFilesAllowed(latest, terminal.terminalResult);
      } catch {
        executorResult = terminalExecutorResult({
          runSession: latest,
          status: 'failed',
          summary: 'Remote Codex run changed files outside the package path policy.',
          at: this.now(),
          failure: {
            kind: 'path_violation',
            message: 'Remote Codex run changed files outside the package path policy.',
            retryable: true,
          },
        });
      }
    }
    const terminalized = await terminalizePackageRunWithRuntimeEvidence({
      repository: this.repository,
      runSessionId: latest.id,
      evidence: runtimeEvidenceFromExecutorResult(executorResult),
      workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
      now: () => this.now(),
    });
    await this.recordAfterRunDiagnosticsBestEffort(latest, terminalized, lease);
    if (terminalized.reviewEligible) {
      await completePackageRunReviewFinalization({
        repository: this.repository,
        runSessionId: latest.id,
        selfReview: this.selfReview,
        workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
        now: () => this.now(),
      });
    }
  }

  private async recordStaleRemoteTerminal(runSession: RunSession, terminal: RemoteRunExecutionTerminal, lease: OwnedRun): Promise<void> {
    const at = this.now();
    try {
      await this.repository.appendWorkerRunEvent(
        {
          id: `run-event:${runSession.id}:remote-runtime-stale-terminal:${at}`,
          run_session_id: runSession.id,
          event_type: 'codex_warning',
          source: 'worker',
          visibility: 'internal',
          summary: 'Remote Codex runtime job terminal result was stale and was not applied.',
          payload: {
            runtime_job_id: terminal.runtimeJobId,
            terminal_status: terminal.terminalStatus,
            terminal_result_digest: terminal.terminalResult === undefined ? undefined : codexCanonicalDigest(terminal.terminalResult),
          },
          created_at: at,
        },
        { workerId: lease.workerId, leaseToken: lease.leaseToken },
      );
    } catch {
      // If the lease is already gone, preserving "do not mutate product state" matters more than internal diagnostics.
    }
  }

  private async startQueuedRun(runSession: RunSession, lease: OwnedRun): Promise<RunSession> {
    const at = this.now();
    const startInput = {
      repository: this.repository,
      runSessionId: runSession.id,
      now: () => at,
    };
    await this.repository.withActiveRunWorkerLease(runSession.id, { ...lease, now: at }, async (repository) => {
      await buildAndStartPackageRun({
        ...startInput,
        repository,
        ...(runSession.run_spec?.workflow_only === undefined ? {} : { workflowOnly: runSession.run_spec.workflow_only }),
      });
    });

    const started = await this.repository.getRunSession(runSession.id);
    if (started === undefined) {
      throw new Error(`Run session ${runSession.id} disappeared after start`);
    }

    return started;
  }

  private async prepareLocalCodexRuntime(
    runSession: RunSession,
    lease: OwnedRun,
    runtimeMetadata: RunRuntimeMetadata,
    mode: 'start' | 'resume',
  ): Promise<RunSession> {
    const runSpec = runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error(`Run session ${runSession.id} does not have a run spec`);
    }

    const environment = createDefaultLocalCodexEnvironment();
    const baseRef = runSpec.repo.base_commit_sha.trim().length > 0 ? runSpec.repo.base_commit_sha : runSpec.repo.base_branch;
    const existingSnapshot = runtimeMetadataSourceSnapshot(runtimeMetadata);
    if (mode === 'resume' && existingSnapshot === undefined) {
      throw new Error('Missing pre-run source snapshot metadata for local Codex recovery.');
    }
    const sourceRepoSnapshot =
      existingSnapshot ?? (await snapshotSourceRepoStatus(environment, runSpec.repo.local_path));
    let workspacePath = runtimeMetadata.workspace_path;
    let workspacePrepared = false;
    if (workspacePath === undefined) {
      const prepared = await environment.prepareWorkspace({
        repoPath: runSpec.repo.local_path,
        baseRef,
        runSessionId: runSpec.run_session_id,
      });
      if (!prepared.ok) {
        throw new Error(`Persistent workspace preparation failed: ${prepared.message}`);
      }
      workspacePath = prepared.workspacePath;
      workspacePrepared = true;
    }

    if ((mode === 'start' || workspacePrepared) && !(await environment.isWorkspaceClean(workspacePath))) {
      throw new Error(`Persistent workspace is not clean: ${workspacePath}`);
    }

    return this.updateRuntimeMetadata(runSession, lease, {
      workspace_path: workspacePath,
      source_repo_path: sourceRepoSnapshot.repoPath,
      source_repo_before_status: sourceRepoSnapshot.beforePorcelain,
      source_repo_before_dirty_fingerprint: sourceRepoSnapshot.beforeDirtyFingerprint,
    });
  }

  private async openDriverStream(
    driver: CodexSessionDriver,
    runSession: RunSession,
    runtimeMetadata: RunRuntimeMetadata,
    lease: OwnedRun,
    mode: 'start' | 'resume',
  ): Promise<OpenedDriverStream> {
    const runSpec = runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error(`Run session ${runSession.id} does not have a run spec`);
    }

    const input = {
      runSpec,
      workspacePath: runtimeMetadata.workspace_path ?? runSpec.repo.local_path,
      runtimeMetadata,
    };

    try {
      return {
        driver,
        runtimeMetadata,
        stream: mode === 'start' ? driver.startRun(input) : driver.resumeRun(input),
      };
    } catch (error) {
      if (driver.kind !== 'app_server' && runtimeMetadata.driver_kind !== 'app_server') {
        throw error;
      }

      return this.openFallbackDriverStream(runtimeMetadata, runSession, lease, error, mode);
    }
  }

  private async primeDriverStream(
    opened: OpenedDriverStream,
    runSession: RunSession,
    lease: OwnedRun,
    mode: 'start' | 'resume',
    control: RunControl,
  ): Promise<PrimedDriverStream> {
    const iterator = opened.stream[Symbol.asyncIterator]();
    control.cancelStream = () => {
      void iterator.return?.();
    };

    try {
      const first = await this.nextStreamItem(iterator, control);
      if (first === undefined) {
        return { ...opened, iterator, currentRunSession: runSession, stalled: control.stalled };
      }
      if (first.done === true) {
        return { ...opened, iterator, currentRunSession: runSession };
      }

      const handled = await this.handleStreamItem(first.value, runSession, lease);
      if (
        opened.runtimeMetadata.driver_kind === 'app_server' &&
        first.value.kind === 'event' &&
        isFallbackRequiredEvent(first.value)
      ) {
        const next = await this.nextStreamItem(iterator, control);
        if (next === undefined) {
          return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: control.stalled };
        }
        if (next.done === true) {
          await iterator.return?.();
          return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, fallbackReasonFromEvent(first.value), control, mode);
        }

        const nextHandled = await this.handleStreamItem(next.value, handled.currentRunSession, lease);
        if (nextHandled.terminal !== undefined) {
          if (nextHandled.terminal.status === 'failed') {
            await iterator.return?.();
            return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, nextHandled.terminal, control, mode);
          }

          return {
            ...opened,
            iterator,
            currentRunSession: nextHandled.currentRunSession,
            firstTerminal: nextHandled.terminal,
          };
        }

        return { ...opened, iterator, currentRunSession: nextHandled.currentRunSession };
      }

      if (
        handled.terminal?.status === 'failed' &&
        (opened.runtimeMetadata.driver_kind === 'app_server' || opened.isRecoveryFallback === true)
      ) {
        await iterator.return?.();
        if (opened.isRecoveryFallback === true) {
          await this.stallRun(
            handled.currentRunSession,
            lease,
            'Driver recovery failed.',
            handled.terminal.failure?.message ?? handled.terminal.summary,
          );
          return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: true };
        }
        return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, handled.terminal, control, mode);
      }

      return {
        ...opened,
        iterator,
        currentRunSession: handled.currentRunSession,
        ...(handled.terminal === undefined ? {} : { firstTerminal: handled.terminal }),
      };
    } catch (error) {
      if (opened.runtimeMetadata.driver_kind !== 'app_server') {
        throw error;
      }

      return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, error, control, mode);
    }
  }

  private async openFallbackDriverStream(
    runtimeMetadata: RunRuntimeMetadata,
    runSession: RunSession,
    lease: OwnedRun,
    reason: unknown,
    mode: 'start' | 'resume',
  ): Promise<OpenedDriverStream> {
    const runSpec = runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error(`Run session ${runSession.id} does not have a run spec`);
    }

    const reasonText = fallbackReason(reason);
    if (!this.allowExecFallback) {
      throw new Error(`fallback_denied_by_policy: ${reasonText}`);
    }
    const updatedRunSession = await this.updateRuntimeMetadata(runSession, lease, {
      ...runtimeMetadata,
      driver_kind: 'exec_fallback',
      driver_status: 'starting',
      selected_execution_mode: 'exec_fallback',
      app_server_fallback_reason: reasonText,
      exec_fallback_dangerous_bypass: true,
      effective_dangerous_mode: 'confirmed',
    } as Partial<RunRuntimeMetadata>);
    const fallbackMetadata = updatedRunSession.runtime_metadata!;
    const fallback = this.execFallbackDriverFactory({ runSession: updatedRunSession, runtimeMetadata: fallbackMetadata, workerLease: lease });
    const at = this.now();
    await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:driver-fallback-used:${at}`,
        run_session_id: runSession.id,
        event_type: 'driver_fallback_used',
        source: 'worker',
        visibility: 'public',
        summary: mode === 'start' ? 'Worker switched to exec fallback start.' : 'Worker switched to exec fallback recovery.',
        payload: { reason: reasonText },
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );

    const input = {
      runSpec,
      workspacePath: fallbackMetadata.workspace_path ?? runSpec.repo.local_path,
      runtimeMetadata: fallbackMetadata,
    };
    const fallbackMode = mode === 'resume' && fallbackMetadata.codex_thread_id === undefined ? 'start' : mode;

    return {
      driver: fallback,
      runtimeMetadata: fallbackMetadata,
      stream: fallbackMode === 'start' ? fallback.startRun(input) : fallback.resumeRun(input),
      isRecoveryFallback: true,
    };
  }

  private async openFallbackAfterRecoveryFailure(
    runtimeMetadata: RunRuntimeMetadata,
    runSession: RunSession,
    lease: OwnedRun,
    reason: unknown,
    control: RunControl,
    mode: 'start' | 'resume',
  ): Promise<PrimedDriverStream> {
    try {
      const opened = await this.openFallbackDriverStream(runtimeMetadata, runSession, lease, reason, mode);
      const fallbackRunSession = (await this.repository.getRunSession(runSession.id)) ?? runSession;
      const iterator = opened.stream[Symbol.asyncIterator]();
      control.cancelStream = () => {
        void iterator.return?.();
      };
      const first = await this.nextStreamItem(iterator, control);
      if (first === undefined) {
        return { ...opened, iterator, currentRunSession: fallbackRunSession, stalled: control.stalled };
      }
      if (first.done === true) {
        await this.stallRun(fallbackRunSession, lease, 'Driver recovery failed.', 'Exec fallback ended before recovery completed.');
        return { ...opened, iterator, currentRunSession: fallbackRunSession, stalled: true };
      }

      const handled = await this.handleStreamItem(first.value, fallbackRunSession, lease);
      if (handled.terminal?.status === 'failed') {
        await iterator.return?.();
        if (mode === 'start') {
          return {
            ...opened,
            iterator,
            currentRunSession: handled.currentRunSession,
            firstTerminal: handled.terminal,
          };
        }
        await this.stallRun(
          handled.currentRunSession,
          lease,
          'Driver recovery failed.',
          handled.terminal.failure?.message ?? handled.terminal.summary,
        );
        return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: true };
      }

      return {
        ...opened,
        iterator,
        currentRunSession: handled.currentRunSession,
        ...(handled.terminal === undefined ? {} : { firstTerminal: handled.terminal }),
      };
    } catch (error) {
      const latest = (await this.repository.getRunSession(runSession.id)) ?? runSession;
      await this.stallRun(latest, lease, 'Driver recovery failed.', error);
      return {
        driver: this.execFallbackDriverFactory({
          runSession: latest,
          runtimeMetadata: latest.runtime_metadata ?? runtimeMetadata,
          workerLease: lease,
        }),
        runtimeMetadata: latest.runtime_metadata ?? runtimeMetadata,
        iterator: (async function* empty() {})()[Symbol.asyncIterator](),
        currentRunSession: latest,
        stalled: true,
      };
    }
  }

  private async consumeStream(
    opened: PrimedDriverStream,
    lease: OwnedRun,
    mode: 'start' | 'resume',
    control: RunControl,
  ): Promise<ConsumeStreamResult> {
    let current = opened.currentRunSession;
    while (!control.stopped) {
      const item = await this.nextStreamItem(opened.iterator, control);
      if (item === undefined) {
        return { kind: 'ended', currentRunSession: current };
      }
      if (item.done === true) {
        return { kind: 'ended', currentRunSession: current };
      }

      if (
        opened.runtimeMetadata.driver_kind === 'app_server' &&
        item.value.kind === 'event' &&
        isFallbackRequiredEvent(item.value)
      ) {
        const handled = await this.handleStreamItem(item.value, current, lease);
        await opened.iterator.return?.();
        return {
          kind: 'switched',
          stream: await this.openFallbackAfterRecoveryFailure(
            handled.currentRunSession.runtime_metadata ?? opened.runtimeMetadata,
            handled.currentRunSession,
            lease,
            fallbackReasonFromEvent(item.value),
            control,
            mode,
          ),
        };
      }

      const handled = await this.handleStreamItem(item.value, current, lease);
      current = handled.currentRunSession;
      opened.currentRunSession = current;
      opened.runtimeMetadata = current.runtime_metadata ?? opened.runtimeMetadata;
      if (handled.terminal !== undefined) {
        if (
          handled.terminal.status === 'failed' &&
          (opened.runtimeMetadata.driver_kind === 'app_server' || opened.isRecoveryFallback === true)
        ) {
          await opened.iterator.return?.();
          if (opened.isRecoveryFallback === true) {
            await this.stallRun(
              handled.currentRunSession,
              lease,
              'Driver recovery failed.',
              handled.terminal.failure?.message ?? handled.terminal.summary,
            );
            return {
              kind: 'switched',
              stream: {
                ...opened,
                currentRunSession: handled.currentRunSession,
                stalled: true,
              },
            };
          }
          return {
            kind: 'switched',
            stream: await this.openFallbackAfterRecoveryFailure(
              opened.runtimeMetadata,
              handled.currentRunSession,
              lease,
              handled.terminal,
              control,
              mode,
            ),
          };
        }
        return { kind: 'terminal', terminal: handled.terminal };
      }
    }

    return { kind: 'ended', currentRunSession: current };
  }

  private async nextStreamItem(
    iterator: AsyncIterator<CodexDriverStreamItem>,
    control: RunControl,
  ): Promise<IteratorResult<CodexDriverStreamItem> | undefined> {
    return Promise.race([iterator.next(), control.stoppedPromise.then(() => undefined)]);
  }

  private async handleStreamItem(
    item: CodexDriverStreamItem,
    runSession: RunSession,
    lease: OwnedRun,
  ): Promise<{
    currentRunSession: RunSession;
    terminal?: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
  }> {
    if (item.kind !== 'event') {
      return { currentRunSession: runSession, terminal: item };
    }

    const at = this.now();
    const event = await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:${item.event.event_type}:${at}`,
        run_session_id: runSession.id,
        event_type: item.event.event_type,
        source: item.event.source,
        visibility: item.event.visibility,
        summary: item.event.summary,
        payload: item.event.payload,
        ...(item.event.raw_ref === undefined ? {} : { raw_ref: JSON.stringify(item.event.raw_ref) }),
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );
    let current = await this.updateRuntimeMetadata(runSession, lease, {
      ...item.runtimeMetadata,
      last_event_at: event.created_at,
      last_event_cursor: event.cursor,
    });

    if (item.event.event_type === 'waiting_for_input') {
      current = {
        ...current,
        status: 'waiting_for_input',
        updated_at: event.created_at,
      };
      await this.saveRunSessionFenced(current, lease);
    }

    return { currentRunSession: current };
  }

  private async finalizeTerminal(
    runSession: RunSession,
    terminal: Extract<CodexDriverStreamItem, { kind: 'terminal' }>,
    lease: OwnedRun,
  ): Promise<void> {
    const latest = (await this.repository.getRunSession(runSession.id)) ?? runSession;
    const at = this.now();
    let executorResult: ExecutorResult;

    if (terminal.status === 'succeeded') {
      if (latest.run_spec === undefined) {
        throw new Error(`Run session ${latest.id} does not have a run spec`);
      }
      const localCodexRun =
        latest.run_spec.executor_type === 'local_codex' &&
        latest.run_spec.workflow_only !== true &&
        (latest.runtime_metadata?.driver_kind === 'app_server' || latest.runtime_metadata?.driver_kind === 'exec_fallback');
      const workspacePath = latest.runtime_metadata?.workspace_path ?? latest.run_spec.repo.local_path;
      const environment = localCodexRun ? createDefaultLocalCodexEnvironment() : fakeEnvironment();
      const checkEnv = localCodexRun ? await createLocalCodexCheckEnv(environment, workspacePath) : {};
      const sourceRepoSnapshot = localCodexRun ? runtimeMetadataSourceSnapshot(latest.runtime_metadata) : sourceSnapshot(latest);
      if (sourceRepoSnapshot === undefined) {
        throw new Error('Missing pre-run source snapshot metadata for local Codex finalization.');
      }
      executorResult = await this.evidenceCollector({
        runSpec: latest.run_spec,
        workspacePath,
        baseRef: latest.run_spec.repo.base_commit_sha,
        artifactRoot: this.artifactRoot,
        summary: terminal.summary,
        startedAt: latest.started_at ?? at,
        environment,
        checkEnv,
        sourceRepoSnapshot,
        effectiveDangerousMode: latest.runtime_metadata?.effective_dangerous_mode ?? 'not_requested',
      });
    } else {
      executorResult = terminalExecutorResult({
        runSession: latest,
        status: terminal.status,
        summary: terminal.summary,
        ...(terminal.failure === undefined ? {} : { failure: terminal.failure }),
        at,
      });
    }

    if (isRealLocalCodexRuntime(latest)) {
      const terminalized = await terminalizePackageRunWithRuntimeEvidence({
        repository: this.repository,
        runSessionId: latest.id,
        evidence: runtimeEvidenceFromExecutorResult(executorResult),
        workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
        now: () => at,
      });
      await this.recordAfterRunDiagnosticsBestEffort(latest, terminalized, lease);
      if (terminalized.reviewEligible) {
        await completePackageRunReviewFinalization({
          repository: this.repository,
          runSessionId: latest.id,
          selfReview: this.selfReview,
          workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
          now: () => this.now(),
        });
      }
      return;
    }

    await finalizePackageRunWithExecutorResult({
      repository: this.repository,
      runSessionId: latest.id,
      executorResult,
      selfReview: this.selfReview,
      workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
      now: () => at,
    });
  }

  private async recordAfterRunDiagnosticsBestEffort(
    runSession: RunSession,
    terminalized: TerminalizedRunResult,
    lease: OwnedRun,
  ): Promise<void> {
    try {
      await this.recordAfterRunDiagnostics(runSession, terminalized, lease);
    } catch (error) {
      console.warn('[forgeloop:run-worker] after_run diagnostics persistence failed', {
        run_session_id: runSession.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async recordAfterRunDiagnostics(
    runSession: RunSession,
    terminalized: TerminalizedRunResult,
    lease: OwnedRun,
  ): Promise<void> {
    const at = this.now();
    await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:after-run-diagnostics:${at}`,
        run_session_id: runSession.id,
        event_type: 'after_run_diagnostics_recorded',
        source: 'worker',
        visibility: 'internal',
        summary: 'after_run hooks skipped because read-only source enforcement is unavailable.',
        payload: {
          terminal_status: terminalized.status,
          review_finalization_eligible: terminalized.reviewEligible,
          diagnostics: [
            {
              phase: 'after_run',
              status: 'skipped',
              reason_code: 'after_run_read_only_unavailable',
              summary: 'after_run hook skipped because read-only source enforcement is unavailable.',
            },
          ],
        },
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );
  }

  private startHeartbeat(lease: OwnedRun, control: RunControl): { done: Promise<void> } {
    const beat = async () => {
      while (!control.stopped) {
        await delay(this.heartbeatIntervalMs);
        if (control.stopped) {
          return;
        }

        const at = this.now();
        try {
          await heartbeatLease(this.repository, lease.runSessionId, lease.workerId, lease.leaseToken, at, this.leaseDurationMs);
          await this.repository.appendWorkerRunEvent(
            {
              id: `run-event:${lease.runSessionId}:watchdog-heartbeat:${at}`,
              run_session_id: lease.runSessionId,
              event_type: 'watchdog_heartbeat',
              source: 'watchdog',
              visibility: 'internal',
              summary: 'Worker heartbeat.',
              payload: { worker_id: lease.workerId },
              created_at: at,
            },
            { workerId: lease.workerId, leaseToken: lease.leaseToken },
          );
          const runSession = await this.repository.getRunSession(lease.runSessionId);
          if (runSession !== undefined && (await this.stallIfIdle(runSession, lease))) {
            control.stall();
            void control.cancelStream?.();
          }
        } catch (error) {
          control.fail(error);
          void control.cancelStream?.();
        }
      }
    };

    return { done: beat() };
  }

  private startCommandPolling(
    input: Parameters<typeof applyPendingRunCommands>[0] | (() => Parameters<typeof applyPendingRunCommands>[0]),
    control: RunControl,
  ): { done: Promise<void> } {
    const done = (async () => {
      while (!control.stopped) {
        try {
          await applyPendingRunCommands(typeof input === 'function' ? input() : input);
        } catch (error) {
          control.fail(error);
          void control.cancelStream?.();
          return;
        }

        await delay(this.commandPollIntervalMs);
      }
    })();

    return { done };
  }

  private createRunControl(): RunControl {
    let resolveStopped: (() => void) | undefined;
    const stoppedPromise = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const control: RunControl = {
      stopped: false,
      stalled: false,
      stoppedPromise,
      stop: () => {
        control.stopped = true;
        resolveStopped?.();
      },
      fail: (error: unknown) => {
        control.failure = error;
        control.stopped = true;
        resolveStopped?.();
      },
      stall: () => {
        control.stalled = true;
        control.stopped = true;
        resolveStopped?.();
      },
    };

    return control;
  }

  private async stallIfIdle(runSession: RunSession, lease: OwnedRun): Promise<boolean> {
    if (runSession.runtime_metadata?.last_event_at === undefined || runSession.status !== 'running') {
      return false;
    }

    const progress = evaluateRunProgress({
      status: runSession.status,
      lastCodexActivityAt: runSession.runtime_metadata.last_event_at,
      now: this.now(),
      idleThresholdMs: this.idleThresholdMs,
    });

    if (progress !== 'stalled') {
      return false;
    }

    await this.stallRun(runSession, lease, 'Codex activity stalled.');
    return true;
  }

  private async stallStoppedRun(runSession: RunSession, lease: OwnedRun, control: RunControl): Promise<void> {
    if (terminalStatuses.has(runSession.status)) {
      return;
    }

    await this.stallRun(runSession, lease, 'Worker stopped before terminal completion.', control.failure);
  }

  private async stallRun(runSession: RunSession, lease: OwnedRun, summary: string, error?: unknown): Promise<void> {
    const at = this.now();
    await this.saveRunSessionFenced(
      {
        ...runSession,
        status: 'stalled',
        summary,
        updated_at: at,
      },
      lease,
    );
    await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:stalled:${at}`,
        run_session_id: runSession.id,
        event_type: 'stalled',
        source: 'watchdog',
        visibility: 'public',
        summary,
        payload: { reason: error instanceof Error ? error.message : summary },
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );
  }

  private async updateRuntimeMetadata(
    runSession: RunSession,
    lease: OwnedRun,
    update: Partial<RunRuntimeMetadata>,
  ): Promise<RunSession> {
    const next = {
      ...runSession,
      runtime_metadata: mergeMetadata(runSession, lease.workerId, update),
      updated_at: this.now(),
    };
    await this.saveRunSessionFenced(next, lease);
    return next;
  }

  private async saveRunSessionFenced(runSession: RunSession, lease: OwnedRun): Promise<void> {
    await this.repository.withActiveRunWorkerLease(runSession.id, { ...lease, now: this.now() }, (repository) =>
      repository.saveRunSession(runSession),
    );
  }
}
