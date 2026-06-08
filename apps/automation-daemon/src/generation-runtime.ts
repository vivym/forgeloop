import { AutomationHttpError, type AutomationPackageDraftGenerationRuntime } from '@forgeloop/automation';
import type { DockerizedCodexAppServerLauncher, LocalCodexWorkerRuntime } from '@forgeloop/codex-worker-runtime';
import {
  CodexAppServerEndpointTransport,
  CodexGenerationError,
  createCodexGenerationRuntime,
  validateGeneratedPackageDraftSet,
  type CodexGenerationResult,
  type CodexGenerationRuntimeTaskInput,
  type GeneratedPackageDraftSetV1,
} from '@forgeloop/codex-runtime';
import {
  codexCanonicalDigest,
  parseInternalArtifactRef,
  type CodexDockerRuntimeEvidence,
  validateCodexRuntimeJobTerminalResult,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexRuntimeStatusProjection,
  type CodexSessionTerminalizationV1,
} from '@forgeloop/domain';

import type { AutomationDaemonConfig } from './config.js';

type GenerationTaskKind = 'package_drafts' | 'review_response';
type AutomationGenerationInput = CodexGenerationRuntimeTaskInput<Record<string, unknown>> & {
  orchestration: NonNullable<CodexGenerationRuntimeTaskInput<Record<string, unknown>>['orchestration']>;
};
type ReviewResponseGenerationRuntimeTaskInput = Omit<
  CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  'actionRunId' | 'orchestration' | 'outputSchemaVersion' | 'codexSessionRuntimeContext'
> & {
  outputSchemaVersion: 'review_response.v1';
  codexSessionRuntimeContext: NonNullable<CodexGenerationRuntimeTaskInput<Record<string, unknown>>['codexSessionRuntimeContext']>;
  codexSessionTerminalization: CodexSessionTerminalizationV1;
  orchestration: {
    targetType: 'plan_item_workflow_action';
    planItemWorkflowActionId: string;
    planItemWorkflowId: string;
    codexSessionId: string;
    codexSessionTurnId: string;
    reviewPacketId: string;
    reviewPacketDigest: string;
    actionAttempt: number;
    idempotencyKey: string;
  };
};
type GenerationInput = CodexGenerationRuntimeTaskInput<Record<string, unknown>> | ReviewResponseGenerationRuntimeTaskInput;
type GeneratedForTask<TTaskKind extends GenerationTaskKind> = TTaskKind extends 'package_drafts'
  ? GeneratedPackageDraftSetV1
  : TTaskKind extends 'review_response'
    ? Record<string, unknown>
  : never;
type ReviewResponseGenerationResult = {
  taskKind: 'review_response';
  promptVersion: string;
  outputSchemaVersion: 'review_response.v1';
  generated: Record<string, unknown>;
  generationArtifacts: CodexGenerationResult<GeneratedPackageDraftSetV1>['generationArtifacts'];
  publicSummary: string;
};
type GenerationResultForTask<TTaskKind extends GenerationTaskKind> = TTaskKind extends 'review_response'
  ? ReviewResponseGenerationResult
  : CodexGenerationResult<GeneratedForTask<TTaskKind>>;

export interface AutomationReviewResponseGenerationRuntime {
  generateReviewResponse(
    input: ReviewResponseGenerationRuntimeTaskInput,
  ): Promise<ReviewResponseGenerationResult>;
}

export type AutomationDaemonGenerationRuntime = AutomationPackageDraftGenerationRuntime &
  Partial<AutomationReviewResponseGenerationRuntime>;

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

const isReviewResponseGenerationInput = (input: GenerationInput): input is ReviewResponseGenerationRuntimeTaskInput =>
  input.orchestration?.targetType === 'plan_item_workflow_action';

const isAutomationGenerationInput = (input: GenerationInput): input is AutomationGenerationInput =>
  !isReviewResponseGenerationInput(input) && input.orchestration !== undefined;

const requireGenerationRuntimeTargetFor = (input: GenerationInput) => {
  if (isReviewResponseGenerationInput(input)) {
    return {
      targetType: 'plan_item_workflow_action' as const,
      targetId: input.orchestration.planItemWorkflowActionId,
      actionAttempt: input.orchestration.actionAttempt,
      idempotencyKey: input.orchestration.idempotencyKey,
    };
  }
  if (isAutomationGenerationInput(input)) {
    return {
      targetType: 'automation_action_run' as const,
      targetId: input.orchestration.actionRunId,
      actionAttempt: input.orchestration.actionAttempt,
      idempotencyKey: input.orchestration.idempotencyKey,
    };
  }
  throw new Error('codex_runtime_job_denied');
};

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
  innerRuntimeFactory?: (config: Parameters<typeof createCodexGenerationRuntime>[0]) => AutomationDaemonGenerationRuntime;
  runtimeConfig?: Partial<Parameters<typeof createCodexGenerationRuntime>[0]>;
  onDockerRuntimeEvidence?: (evidence: CodexDockerRuntimeEvidence) => void;
}

export const createLeasedDockerCodexGenerationRuntime = (
  options: CreateLeasedDockerCodexGenerationRuntimeOptions,
): AutomationDaemonGenerationRuntime => {
  const innerRuntimeFactory = options.innerRuntimeFactory ?? createCodexGenerationRuntime;

  const generateWithLease = async <T>(
    taskKind: GenerationTaskKind,
    input: GenerationInput,
    call: (runtime: AutomationDaemonGenerationRuntime, input: GenerationInput) => Promise<T>,
  ): Promise<T> => {
    if (input.orchestration === undefined) {
      throw new Error('codex_launch_lease_denied');
    }
    if (!isReviewResponseGenerationInput(input) && input.codexSessionRuntimeContext !== undefined) {
      throw new CodexGenerationError('codex_runtime_capsule_missing', {
        retryable: false,
        publicResultJson: { status: 422, code: 'codex_runtime_capsule_missing' },
      });
    }
    if (
      isReviewResponseGenerationInput(input) &&
      (input.codexSessionRuntimeContext === undefined || input.codexSessionTerminalization === undefined)
    ) {
      throw new CodexGenerationError('codex_runtime_capsule_missing', {
        retryable: false,
        publicResultJson: { status: 422, code: 'codex_runtime_capsule_missing' },
      });
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
    generatePackageDrafts: (input) =>
      generateWithLease('package_drafts', input, (runtime, taskInput) =>
        runtime.generatePackageDrafts(taskInput as CodexGenerationRuntimeTaskInput<Record<string, unknown>>),
      ),
    generateReviewResponse: (input) =>
      generateWithLease('review_response', input, (runtime, taskInput) => {
        if (runtime.generateReviewResponse === undefined) {
          throw new Error('codex_generation_task_kind_unsupported:review_response');
        }
        return runtime.generateReviewResponse(taskInput as ReviewResponseGenerationRuntimeTaskInput);
      }),
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

type RemoteRuntimeJobIdentity = {
  actionAttempt: number;
  taskKind: GenerationTaskKind;
  promptVersion: string;
  outputSchemaVersion: string;
  idempotencyKey: string;
} & (
  | {
      targetType: 'automation_action_run';
      actionRunId: string;
    }
  | {
      targetType: 'plan_item_workflow_action';
      planItemWorkflowActionId: string;
    }
);

const remoteRuntimeJobIdFor = (input: RemoteRuntimeJobIdentity): string =>
  `codex-generation-job-${codexCanonicalDigest(input).replace(/^sha256:/, '')}`;

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

const validateGeneratedPayloadForTask = <TTaskKind extends GenerationTaskKind>(
  taskKind: TTaskKind,
  generatedPayload: unknown,
): GeneratedForTask<TTaskKind> => {
  switch (taskKind) {
    case 'package_drafts':
      return validateGeneratedPackageDraftSet(generatedPayload) as GeneratedForTask<TTaskKind>;
    case 'review_response':
      return generatedPayload as GeneratedForTask<TTaskKind>;
  }
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
  requiresRuntimeCapsule: boolean,
): GenerationResultForTask<TTaskKind> => {
  let terminalResult: ReturnType<typeof validateCodexRuntimeJobTerminalResult>;
  try {
    terminalResult = validateCodexRuntimeJobTerminalResult(terminalResultJson);
  } catch {
    throw new CodexGenerationError('generated_output_schema_invalid', { retryable: false });
  }
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

  const generated = validateGeneratedPayloadForTask(taskKind, result.generated_payload);
  if (requiresRuntimeCapsule && result.output_capsule === undefined) {
    throw new CodexGenerationError('codex_runtime_capsule_missing', {
      retryable: false,
      publicResultJson: { status: 422, code: 'codex_runtime_capsule_missing' },
    });
  }

  return {
    taskKind,
    promptVersion,
    outputSchemaVersion,
    generated: generated as GeneratedForTask<TTaskKind>,
    generationArtifacts: result.generation_artifacts.flatMap((artifact) => {
      if (artifact.internal_ref === undefined || artifact.digest === undefined) {
        return [];
      }
      let parsed: ReturnType<typeof parseInternalArtifactRef>;
      try {
        parsed = parseInternalArtifactRef(artifact.internal_ref);
      } catch {
        throw new CodexGenerationError('generated_output_schema_invalid', { retryable: false });
      }
      if (parsed.kind !== 'codex_runtime_job_artifact' || parsed.owner_type !== 'codex_runtime_job' || parsed.owner_id !== runtimeJobId) {
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
  } as GenerationResultForTask<TTaskKind>;
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

export const createRemoteCodexGenerationRuntime = (options: CreateRemoteCodexGenerationRuntimeOptions): AutomationDaemonGenerationRuntime => {
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
    input: GenerationInput,
  ): Promise<GenerationResultForTask<TTaskKind>> => {
    if (input.orchestration === undefined) {
      throw new Error('codex_runtime_job_denied');
    }
    if (!isReviewResponseGenerationInput(input) && input.codexSessionRuntimeContext !== undefined) {
      throw new CodexGenerationError('codex_runtime_capsule_missing', {
        retryable: false,
        publicResultJson: { status: 422, code: 'codex_runtime_capsule_missing' },
      });
    }
    if (
      isReviewResponseGenerationInput(input) &&
      (input.codexSessionRuntimeContext === undefined || input.codexSessionTerminalization === undefined)
    ) {
      throw new CodexGenerationError('codex_runtime_capsule_missing', {
        retryable: false,
        publicResultJson: { status: 422, code: 'codex_runtime_capsule_missing' },
      });
    }
    const isAborted = (): boolean => input.signal?.aborted === true;
    if (isAborted()) {
      throw new CodexGenerationError('codex_generation_cancelled', { retryable: false });
    }
    const target = requireGenerationRuntimeTargetFor(input);
    const automationInput = isAutomationGenerationInput(input) ? input : undefined;
    const repoId = input.repoIds[0];
    const nowValue = now();
    const runtimeJobId =
      target.targetType === 'automation_action_run'
        ? remoteRuntimeJobIdFor({
            targetType: 'automation_action_run',
            actionRunId: target.targetId,
            actionAttempt: target.actionAttempt,
            taskKind,
            promptVersion: input.promptVersion,
            outputSchemaVersion: input.outputSchemaVersion,
            idempotencyKey: target.idempotencyKey,
          })
        : remoteRuntimeJobIdFor({
            targetType: 'plan_item_workflow_action',
            planItemWorkflowActionId: target.targetId,
            actionAttempt: target.actionAttempt,
            taskKind,
            promptVersion: input.promptVersion,
            outputSchemaVersion: input.outputSchemaVersion,
            idempotencyKey: target.idempotencyKey,
          });
    const expiresAt = isoAfter(nowValue, options.waitTimeoutMs);
    const signedContextDigest = codexCanonicalDigest(input.context);
    const signedContextRef = `artifact://codex-runtime-jobs/${runtimeJobId}/workload/signed-context`;
    const workloadTimeSeed = {
      target_type: target.targetType,
      target_id: target.targetId,
      action_attempt: target.actionAttempt,
      task_kind: taskKind,
      idempotency_key: target.idempotencyKey,
    };
    let workload: CodexGenerationWorkloadV1;
    if (isReviewResponseGenerationInput(input)) {
      workload = {
        schema_version: 'codex_generation_workload.v1',
        runtime_job_id: runtimeJobId,
        plan_item_workflow_action_id: input.orchestration.planItemWorkflowActionId,
        plan_item_workflow_id: input.orchestration.planItemWorkflowId,
        codex_session_id: input.orchestration.codexSessionId,
        codex_session_turn_id: input.orchestration.codexSessionTurnId,
        review_packet_id: input.orchestration.reviewPacketId,
        review_packet_digest: input.orchestration.reviewPacketDigest,
        task_kind: 'review_response',
        prompt_version: input.promptVersion,
        output_schema_version: 'review_response.v1',
        signed_context_ref: signedContextRef,
        signed_context_digest: signedContextDigest,
        prompt_template_digest: codexCanonicalDigest({
          task_kind: 'review_response',
          prompt_version: input.promptVersion,
          output_schema_version: 'review_response.v1',
        }),
        created_at: stableWorkloadIsoFor(workloadTimeSeed),
        expires_at: stableWorkloadIsoFor(workloadTimeSeed, options.waitTimeoutMs),
        codex_session_runtime_context: input.codexSessionRuntimeContext,
        codex_session_terminalization: input.codexSessionTerminalization,
      };
    } else {
      if (automationInput === undefined) {
        throw new Error('codex_runtime_job_denied');
      }
      workload = {
        schema_version: 'codex_generation_workload.v1',
        runtime_job_id: runtimeJobId,
        action_run_id: automationInput.orchestration.actionRunId,
        task_kind: taskKind as Exclude<GenerationTaskKind, 'review_response'>,
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
    }
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
      job_request_id: `codex-generation-job-request-${target.targetId}-${taskKind}-${target.idempotencyKey}`,
      target: {
        target_type: target.targetType,
        target_id: target.targetId,
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
      launch_attempt: target.actionAttempt,
      ...(isReviewResponseGenerationInput(input)
        ? {}
        : {
            action_type: automationInput?.orchestration.actionType,
            action_attempt: automationInput?.orchestration.actionAttempt,
            action_claim_token: automationInput?.orchestration.claimToken,
            precondition_fingerprint: automationInput?.orchestration.preconditionFingerprint,
          }),
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
      if (!isReviewResponseGenerationInput(input)) {
        if (automationInput === undefined) {
          throw new Error('codex_runtime_job_denied');
        }
        try {
          await runWithinWaitDeadline(() =>
            options.controlPlaneClient.renewAutomationActionRunClaim(automationInput.orchestration.actionRunId, {
              claim_token: automationInput.orchestration.claimToken,
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
          input.codexSessionRuntimeContext !== undefined,
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
    generatePackageDrafts: (input) => generateWithRemoteJob('package_drafts', input),
    generateReviewResponse: (input) => generateWithRemoteJob('review_response', input),
  };
};

export const createAutomationDaemonGenerationRuntime = (
  config: AutomationDaemonConfig,
  options: {
    localDocker?: CreateLeasedDockerCodexGenerationRuntimeOptions;
    remoteOutbound?: { controlPlaneClient: RemoteCodexGenerationControlPlaneClient };
  } = {},
): AutomationDaemonGenerationRuntime | undefined => {
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
