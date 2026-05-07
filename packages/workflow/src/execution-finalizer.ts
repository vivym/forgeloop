import {
  executorResultSchema,
  runSpecSchema,
  selfReviewResultSchema,
  type ArtifactRef,
  type CheckResult,
  type ExecutorResult,
  type RequestedChange,
  type RequiredCheckSpec,
  type RunSpec,
  type SelfReviewInput,
  type SelfReviewResult,
} from '@forgeloop/contracts';
import type { RunSessionStatus } from '@forgeloop/domain';

import type {
  ExecutePackageRunResult,
  ExecutionPackageRecord,
  ObjectEventRecord,
  PackageExecutionRepository,
  PackageRunSelfReview,
  ReviewPacketRecord,
  RunSessionRecord,
  StatusHistoryRecord,
} from './activities';
import { buildRunSpec, loadRunContext } from './activities';

type IsoDateTime = string;

export interface FinalizePackageRunWithExecutorResultInput {
  repository: PackageExecutionRepository;
  runSessionId: string;
  executorResult: ExecutorResult;
  selfReview: PackageRunSelfReview;
  workerLease?: { workerId: string; leaseToken: string };
  now?: () => IsoDateTime;
}

export type FinalizePackageRunWithExecutorResult = (
  input: FinalizePackageRunWithExecutorResultInput,
) => Promise<ExecutePackageRunResult>;

const terminalStatuses = new Set<RunSessionStatus>(['succeeded', 'failed', 'timed_out', 'cancelled']);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const statusForPackage = (executionPackage: ExecutionPackageRecord): string =>
  `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`;

const event = (
  runSession: RunSessionRecord,
  eventType: string,
  at: IsoDateTime,
  metadata: Record<string, unknown> = {},
): ObjectEventRecord => ({
  id: `event:${runSession.id}:${eventType}`,
  object_type: 'run_session',
  object_id: runSession.id,
  event_type: eventType,
  actor_id: runSession.requested_by_actor_id,
  metadata,
  created_at: at,
});

const history = (input: {
  id: string;
  objectType: string;
  objectId: string;
  fromStatus?: string | undefined;
  toStatus: string;
  actorId?: string | undefined;
  reason?: string | undefined;
  at: IsoDateTime;
}): StatusHistoryRecord => ({
  id: input.id,
  object_type: input.objectType,
  object_id: input.objectId,
  ...(input.fromStatus !== undefined ? { from_status: input.fromStatus } : {}),
  to_status: input.toStatus,
  ...(input.actorId !== undefined ? { actor_id: input.actorId } : {}),
  ...(input.reason !== undefined ? { reason: input.reason } : {}),
  created_at: input.at,
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const assertFound = <T>(value: T | undefined, description: string): T => {
  if (value === undefined) {
    throw new Error(`${description} not found`);
  }

  return value;
};

const terminalStatusFor = (result: ExecutorResult): RunSessionStatus => {
  if (result.status === 'succeeded') {
    return 'succeeded';
  }
  if (result.status === 'timed_out') {
    return 'timed_out';
  }
  if (result.status === 'cancelled') {
    return 'cancelled';
  }
  return 'failed';
};

const terminalEventTypeFor = (status: RunSessionStatus): string => {
  switch (status) {
    case 'succeeded':
      return 'executor_succeeded';
    case 'timed_out':
      return 'executor_timed_out';
    case 'cancelled':
      return 'executor_cancelled';
    default:
      return 'executor_failed';
  }
};

const executorResultsEqual = (left: ExecutorResult | undefined, right: ExecutorResult): boolean =>
  left !== undefined && JSON.stringify(left) === JSON.stringify(right);

const displayNameForCheck = (runSpec: RunSpec, checkResult: CheckResult): string =>
  runSpec.required_checks.find((check) => check.check_id === checkResult.check_id)?.display_name ?? checkResult.check_id;

const sentenceList = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;

const checkSummaryFor = (runSpec: RunSpec, checks: CheckResult[]): string => {
  const passed = checks.filter((check) => check.status === 'succeeded').length;
  const failedBlocking = checks.filter((check) => check.blocks_review && check.status !== 'succeeded').length;
  const failedNonBlocking = checks.filter((check) => !check.blocks_review && check.status !== 'succeeded').length;
  const parts: string[] = [];

  if (passed > 0) {
    parts.push(sentenceList(passed, 'check passed', 'checks passed'));
  }
  if (failedBlocking > 0) {
    parts.push(sentenceList(failedBlocking, 'blocking check failed', 'blocking checks failed'));
  }
  if (failedNonBlocking > 0) {
    parts.push(sentenceList(failedNonBlocking, 'non-blocking check failed', 'non-blocking checks failed'));
  }

  return parts.length === 0 ? 'No checks ran.' : `${parts.join('; ')}.`;
};

const nonBlockingRiskNotes = (runSpec: RunSpec, checks: CheckResult[]): string[] =>
  checks
    .filter((check) => !check.blocks_review && check.status !== 'succeeded')
    .map((check) => `Non-blocking check failed: ${displayNameForCheck(runSpec, check)}.`);

const fallbackSelfReview = (message: string): SelfReviewResult => ({
  status: 'failed',
  summary: 'AI self-review failed.',
  spec_plan_alignment: 'AI self-review did not complete.',
  test_assessment: 'AI self-review did not complete.',
  risk_notes: [],
  follow_up_questions: [],
  failure_message: message,
});

const persistArtifacts = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  artifacts: ArtifactRef[],
  at: IsoDateTime,
): Promise<void> => {
  await Promise.all(
    artifacts.map((artifact, index) =>
      repository.saveArtifact({
        id: `artifact:${runSession.id}:${index}:${artifact.kind}:${artifact.name}`,
        object_type: 'run_session',
        object_id: runSession.id,
        trace_subject_type: 'execution_package',
        trace_subject_id: executionPackage.id,
        ref: clone(artifact),
        created_at: at,
      }),
    ),
  );
};

const runSelfReview = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  runSpec: RunSpec,
  selfReview: PackageRunSelfReview,
  at: IsoDateTime,
): Promise<SelfReviewResult> => {
  const input: SelfReviewInput = {
    run_session_id: runSession.id,
    execution_package_id: executionPackage.id,
    spec_revision_id: runSpec.spec_revision_id,
    plan_revision_id: runSpec.plan_revision_id,
    run_summary: runSession.summary ?? 'Executor completed.',
    changed_files: runSession.changed_files.map(clone),
    check_results: runSession.check_results.map(clone),
    artifact_refs: runSession.artifacts.map(clone),
    requested_changes_context: runSpec.review_context.requested_changes.map(clone),
  };

  try {
    const result = selfReviewResultSchema.parse(await selfReview(input));

    if (result.status === 'failed') {
      await repository.appendObjectEvent(
        event(runSession, 'self_review_failed', at, { failure_message: result.failure_message ?? result.summary }),
      );
    }

    return result;
  } catch (error) {
    const result = fallbackSelfReview(errorMessage(error));
    await repository.appendObjectEvent(event(runSession, 'self_review_failed', at, { failure_message: result.failure_message }));
    return result;
  }
};

const createReviewPacket = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  runSpec: RunSpec,
  selfReviewResult: SelfReviewResult,
  at: IsoDateTime,
): Promise<ReviewPacketRecord> => {
  const id = `review-packet:${runSession.id}`;
  const existing = await repository.getReviewPacket(id);

  if (existing !== undefined) {
    return existing;
  }

  const failedSelfReviewNote =
    selfReviewResult.status === 'failed'
      ? [`AI self-review failed: ${selfReviewResult.failure_message ?? selfReviewResult.summary}.`]
      : [];
  const reviewPacket: ReviewPacketRecord = {
    id,
    run_session_id: runSession.id,
    execution_package_id: executionPackage.id,
    reviewer_actor_id: executionPackage.reviewer_actor_id,
    spec_revision_id: runSpec.spec_revision_id,
    plan_revision_id: runSpec.plan_revision_id,
    status: 'ready' as const,
    decision: 'none' as const,
    changed_files: runSession.changed_files.map(clone),
    check_result_summary: checkSummaryFor(runSpec, runSession.check_results),
    self_review: clone(selfReviewResult),
    risk_notes: [...selfReviewResult.risk_notes, ...nonBlockingRiskNotes(runSpec, runSession.check_results), ...failedSelfReviewNote],
    requested_changes: [],
    created_at: at,
    updated_at: at,
  };

  await repository.saveReviewPacket(reviewPacket);
  await repository.appendObjectEvent(event(runSession, 'review_packet_created', at, { review_packet_id: reviewPacket.id }));

  return reviewPacket;
};

const updatePackageAfterSuccess = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  at: IsoDateTime,
): Promise<ExecutionPackageRecord> => {
  const fromStatus = statusForPackage(executionPackage);
  const updated: ExecutionPackageRecord = {
    ...executionPackage,
    phase: 'review',
    activity_state: 'awaiting_human',
    gate_state: 'awaiting_human_review',
    resolution: 'none',
    updated_at: at,
  };

  await repository.saveExecutionPackage(updated);
  await repository.appendStatusHistory(
    history({
      id: `status-history:${executionPackage.id}:${runSession.id}:execution-succeeded`,
      objectType: 'execution_package',
      objectId: executionPackage.id,
      fromStatus,
      toStatus: statusForPackage(updated),
      actorId: runSession.requested_by_actor_id,
      at,
    }),
  );

  return updated;
};

const updatePackageAfterFailure = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  at: IsoDateTime,
): Promise<ExecutionPackageRecord> => {
  const fromStatus = statusForPackage(executionPackage);
  const failureSummary = runSession.failure_reason ?? runSession.summary ?? 'Execution failed.';
  const blockingCheckFailed = runSession.failure_kind === 'required_check_failed';
  const retryable = runSession.executor_result?.failure?.retryable ?? true;
  const updated: ExecutionPackageRecord =
    blockingCheckFailed || retryable
      ? {
          ...executionPackage,
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'none',
          last_failure_summary: failureSummary,
          updated_at: at,
        }
      : {
          ...executionPackage,
          activity_state: 'blocked',
          blocked_reason: failureSummary,
          updated_at: at,
        };

  await repository.saveExecutionPackage(updated);
  await repository.appendStatusHistory(
    history({
      id: `status-history:${executionPackage.id}:${runSession.id}:execution-failed`,
      objectType: 'execution_package',
      objectId: executionPackage.id,
      fromStatus,
      toStatus: statusForPackage(updated),
      actorId: runSession.requested_by_actor_id,
      reason: failureSummary,
      at,
    }),
  );

  return updated;
};

const persistExecutorResult = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  result: ExecutorResult,
  at: IsoDateTime,
): Promise<RunSessionRecord> => {
  const terminalStatus = terminalStatusFor(result);
  const persisted: RunSessionRecord = {
    ...runSession,
    status: terminalStatus,
    executor_type: result.executor_type,
    executor_result: result,
    changed_files: result.changed_files.map(clone),
    check_results: result.checks.map(clone),
    artifacts: result.artifacts.filter((artifact) => artifact.kind !== 'logs').map(clone),
    log_refs: result.artifacts.filter((artifact) => artifact.kind === 'logs').map(clone),
    summary: result.summary,
    finished_at: at,
    updated_at: at,
    ...(result.failure !== undefined
      ? {
          failure_kind: result.failure.kind,
          failure_reason: result.failure.message,
        }
      : {}),
  };

  if (result.failure === undefined) {
    delete persisted.failure_kind;
    delete persisted.failure_reason;
  }

  await repository.saveRunSession(persisted);
  await repository.appendStatusHistory(
    history({
      id: `status-history:${runSession.id}:${terminalStatus}`,
      objectType: 'run_session',
      objectId: runSession.id,
      fromStatus: 'running',
      toStatus: terminalStatus,
      actorId: runSession.requested_by_actor_id,
      reason: result.failure?.message,
      at,
    }),
  );
  await repository.appendObjectEvent(event(persisted, terminalEventTypeFor(terminalStatus), at, { summary: result.summary }));
  await persistArtifacts(repository, persisted, executionPackage, result.artifacts, at);

  return persisted;
};

const ensureTerminalRunSideEffects = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  executorResult: ExecutorResult,
  at: IsoDateTime,
): Promise<void> => {
  const terminalStatus = terminalStatusFor(executorResult);

  await repository.appendStatusHistory(
    history({
      id: `status-history:${runSession.id}:${terminalStatus}`,
      objectType: 'run_session',
      objectId: runSession.id,
      fromStatus: 'running',
      toStatus: terminalStatus,
      actorId: runSession.requested_by_actor_id,
      reason: executorResult.failure?.message,
      at,
    }),
  );
  await repository.appendObjectEvent(
    event(runSession, terminalEventTypeFor(terminalStatus), at, { summary: executorResult.summary }),
  );
  await persistArtifacts(repository, runSession, executionPackage, executorResult.artifacts, at);
};

const isLatestRunForPackage = (runSession: RunSessionRecord, executionPackage: ExecutionPackageRecord): boolean =>
  executionPackage.last_run_session_id === runSession.id;

export const finalizePackageRunWithExecutorResult: FinalizePackageRunWithExecutorResult = async (input) => {
  const at = input.now?.() ?? new Date().toISOString();
  const context = await loadRunContext(input.repository, input.runSessionId);
  const parsedExecutorResult = executorResultSchema.parse(input.executorResult);
  const currentResult = context.runSession.executor_result;
  const terminalMatches =
    terminalStatuses.has(context.runSession.status) && executorResultsEqual(currentResult, parsedExecutorResult);
  const runSpec = runSpecSchema.parse(context.runSession.run_spec ?? buildRunSpec(context, {}));
  const finalize = async (repository: PackageExecutionRepository): Promise<ExecutePackageRunResult> => {
    if (terminalMatches) {
      if (context.runSession.status !== 'succeeded') {
        return { runSessionId: context.runSession.id, status: context.runSession.status };
      }

      const latestRun = isLatestRunForPackage(context.runSession, context.executionPackage);
      let reviewPacket = await repository.getReviewPacket(`review-packet:${context.runSession.id}`);
      if (reviewPacket === undefined) {
        const selfReviewResult = await runSelfReview(
          repository,
          context.runSession,
          context.executionPackage,
          runSpec,
          input.selfReview,
          at,
        );
        reviewPacket = await createReviewPacket(
          repository,
          context.runSession,
          context.executionPackage,
          runSpec,
          selfReviewResult,
          at,
        );
      }

      const desiredPackageStatus = 'review/awaiting_human/awaiting_human_review';
      if (latestRun && statusForPackage(context.executionPackage) !== desiredPackageStatus) {
        await updatePackageAfterSuccess(repository, context.runSession, context.executionPackage, at);
      }

      return { runSessionId: context.runSession.id, status: context.runSession.status, reviewPacketId: reviewPacket.id };
    }

    const terminalRunSession = await persistExecutorResult(
      repository,
      context.runSession,
      context.executionPackage,
      parsedExecutorResult,
      at,
    );

    if (terminalRunSession.status !== 'succeeded') {
      if (isLatestRunForPackage(terminalRunSession, context.executionPackage)) {
        await updatePackageAfterFailure(repository, terminalRunSession, context.executionPackage, at);
      }
      return { runSessionId: terminalRunSession.id, status: terminalRunSession.status };
    }

    const selfReviewResult = await runSelfReview(
      repository,
      terminalRunSession,
      context.executionPackage,
      runSpec,
      input.selfReview,
      at,
    );
    const reviewPacket = await createReviewPacket(
      repository,
      terminalRunSession,
      context.executionPackage,
      runSpec,
      selfReviewResult,
      at,
    );
    if (isLatestRunForPackage(terminalRunSession, context.executionPackage)) {
      await updatePackageAfterSuccess(repository, terminalRunSession, context.executionPackage, at);
    }

    return { runSessionId: terminalRunSession.id, status: terminalRunSession.status, reviewPacketId: reviewPacket.id };
  };

  if (input.workerLease === undefined) {
    return finalize(input.repository);
  }

  return input.repository.withActiveRunWorkerLease(input.runSessionId, { ...input.workerLease, now: at }, finalize);
};
