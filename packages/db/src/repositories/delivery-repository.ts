import type {
  AutomationActionRun,
  AutomationActorContext,
  AutomationProjectSettings,
  AutomationPreset,
  AutomationScope,
  Artifact,
  Actor,
  CommandIdempotencyRecord,
  Decision,
  ExecutionPackageGenerationRun,
  ExecutionPackage,
  ExecutionPackageDependency,
  ManualPathHold,
  ObjectEvent,
  Organization,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  Release,
  ReleaseEvidence,
  ReleaseExecutionPackage,
  ReleaseWorkItem,
  ReviewPacket,
  RunCommand,
  RunEvent,
  RunSession,
  RunWorkerLease,
  Spec,
  SpecRevision,
  StatusHistory,
  WorkItem,
} from '@forgeloop/domain';

import type { trace_link_relationship_values } from '../schema/_shared';

export type TraceLinkRelationship = (typeof trace_link_relationship_values)[number];

export interface TraceEventRecord {
  id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_id?: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TraceLinkRecord {
  id: string;
  trace_event_id: string;
  relationship: TraceLinkRelationship;
  object_type: string;
  object_id: string;
  created_at: string;
}

export interface TraceArtifactRefRecord {
  id: string;
  trace_event_id: string;
  artifact_id?: string;
  ref: Artifact['ref'];
  created_at: string;
}

export type ReleaseWorkItemRecord = ReleaseWorkItem;
export type ReleaseExecutionPackageRecord = ReleaseExecutionPackage;

export interface ResolveAutomationProjectSettingsInput {
  project_id: string;
  repo_id?: string;
}

export interface SetAutomationProjectSettingsInput {
  id: string;
  project_id: string;
  repo_id?: string;
  scope_type: 'project' | 'repo';
  preset: AutomationPreset;
  expected_version: number;
  reason: string;
  evidence_refs: Artifact['ref'][];
  actor: AutomationActorContext;
  now: string;
}

export interface DisableAutomationProjectSettingsInput
  extends Omit<SetAutomationProjectSettingsInput, 'id' | 'preset' | 'scope_type'> {
  id?: string;
}

export interface RequestManualPathHoldInput
  extends Omit<ManualPathHold, 'status' | 'resolved_by' | 'resolved_at' | 'resolution'> {
  idempotency_key: string;
  generation_key?: string;
  gate_key?: string;
}

export interface ResolveManualPathHoldInput {
  hold_id: string;
  resolved_by: string;
  resolved_at: string;
  resolution: string;
}

export interface ListActiveManualPathHoldsInput {
  object_type: string;
  object_id: string;
  generation_key?: string;
  gate_key?: string;
}

export interface ClaimCommandIdempotencyInput
  extends Omit<CommandIdempotencyRecord, 'status' | 'created_at' | 'updated_at' | 'started_at' | 'finished_at'> {
  claim_token: string;
  locked_until: string;
  now: string;
}

export interface RenewCommandIdempotencyInput {
  idempotency_key: string;
  claim_token: string;
  locked_until: string;
  last_heartbeat_at: string;
}

export interface FinishCommandIdempotencyInput {
  idempotency_key: string;
  claim_token: string;
  result_json?: Record<string, unknown>;
  finished_at: string;
}

export interface ClaimExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  generation_key: string;
  generator_version?: string;
  policy_digest?: string;
  manifest_digest?: string;
  expected_package_count?: number;
  expected_package_keys?: string[];
  claim_token: string;
  now: string;
  locked_until: string;
}

export interface ExecutionPackageGenerationPackageRecord {
  execution_package_set_id: string;
  execution_package_id: string;
  plan_revision_id: string;
  generation_key: string;
  package_key: string;
  sequence: number;
  manifest_digest: string;
}

export interface SaveExecutionPackageGenerationPackageInput extends ExecutionPackageGenerationPackageRecord {
  claim_token: string;
}

export interface CompleteExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  execution_package_set_id: string;
  claim_token: string;
  result_json?: Record<string, unknown>;
  completed_at: string;
}

export interface SupersedeExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  execution_package_set_id: string;
  expected_version: number;
  supersede_command_id: string;
  superseded_by: string;
  superseded_at: string;
  reason: string;
  evidence_refs: Artifact['ref'][];
}

export interface GetExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  generation_key: string;
}

export interface ClaimAutomationActionRunInput
  extends Omit<
    AutomationActionRun,
    | 'status'
    | 'attempt'
    | 'claim_token'
    | 'locked_until'
    | 'last_heartbeat_at'
    | 'next_attempt_at'
    | 'retryable'
    | 'result_json'
    | 'metadata_json'
    | 'reason'
    | 'error_code'
    | 'error_message'
    | 'policy_digest'
    | 'created_by'
    | 'created_at'
    | 'updated_at'
    | 'claimed_at'
    | 'started_at'
    | 'finished_at'
  > {
  automation_scope: AutomationScope;
  claim_token: string;
  locked_until: string;
  now: string;
}

export interface CreateOrReplayAutomationActionRunInput
  extends Pick<
    AutomationActionRun,
    | 'id'
    | 'action_type'
    | 'target_object_type'
    | 'target_object_id'
    | 'target_status'
    | 'idempotency_key'
    | 'automation_scope'
    | 'automation_settings_version'
    | 'capability_fingerprint'
    | 'precondition_fingerprint'
    | 'action_input_json'
  > {
  target_revision_id?: string;
  target_version?: number;
  created_by?: string;
  status?: Extract<AutomationActionRun['status'], 'pending'>;
  now: string;
}

export interface ClaimNextAutomationActionRunInput {
  now: string;
  claim_token: string;
  locked_until: string;
  limit: number;
  project_id?: string;
  repo_id?: string;
  automation_scope?: AutomationScope;
}

export interface GetClaimedAutomationActionRunInput {
  id: string;
  claim_token: string;
}

export interface LatestCompletedProjectionActionRunInput {
  automation_scope: AutomationScope;
  repo_id: string;
  policy_status: string;
  policy_digest?: string;
  parser_version: string;
  reason_code?: string;
}

export interface MarkAutomationActionGatePendingInput {
  id: string;
  idempotency_key: string;
  claim_token: string;
  reason: string;
  result_json?: Record<string, unknown>;
  next_attempt_at?: string;
  now: string;
}

export interface CompleteAutomationActionRunInput {
  id: string;
  idempotency_key: string;
  claim_token: string;
  status: Extract<AutomationActionRun['status'], 'succeeded' | 'failed' | 'skipped' | 'blocked'>;
  result_json?: Record<string, unknown>;
  retryable?: boolean;
  next_attempt_at?: string;
  finished_at: string;
}

export interface ListClaimableAutomationActionRunsInput {
  now: string;
  limit: number;
}

export interface RuntimeSnapshotTargetRow {
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  target_version?: number;
  target_status: string;
  project_id?: string;
  repo_id?: string;
  eligible_repo_ids?: string[];
  automation_scope: AutomationScope;
  active_hold_fingerprint?: string;
  latest_matching_action_status?: string;
  blocked_reason_code?: string;
  blocked_summary?: string;
  generation_key?: string;
  disabled_reason?: 'run_enqueue_disabled_by_scope';
}

export interface RuntimeSnapshotProjectRow {
  project_id: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
}

export interface RuntimeSnapshotRepoRow {
  project_id: string;
  repo_id: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
  daemon_internal_local_path: string;
}

export interface RuntimeSnapshotManualHoldRow {
  object_type: string;
  object_id: string;
  scope_key: string;
  reason_code: string;
  status: ManualPathHold['status'];
  requested_at: string;
  resolved_at?: string;
  fingerprint: string;
}

export interface RuntimeSnapshotRepositoryData {
  projects: RuntimeSnapshotProjectRow[];
  repos: RuntimeSnapshotRepoRow[];
  work_items_requiring_plan: RuntimeSnapshotTargetRow[];
  plan_revisions_requiring_packages: RuntimeSnapshotTargetRow[];
  run_enqueue_disabled_packages: RuntimeSnapshotTargetRow[];
  active_holds: RuntimeSnapshotManualHoldRow[];
  recent_action_runs: AutomationActionRun[];
  policy_projection_action_runs: AutomationActionRun[];
}

export interface DeliveryRepository {
  withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T>;
  withObjectLock<T>(key: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T>;

  saveOrganization(organization: Organization): Promise<void>;
  getOrganization(organizationId: string): Promise<Organization | undefined>;

  saveActor(actor: Actor): Promise<void>;
  getActor(actorId: string): Promise<Actor | undefined>;
  listActorsForOrganization(organizationId: string): Promise<Actor[]>;

  saveProject(project: Project): Promise<void>;
  getProject(projectId: string): Promise<Project | undefined>;

  saveProjectRepo(projectRepo: ProjectRepo): Promise<void>;
  listProjectRepos(projectId: string): Promise<ProjectRepo[]>;

  saveWorkItem(workItem: WorkItem): Promise<void>;
  getWorkItem(workItemId: string): Promise<WorkItem | undefined>;
  listWorkItems(projectId?: string): Promise<WorkItem[]>;

  saveSpec(spec: Spec): Promise<void>;
  getSpec(specId: string): Promise<Spec | undefined>;
  saveSpecRevision(specRevision: SpecRevision): Promise<void>;
  getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined>;
  listSpecRevisions(specId: string): Promise<SpecRevision[]>;

  savePlan(plan: Plan): Promise<void>;
  getPlan(planId: string): Promise<Plan | undefined>;
  savePlanRevision(planRevision: PlanRevision): Promise<void>;
  getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined>;
  listPlanRevisions(planId: string): Promise<PlanRevision[]>;

  saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void>;
  getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined>;
  listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]>;
  saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void>;
  listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]>;

  saveRunSession(runSession: RunSession): Promise<void>;
  getRunSession(runSessionId: string): Promise<RunSession | undefined>;
  listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]>;
  findActiveRunSessionForPackage(executionPackageId: string): Promise<RunSession | undefined>;
  listRecoverableRunSessions(): Promise<RunSession[]>;

  appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent>;
  listRunEvents(runSessionId: string, options?: { after?: string; limit?: number }): Promise<RunEvent[]>;
  getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined>;
  appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    lease: { workerId: string; leaseToken: string },
  ): Promise<RunEvent>;

  saveRunCommand(command: RunCommand): Promise<void>;
  claimNextRunCommand(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    options?: { reclaim_claimed_before?: string },
  ): Promise<{ command: RunCommand; reclaimed: boolean } | undefined>;
  recordRunCommandDriverAck(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    driverAck: Record<string, unknown>,
    acknowledgedAt: string,
  ): Promise<void>;
  markRunCommandApplied(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    appliedAt: string,
    driverAck: Record<string, unknown>,
  ): Promise<void>;
  markRunCommandFailed(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    failureReason: string,
    failedAt: string,
  ): Promise<void>;
  supersedePendingRunCommands(runSessionId: string, commandTypes: RunCommand['command_type'][], now: string): Promise<void>;
  supersedePendingRunCommandsForWorker(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<void>;

  claimRunWorkerLease(input: {
    run_session_id: string;
    worker_id: string;
    lease_token: string;
    now: string;
    expires_at: string;
  }): Promise<RunWorkerLease>;
  heartbeatRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<void>;
  getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined>;
  releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void>;
  assertActiveRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, now: string): Promise<void>;
  withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: DeliveryRepository) => Promise<T>,
  ): Promise<T>;

  saveReviewPacket(reviewPacket: ReviewPacket): Promise<void>;
  getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined>;
  listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
  findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined>;

  resolveAutomationProjectSettings(input: ResolveAutomationProjectSettingsInput): Promise<AutomationProjectSettings>;
  setAutomationProjectSettings(input: SetAutomationProjectSettingsInput): Promise<AutomationProjectSettings>;
  disableAutomationProjectSettings(input: DisableAutomationProjectSettingsInput): Promise<AutomationProjectSettings>;
  getManualPathHold(holdId: string): Promise<ManualPathHold | undefined>;
  listActiveManualPathHolds(input: ListActiveManualPathHoldsInput): Promise<ManualPathHold[]>;
  requestManualPathHold(input: RequestManualPathHoldInput): Promise<ManualPathHold>;
  resolveManualPathHold(input: ResolveManualPathHoldInput): Promise<ManualPathHold>;
  claimCommandIdempotency(input: ClaimCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  renewCommandIdempotency(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  completeCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  failCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  blockCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  claimExecutionPackageGenerationRun(input: ClaimExecutionPackageGenerationRunInput): Promise<ExecutionPackageGenerationRun>;
  saveExecutionPackageGenerationPackage(input: SaveExecutionPackageGenerationPackageInput): Promise<void>;
  completeExecutionPackageGenerationRun(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun>;
  getExecutionPackageGenerationRun(
    input: GetExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun | undefined>;
  supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun>;
  createOrReplayAutomationActionRun(input: CreateOrReplayAutomationActionRunInput): Promise<AutomationActionRun>;
  claimNextAutomationActionRun(input: ClaimNextAutomationActionRunInput): Promise<AutomationActionRun | undefined>;
  getClaimedAutomationActionRun(input: GetClaimedAutomationActionRunInput): Promise<AutomationActionRun>;
  latestCompletedProjectionActionRun(
    input: LatestCompletedProjectionActionRunInput,
  ): Promise<AutomationActionRun | undefined>;
  claimAutomationActionRun(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun>;
  completeAutomationActionRun(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun>;
  markAutomationActionGatePending(input: MarkAutomationActionGatePendingInput): Promise<AutomationActionRun>;
  listClaimableAutomationActionRuns(input: ListClaimableAutomationActionRunsInput): Promise<AutomationActionRun[]>;
  getRuntimeSnapshotData(): Promise<RuntimeSnapshotRepositoryData>;

  saveRelease(release: Release): Promise<void>;
  getRelease(releaseId: string): Promise<Release | undefined>;
  listReleases(projectId?: string): Promise<Release[]>;
  saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItemRecord): Promise<void>;
  listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItemRecord[]>;
  saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackageRecord): Promise<void>;
  listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackageRecord[]>;
  saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void>;
  getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined>;
  listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]>;

  appendObjectEvent(objectEvent: ObjectEvent): Promise<void>;
  listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]>;

  appendStatusHistory(statusHistory: StatusHistory): Promise<void>;
  listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]>;

  saveArtifact(artifact: Artifact): Promise<void>;
  listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]>;

  saveDecision(decision: Decision): Promise<void>;
  listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]>;

  saveTraceEvent(traceEvent: TraceEventRecord): Promise<void>;
  listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]>;
  saveTraceLink(traceLink: TraceLinkRecord): Promise<void>;
  listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]>;
  saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void>;
  listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]>;
}
