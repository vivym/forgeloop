import { AutomationHttpError } from '@forgeloop/automation';
import type { DockerizedCodexAppServerLauncher, LocalCodexWorkerRuntime } from '@forgeloop/codex-worker-runtime';
import {
  CodexAppServerEndpointTransport,
  CodexGenerationError,
  createCodexGenerationRuntime,
  validateGeneratedPackageDraftSet,
  type CodexGenerationResult,
  type CodexGenerationRuntime,
  type CodexGenerationRuntimeTaskInput,
  type GeneratedPackageDraftSetV1,
} from '@forgeloop/codex-runtime';
import {
  codexCanonicalDigest,
  type CodexDockerRuntimeEvidence,
  validateCodexRuntimeJobTerminalResult,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexRuntimeStatusProjection,
} from '@forgeloop/domain';

import type { AutomationDaemonConfig } from './config.js';

type GenerationTaskKind = 'package_drafts';
type GenerationInput = Parameters<CodexGenerationRuntime['generatePackageDrafts']>[0];
type GeneratedForTask<TTaskKind extends GenerationTaskKind> = GeneratedPackageDraftSetV1;

type RemoteRuntimeJobProjection = {
  id?: unknown;
  status?: unknown;
  terminal_status?: unknown;
  terminal_reason_code?: unknown;
  terminal_result_json?: unknown;
};

class RemoteRuntimeJobWaitDeadlineExpired extends Error {
  constructor() {
    super('codex_runtime_job_expired');
  }
}

class RemoteRuntimeJobWaitAborted extends Error {
  constructor() {
    super('codex_generation_cancelled');
  }
}

type RemoteRuntimeJobWaitResult<T> =
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'deadline' }
  | { kind: 'aborted' };

export interface RemoteCodexGenerationControlPlaneClient {
  getStatus(input: {
    projectId: string;
    repoId?: string;
    targetKind: 'generation';
    runtimeProfileId?: string;
    credentialBindingId?: string;
  }): Promise<CodexRuntimeStatusProjection>;
  createRuntimeJob(input: Record<string, unknown>): Promise<unknown>;
  getRuntimeJob(jobId: string): Promise<unknown>;
  cancelRuntimeJob(jobId: string, input: { reason_code: string; idempotency_key: string }): Promise<unknown>;
  renewAutomationActionRunClaim(
    actionRunId: string,
    input: { claim_token: string; locked_until: string; now?: string },
  ): Promise<unknown>;
}

export interface CreateRemoteCodexGenerationRuntimeOptions {
  controlPlaneClient: RemoteCodexGenerationControlPlaneClient;
  runtimeProfileId: string;
  credentialBindingId: string;
  waitTimeoutMs: number;
  pollIntervalMs: number;
  actionClaimRenewalMs?: number;
  now?: () => string;
  monotonicNowMs?: () => number;
  sleep?: (durationMs: number) => Promise<void>;
}

const codexGenerationRuntimeConfigFor = (config: AutomationDaemonConfig): Parameters<typeof createCodexGenerationRuntime>[0] => ({
  mode: config.generationPlanning.mode,
  ...(config.appServerEndpoint === undefined ? {} : { appServerEndpoint: config.appServerEndpoint }),
  ...(config.generationArtifactRoot === undefined ? {} : { artifactRoot: config.generationArtifactRoot }),
  ...(config.generationTurnTimeoutMs === undefined ? {} : { timeoutMs: config.generationTurnTimeoutMs }),
  ...(config.generationOutputLimitBytes === undefined ? {} : { outputLimitBytes: config.generationOutputLimitBytes }),
  ...(config.generationRawNotificationLimitBytes === undefined
    ? {}
    : { rawNotificationLimitBytes: config.generationRawNotificationLimitBytes }),
  ...(config.generationMaxConcurrency === undefined ? {} : { maxConcurrency: config.generationMaxConcurrency }),
});

const appendDockerRuntimeEvidenceArtifact = <T>(result: T, evidence: CodexDockerRuntimeEvidence): T => {
  const candidate = result as CodexGenerationResult<Record<string, unknown>>;
  if (!Array.isArray(candidate.generationArtifacts)) {
    return result;
  }
  const evidenceDigest = codexCanonicalDigest(evidence);
  return {
    ...candidate,
    generationArtifacts: [
      ...candidate.generationArtifacts,
      {
        kind: 'raw_metadata',
        name: 'docker-runtime-evidence.json',
        content_type: 'application/json',
        storage_uri: `artifact://codex-dogfood-runtime-evidence/${evidenceDigest}`,
        digest: evidenceDigest,
      },
    ],
  } as T;
};

export interface CreateLeasedDockerCodexGenerationRuntimeOptions {
  worker: Pick<LocalCodexWorkerRuntime, 'selectForLaunch' | 'withLeaseSlot'>;
  launcher: Pick<DockerizedCodexAppServerLauncher, 'launchFromLease'>;
  dockerImageDigest: string;
  createLaunchLease(input: {
    taskKind: GenerationTaskKind;
    workerId: string;
    sessionToken: string;
    generationInput: GenerationInput;
  }): Promise<{ leaseId: string; launchToken: string }>;
  innerRuntimeFactory?: (config: Parameters<typeof createCodexGenerationRuntime>[0]) => CodexGenerationRuntime;
  runtimeConfig?: Partial<Parameters<typeof createCodexGenerationRuntime>[0]>;
  onDockerRuntimeEvidence?: (evidence: CodexDockerRuntimeEvidence) => void;
}

export const createLeasedDockerCodexGenerationRuntime = (
  options: CreateLeasedDockerCodexGenerationRuntimeOptions,
): CodexGenerationRuntime => {
  const innerRuntimeFactory = options.innerRuntimeFactory ?? createCodexGenerationRuntime;

  const generateWithLease = async <T>(
    taskKind: GenerationTaskKind,
    input: GenerationInput,
    call: (runtime: CodexGenerationRuntime, input: GenerationInput) => Promise<T>,
  ): Promise<T> => {
    if (input.orchestration === undefined) {
      throw new Error('codex_launch_lease_denied');
    }
    const worker = await options.worker.selectForLaunch({
      projectId: input.projectId,
      ...(input.repoIds[0] === undefined ? {} : { repoId: input.repoIds[0] }),
      dockerImageDigest: options.dockerImageDigest,
      targetKind: 'generation',
    });
    return options.worker.withLeaseSlot(async () => {
      const lease = await options.createLaunchLease({
        taskKind,
        workerId: worker.workerId,
        sessionToken: worker.sessionToken,
        generationInput: input,
      });
      const session = await options.launcher.launchFromLease({
        leaseId: lease.leaseId,
        launchToken: lease.launchToken,
        workerSessionToken: worker.sessionToken,
      });
      options.onDockerRuntimeEvidence?.(session.publicEvidence);
      try {
        const runtime = innerRuntimeFactory({
          mode: 'app_server',
          ...options.runtimeConfig,
          appServerEndpoint: session.endpoint,
          transportFactory: (endpoint) => session.createTransport?.() ?? new CodexAppServerEndpointTransport(endpoint, session.endpointAuth),
        });
        const result = await call(runtime, input);
        await session.close('succeeded', 'generation complete');
        return options.onDockerRuntimeEvidence === undefined ? result : appendDockerRuntimeEvidenceArtifact(result, session.publicEvidence);
      } catch (error) {
        await session.close('failed', error instanceof Error ? error.message : 'generation failed');
        throw error;
      }
    });
  };

  return {
    async generateSpecDraft() {
      throw new Error('unsupported_generation_task');
    },
    async generatePlanDraft() {
      throw new Error('unsupported_generation_task');
    },
    generatePackageDrafts: (input) =>
      generateWithLease('package_drafts', input, (runtime, taskInput) => runtime.generatePackageDrafts(taskInput)),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CodexGenerationError('codex_app_server_unavailable', { retryable: true });
  }
  return value;
};

const isoAfter = (now: string, durationMs: number): string => {
  const nowMs = Date.parse(now);
  return new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + durationMs).toISOString();
};

const stableWorkloadIsoFor = (input: Record<string, unknown>, offsetMs = 0): string => {
  const hash = codexCanonicalDigest(input).replace(/^sha256:/, '');
  const yearMs = 366 * 24 * 60 * 60 * 1000;
  const stableOffset = Number.parseInt(hash.slice(0, 12), 16) % yearMs;
  return new Date(Date.UTC(2026, 0, 1) + stableOffset + offsetMs).toISOString();
};

const remoteRuntimeJobIdFor = (input: {
  actionRunId: string;
  actionAttempt: number;
  taskKind: GenerationTaskKind;
  promptVersion: string;
  outputSchemaVersion: string;
  idempotencyKey: string;
}): string => `codex-generation-job-${codexCanonicalDigest(input).replace(/^sha256:/, '')}`;

const remoteGenerationCancelInput = (runtimeJobId: string, reasonCode = 'codex_runtime_job_cancelled') => ({
  reason_code: reasonCode,
  idempotency_key: codexCanonicalDigest({ runtime_job_id: runtimeJobId, operation: 'cancel', reason_code: reasonCode }),
});

const publicRuntimeTerminalReasonCodes = new Set([
  'codex_runtime_job_unavailable',
  'codex_runtime_job_expired',
  'codex_runtime_job_cancelled',
  'codex_app_server_unavailable',
  'codex_generation_timeout',
  'codex_generation_cancelled',
  'codex_generation_turn_failed',
  'generated_output_schema_invalid',
]);

const publicRuntimeTerminalReasonCode = (value: unknown): string =>
  typeof value === 'string' && publicRuntimeTerminalReasonCodes.has(value) ? value : 'codex_runtime_job_unavailable';

const runtimeJobFromResponse = (response: unknown): RemoteRuntimeJobProjection => {
  if (!isRecord(response) || !isRecord(response.runtime_job)) {
    throw new CodexGenerationError('codex_app_server_unavailable', { retryable: true });
  }
  return response.runtime_job;
};

const isLostActionClaimRenewalError = (error: unknown): boolean => {
  if (error instanceof AutomationHttpError) {
    return (
      error.code === 'automation_action_claim_conflict' ||
      error.code === 'automation_action_claim_required' ||
      error.status === 401 ||
      error.status === 403 ||
      error.status === 409
    );
  }
  return (
    error instanceof Error &&
    (error.message === 'automation_action_claim_conflict' || /^codex_control_plane_request_failed:(401|403|409)\b/.test(error.message))
  );
};

const bestEffortCancelRuntimeJob = async (
  controlPlaneClient: RemoteCodexGenerationControlPlaneClient,
  runtimeJobId: string,
  reasonCode = 'codex_runtime_job_cancelled',
): Promise<void> => {
  try {
    await controlPlaneClient.cancelRuntimeJob(runtimeJobId, remoteGenerationCancelInput(runtimeJobId, reasonCode));
  } catch {
    // Preserve the original wait/renew failure; recovery will terminalize stale runtime jobs.
  }
};

const validateRemoteTerminalResult = <TTaskKind extends GenerationTaskKind>(
  runtimeJobId: string,
  taskKind: TTaskKind,
  promptVersion: string,
  outputSchemaVersion: string,
  terminalResultJson: unknown,
): CodexGenerationResult<GeneratedForTask<TTaskKind>> => {
  const terminalResult = validateCodexRuntimeJobTerminalResult(terminalResultJson);
  if (terminalResult.task_kind === 'run_execution') {
    throw new CodexGenerationError('generated_output_schema_invalid', { retryable: false });
  }
  const result = terminalResult as CodexGenerationRuntimeJobResult;
  if (result.generated_payload.schema_version === 'generated_payload_ref.v1') {
    throw new CodexGenerationError('generated_output_too_large', {
      retryable: false,
      publicResultJson: { status: 422, code: 'generated_output_too_large' },
    });
  }
  if (
    result.task_kind !== taskKind ||
    result.prompt_version !== promptVersion ||
    result.output_schema_version !== outputSchemaVersion ||
    codexCanonicalDigest(result.generated_payload) !== result.generated_payload_digest
  ) {
    throw new CodexGenerationError('generated_output_schema_invalid', { retryable: false });
  }

  const generated = validateGeneratedPackageDraftSet(result.generated_payload);

  return {
    taskKind,
    promptVersion,
    outputSchemaVersion,
    generated: generated as GeneratedForTask<TTaskKind>,
    generationArtifacts: result.generation_artifacts.flatMap((artifact) => {
      if (artifact.internal_ref === undefined || artifact.digest === undefined) {
        return [];
      }
      const expectedPrefix = `artifact://codex-runtime-jobs/${runtimeJobId}/artifacts/`;
      if (!artifact.internal_ref.startsWith(expectedPrefix)) {
        throw new CodexGenerationError('generated_output_schema_invalid', { retryable: false });
      }
      return [
        {
          kind: 'raw_metadata' as const,
          name: artifact.name,
          content_type: artifact.content_type,
          storage_uri: artifact.internal_ref,
          digest: artifact.digest,
        },
      ];
    }),
    publicSummary: result.public_summary,
  };
};

const terminalFailureFor = (runtimeJob: RemoteRuntimeJobProjection): CodexGenerationError => {
  if (runtimeJob.terminal_status === 'cancelled') {
    return new CodexGenerationError('codex_generation_cancelled', { retryable: false });
  }
  if (runtimeJob.terminal_status === 'expired') {
    return new CodexGenerationError('codex_generation_timeout', { retryable: true });
  }
  return new CodexGenerationError('codex_generation_turn_failed', {
    retryable: true,
    publicResultJson: {
      status: 502,
      code: publicRuntimeTerminalReasonCode(runtimeJob.terminal_reason_code),
    },
  });
};

export const createRemoteCodexGenerationRuntime = (options: CreateRemoteCodexGenerationRuntimeOptions): CodexGenerationRuntime => {
  const now = options.now ?? (() => new Date().toISOString());
  const monotonicNowMs = options.monotonicNowMs ?? (() => Date.now());
  const sleep = options.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const claimRenewalMs = options.actionClaimRenewalMs ?? Math.max(options.pollIntervalMs * 2, 30_000);

  const sleepUntilNextPollOrAbort = async (durationMs: number, signal?: AbortSignal): Promise<boolean> => {
    if (durationMs <= 0) {
      return true;
    }
    if (signal === undefined) {
      await sleep(durationMs);
      return true;
    }
    if (signal.aborted) {
      return false;
    }
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const settle = (slept: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(slept);
      };
      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      };
      const onAbort = (): void => settle(false);
      signal.addEventListener('abort', onAbort, { once: true });
      void sleep(durationMs).then(
        () => settle(true),
        (error: unknown) => fail(error),
      );
    });
  };

  const generateWithRemoteJob = async <TTaskKind extends GenerationTaskKind>(
    taskKind: TTaskKind,
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedForTask<TTaskKind>>> => {
    if (input.orchestration === undefined) {
      throw new Error('codex_runtime_job_denied');
    }
    const isAborted = (): boolean => input.signal?.aborted === true;
    if (isAborted()) {
      throw new CodexGenerationError('codex_generation_cancelled', { retryable: false });
    }
    const orchestration = input.orchestration;
    const repoId = input.repoIds[0];
    const nowValue = now();
    const runtimeJobId = remoteRuntimeJobIdFor({
      actionRunId: orchestration.actionRunId,
      actionAttempt: orchestration.actionAttempt,
      taskKind,
      promptVersion: input.promptVersion,
      outputSchemaVersion: input.outputSchemaVersion,
      idempotencyKey: orchestration.idempotencyKey,
    });
    const expiresAt = isoAfter(nowValue, options.waitTimeoutMs);
    const signedContextDigest = codexCanonicalDigest(input.context);
    const signedContextRef = `artifact://codex-runtime-jobs/${runtimeJobId}/workload/signed-context`;
    const workloadTimeSeed = {
      action_run_id: orchestration.actionRunId,
      action_attempt: orchestration.actionAttempt,
      task_kind: taskKind,
      idempotency_key: orchestration.idempotencyKey,
    };
    const workload: CodexGenerationWorkloadV1 = {
      schema_version: 'codex_generation_workload.v1',
      runtime_job_id: runtimeJobId,
      action_run_id: orchestration.actionRunId,
      task_kind: taskKind,
      prompt_version: input.promptVersion,
      output_schema_version: input.outputSchemaVersion,
      signed_context_ref: signedContextRef,
      signed_context_digest: signedContextDigest,
      prompt_template_digest: codexCanonicalDigest({
        task_kind: taskKind,
        prompt_version: input.promptVersion,
        output_schema_version: input.outputSchemaVersion,
      }),
      created_at: stableWorkloadIsoFor(workloadTimeSeed),
      expires_at: stableWorkloadIsoFor(workloadTimeSeed, options.waitTimeoutMs),
    };
    const status = await options.controlPlaneClient.getStatus({
      projectId: input.projectId,
      ...(repoId === undefined ? {} : { repoId }),
      targetKind: 'generation',
      runtimeProfileId: options.runtimeProfileId,
      credentialBindingId: options.credentialBindingId,
    });
    const runtimeProfileRevisionId = requiredString(status as Record<string, unknown>, 'runtime_profile_revision_id');
    const credentialBindingId = requiredString(status as Record<string, unknown>, 'credential_binding_id');
    const credentialBindingVersionId = requiredString(status as Record<string, unknown>, 'credential_binding_version_id');
    const credentialPayloadDigest = requiredString(status as Record<string, unknown>, 'credential_payload_digest');

    const launchLeaseId = `codex-generation-lease-${runtimeJobId}`;
    const envelopeId = `codex-generation-envelope-${runtimeJobId}`;
    await options.controlPlaneClient.createRuntimeJob({
      runtime_job_id: runtimeJobId,
      launch_lease_id: launchLeaseId,
      envelope_id: envelopeId,
      job_request_id: `codex-generation-job-request-${orchestration.actionRunId}-${taskKind}-${orchestration.idempotencyKey}`,
      target: {
        target_type: orchestration.targetType,
        target_id: orchestration.actionRunId,
        target_kind: 'generation',
        project_id: input.projectId,
        ...(repoId === undefined ? {} : { repo_id: repoId }),
      },
      runtime_profile_revision_id: runtimeProfileRevisionId,
      credential_binding_id: credentialBindingId,
      credential_binding_version_id: credentialBindingVersionId,
      credential_payload_digest: credentialPayloadDigest,
      input_json: workload,
      workspace_acquisition_json: {
        schema_version: 'codex_generation_workspace_acquisition.v1',
        signed_context_ref: signedContextRef,
        signed_context_digest: signedContextDigest,
        signed_context_json: input.context,
        repo_ids: input.repoIds,
        policy_digests: input.policyDigests,
      },
      launch_attempt: orchestration.actionAttempt,
      action_type: orchestration.actionType,
      action_attempt: orchestration.actionAttempt,
      action_claim_token: orchestration.claimToken,
      precondition_fingerprint: orchestration.preconditionFingerprint,
      expires_at: expiresAt,
    });

    const waitStartedAtMs = monotonicNowMs();
    let accountedSleepMs = 0;
    const elapsedWaitMs = (): number => Math.max(accountedSleepMs, monotonicNowMs() - waitStartedAtMs);
    const remainingWaitMs = (): number => Math.max(0, options.waitTimeoutMs - elapsedWaitMs());
    const runWithinWaitDeadline = async <T>(operation: () => Promise<T>): Promise<T> => {
      const remainingMs = remainingWaitMs();
      if (remainingMs <= 0) {
        throw new RemoteRuntimeJobWaitDeadlineExpired();
      }
      if (isAborted()) {
        throw new RemoteRuntimeJobWaitAborted();
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let removeAbortListener = (): void => undefined;
      const settle = <TValue>(value: TValue): TValue => {
        if (!settled) {
          settled = true;
          if (timeout !== undefined) {
            clearTimeout(timeout);
          }
          removeAbortListener();
        }
        return value;
      };
      const operationResult: Promise<RemoteRuntimeJobWaitResult<T>> = Promise.resolve().then(operation).then(
        (value) => ({ kind: 'value' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      );
      const deadlineResult = new Promise<RemoteRuntimeJobWaitResult<T>>((resolve) => {
        const resolveOnce = (kind: 'deadline' | 'aborted'): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeout !== undefined) {
            clearTimeout(timeout);
          }
          removeAbortListener();
          resolve({ kind });
        };
        timeout = setTimeout(() => resolveOnce('deadline'), remainingMs);
        if (input.signal !== undefined) {
          const onAbort = (): void => resolveOnce('aborted');
          input.signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => input.signal?.removeEventListener('abort', onAbort);
          if (input.signal.aborted) {
            resolveOnce('aborted');
          }
        }
      });
      const result = await Promise.race([operationResult, deadlineResult]);
      if (result.kind === 'deadline') {
        throw new RemoteRuntimeJobWaitDeadlineExpired();
      }
      if (result.kind === 'aborted') {
        throw new RemoteRuntimeJobWaitAborted();
      }
      settle(undefined);
      if (result.kind === 'error') {
        throw result.error;
      }
      if (result.kind !== 'value') {
        throw new RemoteRuntimeJobWaitDeadlineExpired();
      }
      return result.value;
    };

    while (remainingWaitMs() > 0) {
      if (isAborted()) {
        await bestEffortCancelRuntimeJob(options.controlPlaneClient, runtimeJobId);
        throw new CodexGenerationError('codex_generation_cancelled', { retryable: false });
      }
      try {
        await runWithinWaitDeadline(() =>
          options.controlPlaneClient.renewAutomationActionRunClaim(orchestration.actionRunId, {
            claim_token: orchestration.claimToken,
            locked_until: isoAfter(now(), claimRenewalMs),
            now: now(),
          }),
        );
      } catch (error) {
        if (error instanceof RemoteRuntimeJobWaitDeadlineExpired) {
          break;
        }
        if (error instanceof RemoteRuntimeJobWaitAborted) {
          await bestEffortCancelRuntimeJob(options.controlPlaneClient, runtimeJobId);
          throw new CodexGenerationError('codex_generation_cancelled', { retryable: false });
        }
        await bestEffortCancelRuntimeJob(options.controlPlaneClient, runtimeJobId);
        if (isLostActionClaimRenewalError(error)) {
          throw new AutomationHttpError(
            409,
            { code: 'automation_action_claim_conflict' },
            'automation_action_claim_conflict',
          );
        }
        throw new CodexGenerationError('codex_app_server_unavailable', {
          retryable: true,
          publicResultJson: { status: 503, code: 'codex_app_server_unavailable' },
        });
      }
      if (remainingWaitMs() <= 0) {
        break;
      }

      let runtimeJob: RemoteRuntimeJobProjection;
      try {
        runtimeJob = runtimeJobFromResponse(await runWithinWaitDeadline(() => options.controlPlaneClient.getRuntimeJob(runtimeJobId)));
      } catch (error) {
        if (error instanceof RemoteRuntimeJobWaitDeadlineExpired) {
          break;
        }
        if (error instanceof RemoteRuntimeJobWaitAborted) {
          await bestEffortCancelRuntimeJob(options.controlPlaneClient, runtimeJobId);
          throw new CodexGenerationError('codex_generation_cancelled', { retryable: false });
        }
        throw error;
      }
      if (remainingWaitMs() <= 0) {
        break;
      }
      if (runtimeJob.status === 'terminal') {
        if (runtimeJob.terminal_status !== 'succeeded') {
          throw terminalFailureFor(runtimeJob);
        }
        return validateRemoteTerminalResult(
          runtimeJobId,
          taskKind,
          input.promptVersion,
          input.outputSchemaVersion,
          runtimeJob.terminal_result_json,
        );
      }
      const pollSleepMs = Math.min(options.pollIntervalMs, remainingWaitMs());
      const slept = await sleepUntilNextPollOrAbort(pollSleepMs, input.signal);
      if (slept) {
        accountedSleepMs += pollSleepMs;
      }
    }

    await bestEffortCancelRuntimeJob(options.controlPlaneClient, runtimeJobId, 'codex_runtime_job_expired');
    throw new AutomationHttpError(422, { code: 'codex_runtime_job_expired' }, 'codex_runtime_job_expired');
  };

  return {
    async generateSpecDraft() {
      throw new Error('unsupported_generation_task');
    },
    async generatePlanDraft() {
      throw new Error('unsupported_generation_task');
    },
    generatePackageDrafts: (input) => generateWithRemoteJob('package_drafts', input),
  };
};

export const createAutomationDaemonGenerationRuntime = (
  config: AutomationDaemonConfig,
  options: {
    localDocker?: CreateLeasedDockerCodexGenerationRuntimeOptions;
    remoteOutbound?: { controlPlaneClient: RemoteCodexGenerationControlPlaneClient };
  } = {},
): CodexGenerationRuntime | undefined => {
  const hasEnabledGenerationTask = Object.values(config.generationPlanning.tasks).some((task) => task.enabled);
  if (config.generationPlanning.mode === 'disabled' || !hasEnabledGenerationTask) {
    return undefined;
  }
  if (config.codexWorkerMode === 'local_docker') {
    if (options.localDocker === undefined) {
      throw new Error('codex_worker_runtime_dependencies_required');
    }
    return createLeasedDockerCodexGenerationRuntime({
      ...options.localDocker,
      runtimeConfig: {
        ...codexGenerationRuntimeConfigFor(config),
        ...options.localDocker.runtimeConfig,
      },
    });
  }
  if (config.codexWorkerMode === 'remote_outbound') {
    if (options.remoteOutbound === undefined) {
      throw new Error('codex_remote_worker_runtime_dependencies_required');
    }
    if (
      config.generationRuntimeProfileId === undefined ||
      config.generationCredentialBindingId === undefined ||
      config.remoteRuntimeJobWaitTimeoutMs === undefined ||
      config.remoteRuntimeJobPollIntervalMs === undefined
    ) {
      throw new Error('codex_remote_worker_runtime_config_required');
    }
    return createRemoteCodexGenerationRuntime({
      controlPlaneClient: options.remoteOutbound.controlPlaneClient,
      runtimeProfileId: config.generationRuntimeProfileId,
      credentialBindingId: config.generationCredentialBindingId,
      waitTimeoutMs: config.remoteRuntimeJobWaitTimeoutMs,
      pollIntervalMs: config.remoteRuntimeJobPollIntervalMs,
      ...(config.remoteActionClaimRenewalMs === undefined ? {} : { actionClaimRenewalMs: config.remoteActionClaimRenewalMs }),
    });
  }
  return createCodexGenerationRuntime(codexGenerationRuntimeConfigFor(config));
};
