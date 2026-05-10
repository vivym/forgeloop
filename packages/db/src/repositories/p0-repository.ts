import type {
  Artifact,
  Actor,
  Decision,
  ExecutionPackage,
  ExecutionPackageDependency,
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

export interface P0Repository {
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
    write: (repository: P0Repository) => Promise<T>,
  ): Promise<T>;

  saveReviewPacket(reviewPacket: ReviewPacket): Promise<void>;
  getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined>;
  listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
  findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined>;

  saveRelease(release: Release): Promise<void>;
  getRelease(releaseId: string): Promise<Release | undefined>;
  listReleasesForProject(projectId: string): Promise<Release[]>;
  saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItemRecord): Promise<void>;
  listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItemRecord[]>;
  saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackageRecord): Promise<void>;
  listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackageRecord[]>;
  saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void>;
  getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined>;
  listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]>;
  /** @deprecated Use listReleaseEvidences. */
  listReleaseEvidence(releaseId: string): Promise<ReleaseEvidence[]>;

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
