import type {
  Artifact,
  Decision,
  DomainError as DomainErrorType,
  ExecutionPackage,
  ExecutionPackageDependency,
  ObjectEvent,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
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
  private readonly objectEvents = new Map<string, ObjectEvent>();
  private readonly statusHistories = new Map<string, StatusHistory>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly decisions = new Map<string, Decision>();
  private readonly traceEvents = new Map<string, TraceEventRecord>();
  private readonly traceLinks = new Map<string, TraceLinkRecord>();
  private readonly traceArtifactRefs = new Map<string, TraceArtifactRefRecord>();

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
    this.traceEvents.set(traceEvent.id, clone(traceEvent));
  }

  async listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]> {
    return valuesFor(this.traceEvents)
      .filter((traceEvent) => traceEvent.subject_type === subjectType && traceEvent.subject_id === subjectId)
      .sort(byCreatedAt);
  }

  async saveTraceLink(traceLink: TraceLinkRecord): Promise<void> {
    this.traceLinks.set(traceLink.id, clone(traceLink));
  }

  async listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]> {
    return valuesFor(this.traceLinks)
      .filter((traceLink) => traceLink.trace_event_id === traceEventId)
      .sort(byCreatedAt);
  }

  async saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void> {
    this.traceArtifactRefs.set(traceArtifactRef.id, clone(traceArtifactRef));
  }

  async listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]> {
    return valuesFor(this.traceArtifactRefs)
      .filter((traceArtifactRef) => traceArtifactRef.trace_event_id === traceEventId)
      .sort(byCreatedAt);
  }

  private cloneMaybe<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : clone(value);
  }

  private dependencyKey(dependency: ExecutionPackageDependency): string {
    return `${dependency.package_id}:${dependency.depends_on_package_id}`;
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
