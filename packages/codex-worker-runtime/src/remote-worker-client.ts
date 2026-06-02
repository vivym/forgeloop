import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexGenerationTaskKinds,
  type CodexRuntimeCapsule,
  type CodexDockerRuntimeEvidence,
  type CodexGenerationWorkloadV1,
  type CodexLaunchMaterialization,
  type CodexRunExecutionRuntimeJobResult,
  type CodexRunExecutionWorkloadV1,
  type CodexLaunchTokenEnvelope,
  type CodexRuntimeJob,
  type CodexRuntimeTargetKind,
  type CodexRuntimeScope,
  validateCodexSessionRuntimeContext,
  validateCodexRuntimeJobTerminalResult,
} from '@forgeloop/domain';
import {
  CodexAppServerEndpointTransport,
  createCodexGenerationRuntime,
  type CodexGenerationResult,
} from '@forgeloop/codex-runtime';
import type { CodexDriverStartInput, CodexDriverStreamItem, CodexSessionDriver } from '@forgeloop/executor';

import type { DockerizedCodexAppServerLauncher } from './app-server-launcher.js';
import { decryptCodexLaunchTokenEnvelope, generateCodexWorkerSessionKeyPair, type CodexWorkerSessionKeyPair } from './envelope-crypto.js';
import { createMaterializedRunSessionCodexDriver } from './run-session-driver.js';
import {
  generationRuntimeJobTerminalResult,
  type GenerationOutputCapsulePackageResult,
  jsonRuntimeJobArtifactUpload,
  type RuntimeJobArtifactUploadInput,
} from './runtime-job-artifacts.js';
import {
  collectWorkspaceBundleChangedFiles,
  createWorkspaceBundlePatchArtifact,
  safeUnpackWorkspaceBundle,
  type WorkspaceBundleUnpackResult,
} from './workspace-bundle.js';
import { writeCodexHomeConfigAndAuth } from './task-filesystem.js';

type RunExecutionResultDraft = {
  changed_files: string[];
  patch?: string;
  check_results: CodexRunExecutionRuntimeJobResult['check_results'];
  execution_artifacts: CodexRunExecutionRuntimeJobResult['execution_artifacts'];
  public_summary: string;
};

type RuntimeJobPollItem = {
  runtime_job: Pick<CodexRuntimeJob, 'id' | 'target_kind' | 'project_id' | 'repo_id' | 'launch_lease_id'> &
    Partial<CodexRuntimeJob>;
  envelope?: { id?: string };
};

type RemoteControlPlaneClient = {
  registerWorker(input: Record<string, unknown>): Promise<unknown>;
  heartbeatWorker(workerId: string, input: Record<string, unknown>): Promise<unknown>;
  pollRuntimeJobs(workerId: string, input: Record<string, unknown>): Promise<unknown>;
  refreshWorkerSession?(workerId: string, input: Record<string, unknown>): Promise<unknown>;
  acceptRuntimeJob(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  getRuntimeJobControl(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  claimLaunchTokenEnvelope?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  fetchRuntimeJobWorkload?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  materializeRuntimeJob?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<CodexLaunchMaterialization>;
  startRuntimeJob?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  markCodexSessionRunnerOwner?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  attachCodexSessionRunnerRuntimeJob?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  appendRuntimeJobEvent?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  uploadRuntimeJobArtifact?(
    workerId: string,
    jobId: string,
    input: RuntimeJobArtifactUploadInput & Record<string, unknown>,
  ): Promise<unknown>;
  downloadWorkspaceBundle?(
    workerId: string,
    jobId: string,
    bundleId: string,
    input: Record<string, unknown>,
  ): Promise<{ archive_path: string; archive_digest: string; size_bytes: number; content_type: string }>;
  terminalizeRuntimeJob(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
};

export interface RemoteWorkerCapsuleRestoreInput {
  codexHomeHostPath: string;
  codexSessionId: string;
  codexSessionTurnId: string;
  inputCapsuleId: string;
  inputCapsuleDigest: string;
  inputCapsuleRef: string;
  inputMemoryBundleRef: string;
  inputMemoryBundleDigest: string;
  inputEnvironmentManifestRef: string;
  inputEnvironmentManifestDigest: string;
  materialization: CodexLaunchMaterialization;
}

export interface RemoteWorkerCapsulePackageInput {
  codexHomeHostPath: string;
  artifactHostPath: string;
  codexSessionId: string;
  codexSessionTurnId: string;
  expectedInputCapsuleDigest?: string;
  materialization: CodexLaunchMaterialization;
  status: 'succeeded' | 'failed' | 'cancelled';
  generationResult: CodexGenerationResult<Record<string, unknown>>;
  runtimeEvidence: CodexDockerRuntimeEvidence;
}

export interface RemoteWorkerCapsuleManager {
  restore(input: RemoteWorkerCapsuleRestoreInput): Promise<void>;
  package(input: RemoteWorkerCapsulePackageInput): Promise<GenerationOutputCapsulePackageResult>;
}

type RemoteLauncher = Pick<DockerizedCodexAppServerLauncher, 'startFromMaterialization'>;
type AppServerSession = Awaited<ReturnType<RemoteLauncher['startFromMaterialization']>>;
type GenerationRunner = {
  sessionId?: string;
  runnerRuntimeJobId: string;
  runnerLaunchLeaseId: string;
  appServerSession: AppServerSession;
  materialization: CodexLaunchMaterialization;
  runtimeEvidenceDigest: string;
  launchMaterializationDigest: string;
};

export interface RemoteCodexWorkerClientOptions {
  workerId: string;
  workerIdentity: string;
  version: string;
  bootstrapToken: string;
  bootstrapTokenVersion: number;
  workerTempRoot: string;
  allowedScopes: readonly CodexRuntimeScope[];
  capabilities: readonly CodexRuntimeTargetKind[];
  dockerImageDigests: readonly string[];
  networkPolicyDigests: readonly string[];
  networkProviderConfigDigests?: readonly string[];
  hostUid: number;
  hostGid: number;
  maxConcurrency: number;
  controlPlaneClient: RemoteControlPlaneClient;
  launcher: RemoteLauncher;
  scavenger: () => Promise<void>;
  sessionPublicKeyTtlMs?: number;
  generationRuntimeFactory?: typeof createCodexGenerationRuntime;
  runExecutionDriverFactory?: (input: {
    workload: CodexRunExecutionWorkloadV1;
    packagePrompt: string;
    executionContext: Record<string, unknown>;
    materialization: CodexLaunchMaterialization;
    dockerSession: Awaited<ReturnType<RemoteLauncher['startFromMaterialization']>>;
    workspacePath: string;
  }) => CodexSessionDriver;
  runExecutionResultCollector?: (input: {
    workload: CodexRunExecutionWorkloadV1;
    packagePrompt: string;
    executionContext: Record<string, unknown>;
    runSpec: CodexDriverStartInput['runSpec'];
    workspacePath: string;
    terminal: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
    materialization: CodexLaunchMaterialization;
  }) => Promise<RunExecutionResultDraft>;
  capsuleManager?: RemoteWorkerCapsuleManager;
  now?: () => string;
  nonceFactory?: () => string;
  sleep?: (durationMs: number) => Promise<void>;
  pollIntervalMs?: number;
  controlPollIntervalMs?: number;
  sessionRefreshLeadMs?: number;
  shouldContinue?: () => boolean;
}

export interface RemoteCodexWorkerClient {
  runOnce(): Promise<{ processed: number }>;
  runLoop(): Promise<{ iterations: number; processed: number }>;
}

interface WorkerSession {
  token: string;
  expiresAt: string;
  epoch: number;
  keyPair: CodexWorkerSessionKeyPair;
}

type RunExecutionFailureStage =
  | 'workspace_bundle_acquisition'
  | 'launch_materialization'
  | 'docker_app_server_startup'
  | 'runtime_job_start'
  | 'app_server_started_event'
  | 'run_execution_driver_terminal'
  | 'run_execution_control_poll'
  | 'run_execution_result_collection'
  | 'run_execution_artifact_upload';

type GenerationFailureStage =
  | 'launch_envelope_claim'
  | 'generation_workload_fetch'
  | 'launch_materialization'
  | 'docker_app_server_startup'
  | 'runtime_job_start'
  | 'app_server_started_event'
  | 'generation_runtime_turn'
  | 'generation_artifact_upload'
  | 'generation_cleanup'
  | 'generation_capsule_packaging'
  | 'generation_terminal_result'
  | 'generation_terminalize';

interface RuntimeFailureDiagnostic {
  runtime_target_kind?: CodexRuntimeTargetKind;
  app_server_started?: boolean;
  failure_stage?: RunExecutionFailureStage | GenerationFailureStage;
  failure_subcode?: string;
  runtime_evidence_digest?: string;
  generation_output_schema_sent?: boolean;
  generation_context_operation?: 'start' | 'continue' | 'revise_summary';
}

const generationContextOperation = (context: Record<string, unknown>): 'start' | 'continue' | 'revise_summary' => {
  const operation = context.operation;
  return operation === 'continue' || operation === 'revise_summary' ? operation : 'start';
};

const generationOutputSchemaSent = (workload: CodexGenerationWorkloadV1, context: Record<string, unknown>): boolean =>
  !(workload.task_kind === 'boundary_brainstorming_round' && workload.output_schema_version === 'boundary_round_result.v1');

export const createRemoteCodexWorkerClient = (options: RemoteCodexWorkerClientOptions): RemoteCodexWorkerClient => {
  const now = options.now ?? (() => new Date().toISOString());
  const nonce = options.nonceFactory ?? (() => randomUUID());
  const sleep = options.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const generationRuntimeFactory = options.generationRuntimeFactory ?? createCodexGenerationRuntime;
  let session: WorkerSession | undefined;
  let workerHeartbeatIntervalMs = 15_000;
  let lastWorkerHeartbeatAtMs: number | undefined;
  let nextWorkerHeartbeatAtMs = 0;
  const generationRunners = new Map<string, GenerationRunner>();

  const ensureSession = async (): Promise<WorkerSession> => {
    if (session !== undefined) {
      if (sessionShouldRefresh(session, now(), options.sessionRefreshLeadMs ?? 30_000)) {
        session = await refreshSession(session);
        await heartbeat(session, { force: true });
      }
      return session;
    }
    const keyPair = await generateCodexWorkerSessionKeyPair({});
    const nowValue = now();
    const response = await options.controlPlaneClient.registerWorker({
      worker_id: options.workerId,
      worker_identity: options.workerIdentity,
      version: options.version,
      bootstrap_token: options.bootstrapToken,
      bootstrap_token_version: options.bootstrapTokenVersion,
      status: 'online',
      control_channel_status: 'connected',
      allowed_scopes: options.allowedScopes,
      capabilities: options.capabilities,
      docker_image_digests: options.dockerImageDigests,
      network_policy_digests: options.networkPolicyDigests,
      ...(options.networkProviderConfigDigests === undefined ? {} : { network_provider_config_digests: options.networkProviderConfigDigests }),
      host_worker_uid: options.hostUid,
      host_worker_gid: options.hostGid,
      lease_count: 0,
      max_concurrency: options.maxConcurrency,
      session_public_key_id: keyPair.keyId,
      session_public_key_algorithm: 'x25519',
      session_public_key_material: keyPair.publicKeyMaterial,
      session_public_key_expires_at: new Date(Date.parse(nowValue) + (options.sessionPublicKeyTtlMs ?? 10 * 60_000)).toISOString(),
    });
    if (!isRecord(response)) {
      throw new Error('codex_remote_worker_response_invalid:register');
    }
    session = {
      token: requiredString(response, 'session_token'),
      expiresAt: requiredString(response, 'session_expires_at'),
      epoch: sessionEpoch(response),
      keyPair,
    };
    await options.scavenger();
    await heartbeat(session, { force: true });
    return session;
  };

  const refreshSession = async (current: WorkerSession): Promise<WorkerSession> => {
    if (options.controlPlaneClient.refreshWorkerSession === undefined) {
      throw new Error('codex_control_plane_method_missing:refreshWorkerSession');
    }
    const nextKeyPair = await generateCodexWorkerSessionKeyPair({});
    const response = await options.controlPlaneClient.refreshWorkerSession(options.workerId, {
      workerSessionToken: current.token,
      nonce: nonce(),
      nonceTimestamp: now(),
      next_session_public_key_id: nextKeyPair.keyId,
      next_session_public_key_algorithm: 'x25519',
      next_session_public_key_material: nextKeyPair.publicKeyMaterial,
      next_session_public_key_expires_at: new Date(Date.parse(now()) + (options.sessionPublicKeyTtlMs ?? 10 * 60_000)).toISOString(),
      refresh_idempotency_key: codexCanonicalDigest({
        worker_id: options.workerId,
        previous_session_token_digest: codexCredentialPayloadDigest(current.token),
        next_session_public_key_id: nextKeyPair.keyId,
      }),
    });
    if (!isRecord(response)) {
      throw new Error('codex_remote_worker_response_invalid:refresh');
    }
    return {
      token: requiredString(response, 'session_token'),
      expiresAt: requiredString(response, 'session_expires_at'),
      epoch: sessionEpoch(response),
      keyPair: nextKeyPair,
    };
  };

  const heartbeat = async (workerSession: WorkerSession, input: { force?: boolean } = {}): Promise<void> => {
    const nowValue = now();
    const nowMs = Date.parse(nowValue);
    if (input.force !== true && Number.isFinite(nowMs) && nowMs < nextWorkerHeartbeatAtMs) {
      return;
    }
    const codexSessionRunners = Array.from(generationRunners.entries(), ([sessionId, runner]) => ({
      session_id: sessionId,
      runner_launch_lease_id: runner.runnerLaunchLeaseId,
      runner_runtime_job_id: runner.runnerRuntimeJobId,
      runner_expires_at: runnerExpiresAt(),
    }));
    await options.controlPlaneClient.heartbeatWorker(options.workerId, {
      session_token: workerSession.token,
      nonce: nonce(),
      nonce_timestamp: nowValue,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: codexSessionRunners.length,
      capabilities: options.capabilities,
      ...(codexSessionRunners.length === 0 ? {} : { codex_session_runners: codexSessionRunners }),
    });
    if (Number.isFinite(nowMs)) {
      lastWorkerHeartbeatAtMs = nowMs;
      nextWorkerHeartbeatAtMs = nowMs + workerHeartbeatIntervalMs;
    }
  };

  const updateWorkerHeartbeatInterval = (response: unknown): void => {
    if (!isRecord(response) || !Number.isInteger(response.heartbeat_interval_ms)) {
      return;
    }
    const nextInterval = Number(response.heartbeat_interval_ms);
    if (nextInterval <= 0) {
      return;
    }
    workerHeartbeatIntervalMs = nextInterval;
    if (lastWorkerHeartbeatAtMs !== undefined) {
      nextWorkerHeartbeatAtMs = lastWorkerHeartbeatAtMs + workerHeartbeatIntervalMs;
    }
  };

  const workerProof = (workerSession: WorkerSession): Record<string, unknown> => ({
    workerSessionToken: workerSession.token,
    nonce: nonce(),
    nonceTimestamp: now(),
  });

  const processJob = async (item: RuntimeJobPollItem, workerSession: WorkerSession): Promise<void> => {
    const job = item.runtime_job;
    if (job.target_kind === 'run_execution') {
      await processRunExecutionJob(item, workerSession);
      return;
    }
    if (job.target_kind !== 'generation') {
      await terminalize(workerSession, job, {
        terminal_status: 'failed',
        reason_code: 'codex_runtime_job_unavailable',
      });
      return;
    }
    const sessionDigest = codexCredentialPayloadDigest(workerSession.token);
    const publicKeyId = workerSession.keyPair.keyId;
    await options.controlPlaneClient.acceptRuntimeJob(options.workerId, job.id, {
      ...workerProof(workerSession),
      accept_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'accept' }),
      accepted_worker_session_digest: sessionDigest,
      accepted_session_public_key_id: publicKeyId,
      accepted_session_epoch: workerSession.epoch,
    });

    const control = await getControl(workerSession, job);
    if (control.cancel_requested === true) {
      await terminalize(workerSession, job, {
        terminal_status: 'cancelled',
        reason_code: 'codex_runtime_job_cancelled',
      });
      return;
    }

    let runner: GenerationRunner | undefined;
    let successTerminalAttempted = false;
    const failureDiagnostic: RuntimeFailureDiagnostic = {
      runtime_target_kind: 'generation',
      app_server_started: false,
      failure_stage: 'generation_workload_fetch',
    };
    try {
      const workloadResponse = requiredGenerationWorkload(
        await options.controlPlaneClient.fetchRuntimeJobWorkload?.(options.workerId, job.id, workerProof(workerSession)),
      );
      const workload = workloadResponse.workload;
      await throwIfCancelled(workerSession, job);
      runner =
        shouldAttachGenerationRunner(workload)
          ? await attachGenerationRunner(workerSession, job, workload)
          : await startGenerationRunner(workerSession, job, item, workload, {
              sessionDigest,
              publicKeyId,
              epoch: workerSession.epoch,
              privateKeyHandle: workerSession.keyPair.privateKeyHandle,
            });
      failureDiagnostic.app_server_started = true;
      failureDiagnostic.runtime_evidence_digest = runner.runtimeEvidenceDigest;

      const runtime = generationRuntimeFactory({
        mode: 'app_server',
        appServerEndpoint: runner.appServerSession.endpoint,
        artifactRoot: '/artifacts',
        timeoutMs: runner.materialization.profile_revision.resource_limits.timeout_ms,
        outputLimitBytes: runner.materialization.profile_revision.resource_limits.output_limit_bytes,
        transportFactory: (endpoint) =>
          runner?.appServerSession.createTransport?.() ??
          new CodexAppServerEndpointTransport(endpoint, runner?.appServerSession.endpointAuth),
      });
      failureDiagnostic.failure_stage = 'generation_runtime_turn';
      failureDiagnostic.generation_output_schema_sent = generationOutputSchemaSent(workload, workloadResponse.signedContext);
      failureDiagnostic.generation_context_operation = generationContextOperation(workloadResponse.signedContext);
      const generationResult = await runGenerationWithControl(workerSession, job, (signal) =>
        runGeneration(runtime, workloadResponse, job, runner!.materialization, signal),
      );
      failureDiagnostic.failure_stage = 'generation_artifact_upload';
      const uploadedArtifacts = await uploadGenerationArtifacts(workerSession, job, generationResult);
      failureDiagnostic.failure_stage = 'generation_capsule_packaging';
      const outputCapsule = await packageGenerationOutputCapsule(runner, workload, generationResult);
      failureDiagnostic.failure_stage = 'generation_cleanup';
      await closeAfterGeneration(workerSession, job, runner, workload);
      failureDiagnostic.failure_stage = 'generation_terminal_result';
      const terminalResult = generationRuntimeJobTerminalResult(
        generationResult,
        uploadedArtifacts,
        runner.appServerSession.publicEvidence,
        outputCapsule,
      );
      failureDiagnostic.failure_stage = 'generation_terminalize';
      successTerminalAttempted = true;
      await terminalizeWithRetry(workerSession, job, {
        terminal_status: 'succeeded',
        reason_code: 'codex_runtime_job_succeeded',
        terminal_result_json: terminalResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      if (successTerminalAttempted) {
        if (publicErrorCode(error) === 'codex_runtime_job_success_terminal_unconfirmed') {
          const reasonCode = await publicErrorCodeForJobError(error, workerSession, job);
          if (reasonCode === 'codex_runtime_job_cancelled') {
            await terminalize(workerSession, job, {
              terminal_status: 'cancelled',
              reason_code: reasonCode,
            });
          }
        }
        await closeGenerationRunner(runner, 'failed', 'codex_runtime_job_unavailable');
        return;
      }
      const reasonCode = await publicErrorCodeForJobError(error, workerSession, job);
      await closeGenerationRunner(runner, 'failed', reasonCode);
      if (reasonCode !== 'codex_runtime_job_cancelled') {
        const failureSubcode = generationFailureSubcode(error, failureDiagnostic.failure_stage);
        if (failureDiagnostic.failure_subcode === undefined && failureSubcode !== undefined) {
          failureDiagnostic.failure_subcode = failureSubcode;
        }
        await uploadFailureArtifact(workerSession, job, reasonCode, error, failureDiagnostic).catch(() => undefined);
      }
      await terminalize(workerSession, job, {
        terminal_status: reasonCode === 'codex_runtime_job_cancelled' ? 'cancelled' : 'failed',
        reason_code: reasonCode,
      });
    }
  };

  const startGenerationRunner = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id' | 'launch_lease_id'>,
    item: RuntimeJobPollItem,
    workload: CodexGenerationWorkloadV1,
    accepted: {
      sessionDigest: string;
      publicKeyId: string;
      epoch: number;
      privateKeyHandle: CodexWorkerSessionKeyPair['privateKeyHandle'];
    },
  ): Promise<GenerationRunner> => {
    const claimed = await options.controlPlaneClient.claimLaunchTokenEnvelope?.(options.workerId, job.id, {
      ...workerProof(workerSession),
      envelope_id: item.envelope?.id,
      claim_request_id: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'claim' }),
      accepted_worker_session_digest: accepted.sessionDigest,
      accepted_session_public_key_id: accepted.publicKeyId,
      accepted_session_epoch: accepted.epoch,
    });
    const envelope = requiredEnvelope(claimed);
    const launchToken = await decryptCodexLaunchTokenEnvelope({
      envelope,
      privateKeyHandle: accepted.privateKeyHandle,
    });
    if (options.controlPlaneClient.materializeRuntimeJob === undefined) {
      throw new Error('codex_control_plane_method_missing:materializeRuntimeJob');
    }
    await throwIfCancelled(workerSession, job);
    const materialization = await options.controlPlaneClient.materializeRuntimeJob(options.workerId, job.id, {
      ...workerProof(workerSession),
      launch_lease_id: job.launch_lease_id,
      launch_token: launchToken,
      materialization_request_id: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'materialize' }),
      accepted_worker_session_digest: accepted.sessionDigest,
      accepted_session_public_key_id: accepted.publicKeyId,
      accepted_session_epoch: accepted.epoch,
    });
    await throwIfCancelled(workerSession, job);
    const appServerSession = await options.launcher.startFromMaterialization(materialization, {
      workerSessionToken: workerSession.token,
      terminalizeLaunchLeaseOnClose: false,
      ...launcherCapsuleRestoreOptions(workload, materialization),
    });
    await throwIfCancelled(workerSession, job);
    if (options.controlPlaneClient.startRuntimeJob === undefined) {
      throw new Error('codex_control_plane_method_missing:startRuntimeJob');
    }
    const runtimeEvidenceDigest = codexCanonicalDigest(appServerSession.publicEvidence);
    const launchMaterializationDigest = launchMaterializationDigestFor(materialization);
    await options.controlPlaneClient.startRuntimeJob(options.workerId, job.id, {
      ...workerProof(workerSession),
      start_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'start' }),
      runtime_evidence_digest: runtimeEvidenceDigest,
      launch_materialization_digest: launchMaterializationDigest,
    });
    await appendAppServerStartedEvent(workerSession, job, runtimeEvidenceDigest);
    return {
      runnerRuntimeJobId: job.id,
      runnerLaunchLeaseId: job.launch_lease_id,
      appServerSession,
      materialization,
      runtimeEvidenceDigest,
      launchMaterializationDigest,
    };
  };

  const attachGenerationRunner = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id' | 'launch_lease_id'>,
    workload: CodexGenerationWorkloadV1,
  ): Promise<GenerationRunner> => {
    const context = validateCodexSessionRuntimeContext(workload.codex_session_runtime_context);
    if (context.continuation.kind !== 'resume_thread') {
      throw new Error('codex_generation_workload_unsupported');
    }
    const runner = generationRunners.get(context.codex_session_id);
    if (
      runner === undefined ||
      runner.runnerRuntimeJobId !== context.runner_runtime_job_id ||
      runner.runnerLaunchLeaseId !== context.runner_launch_lease_id
    ) {
      throw new Error('codex_session_runner_unavailable');
    }
    if (options.controlPlaneClient.attachCodexSessionRunnerRuntimeJob === undefined) {
      throw new Error('codex_control_plane_method_missing:attachCodexSessionRunnerRuntimeJob');
    }
    await throwIfCancelled(workerSession, job);
    await options.controlPlaneClient.attachCodexSessionRunnerRuntimeJob(options.workerId, job.id, {
      ...workerProof(workerSession),
      session_id: context.codex_session_id,
      runner_launch_lease_id: runner.runnerLaunchLeaseId,
      runner_runtime_job_id: runner.runnerRuntimeJobId,
      runner_expires_at: runnerExpiresAt(),
      runtime_evidence_digest: runner.runtimeEvidenceDigest,
      launch_materialization_digest: runner.launchMaterializationDigest,
      attach_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'attach_session_runner' }),
    });
    await appendAppServerStartedEvent(workerSession, job, runner.runtimeEvidenceDigest);
    return runner;
  };

  const packageGenerationOutputCapsule = async (
    runner: GenerationRunner,
    workload: CodexGenerationWorkloadV1,
    generationResult: CodexGenerationResult<Record<string, unknown>>,
  ): Promise<GenerationOutputCapsulePackageResult | undefined> => {
    const terminalization = parseCodexSessionTerminalization(workload.codex_session_terminalization);
    if (terminalization === undefined) {
      return undefined;
    }
    if (options.capsuleManager === undefined) {
      throw new Error('codex_runtime_capsule_missing');
    }
    const hookInput = runner.appServerSession.capsuleHookInput;
    if (hookInput === undefined) {
      throw new Error('codex_runtime_capsule_missing');
    }
    return options.capsuleManager.package({
      codexHomeHostPath: hookInput.codexHomeHostPath,
      artifactHostPath: hookInput.artifactHostPath,
      codexSessionId: terminalization.codex_session_id,
      codexSessionTurnId: terminalization.codex_session_turn_id,
      ...(terminalization.expected_input_capsule_digest === undefined
        ? {}
        : { expectedInputCapsuleDigest: terminalization.expected_input_capsule_digest }),
      materialization: runner.materialization,
      status: 'succeeded',
      generationResult,
      runtimeEvidence: runner.appServerSession.publicEvidence,
    });
  };

  const launcherCapsuleRestoreOptions = (
    workload: CodexGenerationWorkloadV1,
    materialization: CodexLaunchMaterialization,
  ): Parameters<RemoteLauncher['startFromMaterialization']>[1] => {
    const terminalization = parseCodexSessionTerminalization(workload.codex_session_terminalization);
    if (terminalization === undefined) {
      return {};
    }
    const context = validateCodexSessionRuntimeContext(workload.codex_session_runtime_context);
    if (context.continuation.kind === 'resume_thread' && terminalization.input_capsule_id === undefined) {
      throw new Error('codex_runtime_capsule_missing');
    }
    if (terminalization.input_capsule_id === undefined) {
      if (terminalization.base_memory_bundle_ref === undefined || terminalization.base_memory_bundle_digest === undefined) {
        throw new Error('codex_memory_bundle_missing');
      }
      return {};
    }
    if (options.capsuleManager === undefined) {
      throw new Error('codex_runtime_capsule_missing');
    }
    const required = requiredCapsuleRestoreTerminalization(terminalization);
    return {
      writeConfigAndAuth: false,
      beforeAppServerStart: async ({ codexHomeHostPath, artifactHostPath }) => {
        await options.capsuleManager!.restore({
          codexHomeHostPath,
          codexSessionId: required.codex_session_id,
          codexSessionTurnId: required.codex_session_turn_id,
          inputCapsuleId: required.input_capsule_id,
          inputCapsuleDigest: required.input_capsule_digest,
          inputCapsuleRef: required.input_capsule_ref,
          inputMemoryBundleRef: required.input_memory_bundle_ref,
          inputMemoryBundleDigest: required.input_memory_bundle_digest,
          inputEnvironmentManifestRef: required.input_environment_manifest_ref,
          inputEnvironmentManifestDigest: required.input_environment_manifest_digest,
          materialization,
        });
        await writeCodexHomeConfigAndAuth({
          codexHomeHostPath,
          codexConfigToml: materialization.profile_revision.codex_config_toml,
          authJson: materialization.resolved_credentials[0]?.payload ?? {},
        });
        void artifactHostPath;
      },
    };
  };

  const appendAppServerStartedEvent = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    runtimeEvidenceDigest: string,
  ): Promise<void> => {
    await options.controlPlaneClient.appendRuntimeJobEvent?.(options.workerId, job.id, {
      ...workerProof(workerSession),
      event_id: codexCanonicalDigest({ runtime_job_id: job.id, event: 'app_server_started' }),
      event_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'event', event: 'app_server_started' }),
      event_type: 'app_server_started',
      event_payload_json: { runtime_evidence_digest: runtimeEvidenceDigest },
      event_payload_digest: codexCanonicalDigest({ runtime_evidence_digest: runtimeEvidenceDigest }),
    });
  };

  const processRunExecutionJob = async (item: RuntimeJobPollItem, workerSession: WorkerSession): Promise<void> => {
    const job = item.runtime_job;
    const sessionDigest = codexCredentialPayloadDigest(workerSession.token);
    const publicKeyId = workerSession.keyPair.keyId;
    await options.controlPlaneClient.acceptRuntimeJob(options.workerId, job.id, {
      ...workerProof(workerSession),
      accept_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'accept' }),
      accepted_worker_session_digest: sessionDigest,
      accepted_session_public_key_id: publicKeyId,
      accepted_session_epoch: workerSession.epoch,
    });

    const control = await getControl(workerSession, job);
    if (control.cancel_requested === true) {
      await terminalize(workerSession, job, {
        terminal_status: 'cancelled',
        reason_code: 'codex_runtime_job_cancelled',
      });
      return;
    }

    let appServerSession: Awaited<ReturnType<RemoteLauncher['startFromMaterialization']>> | undefined;
    let driver: CodexSessionDriver | undefined;
    let successTerminalAttempted = false;
    let workspace: WorkspaceBundleUnpackResult | undefined;
    const failureDiagnostic: RuntimeFailureDiagnostic = {
      runtime_target_kind: 'run_execution',
      app_server_started: false,
      failure_stage: 'launch_materialization',
    };
    try {
      const claimed = await options.controlPlaneClient.claimLaunchTokenEnvelope?.(options.workerId, job.id, {
        ...workerProof(workerSession),
        envelope_id: item.envelope?.id,
        claim_request_id: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'claim' }),
        accepted_worker_session_digest: sessionDigest,
        accepted_session_public_key_id: publicKeyId,
        accepted_session_epoch: workerSession.epoch,
      });
      const envelope = requiredEnvelope(claimed);
      const launchToken = await decryptCodexLaunchTokenEnvelope({
        envelope,
        privateKeyHandle: workerSession.keyPair.privateKeyHandle,
      });
      const workloadResponse = requiredRunExecutionWorkload(
        await options.controlPlaneClient.fetchRuntimeJobWorkload?.(options.workerId, job.id, workerProof(workerSession)),
      );
      const acquisition = requiredWorkspaceBundleAcquisition(job, workloadResponse.workload);
      failureDiagnostic.failure_stage = 'workspace_bundle_acquisition';
      workspace = await acquireRunExecutionWorkspaceBundle(workerSession, job, workloadResponse.workload, acquisition);
      const workloadPayload = await resolveRunExecutionWorkloadPayload(workloadResponse, workspace);
      if (options.controlPlaneClient.materializeRuntimeJob === undefined) {
        throw new Error('codex_control_plane_method_missing:materializeRuntimeJob');
      }
      await throwIfCancelled(workerSession, job);
      failureDiagnostic.failure_stage = 'launch_materialization';
      const materialization = await options.controlPlaneClient.materializeRuntimeJob(options.workerId, job.id, {
        ...workerProof(workerSession),
        launch_lease_id: job.launch_lease_id,
        launch_token: launchToken,
        materialization_request_id: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'materialize' }),
        accepted_worker_session_digest: sessionDigest,
        accepted_session_public_key_id: publicKeyId,
        accepted_session_epoch: workerSession.epoch,
      });
      await throwIfCancelled(workerSession, job);
      failureDiagnostic.failure_stage = 'docker_app_server_startup';
      appServerSession = await options.launcher.startFromMaterialization(materialization, {
        workerSessionToken: workerSession.token,
        terminalizeLaunchLeaseOnClose: false,
        originalWorkspacePath: workspace.workspacePath,
        taskWorkspaceDigest: workspace.mounted_workspace_digest,
        taskWorkspaceRoot: workspace.jobRoot,
      });
      await throwIfCancelled(workerSession, job);
      if (options.controlPlaneClient.startRuntimeJob === undefined) {
        throw new Error('codex_control_plane_method_missing:startRuntimeJob');
      }
      failureDiagnostic.app_server_started = true;
      failureDiagnostic.runtime_evidence_digest = codexCanonicalDigest(appServerSession.publicEvidence);
      failureDiagnostic.failure_stage = 'runtime_job_start';
      await options.controlPlaneClient.startRuntimeJob(options.workerId, job.id, {
        ...workerProof(workerSession),
        start_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'start' }),
        runtime_evidence_digest: failureDiagnostic.runtime_evidence_digest,
        launch_materialization_digest: codexCanonicalDigest({
          lease_id: materialization.lease_id,
          expires_at: materialization.expires_at,
          materialized_at: materialization.materialized_at,
        }),
      });
      failureDiagnostic.failure_stage = 'app_server_started_event';
      await options.controlPlaneClient.appendRuntimeJobEvent?.(options.workerId, job.id, {
        ...workerProof(workerSession),
        event_id: codexCanonicalDigest({ runtime_job_id: job.id, event: 'app_server_started' }),
        event_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'event', event: 'app_server_started' }),
        event_type: 'app_server_started',
        event_payload_json: { runtime_evidence_digest: failureDiagnostic.runtime_evidence_digest },
        event_payload_digest: codexCanonicalDigest({ runtime_evidence_digest: failureDiagnostic.runtime_evidence_digest }),
      });

      driver =
        options.runExecutionDriverFactory?.({
          workload: workloadResponse.workload,
          packagePrompt: workloadPayload.packagePrompt,
          executionContext: workloadPayload.executionContext,
          materialization,
          dockerSession: appServerSession,
          workspacePath: workspace.workspacePath,
        }) ??
        createMaterializedRunSessionCodexDriver(
          { workerIdentity: options.workerIdentity },
          { dockerSession: appServerSession },
        );
      failureDiagnostic.failure_stage = 'run_execution_driver_terminal';
      const terminal = await runRunExecutionWithControl(workerSession, job, driver, {
        runSpec: runSpecWithPackagePrompt(workloadPayload.runSpec, workloadPayload.packagePrompt),
        workspacePath: appServerSession.containerWorkspacePath ?? workspace.workspacePath,
        runtimeMetadata: {
          durability_mode: 'durable',
          recovery_attempt_count: 0,
          effective_dangerous_mode: 'confirmed',
          worker_id: options.workerId,
          driver_kind: 'app_server',
          driver_status: 'active',
          app_server_attempted: true,
          selected_execution_mode: 'app_server',
          runtime_profile_id: appServerSession.publicEvidence.runtime_profile_id,
          runtime_profile_revision_id: appServerSession.publicEvidence.runtime_profile_revision_id,
          runtime_profile_digest: appServerSession.publicEvidence.runtime_profile_digest,
          runtime_target_kind: 'run_execution',
          source_access_mode: 'path_policy_scoped',
          environment: appServerSession.publicEvidence.environment,
          launch_lease_id: appServerSession.publicEvidence.launch_lease_id,
          docker_image_digest: appServerSession.publicEvidence.docker_image_digest,
          container_id_digest: appServerSession.publicEvidence.container_id_digest,
          app_server_effective_config_digest: appServerSession.publicEvidence.app_server_effective_config_digest,
          docker_policy_self_check_digest: appServerSession.publicEvidence.docker_policy_self_check_digest,
        },
      });
      if (terminal.status !== 'succeeded') {
        failureDiagnostic.failure_subcode = runExecutionTerminalFailureSubcode(terminal);
        throw new Error(terminal.status === 'cancelled' ? 'codex_runtime_job_cancelled' : 'codex_app_server_unavailable');
      }
      failureDiagnostic.failure_stage = 'run_execution_result_collection';
      const resultDraft = await collectRunExecutionResult({
        workload: workloadResponse.workload,
        packagePrompt: workloadPayload.packagePrompt,
        executionContext: workloadPayload.executionContext,
        runSpec: runSpecWithPackagePrompt(workloadPayload.runSpec, workloadPayload.packagePrompt),
        workspacePath: workspace.workspacePath,
        terminal,
        materialization,
      }, workspace);
      const terminalResult = await runExecutionRuntimeJobTerminalResult(
        workerSession,
        job,
        workloadResponse.workload,
        workspace,
        resultDraft,
        appServerSession.publicEvidence,
      );
      validateCodexRuntimeJobTerminalResult(terminalResult as unknown as Record<string, unknown>);
      await driver.close?.();
      driver = undefined;
      successTerminalAttempted = true;
      await terminalizeWithRetry(workerSession, job, {
        terminal_status: 'succeeded',
        reason_code: 'codex_runtime_job_succeeded',
        terminal_result_json: terminalResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      if (successTerminalAttempted) {
        if (publicErrorCode(error) === 'codex_runtime_job_success_terminal_unconfirmed') {
          const reasonCode = await publicErrorCodeForJobError(error, workerSession, job);
          if (reasonCode === 'codex_runtime_job_cancelled') {
            await terminalize(workerSession, job, {
              terminal_status: 'cancelled',
              reason_code: reasonCode,
            });
          }
        }
        await driver?.close?.().catch(() => undefined);
        await appServerSession?.close('failed', 'codex_runtime_job_unavailable').catch(() => undefined);
        await cleanupRunExecutionWorkspace(workspace).catch(() => undefined);
        return;
      }
      const reasonCode = await publicErrorCodeForJobError(error, workerSession, job);
      if (
        failureDiagnostic.failure_stage === 'run_execution_driver_terminal' &&
        error instanceof Error &&
        error.message.startsWith('codex_control_plane_request_failed:')
      ) {
        failureDiagnostic.failure_stage = 'run_execution_control_poll';
      }
      const failureSubcode = runExecutionFailureSubcode(error, failureDiagnostic.failure_stage);
      if (failureDiagnostic.failure_subcode === undefined && failureSubcode !== undefined) {
        failureDiagnostic.failure_subcode = failureSubcode;
      }
      await driver?.close?.().catch(() => undefined);
      await appServerSession?.close('failed', reasonCode).catch(() => undefined);
      if (reasonCode !== 'codex_runtime_job_cancelled') {
        await uploadFailureArtifact(workerSession, job, reasonCode, error, failureDiagnostic).catch(() => undefined);
      }
      await terminalize(workerSession, job, {
        terminal_status: reasonCode === 'codex_runtime_job_cancelled' ? 'cancelled' : 'failed',
        reason_code: reasonCode,
      });
    } finally {
      await cleanupRunExecutionWorkspace(workspace).catch(() => undefined);
    }
  };

  const acquireRunExecutionWorkspaceBundle = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    workload: CodexRunExecutionWorkloadV1,
    acquisition: WorkspaceBundleAcquisition,
  ): Promise<WorkspaceBundleUnpackResult> => {
    if (options.controlPlaneClient.downloadWorkspaceBundle === undefined) {
      throw new Error('codex_control_plane_method_missing:downloadWorkspaceBundle');
    }
    const downloaded = await options.controlPlaneClient.downloadWorkspaceBundle(options.workerId, job.id, workload.workspace_bundle_id, {
      ...workerProof(workerSession),
      tempRoot: options.workerTempRoot,
      expectedArchiveDigest: workload.workspace_bundle_digest,
      maxSizeBytes: acquisition.size_bytes,
    });
    if (downloaded.archive_digest !== workload.workspace_bundle_digest) {
      throw new Error('codex_workspace_bundle_invalid');
    }
    const archiveBytes = await readFile(downloaded.archive_path);
    return safeUnpackWorkspaceBundle({
      archiveBytes,
      expectedArchiveDigest: workload.workspace_bundle_digest,
      expectedManifestDigest: acquisition.manifest_digest,
      tempRoot: options.workerTempRoot,
      runtimeJobId: job.id,
    });
  };

  const resolveRunExecutionWorkloadPayload = async (
    fetched: FetchedRunExecutionWorkload,
    workspace: WorkspaceBundleUnpackResult,
  ): Promise<Required<FetchedRunExecutionWorkload>> => {
    if (fetched.packagePrompt !== undefined && fetched.executionContext !== undefined && fetched.runSpec !== undefined) {
      return {
        workload: fetched.workload,
        packagePrompt: fetched.packagePrompt,
        executionContext: fetched.executionContext,
        runSpec: fetched.runSpec,
      };
    }
    const packagePrompt = await readFile(join(workspace.workspacePath, remoteRunExecutionPromptPath), 'utf8').catch(() => {
      throw new Error('codex_runtime_job_unavailable');
    });
    const executionContext = await readFile(join(workspace.workspacePath, remoteRunExecutionContextPath), 'utf8')
      .then((content) => JSON.parse(content) as unknown)
      .catch(() => {
        throw new Error('codex_runtime_job_unavailable');
      });
    return validateRunExecutionWorkloadPayload(fetched.workload, packagePrompt, executionContext);
  };

  const collectRunExecutionResult = async (
    input: {
      workload: CodexRunExecutionWorkloadV1;
      packagePrompt: string;
      executionContext: Record<string, unknown>;
      runSpec: CodexDriverStartInput['runSpec'];
      workspacePath: string;
      terminal: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
      materialization: CodexLaunchMaterialization;
    },
    workspace: WorkspaceBundleUnpackResult,
  ): Promise<RunExecutionResultDraft> => {
    return (
      (await options.runExecutionResultCollector?.(input)) ?? (await defaultRunExecutionResultCollector(input, workspace))
    );
  };

  const runExecutionRuntimeJobTerminalResult = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    workload: CodexRunExecutionWorkloadV1,
    workspace: WorkspaceBundleUnpackResult,
    draft: RunExecutionResultDraft,
    runtimeEvidence: CodexDockerRuntimeEvidence,
  ): Promise<CodexRunExecutionRuntimeJobResult> => {
    const changedFiles =
      draft.patch === undefined
        ? collectWorkspaceBundleChangedFiles({
            changedFiles: draft.changed_files,
            allowedPaths: workspace.manifest.allowed_paths,
            forbiddenPaths: workspace.manifest.forbidden_paths,
          })
        : createWorkspaceBundlePatchArtifact({
            patch: draft.patch,
            changedFiles: draft.changed_files,
            allowedPaths: workspace.manifest.allowed_paths,
            forbiddenPaths: workspace.manifest.forbidden_paths,
          }).changed_files;
    let patchArtifact:
      | {
          content_type: 'text/x-diff';
          digest: string;
          internal_ref: string;
        }
      | undefined;
    if (draft.patch !== undefined) {
      if (options.controlPlaneClient.uploadRuntimeJobArtifact === undefined) {
        throw new Error('codex_control_plane_method_missing:uploadRuntimeJobArtifact');
      }
      const localPatch = createWorkspaceBundlePatchArtifact({
        patch: draft.patch,
        changedFiles: draft.changed_files,
        allowedPaths: workspace.manifest.allowed_paths,
        forbiddenPaths: workspace.manifest.forbidden_paths,
      });
      const upload = {
        artifact_idempotency_key: codexCanonicalDigest({
          runtime_job_id: job.id,
          kind: 'run_execution_patch',
          digest: localPatch.digest,
        }),
        kind: 'run_execution_patch',
        name: 'run-execution.patch',
        content_type: localPatch.content_type,
        digest: localPatch.digest,
        size_bytes: localPatch.size_bytes,
        bytes: localPatch.bytes,
        metadata_json: {
          changed_files: localPatch.changed_files,
        },
      } satisfies RuntimeJobArtifactUploadInput;
      const response = await options.controlPlaneClient.uploadRuntimeJobArtifact(options.workerId, job.id, {
        ...workerProof(workerSession),
        ...upload,
      });
      const artifact = isRecord(response) && isRecord(response.artifact) ? response.artifact : localPatch;
      patchArtifact = {
        content_type: 'text/x-diff',
        digest: requiredString(artifact, 'digest'),
        internal_ref: requiredString(artifact, 'internal_ref'),
      };
    }
    const terminalResult: CodexRunExecutionRuntimeJobResult = {
      task_kind: 'run_execution',
      output_schema_version: 'codex_run_execution_result.v1',
      execution_package_id: workload.execution_package_id,
      execution_package_version: workload.execution_package_version,
      run_session_id: workload.run_session_id,
      workspace_bundle_digest: workload.workspace_bundle_digest,
      workspace_bundle_manifest_digest: workspace.manifest_digest,
      mounted_task_workspace_digest: workspace.mounted_workspace_digest,
      changed_files: changedFiles,
      ...(patchArtifact === undefined ? {} : { patch_artifact: patchArtifact }),
      check_results: draft.check_results,
      execution_artifacts: draft.execution_artifacts,
      runtime_evidence: runtimeEvidence,
      public_summary: draft.public_summary,
    };
    validateCodexRuntimeJobTerminalResult(terminalResult as unknown as Record<string, unknown>);
    return terminalResult;
  };

  const runRunExecutionWithControl = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    driver: CodexSessionDriver,
    input: CodexDriverStartInput,
  ): Promise<Extract<CodexDriverStreamItem, { kind: 'terminal' }>> => {
    let completed = false;
    let stopWaiting: (() => void) | undefined;
    let cancellationDetected = false;
    let controlFailed = false;
    const runPromise = (async () => {
      for await (const item of driver.startRun(input)) {
        if (item.kind === 'terminal') {
          return item;
        }
      }
      throw new Error('codex_app_server_unavailable');
    })();
    const watchControl = async (): Promise<never> => {
      while (!completed) {
        await Promise.race([
          sleep(options.controlPollIntervalMs ?? 2_000),
          new Promise<void>((resolve) => {
            stopWaiting = resolve;
          }),
        ]);
        if (completed) {
          break;
        }
        await appendWorkerHeartbeat(workerSession, job);
        await heartbeat(workerSession);
        const control = await getControl(workerSession, job);
        if (control.cancel_requested === true || control.shutdown_requested === true) {
          cancellationDetected = true;
          await driver.cancelRun({ runtimeMetadata: input.runtimeMetadata! }).catch(() => undefined);
          throw new Error('codex_runtime_job_cancelled');
        }
      }
      return new Promise<never>(() => undefined);
    };
    const controlPromise = watchControl().catch((error: unknown) => {
      controlFailed = true;
      throw error;
    });
    try {
      return await Promise.race([runPromise, controlPromise]);
    } catch (error) {
      if (controlFailed) {
        await driver.cancelRun({ runtimeMetadata: input.runtimeMetadata! }).catch(() => undefined);
        await driver.close?.().catch(() => undefined);
        if (cancellationDetected || publicErrorCode(error) === 'codex_runtime_job_cancelled') {
          throw new Error('codex_runtime_job_cancelled');
        }
        throw error;
      }
      if (cancellationDetected || publicErrorCode(error) === 'codex_runtime_job_cancelled') {
        await driver.cancelRun({ runtimeMetadata: input.runtimeMetadata! }).catch(() => undefined);
        await driver.close?.().catch(() => undefined);
        throw new Error('codex_runtime_job_cancelled');
      }
      throw error;
    } finally {
      completed = true;
      stopWaiting?.();
      controlPromise.catch(() => undefined);
    }
  };

  const closeAfterGeneration = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    runner: GenerationRunner,
    workload: CodexGenerationWorkloadV1,
  ): Promise<void> => {
    const context =
      workload.codex_session_runtime_context === undefined
        ? undefined
        : validateCodexSessionRuntimeContext(workload.codex_session_runtime_context);
    if (context?.turn_group_status === 'intermediate') {
      if (context.continuation.kind === 'start_thread') {
        if (options.controlPlaneClient.markCodexSessionRunnerOwner === undefined) {
          throw new Error('codex_control_plane_method_missing:markCodexSessionRunnerOwner');
        }
        runner.sessionId = context.codex_session_id;
        await options.controlPlaneClient.markCodexSessionRunnerOwner(options.workerId, job.id, {
          ...workerProof(workerSession),
          session_id: context.codex_session_id,
          runner_launch_lease_id: runner.runnerLaunchLeaseId,
          runner_runtime_job_id: runner.runnerRuntimeJobId,
          runner_expires_at: runnerExpiresAt(),
        });
      }
      if (context !== undefined) {
        generationRunners.set(context.codex_session_id, runner);
        return;
      }
    }
    const closed = await closeGenerationRunner(runner, 'succeeded', 'generation complete');
    if (!closed) {
      await uploadCleanupFailureArtifact(workerSession, job).catch(() => undefined);
    }
  };

  const closeGenerationRunner = async (
    runner: GenerationRunner | undefined,
    status: 'succeeded' | 'failed',
    reason: string,
  ): Promise<boolean> => {
    if (runner === undefined) {
      return true;
    }
    if (runner.sessionId !== undefined && generationRunners.get(runner.sessionId) === runner) {
      generationRunners.delete(runner.sessionId);
    }
    try {
      await runner.appServerSession.close(status, reason);
      return true;
    } catch {
      return false;
    }
  };

  const runnerExpiresAt = (): string => new Date(Date.parse(now()) + 10 * 60_000).toISOString();

  const launchMaterializationDigestFor = (materialization: Pick<CodexLaunchMaterialization, 'lease_id' | 'expires_at' | 'materialized_at'>): string =>
    codexCanonicalDigest({
      lease_id: materialization.lease_id,
      expires_at: materialization.expires_at,
      materialized_at: materialization.materialized_at,
    });

  const throwIfCancelled = async (workerSession: WorkerSession, job: Pick<CodexRuntimeJob, 'id'>): Promise<void> => {
    const control = await getControl(workerSession, job);
    if (control.cancel_requested === true || control.shutdown_requested === true) {
      throw new Error('codex_runtime_job_cancelled');
    }
  };

  const publicErrorCodeForJobError = async (
    error: unknown,
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
  ): Promise<string> => {
    const code = publicErrorCode(error);
    if (code === 'codex_runtime_job_cancelled') {
      return code;
    }
    try {
      const control = await getControl(workerSession, job);
      if (control.cancel_requested === true || control.shutdown_requested === true) {
        return 'codex_runtime_job_cancelled';
      }
    } catch {
      // Preserve the original public-safe error when cancellation cannot be confirmed.
    }
    return code;
  };

  const getControl = async (workerSession: WorkerSession, job: Pick<CodexRuntimeJob, 'id'>): Promise<Record<string, unknown>> => {
    const response = await options.controlPlaneClient.getRuntimeJobControl(options.workerId, job.id, workerProof(workerSession));
    return isRecord(response) && isRecord(response.control) ? response.control : {};
  };

  const terminalize = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id' | 'launch_lease_id'>,
    input: {
      terminal_status: 'succeeded' | 'failed' | 'cancelled' | 'expired';
      reason_code: string;
      terminal_result_json?: Record<string, unknown>;
    },
  ): Promise<void> => {
    await terminalizeWithProof(workerSession, job, input, workerProof(workerSession));
  };

  const terminalizeWithRetry = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id' | 'launch_lease_id'>,
    input: {
      terminal_status: 'succeeded' | 'failed' | 'cancelled' | 'expired';
      reason_code: string;
      terminal_result_json?: Record<string, unknown>;
    },
  ): Promise<void> => {
    const proof = workerProof(workerSession);
    try {
      await terminalizeWithProof(workerSession, job, input, proof);
    } catch (error) {
      await terminalizeWithProof(workerSession, job, input, proof).catch(() => {
        if (input.terminal_status === 'succeeded') {
          throw new Error('codex_runtime_job_success_terminal_unconfirmed');
        }
        throw error;
      });
    }
  };

  const terminalizeWithProof = async (
    _workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id' | 'launch_lease_id'>,
    input: {
      terminal_status: 'succeeded' | 'failed' | 'cancelled' | 'expired';
      reason_code: string;
      terminal_result_json?: Record<string, unknown>;
    },
    proof: Record<string, unknown>,
  ): Promise<void> => {
    await options.controlPlaneClient.terminalizeRuntimeJob(options.workerId, job.id, {
      ...proof,
      launch_lease_id: job.launch_lease_id,
      terminal_status: input.terminal_status,
      reason_code: input.reason_code,
      ...(input.terminal_result_json === undefined ? {} : { terminal_result_json: input.terminal_result_json }),
      terminal_idempotency_key: codexCanonicalDigest({
        runtime_job_id: job.id,
        terminal_status: input.terminal_status,
        reason_code: input.reason_code,
      }),
    });
  };

  const uploadGenerationArtifacts = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    result: CodexGenerationResult<Record<string, unknown>>,
  ) => {
    const uploads = [
      jsonRuntimeJobArtifactUpload({
        kind: 'generated_payload',
        name: 'generated-payload.json',
        payload: result.generated,
        metadata: {
          task_kind: result.taskKind,
          output_schema_version: result.outputSchemaVersion,
          generated_payload_digest: codexCanonicalDigest(result.generated),
        },
      }),
      jsonRuntimeJobArtifactUpload({
        kind: 'generation_validation_report',
        name: 'generation-validation-report.json',
        payload: {
          task_kind: result.taskKind,
          generated_payload_digest: codexCanonicalDigest(result.generated),
          output_schema_version: result.outputSchemaVersion,
        },
      }),
    ];
    const uploaded = [];
    for (const upload of uploads) {
      const response = await options.controlPlaneClient.uploadRuntimeJobArtifact?.(options.workerId, job.id, {
        ...workerProof(workerSession),
        ...upload,
      });
      const artifact: Record<string, unknown> = isRecord(response) && isRecord(response.artifact) ? response.artifact : { ...upload };
      uploaded.push({
        kind: requiredString(artifact, 'kind'),
        name: requiredString(artifact, 'name'),
        content_type: requiredString(artifact, 'content_type'),
        digest: requiredString(artifact, 'digest'),
        ...(typeof artifact.internal_ref === 'string' ? { internal_ref: artifact.internal_ref } : {}),
      });
    }
    return uploaded;
  };

  const uploadFailureArtifact = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    reasonCode: string,
    error?: unknown,
    diagnostic: RuntimeFailureDiagnostic = {},
  ): Promise<void> => {
    if (options.controlPlaneClient.uploadRuntimeJobArtifact === undefined) {
      return;
    }
    const failureSubcode = diagnostic.failure_subcode ?? workspaceBundleInvalidSubcode(error);
    const publicSummary =
      reasonCode === 'codex_workspace_bundle_invalid'
        ? 'Remote Codex workspace bundle validation failed.'
        : 'Remote Codex app-server startup or generation failed.';
    const metadata = {
      reason_code: reasonCode,
      ...(diagnostic.runtime_target_kind === undefined ? {} : { runtime_target_kind: diagnostic.runtime_target_kind }),
      ...(diagnostic.app_server_started === undefined ? {} : { app_server_started: diagnostic.app_server_started }),
      ...(diagnostic.failure_stage === undefined ? {} : { failure_stage: diagnostic.failure_stage }),
      ...(failureSubcode === undefined ? {} : { failure_subcode: failureSubcode }),
      ...(diagnostic.runtime_evidence_digest === undefined ? {} : { runtime_evidence_digest: diagnostic.runtime_evidence_digest }),
      ...(diagnostic.generation_output_schema_sent === undefined
        ? {}
        : { generation_output_schema_sent: diagnostic.generation_output_schema_sent }),
      ...(diagnostic.generation_context_operation === undefined
        ? {}
        : { generation_context_operation: diagnostic.generation_context_operation }),
      public_summary: publicSummary,
    };
    await options.controlPlaneClient.uploadRuntimeJobArtifact(options.workerId, job.id, {
      ...workerProof(workerSession),
      ...jsonRuntimeJobArtifactUpload({
        kind: 'startup_failure_evidence',
        name: 'startup-failure-evidence.json',
        payload: metadata,
        metadata,
      }),
    });
  };

  const uploadCleanupFailureArtifact = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
  ): Promise<void> => {
    if (options.controlPlaneClient.uploadRuntimeJobArtifact === undefined) {
      return;
    }
    await options.controlPlaneClient.uploadRuntimeJobArtifact(options.workerId, job.id, {
      ...workerProof(workerSession),
      ...jsonRuntimeJobArtifactUpload({
        kind: 'cleanup_failure_evidence',
        name: 'cleanup-failure-evidence.json',
        payload: {
          reason_code: 'codex_runtime_cleanup_failed',
          public_summary: 'Remote Codex app-server cleanup failed after generation.',
        },
      }),
    });
  };

  const runGenerationWithControl = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    operation: (signal: AbortSignal) => Promise<CodexGenerationResult<Record<string, unknown>>>,
  ): Promise<CodexGenerationResult<Record<string, unknown>>> => {
    let completed = false;
    let stopWaiting: (() => void) | undefined;
    let cancellationDetected = false;
    let controlFailed = false;
    const abortController = new AbortController();
    const generationPromise = operation(abortController.signal);
    const watchControl = async (): Promise<never> => {
      while (!completed) {
        await Promise.race([
          sleep(options.controlPollIntervalMs ?? 2_000),
          new Promise<void>((resolve) => {
            stopWaiting = resolve;
          }),
        ]);
        if (completed) {
          break;
        }
        await appendWorkerHeartbeat(workerSession, job);
        await heartbeat(workerSession);
        const control = await getControl(workerSession, job);
        if (control.cancel_requested === true || control.shutdown_requested === true) {
          cancellationDetected = true;
          abortController.abort();
          throw new Error('codex_runtime_job_cancelled');
        }
      }
      return new Promise<never>(() => undefined);
    };
    const controlPromise = watchControl().catch((error: unknown) => {
      controlFailed = true;
      throw error;
    });
    try {
      return await Promise.race([generationPromise, controlPromise]);
    } catch (error) {
      if (controlFailed) {
        abortController.abort();
        await generationPromise.catch(() => undefined);
        if (cancellationDetected || publicErrorCode(error) === 'codex_runtime_job_cancelled') {
          throw new Error('codex_runtime_job_cancelled');
        }
        throw error;
      }
      if (cancellationDetected || publicErrorCode(error) === 'codex_runtime_job_cancelled') {
        abortController.abort();
        await generationPromise.catch(() => undefined);
        throw new Error('codex_runtime_job_cancelled');
      }
      throw error;
    } finally {
      completed = true;
      stopWaiting?.();
      controlPromise.catch(() => undefined);
    }
  };

  const appendWorkerHeartbeat = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
  ): Promise<void> => {
    const heartbeatAt = now();
    const eventId = codexCanonicalDigest({
      runtime_job_id: job.id,
      event: 'runtime_job_worker_heartbeat',
      heartbeat_at: heartbeatAt,
      nonce: nonce(),
    });
    await options.controlPlaneClient.appendRuntimeJobEvent?.(options.workerId, job.id, {
      ...workerProof(workerSession),
      event_id: eventId,
      event_idempotency_key: eventId,
      event_type: 'runtime_job_worker_heartbeat',
      event_payload_json: {
        heartbeat_at: heartbeatAt,
        worker_id: options.workerId,
      },
      event_payload_digest: codexCanonicalDigest({
        heartbeat_at: heartbeatAt,
        worker_id: options.workerId,
      }),
    });
  };

  const runOnce = async (): Promise<{ processed: number }> => {
    const workerSession = await ensureSession();
    await heartbeat(workerSession);
    const polled = await options.controlPlaneClient.pollRuntimeJobs(options.workerId, {
      ...workerProof(workerSession),
      target_kinds: options.capabilities,
      limit: options.maxConcurrency,
      current_runtime_job_ids: [],
    });
    updateWorkerHeartbeatInterval(polled);
    const jobs = isRecord(polled) && Array.isArray(polled.runtime_jobs) ? (polled.runtime_jobs as RuntimeJobPollItem[]) : [];
    for (const job of jobs) {
      await processJob(job, workerSession);
    }
    return { processed: jobs.length };
  };

  return {
    runOnce,
    async runLoop() {
      let iterations = 0;
      let processed = 0;
      while (options.shouldContinue?.() ?? true) {
        const result = await runOnce();
        iterations += 1;
        processed += result.processed;
        if (!(options.shouldContinue?.() ?? true)) {
          break;
        }
        await sleep(options.pollIntervalMs ?? 1_000);
      }
      return { iterations, processed };
    },
  };
};

const runGeneration = async (
  runtime: ReturnType<typeof createCodexGenerationRuntime>,
  workloadResponse: FetchedGenerationWorkload,
  job: Pick<CodexRuntimeJob, 'project_id' | 'repo_id'>,
  materialization: CodexLaunchMaterialization,
  signal: AbortSignal,
): Promise<CodexGenerationResult<Record<string, unknown>>> => {
  const { workload, signedContext } = workloadResponse;
  const contextOperation = generationContextOperation(signedContext);
  const input = {
    actionRunId: workload.action_run_id,
    projectId: job.project_id,
    repoIds: materialization.launch_target.repo_id === undefined ? [] : [materialization.launch_target.repo_id],
    context: signedContext,
    promptVersion: workload.prompt_version,
    outputSchemaVersion: workload.output_schema_version,
    policyDigests: {
      ...(materialization.launch_target.repo_id === undefined
        ? {}
        : { [materialization.launch_target.repo_id]: workload.signed_context_digest }),
      signed_context: workload.signed_context_digest,
      prompt_template: workload.prompt_template_digest,
    },
    ...(workload.codex_session_runtime_context === undefined
      ? {}
      : { codexSessionRuntimeContext: workload.codex_session_runtime_context }),
    signal,
  };
  let result: CodexGenerationResult<Record<string, unknown>>;
  switch (workload.task_kind) {
    case 'spec_draft':
      result = (await runtime.generateSpecDraft(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
      break;
    case 'plan_draft':
      result = (await runtime.generatePlanDraft(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
      break;
    case 'package_drafts':
      result = (await runtime.generatePackageDrafts(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
      break;
    case 'boundary_brainstorming_round':
      result = (await runtime.generateBoundaryBrainstormingRound(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
      break;
    case 'development_plan_item_spec_revision':
      result = (await runtime.generateDevelopmentPlanItemSpecRevision(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
      break;
    case 'development_plan_item_execution_plan_revision':
      result = (await runtime.generateDevelopmentPlanItemExecutionPlanRevision(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
      break;
    default:
      return assertNeverGenerationTaskKind(workload.task_kind);
  }
  return result;
};

const assertNeverGenerationTaskKind = (taskKind: never): never => {
  throw new Error(`codex_generation_task_kind_unsupported:${String(taskKind)}`);
};

type FetchedGenerationWorkload = {
  workload: CodexGenerationWorkloadV1;
  signedContext: Record<string, unknown>;
};

type FetchedRunExecutionWorkload = {
  workload: CodexRunExecutionWorkloadV1;
  packagePrompt?: string;
  executionContext?: Record<string, unknown>;
  runSpec?: CodexDriverStartInput['runSpec'];
};

type WorkspaceBundleAcquisition = {
  bundle_id: string;
  archive_digest: string;
  manifest_digest: string;
  size_bytes: number;
};

const remoteRunExecutionPromptPath = '.forgeloop/codex-runtime/package-prompt.txt';
const remoteRunExecutionContextPath = '.forgeloop/codex-runtime/execution-context.json';

const requiredGenerationWorkload = (response: unknown): FetchedGenerationWorkload => {
  if (!isRecord(response) || !isRecord(response.workload)) {
    throw new Error('codex_runtime_job_unavailable');
  }
  const workload = response.workload;
  if (
    workload.schema_version !== 'codex_generation_workload.v1' ||
    typeof workload.runtime_job_id !== 'string' ||
    typeof workload.action_run_id !== 'string' ||
    typeof workload.task_kind !== 'string'
  ) {
    throw new Error('codex_runtime_job_unavailable');
  }
  if (!codexGenerationTaskKinds.includes(workload.task_kind as (typeof codexGenerationTaskKinds)[number])) {
    throw new Error('codex_generation_workload_unsupported');
  }
  const typedWorkload = workload as unknown as CodexGenerationWorkloadV1;
  const hasSessionRuntimeContext = typedWorkload.codex_session_runtime_context !== undefined;
  const hasSessionTerminalization = typedWorkload.codex_session_terminalization !== undefined;
  if (hasSessionRuntimeContext !== hasSessionTerminalization) {
    throw new Error('codex_generation_workload_unsupported');
  }
  if (hasSessionRuntimeContext) {
    try {
      const context = validateCodexSessionRuntimeContext(typedWorkload.codex_session_runtime_context);
      const terminalization = parseCodexSessionTerminalization(typedWorkload.codex_session_terminalization);
      if (terminalization?.input_capsule_id !== undefined && context.continuation.kind !== 'resume_thread') {
        throw new Error('codex_generation_workload_unsupported');
      }
      if (context.continuation.kind === 'resume_thread' && terminalization?.input_capsule_id === undefined) {
        throw new Error('codex_runtime_capsule_missing');
      }
    } catch (error) {
      if (isRecord(error) && typeof error.code === 'string' && publicRuntimeWorkerErrorCodes.has(error.code)) {
        throw new Error(error.code);
      }
      const message = error instanceof Error ? error.message.split(':', 1)[0]?.trim() : undefined;
      if (message !== undefined && publicRuntimeWorkerErrorCodes.has(message)) {
        throw new Error(message);
      }
      throw new Error('codex_generation_workload_unsupported');
    }
  }
  if (!isRecord(response.signed_context) || codexCanonicalDigest(response.signed_context) !== typedWorkload.signed_context_digest) {
    throw new Error('codex_runtime_job_unavailable');
  }
  return { workload: typedWorkload, signedContext: response.signed_context };
};

const validateCodexSessionTerminalization = (value: unknown): void => {
  parseCodexSessionTerminalization(value);
};

type ParsedCodexSessionTerminalization = {
  schema_version: 'codex_session_terminalization.v1';
  lease_token: string;
  codex_session_id: string;
  codex_session_turn_id: string;
  expected_input_capsule_digest?: string;
  input_capsule_id?: string;
  input_capsule_digest?: string;
  input_capsule_ref?: string;
  base_memory_bundle_ref?: string;
  base_memory_bundle_digest?: string;
  input_memory_bundle_ref?: string;
  input_memory_bundle_digest?: string;
  input_environment_manifest_ref?: string;
  input_environment_manifest_digest?: string;
};

const codexSessionTerminalizationKeys = new Set([
  'schema_version',
  'lease_token',
  'codex_session_id',
  'codex_session_turn_id',
  'expected_input_capsule_digest',
  'input_capsule_id',
  'input_capsule_digest',
  'input_capsule_ref',
  'base_memory_bundle_ref',
  'base_memory_bundle_digest',
  'input_memory_bundle_ref',
  'input_memory_bundle_digest',
  'input_environment_manifest_ref',
  'input_environment_manifest_digest',
]);

const optionalTerminalizationString = (value: Record<string, unknown>, key: string): string | undefined => {
  const item = value[key];
  if (item === undefined) {
    return undefined;
  }
  if (typeof item !== 'string' || item.length === 0) {
    throw new Error('codex_generation_workload_unsupported');
  }
  return item;
};

const spreadTerminalizationString = <K extends keyof ParsedCodexSessionTerminalization>(
  value: string | undefined,
  key: K,
): Pick<ParsedCodexSessionTerminalization, K> | Record<string, never> =>
  value === undefined ? {} : ({ [key]: value } as Pick<ParsedCodexSessionTerminalization, K>);

const parseCodexSessionTerminalization = (value: unknown): ParsedCodexSessionTerminalization | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || value.schema_version !== 'codex_session_terminalization.v1') {
    throw new Error('codex_generation_workload_unsupported');
  }
  for (const key of Object.keys(value)) {
    if (!codexSessionTerminalizationKeys.has(key)) {
      throw new Error('codex_generation_workload_unsupported');
    }
  }
  const leaseToken = optionalTerminalizationString(value, 'lease_token');
  const codexSessionId = optionalTerminalizationString(value, 'codex_session_id');
  const codexSessionTurnId = optionalTerminalizationString(value, 'codex_session_turn_id');
  if (leaseToken === undefined || codexSessionId === undefined || codexSessionTurnId === undefined) {
    throw new Error('codex_generation_workload_unsupported');
  }
  return {
    schema_version: 'codex_session_terminalization.v1',
    lease_token: leaseToken,
    codex_session_id: codexSessionId,
    codex_session_turn_id: codexSessionTurnId,
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'expected_input_capsule_digest'), 'expected_input_capsule_digest'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'input_capsule_id'), 'input_capsule_id'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'input_capsule_digest'), 'input_capsule_digest'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'input_capsule_ref'), 'input_capsule_ref'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'base_memory_bundle_ref'), 'base_memory_bundle_ref'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'base_memory_bundle_digest'), 'base_memory_bundle_digest'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'input_memory_bundle_ref'), 'input_memory_bundle_ref'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'input_memory_bundle_digest'), 'input_memory_bundle_digest'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'input_environment_manifest_ref'), 'input_environment_manifest_ref'),
    ...spreadTerminalizationString(optionalTerminalizationString(value, 'input_environment_manifest_digest'), 'input_environment_manifest_digest'),
  };
};

const requiredCapsuleRestoreTerminalization = (
  value: ParsedCodexSessionTerminalization,
): ParsedCodexSessionTerminalization & {
  input_capsule_id: string;
  input_capsule_digest: string;
  input_capsule_ref: string;
  input_memory_bundle_ref: string;
  input_memory_bundle_digest: string;
  input_environment_manifest_ref: string;
  input_environment_manifest_digest: string;
} => {
  if (value.input_capsule_id === undefined || value.input_capsule_digest === undefined || value.input_capsule_ref === undefined) {
    throw new Error('codex_runtime_capsule_missing');
  }
  if (value.input_memory_bundle_ref === undefined || value.input_memory_bundle_digest === undefined) {
    throw new Error('codex_memory_bundle_missing');
  }
  if (value.input_environment_manifest_ref === undefined || value.input_environment_manifest_digest === undefined) {
    throw new Error('codex_environment_manifest_missing');
  }
  return value as ParsedCodexSessionTerminalization & {
    input_capsule_id: string;
    input_capsule_digest: string;
    input_capsule_ref: string;
    input_memory_bundle_ref: string;
    input_memory_bundle_digest: string;
    input_environment_manifest_ref: string;
    input_environment_manifest_digest: string;
  };
};

const runSpecWithPackagePrompt = (
  runSpec: CodexDriverStartInput['runSpec'],
  packagePrompt: string,
): CodexDriverStartInput['runSpec'] => ({
  ...runSpec,
  objective: packagePrompt,
  context: {
    ...runSpec.context,
    package_instructions: packagePrompt,
  },
});

const cleanupRunExecutionWorkspace = async (workspace: WorkspaceBundleUnpackResult | undefined): Promise<void> => {
  if (workspace === undefined) {
    return;
  }
  await rm(workspace.jobRoot, { recursive: true, force: true });
};

const sha256 = (bytes: Uint8Array | string): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const shouldSkipDefaultCollectorPath = (path: string): boolean =>
  path === '.forgeloop/codex-runtime' ||
  path.startsWith('.forgeloop/codex-runtime/') ||
  path.split('/').some((segment) => segment === '.git' || segment === 'node_modules');

const collectCurrentWorkspaceFiles = async (workspacePath: string, current = ''): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const absolute = current.length === 0 ? workspacePath : join(workspacePath, current);
  const info = await lstat(absolute);
  if (info.isDirectory()) {
    const children = await readdir(absolute);
    for (const child of children.sort()) {
      const childPath = current.length === 0 ? child : `${current}/${child}`;
      if (shouldSkipDefaultCollectorPath(childPath)) {
        continue;
      }
      const nested = await collectCurrentWorkspaceFiles(workspacePath, childPath);
      for (const [path, digest] of nested) {
        result.set(path, digest);
      }
    }
    return result;
  }
  if (info.isFile() && current.length > 0 && !shouldSkipDefaultCollectorPath(current)) {
    result.set(current, sha256(await readFile(absolute)));
    return result;
  }
  if (current.length > 0 && !shouldSkipDefaultCollectorPath(current)) {
    result.set(current, `unsafe-entry:${info.mode}`);
  }
  return result;
};

const defaultRunExecutionResultCollector = async (
  input: {
    terminal: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
  },
  workspace: WorkspaceBundleUnpackResult,
): Promise<RunExecutionResultDraft> => {
  const currentFiles = await collectCurrentWorkspaceFiles(workspace.workspacePath);
  const originalFiles = new Map(
    workspace.manifest.entries
      .filter((entry) => entry.type === 'file' && !shouldSkipDefaultCollectorPath(entry.path))
      .map((entry) => [entry.path, entry.digest]),
  );
  const changedFiles = new Set<string>();
  for (const [path, digest] of originalFiles) {
    if (currentFiles.get(path) !== digest) {
      changedFiles.add(path);
    }
  }
  for (const path of currentFiles.keys()) {
    if (!originalFiles.has(path)) {
      changedFiles.add(path);
    }
  }
  const sortedChangedFiles = [...changedFiles].sort();
  return {
    changed_files: sortedChangedFiles,
    ...(sortedChangedFiles.length === 0
      ? {}
      : {
          patch: sortedChangedFiles.map((path) => `diff --git a/${path} b/${path}\n`).join(''),
        }),
    check_results: [],
    execution_artifacts: [],
    public_summary: input.terminal.summary,
  };
};

const requiredRunExecutionWorkload = (response: unknown): FetchedRunExecutionWorkload => {
  if (!isRecord(response) || !isRecord(response.workload)) {
    throw new Error('codex_runtime_job_unavailable');
  }
  const workload = response.workload;
  if (
    workload.schema_version !== 'codex_run_execution_workload.v1' ||
    typeof workload.runtime_job_id !== 'string' ||
    typeof workload.run_session_id !== 'string' ||
    typeof workload.execution_package_id !== 'string' ||
    !Number.isInteger(workload.execution_package_version) ||
    typeof workload.workspace_bundle_id !== 'string' ||
    typeof workload.workspace_bundle_digest !== 'string' ||
    typeof workload.package_prompt_digest !== 'string' ||
    typeof workload.execution_context_digest !== 'string'
  ) {
    throw new Error('codex_runtime_job_unavailable');
  }
  const typedWorkload = workload as unknown as CodexRunExecutionWorkloadV1;
  const packagePrompt = typeof response.package_prompt === 'string' ? response.package_prompt : workload.package_prompt;
  const executionContext = isRecord(response.execution_context_json) ? response.execution_context_json : workload.execution_context_json;
  if (typeof packagePrompt === 'string' || isRecord(executionContext)) {
    return validateRunExecutionWorkloadPayload(typedWorkload, packagePrompt, executionContext);
  }
  return { workload: typedWorkload };
};

const validateRunExecutionWorkloadPayload = (
  workload: CodexRunExecutionWorkloadV1,
  packagePrompt: unknown,
  executionContext: unknown,
): Required<FetchedRunExecutionWorkload> => {
  if (typeof packagePrompt !== 'string' || !isRecord(executionContext)) {
    throw new Error('codex_runtime_job_unavailable');
  }
  if (codexCanonicalDigest(packagePrompt) !== workload.package_prompt_digest) {
    throw new Error('codex_runtime_job_unavailable');
  }
  if (codexCanonicalDigest(executionContext) !== workload.execution_context_digest) {
    throw new Error('codex_runtime_job_unavailable');
  }
  if (!isRecord(executionContext.run_spec)) {
    throw new Error('codex_runtime_job_unavailable');
  }
  if (
    executionContext.run_spec.run_session_id !== workload.run_session_id ||
    executionContext.run_spec.execution_package_id !== workload.execution_package_id ||
    executionContext.run_spec.expected_package_version !== workload.execution_package_version
  ) {
    throw new Error('codex_runtime_job_unavailable');
  }
  return {
    workload,
    packagePrompt,
    executionContext,
    runSpec: executionContext.run_spec as CodexDriverStartInput['runSpec'],
  };
};

const requiredWorkspaceBundleAcquisition = (
  job: Pick<CodexRuntimeJob, 'workspace_acquisition_json'>,
  workload: CodexRunExecutionWorkloadV1,
): WorkspaceBundleAcquisition => {
  const acquisition = job.workspace_acquisition_json;
  if (
    !isRecord(acquisition) ||
    acquisition.schema_version !== 'workspace_bundle_acquisition.v1' ||
    acquisition.bundle_id !== workload.workspace_bundle_id ||
    acquisition.archive_digest !== workload.workspace_bundle_digest ||
    typeof acquisition.manifest_digest !== 'string' ||
    typeof acquisition.size_bytes !== 'number' ||
    !Number.isSafeInteger(acquisition.size_bytes) ||
    acquisition.size_bytes < 0
  ) {
    throw new Error('codex_workspace_bundle_invalid');
  }
  return {
    bundle_id: acquisition.bundle_id,
    archive_digest: acquisition.archive_digest,
    manifest_digest: acquisition.manifest_digest,
    size_bytes: acquisition.size_bytes,
  };
};

const requiredEnvelope = (response: unknown): CodexLaunchTokenEnvelope => {
  if (!isRecord(response) || !isRecord(response.envelope)) {
    throw new Error('codex_runtime_job_unavailable');
  }
  return response.envelope as unknown as CodexLaunchTokenEnvelope;
};

const requiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`codex_remote_worker_response_invalid:${key}`);
  }
  return value;
};

const sessionEpoch = (response: Record<string, unknown>): number => {
  if (isRecord(response.worker) && Number.isInteger(response.worker.session_epoch)) {
    return Number(response.worker.session_epoch);
  }
  if (Number.isInteger(response.session_epoch)) {
    return Number(response.session_epoch);
  }
  return 1;
};

const sessionShouldRefresh = (session: WorkerSession, now: string, leadMs: number): boolean => {
  const expiresAt = Date.parse(session.expiresAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(nowMs)) {
    return false;
  }
  return expiresAt - nowMs <= leadMs;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const publicRuntimeWorkerErrorCodes = new Set([
  'codex_runtime_job_cancelled',
  'codex_runtime_job_success_terminal_unconfirmed',
  'codex_generation_workload_unsupported',
  'codex_session_thread_binding_partial',
  'codex_session_thread_digest_mismatch',
  'codex_session_runner_unavailable',
  'codex_app_server_resume_failed',
  'codex_runtime_job_expired',
  'codex_runtime_job_unavailable',
  'codex_workspace_bundle_invalid',
  'codex_control_plane_workspace_bundle_content_type_rejected',
  'codex_control_plane_workspace_bundle_size_rejected',
  'codex_control_plane_workspace_bundle_digest_rejected',
  'codex_control_plane_workspace_bundle_temp_root_rejected',
  'codex_launch_materialization_denied',
  'codex_worker_unavailable',
  'codex_worker_docker_unavailable',
  'codex_worker_docker_policy_unavailable',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_app_server_unavailable',
  'codex_generation_disabled',
  'codex_generation_safety_unavailable',
  'codex_generation_sandbox_invalid',
  'codex_generation_timeout',
  'codex_generation_cancelled',
  'codex_generation_concurrency_limit_exceeded',
  'codex_generation_raw_log_too_large',
  'codex_generation_usage_limited',
  'codex_generation_turn_failed',
  'generated_output_invalid_json',
  'generated_output_ambiguous',
  'generated_output_schema_invalid',
  'generated_output_too_large',
  'codex_runtime_capsule_missing',
  'codex_memory_bundle_missing',
  'codex_environment_manifest_missing',
  'codex_runtime_capsule_unknown_path',
]);

const publicErrorCode = (error: unknown): string => {
  if (isRecord(error) && typeof error.code === 'string' && publicRuntimeWorkerErrorCodes.has(error.code)) {
    return error.code;
  }
  const message = error instanceof Error ? error.message : '';
  if (isRecord(error) && error.code === 'codex_docker_runtime_evidence_unsafe') {
    return 'codex_runtime_job_unavailable';
  }
  if (message.startsWith('codex_control_plane_request_failed:')) {
    return 'codex_runtime_job_unavailable';
  }
  const code = message.split(':', 1)[0]?.trim();
  return code !== undefined && publicRuntimeWorkerErrorCodes.has(code) ? code : 'codex_app_server_unavailable';
};

const publicFailureSubcodeFromError = (error: unknown): string | undefined => {
  if (!isRecord(error) || !isRecord(error.publicResultJson)) {
    return undefined;
  }
  const subcode = error.publicResultJson.failure_subcode;
  return typeof subcode === 'string' && /^[A-Za-z0-9_.:-]+$/.test(subcode) ? subcode : undefined;
};

const shouldAttachGenerationRunner = (workload: CodexGenerationWorkloadV1): boolean => {
  const context = workload.codex_session_runtime_context;
  return (
    context?.continuation.kind === 'resume_thread' &&
    typeof context.runner_runtime_job_id === 'string' &&
    context.runner_runtime_job_id.length > 0 &&
    typeof context.runner_launch_lease_id === 'string' &&
    context.runner_launch_lease_id.length > 0
  );
};

const generationFailureSubcode = (error: unknown, stage?: GenerationFailureStage | RunExecutionFailureStage): string | undefined => {
  const explicitSubcode = publicFailureSubcodeFromError(error);
  if (explicitSubcode !== undefined) {
    return explicitSubcode;
  }
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('codex_control_plane_request_failed:')) {
    return 'control_plane_request_failed';
  }
  const publicCode = publicErrorCode(error);
  if (publicCode === 'codex_app_server_unavailable' && stage === 'runtime_job_start') {
    return 'runtime_job_start_unavailable';
  }
  if (publicCode === 'codex_app_server_unavailable' && stage === 'app_server_started_event') {
    return 'runtime_job_event_append_unavailable';
  }
  if (publicCode === 'codex_app_server_unavailable' && stage === 'generation_artifact_upload') {
    return 'runtime_job_artifact_upload_unavailable';
  }
  if (publicCode === 'codex_app_server_unavailable' && stage === 'generation_cleanup') {
    return 'app_server_cleanup_unavailable';
  }
  if (publicCode === 'codex_runtime_capsule_missing') {
    return 'runtime_capsule_missing';
  }
  if (publicCode === 'codex_memory_bundle_missing') {
    return 'memory_bundle_missing';
  }
  if (publicCode === 'codex_environment_manifest_missing') {
    return 'environment_manifest_missing';
  }
  if (publicCode === 'codex_runtime_capsule_unknown_path') {
    return 'runtime_capsule_unknown_path';
  }
  if (
    (publicCode === 'codex_app_server_unavailable' || publicCode === 'codex_runtime_job_unavailable') &&
    stage === 'generation_terminal_result'
  ) {
    return 'runtime_job_terminal_result_unavailable';
  }
  if (
    (publicCode === 'codex_app_server_unavailable' || publicCode === 'codex_runtime_job_unavailable') &&
    stage === 'generation_terminalize'
  ) {
    return 'runtime_job_terminalize_unavailable';
  }
  if (publicCode === 'codex_generation_usage_limited') {
    return 'app_server_usage_limit_exceeded';
  }
  if (publicCode === 'codex_generation_turn_failed') {
    return 'app_server_turn_failed';
  }
  if (publicCode === 'codex_generation_raw_log_too_large') {
    return 'app_server_raw_log_too_large';
  }
  if (publicCode === 'codex_generation_timeout') {
    return 'app_server_generation_timeout';
  }
  if (
    publicCode === 'generated_output_invalid_json' ||
    publicCode === 'generated_output_ambiguous' ||
    publicCode === 'generated_output_schema_invalid' ||
    publicCode === 'generated_output_too_large'
  ) {
    return publicCode;
  }
  return undefined;
};

const runExecutionFailureSubcode = (error: unknown, stage?: RuntimeFailureDiagnostic['failure_stage']): string | undefined => {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('codex_control_plane_request_failed:')) {
    return 'control_plane_request_failed';
  }
  const workspaceBundleSubcode = workspaceBundleInvalidSubcode(error);
  if (workspaceBundleSubcode !== undefined) {
    return workspaceBundleSubcode;
  }
  const publicCode = publicErrorCode(error);
  if (publicCode === 'codex_app_server_unavailable' && stage === 'runtime_job_start') {
    return 'runtime_job_start_unavailable';
  }
  if (publicCode === 'codex_app_server_unavailable' && stage === 'app_server_started_event') {
    return 'runtime_job_event_append_unavailable';
  }
  if (publicCode === 'codex_app_server_unavailable' && stage === 'run_execution_result_collection') {
    return 'run_execution_result_collector_failed';
  }
  if (publicCode === 'codex_app_server_unavailable' && stage === 'run_execution_artifact_upload') {
    return 'runtime_job_artifact_upload_unavailable';
  }
  return undefined;
};

const runExecutionTerminalFailureSubcode = (terminal: Extract<CodexDriverStreamItem, { kind: 'terminal' }>): string => {
  const summary = terminal.summary.toLowerCase();
  if (summary.includes('idle before turn completion')) {
    return 'app_server_thread_idle_before_turn_completed';
  }
  if (summary.includes('notification stream ended')) {
    return 'app_server_notification_stream_ended';
  }
  return 'app_server_turn_failed';
};

const workspaceBundleInvalidSubcodes = new Map<string, string>([
  ['workspace symlinks are not allowed', 'workspace_symlinks_not_allowed'],
  ['workspace entry escapes root', 'workspace_entry_escapes_root'],
  ['archive exceeds byte limit', 'archive_exceeds_byte_limit'],
  ['archive digest mismatch', 'archive_digest_mismatch'],
  ['manifest digest mismatch', 'manifest_digest_mismatch'],
  ['archive entries do not match manifest', 'archive_entries_mismatch'],
  ['archive contains entries outside manifest', 'archive_contains_entries_outside_manifest'],
  ['temp root is unavailable', 'temp_root_unavailable'],
  ['job temp root already exists', 'job_temp_root_already_exists'],
  ['workspace path escapes temp root', 'workspace_path_escapes_temp_root'],
  ['workspace path escapes real temp root', 'workspace_path_escapes_real_temp_root'],
  ['entry target escapes workspace root', 'entry_target_escapes_workspace_root'],
  ['archive entry type is not unpackable', 'archive_entry_type_not_unpackable'],
  ['archive file content is missing', 'archive_file_content_missing'],
  ['archive file content does not match manifest', 'archive_file_content_mismatch'],
  ['mounted workspace root is unavailable', 'mounted_workspace_root_unavailable'],
  ['mounted workspace entry escapes root', 'mounted_workspace_entry_escapes_root'],
  ['mounted workspace contains symlink', 'mounted_workspace_contains_symlink'],
  ['mounted workspace contains unsupported entry type', 'mounted_workspace_contains_unsupported_entry_type'],
  ['entry path is outside allowed paths', 'entry_path_outside_allowed_paths'],
  ['entry path is forbidden', 'entry_path_forbidden'],
]);

const workspaceBundleInvalidSubcode = (error: unknown): string | undefined => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'codex_workspace_bundle_invalid') {
    return 'workspace_bundle_invalid';
  }
  const prefix = 'codex_workspace_bundle_invalid:';
  if (!message.startsWith(prefix)) {
    return undefined;
  }
  const suffix = message.slice(prefix.length).trim();
  return workspaceBundleInvalidSubcodes.get(suffix) ?? 'workspace_bundle_invalid';
};
