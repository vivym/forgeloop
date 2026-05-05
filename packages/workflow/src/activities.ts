import {
  executorResultSchema,
  runSpecSchema,
  selfReviewResultSchema,
  type ArtifactKind,
  type ArtifactRef,
  type ChangedFile,
  type CheckResult,
  type ExecutorResult,
  type ExecutorType,
  type FailureKind,
  type RequestedChange,
  type RequiredCheckSpec,
  type RunSpec,
  type SelfReviewInput,
  type SelfReviewResult,
} from '@forgeloop/contracts';

type IsoDateTime = string;

type RunSessionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
type ExecutionPackagePhase = 'draft' | 'ready' | 'queued' | 'execution' | 'review';
type ExecutionPackageActivityState = 'idle' | 'awaiting_ai' | 'ai_running' | 'blocked' | 'awaiting_human';
type ExecutionPackageGateState = 'none' | 'not_submitted' | 'awaiting_human_review' | 'review_approved' | 'changes_requested';
type ReviewPacketStatus = 'ready' | 'in_review' | 'completed' | 'archived';
type ReviewPacketDecision = 'none' | 'approved' | 'changes_requested';

export interface ProjectRepoRecord {
  id: string;
  repo_id: string;
  project_id: string;
  status: 'active' | 'paused' | 'archived';
  local_path: string;
  default_branch: string;
  base_commit_sha: string;
}

export interface WorkItemRecord {
  id: string;
  project_id: string;
}

export interface SpecRecord {
  id: string;
  status: 'draft' | 'in_review' | 'approved';
  resolution: 'none' | 'approved';
  current_revision_id?: string;
}

export interface PlanRecord {
  id: string;
  status: 'draft' | 'in_review' | 'approved';
  resolution: 'none' | 'approved';
  current_revision_id?: string;
}

export interface SpecRevisionRecord {
  id: string;
  spec_id: string;
  work_item_id: string;
  revision_number: number;
  summary: string;
}

export interface PlanRevisionRecord {
  id: string;
  plan_id: string;
  work_item_id: string;
  revision_number: number;
  summary: string;
}

export interface ExecutionPackageRecord {
  id: string;
  work_item_id: string;
  spec_id: string;
  spec_revision_id: string;
  plan_id: string;
  plan_revision_id: string;
  project_id: string;
  repo_id: string;
  objective: string;
  reviewer_actor_id: string;
  phase: ExecutionPackagePhase;
  activity_state: ExecutionPackageActivityState;
  gate_state: ExecutionPackageGateState;
  resolution: 'none' | 'completed';
  required_checks: RequiredCheckSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  last_run_session_id?: string;
  last_failure_summary?: string;
  blocked_reason?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface RunSessionRecord {
  id: string;
  execution_package_id: string;
  requested_by_actor_id: string;
  status: RunSessionStatus;
  executor_type?: ExecutorType;
  executor_result?: ExecutorResult;
  run_spec?: RunSpec;
  changed_files: ChangedFile[];
  check_results: CheckResult[];
  artifacts: ArtifactRef[];
  log_refs: ArtifactRef[];
  summary?: string;
  failure_kind?: FailureKind;
  failure_reason?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  started_at?: IsoDateTime;
  finished_at?: IsoDateTime;
}

export interface ReviewPacketRecord {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  reviewer_actor_id: string;
  spec_revision_id: string;
  plan_revision_id: string;
  status: ReviewPacketStatus;
  decision: ReviewPacketDecision;
  summary?: string;
  changed_files: ChangedFile[];
  check_result_summary: string;
  self_review: SelfReviewResult;
  risk_notes: string[];
  reviewed_by_actor_id?: string;
  reviewed_at?: IsoDateTime;
  requested_changes: RequestedChange[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  completed_at?: IsoDateTime;
}

export interface ObjectEventRecord {
  id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  actor_id?: string;
  metadata: Record<string, unknown>;
  created_at: IsoDateTime;
}

export interface StatusHistoryRecord {
  id: string;
  object_type: string;
  object_id: string;
  from_status?: string;
  to_status: string;
  actor_id?: string;
  reason?: string;
  created_at: IsoDateTime;
}

export interface ArtifactRecord {
  id: string;
  object_type: string;
  object_id: string;
  trace_subject_type?: string;
  trace_subject_id?: string;
  ref: ArtifactRef;
  created_at: IsoDateTime;
}

export interface PackageExecutionRepository {
  getWorkItem(workItemId: string): Promise<WorkItemRecord | undefined>;
  getSpec(specId: string): Promise<SpecRecord | undefined>;
  listSpecRevisions(specId: string): Promise<SpecRevisionRecord[]>;
  getPlan(planId: string): Promise<PlanRecord | undefined>;
  listPlanRevisions(planId: string): Promise<PlanRevisionRecord[]>;
  listProjectRepos(projectId: string): Promise<ProjectRepoRecord[]>;

  saveExecutionPackage(executionPackage: ExecutionPackageRecord): Promise<void>;
  getExecutionPackage(executionPackageId: string): Promise<ExecutionPackageRecord | undefined>;

  saveRunSession(runSession: RunSessionRecord): Promise<void>;
  getRunSession(runSessionId: string): Promise<RunSessionRecord | undefined>;

  saveReviewPacket(reviewPacket: ReviewPacketRecord): Promise<void>;
  getReviewPacket(reviewPacketId: string): Promise<ReviewPacketRecord | undefined>;
  listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacketRecord[]>;
  findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacketRecord | undefined>;

  appendObjectEvent(objectEvent: ObjectEventRecord): Promise<void>;
  appendStatusHistory(statusHistory: StatusHistoryRecord): Promise<void>;
  saveArtifact(artifact: ArtifactRecord): Promise<void>;
}

export type PackageRunExecutor = (runSpec: RunSpec) => Promise<ExecutorResult>;
export type PackageRunSelfReview = (input: SelfReviewInput) => Promise<SelfReviewResult>;

export interface ExecutePackageRunInput {
  repository: PackageExecutionRepository;
  runSessionId: string;
  executor: PackageRunExecutor;
  selfReview: PackageRunSelfReview;
  now?: () => IsoDateTime;
  defaultExecutorType?: ExecutorType;
  workflowOnly?: boolean;
  timeoutSeconds?: number;
  forceRerun?: boolean;
}

export interface ExecutePackageRunActivityInput {
  runSessionId: string;
  defaultExecutorType?: ExecutorType;
  workflowOnly?: boolean;
  timeoutSeconds?: number;
  forceRerun?: boolean;
}

export interface ExecutePackageRunResult {
  runSessionId: string;
  status: RunSessionStatus;
  reviewPacketId?: string;
}

export type PackageExecutionActivityDependencies = Omit<ExecutePackageRunInput, 'runSessionId' | 'forceRerun'>;

export interface PackageExecutionActivities {
  executePackageRunActivity(input: ExecutePackageRunActivityInput): Promise<ExecutePackageRunResult>;
}

interface LoadedRunContext {
  runSession: RunSessionRecord;
  executionPackage: ExecutionPackageRecord;
  workItem: WorkItemRecord;
  specRevision: SpecRevisionRecord;
  planRevision: PlanRevisionRecord;
  projectRepo: ProjectRepoRecord;
  reviewContext: RunSpec['review_context'];
}

const terminalStatuses = new Set<RunSessionStatus>(['succeeded', 'failed', 'timed_out', 'cancelled']);
const baseRequestedArtifacts: ArtifactKind[] = ['diff', 'changed_files', 'check_output', 'execution_summary'];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const unique = <T>(items: T[]): T[] => [...new Set(items)];

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

const assertFound = <T>(value: T | undefined, description: string): T => {
  if (value === undefined) {
    throw new Error(`${description} not found`);
  }

  return value;
};

const assertApproved = (record: SpecRecord | PlanRecord, description: string): void => {
  if (record.status !== 'approved' || record.resolution !== 'approved') {
    throw new Error(`${description} is not approved`);
  }
};

const assertCurrentRevision = (input: {
  objectType: 'spec' | 'plan';
  executionPackageId: string;
  packageRevisionId: string;
  currentRevisionId: string | undefined;
}): void => {
  if (input.packageRevisionId !== input.currentRevisionId) {
    throw new Error(
      `ExecutionPackage ${input.executionPackageId} ${input.objectType}_revision_id ${input.packageRevisionId} is not current approved revision ${input.currentRevisionId ?? 'none'}`,
    );
  }
};

const latestRequestedChanges = (reviewPackets: ReviewPacketRecord[]): RunSpec['review_context'] => {
  const requestedChangePackets = reviewPackets
    .filter((packet) => packet.status === 'completed' && packet.decision === 'changes_requested')
    .sort((left, right) =>
      (left.completed_at ?? left.updated_at ?? left.created_at).localeCompare(
        right.completed_at ?? right.updated_at ?? right.created_at,
      ),
    );
  const latest = requestedChangePackets.at(-1);

  if (latest === undefined) {
    return { latest_decision: 'none', requested_changes: [] };
  }

  return {
    latest_decision: 'changes_requested',
    requested_changes: latest.requested_changes.map(clone),
  };
};

const loadRunContext = async (
  repository: PackageExecutionRepository,
  runSessionId: string,
): Promise<LoadedRunContext> => {
  const runSession = assertFound(await repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
  const executionPackage = assertFound(
    await repository.getExecutionPackage(runSession.execution_package_id),
    `ExecutionPackage ${runSession.execution_package_id}`,
  );
  const workItem = assertFound(await repository.getWorkItem(executionPackage.work_item_id), `WorkItem ${executionPackage.work_item_id}`);
  const spec = assertFound(await repository.getSpec(executionPackage.spec_id), `Spec ${executionPackage.spec_id}`);
  const plan = assertFound(await repository.getPlan(executionPackage.plan_id), `Plan ${executionPackage.plan_id}`);

  assertApproved(spec, `Spec ${spec.id}`);
  assertApproved(plan, `Plan ${plan.id}`);
  assertCurrentRevision({
    objectType: 'spec',
    executionPackageId: executionPackage.id,
    packageRevisionId: executionPackage.spec_revision_id,
    currentRevisionId: spec.current_revision_id,
  });
  assertCurrentRevision({
    objectType: 'plan',
    executionPackageId: executionPackage.id,
    packageRevisionId: executionPackage.plan_revision_id,
    currentRevisionId: plan.current_revision_id,
  });

  const specRevision = assertFound(
    (await repository.listSpecRevisions(spec.id)).find((revision) => revision.id === executionPackage.spec_revision_id),
    `SpecRevision ${executionPackage.spec_revision_id}`,
  );
  const planRevision = assertFound(
    (await repository.listPlanRevisions(plan.id)).find((revision) => revision.id === executionPackage.plan_revision_id),
    `PlanRevision ${executionPackage.plan_revision_id}`,
  );
  const projectRepo = assertFound(
    (await repository.listProjectRepos(executionPackage.project_id)).find(
      (repo) => repo.repo_id === executionPackage.repo_id && repo.status === 'active',
    ),
    `ProjectRepo ${executionPackage.repo_id}`,
  );
  const reviewContext = latestRequestedChanges(await repository.listReviewPacketsForPackage(executionPackage.id));

  return { runSession, executionPackage, workItem, specRevision, planRevision, projectRepo, reviewContext };
};

export const buildRunSpec = (
  context: LoadedRunContext,
  options: Pick<ExecutePackageRunInput, 'defaultExecutorType' | 'workflowOnly' | 'timeoutSeconds'> = {},
): RunSpec => {
  const executorType = context.runSession.executor_type ?? options.defaultExecutorType ?? 'mock';
  const workflowOnly = context.runSession.run_spec?.workflow_only ?? options.workflowOnly ?? false;
  const requestedArtifacts = unique([...context.executionPackage.required_artifact_kinds, ...baseRequestedArtifacts]);
  const runSpec: RunSpec = {
    run_session_id: context.runSession.id,
    execution_package_id: context.executionPackage.id,
    work_item_id: context.workItem.id,
    spec_revision_id: context.specRevision.id,
    plan_revision_id: context.planRevision.id,
    executor_type: executorType,
    repo: {
      repo_id: context.projectRepo.repo_id,
      local_path: context.projectRepo.local_path,
      base_branch: context.projectRepo.default_branch,
      base_commit_sha: context.projectRepo.base_commit_sha,
    },
    objective: context.executionPackage.objective,
    context: {
      spec_revision_summary: context.specRevision.summary,
      plan_revision_summary: context.planRevision.summary,
      package_instructions: context.executionPackage.objective,
      required_checks: context.executionPackage.required_checks.map(clone),
    },
    review_context: clone(context.reviewContext),
    workflow_only: workflowOnly,
    allowed_paths: [...context.executionPackage.allowed_paths],
    forbidden_paths: [...context.executionPackage.forbidden_paths],
    required_checks: context.executionPackage.required_checks.map(clone),
    artifact_policy: {
      requested_artifacts: requestedArtifacts,
    },
    timeout_seconds: options.timeoutSeconds ?? 3600,
    idempotency_key: context.runSession.id,
  };

  return runSpecSchema.parse(runSpec);
};

const archiveOpenReviewPacket = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackageId: string,
  at: IsoDateTime,
): Promise<void> => {
  const openPackets = (await repository.listReviewPacketsForPackage(executionPackageId)).filter(
    (packet) =>
      packet.run_session_id !== runSession.id &&
      packet.decision === 'none' &&
      (packet.status === 'ready' || packet.status === 'in_review'),
  );

  await Promise.all(
    openPackets.map(async (openPacket) => {
      await repository.saveReviewPacket({ ...openPacket, status: 'archived', decision: 'none', updated_at: at });
      await repository.appendObjectEvent(
        event(runSession, `review_packet_archived:${openPacket.id}`, at, { review_packet_id: openPacket.id }),
      );
    }),
  );
};

const startWorkflow = async (
  repository: PackageExecutionRepository,
  runSession: RunSessionRecord,
  executionPackage: ExecutionPackageRecord,
  runSpec: RunSpec,
  at: IsoDateTime,
): Promise<{ runSession: RunSessionRecord; executionPackage: ExecutionPackageRecord }> => {
  const fromRunStatus = runSession.status;
  const startedRunSession: RunSessionRecord = {
    ...runSession,
    status: 'running',
    executor_type: runSpec.executor_type,
    run_spec: runSpec,
    started_at: runSession.started_at ?? at,
    updated_at: at,
  };

  await repository.saveRunSession(startedRunSession);
  if (fromRunStatus !== 'running') {
    await repository.appendStatusHistory(
      history({
        id: `status-history:${runSession.id}:workflow-start`,
        objectType: 'run_session',
        objectId: runSession.id,
        fromStatus: fromRunStatus,
        toStatus: 'running',
        actorId: runSession.requested_by_actor_id,
        at,
      }),
    );
  }
  await repository.appendObjectEvent(event(startedRunSession, 'workflow_started', at));

  const fromPackageStatus = statusForPackage(executionPackage);
  const startedPackage: ExecutionPackageRecord =
    executionPackage.phase === 'queued'
      ? {
          ...executionPackage,
          phase: 'execution',
          activity_state: 'ai_running',
          updated_at: at,
        }
      : executionPackage;

  if (startedPackage !== executionPackage) {
    await repository.saveExecutionPackage(startedPackage);
    await repository.appendStatusHistory(
      history({
        id: `status-history:${executionPackage.id}:${runSession.id}:workflow-start`,
        objectType: 'execution_package',
        objectId: executionPackage.id,
        fromStatus: fromPackageStatus,
        toStatus: statusForPackage(startedPackage),
        actorId: runSession.requested_by_actor_id,
        at,
      }),
    );
  }

  return { runSession: startedRunSession, executionPackage: startedPackage };
};

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

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
    status: 'ready',
    decision: 'none',
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

const reconcileTerminalRun = async (
  input: ExecutePackageRunInput,
  context: LoadedRunContext,
  at: IsoDateTime,
): Promise<ExecutePackageRunResult> => {
  const executorResult = assertFound(context.runSession.executor_result, `ExecutorResult ${context.runSession.id}`);
  const parsedExecutorResult = executorResultSchema.parse(executorResult);
  const runSpec = runSpecSchema.parse(context.runSession.run_spec ?? buildRunSpec(context, input));

  await ensureTerminalRunSideEffects(input.repository, context.runSession, context.executionPackage, parsedExecutorResult, at);

  if (context.runSession.status !== 'succeeded') {
    await updatePackageAfterFailure(input.repository, context.runSession, context.executionPackage, at);
    return { runSessionId: context.runSession.id, status: context.runSession.status };
  }

  let reviewPacket = await input.repository.getReviewPacket(`review-packet:${context.runSession.id}`);

  if (reviewPacket === undefined) {
    const selfReviewResult = await runSelfReview(
      input.repository,
      context.runSession,
      context.executionPackage,
      runSpec,
      input.selfReview,
      at,
    );
    reviewPacket = await createReviewPacket(
      input.repository,
      context.runSession,
      context.executionPackage,
      runSpec,
      selfReviewResult,
      at,
    );
  }

  await updatePackageAfterSuccess(input.repository, context.runSession, context.executionPackage, at);

  return { runSessionId: context.runSession.id, status: context.runSession.status, reviewPacketId: reviewPacket.id };
};

export const executePackageRun = async (input: ExecutePackageRunInput): Promise<ExecutePackageRunResult> => {
  const at = input.now?.() ?? new Date().toISOString();
  const context = await loadRunContext(input.repository, input.runSessionId);

  if (terminalStatuses.has(context.runSession.status)) {
    return reconcileTerminalRun(input, context, at);
  }

  const runSpec = buildRunSpec(context, input);
  await archiveOpenReviewPacket(input.repository, context.runSession, context.executionPackage.id, at);

  const started = await startWorkflow(input.repository, context.runSession, context.executionPackage, runSpec, at);
  const executorResult = executorResultSchema.parse(await input.executor(runSpec));

  if (executorResult.run_session_id !== started.runSession.id) {
    throw new Error(`ExecutorResult run_session_id ${executorResult.run_session_id} does not match ${started.runSession.id}`);
  }

  const terminalRunSession = await persistExecutorResult(
    input.repository,
    started.runSession,
    started.executionPackage,
    executorResult,
    at,
  );

  if (terminalRunSession.status !== 'succeeded') {
    await updatePackageAfterFailure(input.repository, terminalRunSession, started.executionPackage, at);
    return { runSessionId: terminalRunSession.id, status: terminalRunSession.status };
  }

  const selfReviewResult = await runSelfReview(
    input.repository,
    terminalRunSession,
    started.executionPackage,
    runSpec,
    input.selfReview,
    at,
  );
  const reviewPacket = await createReviewPacket(
    input.repository,
    terminalRunSession,
    started.executionPackage,
    runSpec,
    selfReviewResult,
    at,
  );
  await updatePackageAfterSuccess(input.repository, terminalRunSession, started.executionPackage, at);

  return { runSessionId: terminalRunSession.id, status: terminalRunSession.status, reviewPacketId: reviewPacket.id };
};

export const createPackageExecutionActivities = (
  dependencies: PackageExecutionActivityDependencies,
): PackageExecutionActivities => ({
  executePackageRunActivity: (input) => {
    const executeInput: ExecutePackageRunInput = {
      ...dependencies,
      runSessionId: input.runSessionId,
    };
    const defaultExecutorType = input.defaultExecutorType ?? dependencies.defaultExecutorType;
    const workflowOnly = input.workflowOnly ?? dependencies.workflowOnly;
    const timeoutSeconds = input.timeoutSeconds ?? dependencies.timeoutSeconds;

    if (defaultExecutorType !== undefined) {
      executeInput.defaultExecutorType = defaultExecutorType;
    }
    if (workflowOnly !== undefined) {
      executeInput.workflowOnly = workflowOnly;
    }
    if (timeoutSeconds !== undefined) {
      executeInput.timeoutSeconds = timeoutSeconds;
    }
    if (input.forceRerun !== undefined) {
      executeInput.forceRerun = input.forceRerun;
    }

    return executePackageRun(executeInput);
  },
});
