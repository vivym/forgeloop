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
  TraceLinkRecord,
} from './activities';
import { buildRunSpec, loadRunContext } from './activities';

type IsoDateTime = string;
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type LoadedRunContext = Awaited<ReturnType<typeof loadRunContext>>;
type TraceWrite = (repository: PackageExecutionRepository) => Promise<void>;

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

const canonicalJsonValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, JsonValue> = {};

    for (const key of Object.keys(record).sort()) {
      const child = record[key];

      if (child !== undefined) {
        sorted[key] = canonicalJsonValue(child);
      }
    }

    return sorted;
  }

  throw new Error(`ExecutorResult contains non-JSON value ${String(value)}`);
};

const executorResultsEqual = (left: ExecutorResult | undefined, right: ExecutorResult): boolean =>
  left !== undefined && JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));

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
  for (const [index, artifact] of artifacts.entries()) {
    await repository.saveArtifact({
      id: `artifact:${runSession.id}:${index}:${artifact.kind}:${artifact.name}`,
      object_type: 'run_session',
      object_id: runSession.id,
      trace_subject_type: 'execution_package',
      trace_subject_id: executionPackage.id,
      ref: clone(artifact),
      created_at: at,
    });
  }
};

const terminalTraceEventId = (runSessionId: string): string => `trace-event:run-terminal:${runSessionId}`;
const replacementTraceEventId = (runSessionId: string): string => `trace-event:run-replacement:${runSessionId}`;
type TraceWarningSink = { warn: (...values: unknown[]) => void };

const terminalTraceTimeFor = (runSession: RunSessionRecord, fallback: IsoDateTime): IsoDateTime =>
  runSession.finished_at ?? runSession.updated_at ?? fallback;

const reviewPacketTraceTimeFor = (reviewPacket: ReviewPacketRecord, fallback: IsoDateTime): IsoDateTime =>
  reviewPacket.created_at ?? fallback;

const warnTraceWriteFailure = (error: unknown): void => {
  (globalThis as { console?: TraceWarningSink }).console?.warn('[forgeloop:p0.trace] best-effort trace write failed', {
    source: 'workflow-finalizer',
    error: error instanceof Error ? error.message : String(error),
  });
};

const bestEffortTraceWrite = async (write: () => Promise<void>): Promise<void> => {
  try {
    await write();
  } catch (error) {
    warnTraceWriteFailure(error);
    // Primary P0 records are authoritative; trace rows can be reconstructed when absent.
  }
};

const traceLink = (
  traceEventId: string,
  relationship: TraceLinkRecord['relationship'],
  objectType: string,
  objectId: string,
  at: IsoDateTime,
): TraceLinkRecord => ({
  id: `trace-link:${traceEventId}:${relationship}:${objectType}:${objectId}`,
  trace_event_id: traceEventId,
  relationship,
  object_type: objectType,
  object_id: objectId,
  created_at: at,
});

const recordTerminalEvidenceTrace = async (
  repository: PackageExecutionRepository,
  context: LoadedRunContext,
  runSession: RunSessionRecord,
  executorResult: ExecutorResult,
  reviewPacket: ReviewPacketRecord | undefined,
  at: IsoDateTime,
): Promise<void> =>
  bestEffortTraceWrite(async () => {
    const id = terminalTraceEventId(runSession.id);
    const payload: Record<string, unknown> = {
      run_session_id: runSession.id,
      execution_package_id: context.executionPackage.id,
      work_item_id: context.workItem.id,
      status: runSession.status,
      artifact_count: executorResult.artifacts.length,
    };
    if (reviewPacket !== undefined) {
      payload.review_packet_id = reviewPacket.id;
    }

    await repository.saveTraceEvent({
      id,
      event_type: 'run_terminal_evidence_recorded',
      subject_type: 'run_session',
      subject_id: runSession.id,
      actor_id: runSession.requested_by_actor_id,
      summary: `Terminal evidence recorded for run ${runSession.id}.`,
      payload,
      created_at: at,
    });

    const links = [
      traceLink(id, 'belongs_to', 'work_item', context.workItem.id, at),
      traceLink(id, 'belongs_to', 'execution_package', context.executionPackage.id, at),
      traceLink(id, 'generated_by', 'run_session', runSession.id, at),
    ];
    if (reviewPacket !== undefined) {
      links.push(traceLink(id, 'supports', 'review_packet', reviewPacket.id, at));
    }

    for (const link of links) {
      await repository.saveTraceLink(link);
    }

    for (const [index, artifact] of executorResult.artifacts.entries()) {
      await repository.saveTraceArtifactRef({
        id: `trace-artifact-ref:${id}:${index}:${artifact.kind}:${artifact.name}`,
        trace_event_id: id,
        artifact_id: `artifact:${runSession.id}:${index}:${artifact.kind}:${artifact.name}`,
        ref: clone(artifact),
        created_at: at,
      });
    }
  });

const recordReplacementReviewPacketTrace = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  reviewPacket: ReviewPacketRecord,
  at: IsoDateTime,
): Promise<void> =>
  bestEffortTraceWrite(async () => {
    const replacementEvent = (await repository.listTraceEventsForSubject('run_session', runSession.id)).find(
      (event) => event.id === replacementTraceEventId(runSession.id) || event.event_type === 'run_replacement_recorded',
    );
    if (replacementEvent === undefined) {
      return;
    }

    await repository.saveTraceEvent({
      ...replacementEvent,
      payload: {
        ...replacementEvent.payload,
        new_review_packet_id: reviewPacket.id,
      },
    });
    await repository.saveTraceLink(traceLink(replacementEvent.id, 'generated_by', 'review_packet', reviewPacket.id, at));
  });

const flushTraceWrites = async (repository: PackageExecutionRepository, writes: TraceWrite[]): Promise<void> => {
  for (const write of writes) {
    await write(repository);
  }
};

const runSelfReview = async (
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  runSpec: RunSpec,
  selfReview: PackageRunSelfReview,
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
    return selfReviewResultSchema.parse(await selfReview(input));
  } catch (error) {
    return fallbackSelfReview(errorMessage(error));
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

  if (selfReviewResult.status === 'failed') {
    await repository.appendObjectEvent(
      event(runSession, 'self_review_failed', at, { failure_message: selfReviewResult.failure_message ?? selfReviewResult.summary }),
    );
  }
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

const successPackageStatus = 'review/awaiting_human/awaiting_human_review';

const successPackageIsReconciled = (executionPackage: ExecutionPackageRecord): boolean =>
  statusForPackage(executionPackage) === successPackageStatus && executionPackage.resolution === 'none';

const failureSummaryFor = (runSession: RunSessionRecord): string =>
  runSession.failure_reason ?? runSession.summary ?? 'Execution failed.';

const failurePackageIsReconciled = (
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
): boolean => {
  const failureSummary = failureSummaryFor(runSession);
  const blockingCheckFailed = runSession.failure_kind === 'required_check_failed';
  const retryable = runSession.executor_result?.failure?.retryable ?? true;

  if (blockingCheckFailed || retryable) {
    return (
      executionPackage.phase === 'ready' &&
      executionPackage.activity_state === 'idle' &&
      executionPackage.gate_state === 'none' &&
      executionPackage.last_failure_summary === failureSummary
    );
  }

  return executionPackage.activity_state === 'blocked' && executionPackage.blocked_reason === failureSummary;
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

const isLatestRunForPackage = (runSession: RunSessionRecord, executionPackage: ExecutionPackageRecord): boolean =>
  executionPackage.last_run_session_id === runSession.id;

interface FinalizationState {
  context: LoadedRunContext;
  runSpec: RunSpec;
  runSession: RunSessionRecord;
  reviewPacket: ReviewPacketRecord | undefined;
}

interface PendingSuccessFinalization {
  kind: 'pending_success';
  runSession: RunSessionRecord;
  executionPackage: ExecutionPackageRecord;
  runSpec: RunSpec;
  needsSelfReview: boolean;
  traceWrites: TraceWrite[];
}

interface CompletedFinalization {
  kind: 'completed';
  result: ExecutePackageRunResult;
  traceWrites: TraceWrite[];
}

type PreparedFinalization = CompletedFinalization | PendingSuccessFinalization;

const loadFinalizationState = async (
  repository: PackageExecutionRepository,
  runSessionId: string,
  parsedExecutorResult: ExecutorResult,
): Promise<FinalizationState & { terminalMatches: boolean }> => {
  const context = await loadRunContext(repository, runSessionId);
  const currentResult = context.runSession.executor_result;
  const terminalMatches =
    terminalStatuses.has(context.runSession.status) && executorResultsEqual(currentResult, parsedExecutorResult);
  const runSpec = runSpecSchema.parse(context.runSession.run_spec ?? buildRunSpec(context, {}));
  const reviewPacket = await repository.getReviewPacket(`review-packet:${context.runSession.id}`);

  return { context, runSpec, runSession: context.runSession, reviewPacket, terminalMatches };
};

const reconcileFailedPackageIfNeeded = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  at: IsoDateTime,
): Promise<void> => {
  if (isLatestRunForPackage(runSession, executionPackage) && !failurePackageIsReconciled(runSession, executionPackage)) {
    await updatePackageAfterFailure(repository, runSession, executionPackage, at);
  }
};

const reconcileSucceededPackageIfNeeded = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  at: IsoDateTime,
): Promise<void> => {
  if (isLatestRunForPackage(runSession, executionPackage) && !successPackageIsReconciled(executionPackage)) {
    await updatePackageAfterSuccess(repository, runSession, executionPackage, at);
  }
};

const prepareFinalization = async (
  repository: PackageExecutionRepository,
  runSessionId: string,
  parsedExecutorResult: ExecutorResult,
  at: IsoDateTime,
): Promise<PreparedFinalization> => {
  const state = await loadFinalizationState(repository, runSessionId, parsedExecutorResult);
  const terminalRunSession = state.terminalMatches
    ? state.runSession
    : await persistExecutorResult(repository, state.runSession, state.context.executionPackage, parsedExecutorResult, at);

  if (terminalRunSession.status !== 'succeeded') {
    await reconcileFailedPackageIfNeeded(repository, terminalRunSession, state.context.executionPackage, at);
    const traceAt = terminalTraceTimeFor(terminalRunSession, at);

    return {
      kind: 'completed',
      result: { runSessionId: terminalRunSession.id, status: terminalRunSession.status },
      traceWrites: [
        (traceRepository) =>
          recordTerminalEvidenceTrace(traceRepository, state.context, terminalRunSession, parsedExecutorResult, undefined, traceAt),
      ],
    };
  }

  const packageReconciled =
    !isLatestRunForPackage(terminalRunSession, state.context.executionPackage) ||
    successPackageIsReconciled(state.context.executionPackage);

  if (state.reviewPacket !== undefined && packageReconciled) {
    const traceAt = terminalTraceTimeFor(terminalRunSession, at);
    const reviewTraceAt = reviewPacketTraceTimeFor(state.reviewPacket, traceAt);

    return {
      kind: 'completed',
      result: { runSessionId: terminalRunSession.id, status: terminalRunSession.status, reviewPacketId: state.reviewPacket.id },
      traceWrites: [
        (traceRepository) => recordReplacementReviewPacketTrace(traceRepository, terminalRunSession, state.reviewPacket!, reviewTraceAt),
        (traceRepository) =>
          recordTerminalEvidenceTrace(
            traceRepository,
            state.context,
            terminalRunSession,
            parsedExecutorResult,
            state.reviewPacket,
            traceAt,
          ),
      ],
    };
  }

  return {
    kind: 'pending_success',
    runSession: terminalRunSession,
    executionPackage: state.context.executionPackage,
    runSpec: state.runSpec,
    needsSelfReview: state.reviewPacket === undefined,
    traceWrites: [],
  };
};

const completeSucceededFinalization = async (
  repository: PackageExecutionRepository,
  runSessionId: string,
  parsedExecutorResult: ExecutorResult,
  runSpec: RunSpec,
  selfReviewResult: SelfReviewResult | undefined,
  at: IsoDateTime,
): Promise<CompletedFinalization> => {
  const state = await loadFinalizationState(repository, runSessionId, parsedExecutorResult);

  if (!state.terminalMatches || state.runSession.status !== 'succeeded') {
    throw new Error(`Run session ${runSessionId} changed before success finalization completed`);
  }

  const reviewPacket =
    state.reviewPacket ??
    (await createReviewPacket(
      repository,
      state.runSession,
      state.context.executionPackage,
      runSpec,
      assertFound(selfReviewResult, `SelfReviewResult ${runSessionId}`),
      at,
    ));

  await reconcileSucceededPackageIfNeeded(repository, state.runSession, state.context.executionPackage, at);
  const traceAt = terminalTraceTimeFor(state.runSession, at);
  const reviewTraceAt = reviewPacketTraceTimeFor(reviewPacket, traceAt);

  return {
    kind: 'completed',
    result: { runSessionId: state.runSession.id, status: state.runSession.status, reviewPacketId: reviewPacket.id },
    traceWrites: [
      (traceRepository) => recordReplacementReviewPacketTrace(traceRepository, state.runSession, reviewPacket, reviewTraceAt),
      (traceRepository) =>
        recordTerminalEvidenceTrace(traceRepository, state.context, state.runSession, parsedExecutorResult, reviewPacket, traceAt),
    ],
  };
};

export const finalizePackageRunWithExecutorResult: FinalizePackageRunWithExecutorResult = async (input) => {
  const at = input.now?.() ?? new Date().toISOString();
  const parsedExecutorResult = executorResultSchema.parse(input.executorResult);
  const withLeaseFence = <T>(write: (repository: PackageExecutionRepository) => Promise<T>): Promise<T> =>
    input.workerLease === undefined
      ? write(input.repository)
      : input.repository.withActiveRunWorkerLease(input.runSessionId, {
          ...input.workerLease,
          now: input.now?.() ?? new Date().toISOString(),
        }, write);

  const prepared = await withLeaseFence((repository) =>
    prepareFinalization(repository, input.runSessionId, parsedExecutorResult, at),
  );

  if (prepared.kind === 'completed') {
    await flushTraceWrites(input.repository, prepared.traceWrites);
    return prepared.result;
  }

  const selfReviewResult = prepared.needsSelfReview
    ? await runSelfReview(prepared.runSession, prepared.executionPackage, prepared.runSpec, input.selfReview)
    : undefined;

  const completed = await withLeaseFence((repository) =>
    completeSucceededFinalization(repository, input.runSessionId, parsedExecutorResult, prepared.runSpec, selfReviewResult, at),
  );
  await flushTraceWrites(input.repository, [...prepared.traceWrites, ...completed.traceWrites]);

  return completed.result;
};
