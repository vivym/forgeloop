import type {
  Artifact,
  Actor,
  Decision,
  DomainError as DomainErrorType,
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
import { DomainError } from '@forgeloop/domain';

import type { P0Repository, TraceArtifactRefRecord, TraceEventRecord, TraceLinkRecord } from './p0-repository';

const clone = <T>(value: T): T => structuredClone(value);

const valuesFor = <T>(records: Map<string, T>): T[] => [...records.values()].map(clone);

const byCreatedAt = <T extends { created_at: string }>(left: T, right: T) => left.created_at.localeCompare(right.created_at);
const byCreatedAtThenId = <T extends { created_at: string; id: string }>(left: T, right: T) =>
  byCreatedAt(left, right) || left.id.localeCompare(right.id);
const recoverableRunSessionStatuses = new Set<RunSession['status']>([
  'queued',
  'running',
  'waiting_for_input',
  'stalled',
  'resuming',
  'cancel_requested',
]);
const eventCursor = (sequence: number) => String(sequence).padStart(10, '0');
const invalidLease = (runSessionId: string): DomainErrorType =>
  new DomainError('INVALID_TRANSITION', `Run session ${runSessionId} does not have an active worker lease`);

export class InMemoryP0Repository implements P0Repository {
  private readonly organizations = new Map<string, Organization>();
  private readonly actors = new Map<string, Actor>();
  private readonly projects = new Map<string, Project>();
  private readonly projectRepos = new Map<string, ProjectRepo>();
  private readonly workItems = new Map<string, WorkItem>();
  private readonly specs = new Map<string, Spec>();
  private readonly specRevisions = new Map<string, SpecRevision>();
  private readonly plans = new Map<string, Plan>();
  private readonly planRevisions = new Map<string, PlanRevision>();
  private readonly executionPackages = new Map<string, ExecutionPackage>();
  private readonly executionPackageDependencies = new Map<string, ExecutionPackageDependency>();
  private readonly runSessions = new Map<string, RunSession>();
  private readonly runEvents = new Map<string, RunEvent>();
  private readonly runCommands = new Map<string, RunCommand>();
  private readonly runWorkerLeases = new Map<string, RunWorkerLease>();
  private readonly reviewPackets = new Map<string, ReviewPacket>();
  private readonly releases = new Map<string, Release>();
  private readonly releaseWorkItems = new Map<string, ReleaseWorkItem>();
  private readonly releaseWorkItemOrders = new Map<string, number>();
  private readonly releaseExecutionPackages = new Map<string, ReleaseExecutionPackage>();
  private readonly releaseExecutionPackageOrders = new Map<string, number>();
  private readonly releaseEvidences = new Map<string, ReleaseEvidence>();
  private readonly objectEvents = new Map<string, ObjectEvent>();
  private readonly statusHistories = new Map<string, StatusHistory>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly decisions = new Map<string, Decision>();
  private readonly traceEvents = new Map<string, TraceEventRecord>();
  private readonly traceLinks = new Map<string, TraceLinkRecord>();
  private readonly traceArtifactRefs = new Map<string, TraceArtifactRefRecord>();

  async saveOrganization(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, clone(organization));
  }

  async getOrganization(organizationId: string): Promise<Organization | undefined> {
    return this.cloneMaybe(this.organizations.get(organizationId));
  }

  async saveActor(actor: Actor): Promise<void> {
    this.actors.set(actor.id, clone(actor));
  }

  async getActor(actorId: string): Promise<Actor | undefined> {
    return this.cloneMaybe(this.actors.get(actorId));
  }

  async listActorsForOrganization(organizationId: string): Promise<Actor[]> {
    return valuesFor(this.actors)
      .filter((actor) => actor.org_id === organizationId)
      .sort(byCreatedAtThenId);
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, clone(project));
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.cloneMaybe(this.projects.get(projectId));
  }

  async saveProjectRepo(projectRepo: ProjectRepo): Promise<void> {
    this.projectRepos.set(projectRepo.id, clone(projectRepo));
  }

  async listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return valuesFor(this.projectRepos).filter((projectRepo) => projectRepo.project_id === projectId);
  }

  async saveWorkItem(workItem: WorkItem): Promise<void> {
    this.workItems.set(workItem.id, clone(workItem));
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    return this.cloneMaybe(this.workItems.get(workItemId));
  }

  async listWorkItems(projectId?: string): Promise<WorkItem[]> {
    const workItems = valuesFor(this.workItems);
    return projectId === undefined ? workItems : workItems.filter((workItem) => workItem.project_id === projectId);
  }

  async saveSpec(spec: Spec): Promise<void> {
    this.specs.set(spec.id, clone(spec));
  }

  async getSpec(specId: string): Promise<Spec | undefined> {
    return this.cloneMaybe(this.specs.get(specId));
  }

  async saveSpecRevision(specRevision: SpecRevision): Promise<void> {
    this.specRevisions.set(specRevision.id, clone(specRevision));
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined> {
    return this.cloneMaybe(this.specRevisions.get(specRevisionId));
  }

  async listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return valuesFor(this.specRevisions)
      .filter((specRevision) => specRevision.spec_id === specId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async savePlan(plan: Plan): Promise<void> {
    this.plans.set(plan.id, clone(plan));
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.cloneMaybe(this.plans.get(planId));
  }

  async savePlanRevision(planRevision: PlanRevision): Promise<void> {
    this.planRevisions.set(planRevision.id, clone(planRevision));
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined> {
    return this.cloneMaybe(this.planRevisions.get(planRevisionId));
  }

  async listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return valuesFor(this.planRevisions)
      .filter((planRevision) => planRevision.plan_id === planId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void> {
    this.executionPackages.set(executionPackage.id, clone(executionPackage));
  }

  async getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined> {
    return this.cloneMaybe(this.executionPackages.get(executionPackageId));
  }

  async listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]> {
    return valuesFor(this.executionPackages).filter((executionPackage) => executionPackage.work_item_id === workItemId);
  }

  async saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void> {
    this.executionPackageDependencies.set(this.dependencyKey(dependency), clone(dependency));
  }

  async listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]> {
    return valuesFor(this.executionPackageDependencies).filter(
      (dependency) => dependency.package_id === executionPackageId,
    );
  }

  async saveRunSession(runSession: RunSession): Promise<void> {
    this.runSessions.set(runSession.id, clone(runSession));
  }

  async getRunSession(runSessionId: string): Promise<RunSession | undefined> {
    return this.cloneMaybe(this.runSessions.get(runSessionId));
  }

  async listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]> {
    return valuesFor(this.runSessions)
      .filter((runSession) => runSession.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async listRecoverableRunSessions(): Promise<RunSession[]> {
    return valuesFor(this.runSessions)
      .filter((runSession) => recoverableRunSessionStatuses.has(runSession.status))
      .sort(byCreatedAt);
  }

  async appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent> {
    const existing = this.runEvents.get(event.id);
    if (existing !== undefined) {
      return clone(existing);
    }

    const sequence =
      Math.max(
        0,
        ...valuesFor(this.runEvents)
          .filter((runEvent) => runEvent.run_session_id === event.run_session_id)
          .map((runEvent) => runEvent.sequence),
      ) + 1;
    const runEvent: RunEvent = {
      ...clone(event),
      sequence,
      cursor: eventCursor(sequence),
    };

    this.runEvents.set(runEvent.id, clone(runEvent));
    return clone(runEvent);
  }

  async listRunEvents(runSessionId: string, options: { after?: string; limit?: number } = {}): Promise<RunEvent[]> {
    const events = valuesFor(this.runEvents)
      .filter((runEvent) => runEvent.run_session_id === runSessionId)
      .filter((runEvent) => options.after === undefined || runEvent.cursor > options.after)
      .sort((left, right) => left.sequence - right.sequence);

    return options.limit === undefined ? events : events.slice(0, options.limit);
  }

  async getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined> {
    return this.cloneMaybe(
      valuesFor(this.runEvents)
        .filter((runEvent) => runEvent.run_session_id === runSessionId)
        .sort((left, right) => right.sequence - left.sequence)[0],
    );
  }

  async appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    lease: { workerId: string; leaseToken: string },
  ): Promise<RunEvent> {
    await this.assertActiveRunWorkerLease(event.run_session_id, lease.workerId, lease.leaseToken, event.created_at);
    return this.appendRunEvent(event);
  }

  async saveRunCommand(command: RunCommand): Promise<void> {
    this.runCommands.set(command.id, clone(command));
  }

  async claimNextRunCommand(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    options: { reclaim_claimed_before?: string } = {},
  ): Promise<{ command: RunCommand; reclaimed: boolean } | undefined> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, now);

    const pending = valuesFor(this.runCommands)
      .filter((command) => command.run_session_id === runSessionId && command.status === 'pending')
      .sort((left, right) => {
        const priorityDelta = commandPriority(left) - commandPriority(right);
        return priorityDelta === 0 ? left.created_at.localeCompare(right.created_at) : priorityDelta;
      })[0];

    if (pending !== undefined) {
      const command = this.claimCommand(pending, workerId, now);
      return { command, reclaimed: false };
    }

    if (options.reclaim_claimed_before === undefined) {
      return undefined;
    }

    const staleClaim = valuesFor(this.runCommands)
      .filter(
        (command) =>
          command.run_session_id === runSessionId &&
          command.status === 'claimed' &&
          command.claimed_at !== undefined &&
          command.claimed_at <= options.reclaim_claimed_before!,
      )
      .sort((left, right) => (left.claimed_at ?? '').localeCompare(right.claimed_at ?? ''))[0];

    if (staleClaim === undefined) {
      return undefined;
    }

    const command = this.claimCommand(staleClaim, workerId, now);
    return { command, reclaimed: true };
  }

  async recordRunCommandDriverAck(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    driverAck: Record<string, unknown>,
    acknowledgedAt: string,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, acknowledgedAt);
    this.runCommands.set(command.id, {
      ...command,
      driver_ack: clone(driverAck),
      updated_at: acknowledgedAt,
    });
  }

  async markRunCommandApplied(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    appliedAt: string,
    driverAck: Record<string, unknown>,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, appliedAt);
    this.runCommands.set(command.id, {
      ...command,
      status: 'applied',
      applied_at: appliedAt,
      driver_ack: clone(driverAck),
      updated_at: appliedAt,
    });
  }

  async markRunCommandFailed(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    failureReason: string,
    failedAt: string,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, failedAt);
    this.runCommands.set(command.id, {
      ...command,
      status: 'failed',
      failure_reason: failureReason,
      updated_at: failedAt,
    });
  }

  async supersedePendingRunCommands(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): Promise<void> {
    this.supersedePendingRunCommandsUnfenced(runSessionId, commandTypes, now);
  }

  async supersedePendingRunCommandsForWorker(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, now);
    this.supersedePendingRunCommandsUnfenced(runSessionId, commandTypes, now);
  }

  private supersedePendingRunCommandsUnfenced(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): void {
    for (const command of valuesFor(this.runCommands)) {
      if (
        command.run_session_id === runSessionId &&
        command.status === 'pending' &&
        commandTypes.includes(command.command_type)
      ) {
        this.runCommands.set(command.id, { ...command, status: 'superseded', updated_at: now });
      }
    }
  }

  async claimRunWorkerLease(input: {
    run_session_id: string;
    worker_id: string;
    lease_token: string;
    now: string;
    expires_at: string;
  }): Promise<RunWorkerLease> {
    const existing = this.runWorkerLeases.get(input.run_session_id);
    if (
      existing !== undefined &&
      existing.status === 'active' &&
      existing.expires_at > input.now &&
      existing.worker_id !== input.worker_id
    ) {
      throw invalidLease(input.run_session_id);
    }

    const lease: RunWorkerLease = {
      id: existing?.id ?? `${input.run_session_id}:${input.worker_id}:${input.lease_token}`,
      run_session_id: input.run_session_id,
      worker_id: input.worker_id,
      lease_token: input.lease_token,
      heartbeat_at: input.now,
      expires_at: input.expires_at,
      status: 'active',
    };

    this.runWorkerLeases.set(input.run_session_id, clone(lease));
    return clone(lease);
  }

  async heartbeatRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, heartbeatAt);
    const lease = this.runWorkerLeases.get(runSessionId)!;
    this.runWorkerLeases.set(runSessionId, { ...lease, heartbeat_at: heartbeatAt, expires_at: expiresAt });
  }

  async getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined> {
    return this.cloneMaybe(this.runWorkerLeases.get(runSessionId));
  }

  async releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, releasedAt);
    const lease = this.runWorkerLeases.get(runSessionId)!;
    this.runWorkerLeases.set(runSessionId, { ...lease, heartbeat_at: releasedAt, status: 'released' });
  }

  async assertActiveRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<void> {
    const lease = this.runWorkerLeases.get(runSessionId);
    if (
      lease === undefined ||
      lease.status !== 'active' ||
      lease.worker_id !== workerId ||
      lease.lease_token !== leaseToken ||
      lease.expires_at <= now
    ) {
      throw invalidLease(runSessionId);
    }
  }

  async withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: P0Repository) => Promise<T>,
  ): Promise<T> {
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
    const result = await write(this);
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
    return result;
  }

  async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    this.reviewPackets.set(reviewPacket.id, clone(reviewPacket));
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined> {
    return this.cloneMaybe(this.reviewPackets.get(reviewPacketId));
  }

  async listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]> {
    return valuesFor(this.reviewPackets)
      .filter((reviewPacket) => reviewPacket.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined> {
    const openReviewPacket = valuesFor(this.reviewPackets)
      .filter(
        (reviewPacket) =>
          reviewPacket.execution_package_id === executionPackageId &&
          reviewPacket.status !== 'completed' &&
          reviewPacket.status !== 'archived',
      )
      .sort(byCreatedAt)[0];

    return this.cloneMaybe(openReviewPacket);
  }

  async saveRelease(release: Release): Promise<void> {
    const normalized: Release = {
      ...release,
      key: release.key ?? release.id,
      release_owner_actor_id: release.release_owner_actor_id ?? release.created_by_actor_id,
      release_type: release.release_type ?? 'normal',
      visibility: release.visibility ?? 'internal',
      labels: release.labels ?? [],
      updated_by_actor_id: release.updated_by_actor_id ?? release.created_by_actor_id,
    };

    this.releases.set(normalized.id, clone(normalized));
    this.replaceReleaseWorkItems(normalized.id, normalized.work_item_ids);
    this.replaceReleaseExecutionPackages(normalized.id, normalized.execution_package_ids);
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    const release = this.releases.get(releaseId);
    return release === undefined ? undefined : this.hydrateReleaseLinks(release);
  }

  async listReleasesForProject(projectId: string): Promise<Release[]> {
    const releases = valuesFor(this.releases).filter((release) => release.project_id === projectId).sort(byCreatedAt);
    return Promise.all(releases.map((release) => this.hydrateReleaseLinks(release)));
  }

  async saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItem): Promise<void> {
    const key = `${releaseWorkItem.release_id}:${releaseWorkItem.work_item_id}`;
    const existingOrder = this.releaseWorkItemOrders.get(key);
    const order =
      existingOrder ??
      Math.max(
        -1,
        ...[...this.releaseWorkItemOrders.entries()]
          .filter(([entryKey]) => entryKey.startsWith(`${releaseWorkItem.release_id}:`))
          .map(([, value]) => value),
      ) + 1;
    this.releaseWorkItems.set(key, clone(releaseWorkItem));
    this.releaseWorkItemOrders.set(key, order);
  }

  async listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItem[]> {
    return valuesFor(this.releaseWorkItems)
      .filter((releaseWorkItem) => releaseWorkItem.release_id === releaseId)
      .sort(
        (left, right) =>
          (this.releaseWorkItemOrders.get(`${left.release_id}:${left.work_item_id}`) ?? 0) -
            (this.releaseWorkItemOrders.get(`${right.release_id}:${right.work_item_id}`) ?? 0) ||
          left.work_item_id.localeCompare(right.work_item_id),
      );
  }

  async saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackage): Promise<void> {
    const key = `${releaseExecutionPackage.release_id}:${releaseExecutionPackage.execution_package_id}`;
    const existingOrder = this.releaseExecutionPackageOrders.get(key);
    const order =
      existingOrder ??
      Math.max(
        -1,
        ...[...this.releaseExecutionPackageOrders.entries()]
          .filter(([entryKey]) => entryKey.startsWith(`${releaseExecutionPackage.release_id}:`))
          .map(([, value]) => value),
      ) + 1;
    this.releaseExecutionPackages.set(key, clone(releaseExecutionPackage));
    this.releaseExecutionPackageOrders.set(key, order);
  }

  async listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackage[]> {
    return valuesFor(this.releaseExecutionPackages).filter(
      (releaseExecutionPackage) => releaseExecutionPackage.release_id === releaseId,
    ).sort(
      (left, right) =>
        (this.releaseExecutionPackageOrders.get(`${left.release_id}:${left.execution_package_id}`) ?? 0) -
          (this.releaseExecutionPackageOrders.get(`${right.release_id}:${right.execution_package_id}`) ?? 0) ||
        left.execution_package_id.localeCompare(right.execution_package_id),
    );
  }

  async saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void> {
    this.releaseEvidences.set(releaseEvidence.id, clone(releaseEvidence));
  }

  async getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined> {
    return this.cloneMaybe(this.releaseEvidences.get(releaseEvidenceId));
  }

  async listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]> {
    return valuesFor(this.releaseEvidences)
      .filter((releaseEvidence) => releaseEvidence.release_id === releaseId)
      .sort(byCreatedAtThenId);
  }

  async appendObjectEvent(objectEvent: ObjectEvent): Promise<void> {
    if (!this.objectEvents.has(objectEvent.id)) {
      this.objectEvents.set(objectEvent.id, clone(objectEvent));
    }
  }

  async listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]> {
    return valuesFor(this.objectEvents)
      .filter(
        (objectEvent) =>
          objectEvent.object_id === objectId && (objectType === undefined || objectEvent.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async appendStatusHistory(statusHistory: StatusHistory): Promise<void> {
    if (!this.statusHistories.has(statusHistory.id)) {
      this.statusHistories.set(statusHistory.id, clone(statusHistory));
    }
  }

  async listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]> {
    return valuesFor(this.statusHistories)
      .filter(
        (statusHistory) =>
          statusHistory.object_id === objectId && (objectType === undefined || statusHistory.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.artifacts.set(artifact.id, clone(artifact));
  }

  async listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]> {
    return valuesFor(this.artifacts)
      .filter((artifact) => artifact.object_type === objectType && artifact.object_id === objectId)
      .sort(byCreatedAt);
  }

  async saveDecision(decision: Decision): Promise<void> {
    this.decisions.set(decision.id, clone(decision));
  }

  async listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]> {
    return valuesFor(this.decisions)
      .filter((decision) => decision.object_type === objectType && decision.object_id === objectId)
      .sort(byCreatedAt);
  }

  async saveTraceEvent(traceEvent: TraceEventRecord): Promise<void> {
    const existing = this.traceEvents.get(traceEvent.id);
    this.traceEvents.set(traceEvent.id, clone({ ...traceEvent, created_at: existing?.created_at ?? traceEvent.created_at }));
  }

  async listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]> {
    return valuesFor(this.traceEvents)
      .filter((traceEvent) => traceEvent.subject_type === subjectType && traceEvent.subject_id === subjectId)
      .sort(byCreatedAtThenId);
  }

  async saveTraceLink(traceLink: TraceLinkRecord): Promise<void> {
    if (!this.traceLinks.has(traceLink.id)) {
      this.traceLinks.set(traceLink.id, clone(traceLink));
    }
  }

  async listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]> {
    return valuesFor(this.traceLinks)
      .filter((traceLink) => traceLink.trace_event_id === traceEventId)
      .sort(byCreatedAtThenId);
  }

  async saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void> {
    if (!this.traceArtifactRefs.has(traceArtifactRef.id)) {
      this.traceArtifactRefs.set(traceArtifactRef.id, clone(traceArtifactRef));
    }
  }

  async listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]> {
    return valuesFor(this.traceArtifactRefs)
      .filter((traceArtifactRef) => traceArtifactRef.trace_event_id === traceEventId)
      .sort(byCreatedAtThenId);
  }

  private cloneMaybe<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : clone(value);
  }

  private dependencyKey(dependency: ExecutionPackageDependency): string {
    return `${dependency.package_id}:${dependency.depends_on_package_id}`;
  }

  private async hydrateReleaseLinks(release: Release): Promise<Release> {
    const [workItems, executionPackages] = await Promise.all([
      this.listReleaseWorkItems(release.id),
      this.listReleaseExecutionPackages(release.id),
    ]);

    return {
      ...clone(release),
      work_item_ids: workItems.map((workItem) => workItem.work_item_id),
      execution_package_ids: executionPackages.map((executionPackage) => executionPackage.execution_package_id),
    };
  }

  private replaceReleaseWorkItems(releaseId: string, workItemIds: string[]): void {
    const uniqueWorkItemIds = [...new Set(workItemIds)];
    for (const key of [...this.releaseWorkItems.keys()]) {
      if (key.startsWith(`${releaseId}:`)) {
        this.releaseWorkItems.delete(key);
        this.releaseWorkItemOrders.delete(key);
      }
    }

    uniqueWorkItemIds.forEach((workItemId, index) => {
      const key = `${releaseId}:${workItemId}`;
      this.releaseWorkItems.set(key, clone({ release_id: releaseId, work_item_id: workItemId }));
      this.releaseWorkItemOrders.set(key, index);
    });
  }

  private replaceReleaseExecutionPackages(releaseId: string, executionPackageIds: string[]): void {
    const uniqueExecutionPackageIds = [...new Set(executionPackageIds)];
    for (const key of [...this.releaseExecutionPackages.keys()]) {
      if (key.startsWith(`${releaseId}:`)) {
        this.releaseExecutionPackages.delete(key);
        this.releaseExecutionPackageOrders.delete(key);
      }
    }

    uniqueExecutionPackageIds.forEach((executionPackageId, index) => {
      const key = `${releaseId}:${executionPackageId}`;
      this.releaseExecutionPackages.set(key, clone({ release_id: releaseId, execution_package_id: executionPackageId }));
      this.releaseExecutionPackageOrders.set(key, index);
    });
  }

  private claimCommand(command: RunCommand, workerId: string, claimedAt: string): RunCommand {
    const claimed: RunCommand = {
      ...command,
      status: 'claimed',
      claimed_by_worker_id: workerId,
      claimed_at: claimedAt,
      updated_at: claimedAt,
    };
    this.runCommands.set(claimed.id, clone(claimed));
    return clone(claimed);
  }

  private async getFencedCommand(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<RunCommand> {
    const command = this.runCommands.get(commandId);
    if (command === undefined || command.status !== 'claimed' || command.claimed_by_worker_id !== lease.workerId) {
      throw new DomainError('INVALID_TRANSITION', `Run command ${commandId} is not claimed by worker ${lease.workerId}`);
    }

    await this.assertActiveRunWorkerLease(command.run_session_id, lease.workerId, lease.leaseToken, now);
    return clone(command);
  }
}

const commandPriority = (command: RunCommand): number => (command.command_type === 'cancel' ? 0 : 1);
