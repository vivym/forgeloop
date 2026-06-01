import {
  executorResultSchema,
  runSpecSchema,
  type ArtifactKind,
  type ArtifactRef,
  type ChangedFile,
  type CheckResult,
  type ExecutorResult,
  type ExecutorType,
  type FailureKind,
  type RequestedChange,
  type RequiredCheckSpec,
  type ReviewDecision,
  type ReviewPacketStatus,
  type RunSpec,
  type SelfReviewInput,
  type SelfReviewResult,
} from '@forgeloop/contracts';

import { artifactIdForRunSessionArtifact, finalizePackageRunWithExecutorResult } from './execution-finalizer';

type IsoDateTime = string;
type ExecutionPackagePhase = 'draft' | 'ready' | 'queued' | 'execution' | 'review' | 'integration' | 'test_gate' | 'release' | 'archived';
type ExecutionPackageActivityState =
  | 'idle'
  | 'ai_running'
  | 'ai_retrying'
  | 'human_editing'
  | 'awaiting_human'
  | 'human_reviewing'
  | 'blocked'
  | 'handover';
type ExecutionPackageGateState =
  | 'not_submitted'
  | 'self_review_pending'
  | 'awaiting_human_review'
  | 'changes_requested'
  | 'review_approved'
  | 'integration_failed'
  | 'integration_passed'
  | 'test_failed'
  | 'test_passed'
  | 'release_ready'
  | 'released';
type ExecutionPackageResolution = 'none' | 'completed' | 'cancelled' | 'rolled_back' | 'superseded';
type ReviewPacketDecision = ReviewDecision;
type RunSessionStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'stalled'
  | 'resuming'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

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

export interface ExecutionPlanRecord {
  id: string;
  development_plan_item_id: string;
  status: 'draft' | 'in_review' | 'approved' | 'changes_requested' | 'stale' | 'blocked';
  current_revision_id?: string;
  approved_revision_id?: string;
  approved_by_actor_id?: string;
}

export interface ExecutionPlanRevisionRecord {
  id: string;
  execution_plan_id: string;
  development_plan_item_id: string;
  based_on_spec_revision_id: string;
  revision_number: number;
  summary: string;
}

export interface ExecutionPackageRecord {
  id: string;
  work_item_id: string;
  development_plan_item_id?: string;
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
  execution_id?: string;
  spec_id: string;
  spec_revision_id: string;
  execution_plan_id?: string;
  execution_plan_revision_id?: string;
  plan_id: string;
  plan_revision_id: string;
  project_id: string;
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
  phase: ExecutionPackagePhase;
  activity_state: ExecutionPackageActivityState;
  gate_state: ExecutionPackageGateState;
  resolution: ExecutionPackageResolution;
  required_checks: RequiredCheckSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy?: RunSpec['source_mutation_policy'];
  version: number;
  last_run_session_id?: string;
  last_failure_summary?: string;
  blocked_reason?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface RunSessionRecord {
  id: string;
  execution_package_id: string;
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
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
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
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

export type TraceLinkRelationship = 'belongs_to' | 'generated_by' | 'supports' | 'supersedes' | 'replaces' | 'redacted_from';

export interface TraceEventRecord {
  id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_id?: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: IsoDateTime;
}

export interface TraceLinkRecord {
  id: string;
  trace_event_id: string;
  relationship: TraceLinkRelationship;
  object_type: string;
  object_id: string;
  created_at: IsoDateTime;
}

export interface TraceArtifactRefRecord {
  id: string;
  trace_event_id: string;
  artifact_id?: string;
  ref: ArtifactRef;
  created_at: IsoDateTime;
}

export interface PackageExecutionRepository {
  getWorkItem(workItemId: string): Promise<WorkItemRecord | undefined>;
  getSpec(specId: string): Promise<SpecRecord | undefined>;
  listSpecRevisions(specId: string): Promise<SpecRevisionRecord[]>;
  getPlan(planId: string): Promise<PlanRecord | undefined>;
  listPlanRevisions(planId: string): Promise<PlanRevisionRecord[]>;
  getExecutionPlan(executionPlanId: string): Promise<ExecutionPlanRecord | undefined>;
  getExecutionPlanRevision(executionPlanRevisionId: string): Promise<ExecutionPlanRevisionRecord | undefined>;
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
  saveTraceEvent(traceEvent: TraceEventRecord): Promise<void>;
  updateTraceEvent(traceEvent: TraceEventRecord): Promise<void>;
  listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]>;
  saveTraceLink(traceLink: TraceLinkRecord): Promise<void>;
  listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]>;
  saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void>;
  listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]>;
  withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: PackageExecutionRepository) => Promise<T>,
  ): Promise<T>;
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

export interface BuildPackageRunSpecInput {
  repository: PackageExecutionRepository;
  runSessionId: string;
  defaultExecutorType?: ExecutorType;
  workflowOnly?: boolean;
  now?: () => IsoDateTime;
  forceRerun?: boolean;
}

export interface StartPackageRunResult {
  runSession: RunSessionRecord;
  executionPackage: ExecutionPackageRecord;
  runSpec: RunSpec;
}

export type BuildAndStartPackageRun = (input: BuildPackageRunSpecInput) => Promise<StartPackageRunResult>;

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

const assertApprovedExecutionPlan = (record: ExecutionPlanRecord, description: string): void => {
  if (record.status !== 'approved' || record.approved_revision_id === undefined || record.approved_by_actor_id === undefined) {
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

const itemScopedPlanRevisionForPackage = async (
  repository: PackageExecutionRepository,
  executionPackage: ExecutionPackageRecord,
): Promise<PlanRevisionRecord> => {
  const executionPlanRevisionId = assertFound(
    executionPackage.execution_plan_revision_id,
    `ExecutionPackage ${executionPackage.id} execution_plan_revision_id`,
  );
  const executionPlanRevision = assertFound(
    await repository.getExecutionPlanRevision(executionPlanRevisionId),
    `ExecutionPlanRevision ${executionPlanRevisionId}`,
  );
  const executionPlan = assertFound(
    await repository.getExecutionPlan(executionPlanRevision.execution_plan_id),
    `ExecutionPlan ${executionPlanRevision.execution_plan_id}`,
  );

  assertApprovedExecutionPlan(executionPlan, `ExecutionPlan ${executionPlan.id}`);
  if (executionPackage.execution_plan_id !== undefined && executionPackage.execution_plan_id !== executionPlan.id) {
    throw new Error(
      `ExecutionPackage ${executionPackage.id} execution_plan_id ${executionPackage.execution_plan_id} does not match ExecutionPlan ${executionPlan.id}`,
    );
  }
  if (
    executionPackage.development_plan_item_id !== undefined &&
    executionPlanRevision.development_plan_item_id !== executionPackage.development_plan_item_id
  ) {
    throw new Error(
      `ExecutionPackage ${executionPackage.id} execution_plan_revision_id ${executionPlanRevision.id} does not belong to DevelopmentPlanItem ${executionPackage.development_plan_item_id}`,
    );
  }
  if (executionPlan.development_plan_item_id !== executionPlanRevision.development_plan_item_id) {
    throw new Error(
      `ExecutionPlanRevision ${executionPlanRevision.id} does not belong to ExecutionPlan ${executionPlan.id} item ${executionPlan.development_plan_item_id}`,
    );
  }
  if (
    executionPlan.current_revision_id !== executionPlanRevision.id ||
    executionPlan.approved_revision_id !== executionPlanRevision.id
  ) {
    throw new Error(
      `ExecutionPackage ${executionPackage.id} execution_plan_revision_id ${executionPlanRevision.id} is not current approved ExecutionPlan revision ${executionPlan.current_revision_id ?? 'none'}`,
    );
  }
  if (executionPlanRevision.based_on_spec_revision_id !== executionPackage.spec_revision_id) {
    throw new Error(
      `ExecutionPackage ${executionPackage.id} execution_plan_revision_id ${executionPlanRevision.id} is not based on package SpecRevision ${executionPackage.spec_revision_id}`,
    );
  }

  return {
    id: executionPlanRevision.id,
    plan_id: executionPlan.id,
    work_item_id: executionPackage.work_item_id,
    revision_number: executionPlanRevision.revision_number,
    summary: executionPlanRevision.summary,
  };
};

const legacyPlanRevisionForPackage = async (
  repository: PackageExecutionRepository,
  executionPackage: ExecutionPackageRecord,
): Promise<PlanRevisionRecord> => {
  const plan = assertFound(await repository.getPlan(executionPackage.plan_id), `Plan ${executionPackage.plan_id}`);
  assertApproved(plan, `Plan ${plan.id}`);
  assertCurrentRevision({
    objectType: 'plan',
    executionPackageId: executionPackage.id,
    packageRevisionId: executionPackage.plan_revision_id,
    currentRevisionId: plan.current_revision_id,
  });

  return assertFound(
    (await repository.listPlanRevisions(plan.id)).find((revision) => revision.id === executionPackage.plan_revision_id),
    `PlanRevision ${executionPackage.plan_revision_id}`,
  );
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

export const loadRunContext = async (
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

  assertApproved(spec, `Spec ${spec.id}`);
  assertCurrentRevision({
    objectType: 'spec',
    executionPackageId: executionPackage.id,
    packageRevisionId: executionPackage.spec_revision_id,
    currentRevisionId: spec.current_revision_id,
  });

  const specRevision = assertFound(
    (await repository.listSpecRevisions(spec.id)).find((revision) => revision.id === executionPackage.spec_revision_id),
    `SpecRevision ${executionPackage.spec_revision_id}`,
  );
  const planRevision =
    executionPackage.execution_plan_revision_id === undefined
      ? await legacyPlanRevisionForPackage(repository, executionPackage)
      : await itemScopedPlanRevisionForPackage(repository, executionPackage);
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
    project_id: context.executionPackage.project_id,
    expected_package_version: context.executionPackage.version,
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
    source_mutation_policy: context.executionPackage.source_mutation_policy ?? 'path_policy_scoped',
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
        id: artifactIdForRunSessionArtifact({
          runSessionId: runSession.id,
          index,
          kind: artifact.kind,
          name: artifact.name,
        }),
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

export const buildAndStartPackageRun = async (input: BuildPackageRunSpecInput): Promise<StartPackageRunResult> => {
  const at = input.now?.() ?? new Date().toISOString();
  const context = await loadRunContext(input.repository, input.runSessionId);
  const runSpec = buildRunSpec(context, input);

  await archiveOpenReviewPacket(input.repository, context.runSession, context.executionPackage.id, at);

  const started = await startWorkflow(input.repository, context.runSession, context.executionPackage, runSpec, at);
  return {
    runSession: started.runSession,
    executionPackage: started.executionPackage,
    runSpec,
  };
};

const runExecutorAndNormalize = async (
  executor: PackageRunExecutor,
  runSpec: RunSpec,
  runSession: RunSessionRecord,
  at: IsoDateTime,
): Promise<ExecutorResult> => {
  try {
    const parsedExecutorResult = executorResultSchema.parse(await executor(runSpec));

    if (parsedExecutorResult.run_session_id !== runSession.id) {
      throw new Error(`ExecutorResult run_session_id ${parsedExecutorResult.run_session_id} does not match ${runSession.id}`);
    }

    return validateExecutorResultForRunSpec(runSpec, parsedExecutorResult);
  } catch (error) {
    return executorFailureResult(runSpec, runSession, error, at);
  }
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const failureSummaryForError = (error: unknown): string => {
  const message = errorMessage(error);
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
};

const executorFailureResult = (
  runSpec: RunSpec,
  runSession: RunSessionRecord,
  error: unknown,
  at: IsoDateTime,
): ExecutorResult => {
  const message = failureSummaryForError(error);

  return {
    run_session_id: runSession.id,
    executor_type: runSpec.executor_type,
    executor_version: 'workflow',
    status: 'failed',
    started_at: runSession.started_at ?? at,
    finished_at: at,
    summary: message,
    changed_files: [],
    checks: [],
    artifacts: [],
    failure: {
      kind: 'executor_error',
      message,
      retryable: true,
    },
    raw_metadata: {
      failure_source: 'workflow_executor_invocation',
    },
  };
};

const missingRequiredCheckResult = (check: RequiredCheckSpec): CheckResult => ({
  check_id: check.check_id,
  command: check.command,
  status: 'skipped',
  exit_code: null,
  duration_seconds: 0,
  blocks_review: check.blocks_review,
});

const failedRequiredCheckResult = (check: RequiredCheckSpec): CheckResult => ({
  ...missingRequiredCheckResult(check),
  status: 'failed',
  exit_code: 1,
});

const requiredCheckFailureResult = (
  result: ExecutorResult,
  message: string,
  checks: CheckResult[],
): ExecutorResult => ({
  ...result,
  status: 'failed',
  summary: message,
  checks,
  failure: {
    kind: 'required_check_failed',
    message,
    retryable: true,
  },
});

const executorMalformedResult = (result: ExecutorResult, message: string): ExecutorResult => ({
  ...result,
  status: 'failed',
  summary: message,
  failure: {
    kind: 'executor_error',
    message,
    retryable: true,
  },
});

const validateExecutorResultForRunSpec = (runSpec: RunSpec, result: ExecutorResult): ExecutorResult => {
  if (result.status !== 'succeeded') {
    return result;
  }

  const resultChecksById = new Map(result.checks.map((check) => [check.check_id, check]));

  for (const requiredCheck of runSpec.required_checks) {
    const resultCheck = resultChecksById.get(requiredCheck.check_id);

    if (resultCheck === undefined) {
      const message = `Required check ${requiredCheck.check_id} did not report a result.`;
      const checks = [...result.checks, missingRequiredCheckResult(requiredCheck)];
      return requiredCheck.blocks_review
        ? requiredCheckFailureResult(result, message, checks)
        : executorMalformedResult(result, message);
    }

    if (resultCheck.blocks_review !== requiredCheck.blocks_review) {
      const message = `Required check ${requiredCheck.check_id} reported blocks_review=${resultCheck.blocks_review}; expected ${requiredCheck.blocks_review}.`;
      const checks = requiredCheck.blocks_review
        ? result.checks.map((check) =>
            check.check_id === requiredCheck.check_id ? failedRequiredCheckResult(requiredCheck) : check,
          )
        : result.checks;
      return requiredCheck.blocks_review
        ? requiredCheckFailureResult(result, message, checks)
        : executorMalformedResult(result, message);
    }
  }

  return result;
};

const assertWorkflowActivityCanExecuteRunSpec = (runSpec: RunSpec): void => {
  if (runSpec.executor_type === 'local_codex' && runSpec.workflow_only !== true) {
    throw new Error('Production local Codex execution must be handled by run-worker runtime safety boundary.');
  }
};

export const executePackageRun = async (input: ExecutePackageRunInput): Promise<ExecutePackageRunResult> => {
  const at = input.now?.() ?? new Date().toISOString();
  const context = await loadRunContext(input.repository, input.runSessionId);

  if (terminalStatuses.has(context.runSession.status)) {
    return finalizePackageRunWithExecutorResult({
      repository: input.repository,
      runSessionId: input.runSessionId,
      executorResult: assertFound(context.runSession.executor_result, `ExecutorResult ${context.runSession.id}`),
      selfReview: input.selfReview,
      now: () => at,
    });
  }

  const buildInput: BuildPackageRunSpecInput = {
    repository: input.repository,
    runSessionId: input.runSessionId,
    now: () => at,
  };
  if (input.defaultExecutorType !== undefined) {
    buildInput.defaultExecutorType = input.defaultExecutorType;
  }
  if (input.workflowOnly !== undefined) {
    buildInput.workflowOnly = input.workflowOnly;
  }
  if (input.forceRerun !== undefined) {
    buildInput.forceRerun = input.forceRerun;
  }
  assertWorkflowActivityCanExecuteRunSpec(
    buildRunSpec(context, {
      ...(input.defaultExecutorType === undefined ? {} : { defaultExecutorType: input.defaultExecutorType }),
      ...(input.workflowOnly === undefined ? {} : { workflowOnly: input.workflowOnly }),
      ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: input.timeoutSeconds }),
    }),
  );

  const started = await buildAndStartPackageRun(buildInput);
  const executorResult = await runExecutorAndNormalize(input.executor, started.runSpec, started.runSession, at);
  return finalizePackageRunWithExecutorResult({
    repository: input.repository,
    runSessionId: started.runSession.id,
    executorResult,
    selfReview: input.selfReview,
    now: () => at,
  });
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
