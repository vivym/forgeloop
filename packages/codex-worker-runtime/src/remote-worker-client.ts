import { randomUUID } from 'node:crypto';

import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  type CodexGenerationWorkloadV1,
  type CodexLaunchMaterialization,
  type CodexLaunchTokenEnvelope,
  type CodexRuntimeJob,
  type CodexRuntimeTargetKind,
  type CodexRuntimeScope,
} from '@forgeloop/domain';
import {
  CodexAppServerEndpointTransport,
  createCodexGenerationRuntime,
  type CodexGenerationResult,
} from '@forgeloop/codex-runtime';

import type { DockerizedCodexAppServerLauncher } from './app-server-launcher.js';
import { decryptCodexLaunchTokenEnvelope, generateCodexWorkerSessionKeyPair, type CodexWorkerSessionKeyPair } from './envelope-crypto.js';
import {
  generationRuntimeJobTerminalResult,
  jsonRuntimeJobArtifactUpload,
  type RuntimeJobArtifactUploadInput,
} from './runtime-job-artifacts.js';

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
  appendRuntimeJobEvent?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
  uploadRuntimeJobArtifact?(
    workerId: string,
    jobId: string,
    input: RuntimeJobArtifactUploadInput & Record<string, unknown>,
  ): Promise<unknown>;
  terminalizeRuntimeJob(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
};

type RemoteLauncher = Pick<DockerizedCodexAppServerLauncher, 'startFromMaterialization'>;

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

export const createRemoteCodexWorkerClient = (options: RemoteCodexWorkerClientOptions): RemoteCodexWorkerClient => {
  const now = options.now ?? (() => new Date().toISOString());
  const nonce = options.nonceFactory ?? (() => randomUUID());
  const sleep = options.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const generationRuntimeFactory = options.generationRuntimeFactory ?? createCodexGenerationRuntime;
  let session: WorkerSession | undefined;
  let workerHeartbeatIntervalMs = 15_000;
  let lastWorkerHeartbeatAtMs: number | undefined;
  let nextWorkerHeartbeatAtMs = 0;

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
    await options.controlPlaneClient.heartbeatWorker(options.workerId, {
      session_token: workerSession.token,
      nonce: nonce(),
      nonce_timestamp: nowValue,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: options.capabilities,
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

    let appServerSession: Awaited<ReturnType<RemoteLauncher['startFromMaterialization']>> | undefined;
    let successTerminalAttempted = false;
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
      const workload = requiredGenerationWorkload(
        await options.controlPlaneClient.fetchRuntimeJobWorkload?.(options.workerId, job.id, workerProof(workerSession)),
      );
      if (options.controlPlaneClient.materializeRuntimeJob === undefined) {
        throw new Error('codex_control_plane_method_missing:materializeRuntimeJob');
      }
      await throwIfCancelled(workerSession, job);
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
      appServerSession = await options.launcher.startFromMaterialization(materialization, {
        workerSessionToken: workerSession.token,
        terminalizeLaunchLeaseOnClose: false,
      });
      await throwIfCancelled(workerSession, job);
      if (options.controlPlaneClient.startRuntimeJob === undefined) {
        throw new Error('codex_control_plane_method_missing:startRuntimeJob');
      }
      await options.controlPlaneClient.startRuntimeJob(options.workerId, job.id, {
        ...workerProof(workerSession),
        start_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'start' }),
        runtime_evidence_digest: codexCanonicalDigest(appServerSession.publicEvidence),
        launch_materialization_digest: codexCanonicalDigest({
          lease_id: materialization.lease_id,
          expires_at: materialization.expires_at,
          materialized_at: materialization.materialized_at,
        }),
      });
      await options.controlPlaneClient.appendRuntimeJobEvent?.(options.workerId, job.id, {
        ...workerProof(workerSession),
        event_id: codexCanonicalDigest({ runtime_job_id: job.id, event: 'app_server_started' }),
        event_idempotency_key: codexCanonicalDigest({ runtime_job_id: job.id, operation: 'event', event: 'app_server_started' }),
        event_type: 'app_server_started',
        event_payload_json: { runtime_evidence_digest: codexCanonicalDigest(appServerSession.publicEvidence) },
        event_payload_digest: codexCanonicalDigest({ runtime_evidence_digest: codexCanonicalDigest(appServerSession.publicEvidence) }),
      });

      const runtime = generationRuntimeFactory({
        mode: 'app_server',
        appServerEndpoint: appServerSession.endpoint,
        artifactRoot: '/artifacts',
        timeoutMs: materialization.profile_revision.resource_limits.timeout_ms,
        outputLimitBytes: materialization.profile_revision.resource_limits.output_limit_bytes,
        transportFactory: (endpoint) =>
          appServerSession?.createTransport?.() ?? new CodexAppServerEndpointTransport(endpoint, appServerSession?.endpointAuth),
      });
      const generationResult = await runGenerationWithControl(workerSession, job, (signal) =>
        runGeneration(runtime, workload, job, materialization, signal),
      );
      const uploadedArtifacts = await uploadGenerationArtifacts(workerSession, job, generationResult);
      await closeAfterGeneration(workerSession, job, appServerSession);
      const terminalResult = generationRuntimeJobTerminalResult(generationResult, uploadedArtifacts);
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
        await appServerSession?.close('failed', 'codex_runtime_job_unavailable').catch(() => undefined);
        return;
      }
      const reasonCode = await publicErrorCodeForJobError(error, workerSession, job);
      await appServerSession?.close('failed', reasonCode).catch(() => undefined);
      if (reasonCode !== 'codex_runtime_job_cancelled') {
        await uploadFailureArtifact(workerSession, job, reasonCode).catch(() => undefined);
      }
      await terminalize(workerSession, job, {
        terminal_status: reasonCode === 'codex_runtime_job_cancelled' ? 'cancelled' : 'failed',
        reason_code: reasonCode,
      });
    }
  };

  const closeAfterGeneration = async (
    workerSession: WorkerSession,
    job: Pick<CodexRuntimeJob, 'id'>,
    appServerSession: Awaited<ReturnType<RemoteLauncher['startFromMaterialization']>>,
  ): Promise<void> => {
    try {
      await appServerSession.close('succeeded', 'generation complete');
    } catch {
      await uploadCleanupFailureArtifact(workerSession, job).catch(() => undefined);
    }
  };

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
  ): Promise<void> => {
    if (options.controlPlaneClient.uploadRuntimeJobArtifact === undefined) {
      return;
    }
    await options.controlPlaneClient.uploadRuntimeJobArtifact(options.workerId, job.id, {
      ...workerProof(workerSession),
      ...jsonRuntimeJobArtifactUpload({
        kind: 'startup_failure_evidence',
        name: 'startup-failure-evidence.json',
        payload: {
          reason_code: reasonCode,
          public_summary: 'Remote Codex app-server startup or generation failed.',
        },
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
  workload: CodexGenerationWorkloadV1,
  job: Pick<CodexRuntimeJob, 'project_id' | 'repo_id'>,
  materialization: CodexLaunchMaterialization,
  signal: AbortSignal,
): Promise<CodexGenerationResult<Record<string, unknown>>> => {
  const input = {
    actionRunId: workload.action_run_id,
    projectId: job.project_id,
    repoIds: materialization.launch_target.repo_id === undefined ? [] : [materialization.launch_target.repo_id],
    context: {
      signed_context_ref: workload.signed_context_ref,
      signed_context_digest: workload.signed_context_digest,
      prompt_template_digest: workload.prompt_template_digest,
    },
    promptVersion: workload.prompt_version,
    outputSchemaVersion: workload.output_schema_version,
    policyDigests: {
      ...(materialization.launch_target.repo_id === undefined
        ? {}
        : { [materialization.launch_target.repo_id]: workload.signed_context_digest }),
      signed_context: workload.signed_context_digest,
      prompt_template: workload.prompt_template_digest,
    },
    signal,
  };
  if (workload.task_kind === 'spec_draft') {
    return (await runtime.generateSpecDraft(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
  }
  if (workload.task_kind === 'plan_draft') {
    return (await runtime.generatePlanDraft(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
  }
  return (await runtime.generatePackageDrafts(input)) as unknown as CodexGenerationResult<Record<string, unknown>>;
};

const requiredGenerationWorkload = (response: unknown): CodexGenerationWorkloadV1 => {
  if (!isRecord(response) || !isRecord(response.workload)) {
    throw new Error('codex_runtime_job_unavailable');
  }
  const workload = response.workload;
  if (
    workload.schema_version !== 'codex_generation_workload.v1' ||
    typeof workload.runtime_job_id !== 'string' ||
    typeof workload.action_run_id !== 'string' ||
    !['spec_draft', 'plan_draft', 'package_drafts'].includes(String(workload.task_kind))
  ) {
    throw new Error('codex_runtime_job_unavailable');
  }
  return workload as unknown as CodexGenerationWorkloadV1;
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
  'codex_runtime_job_expired',
  'codex_runtime_job_unavailable',
  'codex_launch_materialization_denied',
  'codex_worker_unavailable',
  'codex_worker_docker_policy_unavailable',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_app_server_unavailable',
  'codex_generation_timeout',
  'codex_generation_cancelled',
  'generated_output_invalid_json',
  'generated_output_schema_invalid',
  'generated_output_too_large',
]);

const publicErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  const code = message.split(':', 1)[0]?.trim();
  return code !== undefined && publicRuntimeWorkerErrorCodes.has(code) ? code : 'codex_app_server_unavailable';
};
